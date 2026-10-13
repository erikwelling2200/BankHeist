# Pixel art with Claude: findings

Notes from a session in which Claude generated pixel art entirely in code (Python + Pillow + numpy, no image
model), iterating on a bank lobby scene. The scripts are in `scripts/pixel-art/` and every version of the output is
in `examples/`. How to ask for new art is in [PROMPTING.md](PROMPTING.md).

## What Claude can and can't do

Claude has no image generator. It writes a script that places every pixel, renders it, looks at the render and
edits the script. That makes it:

- **Good at:** limited, consistent palettes; tiles and props on a grid; simple sprites with clear silhouettes;
  procedural texture (dithering, noise, glow); lighting passes; whole sets that share one style; pipeline work such
  as sprite sheets, normal maps and engine import settings.
- **Weak at:** expressive poses and fluid animation; hero characters at the quality of a pixel artist; large,
  hand-composed scenes. Expect prototype-quality art for characters and decent final art for tiles, props and
  effects.
- **Not available in the cloud sandbox:** Aseprite (not installed, and GitHub downloads are blocked by the network
  policy). Claude can still write PNG sprite sheets with Aseprite-style JSON, or Lua scripts to run in your own
  Aseprite.

## Best practices found online, and how they were applied

There is no official Anthropic guidance on this. These come from community Claude skills and general pixel art
guides (sources at the bottom).

| Practice | Applied in `bank_lobby.py` |
| --- | --- |
| Lock the palette before drawing; use hue-shifted ramps (shadows cooler, highlights warmer), not darker/lighter copies of one colour | `PAL` is built from `ramp()` calls; the finished image is snapped to it with `snap()` |
| Dither sparingly; over-dithering looks noisy | Light is quantised into 5 bands and dithered only in a narrow strip where two bands meet (`edge`) |
| One consistent light direction; avoid pillow shading | Sun comes from the back windows; rim light and cast shadows all follow it |
| Write a style card of rules from the references and apply it everywhere | `STYLE CARD` comment at the top of the script |
| See, critique, fix: render, check against the rules, edit, re-render, at least 2–3 passes | Every version below came from 2–3 passes |
| Silhouette first, readable at target size; four strong frames beat twelve weak ones | Figures get a lit rim and contact shadow so they read against the floor |
| Specify grid size, palette and perspective; generate a set at once | One generator builds the whole cast so it shares proportions and palette |

## Techniques that made the biggest difference

1. **Lighting pass instead of painted shading.** Draw flat "albedo" colours, then multiply by a light map built
   from point lights and window shafts, and add an emissive layer (sky, screens, signs) that ignores lighting. This
   is what moved the scene from cartoonish to moody.
2. **Quantise light, then snap to the palette.** Banded light plus a locked palette is what keeps it reading as
   pixel art rather than a blurred painting.
3. **Narrow-band dithering.** Ordered (Bayer) dithering across every gradient made the floor noisy; limiting it to
   band edges cleaned it up.
4. **Sprite ID buffer.** Every sprite paste records its ID per pixel. That makes per-object effects cheap:
   - *Rim light:* pixels whose top or left neighbour belongs to a different object get a warm highlight, scaled by
     how much sun falls there. Strong in a sun shaft, faint in shade.
   - *Sel-out outlines:* outlines are a darkened version of the colour they border, and the sun-facing ones turn
     warm brown instead of black.
5. **Cast shadows by shearing.** Each sprite pixel at height `h` above its feet casts to
   `(x + 0.3h, feet + 0.8h)`, which matches the slant of the sun shafts. The shadow only removes sunlight, not
   ambient light.
6. **A parametric character generator.** `person()` builds front and back views from a spec (skin, hair style,
   clothing kind, build, props, seated, step), so a varied cast stays consistent.

## Iteration log

| Version | Change | Lesson |
| --- | --- | --- |
| [v1](examples/bank-v1-cartoon.png) | Bright, saturated, thick black outlines, chibi people | Reads as a kids' game |
| [v2](examples/bank-v2-night.png) | Night, muted materials, lighting pass with ordered dithering | Mood is right; dither everywhere is noisy |
| [v3](examples/bank-v3-night-palette-locked.png) | Locked hue-shifted palette, narrow-band dither, rim on figures | Locking the palette first pushed greens and reds to purple; needed more ramps |
| [v4](examples/bank-v4-day-rim-light.png) | Daytime: sun shafts, cast shadows, rim light per object ([close-up](examples/rim-light-closeup.png)) | Rim light adds a lot of depth where it follows a real light |
| [v5](examples/bank-v5-day-detailed-people.png) | People redrawn in a Door Kickers: Action Squad style ([cast](examples/people-sheet.png)) | Strong rims frame dark clothing; keep top rims strong and left rims soft |

Earlier test, a Hyper Light Drifter style set: [scene](examples/hld-test-scene.png),
[idle animation](examples/hld-test-character-idle.gif), [tiles](examples/hld-test-tiles.png),
[prop](examples/hld-test-crystal.png).

### Known weak spots in v5
- Faces lose detail under full sun at this size; the teller in a sun shaft is nearly washed out.
- The seated pose reads more like a short standing person.
- Queue figures overlap heavily.
- Sun shafts cross the counter front, which a real counter would partly block.

## Relation to the game

The game itself renders at 320x180, top-down, with Phaser Light2D and normal maps generated from per-colour heights
(`src/art`). The examples here are a ¾ view at 256x176 with lighting baked into the image. What carries over
directly: the locked hue-shifted palette, the style card, the sel-out outlines and the critique loop. Rim light
and cast shadows would come from Light2D and the normal maps in-engine, not be baked in.

## Running the scripts

```bash
pip install pillow numpy
python3 scripts/pixel-art/bank_lobby.py out/      # bank_lobby_1x.png and bank_lobby.png (4x)
python3 scripts/pixel-art/hld_test_set.py out/    # character sheet, idle GIF, tiles, crystal, scene
```

## Sources

- [Pixel Art Studio (Claude skill)](https://github.com/Gamezxz/pixel-art-studio)
- [Pixel Art skill (Claude Marketplaces)](https://claudemarketplaces.com/skills/omer-metin/skills-for-antigravity/pixel-art)
- [Pixel Art Creator skill](https://www.skillsdirectory.com/skills/willibrandon-pixel-art-creator)
- [Raymond Camden: Pixel Art via Vibe Coding](https://www.raymondcamden.com/2025/05/02/pixel-art-via-vibe-coding)
- [Sorceress: How to Make Pixel Art without pushing pixels](https://sorceress.games/blog/how-to-make-pixel-art-without-pushing-pixels-in-aseprite)
- [Morphic: Pixel art AI](https://morphic.com/de/resources/images/pixel-art-ai)
- [Pixnote: Shading & Lighting](https://pixnote.net/en/learn/shading)
- [Wayline: Shading and light](https://www.wayline.io/learn/pixel-art/3)
- [Door Kickers: Action Squad on Steam](https://store.steampowered.com/app/686200/) (style reference)
