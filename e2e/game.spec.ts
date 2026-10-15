import { expect, test, type Page } from '@playwright/test';

/**
 * Opens a page and waits for its bank to run: a generated bank in the viewer (`bank`, `?view` from a fixed seed unless
 * `query` says otherwise), the hand-made example bank (`example`) or the game (`play`, the default page).
 */
async function boot(page: Page, scene: 'bank' | 'example' | 'play' = 'bank', query = 'seed=2024-1'): Promise<string[]> {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(scene === 'bank' ? `/?view&${query}` : scene === 'example' ? '/?bank=example' : '/');
    await page.waitForFunction(() => (window as any).game?.scene.getScene('bank')?.sys.isActive(), undefined, { timeout: 60000 });
    if (scene === 'play') await page.waitForFunction(() => (window as any).sim, undefined, { timeout: 60000 });
    await page.waitForTimeout(800);
    return errors;
}

/** `npm run test:smoke` runs only the tests tagged `@smoke`: a quick check that every page still boots. */
const SMOKE = { tag: '@smoke' };

test('boots into the game without errors', SMOKE, async ({ page }) => {
    // The default page is the heist in the pinned bank, the crew at their van.
    const errors = await boot(page, 'play');
    await expect.poll(() => page.evaluate(() => (window as any).game.scene.getScene('bank').debugState.settled), { timeout: 20000 }).toBe(true);
    expect(await page.evaluate(() => (window as any).sim.state.crew.map((c: { id: string }) => c.id))).toEqual(['mara', 'jun']);
    await expect(page.locator('.sh-rail .sh-crew')).toHaveCount(2);
    // The pinned bank: the address stays bare, so a reload resumes this heist.
    expect(await page.evaluate(() => (window as any).generated.seed)).toEqual({ layout: 31, population: 2 });
    expect(new URL(page.url()).search).toBe('');
    await page.screenshot({ path: 'screenshots/start.png' });
    expect(errors).toEqual([]);
    console.log(`fps: ${await page.evaluate(() => (window as any).game.loop.actualFps.toFixed(1))}`);
});

test('boots into the generated-bank viewer without errors', SMOKE, async ({ page }) => {
    const errors = await boot(page, 'bank');
    await expect(page.locator('.generator-bar')).toBeVisible();
    expect(await page.evaluate(() => (window as any).sim)).toBeUndefined();
    expect(new URL(page.url()).search).toMatch(/^\?view&/);
    await page.locator('canvas').screenshot({ path: 'screenshots/viewer.png' });
    expect(errors).toEqual([]);
});

test('opens an old link to a generated bank (a bare ?seed=) in the viewer, and saves no heist', SMOKE, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/?seed=123456-7');
    await page.waitForFunction(() => (window as any).game?.scene.getScene('bank')?.sys.isActive(), undefined, { timeout: 60000 });
    await expect(page.locator('.generator-bar')).toBeVisible();
    expect(await page.evaluate(() => (window as any).sim)).toBeUndefined();
    expect(new URL(page.url()).search).toMatch(/^\?view&seed=123456-7/);
    expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('bankheist:')))).toEqual([]);
    expect(errors).toEqual([]);
});

