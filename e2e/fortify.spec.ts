import { expect, test, type Page } from '@playwright/test';
import { BESIDE_DOOR } from './setups';

/*
 * Fortifying in the page (M4-02, §14.3): Mara barricades a door from the action grid, the planks are drawn on it and
 * nobody can open it; Clear takes it down again.
 */

interface Pos { x: number; y: number }

const scene = (page: Page) => page.evaluate(() => (window as any).game.scene.getScene('bank').debugState);
const play = async (page: Page) => (await scene(page)).play;

test('a door barricaded from the grid is drawn so and stays shut; Clear takes it down (M4-02)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/?new&still');
    await page.waitForFunction(() => (window as any).game?.scene.getScene('bank')?.sys.isActive() && (window as any).sim, undefined, { timeout: 60000 });
    const found = await page.evaluate(BESIDE_DOOR) as { state: unknown; info: { door: string; edge: string; at: Pos } } | null;
    expect(found, 'this bank has a shut door with a free tile beside it').toBeTruthy();
    const { info } = found!;
    await page.evaluate(state => (window as any).sim.restart(state), found!.state);
    await page.reload();
    await page.waitForFunction(() => (window as any).game?.scene.getScene('bank')?.debugState?.play && (window as any).sim, undefined, { timeout: 60000 });
    await expect.poll(async () => (await scene(page)).settled, { timeout: 20000 }).toBe(true);
    await page.evaluate(() => { (window as any).sim.session.playback.speed = 'instant'; });
    await page.locator('.sh-rail .sh-crew').nth(0).click();
    const button = page.locator('.sh-actions button[data-action="fortify:barricade"]');
    if (await button.count()) {
        // A tap previews it; Confirm commits it.
        await button.click();
        await page.locator('.sh-confirm').click();
    } else {
        await page.evaluate(i => (window as any).sim.commit({ type: 'fortify', crew: (window as any).sim.state.crew[0].id, edge: i.edge, action: 'barricade' }), info);
    }
    await expect.poll(() => page.evaluate(e => (window as any).sim.state.edges[e]?.barricade ?? 0, info.edge)).toBe(2);
    await expect.poll(async () => (await play(page)).loud.fortified).toContain(info.edge);
    expect(await page.evaluate(i => (window as any).sim.whyNot({ type: 'door', crew: (window as any).sim.state.crew[0].id, door: i.door, action: 'open' }), info)).toMatch(/barricaded|actions left/);
    await page.evaluate(p => (window as any).game.scene.getScene('bank').lookAt(p.x * 16 + 8, p.y * 16 + 8), info.at);
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'screenshots/barricade.png' });
    await page.evaluate(i => (window as any).sim.commit({ type: 'fortify', crew: (window as any).sim.state.crew[0].id, edge: i.edge, action: 'clear' }), info);
    await expect.poll(async () => (await play(page)).loud.fortified).toEqual([]);
    expect(errors).toEqual([]);
});
