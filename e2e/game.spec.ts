import { expect, test, type Page } from '@playwright/test';

interface DebugState { player: { x: number; y: number }; collected: number; total: number; ended: boolean }

async function state(page: Page): Promise<DebugState> {
    return page.evaluate(() => (window as any).game.scene.getScene('vault').debugState);
}

/**
 * Opens a scene and waits for it to run: a generated bank (`bank`, from a fixed seed unless `query` says otherwise),
 * the hand-made example bank (`example`) or the old stack demo (`vault`).
 */
async function boot(page: Page, scene: 'bank' | 'example' | 'vault' = 'vault', query = 'seed=2024-1'): Promise<string[]> {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(scene === 'bank' ? `/?${query}` : scene === 'example' ? '/?bank=example' : '/?scene=demo');
    await page.waitForFunction(s => (window as any).game?.scene.getScene(s)?.sys.isActive(), scene === 'vault' ? 'vault' : 'bank', { timeout: 60000 });
    await page.waitForTimeout(800);
    return errors;
}

test('boots into the bank without errors', async ({ page }) => {
    const errors = await boot(page, 'bank');
    await page.locator('canvas').screenshot({ path: 'screenshots/start.png' });
    expect(errors).toEqual([]);
    console.log(`fps: ${await page.evaluate(() => (window as any).game.loop.actualFps.toFixed(1))}`);
});

test('runs the old stack demo on its own link', async ({ page }) => {
    const errors = await boot(page);
    expect(errors).toEqual([]);
    expect((await state(page)).total).toBeGreaterThan(0);
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
        const errors = await boot(page, 'bank');
        const canvas = (await page.locator('canvas').boundingBox())!;
        expect(canvas.width).toBeCloseTo(844, -1);
        expect(canvas.height).toBeCloseTo(390, -1);
        await expect(page.locator('.fullscreen-button')).toBeVisible();
        await page.screenshot({ path: 'screenshots/phone-landscape.png' });
        expect(errors).toEqual([]);
    });

    test('asks to rotate in portrait', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await boot(page, 'bank');
        await expect(page.locator('.rotate-hint')).toBeVisible();
    });
});

test.describe('on a high-density phone', () => {
    test.use({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });

    test('pinches the zoom a step at a time and holds it while the fingers rest (§20.1)', async ({ page }) => {
        const errors = await boot(page, 'bank');
        const zoom = () => page.evaluate(() => (window as any).game.scene.getScene('bank').debugState.zoom as number);
        const before = await zoom();
        const cdp = await page.context().newCDPSession(page);
        const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', spread: number) => cdp.send('Input.dispatchTouchEvent', {
            type, touchPoints: type === 'touchEnd' ? [] : [{ x: 422 - spread / 2, y: 195, id: 0 }, { x: 422 + spread / 2, y: 195, id: 1 }]
        });
        await touch('touchStart', 100);
        // Spreading the fingers by a third zooms in one step, then nothing more while they wobble on the glass.
        const seen: number[] = [];
        for (const spread of [104, 110, 116, 122, 128, 134, 133, 135, 132, 134, 136, 133, 135, 134]) {
            await touch('touchMove', spread);
            await page.waitForTimeout(30);
            seen.push(await zoom());
        }
        await touch('touchEnd', 0);
        expect(seen.at(-1)).toBe(before + 1);
        expect(seen.slice(seen.indexOf(before + 1))).toEqual(seen.slice(seen.indexOf(before + 1)).map(() => before + 1));
        expect(errors).toEqual([]);
    });

    test('pinches in from the widest zoom through every step without stepping back', async ({ page }) => {
        const errors = await boot(page, 'bank');
        const state = () => page.evaluate(() => (window as any).game.scene.getScene('bank').debugState as { zoom: number; zoomLevels: number[] });
        const { zoomLevels } = await state();
        for (const _ of zoomLevels) await page.evaluate(() => (window as any).game.scene.getScene('bank').zoomStep(-1));
        expect((await state()).zoom).toBe(zoomLevels[0]);
        const cdp = await page.context().newCDPSession(page);
        const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', spread: number) => cdp.send('Input.dispatchTouchEvent', {
            type, touchPoints: type === 'touchEnd' ? [] : [{ x: 422 - spread / 2, y: 195, id: 0 }, { x: 422 + spread / 2, y: 195, id: 1 }]
        });
        // From the widest step the next is a third closer, more than a pinch's quarter: both fingers have to be read in
        // the same units, or the zoom overshoots and comes back.
        await touch('touchStart', 100);
        const seen: number[] = [];
        for (let spread = 104; spread <= 260; spread += 6) {
            await touch('touchMove', spread);
            await page.waitForTimeout(30);
            seen.push((await state()).zoom);
        }
        await touch('touchEnd', 0);
        expect(seen).toEqual([...seen].sort((a, b) => a - b));
        expect(seen.at(-1)).toBe(zoomLevels.at(-1));
        expect(errors).toEqual([]);
    });
});

