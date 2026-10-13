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

test.describe('on a phone', () => {
    test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

    test('fills a wide landscape screen and offers fullscreen', async ({ page }) => {
        const errors = await boot(page);
        const canvas = (await page.locator('canvas').boundingBox())!;
        expect(canvas.width).toBeCloseTo(844, -1);
        expect(canvas.height).toBeCloseTo(390, -1);
        await expect(page.locator('.fullscreen-button')).toBeVisible();
        await page.screenshot({ path: 'screenshots/phone-landscape.png' });
        expect(errors).toEqual([]);
    });

    test('asks to rotate in portrait', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await boot(page);
        await expect(page.locator('.rotate-hint')).toBeVisible();
    });
});

test.describe('lobby visual preview', () => {
    async function bootLobby(page: Page): Promise<string[]> {
        const errors: string[] = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        await page.goto('/?scene=lobby');
        await page.waitForFunction(() => (window as any).game?.scene.getScene('lobby')?.sys.isActive());
        await page.waitForTimeout(1000);
        return errors;
    }

    test('renders the lobby and the street, cutting walls the camera looks past and keeping lamp light behind walls', async ({ page }) => {
        const errors = await bootLobby(page);
        const scene = () => page.evaluate(() => (window as any).game.scene.getScene('lobby').debugState);
        const lookAt = async (x: number, y: number) => {
            await page.evaluate(([x, y]) => (window as any).game.scene.getScene('lobby').lookAt(x, y), [x, y]);
            await page.waitForTimeout(400);
        };
        type WallState = { run: string; ty: number; height: number };
        const heights = (walls: WallState[], ty: number) => [...new Set(walls.filter(w => w.run === 'eastWest' && w.ty === ty).map(w => w.height))];
        const BACK_WALL = 4, FACADE = 14;

        await lookAt(176, 136);
        await page.locator('canvas').screenshot({ path: 'screenshots/lobby.png' });
        let state = await scene();
        // Looking at the lobby: the back wall stands behind it, the shop front in front of it is cut down.
        expect(heights(state.walls, BACK_WALL)).toEqual([24]);
        expect(heights(state.walls, FACADE)).toEqual([8]);

        await lookAt(176, 48);
        await page.locator('canvas').screenshot({ path: 'screenshots/lobby-corridor.png' });
        state = await scene();
        // Looking at the corridor behind it, the back wall is cut down too.
        expect(heights(state.walls, BACK_WALL)).toEqual([8]);

        await lookAt(176, 262);
        await page.locator('canvas').screenshot({ path: 'screenshots/lobby-street.png' });
        state = await scene();
        expect(heights(state.walls, FACADE)).toEqual([24]);
        // Lamp light is blocked by walls and drowned by day outdoors: the corridor has its own, the street none.
        expect(state.lamps).toBeGreaterThan(0);
        expect(state.lit[2]).toContain('#');
        expect(state.lit[FACADE]).not.toContain('#');
        expect(errors).toEqual([]);
    });
});

test('renders every prop in its four facings', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('/?scene=props');
    await page.waitForFunction(() => (window as any).game?.scene.getScene('props')?.sys.isActive());
    const sheet = await page.evaluate(() => (window as any).game.scene.getScene('props').debugState);
    // Show the whole sheet at 1:1, three screen pixels to a pixel.
    await page.setViewportSize({ width: sheet.width * 3, height: sheet.height * 3 });
    await page.evaluate(([w, h]) => {
        (window as any).game.scale.setGameSize(w, h);
        (window as any).game.scene.getScene('props').cameras.main.setSize(w, h);
    }, [sheet.width, sheet.height]);
    await page.waitForTimeout(500);
    await page.locator('canvas').screenshot({ path: 'screenshots/props.png' });
    expect(errors).toEqual([]);
});
