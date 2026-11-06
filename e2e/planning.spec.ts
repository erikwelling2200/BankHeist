import { expect, test, type Page } from '@playwright/test';

/*
 * The planning screen (M4-07, §18, UI.md "Map, planning and campaign"): `?plan` opens the pinned bank's tactical map
 * with the planner over it. A heist is planned (a loadout changed, Jun waiting in the van, the backup car parked at
 * another spot, the sniper nest rented with Sol in it, a jammer placed outside) and started: the game opens on that
 * heist, with the chosen loadout, starts, vehicles and jammer.
 */

interface Pos { x: number; y: number }

const scene = (page: Page) => page.evaluate(() => (window as any).game.scene.getScene('bank').debugState);
const onPage = (page: Page, p: Pos) => page.evaluate(([x, y]) => (window as any).game.scene.getScene('bank').tileOnPage(x, y), [p.x, p.y]);

test('plans a heist and starts it with the chosen loadout, starts and assets (M4-07)', async ({ page }) => {
    // Two banks built: the planning screen's and the game's.
    test.setTimeout(180000);
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/?plan&still');
    await page.waitForFunction(() => (window as any).game?.scene?.getScene('bank')?.sys.isActive() && (window as any).planner, undefined, { timeout: 60000 });
    await expect.poll(async () => (await scene(page)).settled, { timeout: 20000 }).toBe(true);
    await expect.poll(async () => (await scene(page)).map).toBe(true);
    // §3's four, the van at the curb, nothing bought: the whole $24k and every favour left.
    await expect(page.locator('.pl-card')).toHaveCount(4);
    await expect(page.locator('.pl-cash')).toHaveAttribute('data-cash', '24000');
    await expect(page.locator('.pl-spot.on[data-vehicle="van"]')).toHaveCount(1);
    await page.screenshot({ path: 'screenshots/planning.png' });

    // Jun's loadout: an SMG and noisemakers, and he waits in the van.
    await page.locator('.pl-card[data-crew="jun"]').click();
    const sheet = page.locator('.pl-sheet[data-crew="jun"]');
    await sheet.locator('[data-slot="primary"]').selectOption('smg');
    await sheet.locator('[data-slot="gadget2"]').selectOption('noisemaker');
    await sheet.locator('[data-slot="start"]').selectOption('van:in');
    await sheet.getByRole('button', { name: 'Done' }).click();
    await expect(sheet).toHaveCount(0);

    // The backup car, moved to another spot than the one it is first parked at.
    await page.locator('.pl-asset[data-asset="car"]').click();
    const first = await page.locator('.pl-spot.on[data-vehicle="car"]').getAttribute('data-spot');
    const other = page.locator('.pl-spot:not(.on)[data-vehicle="car"]').first();
    const spot = await other.getAttribute('data-spot');
    expect(spot).not.toBe(first);
    await other.click();
    await expect(page.locator(`.pl-spot.on[data-vehicle="car"][data-spot="${spot}"]`)).toHaveCount(1);

    // The sniper nest, with Sol and his DMR in it.
    await page.locator('.pl-asset[data-asset="nest"]').click();
    await page.locator('.pl-card[data-crew="sol"]').click();
    await page.locator('.pl-sheet[data-crew="sol"] [data-slot="start"]').selectOption('nest');
    await page.locator('.pl-sheet').getByRole('button', { name: 'Done' }).click();

    // A jammer on the street in front of the bank: a tap inside the bank is refused, one outside next to it taken.
    await page.locator('.pl-asset[data-asset="jammer"]').click();
    const lobby = await page.evaluate(() => {
        const r = (window as any).generated.rooms.find((x: any) => x.type === 'lobby');
        return { x: r.x + Math.floor(r.w / 2), y: r.y, h: r.h };
    });
    const inside = await onPage(page, { x: lobby.x, y: lobby.y + 1 });
    await page.mouse.click(inside.x, inside.y);
    await expect(page.locator('.pl-jammer')).toHaveCount(0);
    let jammer: Pos | null = null;
    for (let dy = lobby.h; dy < lobby.h + 4 && !jammer; dy++) {
        const at = await onPage(page, { x: lobby.x, y: lobby.y + dy });
        await page.mouse.click(at.x, at.y);
        if (await page.locator('.pl-jammer').count()) jammer = { x: lobby.x, y: lobby.y + dy };
    }
    expect(jammer, 'a tile outside the lobby takes the jammer').not.toBeNull();

    // $6k + $6k + $5k spent of $24k; 1 + 2 + 2 favours of 8.
    await expect(page.locator('.pl-cash')).toHaveAttribute('data-cash', '7000');
    await expect(page.locator('.pl-favours')).toHaveAttribute('data-favours', '5');
    await expect(page.locator('.pl-problem')).toBeHidden();
    await page.screenshot({ path: 'screenshots/planning-assets.png' });

    await page.locator('.pl-start').click();
    await page.waitForFunction(() => (window as any).game?.scene?.getScene('bank')?.debugState?.play && (window as any).sim, undefined, { timeout: 60000 });
    await expect.poll(async () => (await scene(page)).settled, { timeout: 20000 }).toBe(true);
    const started = await page.evaluate(() => {
        const { state, world } = (window as any).sim;
        return {
            crew: state.crew.map((c: any) => ({ id: c.id, items: c.loadout.items, aboard: c.aboard, raised: !!world.tiles[c.pos.y * world.width + c.pos.x].raised })),
            vehicles: world.vehicles.map((v: any) => v.id), jammers: state.jammers.map((j: any) => j.pos)
        };
    });
    expect(started.crew.map((c: any) => c.id)).toEqual(['mara', 'jun', 'dex', 'sol']);
    const jun = started.crew.find((c: any) => c.id === 'jun'), sol = started.crew.find((c: any) => c.id === 'sol');
    expect(jun.items).toEqual(['zipTies', 'smg', 'pistol', 'hackingKit', 'noisemaker']);
    expect(jun.aboard).toBe('van');
    expect(sol.raised).toBe(true);
    expect(sol.aboard).toBeNull();
    expect(started.vehicles).toEqual(['van', 'car']);
    expect(started.jammers).toEqual([jammer]);
    // The rail shows the four; a reload resumes the planned heist.
    await expect(page.locator('.sh-rail .sh-crew')).toHaveCount(4);
    await page.screenshot({ path: 'screenshots/planned-heist.png' });
    await page.reload();
    await page.waitForFunction(() => (window as any).game?.scene?.getScene('bank')?.debugState?.play && (window as any).sim, undefined, { timeout: 60000 });
    expect(await page.evaluate(() => (window as any).sim.world.vehicles.map((v: any) => v.id))).toEqual(['van', 'car']);
    expect(errors).toEqual([]);
});
