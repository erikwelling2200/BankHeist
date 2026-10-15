import { expect, test, type Page } from '@playwright/test';

/*
 * Visual regression: the canvas of fixed views, compared with the baselines in `visual.spec.ts-snapshots/`. Pages open
 * with `?still`, so nothing moves by itself, and the HTML over the canvas is hidden. A change to the art or the generator
 * changes these on purpose: look at the diff images in `test-results/`, then refresh with `npm run test:visual:update`.
 * `VISUAL_EXACT=1` allows no difference at all, for refactors that must not change a pixel.
 */
const exact = !!process.env.VISUAL_EXACT;
const tolerance = exact ? { threshold: 0, maxDiffPixels: 0 } : { threshold: 0.1, maxDiffPixelRatio: 0.002 };

const HIDE_HTML = '.generator-bar, .briefing, .camera-controls, .fullscreen-button { display: none !important; }';

/** Opens `path` with `?still`, hides the HTML over the canvas and waits for `scene` to run. */
async function open(page: Page, path: string, scene = 'bank'): Promise<string[]> {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${path}${path.includes('?') ? '&' : '?'}still`);
    await page.waitForFunction(s => (window as any).game?.scene.getScene(s)?.sys.isActive(), scene, { timeout: 60000 });
    // Hidden before the tactical map is framed, so the map doesn't leave room for the generator bar.
    await page.addStyleTag({ content: HIDE_HTML });
    return errors;
}

/** Waits for `count` frames to be drawn: what the page just asked for (a new view, the map) shows only on the next one. */
const frames = (page: Page, count: number) => page.evaluate(n => new Promise<void>(done => {
    const game = (window as any).game;
    const tick = () => (--n <= 0 ? done() : game.events.once('postrender', tick));
    game.events.once('postrender', tick);
}), count);

/** The canvas matches its baseline, once the walls have slid to the height the view asks of them. */
async function shot(page: Page, name: string): Promise<void> {
    await frames(page, 2);
    await page.waitForFunction(() => (window as any).game.scene.getScene('bank')?.debugState.settled !== false, null, { timeout: 20000 });
    await frames(page, 2);
    await expect(page.locator('canvas')).toHaveScreenshot(`${name}.png`, { ...tolerance, timeout: 60000 });
}

const toggleMap = (page: Page) => page.evaluate(() => (window as any).game.scene.getScene('bank').toggleMap());

const BANKS: [string, string][] = [
    ['example', '/?bank=example'],
    ['city-twoWing', '/?view&seed=31-2&tier=city&archetype=twoWing'],
    ['hq-mezzanineWatch', '/?view&seed=15838-2&tier=hq&archetype=mezzanineWatch&plot=stripMallEnd'],
    ['small-fortress', '/?view&seed=31-2&tier=small&archetype=fortress']
];

test.describe('looks the same', { tag: '@visual' }, () => {
    // Software WebGL draws a whole plot slowly, and each shot waits for two identical frames.
    test.describe.configure({ timeout: 120000 });

    for (const [name, path] of BANKS) {
        test(`${name} bank at its start view and on the tactical map`, async ({ page }) => {
            const errors = await open(page, path);
            await shot(page, `${name}-start`);
            await toggleMap(page);
            await shot(page, `${name}-map`);
            expect(errors).toEqual([]);
        });
    }

    test('room gallery on the tactical map', async ({ page }) => {
        await page.setViewportSize({ width: 1600, height: 1000 });
        const errors = await open(page, '/?scene=rooms');
        await toggleMap(page);
        await shot(page, 'rooms-map');
        expect(errors).toEqual([]);
    });

    test('prop sheet', async ({ page }) => {
        const errors = await open(page, '/?scene=props', 'props');
        const sheet = await page.evaluate(() => (window as any).game.scene.getScene('props').debugState);
        // The whole sheet at one screen pixel to a pixel.
        await page.setViewportSize({ width: sheet.width, height: sheet.height });
        await page.evaluate(([w, h]) => {
            (window as any).game.scale.setGameSize(w, h);
            (window as any).game.scene.getScene('props').cameras.main.setSize(w, h);
        }, [sheet.width, sheet.height]);
        await shot(page, 'props');
        expect(errors).toEqual([]);
    });

    test('play mode: the world UI over a new heist with Mara selected', async ({ page }) => {
        const errors = await open(page, '/?play&new');
        await page.waitForFunction(() => (window as any).sim, null, { timeout: 60000 });
        await page.addStyleTag({ content: '.sh, .play-speed, .play-toast { display: none !important; }' });
        await page.evaluate(() => (window as any).sim.session.select('mara'));
        await frames(page, 2);
        await page.waitForFunction(() => (window as any).game.scene.getScene('bank')?.debugState.settled !== false, null, { timeout: 20000 });
        await frames(page, 2);
        // The game's canvas with the world UI layer over it.
        const box = (await page.locator('canvas').first().boundingBox())!;
        await expect(page).toHaveScreenshot('play-select.png', { ...tolerance, clip: box, timeout: 60000 });
        expect(errors).toEqual([]);
    });
});