test.describe('the hand-made example bank', () => {
    const scene = (page: Page) => page.evaluate(() => (window as any).game.scene.getScene('bank').debugState);
    const lookAt = async (page: Page, x: number, y: number) => {
        await page.evaluate(([x, y]) => (window as any).game.scene.getScene('bank').lookAt(x, y), [x, y]);
        await page.waitForTimeout(400);
    };
    type WallState = { run: string; ty: number; height: number };
    const heights = (walls: WallState[], ty: number) => [...new Set(walls.filter(w => w.run === 'eastWest' && w.ty === ty && w.height !== undefined).map(w => w.height))];
    const TILE = 16, BACK_WALL = 13, FRONT = 28;

    test('cuts the walls the camera looks past and keeps lamp light behind walls', async ({ page }) => {
        const errors = await boot(page, 'example');
        await lookAt(page, 30 * TILE, 22 * TILE);
        await page.locator('canvas').screenshot({ path: 'screenshots/bank-lobby.png' });
        let state = await scene(page);
        // Looking at the lobby: the back wall stands behind it, the street front in front of it is cut down.
        expect(heights(state.walls, BACK_WALL)).toEqual([24]);
        expect(heights(state.walls, FRONT)).toEqual([8]);

        await lookAt(page, 30 * TILE, 12 * TILE);
        await page.locator('canvas').screenshot({ path: 'screenshots/bank-corridor.png' });
        state = await scene(page);
        // Looking at the corridor behind it, the back wall is cut down too.
        expect(heights(state.walls, BACK_WALL)).toEqual([8]);

        await lookAt(page, 30 * TILE, 31 * TILE);
        await page.locator('canvas').screenshot({ path: 'screenshots/bank-street.png' });
        state = await scene(page);
        expect(heights(state.walls, FRONT)).toEqual([24]);

        await lookAt(page, 27 * TILE, 5 * TILE);
        await page.locator('canvas').screenshot({ path: 'screenshots/bank-vault.png' });
        // Lamp light is blocked by walls and drowned by day outdoors: the corridor has its own, the street none.
        expect(state.lamps).toBeGreaterThan(0);
        expect(state.lit[11]).toContain('#');
        expect(state.lit[FRONT]).not.toContain('#');
        expect(errors).toEqual([]);
    });

    test('stands an office tower across the street, with the sniper nest up its stairs (§14.5)', async ({ page }) => {
        const errors = await boot(page, 'example');
        const TOWER = 39;
        await lookAt(page, 32 * TILE, 41 * TILE);
        await page.locator('canvas').screenshot({ path: 'screenshots/bank-nest.png' });
        let state = await scene(page);
        // Looking into the tower, its glass front stands behind what we look at; from the street it is cut down.
        expect(heights(state.walls, TOWER)).toEqual([24]);
        expect(state.people.some((p: { look: string }) => p.look === 'crewSol')).toBe(true);
        await lookAt(page, 32 * TILE, 33 * TILE);
        state = await scene(page);
        expect(heights(state.walls, TOWER)).toEqual([8]);
        expect(errors).toEqual([]);
    });

    test('relights people as they move, and walks the guards and a passer-by on their patrols', async ({ page }) => {
        const errors = await boot(page, 'example');
        type Person = { look: string; x: number; y: number; facing: string; light: number };
        const people = (): Promise<Person[]> => page.evaluate(() => (window as any).game.scene.getScene('bank').debugState.people);
        const index = (await people()).findIndex(p => p.look === 'customerCasual');
        const moveTo = async (x: number, y: number) => {
            await page.evaluate(([i, x, y]) => (window as any).game.scene.getScene('bank').movePerson(i, x, y), [index, x, y]);
            return (await people())[index]!;
        };
        // Under a lobby lamp, then in the corridor behind the back wall, lit only by its own strip lights.
        const underLamp = await moveTo(27.5 * TILE, 19 * TILE);
        const inCorridor = await moveTo(30 * TILE, 11.5 * TILE);
        expect(inCorridor.light).not.toBeCloseTo(underLamp.light, 1);
        expect((await moveTo(27.5 * TILE, 19 * TILE)).light).toBeCloseTo(underLamp.light, 5);

        const walkers = async () => (await people()).filter(p => p.look === 'guard' || p.look === 'passerby');
        const start = await walkers();
        await page.waitForTimeout(3000);
        const later = await walkers();
        later.forEach((p, i) => expect(p.x !== start[i]!.x || p.y !== start[i]!.y, p.look).toBe(true));
        expect(errors).toEqual([]);
    });

    test('pans and zooms in crisp steps, and shows the whole plot on the tactical map (§20.1)', async ({ page }) => {
        const errors = await boot(page, 'example');
        let state = await scene(page);
        // A 540px-tall screen: 11 to 34 tiles high is zoom 3 (11.25 tiles), 2 (16.9) or 1 (33.75); it opens on 2.
        expect(state.zoomLevels).toEqual([1, 2, 3]);
        expect(state.zoom).toBe(2);
        await page.keyboard.press('+');
        expect((await scene(page)).zoom).toBe(3);
        await page.keyboard.press('-');
        await page.keyboard.press('-');
        expect((await scene(page)).zoom).toBe(1);
        const box = (await page.locator('canvas').boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, -120);
        await expect.poll(async () => (await scene(page)).zoom).toBe(2);

        // Dragging pans by the drag over the zoom.
        state = await scene(page);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2, { steps: 4 });
        await page.mouse.up();
        expect((await scene(page)).midX).toBeCloseTo(state.midX + 50, -1);

        await page.getByRole('button', { name: 'Tactical map' }).click();
        await page.waitForTimeout(400);
        state = await scene(page);
        expect(state.map).toBe(true);
        expect(state.zoom).toBe(1);
        expect(heights(state.walls, BACK_WALL)).toEqual([8]);
        await page.locator('canvas').screenshot({ path: 'screenshots/bank-map.png' });
        await page.getByRole('button', { name: 'Tactical map' }).click();
        state = await scene(page);
        expect(state.map).toBe(false);
        expect(state.zoom).toBe(2);
        expect(errors).toEqual([]);
    });
});

