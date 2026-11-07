import { expect, test, type Page } from '@playwright/test';

/*
 * The campaign (M6-01, §19.2, §19.3): `?campaign` starts one and shows the day, the Squeeze and its timeline; laying low
 * spends a day; a heist planned from it spends its day as it starts, and its New heist comes back to the campaign.
 */

const scene = (page: Page) => page.evaluate(() => (window as any).game.scene.getScene('bank').debugState);
const campaign = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('bankheist:campaign') ?? 'null')?.campaign);

test('a campaign: days, the Squeeze, and a heist that spends its day (M6-01)', async ({ page }) => {
    test.setTimeout(180000);
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/?campaign&still');
    await page.locator('.cp-start').click();
    await expect(page.locator('.cp-title')).toHaveText('Day 1');
    await expect(page.locator('.cp-num')).toHaveText('0');
    // The whole timeline: seven complications and the Raid, on the days §19.2 projects.
    await expect(page.locator('.cp-step')).toHaveCount(8);
    await expect(page.locator('.cp-step .cp-day')).toHaveText(['day 4', 'day 8', 'day 11', 'day 13', 'day 15', 'day 17', 'day 18', 'day 19']);

    await page.locator('.cp-laylow').click();
    await expect(page.locator('.cp-title')).toHaveText('Day 2');
    await expect(page.locator('.cp-num')).toHaveText('2');

    // A heist from the campaign: Mara alone at the wheel, driven off at once.
    await page.locator('.cp-plan').click();
    await page.waitForFunction(() => (window as any).planner, undefined, { timeout: 60000 });
    expect(new URL(page.url()).searchParams.has('campaign')).toBe(true);
    for (const id of ['jun', 'dex', 'sol']) {
        await page.locator(`.pl-card[data-crew="${id}"]`).click();
        await page.locator('.pl-sheet .pl-toggle').click();
        await page.locator('.pl-sheet .pl-done').click();
    }
    await page.locator('.pl-card[data-crew="mara"]').click();
    await page.locator('.pl-sheet [data-slot="start"]').selectOption('van:in');
    await page.locator('.pl-sheet .pl-done').click();
    await page.locator('.pl-start').click();
    await page.waitForFunction(() => (window as any).game?.scene?.getScene('bank')?.debugState?.play && (window as any).sim, undefined, { timeout: 60000 });
    // The day was spent as the heist started; the address no longer names the campaign (a reload resumes the heist).
    expect(await campaign(page)).toMatchObject({ day: 3, squeeze: 4, visit: { kind: 'heist', day: 2 } });
    expect(new URL(page.url()).searchParams.has('campaign')).toBe(false);
    // What the heist sees is the campaign's, dated its day; nothing goes to the device's own intel.
    expect(Object.values((await campaign(page)).intel).flat()).toMatchObject([{ day: 2 }]);
    expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('bankheist:intel:')))).toEqual([]);

    for (let i = 0; i < 20 && !(await page.evaluate(() => !!(window as any).sim.state.outcome)); i++) {
        await page.evaluate(() => {
            const sim = (window as any).sim;
            if (sim.state.crew[0].actionsLeft === 0) sim.endTurn();
            else sim.commit({ type: 'drive', crew: 'mara', vehicle: 'van', to: sim.getaway().to });
        });
        await expect.poll(async () => (await scene(page)).play.playing, { timeout: 15000 }).toBe(false);
    }
    const result = await page.evaluate(() => (window as any).sim.state.outcome.result);
    await page.locator('[aria-label="New heist"]').click({ timeout: 60000 });
    // Back to the campaign, the heist over.
    await expect(page.locator('.cp-title')).toHaveText('Day 3');
    expect((await campaign(page)).visit.result).toBe(result);
    await expect(page.locator('.cp-visit')).toContainText("Day 2's heist");
    await page.screenshot({ path: 'screenshots/campaign.png' });
    expect(await page.evaluate(() => localStorage.getItem('bankheist:heist'))).toBeNull();
    expect(errors).toEqual([]);
});
