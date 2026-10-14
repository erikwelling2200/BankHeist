import { expect, test, type Page } from '@playwright/test';

/** `npm run test:smoke` runs only the tests tagged `@smoke`. */
const SMOKE = { tag: '@smoke' };

interface Pos { x: number; y: number }
interface Crew { id: string; pos: Pos; actionsLeft: number }

const scene = (page: Page) => page.evaluate(() => (window as any).game.scene.getScene('bank').debugState);
const play = async (page: Page) => (await scene(page)).play;
const sim = (page: Page) => page.evaluate(() => {
    const s = (window as any).sim.state;
    return { turn: s.turn as number, phase: s.phase as string, crew: s.crew.map((c: Crew) => ({ id: c.id, pos: c.pos, actionsLeft: c.actionsLeft })) as Crew[] };
});
const member = async (page: Page, id: string) => (await sim(page)).crew.find(c => c.id === id)!;
/** Where tile (x, y) is on the page. */
const onPage = (page: Page, p: Pos) => page.evaluate(([x, y]) => (window as any).game.scene.getScene('bank').tileOnPage(x, y), [p.x, p.y]);
const tapTile = async (page: Page, p: Pos) => {
    const at = await onPage(page, p);
    await page.mouse.click(at.x, at.y);
};

/** Opens `?play&new` and waits until the bank is built and the walls have settled. */
async function boot(page: Page, query = 'play&new'): Promise<string[]> {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`/?${query}`);
    await page.waitForFunction(() => (window as any).game?.scene.getScene('bank')?.sys.isActive() && (window as any).sim, undefined, { timeout: 60000 });
    await expect.poll(async () => (await scene(page)).settled, { timeout: 20000 }).toBe(true);
    return errors;
}

/** Waits for playback to finish: nothing walking, nothing queued. */
const idle = (page: Page) => expect.poll(async () => (await play(page)).playing, { timeout: 15000 }).toBe(false);

/** Taps tiles from `offsets` (relative to the crew member) until one previews a move; returns the previewed path's end. */
async function previewNear(page: Page, id: string, offsets: Pos[]): Promise<Pos> {
    for (const d of offsets) {
        const at = (await member(page, id)).pos;
        await tapTile(page, { x: at.x + d.x, y: at.y + d.y });
        const pending = (await play(page)).pending;
        if (pending?.path?.length) return pending.path.at(-1);
    }
    throw new Error(`No reachable tile near ${id}`);
}

/** Holds End turn, and ends the turn on the prompt if crew still have actions left. */
async function endTurn(page: Page): Promise<void> {
    const button = (await page.locator('.sh-endturn').boundingBox())!;
    await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(800);
    await page.mouse.up();
    const prompt = page.locator('.sh-pend');
    if (await prompt.isVisible()) await prompt.click();
}

const AROUND: Pos[] = [{ x: 0, y: -3 }, { x: 2, y: -2 }, { x: -2, y: -2 }, { x: 3, y: 0 }, { x: -3, y: 0 }, { x: 0, y: 3 }, { x: 2, y: 2 }];

