import { expect, test, type Page } from '@playwright/test';
import { effectKind, TINT_RANK, type Effect } from '../src/sim';
import { M1_INSIDE, M1_OPENING } from './m1Run';
import { ALARM_HELPERS, HATCHED_SETUP, PAGE_HELPERS, SAFE_FLOOR_SETUP } from './setups';

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

/**
 * How a test wants the page: `still` (`?still`: no clouds, dust or patrols moving by themselves) and `instant` (playback
 * at the skip speed). Both on by default, as most tests check the rules through the page and not the animation; a test
 * that watches the animation, the address or the speed button turns them off.
 */
interface Pace { still?: boolean; instant?: boolean }
const paces = new WeakMap<Page, Required<Pace>>();

/** Sets the playback speed the test asked for: the session's own, so a reload (a new Session) needs it again. */
async function pace(page: Page): Promise<void> {
    if (paces.get(page)?.instant) await page.evaluate(() => { (window as any).sim.session.playback.speed = 'instant'; });
}

/** Opens the game (`/?new`: a new heist) and waits until the bank is built and the walls have settled. */
async function boot(page: Page, query = 'new', { still = true, instant = true }: Pace = {}): Promise<string[]> {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    paces.set(page, { still, instant });
    await page.goto(`/?${query}${still ? '&still' : ''}`);
    await page.waitForFunction(() => (window as any).game?.scene.getScene('bank')?.sys.isActive() && (window as any).sim, undefined, { timeout: 60000 });
    await expect.poll(async () => (await scene(page)).settled, { timeout: 20000 }).toBe(true);
    await pace(page);
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

/** Holds End turn, ends the turn on the prompt if crew still have actions left, and waits until the turn has gone up. */
async function endTurn(page: Page): Promise<void> {
    const turn = (await sim(page)).turn;
    const button = (await page.locator('.sh-endturn').boundingBox())!;
    await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(800);
    await page.mouse.up();
    const prompt = page.locator('.sh-pend');
    if (await prompt.isVisible()) await prompt.click();
    await expect.poll(async () => (await sim(page)).turn, { timeout: 15000 }).toBeGreaterThan(turn);
}

const AROUND: Pos[] = [{ x: 0, y: -3 }, { x: 2, y: -2 }, { x: -2, y: -2 }, { x: 3, y: 0 }, { x: -3, y: 0 }, { x: 0, y: 3 }, { x: 2, y: 2 }];

// At the full size (@layout): the screen has zoom steps either side of the opening one.
test('plays three turns of a heist through taps', { tag: ['@smoke', '@layout'] }, async ({ page }) => {
    // Three world phases at 1× and a reload: about 30 s on the sandbox's software renderer, on the edge of the default.
    test.setTimeout(60000);
    const errors = await boot(page);
    const start = await sim(page);
    expect(start.turn).toBe(1);
    expect(start.crew.map(c => c.id)).toEqual(['mara', 'jun']);
    // The crew stands on the map with their rings, and the HUD's rail shows them.
    await expect(page.locator('.sh-rail .sh-crew')).toHaveCount(2);
    await page.screenshot({ path: 'screenshots/play-start.png' });

    // Turn 1: select Mara on the map (the view centres on her at the same zoom), tap a tile, then Confirm.
    const opening = (await scene(page)).zoom;
    await tapTile(page, start.crew[0]!.pos);
    expect((await play(page)).selected).toBe('mara');
    expect((await scene(page)).zoom).toBe(opening);
    await page.waitForTimeout(400);
    // A plain tap on her again selects nobody: no range, no safe floor, an empty grid; a third selects her again.
    await tapTile(page, start.crew[0]!.pos);
    const none = await play(page);
    expect([none.selected, none.reach, none.safeFloor.length]).toEqual([null, 0, 0]);
    await expect(page.locator('.sh-actions [data-action]')).toHaveCount(0);
    await tapTile(page, start.crew[0]!.pos);
    expect((await play(page)).selected).toBe('mara');
    await page.waitForTimeout(400);
    // So does a tap on her head, drawn over the tile north of her (most often one she could move to); then select again.
    const head = await onPage(page, { x: start.crew[0]!.pos.x, y: start.crew[0]!.pos.y - 0.7 });
    await page.mouse.click(head.x, head.y);
    expect(await play(page)).toMatchObject({ selected: null, pending: null });
    await tapTile(page, start.crew[0]!.pos);
    expect((await play(page)).selected).toBe('mara');
    await page.waitForTimeout(400);
    const target = await previewNear(page, 'mara', AROUND);
    const preview = await play(page);
    expect(preview.path.at(-1)).toEqual(target);
    await expect(page.locator('.sh-confirm')).toContainText(/MOVE|DASH/);
    // The range stays drawn under the previewed path.
    expect(preview.reach).toBeGreaterThan(0);
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
    // Jun's card again selects nobody and drops the preview; Jun's key (2) selects them again, nothing previewed.
    await page.locator('.sh-rail .sh-crew').nth(1).click();
    expect(await play(page)).toMatchObject({ selected: null, pending: null, path: [], reach: 0 });
    await page.keyboard.press('2');
    expect(await play(page)).toMatchObject({ selected: 'jun', pending: null });
    await page.waitForTimeout(400);
    await tapTile(page, junTarget);
    await tapTile(page, junTarget);
    await idle(page);
    expect((await member(page, 'jun')).pos).toEqual(junTarget);
    // Undo (Z) takes it back, unless the move showed the crew something new (§6.6): then Undo is off.
    const undoable = await page.evaluate(() => (window as any).sim.session.canUndo);
    await page.keyboard.press('z');
    await idle(page);
    if (undoable) {
        expect((await member(page, 'jun')).actionsLeft).toBe(2);
        expect((await member(page, 'jun')).pos).not.toEqual(junTarget);
    } else {
        await expect(page.locator('.sh-undo')).toHaveAttribute('aria-disabled', 'true');
        expect((await member(page, 'jun')).pos).toEqual(junTarget);
    }
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

    // Reloading resumes the same heist (the recap card shows first), with the camera exactly where it was (once it has
    // stopped following the last move: at the instant speed it is still on its way when the playback is over).
    await expect.poll(async () => { const a = await scene(page); await page.waitForTimeout(150); const b = await scene(page); return a.midX === b.midX && a.midY === b.midY; }).toBe(true);
    await page.keyboard.press('-');
    await page.waitForTimeout(300);
    const view = await scene(page);
    await page.reload();
    await page.waitForFunction(() => (window as any).game?.scene.getScene('bank')?.debugState?.play, undefined, { timeout: 60000 });
    expect((await sim(page)).turn).toBe(4);
    const back = await scene(page);
    expect([back.zoom, Math.round(back.midX), Math.round(back.midY)]).toEqual([view.zoom, Math.round(view.midX), Math.round(view.midY)]);
    await expect(page.locator('.sh-recap')).toBeVisible();
    expect(errors).toEqual([]);
});

test('never overwrites a saved heist without asking', SMOKE, async ({ page }) => {
    const errors = await boot(page, 'new', { still: false, instant: false });
    await page.evaluate(() => { (window as any).sim.endTurn(); (window as any).sim.session.save(); });
    // The pinned bank, saved: the game's address stays bare.
    expect(new URL(page.url()).search).toBe('');
    const seedOf = () => page.evaluate(() => (window as any).generated.seed);
    // Another bank (`?play&seed=`, the game's address in another bank): the dialog asks; keeping the saved heist goes
    // back to it, in its own bank.
    await page.goto('/?play&seed=5-5');
    await page.locator('.play-dialog-keep').click();
    await page.waitForFunction(() => (window as any).sim, undefined, { timeout: 60000 });
    expect((await sim(page)).turn).toBe(2);
    expect(await seedOf()).toEqual({ layout: 31, population: 2 });
    expect(new URL(page.url()).search).toBe('');
    // Without a seed, the saved heist resumes; with &new, starting afresh needs a yes.
    await page.goto('/?new');
    await page.locator('.play-dialog-new').click();
    await page.waitForFunction(() => (window as any).sim, undefined, { timeout: 60000 });
    expect((await sim(page)).turn).toBe(1);
    expect(page.url()).not.toMatch(/new/);
    expect(errors).toEqual([]);
});

test('plays the NPCs\' world phase: people on screen stand where the state says', SMOKE, async ({ page }) => {
    const errors = await boot(page, 'new', { instant: false });
    const npcs = () => page.evaluate(() => (window as any).sim.state.npcs.map((n: any) => ({ id: n.id, pos: n.pos, status: n.status })));
    const before = await npcs();
    for (let turn = 0; turn < 3; turn++) {
        await page.evaluate(() => (window as any).sim.endTurn());
        await idle(page);
    }
    const after = await npcs();
    expect((await sim(page)).turn).toBe(4);
    expect(after.some((n: any, i: number) => n.pos.x !== before[i].pos.x || n.pos.y !== before[i].pos.y || n.status !== before[i].status)).toBe(true);
    // On screen, each NPC is drawn as the crew knows it (§8.15): where its marker is, or not at all; never on a hidden
    // tile, and as it is (live) only on a tile seen this turn (decision 44).
    const shown = await scene(page);
    after.forEach((n: any, i: number) => {
        const marker = shown.play.npcs[i], person = shown.people[i];
        if (person.visible) expect(marker?.tile, n.id).not.toBe('hidden');
        if (person.visible && marker.kind === 'live') expect(marker.tile, n.id).toBe('seen');
        if (!marker || n.status === 'away') expect(person.visible, n.id).toBe(false);
        else if (person.visible) {
            expect([person.x, person.y], n.id).toEqual([(marker.pos.x + 0.5) * 16, (marker.pos.y + 0.5) * 16]);
            if (marker.kind === 'live') expect(marker.pos, n.id).toEqual(n.pos);
        }
    });
    expect(shown.play.npcs.some((m: any) => m)).toBe(true);
    // Look at whoever walked furthest, with the intents for the next phase drawn.
    const moved = after.map((n: any, i: number) => ({ n, d: Math.hypot(n.pos.x - before[i].pos.x, n.pos.y - before[i].pos.y) }))
        .filter((m: any, i: number) => m.n.status !== 'away' && shown.play.npcs[i]).sort((a: any, b: any) => b.d - a.d)[0].n;
    await page.evaluate(([x, y]) => (window as any).game.scene.getScene('bank').lookAt((x + 0.5) * 16, (y + 0.5) * 16), [moved.pos.x, moved.pos.y]);
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'screenshots/play-npcs.png' });
    // The knowledge layer: unscouted tiles grey, predicted and remembered NPCs translucent, on the tactical map.
    await page.keyboard.press('m');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: 'screenshots/play-knowledge.png' });
    // Selecting someone on the map keeps the map and its zoom (§20.1).
    const onMap = await scene(page);
    expect(onMap.map).toBe(true);
    const selected = (await play(page)).selected, crew = (await sim(page)).crew, other = crew.findIndex((c: any) => c.id !== selected);
    await page.keyboard.press(String(other + 1));
    expect((await play(page)).selected).toBe(crew[other]!.id);
    expect([(await scene(page)).map, (await scene(page)).zoom]).toEqual([true, onMap.zoom]);
    expect(errors).toEqual([]);
});

