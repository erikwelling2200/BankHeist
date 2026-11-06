import { expect, test, type Page } from '@playwright/test';
import { BESIDE_WALL } from './setups';

/*
 * M4-01 in the page: a breach charge previewed beside a wall (the loud board's charge with its fuse), set, and gone off
 * in the world phase: the gap drawn in the wall and walked through; a shaped charge's debris. Each opens a scripted
 * bank (e2e/setups.ts) through `window.sim.restart`.
 */

interface Pos { x: number; y: number }

const scene = (page: Page) => page.evaluate(() => (window as any).game.scene.getScene('bank').debugState);
const idle = (page: Page) => expect.poll(async () => (await scene(page)).play.playing, { timeout: 15000 }).toBe(false);
const lookAt = (page: Page, p: Pos) => page.evaluate(q => (window as any).game.scene.getScene('bank').lookAt(q.x * 16 + 8, q.y * 16 + 8), p);

async function open<T>(page: Page, script: string): Promise<{ info: T; errors: string[] }> {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('/?new&still');
    await page.waitForFunction(() => (window as any).game?.scene.getScene('bank')?.sys.isActive() && (window as any).sim, undefined, { timeout: 60000 });
    const found = await page.evaluate(script) as { state: unknown; info: T } | null;
    expect(found, 'this bank has a place for the setup').toBeTruthy();
    await page.evaluate(state => (window as any).sim.restart(state), found!.state);
    await page.reload();
    await page.waitForFunction(() => (window as any).game?.scene.getScene('bank')?.debugState?.play && (window as any).sim, undefined, { timeout: 60000 });
    await expect.poll(async () => (await scene(page)).settled, { timeout: 20000 }).toBe(true);
    await page.evaluate(() => { (window as any).sim.session.playback.speed = 'instant'; });
    return { info: found!.info, errors };
}

test('charges: a breach charge previewed, set and gone off, the gap walked through (M4-01)', async ({ page }) => {
    const { info, errors } = await open<{ edge: string; item: string; at: Pos; far: Pos }>(page, BESIDE_WALL('soft'));
    await page.locator('.sh-rail .sh-crew').nth(0).click();
    await page.locator(`.sh-actions button[data-action="charge:${info.item}"]`).click();
    await expect.poll(async () => (await scene(page)).play.boards?.charges?.length ?? 0).toBe(1);
    expect((await scene(page)).play.boards.charges[0]).toMatchObject({ kind: 'breachCharge', fuse: 1, preview: true });
    await lookAt(page, info.at);
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'screenshots/charge-preview.png' });
    await page.evaluate(i => {
        const sim = (window as any).sim;
        sim.commit({ type: 'placeCharge', crew: 'mara', item: i.item, edge: i.edge });
        sim.commit({ type: 'endTurn' });
    }, info);
    await idle(page);
    const state = await page.evaluate(() => (window as any).sim.state);
    expect(state.edges[info.edge]).toMatchObject({ gap: true, blocksMove: false });
    expect(state.bank.loud).toBe(true);
    // Through the gap.
    await page.evaluate(i => (window as any).sim.commit({ type: 'move', crew: 'mara', path: [i.far] }), info);
    await idle(page);
    expect(await page.evaluate(() => (window as any).sim.state.crew[0].pos)).toEqual(info.far);
    await lookAt(page, { x: info.at.x, y: Math.max(info.at.y, info.far.y) + 3 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: 'screenshots/wall-gap.png' });
    expect(errors).toEqual([]);
});

test('charges: a shaped charge through a reinforced wall leaves debris (M4-01)', async ({ page }) => {
    const { info, errors } = await open<{ edge: string; item: string; at: Pos; far: Pos }>(page, BESIDE_WALL('reinforced'));
    await page.evaluate(i => {
        const sim = (window as any).sim;
        sim.commit({ type: 'placeCharge', crew: 'mara', item: i.item, edge: i.edge });
        sim.commit({ type: 'endTurn' });
    }, info);
    await idle(page);
    const state = await page.evaluate(() => (window as any).sim.state);
    expect(state.edges[info.edge]).toMatchObject({ gap: true });
    expect(state.debris.length).toBeLessThanOrEqual(1);
    await lookAt(page, { x: info.at.x, y: Math.max(info.at.y, info.far.y) + 3 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: 'screenshots/wall-debris.png' });
    expect(errors).toEqual([]);
});
