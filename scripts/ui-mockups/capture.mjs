// Renders the world of every mockup frame with the game itself, so the mockups show the real art, lighting and people.
// Reads the shots scenes.py lists (cast.json) and drives the production build of the example bank (`?bank=example&still`):
// for each shot it replaces the people, restarts the bank scene, frames the camera (`left`, `top`: the view's corner in
// map pixels) at zoom 2 (2 CSS px per art pixel, the
// phone's close view) and screenshots the canvas, once with the cast and once without, and once with only the ghosts
// when there are any. scenes.py lifts the people out of the difference so floor overlays can go under them.
//
//   npm run build && npx vite preview --port 4173 &
//   node scripts/ui-mockups/capture.mjs <out-dir> [shot ...]      (BASE=http://localhost:4173 by default)
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';

const out = process.argv[2];
if (!out) throw new Error('Usage: node capture.mjs <out-dir> [shot ...]');
const only = new Set(process.argv.slice(3));
const base = process.env.BASE ?? 'http://localhost:4173';
const shots = JSON.parse(fs.readFileSync(path.join(out, 'cast.json'), 'utf8'));

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pages = new Map();

/** One page per viewport size, opened on the example bank with the HTML over the canvas hidden. */
async function pageFor(width, height) {
    const key = `${width}x${height}`;
    if (pages.has(key)) return pages.get(key);
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    // QUERY adds to the address, e.g. QUERY=people=noir to draw the cast in another style.
    await page.goto(`${base}/?bank=example&still${process.env.QUERY ? `&${process.env.QUERY}` : ''}`);
    await page.waitForFunction(() => window.game?.scene?.getScene('bank')?.debugState?.ready);
    await page.addStyleTag({ content: '.camera-controls,.fullscreen-button,.briefing,.generator-bar,.hud{display:none!important}' });
    await page.evaluate(() => { window.exampleBank = structuredClone(window.game.registry.get('bankData')); });
    // The first frame after loading compiles the camera's filters and comes out darker; render once to warm up.
    await render(page, { zoom: 2, left: 0, top: 0 }, [], path.join(out, '.warmup.png'));
    pages.set(key, page);
    return page;
}

/** Draws the bank with these people and this view, and returns the camera's top-left corner in map pixels. */
async function render(page, shot, people, file) {
    await page.evaluate(({ people, shot }) => {
        const data = structuredClone(window.exampleBank);
        data.people = people;
        if (shot.outlines) data.outlines = shot.outlines;
        for (const move of shot.moveProps ?? []) Object.assign(data.props.find(q => q.kind === move.kind), move);
        window.game.registry.set('bankData', data);
        const scene = window.game.scene.getScene('bank');
        window.lastTimings = scene.debugState.timings;
        scene.scene.restart();
    }, { people, shot });
    // Done when the restarted scene has drawn its first frame (its timings are a new object, filled in at the end).
    await page.waitForFunction(() => {
        const t = window.game.scene.getScene('bank')?.debugState?.timings;
        return t && t !== window.lastTimings && t['first frame'] !== undefined;
    });
    await page.evaluate(shot => {
        const scene = window.game.scene.getScene('bank');
        if (shot.outlines) scene.showKnowledge(false);
        if (shot.map) scene.toggleMap();
        else {
            while (scene.debugState.zoom > shot.zoom) scene.zoomStep(-1);
            while (scene.debugState.zoom < shot.zoom) scene.zoomStep(1);
            // Framed by the view's top-left corner in whole art pixels, so every capture of a shot lines up exactly.
            const zoom = scene.debugState.zoom;
            scene.lookAt(shot.left + innerWidth / zoom / 2, shot.top + innerHeight / zoom / 2);
        }
    }, shot);
    await page.waitForFunction(() => window.game.scene.getScene('bank').debugState.settled);
    await page.waitForTimeout(300);
    const where = () => page.evaluate(() => {
        const s = window.game.scene.getScene('bank'), cam = s.cameras.main;
        return { x: cam.worldView.x, y: cam.worldView.y, zoom: s.debugState.zoom, plot: s.debugState.plot };
    });
    const before = await where();
    await page.screenshot({ path: file });
    const after = await where();
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`The view moved during ${file}: ${JSON.stringify(before)} then ${JSON.stringify(after)}`);
    return before;
}

const views = {};
for (const [name, shot] of Object.entries(shots)) {
    if (only.size && !only.has(name)) continue;
    const page = await pageFor(shot.width ?? 844, shot.height ?? 390);
    const s = { zoom: 2, ...shot };
    views[name] = await render(page, s, shot.people, path.join(out, `${name}-world.png`));
    await render(page, s, [], path.join(out, `${name}-floor.png`));
    if (shot.ghosts?.length) await render(page, s, shot.ghosts, path.join(out, `${name}-ghosts.png`));
    console.log('captured', name, JSON.stringify(views[name]));
}
const viewsFile = path.join(out, 'views.json');
const known = fs.existsSync(viewsFile) ? JSON.parse(fs.readFileSync(viewsFile, 'utf8')) : {};
fs.writeFileSync(viewsFile, JSON.stringify({ ...known, ...views }, null, 1));
await browser.close();