test('drawing a path from the selected crew member previews it', SMOKE, async ({ page }) => {
    const errors = await boot(page);
    const mara = await member(page, 'mara');
    await tapTile(page, mara.pos);
    await page.waitForTimeout(400);
    // Selected, nothing previewed: her range shows (Move's, and Dash's band beyond it).
    expect((await play(page)).reach).toBeGreaterThan(0);
    expect((await play(page)).dashReach).toBeGreaterThan(0);
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

/** The tile of `tiles` nearest `d` tiles from `at`. */
const nearest = (tiles: Pos[], at: Pos, d: number): Pos =>
    tiles.map(t => ({ t, e: Math.abs(Math.hypot(t.x - at.x, t.y - at.y) - d) })).sort((a, b) => a.e - b.e)[0]!.t;

test('one movement range: a near tile is a Move (1 action), a far one a Dash (2), the range stays drawn', SMOKE, async ({ page }) => {
    const errors = await boot(page);
    const start = await member(page, 'mara');
    await tapTile(page, start.pos);
    await page.waitForTimeout(400);
    const selected = await play(page);
    expect(selected.range.walk.length).toBeGreaterThan(0);
    expect(selected.range.run.length).toBeGreaterThan(0);
    // No Dash button: movement is one entry, beside Wait.
    await expect(page.locator('.sh-actions button[data-action="dash"]')).toHaveCount(0);
    await expect(page.locator('.sh-actions button[data-action="move"]')).toHaveCount(1);
    // A step out, so the whole Dash band shows in the screenshot.
    await page.keyboard.press('-');
    await page.waitForTimeout(400);

    // Near: a Move, and the whole range is still drawn under it.
    const near = nearest(selected.range.walk, start.pos, 2);
    await tapTile(page, near);
    let shown = await play(page);
    expect(shown.pending).toMatchObject({ type: 'move' });
    expect(shown.path.at(-1)).toEqual(near);
    expect([shown.reach, shown.dashReach]).toEqual([selected.reach, selected.dashReach]);
    await expect(page.locator('.sh-confirm')).toContainText('MOVE');
    await expect(page.locator('.sh-confirm .sh-cost i')).toHaveCount(1);

    // Far: a Dash, with its noise ring; Confirm costs 2. Away from the bank (east): westward, Mara (seeing 13 tiles)
    // spots the lobby guard on the way, which cuts the dash short.
    const far = nearest(selected.range.run.filter((t: Pos) => t.x > start.pos.x), start.pos, 9);
    await tapTile(page, far);
    shown = await play(page);
    expect(shown.pending).toMatchObject({ type: 'dash' });
    expect(shown.path.at(-1)).toEqual(far);
    expect(shown.noise).toBeGreaterThan(0);
    expect([shown.reach, shown.dashReach]).toEqual([selected.reach, selected.dashReach]);
    await expect(page.locator('.sh-confirm')).toContainText('DASH');
    await expect(page.locator('.sh-confirm .sh-cost i')).toHaveCount(2);
    await page.screenshot({ path: 'screenshots/play-dash.png' });
    await page.locator('.sh-confirm').click();
    await idle(page);
    const dashed = await member(page, 'mara');
    expect(dashed.pos).toEqual(far);
    expect(dashed.actionsLeft).toBe(0);

    // Jun moves near: a Move commits for 1 action, and his range then has no Dash band (one action left).
    await page.locator('.sh-rail .sh-crew').nth(1).click();
    await page.waitForTimeout(400);
    const jun = await member(page, 'jun'), junRange = (await play(page)).range;
    const junNear = nearest(junRange.walk, jun.pos, 2);
    await tapTile(page, junNear);
    expect((await play(page)).pending).toMatchObject({ type: 'move' });
    await tapTile(page, junNear);
    await idle(page);
    const moved = await member(page, 'jun');
    expect(moved.pos).toEqual(junNear);
    expect(moved.actionsLeft).toBe(1);
    const after = await play(page);
    expect(after.reach).toBeGreaterThan(0);
    expect(after.dashReach).toBe(0);
    expect(errors).toEqual([]);
});

/**
 * Scripted setups (window.sim.restart): a heist from a changed copy of the state, in this bank's save slot, resumed by a
 * reload. `script` runs in the page with `sim` and returns the new state (or null when this bank has no such place).
 */
async function restartWith<T>(page: Page, script: string): Promise<T | null> {
    const found = await page.evaluate(script) as { state: unknown; info: T } | null;
    if (!found) return null;
    await page.evaluate(state => (window as any).sim.restart(state), found.state);
    await page.reload();
    await page.waitForFunction(() => (window as any).game?.scene.getScene('bank')?.debugState?.play && (window as any).sim, undefined, { timeout: 60000 });
    await expect.poll(async () => (await scene(page)).settled, { timeout: 20000 }).toBe(true);
    await pace(page);
    return found.info;
}

test('knocks out an NPC in reach, drags the body and stashes it', SMOKE, async ({ page }) => {
    const errors = await boot(page);
    // Mara beside a standing NPC (one she may knock out), who the crew sees.
    const setup = await restartWith<{ npc: string; at: Pos; npcAt: Pos }>(page, `(() => { ${PAGE_HELPERS}
        for (const n of sim.state.npcs) {
            if (n.status === 'away') continue;
            for (const d of AROUND) {
                const p = { x: n.pos.x + d.x, y: n.pos.y + d.y }, st = clone(sim.state);
                if (!free(st, p)) continue;
                st.crew[0].pos = p;
                know(st, n);
                if (sim.whyNot({ type: 'knockout', crew: 'mara', npc: n.id }, st) || !sim.knows(n.id, st)) continue;
                return { state: st, info: { npc: n.id, at: p, npcAt: n.pos } };
            }
        }
        return null;
    })()`);
    expect(setup).not.toBeNull();
    const { npc, npcAt } = setup!;
    await page.locator('.sh-rail .sh-crew').nth(0).click();
    await page.waitForTimeout(600);
    // The grid offers the knockout; tapping the NPC previews it, with who would see it.
    expect((await play(page)).actions.find((a: any) => a.id === 'knockout')).toMatchObject({ enabled: true });
    await tapTile(page, npcAt);
    let shown = await play(page);
    expect(shown.pending).toEqual({ type: 'knockout', crew: 'mara', npc });
    expect(shown.target).toBe(npc);
    await expect(page.locator('.sh-confirm')).toContainText('KNOCKOUT');
    await expect(page.locator('.sh-confirm')).toHaveClass(/costly/);
    await page.screenshot({ path: 'screenshots/play-knockout.png' });
    // A second tap on the target commits it.
    await tapTile(page, npcAt);
    await idle(page);
    let state = await page.evaluate(id => (window as any).sim.state.npcs.find((n: any) => n.id === id), npc);
    expect(state.status).toBe('unconscious');
    expect((await member(page, 'mara')).actionsLeft).toBe(1);
    // Drag, from the grid.
    await page.locator('.sh-actions button[data-action="drag"]').click();
    expect((await play(page)).pending).toEqual({ type: 'drag', crew: 'mara', npc });
    await page.locator('.sh-confirm').click();
    await idle(page);
    expect(await page.evaluate(() => (window as any).sim.state.crew[0].dragging)).toBe(npc);
    // The body is drawn where it lay, behind Mara, not under her.
    const bodyIndex = await page.evaluate(id => (window as any).sim.state.npcs.findIndex((n: any) => n.id === id), npc);
    const tileOf = (p: { x: number; y: number }) => ({ x: Math.floor(p.x / 16), y: Math.floor(p.y / 16) });
    expect(tileOf((await scene(page)).people[bodyIndex])).toEqual(npcAt);

    // Then, a turn on, beside a stash with the body: the reach is halved, no dash band; Stash hides it.
    const stash = await restartWith<{ at: Pos; object?: string; objectAt?: Pos }>(page, `(() => { ${PAGE_HELPERS}
        const base = sim.state, body = base.crew[0].dragging;
        const place = (st, p) => { st.crew[0].pos = { ...p }; st.crew[0].actionsLeft = 2; st.npcs.find(n => n.id === body).pos = { ...p }; };
        for (const o of w.objects.filter(o => o.kind === 'dumpster' || o.kind === 'closet')) {
            for (const d of [{ x: 0, y: 0 }, ...AROUND]) {
                const p = { x: o.pos.x + d.x, y: o.pos.y + d.y }, st = clone(base);
                if (!same(p, base.crew[0].pos) && !free(st, p)) continue;
                place(st, p);
                if (sim.whyNot({ type: 'stash', crew: 'mara', at: o.id }, st)) continue;
                return { state: st, info: { at: p, object: o.id, objectAt: o.pos } };
            }
        }
        for (let i = 0; i < w.tiles.length; i++) {
            const p = { x: i % w.width, y: Math.floor(i / w.width) }, st = clone(base);
            if (!(w.stashRooms ?? []).includes(w.tiles[i].room) || !free(st, p)) continue;
            place(st, p);
            if (!sim.whyNot({ type: 'stash', crew: 'mara' }, st)) return { state: st, info: { at: p } };
        }
        return null;
    })()`);
    expect(stash).not.toBeNull();
    await page.locator('.sh-rail .sh-crew').nth(0).click();
    await page.waitForTimeout(600);
    shown = await play(page);
    expect(shown.dashReach).toBe(0);
    expect(shown.reach).toBeGreaterThan(0);
    expect(shown.actions.map((a: any) => a.id)).toEqual(expect.arrayContaining(['drop', 'stash']));
    expect(shown.pending).toBeNull();
    expect(tileOf((await scene(page)).people[bodyIndex])).not.toEqual(stash!.at);
    await page.screenshot({ path: 'screenshots/play-drag.png' });
    await page.locator('.sh-actions button[data-action="stash"]').click();
    expect((await play(page)).pending).toMatchObject({ type: 'stash', crew: 'mara' });
    await page.locator('.sh-confirm').click();
    await idle(page);
    state = await page.evaluate(id => (window as any).sim.state.npcs.find((n: any) => n.id === id), npc);
    expect(state.stashed).not.toBeNull();
    // The stashed body is out of sight.
    const index = await page.evaluate(id => (window as any).sim.state.npcs.findIndex((n: any) => n.id === id), npc);
    expect((await scene(page)).people[index].visible).toBe(false);
    expect(errors).toEqual([]);
});

test('draws the move grid on a raised floor where it stands', async ({ page }) => {
    const errors = await boot(page);
    const raised = await restartWith<{ at: Pos }>(page, `(() => { ${PAGE_HELPERS}
        const tiles = [];
        for (let i = 0; i < w.tiles.length; i++) if (w.tiles[i].raised && !w.tiles[i].blocksMove) tiles.push({ x: i % w.width, y: Math.floor(i / w.width) });
        for (const p of tiles) {
            const st = clone(sim.state);
            if (!free(st, p)) continue;
            st.crew[0].pos = p;
            return { state: st, info: { at: p } };
        }
        return null;
    })()`);
    test.skip(!raised, 'This bank has no raised floor to stand on');
    await page.locator('.sh-rail .sh-crew').nth(0).click();
    await page.waitForTimeout(800);
    expect((await play(page)).selected).toBe('mara');
    expect((await play(page)).reach).toBeGreaterThan(0);
    await page.screenshot({ path: 'screenshots/play-raised.png' });
    expect(errors).toEqual([]);
});

/** A scene for the world UI: five NPCs the crew sees near Mara, in different states, one holding a carrier. */
const WORLD_UI_SETUP = `(() => { ${PAGE_HELPERS}
    const st = clone(sim.state), present = st.npcs.filter(n => n.status !== 'away');
    // Whoever has most people within 2 tiles (so a knockout's quiet noise reaches someone), and the four nearest them.
    const cheb = (p, q) => Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y));
    let best = null, most = 0;
    for (const a of present) {
        const n = present.filter(o => o !== a && cheb(o.pos, a.pos) <= 2).length;
        if (n > most) { most = n; best = [a, ...present.filter(o => o !== a).sort((p, q) => cheb(p.pos, a.pos) - cheb(q.pos, a.pos)).slice(0, 4)]; }
    }
    if (!best) return null;
    // The one long-pressed (b) is the furthest from Mara, so her drawing doesn't stand over it.
    const [a, ...rest] = best;
    rest.sort((p, q) => cheb(q.pos, a.pos) - cheb(p.pos, a.pos));
    const [b, c, d, e] = rest;
    for (const n of best) know(st, n);
    a.status = 'curious'; a.suspicion = { mara: 2, jun: 1 };
    b.status = 'alerted'; b.alerted = true; b.exposedTo = ['jun']; b.suspicion = { jun: 3 };
    c.status = 'investigating'; c.suspicion = { mara: 1 };
    if (d) { d.status = 'commanded'; }
    const holder = e ?? d ?? c;
    st.carriers.push({ id: 'carrier-test', kind: 'tellerButton', source: holder.id, pos: { ...holder.pos }, countdown: 3, started: { turn: st.turn, phase: 'crew' }, halted: null });
    // Mara right next to the curious one, so a knockout's quiet noise reaches the others.
    for (const dd of AROUND) {
        const p = { x: a.pos.x + dd.x, y: a.pos.y + dd.y };
        if (!free(st, p)) continue;
        st.crew[0].pos = p;
        return { state: st, info: { a: a.id, aAt: a.pos, b: b.id, bAt: b.pos } };
    }
    return null;
})()`;

test('draws the world UI: badges and pips, cones on long-press, a noise ring with ear badges', SMOKE, async ({ page }) => {
    const errors = await boot(page);
    const setup = await restartWith<{ a: string; aAt: Pos; b: string; bAt: Pos }>(page, WORLD_UI_SETUP);
    expect(setup).not.toBeNull();
    await page.locator('.sh-rail .sh-crew').nth(0).click();
    await page.waitForTimeout(700);
    let shown = await play(page);
    expect(shown.badges).toBeGreaterThanOrEqual(4);
    await page.screenshot({ path: 'screenshots/play-badges.png' });

    // Long-press the Alerted NPC: its cones, red (once the camera has stopped moving).
    await expect.poll(async () => { const a = await scene(page); await page.waitForTimeout(150); const b = await scene(page); return a.midX === b.midX && a.midY === b.midY && a.zoom === b.zoom; }).toBe(true);
    const at = await onPage(page, setup!.bAt);
    await page.mouse.move(at.x, at.y - 8);
    // A frame for the game to see where the pointer is before it goes down.
    await page.waitForTimeout(100);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    expect((await play(page)).cones).toBe(1);
    await page.screenshot({ path: 'screenshots/play-cones.png' });
    await tapTile(page, setup!.aAt);
    // That tap dropped the long-pressed cones (only those of observers reacting to the crew member stay) and previewed a
    // knockout of the curious one: its noise ring, and who hears it.
    shown = await play(page);
    expect(shown.coneOf).toBeNull();
    expect(shown.pending).toMatchObject({ type: 'knockout', npc: setup!.a });
    expect(shown.noise).toBeGreaterThan(0);
    expect(shown.hearers).toBeGreaterThan(0);
    await page.screenshot({ path: 'screenshots/play-noise.png' });

    // The colour-blind preset (B): the same overlay in its own palette.
    await page.keyboard.press('b');
    expect((await play(page)).colourBlind).toBe(true);
    await page.screenshot({ path: 'screenshots/play-colour-blind.png' });
    await page.keyboard.press('b');
    expect(errors).toEqual([]);
});

/** Opens the threat ledger (if it isn't) and returns its rows' text. */
async function ledgerRows(page: Page): Promise<string[]> {
    if (!(await page.locator('.sh-ledger').isVisible())) await page.locator('.sh-ledger-btn').click();
    return page.locator('.sh-ledger .sh-row').allInnerTexts();
}

test('the alarm panel: work across actions shown as 2/4, and a dead panel kills the teller\'s button', SMOKE, async ({ page }) => {
    const errors = await boot(page);
    // Mara beside the alarm panel with 2 of its 4 actions of work done; a teller pressing her button (2) on the far side.
    const setup = await restartWith<{ panel: string; teller: string }>(page, `(() => { ${PAGE_HELPERS} ${ALARM_HELPERS}
        const panel = w.objects.find(o => o.kind === 'alarmPanel');
        if (!panel) return null;
        for (const d of [{ x: 0, y: 0 }, ...NEAR]) {
            const p = { x: panel.pos.x + d.x, y: panel.pos.y + d.y }, st = clone(sim.state);
            if (!free(st, p)) continue;
            st.crew[0].pos = p;
            if (!st.crew[0].loadout.items.includes('hackingKit')) st.crew[0].loadout.items.push('hackingKit');
            st.objects[panel.id] = { progress: 2 };
            if (sim.whyNot({ type: 'interact', crew: 'mara', object: panel.id, verb: 'disable' }, st)) continue;
            const teller = npcOf(st, r => /teller/i.test(r));
            if (!teller) return null;
            teller.status = 'alerted'; teller.alerted = true;
            know(st, teller);
            st.carriers.push(carrier(st, 'tellerButton', teller, 2));
            return { state: st, info: { panel: panel.id, teller: teller.id } };
        }
        return null;
    })()`);
    expect(setup).not.toBeNull();
    await page.locator('.sh-rail .sh-crew').nth(0).click();
    await page.waitForTimeout(600);
    const disable = page.locator('.sh-actions button[data-action="interact:disable"]');
    await expect(disable.locator('.sh-prog')).toHaveText('2/4');
    expect((await ledgerRows(page))[0]).toMatch(/2\s*Teller button/);
    // The third action of work: previewed, then done; the panel now shows 3/4.
    await disable.click();
    await expect(page.locator('.sh-confirm')).toContainText('DISABLE PANEL');
    await page.locator('.sh-confirm').click();
    await idle(page);
    await expect(disable.locator('.sh-prog')).toHaveText('3/4');
    // The last: Confirm says it stops the teller's button.
    await disable.click();
    await expect(page.locator('.sh-cnote')).toContainText('stops: Teller button');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'screenshots/play-panel.png' });
    await page.locator('.sh-confirm').click();
    await idle(page);
    const after = await page.evaluate(({ panel }) => ({ panel: (window as any).sim.state.objects[panel], carriers: (window as any).sim.state.carriers.length }), setup!);
    expect(after).toEqual({ panel: { progress: 4, disabled: true }, carriers: 0 });
    expect((await ledgerRows(page)).some(r => /Teller button/.test(r))).toBe(false);
    // Dead already: the grid says so.
    expect((await play(page)).actions.find((a: any) => a.id === 'interact:disable')).toMatchObject({ enabled: false });
    expect(errors).toEqual([]);
});

