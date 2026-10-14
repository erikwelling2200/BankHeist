import { expect, test, type Page } from '@playwright/test';

/*
 * Visual regression: the canvas of fixed views, compared with the baselines in `visual.spec.ts-snapshots/`. Pages open
 * with `?still`, so nothing moves by itself, and the HTML over the canvas is hidden. A change to the art or the generator
 * changes these on purpose: look at the diff images in `test-results/`, then refresh with `npm run test:visual:update`.
 * `VISUAL_EXACT=1` allows no difference at all, for refactors that must not change a pixel.
 */
const exact = !!process.env.VISUAL_EXACT;
const tolerance = exact ? { threshold: 0, maxDiffPixels: 0 } : { threshold: 0.1, maxDiffPixelRatio: 0.002 };

const HIDE_HTML = '.generator-bar, .briefing, .camera-controls, .fullscreen-button, .hud { display: none !important; }';

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

/** The canvas matches its baseline; walls still sliding to their height settle first, as the shot waits to be stable. */
async function shot(page: Page, name: string): Promise<void> {
    await expect(page.locator('canvas')).toHaveScreenshot(`${name}.png`, { ...tolerance, timeout: 20000 });
}

const toggleMap = (page: Page) => page.evaluate(() => (window as any).game.scene.getScene('bank').toggleMap());

const BANKS: [string, string][] = [
    ['example', '/?bank=example'],
    ['city-twoWing', '/?seed=31-2&tier=city&archetype=twoWing'],
    ['hq-mezzanineWatch', '/?seed=15838-2&tier=hq&archetype=mezzanineWatch&plot=stripMallEnd'],
    ['small-fortress', '/?seed=31-2&tier=small&archetype=fortress']
];

test.describe('looks the same', { tag: '@visual' }, () => {
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
});
