import { expect, test, type Page } from '@playwright/test';

/*
 * The campaign (M6-01, §19.2, §19.3): `?campaign` starts one and shows the day, the Squeeze and its timeline; laying low
 * spends a day; a heist planned from it spends its day as it starts, and its New heist comes back to the campaign.
 */

const scene = (page: Page) => page.evaluate(() => (window as any).game.scene.getScene('bank').debugState);
const campaign = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('bankheist:campaign') ?? 'null')?.campaign);

test('a campaign: days, the Squeeze, money, contracts, and a heist that spends its day (M6-01, M6-02, M6-03)', async ({ page }) => {
    test.setTimeout(300000);
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

    // Money (M6-03): the sandbox's $24k to start, clean; a medkit from the black market into the armoury.
    await expect(page.locator('.cp-clean .cp-amount')).toHaveText('$24,000');
    await expect(page.locator('.cp-item[data-item="lmg"] .cp-buy')).toBeDisabled();
    await page.locator('.cp-item[data-item="medkit"] .cp-buy').click();
    await expect(page.locator('.cp-clean .cp-amount')).toHaveText('$23,000');
    await expect(page.locator('.cp-item[data-item="medkit"] .cp-have')).toHaveText('×2');

    // The contracts on offer (M6-02): one per stakes; the first low one is the M1 bank, a Granite Savings branch.
    await expect(page.locator('.cp-offer')).toHaveCount(3);
    await expect(page.locator('.cp-offer').first()).toHaveAttribute('data-contract', 'd1-low');
    await expect(page.locator('.cp-offer[data-stakes="low"] .cp-name')).toContainText('Granite Savings small branch');
    await page.locator('.cp-offers').evaluate(e => e.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: 'screenshots/campaign-contracts.png' });

    // The address picks neither the bank nor the stakes: a crafted HQ heist goes back to the campaign, and an offered
    // contract's address with another bank in it plans the contract's own bank.
    await page.goto('/?plan&campaign&seed=5-5&tier=hq&still');
    await expect(page.locator('.cp-title')).toHaveText('Day 2');
    await page.goto('/?plan&campaign&contract=d1-low&seed=5-5&tier=hq&still');
    await page.waitForFunction(() => (window as any).planner, undefined, { timeout: 60000 });
    expect(Object.fromEntries(['seed', 'tier', 'archetype', 'chain'].map(k => [k, new URL(page.url()).searchParams.get(k)])))
        .toEqual({ seed: '31-2', tier: 'small', archetype: 'twoWing', chain: 'Granite Savings' });
    await page.goto('/?campaign&still');

    // A heist from the campaign: Mara alone at the wheel, driven off at once.
    await page.locator('.cp-offer[data-stakes="low"] .cp-plan').click();
    await page.waitForFunction(() => (window as any).planner, undefined, { timeout: 60000 });
    expect(new URL(page.url()).searchParams.has('campaign')).toBe(true);
    expect(new URL(page.url()).searchParams.get('contract')).toBe('d1-low');
    // The plan spends the campaign's money: the Guard rota is paid as it is bought, and stays paid on a reload.
    await expect(page.locator('.pl-cash')).toHaveAttribute('data-cash', '23000');
    await page.locator('.pl-asset[data-asset="guardRota"]').click();
    await expect(page.locator('.pl-cash')).toHaveAttribute('data-cash', '20000');
    expect((await campaign(page)).money.clean).toBe(20000);
    await page.reload();
    await page.waitForFunction(() => (window as any).planner, undefined, { timeout: 60000 });
    await expect(page.locator('.pl-cash')).toHaveAttribute('data-cash', '20000');
    await expect(page.locator('.pl-asset[data-asset="guardRota"]')).toHaveClass(/known/);
    await expect(page.locator('.pl-favours')).toHaveAttribute('data-favours', '1');
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
    expect(await campaign(page)).toMatchObject({ day: 3, squeeze: 4, visit: { kind: 'heist', day: 2, contract: { id: 'd1-low' } } });
    expect((await campaign(page)).contracts.map((k: { id: string }) => k.id)).not.toContain('d1-low');
    expect(new URL(page.url()).searchParams.has('campaign')).toBe(false);
    // What the heist sees is the campaign's, dated its day; nothing goes to the device's own intel.
    // (The rota bought while planning is its own record, with the favour it called in.)
    expect(Object.values((await campaign(page)).intel).flat()).toMatchObject([{ day: 2, intel: { guardRota: true }, favours: 1 }, { day: 2 }]);
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
    // Nothing taken, nothing bought at the start: the money is as the rota left it.
    expect((await campaign(page)).money).toEqual({ clean: 20000, dirty: 0 });
    await page.screenshot({ path: 'screenshots/campaign.png' });
    // The money, the armoury and the black market further down (M6-03).
    await page.locator('.cp-money').evaluate(e => e.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: 'screenshots/campaign-money.png' });
    expect(await page.evaluate(() => localStorage.getItem('bankheist:heist'))).toBeNull();
    expect(errors).toEqual([]);
});