test('the takeover: GO masks up and gives a third action, a command puts the NPC beside her face down (M2-01)', SMOKE, async ({ page }) => {
    const errors = await boot(page);
    // Mara beside a calm NPC the crew sees, Jun out of the way.
    const setup = await restartWith<{ npc: string }>(page, `(() => { ${PAGE_HELPERS}
        for (const n of sim.state.npcs) {
            if (n.status !== 'calm') continue;
            for (const d of AROUND) {
                const p = { x: n.pos.x + d.x, y: n.pos.y + d.y }, st = clone(sim.state);
                if (!free(st, p)) continue;
                st.crew[0].pos = p;
                know(st, n);
                if (sim.whyNot({ type: 'go', crew: 'mara' }, st)) continue;
                return { state: st, info: { npc: n.id } };
            }
        }
        return null;
    })()`);
    expect(setup).not.toBeNull();
    await page.locator('.sh-rail .sh-crew').nth(0).click();
    await page.waitForTimeout(600);
    await page.locator('.sh-actions button[data-action="go"]').click();
    await expect(page.locator('.sh-confirm')).toContainText('GO');
    await page.locator('.sh-confirm').click();
    await idle(page);
    const after = await page.evaluate(() => (window as any).sim.state);
    expect(after.takeover).toBe(after.turn);
    expect(after.crew.map((c: any) => [c.actionsLeft, c.loadout.masked])).toEqual([[3, true], [3, true]]);
    // The command's rings as the crew sees them, then the command itself.
    const rings = await page.evaluate(() => (window as any).sim.commandRings('mara'));
    expect(rings.targets.find((t: any) => t.npc === setup!.npc)).toMatchObject({ ring: 'command' });
    await page.locator('.sh-actions button[data-action="command"]').click();
    await expect(page.locator('.sh-confirm')).toContainText('COMMAND');
    await page.locator('.sh-confirm').click();
    await idle(page);
    const npc = await page.evaluate(id => (window as any).sim.state.npcs.find((n: any) => n.id === id), setup!.npc);
    const target = rings.targets.find((t: any) => t.npc === setup!.npc);
    if (target.outcome === 'complies') expect(npc).toMatchObject({ status: 'commanded', command: { pips: 2, by: 'mara' } });
    expect(await page.evaluate(() => (window as any).sim.state.bank.loud)).toBe(true);
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'screenshots/play-takeover.png' });
    expect(errors).toEqual([]);
});

