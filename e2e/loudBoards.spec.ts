import { expect, test, type Page } from '@playwright/test';
import { AT_VAN, LOUD } from './setups';

/*
 * M3-09's second half in the page: the police wedge and grenade lying with their fuse, the heat strip's mode and
 * arrival forecast, a Watch wedge dragged into place, the negotiator's dialog and the driving overlay with its drive
 * animated. Each opens a scripted loud bank (e2e/setups.ts) through `window.sim.restart`.
 */

interface Pos { x: number; y: number }

const scene = (page: Page) => page.evaluate(() => (window as any).game.scene.getScene('bank').debugState);
const play = async (page: Page) => (await scene(page)).play;
const onPage = (page: Page, p: Pos) => page.evaluate(([x, y]) => (window as any).game.scene.getScene('bank').tileOnPage(x, y), [p.x, p.y]);
const idle = (page: Page) => expect.poll(async () => (await play(page)).playing, { timeout: 15000 }).toBe(false);
const lookAt = (page: Page, p: Pos) => page.evaluate(q => (window as any).game.scene.getScene('bank').lookAt(q.x * 16 + 8, q.y * 16 + 8), p);

/** Opens a new heist, restarts it from `script`'s state and reloads into it; `instant` playback unless asked otherwise. */
async function open<T>(page: Page, script: string, instant = true): Promise<{ info: T; errors: string[] }> {
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
    if (instant) await page.evaluate(() => { (window as any).sim.session.playback.speed = 'instant'; });
    return { info: found!.info, errors };
}

test('loud: a seen officer\'s red wedge, a police flashbang lying with its fuse, the heat strip\'s mode and forecast (M3-09)', async ({ page }) => {
    const { info, errors } = await open<{ swat: string; at: Pos; grenade: Pos | null }>(page, LOUD('assault'));
    const loud = (await play(page)).boards;
    expect(loud.wedges).toEqual([expect.objectContaining({ side: 'police', by: info.swat, from: info.at, arc: 45 })]);
    if (info.grenade) expect(loud.grenades).toEqual([expect.objectContaining({ at: info.grenade, police: true, fuse: 1 })]);
    // The phase strip: Assault lit with its phases left; the forecast's level, vehicle and phases.
    await expect(page.locator('.sh-modes .sh-mode.on')).toHaveAttribute('title', 'Assault');
    await expect(page.locator('.sh-modes .sh-mode.on')).toContainText('3');
    await expect(page.locator('.sh-heatnext')).toBeVisible();
    await lookAt(page, info.at);
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'screenshots/loud-standoff.png' });
    expect(errors).toEqual([]);
});

test('loud: Jun\'s Watch wedge previewed, dragged round to a tile in sight and set (M3-09)', async ({ page }) => {
    const { info, errors } = await open<{ swat: string; at: Pos }>(page, LOUD('assault'));
    await page.locator('.sh-rail .sh-crew').nth(1).click();
    await page.locator('.sh-actions button[data-action="watch"]').click();
    const preview = () => play(page).then(p => p.boards.wedges.find((w: any) => w.side === 'crew'));
    expect(await preview()).toMatchObject({ by: 'jun', at: info.at, preview: true });
    // A drag that starts on Jun himself still draws a path (UI.md "Touch grammar"), whatever is previewed.
    const jun = await page.evaluate(() => (window as any).sim.state.crew[1].pos as Pos);
    await lookAt(page, jun);
    await page.waitForTimeout(400);
    let drew = false;
    for (const [dx, dy] of [[0, 2], [2, 0], [-2, 0], [0, -2]] as const) {
        const from = await onPage(page, jun), to = await onPage(page, { x: jun.x + dx, y: jun.y + dy });
        const before = await scene(page);
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 8 });
        await page.mouse.up();
        const after = await scene(page);
        // Not a pan, and not the wedge: the wedge stays where it was unless a path replaced it.
        expect(after.midX).toBe(before.midX);
        if (after.play.pending?.path?.length) { drew = true; break; }
        expect(await preview()).toMatchObject({ at: info.at });
    }
    expect(drew, 'a drag from Jun drew a path').toBe(true);
    await page.locator('.sh-actions button[data-action="watch"]').click();
    expect(await preview()).toMatchObject({ at: info.at, preview: true });
    // Drag from the aim (the handle) to another tile Jun sees: the wedge follows.
    const target = await page.evaluate(([from, aim]) => {
        const w = (window as any).sim.world, k = (window as any).sim.state.knowledge;
        const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        const seen = (x: number, y: number) => (ABC.indexOf(k.fresh[((y * w.width + x) / 6) | 0]) >> ((y * w.width + x) % 6)) & 1;
        for (const [dx, dy] of [[0, 2], [2, 0], [0, -2], [-2, 0], [2, 2], [-2, 2], [2, -2], [-2, -2]] as const) {
            const p = { x: aim.x + dx, y: aim.y + dy };
            if (p.x >= 0 && p.y >= 0 && p.x < w.width && p.y < w.height && seen(p.x, p.y) && (p.x !== from.x || p.y !== from.y)) {
                const why = (window as any).sim.whyNot({ type: 'watch', crew: 'jun', at: p, arc: 1 });
                if (!why || !/wedge is/.test(why)) return p;
            }
        }
        return null;
    }, [jun, info.at] as const);
    expect(target).toBeTruthy();
    await lookAt(page, info.at);
    await page.waitForTimeout(400);
    const a = await onPage(page, info.at), b = await onPage(page, target!);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.mouse.up();
    await expect.poll(preview).toMatchObject({ by: 'jun', preview: true });
    const dragged = await preview();
    expect(dragged.at).not.toEqual(info.at);
    await page.screenshot({ path: 'screenshots/loud-watch.png' });
    await page.locator('.sh-confirm').click();
    await idle(page);
    const set = await page.evaluate(() => (window as any).sim.state.crew[1].arms.watch);
    expect(set).toMatchObject({ at: dragged.at });
    expect((await play(page)).boards.wedges.find((w: any) => w.side === 'crew')).toMatchObject({ by: 'jun', at: dragged.at });
    expect(errors).toEqual([]);
});

