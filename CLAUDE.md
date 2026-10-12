# BankHeist

Top-down 2D pixel-art stealth game. Phaser 4 + TypeScript + Vite, shipped as an offline-capable PWA on GitHub Pages.

## Game design
- `docs/design/GAME_DESIGN.md` is the source of truth for how the game plays: rules, numbers, canonical tables and the
  milestone order (§22). The current playable content is only a stack demo and doesn't reflect it.
- `docs/design/research.md` holds the key research findings behind each design decision, with the full notes per area in
  `docs/design/research/`.
- The design's hard promises: the safe-floor overlay and every preview use the same rules as the real outcome; every
  alarm carrier shows a countdown of at least 2; no NPC starts an alarm, draws, breaches, throws or holds an overwatch
  angle without a telegraphed intent (routine moving and shooting adapts when it happens, §13.6).

## Commands
- `npm run dev` – Vite dev server with hot reload.
- `npm run typecheck` / `npm test` – TypeScript and Vitest unit tests (pure logic in `src/logic`, `src/level`).
- `npm run test:e2e` – builds, serves the production build and drives it in Chromium with Playwright. Writes `screenshots/*.png`.
- `npm run screenshot` – only the boot test; the fastest way to look at the current visuals.

## Verifying changes
- Run typecheck, unit tests and e2e before pushing. For any visual change, read `screenshots/start.png` (and add a
  screenshot to the relevant e2e test when a new feature isn't visible at boot) – don't call visual work done unseen.
- `window.game` and `window.Phaser` are exposed; `game.scene.getScene('vault').debugState` gives test-friendly state.
- In the cloud sandbox Playwright uses the preinstalled Chromium at `/opt/pw-browsers`, which is why `@playwright/test`
  is pinned to 1.56.1. Bumping it needs a matching browser.

## Rendering
- Internal resolution is 320x180 with `pixelArt: true`, scaled to fit with nearest-neighbour filtering. Keep art on a
  16px grid (`TILE`).
- Lighting is Phaser's Light2D: objects opt in with `setLighting(true)`; normal maps are the texture's data source.
  `render.maxLights` is 32 – lights beyond that are silently dropped, so raise it if a scene gets busier.
- All art is generated in `src/art` from palette grids, with a height per colour that becomes the normal map. Real art
  can replace it by loading PNGs plus `-n.png` normal maps in a preload scene and keeping the `TEX` keys.
- Before generating or restyling art, read `docs/pixel-art/PROMPTING.md` (rules) and `docs/pixel-art/README.md`
  (findings, example scripts in `scripts/pixel-art/`).
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