test('a carrier counts down in the ledger with the check-ins, then the Alarm: "ALARM: police in N"', SMOKE, async ({ page }) => {
    // Three world phases and a reload on the sandbox's software renderer.
    test.setTimeout(60000);
    const errors = await boot(page);
    // A guard the crew sees, radioing in about Mara (3).
    const setup = await restartWith<{ guard: string; camera?: Pos }>(page, `(() => { ${PAGE_HELPERS} ${ALARM_HELPERS}
        const st = clone(sim.state), guard = npcOf(st, r => /guard|chief/i.test(r));
        if (!guard) return null;
        guard.status = 'alerted'; guard.alerted = true;
        know(st, guard);
        st.carriers.push(carrier(st, 'guardRadio', guard, 3));
        // Every camera known (as if cased: every tile seen, so no cone is clipped to nothing over a hidden room), the
        // CCTV room not scouted: their feed status unknown, so each counts as live.
        st.knowledge.cameras = w.cameras.map(c => c.id).sort();
        const n = w.width * w.height, bits = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        st.knowledge.seen = '/'.repeat(Math.floor(n / 6)) + (n % 6 ? bits[(1 << (n % 6)) - 1] : '');
        return { state: st, info: { guard: guard.id, camera: w.cameras[0] && w.cameras[0].pos } };
    })()`);
    expect(setup).not.toBeNull();
    // The known cameras: a plate each and their cones (the drawer's Cameras overlay is on to begin with).
    const shown = await play(page);
    if (setup!.camera) {
        expect(shown.cameras).toBeGreaterThan(0);
        expect(shown.cameraCones).toBeGreaterThan(0);
        await page.evaluate(p => (window as any).game.scene.getScene('bank').lookAt((p.x + 0.5) * 16, (p.y + 2.5) * 16), setup!.camera);
        await page.waitForTimeout(400);
        await page.screenshot({ path: 'screenshots/play-cameras.png' });
    }
    let rows = await ledgerRows(page);
    expect(rows[0]).toMatch(/3\s*Guard radio/);
    await expect(page.locator('.sh-state')).toContainText('3');
    await endTurn(page);
    await idle(page);
    rows = await ledgerRows(page);
    expect(rows[0]).toMatch(/2\s*Guard radio/);
    // The known guard's next check-in (§8.11) and the patrol car's drive-by sit below it.
    expect(rows.some(r => /Check-in|Radio ringing/.test(r))).toBe(true);
    await page.locator('.sh-ledger .sh-row').first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'screenshots/play-ledger.png' });
    // Two world phases on, it goes off: the banner, and the pill says when the police come.
    await endTurn(page);
    await idle(page);
    await endTurn(page);
    await expect(page.locator('.play-alarm')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.sh-state')).toContainText(/ALARM: police in \d/);
    await page.waitForTimeout(250);
    await page.screenshot({ path: 'screenshots/play-alarm.png' });
    await idle(page);
    expect(await page.evaluate(() => (window as any).sim.state.bank.alarm)).toBe(true);
    rows = await ledgerRows(page);
    expect(rows[0]).toMatch(/Police/);
    expect(errors).toEqual([]);
});

