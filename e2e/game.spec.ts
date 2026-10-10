import { expect, test, type Page } from '@playwright/test';

interface DebugState { player: { x: number; y: number }; collected: number; total: number; ended: boolean }

async function state(page: Page): Promise<DebugState> {
    return page.evaluate(() => (window as any).game.scene.getScene('vault').debugState);
}

async function boot(page: Page): Promise<string[]> {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('/');
    await page.waitForFunction(() => (window as any).game?.scene.getScene('vault')?.sys.isActive());
    await page.waitForTimeout(800);
    return errors;
}

test('boots without errors and renders a lit scene', async ({ page }) => {
    const errors = await boot(page);
    await page.locator('canvas').screenshot({ path: 'screenshots/start.png' });
    expect(errors).toEqual([]);
    expect((await state(page)).total).toBeGreaterThan(0);
    console.log(`fps: ${await page.evaluate(() => (window as any).game.loop.actualFps.toFixed(1))}`);
});

test('keyboard moves the player', async ({ page }) => {
    await boot(page);
    const before = (await state(page)).player;
    await page.keyboard.down('ArrowRight');
    // Software WebGL in CI renders slowly, so poll instead of assuming a frame rate.
    await expect.poll(async () => (await state(page)).player.x).toBeGreaterThan(before.x + 10);
    await page.keyboard.up('ArrowRight');
});

test('touch joystick moves the player', async ({ page }) => {
    await boot(page);
    const before = (await state(page)).player;
    const box = (await page.locator('canvas').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.6);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.9, { steps: 5 });
    await expect.poll(async () => (await state(page)).player.y).toBeGreaterThan(before.y + 10);
    await page.locator('canvas').screenshot({ path: 'screenshots/joystick.png' });
    await page.mouse.up();
});

test('registers a service worker for offline play', async ({ page }) => {
    await boot(page);
    const registered = await page.evaluate(async () => !!(await navigator.serviceWorker.ready));
    expect(registered).toBe(true);
});