test('loud: the negotiator on the line, a dialog of offers with their effects; Stall answers it (M3-09)', async ({ page }) => {
    const { errors } = await open<{ hostage: string | null }>(page, LOUD('negotiate'));
    const dialog = page.locator('[data-region="negotiator"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('NEGOTIATOR ON THE LINE');
    await expect(dialog.locator('button[data-offer]')).toHaveCount(4);
    await expect(dialog.locator('button[data-offer="stall"]')).toContainText(/\+\d turns/);
    await expect(dialog.locator('button[data-offer="trade"]')).toHaveAttribute('aria-disabled', 'true');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'screenshots/loud-negotiator.png' });
    // Later puts it aside for the turn; the grid still answers.
    await dialog.locator('.sh-dlater').click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await page.waitForFunction(() => (window as any).game?.scene.getScene('bank')?.debugState?.play && (window as any).sim, undefined, { timeout: 60000 });
    await page.evaluate(() => { (window as any).sim.session.playback.speed = 'instant'; });
    await expect(dialog).toBeVisible();
    const left = await page.evaluate(() => (window as any).sim.state.police.mode.left);
    await dialog.locator('button[data-offer="stall"]').click();
    await idle(page);
    expect(await page.evaluate(() => (window as any).sim.state.negotiation.stalled)).toBe(true);
    expect(await page.evaluate(() => (window as any).sim.state.police.mode.left)).toBeGreaterThan(left);
    await expect(dialog).toBeHidden();
    expect(errors).toEqual([]);
});

test('loud: the driving overlay; a tap picks a footprint, Confirm drives there, animated (M3-09)', async ({ page }) => {
    const { info, errors } = await open<{ vehicle: string }>(page, AT_VAN, false);
    await page.evaluate(() => { (window as any).sim.session.playback.speed = 'instant'; });
    await page.evaluate(v => (window as any).sim.commit({ type: 'board', crew: 'mara', vehicle: v }), info.vehicle);
    await idle(page);
    await page.locator('.sh-rail .sh-crew').nth(0).click();
    await page.locator('.sh-actions button[data-action="drive"]').click();
    const drive = () => play(page).then(p => p.boards?.drive);
    const first = await drive();
    expect(first.reach.length).toBeGreaterThan(first.chosen.length);
    expect(first.swept.length).toBeGreaterThan(0);
    expect(first.onFoot).toHaveLength(1);
    // A tap on a reachable tile away from the van and the chosen footprint picks a pose over it.
    const pose = await page.evaluate(() => (window as any).sim.state.vehicles.van.pose);
    const tile = (first.reach as Pos[]).filter(t => !first.chosen.some((c: Pos) => c.x === t.x && c.y === t.y) && (Math.abs(t.x - pose.x) > 4 || Math.abs(t.y - pose.y) > 4))[0]!;
    expect(tile).toBeTruthy();
    await lookAt(page, tile);
    await page.waitForTimeout(400);
    const at = await onPage(page, tile);
    await page.mouse.click(at.x, at.y);
    await expect.poll(async () => (await drive()).chosen.some((c: Pos) => c.x === tile.x && c.y === tile.y)).toBe(true);
    await page.screenshot({ path: 'screenshots/loud-drive.png' });
    const to = await page.evaluate(() => (window as any).sim.session.pendingCommand.to);
    // Played at the normal speed: the van shown pose by pose along its path.
    await page.evaluate(() => { (window as any).sim.session.playback.speed = '1x'; });
    await page.locator('.sh-confirm').click();
    await expect.poll(async () => (await play(page)).driving, { timeout: 5000 }).toBe(true);
    await idle(page);
    expect((await play(page)).driving).toBe(false);
    expect(await page.evaluate(() => (window as any).sim.state.vehicles.van.pose)).toEqual(to);
    expect(errors).toEqual([]);
});