test('answers a downed guard\'s ringing radio', SMOKE, async ({ page }) => {
    const errors = await boot(page);
    // A guard tied up with his radio ringing (the call of the last world phase), Mara beside him.
    const setup = await restartWith<{ guard: string }>(page, `(() => { ${PAGE_HELPERS} ${ALARM_HELPERS}
        const base = clone(sim.state), first = npcOf(base, r => /guard|chief/i.test(r));
        if (!first) return null;
        for (const d of NEAR) {
            const st = clone(base), guard = st.npcs.find(n => n.id === first.id), p = { x: guard.pos.x + d.x, y: guard.pos.y + d.y };
            if (!free(st, p)) continue;
            st.crew[0].pos = p;
            guard.status = 'tied'; guard.intent = { path: [] };
            know(st, guard);
            st.radio.calls[guard.id].ringing = st.turn - 1;
            if (sim.whyNot({ type: 'answerRadio', crew: 'mara', npc: guard.id }, st)) continue;
            return { state: st, info: { guard: guard.id } };
        }
        return null;
    })()`);
    expect(setup).not.toBeNull();
    expect((await ledgerRows(page))[0]).toMatch(/Radio ringing/);
    await page.locator('.sh-ledger-btn').click();
    await page.locator('.sh-rail .sh-crew').nth(0).click();
    await page.waitForTimeout(600);
    await page.locator('.sh-actions button[data-action="answer"]').click();
    await expect(page.locator('.sh-confirm')).toContainText('ANSWER RADIO');
    await page.screenshot({ path: 'screenshots/play-radio.png' });
    await page.locator('.sh-confirm').click();
    await idle(page);
    const radio = await page.evaluate(id => ({ call: (window as any).sim.state.radio.calls[id], answers: (window as any).sim.state.radio.answers }), setup!.guard);
    expect(radio.call.ringing).toBeNull();
    expect(radio.answers).toBe(1);
    expect((await ledgerRows(page)).some(r => /Radio ringing/.test(r))).toBe(false);
    expect((await play(page)).actions.some((a: any) => a.id === 'answer')).toBe(false);
    expect(errors).toEqual([]);
});