test('registers a service worker for offline play', async ({ page }) => {
    // The dev server (`E2E_DEV=1`) serves no service worker: only the build has one.
    test.skip(!!process.env.E2E_DEV, 'the service worker is part of the build');
    await boot(page, 'bank');
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
        // The generator bar keeps to one row and clear of the buttons at the left; the briefing hangs below it.
        const box = async (selector: string) => (await page.locator(selector).boundingBox())!;
        const bar = await box('.generator-bar'), full = await box('.fullscreen-button'), camera = await box('.camera-controls'), toggle = await box('.briefing-toggle');
        expect(bar.height).toBeLessThan(56);
        expect(bar.x).toBeGreaterThanOrEqual(full.x + full.width);
        expect(bar.y + bar.height).toBeLessThanOrEqual(camera.y);
        expect(toggle.y).toBeGreaterThanOrEqual(bar.y + bar.height);
        expect(toggle.height).toBeGreaterThanOrEqual(36);
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

    test('fits the whole plot on the tactical map, below the generator bar', async ({ page }) => {
        const errors = await boot(page, 'bank', 'seed=15838-2&tier=hq&archetype=mezzanineWatch&plot=stripMallEnd');
        const bar = (await page.locator('.generator-bar').boundingBox())!;
        await page.evaluate(() => (window as any).game.scene.getScene('bank').toggleMap());
        await page.waitForTimeout(400);
        const state = await page.evaluate(() => (window as any).game.scene.getScene('bank').debugState);
        expect(state.plot.top).toBeGreaterThanOrEqual(bar.y + bar.height);
        expect(state.plot.bottom).toBeLessThanOrEqual(390);
        expect(state.plot.left).toBeGreaterThanOrEqual(0);
        expect(state.plot.right).toBeLessThanOrEqual(844);
        await page.screenshot({ path: 'screenshots/phone-map.png' });
        expect(errors).toEqual([]);
    });

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

    test('draws an open door as its doorway and its leaf swung open, in the projection and cut with its wall (§6.9)', async ({ page }) => {
        const errors = await boot(page, 'example');
        const openAll = () => page.evaluate(() => {
            const bank = (window as any).game.scene.getScene('bank');
            const doors = ['doorWood', 'doorKeycard', 'doorService', 'doorGlass', 'doorTower', 'doorBack', 'vaultDoor', 'shutter'];
            for (const w of (window as any).game.registry.get('bankData').level.walls) if (doors.includes(w.kind)) bank.walls.setDoorOpen(w.run, w.tx, w.ty, true);
        });
        // The street front stands, its glass doors and the lobby's side doors in view; then the vault door, its wall standing.
        await lookAt(page, 30 * TILE, 31 * TILE);
        const shut = await page.locator('canvas').screenshot();
        await openAll();
        await page.waitForTimeout(200);
        const open = await page.locator('canvas').screenshot({ path: 'screenshots/door-open.png' });
        expect(open.equals(shut)).toBe(false);
        await lookAt(page, 26 * TILE, 11 * TILE);
        await page.locator('canvas').screenshot({ path: 'screenshots/door-open-vault.png' });
        expect(errors).toEqual([]);
    });

    test('draws the nest a storey up over the face of the tower below it, and cuts it down looking past it (§14.7)', async ({ page }) => {
        const errors = await boot(page, 'example');
        const nest = async () => {
            const { raised, people } = await scene(page);
            return { storey: raised.find((r: { north: number }) => r.north === 39).storey, sol: people.find((p: { look: string }) => p.look === 'crewSol') };
        };
        // Looking into the nest it stands a full storey (3.5m), and Sol at its window stands on it.
        await lookAt(page, 32 * TILE, 41 * TILE);
        await page.waitForFunction(() => (window as any).game.scene.getScene('bank').debugState.settled);
        await page.locator('canvas').screenshot({ path: 'screenshots/raised-nest.png' });
        expect((await nest()).storey).toBe(44);
        expect((await nest()).sol.lift).toBe(44);
        // From the street, north of it, it is cut down so the far sidewalk behind it shows.
        await lookAt(page, 32 * TILE, 34 * TILE);
        await page.waitForFunction(() => (window as any).game.scene.getScene('bank').debugState.settled);
        await page.locator('canvas').screenshot({ path: 'screenshots/raised-nest-cut.png' });
        expect((await nest()).storey).toBe(8);
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
        // The 960x704 plot doesn't fit 540 pixels at 1, so the map scales it down until the whole of it shows.
        expect(state.zoom).toBeLessThan(1);
        expect(state.plot.top).toBeGreaterThanOrEqual(0);
        expect(state.plot.bottom).toBeLessThanOrEqual(540);
        expect(state.plot.left).toBeGreaterThanOrEqual(0);
        expect(state.plot.right).toBeLessThanOrEqual(960);
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
        test(`draws a ${archetype} bank that passes its checks`, archetype === 'twoWing' ? SMOKE : {}, async ({ page }) => {
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

    test('fits the whole of a big plot on the tactical map, below the generator bar (§20.1)', async ({ page }) => {
        const errors = await boot(page, 'bank', 'seed=15838-2&tier=hq&archetype=mezzanineWatch&plot=stripMallEnd');
        const bar = (await page.locator('.generator-bar').boundingBox())!;
        await page.getByRole('button', { name: 'Tactical map' }).click();
        await page.waitForTimeout(400);
        const state = await page.evaluate(() => (window as any).game.scene.getScene('bank').debugState);
        expect(state.plot.top).toBeGreaterThanOrEqual(bar.y + bar.height);
        expect(state.plot.bottom).toBeLessThanOrEqual(540);
        expect(state.plot.left).toBeGreaterThanOrEqual(0);
        expect(state.plot.right).toBeLessThanOrEqual(960);
        // Centred in what the bar leaves free.
        expect((state.plot.left + state.plot.right) / 2).toBeCloseTo(480, -1);
        expect((state.plot.top + state.plot.bottom) / 2).toBeCloseTo((bar.y + bar.height + 540) / 2, -1);
        await page.locator('canvas').screenshot({ path: 'screenshots/generated-map-hq.png' });
        // Zooming in leaves the map for the view before it, back on a whole-number step.
        await page.keyboard.press('+');
        const back = await page.evaluate(() => (window as any).game.scene.getScene('bank').debugState);
        expect(back.map).toBe(false);
        expect(back.zoomLevels).toContain(back.zoom);
        expect(errors).toEqual([]);
    });

    test('lights the atrium under its skylight and shows the drop and railing at the gallery (§14.7)', async ({ page }) => {
        const errors = await boot(page, 'bank', 'seed=7919-1&tier=city&archetype=atrium&plot=plazaFront');
        await page.evaluate(() => {
            const scene = (window as any).game.scene.getScene('bank');
            const sky = (window as any).game.registry.get('bankData').props.find((p: { kind: string }) => p.kind === 'skylight');
            scene.lookAt((sky.tx - 3) * 16, (sky.ty + 1) * 16);
            for (const e of document.querySelectorAll<HTMLElement>('.generator-bar, .briefing, .camera-controls')) e.style.display = 'none';
        });
        await page.waitForTimeout(400);
        await page.locator('canvas').screenshot({ path: 'screenshots/generated-atrium.png' });
        expect(errors).toEqual([]);
    });

    test('lifts the mezzanine a storey over the lobby, its stairs climbing to it (§14.7)', async ({ page }) => {
        const errors = await boot(page, 'bank', 'seed=15838-2&tier=hq&archetype=mezzanineWatch&plot=stripMallEnd');
        await page.evaluate(() => {
            (window as any).game.scene.getScene('bank').lookAt(42 * 16, 22 * 16);
            for (const e of document.querySelectorAll<HTMLElement>('.generator-bar, .briefing, .camera-controls')) e.style.display = 'none';
        });
        await page.waitForFunction(() => (window as any).game.scene.getScene('bank').debugState.settled);
        await page.waitForTimeout(300);
        await page.locator('canvas').screenshot({ path: 'screenshots/raised-mezzanine.png' });
        const { raised } = await page.evaluate(() => (window as any).game.scene.getScene('bank').debugState);
        expect(raised.some((r: { storey: number }) => r.storey === 44)).toBe(true);
        expect(errors).toEqual([]);
    });

    test('puts the seed in the address, rolls a new bank, and shows the blueprint (§17.2, §17.8)', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        const errors = await boot(page, 'bank', 'tier=small');
        const first = await generated(page);
        expect(new URL(page.url()).searchParams.get('seed')).toBe(first.seed);
        expect(first.tier).toBe('small');
        await expect(page.locator('.briefing-panel')).toBeVisible();
        await page.locator('.briefing-panel').screenshot({ path: 'screenshots/briefing.png' });
        await page.getByRole('button', { name: 'Blueprint' }).click();
        await page.waitForTimeout(300);
        await page.locator('canvas').screenshot({ path: 'screenshots/generated-blueprint.png' });
        // Someone walking into a room the blueprint only outlines goes out of sight, and comes back as they walk out.
        const seen = await page.evaluate(() => {
            const scene = (window as any).game.scene.getScene('bank'), room = (window as any).game.registry.get('bankData').outlines[0];
            const visible = () => scene.debugState.people[0].visible as boolean;
            scene.movePerson(0, (room.x + 0.5) * 16, (room.y + 0.5) * 16);
            const inside = visible();
            const focus = (window as any).game.registry.get('bankData').focus;
            scene.movePerson(0, (focus.tx + 0.5) * 16, (focus.ty + 0.5) * 16);
            return { inside, outside: visible() };
        });
        expect(seen).toEqual({ inside: false, outside: true });
        await page.getByRole('button', { name: 'New people' }).click();
        await page.waitForFunction(seed => {
            const g = (window as any).generated;
            return g && `${g.seed.layout}-${g.seed.population}` !== seed && (window as any).game.scene.getScene('bank').sys.isActive();
        }, first.seed, { timeout: 60000 });
        const again = await generated(page);
        expect(again.seed.split('-')[0]).toBe(first.seed.split('-')[0]);
        expect(again.tier).toBe('small');
        expect(errors).toEqual([]);
    });
});

test.describe('the generator bar', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('hangs the briefing below the bar, however many rows it takes', async ({ page }) => {
        await page.setViewportSize({ width: 960, height: 540 });
        const errors = await boot(page, 'bank', 'seed=15838-2&tier=hq&archetype=mezzanineWatch&plot=stripMallEnd');
        await page.getByRole('button', { name: 'Briefing' }).click();
        await expect(page.locator('.briefing-panel')).toBeVisible();
        const bar = (await page.locator('.generator-bar').boundingBox())!, toggle = (await page.locator('.briefing-toggle').boundingBox())!;
        expect(toggle.y).toBeGreaterThanOrEqual(bar.y + bar.height);
        // The open panel doesn't squeeze the toggle.
        expect(toggle.height).toBeGreaterThanOrEqual(36);
        await page.screenshot({ path: 'screenshots/briefing-open.png' });
        expect(errors).toEqual([]);
    });

    test('regenerates the bank as an archetype is picked, and again on Regenerate', SMOKE, async ({ page }) => {
        const errors = await boot(page, 'bank', 'seed=5-5&tier=city');
        const bar = page.locator('.generator-bar');
        await expect(bar).toBeVisible();
        await bar.screenshot({ path: 'screenshots/generator-bar.png' });
        const bank = () => page.evaluate(() => {
            const g = (window as any).generated;
            return { archetype: g.archetype as string, tier: g.tier as string, seed: `${g.seed.layout}-${g.seed.population}` };
        });
        // A mark on the page survives regenerating, because the page doesn't reload.
        await page.evaluate(() => { (window as any).sameDocument = true; });
        const reloaded = async (act: () => Promise<unknown>) => {
            const before = (await bank()).seed;
            await act();
            await page.waitForFunction(seed => {
                const g = (window as any).generated, scene = (window as any).game.scene.getScene('bank');
                return g && `${g.seed.layout}-${g.seed.population}` !== seed && scene.sys.isActive() && scene.debugState.width === g.level.tiles[0].length * 16;
            }, before, { timeout: 60000 });
            expect(await page.evaluate(() => (window as any).sameDocument)).toBe(true);
            const now = await bank();
            expect(new URL(page.url()).searchParams.get('seed')).toBe(now.seed);
            // Still the viewer, not the game.
            expect(new URL(page.url()).searchParams.has('view')).toBe(true);
            return now;
        };
        let now = await reloaded(() => bar.getByRole('combobox', { name: 'Archetype' }).selectOption('atrium'));
        expect(now).toMatchObject({ archetype: 'atrium', tier: 'city' });
        await expect(bar.getByRole('combobox', { name: 'Archetype' })).toHaveValue('atrium');
        const atrium = now.seed;
        now = await reloaded(() => bar.getByRole('button', { name: 'Regenerate' }).click());
        expect(now.archetype).toBe('atrium');
        expect(now.seed).not.toBe(atrium);
        // A small branch has no CCTV operator to put on a mezzanine: that pick is greyed out with it.
        now = await reloaded(() => bar.getByRole('combobox', { name: 'Tier' }).selectOption('small'));
        await expect(bar.locator('option[value="mezzanineWatch"]')).toBeDisabled();
        expect(now.tier).toBe('small');
        // Back shows the bank before, still in the same page.
        now = await reloaded(() => page.goBack());
        expect(now).toMatchObject({ archetype: 'atrium', tier: 'city' });
        await page.locator('canvas').screenshot({ path: 'screenshots/regenerated.png' });
        expect(errors).toEqual([]);
    });
});

test('shows every room type furnished in the room gallery', SMOKE, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('/?scene=rooms');
    await page.waitForFunction(() => (window as any).game?.scene.getScene('bank')?.sys.isActive(), null, { timeout: 60000 });
    const cells = await page.evaluate(() => (window as any).gallery as { type: string; variant: string; x: number; y: number; w: number; h: number }[]);
    expect(new Set(cells.map(c => c.type)).size).toBeGreaterThanOrEqual(15);
    expect(new Set(cells.map(c => c.variant))).toEqual(new Set(['small', 'target', 'largest', 'L-shaped']));
    // Close up, the staff offices at their desks: the groups and the people the stations put there.
    const office = cells.find(c => c.type === 'staffOffice' && c.variant === 'target')!;
    await page.evaluate(([x, y]) => (window as any).game.scene.getScene('bank').lookAt(x, y), [(office.x + office.w / 2) * 16, (office.y + office.h / 2) * 16]);
    await page.waitForTimeout(400);
    await page.locator('canvas').screenshot({ path: 'screenshots/rooms-offices.png' });
    await page.evaluate(() => (window as any).game.scene.getScene('bank').toggleMap());
    await page.waitForTimeout(800);
    await page.locator('canvas').screenshot({ path: 'screenshots/rooms.png' });
    expect(errors).toEqual([]);
});

test('renders every prop in its four facings', SMOKE, async ({ page }) => {
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