test.describe('generated banks (§17)', () => {
    const generated = (page: Page) => page.evaluate(() => {
        const g = (window as any).generated;
        return { tier: g.tier, archetype: g.archetype, plot: g.plot, seed: `${g.seed.layout}-${g.seed.population}`, failed: g.validation.results.filter((r: { ok: boolean; rule: string }) => !r.ok && !g.validation.relaxed.includes(r.rule)).map((r: { rule: string }) => r.rule) };
    });

    for (const archetype of ['twoWing', 'atrium', 'threeKeys', 'fortress', 'mezzanineWatch']) {
        test(`draws a ${archetype} bank that passes its checks`, async ({ page }) => {
            const errors = await boot(page, 'bank', `seed=31-2&tier=city&archetype=${archetype}`);
            const g = await generated(page);
            expect(g.archetype).toBe(archetype);
            expect(g.failed).toEqual([]);
            await page.evaluate(() => (window as any).game.scene.getScene('bank').toggleMap());
            await page.waitForTimeout(400);
            await page.locator('canvas').screenshot({ path: `screenshots/generated-${archetype}.png` });
            expect(errors).toEqual([]);
        });
    }

    test('puts the seed in the address, rolls a new bank, and shows the blueprint (§17.2, §17.8)', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        const errors = await boot(page, 'bank', 'tier=small');
        const first = await generated(page);
        expect(new URL(page.url()).searchParams.get('seed')).toBe(first.seed);
        expect(first.tier).toBe('small');
        await expect(page.locator('.briefing-panel')).toBeVisible();
        await page.locator('.briefing-panel').screenshot({ path: 'screenshots/briefing.png' });
        await page.getByRole('button', { name: 'Show blueprint only' }).click();
        await page.waitForTimeout(300);
        await page.locator('canvas').screenshot({ path: 'screenshots/generated-blueprint.png' });
        await Promise.all([page.waitForURL(url => url.searchParams.get('seed') !== first.seed), page.getByRole('button', { name: 'Same building, new people' }).click()]);
        await page.waitForFunction(() => (window as any).game?.scene?.getScene('bank')?.sys.isActive(), null, { timeout: 60000 });
        const again = await generated(page);
        expect(again.seed.split('-')[0]).toBe(first.seed.split('-')[0]);
        expect(again.tier).toBe('small');
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

test.describe('the police officer preview', () => {
    const officer = (page: Page) => page.evaluate(() => (window as any).game.scene.getScene('officer').debugState);
    const open = async (page: Page) => {
        const errors: string[] = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        await page.goto('/?scene=officer');
        await page.waitForFunction(() => (window as any).game?.scene.getScene('officer')?.sys.isActive(), undefined, { timeout: 60000 });
        return errors;
    };

    test('plays the walk, the shots, the dive and the shots over cover, and loops', async ({ page }) => {
        const errors = await open(page);
        const start = await officer(page);
        await expect.poll(async () => (await officer(page)).x, { timeout: 15000 }).toBeGreaterThan(start.x + 20);
        // Each beat, held for a screenshot; a shot's beat shows its muzzle flash.
        const beats: [string, string][] = [['walk', 'walkEast3'], ['aim', 'aimWest'], ['shot', 'kickWest'], ['dive', 'flyWest'], ['cover', 'coverEastLook'], ['over', 'overKickWest']];
        for (const [name, frame] of beats) {
            await page.evaluate(f => {
                const scene = (window as any).game.scene.getScene('officer');
                const cels = scene.timeline.cels;
                const i = cels.findIndex((c: { frame: string }) => c.frame === f);
                scene.seek(scene.timeline.startOf(i) + 10);
            }, frame);
            await page.waitForTimeout(150);
            expect((await officer(page)).frame).toBe(frame);
            await page.locator('canvas').screenshot({ path: `screenshots/officer-${name}.png` });
        }
        // Back on, it reaches the end of the loop and starts over.
        const state = await officer(page);
        await page.evaluate(d => {
            const scene = (window as any).game.scene.getScene('officer');
            scene.seek(d - 200);
            scene.scene.resume();
        }, state.duration);
        await expect.poll(async () => (await officer(page)).elapsed % state.duration, { timeout: 5000 }).toBeLessThan(2000);
        expect((await officer(page)).shots).toBeGreaterThan(0);
        expect(errors).toEqual([]);
    });
});
