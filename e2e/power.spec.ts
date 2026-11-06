import { expect, test, type Page } from '@playwright/test';
import { AT_BREAKER } from './setups';

/*
 * The power grid in the page (M4-03, §8.13, §14.6): Mara cuts the power at the breaker from the action grid; the bank
 * is drawn dark (the floor's shade, the tints, people relit without the lamps) quickly, and Restore power brings it back.
 */

interface Pos { x: number; y: number }

const scene = (page: Page) => page.evaluate(() => (window as any).game.scene.getScene('bank').debugState);

/** Looks at the lobby from the street, above Jun at the van. */
const lookIn = (page: Page) => page.evaluate(() => {
    const p = (window as any).sim.state.crew[1].pos;
    (window as any).game.scene.getScene('bank').lookAt(p.x * 16 + 8, p.y * 16 - 120);
});

test('cutting the power from the grid darkens the bank fast; Restore power brings the light back (M4-03)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/?new&still');
    await page.waitForFunction(() => (window as any).game?.scene.getScene('bank')?.sys.isActive() && (window as any).sim, undefined, { timeout: 60000 });
    const found = await page.evaluate(AT_BREAKER) as { state: unknown; info: { object: string; at: Pos } } | null;
    expect(found, 'this bank has a breaker panel with a free tile beside it').toBeTruthy();
    await page.evaluate(state => (window as any).sim.restart(state), found!.state);
    await page.reload();
    await page.waitForFunction(() => (window as any).game?.scene.getScene('bank')?.debugState?.play && (window as any).sim, undefined, { timeout: 60000 });
    await expect.poll(async () => (await scene(page)).settled, { timeout: 20000 }).toBe(true);
    await page.evaluate(() => { (window as any).sim.session.playback.speed = 'instant'; });
    expect((await scene(page)).powerOut).toBe(false);
    await lookIn(page);
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'screenshots/power-on.png' });
    const lit = (await scene(page)).people.map((p: { light: number }) => p.light);

    await page.locator('.sh-rail .sh-crew').nth(0).click();
    await page.locator('.sh-actions button[data-action="interact:cut"]').click();
    await page.locator('.sh-confirm').click();
    await expect.poll(() => page.evaluate(() => (window as any).sim.state.power.breaker)).toBe(false);
    await expect.poll(async () => (await scene(page)).powerOut).toBe(true);
    const state = await scene(page);
    // Drawing it is quick: no rebake of the bank.
    expect(state.timings['power cut']).toBeLessThan(500);
    // Someone indoors under a lamp is darker now.
    const dark = state.people.map((p: { light: number }) => p.light);
    expect(dark.some((d: number, i: number) => d < lit[i]! - 5)).toBe(true);
    await lookIn(page);
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'screenshots/power-out.png' });

    // Mara still has an action: she turns it back on.
    await page.evaluate(i => (window as any).sim.commit({ type: 'interact', crew: (window as any).sim.state.crew[0].id, object: i.object, verb: 'reset' }), found!.info);
    await expect.poll(async () => (await scene(page)).powerOut).toBe(false);
    expect(errors).toEqual([]);
});
