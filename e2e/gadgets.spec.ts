import { expect, test, type Page } from '@playwright/test';
import { GADGETS_SETUP, NOISEMAKER_SETUP } from './setups';

/*
 * Distractions and gadgets in the page (M4-06, §8.13, §11.11): Mara's Noisemaker previewed from the grid (its ring,
 * every tile it could land on), thrown by the guard so he goes to look; an ammo bag and a running jammer drawn on the
 * floor, and Refill from the bag.
 */

interface Pos { x: number; y: number }

const scene = (page: Page) => page.evaluate(() => (window as any).game.scene.getScene('bank').debugState);
const play = async (page: Page) => (await scene(page)).play;

async function start(page: Page, script: string): Promise<any> {
    await page.goto('/?new&still');
    await page.waitForFunction(() => (window as any).game?.scene.getScene('bank')?.sys.isActive() && (window as any).sim, undefined, { timeout: 60000 });
    const found = await page.evaluate(script) as { state: unknown; info: any } | null;
    expect(found, 'this bank has the place for it').toBeTruthy();
    await page.evaluate(state => (window as any).sim.restart(state), found!.state);
    await page.reload();
    await page.waitForFunction(() => (window as any).game?.scene.getScene('bank')?.debugState?.play && (window as any).sim, undefined, { timeout: 60000 });
    await expect.poll(async () => (await scene(page)).settled, { timeout: 20000 }).toBe(true);
    await page.evaluate(() => { (window as any).sim.session.playback.speed = 'instant'; });
    await page.locator('.sh-rail .sh-crew').nth(0).click();
    return found!.info;
}

const lookAt = (page: Page, p: Pos) => page.evaluate(q => (window as any).game.scene.getScene('bank').lookAt(q.x * 16 + 8, q.y * 16 + 8), p);

test('a noisemaker previewed from the grid shows its ring and where it can land; thrown by a guard, he goes to look (M4-06)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    const info = await start(page, NOISEMAKER_SETUP) as { guard: string; at: Pos };
    const button = page.locator('.sh-actions button[data-action="noisemaker"]');
    await expect(button).toHaveAttribute('aria-label', 'Noisemaker (3)');
    await button.click();
    await expect.poll(async () => (await play(page)).pending?.type).toBe('throwNoisemaker');
    const shown = await play(page);
    expect(shown.noise).toBeGreaterThan(0);
    expect(shown.throwRange.length).toBeGreaterThan(0);
    await lookAt(page, info.at);
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'screenshots/noisemaker.png' });
    // Thrown two tiles from the guard, where he hears it: he is sent to look.
    const to = await page.evaluate(i => {
        const sim = (window as any).sim, g = sim.state.npcs.find((n: any) => n.id === i.guard).pos;
        for (const d of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 1], [-2, 1], [1, 2], [1, -2]]) {
            const p = { x: g.x + d[0]!, y: g.y + d[1]! };
            if (!sim.whyNot({ type: 'throwNoisemaker', crew: 'mara', to: p })) return p;
        }
        return null;
    }, info);
    expect(to, 'a tile by the guard Mara can throw to').toBeTruthy();
    await page.evaluate(p => (window as any).sim.commit({ type: 'throwNoisemaker', crew: 'mara', to: p }), to);
    await expect.poll(() => page.evaluate(i => (window as any).sim.state.npcs.find((n: any) => n.id === i.guard).goal.kind, info)).toBe('inspect');
    expect(await page.evaluate(() => (window as any).sim.state.crew[0].arms.throwables.noisemaker)).toBe(2);
    expect(errors).toEqual([]);
});

test('an ammo bag and a running jammer are drawn on the floor; Refill tops up from the bag (M4-06)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    const info = await start(page, GADGETS_SETUP) as { at: Pos; bag: Pos };
    await expect.poll(async () => (await play(page)).loud.gadgets.map((g: { kind: string }) => g.kind).sort()).toEqual(['ammoBag', 'jammer']);
    await lookAt(page, info.at);
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'screenshots/gadgets.png' });
    const refill = page.locator('.sh-actions button[data-action="refill"]');
    await expect(refill).toHaveAttribute('aria-label', 'Refill (3)');
    await refill.click();
    await page.locator('.sh-confirm').click();
    await expect.poll(() => page.evaluate(() => (window as any).sim.state.crew[0].arms.guns.assaultRifle.spare)).toBe(3);
    await expect.poll(async () => (await play(page)).loud.gadgets.find((g: { kind: string }) => g.kind === 'ammoBag')?.uses).toBe(2);
    expect(errors).toEqual([]);
});
