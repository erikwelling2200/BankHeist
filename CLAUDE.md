# BankHeist

Top-down 2D pixel-art stealth game. Phaser 4 + TypeScript + Vite, shipped as an offline-capable PWA on GitHub Pages.

## Game design
- `docs/design/GAME_DESIGN.md` is the source of truth for how the game plays: rules, numbers, canonical tables and the
  milestone order (§22). The current playable content is only a stack demo and doesn't reflect it.
- `docs/design/visual-preview.md` holds the visual style card, the lighting model and the example bank built to settle
  them (`/?bank=example`). The default page (`/`) is a generated bank: the procedural generator of §17 lives in
  `src/gen/` and `docs/design/generator.md` maps it to the design (seeds in the address, `?seed=layout-population`,
  plus `tier`, `archetype` and `plot`). The old stack demo is at `/?scene=demo`, the prop sheet at `/?scene=props`, the
  police officer's animation preview at `/?scene=officer`.
- `docs/design/research.md` holds the key research findings behind each design decision, with the full notes per area in
  `docs/design/research/`.
- The design's hard promises: the safe-floor overlay and every preview use the same rules as the real outcome; every
  alarm carrier shows a countdown of at least 2; no NPC raises an alarm, draws a weapon or breaches without a telegraphed
  intent, and grenades land a phase before they go off. Full previews are for stealth only; in combat, police announce
  only breach points and decide movement and targets when they act (§13.6).

## Commands
- `npm run dev` – Vite dev server with hot reload.
- `npm run typecheck` / `npm test` – TypeScript and Vitest unit tests (pure logic in `src/logic`, `src/level`, `src/gen`).
  `tests/generator.test.ts` builds every tier and archetype and checks §17.7 on each.
- `npm run test:e2e` – builds, serves the production build and drives it in Chromium with Playwright. Writes `screenshots/*.png`.
- `npm run screenshot` – only the boot test; the fastest way to look at the current visuals.

## Verifying changes
- Run typecheck, unit tests and e2e before pushing. For any visual change, read `screenshots/start.png` (and add a
  screenshot to the relevant e2e test when a new feature isn't visible at boot) – don't call visual work done unseen.
- `window.game` and `window.Phaser` are exposed; `game.scene.getScene('vault').debugState` gives test-friendly state,
  and `window.generated` the generated bank (its rooms, people, keys, ways in and validation report).
- The generator only places what fits: give a new prop a catalog entry and art first, then place it through a parcel
  (`src/gen/parcels.ts`) with the `Furnisher`, which rejects props that don't fit between walls or touch another box.
- In the cloud sandbox Playwright uses the preinstalled Chromium at `/opt/pw-browsers`, which is why `@playwright/test`
  is pinned to 1.56.1. Bumping it needs a matching browser.

## Rendering
- Internal resolution is 320x180 with `pixelArt: true`, scaled to fit with nearest-neighbour filtering. Keep art on a
  16px grid (`TILE`).
- The bank scene sets its own resolution: the screen's device pixels over a whole-number zoom (`BankScene.applyZoom`,
  steps from `src/logic/zoom.ts`, §20.1), by changing the game config's base size and calling `scale.refresh()` – a
  plain `setGameSize` is undone by `EXPAND`. Pan, zoom and the tactical map buttons are HTML (`src/ui/CameraControls.ts`).
- Lighting: Phaser's Light2D (objects opt in with `setLighting(true)`; normal maps are the texture's data source;
  `render.maxLights` is 32 and lights beyond that are silently dropped) shines through walls, so the bank doesn't use
  it. Its lamps are baked with Light2D's formula in `src/art/bank/lamps.ts`, traced against the walls; light anything
  new in the bank through `BankScene.bake`, and move people with `BankScene.movePerson`, which relights only them. The demo and the prop sheet still use Light2D.
- All art is generated in `src/art` from palette grids, with a height per colour that becomes the normal map. Real art
  can replace it by loading PNGs plus `-n.png` normal maps in a preload scene and keeping the `TEX` keys.
- Every object is a box at a real scale (`src/level/space.ts`: 1px ≈ 8cm, people 1.75m, walls cut at 1.9m). Floor tiles
  are square and heights full scale, but the tops of things are drawn at `TOP_DEPTH` (2/3) of their depth, so long
  things pointing at the camera don't look tall; `View` applies it, draw with it. Before
  drawing a new item, give it a `CATALOG` entry in `src/level/catalog.ts`: real width, depth and height, elevation if
  mounted, where it stands (centred, against which edge, between two tiles) and which way it faces. Every prop needs
  all four facings, each **drawn by hand as pixel art** on a `View` (`src/art/bank/view.ts`), which knows the
  projection so each view fits the object's box; take every view's geometry from one set of measurements, as
  `src/art/bank/van.ts` does, so the four agree. `View` has tools for the common shapes: `Turn` maps the prop's own
  frame to a facing and draws its boxy parts with every visible face painted by hand; `cylinder` draws round bodies with
  curved normals; `project`/`dot` place freehand shapes (leaves, a rope). Draw anything curved as a curve, never as a
  stack of boxes: that gives a voxel look. Check props on
  `/?scene=props`, which shows each facing south, east, north and west. The scene places and orders each prop from its
  box; tests reject boxes that intersect each other or a wall.
- Walls stand on the edges between tiles at their real thickness (`src/level/walls.ts`), never on tiles; the level plan
  is drawn at double resolution (`src/level/bank.ts`, legend in `src/level/plan.ts`). Their tops follow the floor grid, unforeshortened,
  and always show the wall in section (dark, hatched). Walls north of the middle of the screen stand full height; the
  rest are cut down to `CUT_HEIGHT` (`BankScene.updateWalls`), so paint wall faces by height above the floor, and
  anything whose look depends on a wall's height (its exposure, the cloud shadows, dressing hung on it) has to follow it.
- Before generating or restyling art, read `docs/pixel-art/PROMPTING.md` (rules) and `docs/pixel-art/README.md`
  (findings, example scripts in `scripts/pixel-art/`); before animating, `docs/pixel-art/animation.md`.
- Animated characters are keyed poses painted by a rig (`src/art/bank/officer.ts`: joints per frame, hand-drawn head,
  shoe and gun pieces), so volumes stay identical between frames. Choreography is data: cels with durations, a whole-pixel
  `step` or `glide` for the footing and cues (`src/logic/timeline.ts`); a side-on walk steps exactly as far as the
  planted foot slides back in the drawing. Hold every telegraph (an aim, a glance) at least 300ms.
- Camera post-processing (bloom, vignette) lives in `VaultScene.create`. Phaser's vignette goes near black at its
  radius, so keep `strength` low.
- The HUD is an HTML overlay (`src/ui/Hud.ts`) so text stays crisp, not canvas text.
- Scale mode is `EXPAND`: height stays 180px and width follows the screen's aspect ratio, so never assume a 320px-wide
  view – position screen-space UI from `this.scale.width`/`height`.
- Fullscreen (`src/ui/Fullscreen.ts`) puts the whole document fullscreen (so the HUD stays visible) on first touch in
  a browser tab. iPhone Safari has no Fullscreen API; there only the installed PWA is fullscreen.

## Deploy
Pushing to `main` runs `.github/workflows/deploy.yml`: tests, then builds and deploys to GitHub Pages. Vite uses
`base: './'`, so the build works under any sub-path and survives repo renames. The service worker (vite-plugin-pwa, `registerType: autoUpdate`) caches everything for offline play.
