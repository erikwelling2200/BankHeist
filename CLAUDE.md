# BankHeist

Top-down 2D pixel-art stealth game. Phaser 4 + TypeScript + Vite, shipped as an offline-capable PWA on GitHub Pages.

## Game design
- `docs/design/GAME_DESIGN.md` is the source of truth for how the game plays: rules, numbers, canonical tables and the
  milestone order (§22). What is playable is M1 (stealth core) in one pinned small branch.
- `docs/design/UI.md` specifies the screens, visual language and touch grammar; the mockups' sources are in
  `docs/ui-mockups/`.
- `docs/design/visual-preview.md` holds the visual style card, the lighting model and the example bank built to settle
  them (`/?bank=example`). The generated-bank viewer is at `/?view`: the procedural generator of §17 lives in
  `src/gen/` and `docs/design/generator.md` maps it to the design (seeds in the address, `?view&seed=layout-population`,
  plus `tier`, `archetype` and `plot`, and the generator bar). The prop sheet is at `/?scene=props`, the
  police officer's animation preview at `/?scene=officer`, and the room gallery at `/?scene=rooms`: every room type the
  generator furnishes, in four sizes and shapes, furnished and staffed by the real parcels (`src/gen/gallery.ts`;
  `?seed=` picks other parcels). Check furnishing changes there first. The stealth HUD (`src/ui/hud/`) is at `/?scene=hud` over a blank
  page with sample view models (`&state=` picks one, `&text=1.3` scales the text, `&cb` the colour-blind palette, `&bare` hides the picker).
- The default page (`/`) is the game: the pinned M1 bank (`PLAY_BANK` in `src/boot.ts`), or the saved heist's bank,
  played through the Session; another bank is `?play&seed=…`, and `?new` starts afresh. A bare `?seed=…` (an old link
  from when the viewer was the default page) opens the viewer as `?view&seed=…`, never a heist. Three layers, each only calling the one below:
  - `src/sim/` is the rules engine (implementation plan §2): pure and deterministic, no Phaser, clock or
    `Math.random`. A read-only `World` built once from the bank (`worldFromBank`) and a plain-JSON `State`; every
    change is a `Command` through `commit(world, state, cmd)` (or `preview`, which may not roll dice), giving the new
    state and its `SimEvent`s, and the world phase runs registered hooks. Previews and the safe floor run the same
    rules on copies, which is how they promise the real outcome.
  - `src/game/` is the `Session`: it owns world and state, commits, undoes, autosaves to `localStorage` and resumes
    (`heist.ts` builds the crew at the van), queues events for playback and makes the HUD's view models.
  - `BankScene` draws it: `src/scenes/bank/sim.ts` (people and doors from the state, playback), `input.ts` (taps and
    path drags), `overlay.ts` (the 2× world UI) and the HTML HUD (`src/ui/hud/`).
  `window.sim` is the debug handle (`sim.path(crew, to)`, `sim.safeFloor`, `sim.waitFor`, `sim.effect` for scripted
  runs; the M1 run in `e2e/play.spec.ts` plays through it alone); `debugState.play` and `tileOnPage(x, y)` help e2e tests.
- `docs/design/research.md` holds the key research findings behind each design decision, with the full notes per area in
  `docs/design/research/`.
- `docs/design/implementation-plan.md` is the build plan for the game rules (architecture of `src/sim`, work packages per milestone with checkboxes); tick packages off as they land.
- The design's hard promises: the safe-floor overlay and every preview use the same rules as the real outcome; every
  alarm carrier shows a countdown of at least 2; no NPC raises an alarm, draws a weapon or breaches without a telegraphed
  intent, and grenades land a phase before they go off. Full previews are for stealth only; in combat, police announce
  only breach points and decide movement and targets when they act (§13.6).

## Commands
- `npm run dev` – Vite dev server with hot reload.
- `npm run typecheck` / `npm test` – TypeScript and Vitest unit tests (pure logic in `src/logic`, `src/level`, `src/gen`).
  `tests/generator.test.ts` builds every tier and archetype and checks §17.7 on each. Tests get generated banks through
  `cachedBank` (`tests/bankCache.ts`): once per run in memory, and on disk in `.cache/banks/` keyed by a hash of the
  generator's sources, so a warm `npm test` skips the generator (any change to a file it imports rebuilds;
  `BANK_CACHE=0` turns the disk off). Tests of the generator itself call `generateBank`.