test('plays three turns of a heist through taps', SMOKE, async ({ page }) => {
    const errors = await boot(page);
    const start = await sim(page);
    expect(start.turn).toBe(1);
    expect(start.crew.map(c => c.id)).toEqual(['mara', 'jun']);
    // The crew stands on the map with their rings, and the HUD's rail shows them.
    await expect(page.locator('.sh-rail .sh-crew')).toHaveCount(2);
    await page.screenshot({ path: 'screenshots/play-start.png' });

    // Turn 1: select Mara on the map, tap a tile, then Confirm.
    await tapTile(page, start.crew[0]!.pos);
    expect((await play(page)).selected).toBe('mara');
    await page.waitForTimeout(400);
    const target = await previewNear(page, 'mara', AROUND);
    const preview = await play(page);
    expect(preview.path.at(-1)).toEqual(target);
    await expect(page.locator('.sh-confirm')).toContainText(/MOVE|DASH/);
    await page.screenshot({ path: 'screenshots/play-move.png' });
    await page.locator('.sh-confirm').click();
    await idle(page);
    const mara = await member(page, 'mara');
    expect(mara.pos).toEqual(target);
    expect(mara.actionsLeft).toBe(preview.pending.type === 'dash' ? 0 : 1);
    expect((await scene(page)).people.at(-2)).toMatchObject({ x: (target.x + 0.5) * 16, y: (target.y + 0.5) * 16 });
    await endTurn(page);
    await idle(page);
    let now = await sim(page);
    expect(now.turn).toBe(2);
    expect(now.crew.every(c => c.actionsLeft === 2)).toBe(true);

    // Turn 2: select Jun from the rail, and commit with a second tap on the same tile.
    await page.locator('.sh-rail .sh-crew').nth(1).click();
    expect((await play(page)).selected).toBe('jun');
    await page.waitForTimeout(400);
    const junTarget = await previewNear(page, 'jun', AROUND);
    await tapTile(page, junTarget);
    await idle(page);
    expect((await member(page, 'jun')).pos).toEqual(junTarget);
    // Undo takes it back; Z on the keyboard.
    await page.keyboard.press('z');
    await idle(page);
    expect((await member(page, 'jun')).actionsLeft).toBe(2);
    expect((await member(page, 'jun')).pos).not.toEqual(junTarget);
    await endTurn(page);
    await idle(page);
    expect((await sim(page)).turn).toBe(3);

    // Turn 3: Mara waits (an action from the grid, then Enter), Jun moves; then the turn ends.
    await page.locator('.sh-rail .sh-crew').nth(0).click();
    await page.locator('.sh-actions button[data-action="wait"]').first().click();
    await page.keyboard.press('Enter');
    await idle(page);
    expect((await member(page, 'mara')).actionsLeft).toBe(0);
    await page.locator('.sh-rail .sh-crew').nth(1).click();
    await page.waitForTimeout(400);
    const third = await previewNear(page, 'jun', AROUND);
    await page.locator('.sh-confirm').click();
    await idle(page);
    expect((await member(page, 'jun')).pos).toEqual(third);
    await endTurn(page);
    await idle(page);
    now = await sim(page);
    expect(now.turn).toBe(4);
    expect(now.crew.find(c => c.id === 'jun')!.pos).toEqual(third);

    // Reloading resumes the same heist (the recap card shows first).
    await page.reload();
    await page.waitForFunction(() => (window as any).sim, undefined, { timeout: 60000 });
    expect((await sim(page)).turn).toBe(4);
    expect(errors).toEqual([]);
});

test('drawing a path from the selected crew member previews it', SMOKE, async ({ page }) => {
    const errors = await boot(page);
    const mara = await member(page, 'mara');
    await tapTile(page, mara.pos);
    await page.waitForTimeout(400);
    // Selected, nothing previewed: her reach shows (Move's, and Dash's beyond it).
    expect((await play(page)).reach).toBeGreaterThan(0);
    await page.screenshot({ path: 'screenshots/play-select.png' });
    // Drag from Mara two tiles one way, trying each direction until the drawn path is a legal move.
    for (const d of AROUND.slice(0, 5)) {
        const from = await onPage(page, mara.pos), to = await onPage(page, { x: mara.pos.x + Math.sign(d.x) * 2, y: mara.pos.y + Math.sign(d.y) * 2 });
        const before = await scene(page);
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 8 });
        await page.mouse.up();
        // The drag drew a path, not a pan.
        const after = await scene(page);
        expect(after.midX).toBe(before.midX);
        if (after.play.pending?.path?.length) {
            expect(after.play.pending.path[0]).not.toEqual(mara.pos);
            expect(errors).toEqual([]);
            return;
        }
    }
    throw new Error('No direction to drag in');
});

test.describe('on a phone', () => {
    test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

    test('keeps the HUD and the camera tools apart', SMOKE, async ({ page }) => {
        const errors = await boot(page);
        await page.screenshot({ path: 'screenshots/play-phone.png' });
        const boxes = await page.evaluate(() => [
            '.sh-top', '.sh-endturn', '.sh-rail', '.sh-ltools', '.sh-actions', '.sh-confirm', '.sh-undo', '.fullscreen-button', '.play-speed'
        ].map(s => {
            const el = document.querySelector(s) as HTMLElement | null;
            const r = el && !el.hidden && getComputedStyle(el).display !== 'none' ? el.getBoundingClientRect() : null;
            return { s, r: r && r.width > 0 ? { x: r.x, y: r.y, w: r.width, h: r.height } : null };
        }));
        const shown = boxes.filter(b => b.r);
        for (const name of ['.sh-rail', '.sh-ltools', '.play-speed', '.fullscreen-button', '.sh-confirm']) expect(shown.map(b => b.s)).toContain(name);
        for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
            const a = shown[i]!.r!, b = shown[j]!.r!;
            const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
            expect(overlap, `${shown[i]!.s} overlaps ${shown[j]!.s}`).toBe(false);
        }
        // No camera buttons of the plain bank page in play mode.
        await expect(page.locator('.camera-controls')).toHaveCount(0);
        await expect(page.locator('.generator-bar')).toHaveCount(0);
        expect(errors).toEqual([]);
    });
});
