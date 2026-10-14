# UI mockups

Sources for the two claude.ai artifacts that show the UI in [docs/design/UI.md](../design/UI.md):

- [BankHeist UI design canvas](https://claude.ai/artifact/2rDHSmzanq7ZquC2S9nmtU): 32 boards on five pages.
- [Frame viewer](https://claude.ai/artifact/QQCaptekEV1Upr1MbVAMkY): the same boards rendered at 3×, with pinch zoom.

The mockups wear the game's own look. Every world frame is rendered by the game itself (the example bank at
`/?bank=example`, its lighting and its people, at the phone's close zoom), and the HUD uses the game's HUD styling
(`src/style.css`). Only the world UI (tints, rings, cones, plates) and the HUD are drawn for the mockups.

## What's here

| Path | What |
| --- | --- |
| `canvas/project/canvas.json` | Board placement, pages, order and the canvas notes. |
| `canvas/project/*.dc.html` | One file per board. The HUD is plain HTML inside `<x-dc>`. |
| `canvas/project/hud.css` | The HUD theme shared by every board, in the game HUD's colours, corners and type. |
| `canvas/project/img/` | Frames, legends, icons and portraits. All of them are generated (see below). |
| `viewer/bankheist-ui-frames.html` | The viewer page. It expects `frames/<Board>.png` and `thumbs/<Board>.jpg` beside it. |
| `render.mjs` | Renders the boards locally in Chromium, without the canvas runtime. |

## Regenerating the images

One command, from the repo root (needs Python 3 with Pillow):

```sh
scripts/ui-mockups/render-all.sh            # every scene, or name some: render-all.sh aim watch
```

It exports the example bank's level (`export-level.test.ts`), builds and serves the game, and for each scene:

1. `scenes.py cast` writes who stands where (look, tile, facing, pose, mask) and the view's corner;
2. `capture.mjs` loads the build, swaps in that cast, frames the camera at zoom 2 and screenshots the canvas twice,
   with and without the cast;
3. `scenes.py compose` draws the floor UI over the empty capture, lifts the people out of the difference, and draws
   the actor UI on top.

Then `legend.py` builds the Visual language legends from those captures, `icons.py` draws the 24px HUD icons and the
48px portraits (in the game's palette and the crew's looks), and everything lands in `canvas/project/img/`.

`level.py` reads the exported level (walls on tile edges, doors, glass, furniture) and `rules.py` holds the perception
rules the overlays are computed from, so every tint, ring and cone follows GAME_DESIGN.md rather than being painted.
`ui2.py` draws the world UI at twice the art resolution.

When a board's frame changes, check the HTML on top of it: chips, fingers, the loupe and the map pins are placed in
screen pixels over the frame. A tile's middle is at `tx · 32 + plot.left + 16`, `ty · 32 + plot.top + 16`, with `plot`
from `docs/ui-mockups/out/frames/views.json`.

## Looking at the boards

```sh
node docs/ui-mockups/render.mjs              # every board at 1x into docs/ui-mockups/out/
node docs/ui-mockups/render.mjs Main Aim     # just these
node docs/ui-mockups/render.mjs --viewer     # 3x frames and thumbnails for the viewer
```

The rendered output is ignored by git.

## Publishing

The canvas is a claude.ai design-canvas artifact and the viewer is a plain HTML artifact. To update them, ask Claude
Code to republish from this folder:

- **Canvas:** set the root to `docs/ui-mockups/canvas`, map each `project/...` file, and use the URL above.
- **Viewer:** run `render.mjs --viewer` first, then publish `viewer/bankheist-ui-frames.html` with `frames/` and
  `thumbs/` at the viewer URL.