test('auto-advance walks a 3-turn route turn by turn and says why it stopped; a tap stops it', SMOKE, async ({ page }) => {
    const errors = await boot(page, 'new', { instant: false });
    const mara = await member(page, 'mara');
    await tapTile(page, mara.pos);
    await page.waitForTimeout(400);
    // A tile two whole turns and a bit away (a turn is two Moves of 5 tiles, 20 half-steps), as far north as there is.
    const target: Pos = await page.evaluate(() => {
        const tiles = (window as any).sim.routeReach('mara') as { pos: Pos; cost: number }[];
        return tiles.filter(t => t.cost > 44 && t.cost <= 56).sort((a, b) => a.pos.y - b.pos.y || a.cost - b.cost)[0]!.pos;
    });
    await page.evaluate(t => (window as any).sim.session.setRoute('mara', (window as any).sim.routePath('mara', t)), target);
    const planned = (await play(page)).auto;
    expect(planned.routes.mara.at(-1)).toEqual(target);
    expect(new Set(planned.legs[0].turns)).toEqual(new Set([1, 2, 3]));
    await expect(page.locator('.sh-go')).toBeEnabled();
    // Frame the whole route: two steps out, centred between Mara and the tile.
    await page.evaluate(() => {
        const bank = (window as any).game.scene.getScene('bank');
        bank.zoomStep(-1);
        bank.zoomStep(-1);
    });
    await page.waitForTimeout(400);
    await page.evaluate(({ a, b }) => (window as any).game.scene.getScene('bank').lookAt((a.x + b.x + 1) * 8, (a.y + b.y + 1) * 8), { a: mara.pos, b: target });
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'screenshots/play-route.png' });

    await page.locator('.sh-go').click();
    expect((await play(page)).auto.running).toBe(true);
    await expect.poll(async () => (await play(page)).auto.running, { timeout: 60000 }).toBe(false);
    const { stop } = (await play(page)).auto, now = await sim(page);
    expect(stop).not.toBeNull();
    if (stop.kind === 'arrived') {
        // Walked: three turns, two Moves in each, ending on the tile.
        expect((await member(page, 'mara')).pos).toEqual(target);
        expect(now.turn).toBe(3);
        await expect(page.locator('.sh-autostatus')).toHaveText('Route walked');
    } else {
        // Interrupted by something the crew saw: the line says what, and the rest of the route is kept.
        expect(now.turn).toBeLessThanOrEqual(3);
        await expect(page.locator('.sh-autostatus')).toContainText(/^(Stopped|Done): /);
    }
    await page.screenshot({ path: 'screenshots/play-route-stopped.png' });

    // Any tap stops a run: a Wait for… started from the menu, then a tap on the map.
    await idle(page);
    const options = page.locator('.sh-waitfor');
    if (await options.isEnabled()) {
        await options.click();
        await expect(page.locator('.sh-waitmenu')).toBeVisible();
        await page.locator('.sh-waititem').first().click();
        await page.mouse.click(400, 200);
        await expect.poll(async () => (await play(page)).auto.running).toBe(false);
        await expect(page.locator('.sh-autostatus')).toContainText(/^(Stopped|Done)/);
    }
    expect(errors).toEqual([]);
});

