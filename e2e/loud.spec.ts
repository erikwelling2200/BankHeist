import { expect, test, type Page } from '@playwright/test';
import { LOUD_SETUP, loudStage2 } from './setups';

/*
 * The loud interface (UI.md "Loud", M3-09, first half): aim mode with its nested cone, markers, cover and fire
 * selector, the loupe over an aim drag, police in sight and as ghosts, a breach announced on its door, and the world
 * phase played one unit at a time with the queue strip. Only what the crew knows is drawn.
 */

const play = (page: Page) => page.evaluate(() => (window as any).game.scene.getScene('bank').debugState.play);

async function loudFight(page: Page): Promise<any> {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/?new&still');
    await page.waitForFunction(() => (window as any).game?.scene.getScene('bank')?.debugState?.play && (window as any).sim, undefined, { timeout: 60000 });
    const found = await page.evaluate(LOUD_SETUP) as { state: unknown } | null;
    expect(found, 'the bank has a place for the fight').not.toBeNull();
    await page.evaluate(state => (window as any).sim.restart(state), found!.state);
    await page.reload();
    await page.waitForFunction(() => (window as any).game?.scene.getScene('bank')?.debugState?.play && (window as any).sim, undefined, { timeout: 60000 });
    const info = await loudStage2(page);
    await expect.poll(async () => (await page.evaluate(() => (window as any).game.scene.getScene('bank').debugState)).settled, { timeout: 20000 }).toBe(true);
    await page.locator('.sh-rail .sh-crew').nth(0).click();
    await page.evaluate(cmd => (window as any).sim.session.setPendingCommand(cmd), info.cmd);
    expect(errors).toEqual([]);
    return info;
}

test('aim mode: the nested cone, its bodies and cover, the fire selector and the loupe; police and a breach as the crew knows them (M3-09)', async ({ page }) => {
    const info = await loudFight(page);
    await expect.poll(async () => (await play(page)).loud.aim?.bullets).toBe(3);
    const loud = (await play(page)).loud;
    // The officer the crew sees stands drawn, the one it saw last turn is a ghost, the breach is on its door.
    const live = loud.officers.find((o: any) => o.id === 'police-e2e-1');
    expect(live).toMatchObject({ live: true, shown: true, pos: info.officer });
    if (info.ghost) expect(loud.officers.find((o: any) => o.id === 'police-e2e-2')).toMatchObject({ live: false, pos: info.ghost });
    if (info.door) expect(loud.breaches).toContain(info.door);
    // Every body the cone marks is one the crew knows: a crew member, an officer it sees, an NPC it sees or predicts.
    const known = await page.evaluate(ids => ids.map((id: string) => {
        const sim = (window as any).sim, s = sim.state;
        return s.crew.some((c: any) => c.id === id) || s.police.units.some((u: any) => u.id === id) || sim.knows(id);
    }), loud.aim.bodies.map((b: any) => b.id));
    expect(known.every(Boolean)).toBe(true);
    expect(loud.aim.bodies.find((b: any) => b.id === 'police-e2e-1')?.kind).toBe('hostile');
    await page.screenshot({ path: 'screenshots/loud-aim.png' });

    // The fire selector narrows the cone to fewer rounds.
    await expect(page.locator('.fire-selector button')).toHaveCount(3);
    await page.locator('.fire-selector button', { hasText: '1' }).click();
    await expect.poll(async () => (await play(page)).loud.aim?.bullets).toBe(1);
    expect((await play(page)).pending.bullets).toBe(1);

    // A drag away from the shooter moves the aim point under the loupe, above the finger.
    const from = await page.evaluate(([x, y]) => (window as any).game.scene.getScene('bank').tileOnPage(x, y), [info.officer.x, info.officer.y]);
    const side = await page.evaluate(([x, y]) => (window as any).game.scene.getScene('bank').tileOnPage(x, y), [info.officer.x + 1, info.officer.y + 1]);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + side.x) / 2, (from.y + side.y) / 2, { steps: 4 });
    await page.mouse.move(side.x, side.y, { steps: 4 });
    await expect(page.locator('.aim-loupe')).toBeVisible();
    const box = (await page.locator('.aim-loupe').boundingBox())!;
    expect(box.y + box.height).toBeLessThan(side.y);
    await page.screenshot({ path: 'screenshots/loud-loupe.png' });
    await page.mouse.up();
    await expect(page.locator('.aim-loupe')).toBeHidden();
    expect((await play(page)).pending.at).toEqual({ x: info.officer.x + 1, y: info.officer.y + 1 });
});

test('the world phase in a firefight plays one unit at a time, the one acting bracketed, with the queue strip (M3-09)', async ({ page }) => {
    await loudFight(page);
    await page.evaluate(() => (window as any).sim.session.setPendingCommand(null));
    await page.evaluate(() => { (window as any).sim.session.playback.speed = '1x'; });
    await page.evaluate(() => (window as any).sim.endTurn());
    // Some unit acts on screen, bracketed, with the strip naming who acts.
    await expect.poll(async () => (await play(page)).loud.acting?.id ?? null, { timeout: 20000 }).not.toBeNull();
    const loud = (await play(page)).loud;
    expect(loud.queue).toContain(loud.acting.id);
    await expect(page.locator('.loud-queue .loud-chip.now')).toHaveCount(1);
    await page.screenshot({ path: 'screenshots/loud-world.png' });
    await expect.poll(async () => (await play(page)).playing, { timeout: 30000 }).toBe(false);
    expect((await play(page)).loud.acting).toBeNull();
    await expect(page.locator('.loud-queue')).toBeHidden();
});
