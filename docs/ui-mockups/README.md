# UI mockups

Sources for the two claude.ai artifacts that show the UI in [docs/design/UI.md](../design/UI.md):

- [BankHeist UI design canvas](https://claude.ai/artifact/2rDHSmzanq7ZquC2S9nmtU): 32 boards on five pages.
- [Frame viewer](https://claude.ai/artifact/QQCaptekEV1Upr1MbVAMkY): the same boards rendered at 3×, with pinch zoom.

## What's here

| Path | What |
| --- | --- |
| `canvas/project/canvas.json` | Board placement, pages, order and the canvas notes. |
| `canvas/project/*.dc.html` | One file per board. The HUD is plain HTML inside `<x-dc>`; `<helmet>` loads the fonts. |
| `canvas/project/hud.css` | The HUD theme shared by every board: palette, crew colours, panels, Confirm, rail, ledger. |
| `canvas/project/img/` | Pixel-art frames, icons, portraits and legends. All of them are generated (see below). |
| `viewer/bankheist-ui-frames.html` | The viewer page. It expects `frames/<Board>.png` and `thumbs/<Board>.jpg` beside it. |
| `render.mjs` | Renders the boards locally in Chromium, without the canvas runtime. |

## Regenerating the images

The world frames, icons and legends come from the Python scripts in `scripts/ui-mockups/`, which need Pillow. They
reproduce `canvas/project/img/` byte for byte:

```sh
cd scripts/ui-mockups
python3 scenes.py ../../docs/ui-mockups/canvas/project/img        # all scenes, or name some: scenes.py <dir> aim watch
python3 icons.py ../../docs/ui-mockups/canvas/project/img         # 24px icons and 48px portraits
python3 legend.py ../../docs/ui-mockups/canvas/project/img        # the Visual language legends
```

`rules.py` holds the perception rules the frames are computed from, `bh.py` the bank and its art, and `ui2.py` the
world UI at twice the art resolution. `scenes.py` caches the unlit bank as `.base-cache.png` in the output folder; to
rebuild it, delete that file.

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