- `npm run test:changed` – only the unit tests that import a file changed since the last commit
  (`test:changed:main`: since `main`).
- `npm run sweep` – generates every tier × archetype × plot from several seeds (`SWEEP_SEEDS`, default 4; pin one with
  `SWEEP_TIER`, `SWEEP_ARCHETYPE`, `SWEEP_PLOT`) and prints validity, attempts, time per bank and per room type its
  size against the program's target and max, how many are shaped and how full they are. Run it after generator changes.
- `npm run test:e2e` – builds, serves the production build and drives it in Chromium with Playwright (all but the visual
  regression tests). Writes `screenshots/*.png`. `E2E_PORT` serves it on another port than 4173, so two checkouts can
  test at once without one reusing the other's server. Tests run at 656x368 (project `small`, the least height that
  opens at zoom 2: half the frame time of 960x540), except those tagged `@layout` or `@visual` (project `full`,
  960x540) and those that set their own viewport; tag a test `@layout` when it depends on the screen size. Play tests
  open `?still` with playback at the skip speed unless they watch the animation (`boot(page, q, { instant: false })`).
- `npm run test:e2e:dev`, `test:smoke:dev`, `e2e:one -- '<grep>'` – the same against the Vite dev server (no build;
  `E2E_DEV=1` does it for any run), reusing one already up on the port (5173, or `E2E_PORT`). The service worker test
  skips itself there.
- `npm run test:smoke` – only the e2e tests tagged `@smoke` (boot, a generated bank, regenerating in the page, the room
  gallery, the prop sheet): a minute or so here, build included. Tag a test with `SMOKE` to add it.
- `npm run test:visual` – visual regression: the canvas of fixed views (the example bank and three generated banks at
  their start view and on the tactical map, the room gallery, the prop sheet) against the baselines in
  `e2e/visual.spec.ts-snapshots/`. Pages open with `?still`, so no cloud drifts, nobody patrols and no dust flies, and
  the HTML over the canvas is hidden. `npm run test:visual:update` rewrites the baselines.
- `npm run screenshot` – only the boot test, against the build.
- `npm run shot -- '<url or path>' [--out f.png] [--size 844x390] [--wait settled|<selector>|<ms>]` – a screenshot
  without the test runner, from the dev server (reused, or started and left running), in the e2e tests' Chromium; waits
  for the walls to settle. `--setup <name>` (repeatable; `--list` names them) jumps the game to a situation first
  through `window.sim`: presets in `e2e/setups.ts` (`mara-selected`, `jun-selected`, `mara-armed`,
  `beside-guard`, `alarm-countdown`, `panel-half-done`, `dragging-body`). `--many '<url>' '<url>' …` shoots several pages in one browser. Prints each stage's time.

## Fast loop
- Looking: `npm run shot -- '/?view&seed=31-2'` (or `--setup …`), then read the PNG: ~5 s with a warm dev server.
- Iterating: `npm run test:changed` for the unit tests your change touches, `npm run e2e:one -- '<test name>'` or
  `test:smoke:dev` for the e2e tests, all without a build.
- The gate before a push is still the full sequence: typecheck, `npm test`, `npm run test:e2e` (production build).

## Verifying changes
- Run typecheck, unit tests and e2e before pushing (`test:smoke:dev` or `e2e:one` for a quick check while working). For any visual
  change, read `screenshots/start.png` (and add a screenshot to the relevant e2e test when a new feature isn't visible at
  boot) – don't call visual work done unseen.
- Changing the art, the lighting or the generator changes the visual baselines on purpose: run `npm run test:visual`,
  look at the `-diff.png` (and `-actual.png`) images it leaves in `test-results/`, and when every change is one you meant,
  run `npm run test:visual:update` and commit the new baselines. A change that must not alter the look (a refactor, a
  speed-up) has to pass `VISUAL_EXACT=1 npm run test:visual`, which allows no pixel of difference. CI doesn't run the
  visual tests: the baselines come from this sandbox's software renderer.
- `window.game` and `window.Phaser` are exposed; `game.scene.getScene('bank').debugState` gives test-friendly state,
  and `window.generated` the generated bank (its rooms, people, keys, ways in and validation report). The bank scene's
  `debugState.timings` gives the milliseconds each stage of building the bank took (also in the browser's performance
  timeline as `bank: <stage>`, with `bank: generate` for the generator), and `settled` whether the walls have reached
  their height.
