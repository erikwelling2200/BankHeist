# Asking Claude for pixel art

Instructions for requesting art, and the rules Claude should follow when making it. Background and examples are
in [README.md](README.md).

## What to put in the request

- **Canvas and grid:** the image size and tile size (the game uses 320x180 and a 16px grid).
- **Camera:** top-down, ¾ top-down or side view. Say which way characters face.
- **Light:** time of day, main light direction and the light sources in the scene.
- **References:** named games or images, and what to take from each (palette, proportions, mood).
- **Palette:** a named palette (Endesga32, PICO-8, …) or the game's own colours, and roughly how many colours.
- **Scope:** ask for a whole set at once (characters, tiles, props) so it shares one style.
- **Process:** ask for 2–3 critique passes before it is shown.

Example:

> Make a 32x32 top-down security guard, facing down, with a 4-frame walk cycle. Light from the top left. Use the
> palette in `src/art`. Style like Hotline Miami: chunky, high contrast, dark outlines. Do 3 critique passes and
> show me the sprite sheet at 8x.

## Rules for Claude

1. **Write a style card first.** Turn the references into 4–6 concrete rules (palette families, proportions,
   outline treatment, lighting, focal point) and put it at the top of the script.
2. **Lock the palette before drawing.** Build hue-shifted ramps: darks drift cooler, lights drift warmer, the
   lightest steps desaturate. Snap the finished image to the palette.
3. **Draw flat, light separately.** Albedo colours, then a light map (ambient + point lights + shafts), plus an
   emissive layer for things that glow. Quantise the light into a few bands.
4. **Dither only where bands meet.** Never across whole gradients.
5. **Keep one light direction.** Rim light, cast shadows and sel-out outlines all follow it. No pillow shading.
6. **Make figures readable first.** Silhouette, value contrast against the floor, a contact shadow. Detail last.
7. **Give every object a place in 3D before drawing it.** Decide its real size (width, depth, height in metres), its
   elevation if it hangs or is mounted, and where it stands in its tiles: centred, against which edge, in a corner, or
   on the line between two tiles. In this game that goes in `src/level/catalog.ts` (1px is about 8cm, walls are cut at
   1.9m, people are 1.75m); the painter draws to that box and the scene places it, so proportions and positions stay
   consistent and no two objects intersect (the lobby tests check this). Every object needs **all four facings**, each
   drawn as pixel art for that angle (rendering one 3D model four ways gives a pre-rendered, voxel look and loses the
   deliberate pixel choices). Keep the four honest by drawing them from one set of measurements in the world's
   projection, so a door, an axle or a window sits at the same place in every view.
8. **Generate characters from one parametric function** so a cast stays consistent, and vary build, hair,
   clothing, props and pose.
9. **See, critique, fix.** Render, look at the full image and an 8x crop, list what is wrong against the style
   card, fix, re-render. At least 2 passes, at most 3–4 before showing.
10. **Report honestly.** Say what still looks wrong when delivering.

## Things that went wrong before (avoid)

- Bright saturated colours, thick black outlines and big heads read as a kids' game.
- Ordered dithering over every gradient makes surfaces noisy.
- Locking a small palette can push colours to the wrong hue family (green marble went purple); add ramps for each
  material.
- Strong rim light on both top and left edges frames dark clothing in light grey; keep left rims soft.
- Light-coloured figures standing in a bright shaft wash out; darken their clothes or move them.
