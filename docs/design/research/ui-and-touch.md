# UI and touch interaction

Research note from October 2026, made for the UI mockups. A deep-research workflow searched six angles, fetched 26
sources and extracted 102 claims. It then had three independent verifiers check 25 of them: 21 survived and 4 were
refuted. A few targeted searches afterwards filled small gaps; those are marked *secondary*. The mockups that apply
these findings live on a claude.ai design canvas ("BankHeist UI"). The scripts that render its pixel-art frames are in
`scripts/ui-mockups/`.

## Verified findings

1. **Colour never carries a state alone.** Important information needs at least two channels (colour plus shape,
   pattern, icon or text), key colours should be player-selectable, and red against green fails for the most common
   colour blindness. ([XAG 103](https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/103),
   [XAG 102](https://devdocs.xbox.com/build/game-principles/accessibility/xag-deep-dives/xag-102-contrast.md),
   [AbleGamers APX](https://accessible.games/accessible-player-experiences/access-patterns/distinguish-this-from-that/))
   → Every unsafe safe-floor tile carries a glyph as well as its tint: pips for amber, an eye for red, a hand for a
   trespass challenge, `?` for unknown. Hatching keeps its single meaning, "during the coming world phase". The
   mockups also show a colour-blind preset that uses blue, yellow and magenta.
2. **Contrast 4.5:1 for HUD text and icons** (3:1 for large elements, 7:1 in a high-contrast mode), measured against
   the busiest part of the background, with a backing plate if needed. ([XAG 102](https://devdocs.xbox.com/build/game-principles/accessibility/xag-deep-dives/xag-102-contrast.md))
   → Every chip, badge and countdown sits on a dark plate with an ink outline.
3. **Respect the safe area and size the layout from the real viewport**, even in a landscape-only game; let the art
   run edge to edge. Safari and the installed PWA report different landscape insets (WebKit bug 236445), so test both
   and use `max(8px, env(safe-area-inset-*))`. ([Apple HIG: Layout](https://developer.apple.com/design/human-interface-guidelines/layout))
4. **Integer scaling in device pixels keeps pixel art crisp.** A fractional `devicePixelRatio` makes some art pixels
   larger than others. Text belongs in the HTML HUD. (2–1 vote on the "integer device pixels" step.)
   ([MDN](https://developer.mozilla.org/en-US/docs/Games/Techniques/Crisp_pixel_art_look),
   [phaser-pixui](https://github.com/skhoroshavin/phaser-pixui))
5. **Show the system exactly, in the world.** Mark of the Ninja's noise ring shows exactly how far a noise carries
   ("not obtrusive, but certainly clear"), so players learn the rules without failing.
   ([Game Developer interview with Nels Anderson](https://www.gamedeveloper.com/design/reinventing-stealth-in-2d-with-i-mark-of-the-ninja-i-))
   → Noise rings are the exact flood-filled tiles, drawn as a thin outline with a faint fill, with a labelled ear badge
   on everyone inside.
6. **Telegraph actions a phase ahead, without hit percentages** (Into the Breach). (2–1 vote: Into the Breach still
   has Grid Defense and random spawns.) ([PC Gamer](https://pcgamer.com/into-the-breach-preview))
7. **Tap to preview, then confirm.** XCOM on iOS confirms with a double-tap or a button. Its documented pitfall is a
   finger drifting across the map on its way to the button and changing the destination.
   ([Shacknews](https://www.shacknews.com/article/79824/mobile-review-xcom-enemy-unknown))
   → Confirm is fixed in the bottom-right corner, off the map. Once a preview is showing, a drag that doesn't start on
   the selected crew member only pans, and changing the preview takes a clean tap on another tile.
8. **Design touch-first.** Into the Breach's mobile release redesigned its touch interface for phones, and XCOM 2's
   touch controls were judged better than its console controls. Tapping a unit and then its destination works well on
   a crowded board. ([Android Police](https://www.androidpolice.com/into-the-breach-android-netflix-games/),
   [TouchArcade](https://toucharcade.com/2020/11/09/xcom-2-collection-ios-review-ipad-pro-iphone-comparison-ps4-dlc-download-controls/))
   → The phone layout is the base. Desktop adds hover (in place of long-press) and hotkeys.
9. **Fixed regions for persistent meta state.** XCOM 2's Geoscape puts objectives top left, the doom clock top
   centre and resources top right. ([XCOM wiki](https://xcom.fandom.com/wiki/Geoscape_(XCOM_2)), low confidence)
   → City map: dossier top left, the Squeeze top centre, money and crew top right.

*Secondary:* minimum touch targets are 44pt (Apple), 48dp (Material) and 24px, or 44px enhanced (WCAG 2.2).
([summary](https://specification.website/spec/accessibility/touch-target-size/))

## Refuted

- "XCOM on iOS moves units by dragging a path" (0–3).
- "XCOM felt cramped even on an iPad" (0–3).
- "XCOM 2's phone touch targets take getting used to" (1–2).
- "AbleGamers prescribes recolouring rather than fixing one presentation" (1–2).

## Not covered by any verified source

These still rest on design judgement and should be checked in phone playtests, starting with M1:

- **Gesture conflicts.** The mockups use these rules: a drag that starts on the selected crew member draws a path, any
  other drag pans, and two fingers zoom.
- **Overlay budget.** The active preview is shown at full strength; everything else comes from the overlay drawer.
- **Interaction details:** the loupe, long-press conventions, and the layout of the timeline, threat ledger and recap
  card.
- **Type.** Pixelify Sans was dropped because its 2 and 5 read as S and 8, which is unacceptable for countdowns.
  The revision below replaced the interim pixel font with condensed sans type.
- **Pacing and planning:** playback speed and planning-screen conventions.

## Revision: UI at twice the art resolution

The first mockups drew world-space UI on the 16px art grid. That made glyphs 5–7 pixels wide, too few to tell a
radio from a phone, and pushed the style toward chunky white-on-red stickers that read as cartoonish against the
gritty tone (§1). The mockups now use:

- **A UI layer at twice the art resolution.** World-space UI is drawn at 640×360 over the 320×180 art, so one UI
  pixel is half an art pixel. Glyphs sit on an 11–13px grid. Frames are composed in four layers, as the game would
  draw them: floor art, floor UI (tints, paths, rings, cones), actors, actor UI (plates, pips, markers). In Phaser
  this means a UI camera or render texture at 2× the art, or UI sprites at 0.5 scale on a 2× canvas.
- **A restrained style.** Hairline strokes with a 1px ink drop shadow instead of fat outlines. Muted signal colours
  (sage, sodium amber, brick red, steel blue). Faint scanline fills where the edge carries the meaning. Dark plates
  with a thin border in the signal colour instead of filled badges.
- **The HUD to match.** Icons are on a 24px grid shown 1:1 (they were 12px shown at 2×). Portraits are 48px (they
  were 24px), with a hard side light and four distinct masks: balaclava, hockey mask, skull bandana and respirator.
  Panels are square-cornered with hairline borders. Type is Oswald for labels and numbers and Share Tech Mono for
  small data.

## Revision: named actions and visible cover

- **The selected action is named on Confirm** ("MOVE", "FIRE ×6", "SHOUT"), with its icon and action cost, and is
  dimmed while nothing is previewed. Players don't have to memorise the icon set: the name sits on the button they
  commit with, under the same thumb. Long-pressing any action button shows its name beside it.
- **Half cover is a light-blue bar on the protected edge** of the target's tile, with a soft glow and end ticks, in
  place of a small shield icon that was easy to miss. When the shot comes from outside the cover's 90° arc, the bar
  turns into a dashed grey line (flanked), which matches §11.4's "greyed out when flanked".

## A conflict in the design document

§20.1 asks for a close zoom of "about 11 tiles high" and also for "a tile roughly 10mm". A landscape phone screen is
about 65–70mm tall, so 11 tiles gives about 6mm per tile. A 10mm tile would mean a zoom of about 6–7 tiles high. The
mockups use about 12 tiles (a 16px tile drawn at 32 CSS px). They never depend on tapping a tile precisely: taps snap
to valid tiles, the tactical map uses large pins, and aiming has a loupe.
