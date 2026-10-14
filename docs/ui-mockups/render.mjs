// Renders the canvas boards locally without the design-canvas runtime: strips the <x-dc> wrapper, keeps the markup and
// hud.css, and screenshots each board in Chromium at its preview size.
//
//   node docs/ui-mockups/render.mjs                 every board, 1x, into docs/ui-mockups/out/
//   node docs/ui-mockups/render.mjs Main Layout     only these boards
//   node docs/ui-mockups/render.mjs --viewer        3x PNG frames and 1x JPEG thumbnails into viewer/frames and viewer/thumbs
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const project = path.join(here, 'canvas', 'project');
const args = process.argv.slice(2);
const viewer = args.includes('--viewer');
const canvas = JSON.parse(fs.readFileSync(path.join(project, 'canvas.json'), 'utf8'));
const wanted = args.filter((a) => !a.startsWith('--')).map((a) => a.replace(/(\.dc\.html)?$/, '.dc.html'));
const boards = wanted.length ? wanted : canvas.order;

const out = path.join(here, 'out');
fs.mkdirSync(out, { recursive: true });
const shots = viewer ? [{ dir: path.join(here, 'viewer', 'frames'), scale: 3, type: 'png' }, { dir: path.join(here, 'viewer', 'thumbs'), scale: 1, type: 'jpeg' }]
  : [{ dir: out, scale: 1, type: 'png' }];
for (const s of shots) fs.mkdirSync(s.dir, { recursive: true });

const browser = await chromium.launch();
for (const file of boards) {
  const src = fs.readFileSync(path.join(project, file), 'utf8');
  const body = src.split('<x-dc>')[1].split('</x-dc>')[0];
  const helmet = (body.match(/<helmet>([\s\S]*?)<\/helmet>/) || [, ''])[1];
  const content = body.replace(/<helmet>[\s\S]*?<\/helmet>/, '');
  const size = src.match(/\$preview":\{"width":(\d+),"height":(\d+)/);
  const [width, height] = size ? [+size[1], +size[2]] : [844, 390];
  const page = path.join(out, file.replace('.dc.html', '.html'));
  fs.writeFileSync(page, `<!doctype html><html><head><meta charset="utf-8"><base href="file://${project}/"><link rel="stylesheet" href="hud.css">${helmet}</head>`
    + `<body style="margin:0">${content}</body></html>`);
  for (const s of shots) {
    const tab = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: s.scale });
    await tab.goto('file://' + page);
    await tab.evaluate(() => document.fonts.ready);
    const name = file.replace('.dc.html', s.type === 'png' ? '.png' : '.jpg');
    await tab.screenshot({ path: path.join(s.dir, name), type: s.type, ...(s.type === 'jpeg' ? { quality: 86 } : {}) });
    await tab.close();
  }
  console.log('rendered', file);
}
await browser.close();