test.describe('on a phone', () => {
    test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

    test('keeps the HUD and the camera tools apart', { tag: ['@smoke', '@layout'] }, async ({ page }) => {
        const errors = await boot(page);
        await page.screenshot({ path: 'screenshots/play-phone.png' });
        const boxes = await page.evaluate(() => [
            '.sh-top', '.sh-endturn', '.sh-rail', '.sh-ltools', '.sh-actions', '.sh-confirm', '.sh-undo', '.fullscreen-button', '.play-speed', '.sh-auto'
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

test('the safe floor: tints as the sim judges them, a drawn path\'s eye, who and why on a long-press', SMOKE, async ({ page }) => {
    test.setTimeout(60000);
    const errors = await boot(page);
    const setup = await restartWith<{ npc: string; npcAt: Pos; at: Pos; kinds: string[] }>(page, SAFE_FLOOR_SETUP);
    expect(setup).not.toBeNull();
    await page.locator('.sh-rail .sh-crew').nth(0).click();
    // The Move band at once, the Dash band a frame later.
    await expect.poll(async () => (await play(page)).floorDash).toBe(true);
    await expect.poll(async () => { const a = await scene(page); await page.waitForTimeout(150); const b = await scene(page); return a.midX === b.midX && a.midY === b.midY && a.zoom === b.zoom; }).toBe(true);
    const shown = await play(page);
    const truth = await page.evaluate(() => (window as any).sim.safeFloor('mara').tiles.filter((t: any) => t.band !== 'stay')
        .map((t: any) => ({ pos: t.pos, band: t.band, kind: t.tint.kind, hatched: t.tint.hatched, path: t.path })));
    // Every tile drawn is the sim's, with its tint: green, amber, red, hatched as the sim says.
    const key = (p: Pos) => `${p.x},${p.y}`;
    const drawn = new Map<string, any>(shown.safeFloor.map((t: any) => [key(t.pos), t]));
    expect(drawn.size).toBe(truth.length);
    for (const t of truth) expect(drawn.get(key(t.pos)), key(t.pos)).toMatchObject({ band: t.band, kind: t.kind, hatched: t.hatched });
    const of = (test: (t: any) => boolean) => truth.find((t: any) => t.band === 'move' && test(t));
    const green = of(t => t.kind === 'safe'), red = of(t => t.kind === 'red' || t.kind === 'camera');
    expect(green).toBeDefined();
    expect(red).toBeDefined();
    for (const k of ['amber', 'hatched']) {
        const t = of(x => (k === 'hatched' ? x.hatched : x.kind === 'amber' && !x.hatched));
        if (t) expect(drawn.get(key(t.pos))).toMatchObject({ kind: t.kind, hatched: t.hatched });
    }
    await page.screenshot({ path: 'screenshots/play-safefloor.png' });
    // The colour-blind preset (B): the same floor in its own palette and patterns.
    await page.keyboard.press('b');
    await page.waitForTimeout(100);
    await page.screenshot({ path: 'screenshots/play-safefloor-cb.png' });
    await page.keyboard.press('b');

    // Draw a path to a red tile: its steps tinted, the eye on the first unsafe step.
    const target = truth.filter((t: any) => t.band === 'move' && (t.kind === 'red' || t.kind === 'camera'))
        .sort((a: any, b: any) => b.path.length - a.path.length)[0];
    const from = await onPage(page, setup!.at);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (const step of target.path as Pos[]) {
        const p = await onPage(page, step);
        await page.mouse.move(p.x, p.y);
    }
    const dragging = await play(page);
    const safety = await page.evaluate(([path]) => (window as any).sim.pathSafety('mara', path), [target.path]);
    expect(safety.ok).toBe(true);
    expect(dragging.pathSafety.eyeAt).toBe(safety.firstUnsafe);
    expect(dragging.pathSafety.end).toMatchObject({ kind: safety.end.tint.kind, hatched: safety.end.tint.hatched });
    expect(dragging.floorDim).toBe(true);
    await page.mouse.up();
    const previewed = await play(page);
    expect(previewed.pending).toMatchObject({ type: 'move', path: target.path });
    expect(previewed.pathSafety.eyeAt).toBe(safety.firstUnsafe);
    expect(previewed.pathSafety.steps[safety.firstUnsafe].kind).toMatch(/red|camera|amber|trespass/);
    await page.screenshot({ path: 'screenshots/play-path-eye.png' });

    // Long-press the eye's tile: who would notice Mara there, and why; the same lines the sim gives.
    await page.keyboard.press('Escape');
    const eyeTile = target.path[safety.firstUnsafe] as Pos;
    const at = await onPage(page, eyeTile);
    await page.mouse.move(at.x, at.y + 5);
    await page.waitForTimeout(100);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    const why = (await play(page)).explain;
    const lines = await page.evaluate(([tile]) => (window as any).sim.explain('mara', tile), [eyeTile]);
    expect(lines.length).toBeGreaterThan(0);
    expect(why.lines.map((l: any) => l.text)).toEqual(lines.map((l: any) => (l.phase === 'next' ? `Next phase: ${l.text}` : l.text)));
    await expect(page.locator('.play-explain')).toBeVisible();
    await expect(page.locator('.play-explain-row').first()).toContainText(lines[0].text);
    await page.screenshot({ path: 'screenshots/play-explain.png' });
    // A tap puts it away.
    await tapTile(page, green.pos);
    await expect(page.locator('.play-explain')).toHaveCount(0);
    expect(errors).toEqual([]);
});


test('holding a hatched tile marks where someone unknown could watch it from', async ({ page }) => {
    const errors = await boot(page);
    expect(await restartWith(page, HATCHED_SETUP)).not.toBeNull();
    await page.locator('.sh-rail .sh-crew').nth(1).click();
    await expect.poll(async () => (await play(page)).floorDash).toBe(true);
    await expect.poll(async () => { const a = await scene(page); await page.waitForTimeout(150); const b = await scene(page); return a.midX === b.midX && a.midY === b.midY && a.zoom === b.zoom; }).toBe(true);
    const tile = await page.evaluate(() => {
        const floor = (window as any).sim.safeFloor('jun').tiles.filter((t: any) => t.band === 'move' && t.tint.kind === 'unknownRisk' && t.knowledge === 'unknownRisk');
        // Clear of Jun's drawing, where a press would start a path.
        return floor.filter((t: any) => t.path.length >= 3).sort((a: any, b: any) => a.path.length - b.path.length)[0]?.pos as Pos | undefined;
    });
    expect(tile).toBeDefined();
    const at = await onPage(page, tile!);
    await page.mouse.move(at.x, at.y + 5);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    const why = (await play(page)).explain;
    const lines = await page.evaluate(([t]) => (window as any).sim.explain('jun', t), [tile!]);
    const watchers = lines.find((l: any) => l.to.x === tile!.x && l.to.y === tile!.y && l.watchers)?.watchers;
    expect(watchers?.length).toBeGreaterThan(0);
    expect(why.lines.flatMap((l: any) => l.watchers ?? [])).toEqual(lines.flatMap((l: any) => l.watchers ?? []));
    await page.screenshot({ path: 'screenshots/play-explain-watchers.png' });
    await tapTile(page, (await member(page, 'jun')).pos);
    expect((await play(page)).explain).toBeNull();
    expect(errors).toEqual([]);
});

interface MoveCheck { tile: { now: unknown; next: unknown; tint: { kind: string } }; now: unknown; cut: boolean; at: Pos }


test('the M1 heist: walk in, wait, slip through behind the cleaner, knock out the guard in the alarm closet, kill the panel', SMOKE, async ({ page }) => {
    // 72 turns with every world phase's playback skipped: about 30 s on the sandbox's software renderer.
    test.setTimeout(120000);
    const errors = await boot(page, 'new', { instant: false });
    expect(await page.evaluate(() => (window as any).generated.seed)).toEqual({ layout: 31, population: 2 });
    // Playback instantly (the speed button: 1×, 2×, skip).
    for (let i = 0; i < 2; i++) await page.locator('.play-speed').click();
    await expect(page.locator('.play-speed')).toHaveText('⏭');

    /** Moves `crew` to (x, y) along the safe floor's own path, and says what the floor promised and what happened. */
    const move = (crew: string, x: number, y: number): Promise<MoveCheck> => page.evaluate(([crew, x, y]) => {
        const sim = (window as any).sim;
        const tile = sim.safeFloor(crew, ['move']).tiles.find((t: any) => t.band === 'move' && t.pos.x === x && t.pos.y === y);
        if (!tile) throw new Error(`${crew} can't move to ${x},${y} on turn ${sim.state.turn}`);
        const before = sim.state;
        const result = sim.commit({ type: 'move', crew, path: tile.path });
        return {
            tile: { now: tile.now, next: tile.next, tint: tile.tint }, now: sim.effect(result.events, crew, before),
            cut: result.events.some((e: any) => e.type === 'moveCut'), at: sim.state.crew.find((c: any) => c.id === crew).pos
        };
    }, [crew, x, y] as const);
    /** Ends the turn: what the world phase did to `crew` (the last mover), and whether anything raised the stakes. */
    const endTurn = (crew: string | null) => page.evaluate(crew => {
        const sim = (window as any).sim, before = sim.state, result = sim.endTurn(), s = sim.state;
        return {
            next: crew ? sim.effect(result.events, crew, before) : null, turn: s.turn,
            quiet: !s.bank.alarm && !s.bank.loud && !s.carriers.length && s.npcs.every((n: any) => n.status !== 'alerted' && n.status !== 'hostile'),
            heard: result.events.filter((e: any) => ['suspicionRaised', 'exposed', 'challenged', 'cameraSaw', 'alarmAttempt'].includes(e.type))
        };
    }, crew);

    /** Plays one turn's moves and ends it, checking each move's tint against what it did. */
    async function playTurn(spec: string): Promise<void> {
        const moves = spec.split(' ').filter(Boolean).map(m => { const [crew, at] = m.split(':'); const [x, y] = at!.split(',').map(Number); return { crew: crew!, x: x!, y: y! }; });
        let last: MoveCheck | null = null;
        for (const m of moves) {
            last = await move(m.crew, m.x, m.y);
            // The whole path walked (nothing unseen cut it short), and the move itself did what the floor's solid part said.
            expect(last.cut).toBe(false);
            expect(last.at).toEqual({ x: m.x, y: m.y });
            expect(last.now).toEqual(last.tile.now);
            // The run keeps to tiles the floor shows as safe: green, or green as far as the crew knows.
            expect(['safe', 'unknownRisk', 'grey']).toContain(last.tile.tint.kind);
        }
        const lastCrew = moves.at(-1)?.crew ?? null;
        const ended = await endTurn(lastCrew);
        expect(ended.quiet).toBe(true);
        expect(ended.heard).toEqual([]);
        if (last && lastCrew) {
            // The turn's last move was followed only by End turn: the hatched part, and so the tint itself, came true.
            if (last.tile.next !== null) expect(ended.next).toEqual(last.tile.next);
            const happened = [effectKind(last.now as Effect), ...(ended.next ? [effectKind(ended.next as Effect)] : [])].sort((a, b) => TINT_RANK[b] - TINT_RANK[a])[0];
            const kind = last.tile.tint.kind === 'unknownRisk' || last.tile.tint.kind === 'grey' ? 'safe' : last.tile.tint.kind;
            expect(happened).toBe(kind);
        }
    }

    // Mara and Jun walk in from the van to the lobby.
    for (const spec of M1_OPENING) await playTurn(spec);
    // They watch the floor and wait for what they know of the bank's routine ("Wait for…"), up to turn 10.
    const stops = await page.evaluate(() => {
        const sim = (window as any).sim, stops: { kind: string; text: string }[] = [];
        while (sim.state.turn < 10) {
            const option = sim.waitOptions().filter((o: any) => o.target.kind === 'turn' && o.target.turn <= 10).at(-1);
            if (!option) sim.endTurn();
            else stops.push(sim.waitFor(option.target));
        }
        return stops;
    });
    expect(stops.some(s => s.kind === 'target')).toBe(true);
    for (const s of stops) expect(['target', 'schedule', 'revealed']).toContain(s.kind);
    expect(await page.evaluate(() => (window as any).sim.state.turn)).toBe(10);

    for (const [i, spec] of M1_INSIDE.entries()) {
        await playTurn(spec);
        // Turn 11: the cleaner went through the staff door, and Jun stands in the doorway, holding it open.
        if (i === 1) expect(await page.evaluate(() => (window as any).sim.state.doors['door-13'].status)).toBe('open');
    }
    // Turn 70: the guard's closing sweep has him just inside the alarm closet, its door open. Jun steps up behind him and
    // knocks him out; standing in the doorway, he keeps it from swinging shut.
    const at70 = await page.evaluate(() => {
        const s = (window as any).sim.state;
        return { turn: s.turn, guard: s.npcs.find((n: any) => n.id === 'lobbyGuard-8').pos, door: s.doors['door-3'].status };
    });
    expect(at70).toEqual({ turn: 70, guard: { x: 45, y: 10 }, door: 'open' });
    // The one tile off the safe floor: red only for the coming world phase (the guard would turn and see him), which the
    // knockout takes away; the move itself is unseen.
    const step = await move('jun', 45, 11);
    expect(step.cut).toBe(false);
    expect(step.at).toEqual({ x: 45, y: 11 });
    expect(step.now).toEqual(step.tile.now);
    expect(step.tile.tint).toMatchObject({ kind: 'red', hatched: true });
    /** Commits `cmd` after previewing it: the preview must be the outcome (§2.2), events and undoability both. */
    const previewed = (cmd: object) => page.evaluate(cmd => {
        const sim = (window as any).sim, shown = sim.preview(cmd), done = sim.commit(cmd);
        return { preview: { events: shown.events, undoable: shown.undoable }, result: { events: done.events, undoable: done.undoable } };
    }, cmd);
    const ko = await previewed({ type: 'knockout', crew: 'jun', npc: 'lobbyGuard-8' });
    expect(ko.result).toEqual(ko.preview);
    expect(ko.result.events.map((e: any) => e.type)).toContain('knockedOut');
    const afterKo = await endTurn(null);
    expect(afterKo.quiet).toBe(true);
    expect(afterKo.heard).toEqual([]);
    // In, past the body, to the panel; then two actions of hacking with Steady Hands kill it.
    await playTurn('jun:45,6 jun:45,5');
    const panelId = await page.evaluate(() => (window as any).sim.world.objects.find((o: any) => o.kind === 'alarmPanel').id as string);
    for (let i = 0; i < 2; i++) {
        const hack = await previewed({ type: 'interact', crew: 'jun', object: panelId, verb: 'disable' });
        expect(hack.result).toEqual(hack.preview);
    }
    expect(await page.evaluate(id => (window as any).sim.state.objects[id], panelId)).toEqual({ progress: 4, disabled: true });
    // The world phase after: still Quiet, and the HUD says so.
    const last = await endTurn(null);
    expect(last.quiet).toBe(true);
    expect(last.heard).toEqual([]);
    await idle(page);
    const end = await page.evaluate(() => {
        const s = (window as any).sim.state;
        return { turn: s.turn, alarm: s.bank.alarm, loud: s.bank.loud, carriers: s.carriers.length, guard: s.npcs.find((n: any) => n.id === 'lobbyGuard-8').status };
    });
    expect(end).toEqual({ turn: 73, alarm: false, loud: false, carriers: 0, guard: 'unconscious' });
    await expect(page.locator('.sh-state')).toHaveClass(/quiet/);
    // Jun at the dead panel, the guard out cold in the closet's doorway.
    await page.evaluate(() => (window as any).game.scene.getScene('bank').lookAt(45 * 16 + 8, 8 * 16));
    await page.waitForTimeout(600);
    await page.screenshot({ path: 'screenshots/play-m1.png' });
    expect(errors).toEqual([]);
});
