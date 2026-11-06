import { expect, test, type Page } from '@playwright/test';
import { SNIPER_SETUP } from './setups';

/*
 * Height, the sniper nest and off-map routes in the page (M4-05, §13.6, §14.7): a police sniper's laser drawn on Mara
 * wherever the sniper is, and Jun in transit on the roof route with the rail's transit badge, hidden from the map.
 */

interface Pos { x: number; y: number }

const scene = (page: Page) => page.evaluate(() => (window as any).game.scene.getScene('bank').debugState);
const play = async (page: Page) => (await scene(page)).play;

test('a sniper\'s laser is drawn on its target; a crew member in transit is off the map with a badge on the rail (M4-05)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/?new&still');
    await page.waitForFunction(() => (window as any).game?.scene.getScene('bank')?.sys.isActive() && (window as any).sim, undefined, { timeout: 60000 });
    const found = await page.evaluate(SNIPER_SETUP) as { state: unknown; info: { at: Pos; post: Pos; crew: string; target: string } } | null;
    expect(found, 'this bank has a route and room for a sniper').toBeTruthy();
    await page.evaluate(state => (window as any).sim.restart(state), found!.state);
    await page.reload();
    await page.waitForFunction(() => (window as any).game?.scene.getScene('bank')?.debugState?.play && (window as any).sim, undefined, { timeout: 60000 });
    await expect.poll(async () => (await scene(page)).settled, { timeout: 20000 }).toBe(true);
    await expect.poll(async () => (await play(page)).loud.lasers).toEqual([{ from: found!.info.post, to: found!.info.at, target: found!.info.target }]);
    const card = page.locator(`.sh-rail .sh-crew[data-crew="${found!.info.crew}"]`);
    await expect(card.locator('.sh-badge.transit')).toBeVisible();
    await expect(card).toHaveAttribute('aria-label', /in transit, out in 2/);
    await page.evaluate(p => (window as any).game.scene.getScene('bank').lookAt(p.x * 16 + 8, p.y * 16 + 8), found!.info.at);
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'screenshots/sniper.png' });
    expect(errors).toEqual([]);
});
