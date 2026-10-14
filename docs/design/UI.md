# BankHeist UI

How the game's screens look and how they respond to touch. This spec turns §20 of [GAME_DESIGN.md](GAME_DESIGN.md)
into concrete layout, visuals and interactions, so it builds on §20 and doesn't repeat its rules. Where the two
disagree, GAME_DESIGN.md wins on rules and this file wins on presentation.

- **Mockups:** the [BankHeist UI design canvas](https://claude.ai/artifact/2rDHSmzanq7ZquC2S9nmtU) has 32 boards
  across five pages. The [frame viewer](https://claude.ai/artifact/QQCaptekEV1Upr1MbVAMkY) shows the same frames at 3×
  and lets you pinch-zoom any one of them. Both are private claude.ai artifacts, and their sources are in
  [docs/ui-mockups/](../ui-mockups/README.md).
- **Research:** [research/ui-and-touch.md](research/ui-and-touch.md) has the findings, and
  [research/ui-and-touch-claims.md](research/ui-and-touch-claims.md) has every claim, vote and source behind them.
- **Status:** nothing here is implemented yet. The current HUD (`src/ui/Hud.ts`) belongs to the stack demo.

## Principles

1. **Show, don't tell.** The answer is drawn where it happens: the tile that gets Jun seen, the guard who pays the
   suspicion, the hostage who will run. Text only names things (actions, people, numbers) and never explains a rule.
2. **Previews tell the truth.** Every tint, ring, cone and badge in a preview comes from the same rules as the
   outcome (the design's hard promise). The mockups' frames were computed from the §8.4 reaction matrix in
   `scripts/ui-mockups/rules.py`, not painted by hand.
3. **Two channels per state.** Colour never works alone: each unsafe tile also carries a glyph, each badge has a
   shape, and hatching always means "during the coming world phase".
4. **One preview at full strength.** The active action's overlay is drawn bright and everything else stays quiet.
   The overlay drawer is there for the rest (§20.4).
5. **Nothing the thumb covers.** Results draw away from the finger, and Confirm sits off the map.

## Two layers

| Layer | What | How |
| --- | --- | --- |
| **World UI** | Floor tints, paths, noise rings, cones, wedges, cover edges, plates, badges, pips, markers. | Pixel art drawn at **twice the art resolution**: 640×360 over the 320×180 art, so one UI pixel is half an art pixel. |
| **Screen UI** | Top strip, crew rail, buttons, Confirm, ledger, drawer, recap, and world-anchored chips with text ("Heard by", ledger rows). | HTML over the canvas (the current HUD approach), so type stays crisp at any scale. |

Each frame is composed in four layers: floor art, floor UI, actors, actor UI. Floor UI (tints, rings) sits under
people, and actor UI (plates, pips) sits over them. In Phaser that means a second camera or render texture at 2×
the art, or UI sprites at 0.5 scale on a 2× canvas. Both still give an integer scale on screen.

Glyphs sit on an 11–13px grid inside UI plates about 18px wide. HUD icons are 24px and portraits 48px, shown 1:1.

## Screen layout

Reference size: an 844×390 CSS px landscape phone (iPhone 14 class). Measurements are CSS px, and the map runs edge
to edge under everything.

| Area | Position | Contents |
| --- | --- | --- |
| **Top strip** | Top, between the rail and End turn, 32px high | State pill (QUIET, GO, LOUD, or the heat level and its next step), the schedule timeline before the Alarm or the police phase strip after it, the turn number, and the threat-ledger button with a count of live carriers. |
| **End turn** | Top right, 52×44 | Hold to end the turn. It fills while held. If crew have actions left, the unused pips on their portraits flash first. It is far from Confirm on purpose. |
| **Crew rail** | Left edge | One 54×62 card per crew member (60px wide when selected): portrait, 2 action pips (gold for the third action on GO), profile icon, HP bar, and carried loot or a van icon. |
| **Camera** | Bottom left | Tactical map and overlay drawer buttons, 44×44. |
| **Actions** | Right edge, above Confirm | A 2×2 grid of 52px buttons for the selected crew member's contextual actions, each showing its cost pips. GO is wider, with a gold border. |
| **Confirm** | Bottom right, 164×58 | The selected action's icon, its **name** ("MOVE", "FIRE ×6", "KILL PANEL") and its cost. Dimmed when nothing is previewed. |
| **Undo** | Left of Confirm, 44×44 | Undoes the last committed action (§6.6). |

**Safe areas.** Insets use `max(8px, env(safe-area-inset-*))`, and the mockups reserve 44px on both long edges for
the notch. Test Safari and the installed PWA separately, because they report different landscape insets.

**Thumb zones.** The left thumb gets crew and camera, and the right thumb gets actions, Confirm and Undo. The top
strip is read, not touched, except for the ledger button.

**Confirm's colour says what kind of commitment it is:**

| Colour | When |
| --- | --- |
| Cream | A clean action: no suspicion, no noise anyone hears. |
| Amber | The preview costs something: a pip on someone, an exposed tile, a noise someone hears. |
| Red | Lethal fire. |
| Steel blue | Commands and Watch. |

**Long-press an action button** to show its name in a tag beside it. Confirm always names the selected action, so
the player never has to memorise icons.

## Visual language

The tone is gritty, not cartoonish (§1), and the UI wears the game's own look: the HUD matches `src/style.css`, and
every mockup frame is rendered by the game itself (the example bank, its lighting and its people), with the world UI
drawn over it. World UI uses hairline strokes with a 1px ink drop shadow instead of fat outlines, muted signal colours,
faint scanline fills where an edge already carries the meaning, and dark plates with a thin border in the signal colour
instead of filled stickers. HUD panels are night-blue glass (`rgba(11, 13, 23, 0.72)`) with a thin cream border and
soft 6–8px corners. Labels and numbers use the system monospace (`ui-monospace, Menlo, Consolas`) with a hard drop
shadow, as the game's buttons do, and reading text uses the system sans. Pixel fonts were rejected because their 2 and
5 read as S and 8 in countdowns.

### Signal palette

| Meaning | Default | Colour-blind preset |
| --- | --- | --- |
| Safe | `#80be8a` sage | `#6a9fd0` blue |
| Suspicion | `#e2a240` sodium amber | `#d8c060` yellow |
| Exposed / hostile | `#d44638` brick red | `#c8508a` magenta |
| Command / your control | `#8ab6d6` steel blue | `#b8d8e8` pale blue |
| Cover | `#acd8f4` light blue | (unchanged) |
| GO and money | `#f2c94c` gold | (unchanged) |
| Text and neutral UI | `#f2e6c8` cream | (unchanged) |

### Crew

Each crew colour stays off the signal palette and shows up in three places: the mask, the ground ring, and the
pips that crew member causes, so a pip says who it is about.

| Crew | Colour | Mask |
| --- | --- | --- |
| Mara | `#60c0ce` teal | Balaclava |
| Jun | `#ce74b8` pink | Hockey mask |
| Dex | `#9684e0` violet | Skull bandana |
| Sol | `#dac8a2` sand | Respirator |

### Safe floor (§8.8)

Shown for the selected crew member when nothing else is previewed, and along the path while one is. The tile states
are:

- **Safe:** green tint.
- **+1 pip** and **+2 pips:** amber tint with that many pips.
- **Challenge:** amber with a hand.
- **Exposed:** red with an eye.
- **+1 next phase** and **exposed next phase:** the same states hatched.
- **Camera:** a camera glyph.
- **Unscouted:** grey.
- **Unknown risk:** grey with `?`.

The path's eye icon sits on the **first** unsafe tile, and long-pressing that tile answers who and why: the NPC's
position next phase is ghosted, with its cone and a sightline to the tile.

### Over heads

A dark plate, a glyph and, when there is a clock, a countdown. The states are:

- **Curious:** `?`
- **Alerted:** `!`
- **Alarm, radio, escape and phone carriers:** a bell, radio, runner or phone glyph with its countdown, never under 2.
- **Draws:** a hand on a gun.
- **Panicked:** waves.
- **Commanded:** a down arrow.
- **Tied:** cuffs.
- **Surprised:** a star.
- **Hears:** a noise badge naming the outcome.
- **Hostile:** a crosshair.

**Pips** sit above the badge: suspicion pips in the colour of the crew member who caused them, command pips in steel
blue. A dashed line in the crew colour links a new pip to its cause during the world phase.

### In the cone and in cover

- **Bodies in a shot cone** wear an outlined marker above the head: a red diamond for hostiles, a pale circle for
  civilians, a blue triangle for crew.
- **Half cover** is a 3px light-blue bar on the protected edge of the target's tile, with a soft glow and end ticks.
  When the shot comes from outside the cover's 90° arc, the bar becomes a dashed grey line (flanked, §11.4).

### Rings, cones and wedges

- **Noise rings** are the exact flood-filled tiles (§8.9), drawn as a thin outline with a faint fill. Everyone inside
  wears an ear badge naming what they'll do.
- **Shot cones** are nested arcs, one per bullet (§11.2). No hit percentages: the cone is the odds, and the fire
  selector (1–6 rounds) narrows it.
- **Watch wedges:** the crew's are steel blue and dragged into place, and police wedges are red and simply visible.
- **Command** shows as two rings, the blue command ring and the amber panic ring beyond it, with each NPC's outcome
  on its head and a resister's chance as a number (§10.1).

## Touch grammar

| Gesture | Effect |
| --- | --- |
| Tap a crew member or portrait | Selects them, and zooms to Act view if the camera is further out. |
| Tap a tile | Previews the move or action: the tap snaps to the nearest valid tile, and nothing is committed yet. |
| Tap the same tile again, or Confirm | Commits. |
| Drag that starts on the selected crew member | Draws a path. |
| Any other drag | Pans the view. The preview stays locked, and changing it takes a clean tap on another tile. |
| Pinch | Zooms in whole-pixel steps, from about 11 to 34 tiles high. The map button jumps to the whole plot. |
| Long-press | **Why.** On a tile: who notices it and from where. On an NPC: its cones. On a wall: its material and what opens it. On an action: its name. |
| Hold End turn | Ends the turn. |
| Drag in aim mode | Moves the aim point. The loupe sits above the finger and the cone extends from the drag point. |

The rule that a drag is only a path when it starts on the selected crew member exists because XCOM on iOS let a
finger drifting toward Confirm change the destination. It is design judgement, not a verified source, and needs a
playtest on a phone.

**Desktop** keeps the same layout and adds hover in place of long-press, right-click to cancel, and the hotkeys
from §20.7, which are printed as key caps on their buttons.

## Screens

The canvas has five pages. Each board shows one decision or one moment.

### HUD and visual language

- **Stealth: Jun selected.** The base screen: QUIET, the schedule timeline with its events (lunch, cash run,
  armoured car, patrol, closing), Jun's safe floor, and Confirm dimmed until something is previewed.
- **Layout and thumb zones.** The zones in the layout table above, drawn over the base screen.
- **Visual language.** The legends: tile states, badges, pips and markers, cover, the crew, the palette and the
  colour-blind preset, profiles and the action icon set.
- **Touch grammar.** The gestures table as pictures.
- **Research behind the UI.** Each verified finding beside where it shows up on the canvas.

### Stealth

- **1–3: one decision.** Jun's path ends on a hatched tile because the cleaner will see him next phase. A long-press
  shows who and why as a picture sentence. One turn later the same route is clean.
- **Multi-turn route and Wait for.** Mara's three-turn route with numbered turn ends. Guards on a known routine are
  drawn as dashed predicted markers. Wait for picks an event to skip to (a guard passing or leaving, the cash run,
  the next event), and the route runs on its own until a new NPC, an intent change, a carrier or a schedule event
  stops it.
- **Noise: quiet panel work.** The ring covers one tile and nobody is in it.
- **Noise: a pistol shot.** The ring floods the lobby and everyone inside wears a red ear badge.
- **Trespass challenge with a deadline.** A green path shows the nearest public tile Mara has to reach this turn.
- **World phase.** The guard turns, and a dashed line in Jun's colour links the guard's new pip to Jun. The
  playback controls are 1×, 2× and skip.
- **Long-press a wall.** The wall's material, and each tool that opens it shown with a tick or a cross.

### Alarm and takeover

- **Alarm carriers and the threat ledger.** Each carrier wears its clock (the teller's bell 2, the guard's radio 2, a
  customer escaping 3). The state pill shows the most urgent clock, and the ledger lists every clock sorted by
  urgency. Tap a row and the camera goes there.
- **GO previewed.** The rail turns gold: masks on and a third action each. Dex's shout shows both rings and each
  NPC's outcome, plus one resister's chance as a number.
- **The lobby held.** Everyone is face down with two blue command pips, the guard is tied, and Dex's hold ring
  outlines the room he keeps down.
- **Commands lapse a turn ahead.** A hostage whose pips ran out shows a red escape path. An off-duty cop shows a red
  hand: reaching for a weapon.

### Loud

- **Aim, full burst and two rounds.** The cone narrows as the fire selector drops from 6 to 2, until the bystander
  is outside it. The loupe sits above the finger.
- **Dragging a Watch wedge.** Dex's blue wedge is dragged into place, and the officer at the door has a red wedge of
  his own.
- **Police: announced versus visible.** Shown on screen: a breach marker on a window, a landed grenade with its
  radius, a sniper laser and a red wedge. Police out of sight are faded ghosts and sound pings (§13.6).
- **World phase in a firefight.** One unit at a time, with the active unit bracketed in red and a done/acting/next
  strip.
- **Negotiator on the line.** Release, trade, stall and hang up, with each option's effect shown as a heat or clock
  delta.
- **Bag relay.** A dotted throw arc lands on the catcher, and the van's loot counter goes up.
- **Driving the van.** Every footprint the van can reach is tinted, with the chosen spot bracketed and its swept path
  drawn. Crew who are not aboard are flagged.

### Map, planning and campaign

- **Tactical map and overlay drawer.** At this zoom a tile is too small to tap, so everything actionable becomes a
  large pin. The drawer toggles zones, all cones, cameras, cover, the sound map and wall materials.
- **Planning screen.** The plot is drawn as a blueprint: known rooms are solid and unscouted ones are outlines with
  `?`. It also shows each crew member's loadout and start, and the assets with their prices.
- **City map and the Squeeze.** Laid out like XCOM 2's Geoscape: the dossier top left, the Squeeze top centre with
  each complication on the day it lands, and money and crew top right.
- **Debrief.** Payout, each crew member's notoriety and injuries, the styles earned, and what the Squeeze does next.
- **Resume recap card.** The last three events, heat and police phase, each crew member's status, and the live
  threats (§20.6).
- **Desktop.** The same screen at desktop size with key caps on the buttons.

## Open questions

These rest on judgement and need phone playtests, starting with M1:

- **Gesture conflicts:** whether the path-versus-pan rule holds up.
- **Overlay budget:** how many overlays a phone screen can carry at once.
- **Touch target sizes at real zoom levels:** the floor is 44pt (Apple), 48dp (Material) or 24px (WCAG 2.2).
- **Act view zoom:** §20.1's "about 11 tiles high" gives about 6mm per tile on a phone, not the 10mm it also asks
  for. The mockups use about 12 tiles high and avoid relying on precise tile taps.
- **Integer scaling under Phaser's EXPAND mode:** this may need a variable internal width or letterboxing.