- The generator only places what fits: give a new prop a catalog entry and art first, then place it through a parcel
  (`src/gen/parcels.ts`) with the `Furnisher`, which rejects props that don't fit between walls or touch another box.
- In the cloud sandbox Playwright uses the preinstalled Chromium at `/opt/pw-browsers`, which is why `@playwright/test`
  is pinned to 1.56.1. Bumping it needs a matching browser.

## Rendering
- Internal resolution is 320x180 with `pixelArt: true`, scaled to fit with nearest-neighbour filtering. Keep art on a
  16px grid (`TILE`).
- The bank scene sets its own resolution: the screen's device pixels over a whole-number zoom (`BankCamera.applyZoom`,
  steps from `src/logic/zoom.ts`, §20.1), by changing the game config's base size and calling `scale.refresh()` – a
  plain `setGameSize` is undone by `EXPAND`. Resizing a WebGL canvas waits for the GPU (~100 ms here), so zooming in
  keeps the canvas, draws the camera into its corner and scales it in CSS. Pan, zoom and the tactical map buttons are HTML (`src/ui/CameraControls.ts`).
- Lighting: Phaser's Light2D (objects opt in with `setLighting(true)`; normal maps are the texture's data source;
  `render.maxLights` is 32 and lights beyond that are silently dropped) shines through walls, so the bank doesn't use
  it. Its lamps are baked with Light2D's formula in `src/art/bank/lamps.ts`, traced against the walls; light anything
  new in the bank through `Baker.bake`, and move people with `BankScene.movePerson`, which relights only them. The prop sheet and the officer preview still use Light2D.
- `BankScene` only puts the bank together from its parts in `src/scenes/bank/`: `bake.ts` (the `Baker`: lighting,
  exposure, texture upload, light maps), `floor.ts`, `walls.ts` (and their cut-away heights), `props.ts`, `people.ts`
  (patrols, relighting), `knowledge.ts` (the blueprint layer), `atmosphere.ts` (clouds, dust) and `camera.ts` (zoom,
  map, pan, pinch). Building a bank is the wait the player feels, so keep it fast: textures go up as raw pixels
  (`Baker.addPixels`, not canvases, which once took a third of it), lamp reach is traced only where it is asked for, and
  normals are worked out only where light falls.
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
  rest are cut down to `CUT_HEIGHT` (`Walls.update`), so paint wall faces by height above the floor, and
  anything whose look depends on a wall's height (its exposure, the cloud shadows, dressing hung on it) has to follow it.
- Before generating or restyling art, read `docs/pixel-art/PROMPTING.md` (rules) and `docs/pixel-art/README.md`
  (findings, example scripts in `scripts/pixel-art/`); before animating, `docs/pixel-art/animation.md`.
- Animated characters are keyed poses painted by a rig (`src/art/bank/officer.ts`: joints per frame, hand-drawn head,
  shoe and gun pieces), so volumes stay identical between frames. Choreography is data: cels with durations, a whole-pixel
  `step` or `glide` for the footing and cues (`src/logic/timeline.ts`); a side-on walk steps exactly as far as the
  planted foot slides back in the drawing. Hold every telegraph (an aim, a glance) at least 300ms.
- Camera post-processing (bloom, vignette) lives in `BankCamera.setup` (`src/scenes/bank/camera.ts`). Phaser's vignette goes near black at its
  radius, so keep `strength` low.
- The HUD is an HTML overlay (`src/ui/hud/`) so text stays crisp, not canvas text.
- Scale mode is `EXPAND`: height stays 180px and width follows the screen's aspect ratio, so never assume a 320px-wide
  view – position screen-space UI from `this.scale.width`/`height`.
- Fullscreen (`src/ui/Fullscreen.ts`) puts the whole document fullscreen (so the HUD stays visible) on first touch in
  a browser tab. iPhone Safari has no Fullscreen API; there only the installed PWA is fullscreen.

## Deploy
Pushing to `main` runs `.github/workflows/deploy.yml`: tests, then builds and deploys to GitHub Pages. The test job runs in Playwright's own image (`mcr.microsoft.com/playwright:v1.56.1-noble`) so CI doesn't depend on the runner's OS; bump that tag together with `@playwright/test`. Vite uses
`base: './'`, so the build works under any sub-path and survives repo renames. The service worker (vite-plugin-pwa, `registerType: autoUpdate`) caches everything for offline play.
