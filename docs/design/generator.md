# The procedural bank generator

How `src/gen/` builds a bank from GAME_DESIGN §17. The design document stays the source of truth for what a bank must
be; this page says where each part of it lives in the code and where the implementation simplifies.

The default page (`/`) shows a generated bank. Its seed is in the address: `?seed=layout-population`, plus `tier`,
`archetype` and `plot` to pin those (`small` · `city` · `hq`; `twoWing` · `atrium` · `threeKeys` · `fortress` ·
`mezzanineWatch`; `midBlock` · `cornerLot` · `plazaFront` · `stripMallEnd`). The hand-made example bank is at
`?bank=example`. The **Briefing** panel names the bank and its headline features and lists the vault and its keys, the
ways in, the timeline, the intel journal and the checks it passed. It also rolls a new bank, keeps the building with new
people, and switches the map to what the blueprint shows (§17.8).

## The pipeline (§17.2)

`generateBank` in `generate.ts` runs the recipe; each stage forks its own random stream (`rng.ts`), so a roll added to
one stage doesn't reshuffle the others.

| Step | Where | What it does |
| --- | --- | --- |
| 1. Plot | `plot.ts` | One of four city-block templates: the main street along the bottom, the alley along the top, the bank's lot in the building band with 2–4 neighbour slots. A corner lot has a side road, a strip-mall end a parking lot in front and a back lot, a plaza front a plaza between the fronts and the sidewalk. Most plots have a far side with an office tower. |
| 2. Archetype | `layout.ts` | Places the bank's rooms with the fixed orientation (§17.1): vault at the back, lobby at the front. **Two Wing**: a corridor down each wing, both meeting the vault corridor. **Three Keys**: Two Wing, with the manager's office and the CCTV room as far apart as the lot allows and the vault always on a time lock. **Mezzanine Watch**: the CCTV room raised behind the teller line, behind glass, up its own stairs. **Atrium**: a big lobby ringed by offices, the offices on one side upstairs off a gallery, a skylight. **Fortress**: a concrete core with the vault, a ring corridor round it, soft outer walls. Half of all layouts are mirrored. |
| Programs | `layout.ts` `program` | Each strip of the lot (a wing along its corridor, the band behind the teller line, the closets beside the vault, the fortress core) is a program: the rooms the archetype wants there, in order, each at its type's target area (`ROOM_RULES[type].area`), and space to spare becomes more rooms with jobs (counting room, records room, staff office, conference room, see below) instead of a stretched hall. No staff or secure room exceeds its type's most area. A strip ten or more tiles across puts two rooms side by side where one would be a thin strip, the far one entered through its neighbour (or from the teller line in front of the band behind it), split to keep both near square. Only the lobby, the loading bay and the corridors stay big. |
| Shape moves | `shapes.ts` | Neighbouring rooms trade a corner block two to four tiles each way: one gets a notch, the other an L, a corridor a bay, a room an alcove. Each move is scored by a shape cost per room type (steps from a rectangle and concavity: free in a corridor, cheap in a break room or the records, dear in an office or a secure room) plus area off target, and kept when it lowers the cost or on a seeded roll, up to a budget per bank: about a third of the staff and secure rooms end up non-rectangular. Every room stays in one piece, no U-shapes, nothing narrower than two tiles and no arm of a room under three (a two-tile alcove at most); rooms that met still meet, secure rooms meet nobody new (the CCTV room stays off the vault corridor), and the core, the teller line, the stairs, the gallery, the street row and the lobby's counter row keep their shape. A room is then its `parts` (largest first), its x, y, w and h their bounding box; the site's owner grid says which room each tile is in. |
| 3. Core first | `layout.ts` `backBand` | The vault and its antechamber (and the mantrap from the city branch up) against the back wall. Secure closets go on one side, the service end (loading bay, back door) on the other, the vault corridor across in front. The CCTV room always goes in another wing. |
| Walls and doors | `build.ts`, `rooms.ts` | Walls wherever two rooms meet. The material follows from what the rooms are (§14.1): vault steel round the vault (metre-thick stone in an old bank), concrete round the secure core, plaster between staff rooms, brick outside, plaster outside on a Fortress. The street front gets piers, windows, glass doors and the ATM. Each room type opens onto the first room its rules allow (`ROOM_RULES`), then the archetype adds the links that make its loops; no door opens through the counter's row. A layout where a room can't be reached is rolled again (a layout is checked for this before it is built, and up to twelve are rolled per lot). Then up to two **locked shortcuts** (`shortcuts`): where two rooms of the bank share a wall but the walk between them through the doors there are takes 20 steps or more, a door in that wall (keycard into a secure room, a lock otherwise; never into the core, the CCTV or counting room, the public floor or the counter). |
| Neighbours | `neighbours.ts` | Café, vacant shop (a soft party wall to breach), shop, parking garage (a hidden getaway spot), building site (scaffolding up to the roofs, behind a chain-link fence), office tower (lobby, stairwell, the rented sniper nest upstairs). |
| 4. Key graph | `keys.ts` | Every hard lock (vault, mantrap, CCTV door, counting-room door, alarm panel) gets a social, a technical and a violent key (§15.2), with the people who hold the social one. |
| 5. Fill | `parcels.ts`, `furnish.ts` | Every room type has three or more hand-authored parcels, each also mirrored: six or more variants. A parcel places its fixed pieces and records stations (where staff and customers stand), alarm buttons, camera slots, loot, and the spots for roof hatches, floor grates and vents. A parcel is laid out in the room's largest rectangle; its prop slots then take random cover from a pool anywhere along the room's walls, arms included, and a big room gets more cover (and a second table in a big break room or office). The new rooms have interim parcels from the same pieces (a counting table with cash carts, storage walls of shelving, rows of desks, a meeting table), until furnishing by activity (Interiors, step 3). The teller counter runs along the edge the teller line shares with the lobby, and its gate is the one opening through it. `Furnisher` accepts a prop only if it fits between the walls, touches nothing in 3D, keeps the tiles in front of doors free and, for dressing, hangs on a solid wall. |
| Ways in | `approaches.ts` | At least four approaches from three categories (§17.5), their markers placed in the world. **Social**: the front door, the staff door. **Covert**: the roof route from a ladder or the scaffolding to a hatch or the skylight, the sewer from a manhole to a floor grate, an air duct. **Forced**: ramming the glass front, the shutter, a soft wall from next door. Plus the getaway spots, plot exits and police staging. |
| 6. Population and schedule | `security.ts`, `population.ts` | Cameras go in the parcels' slots, each covering a tile people must cross. Guards get a lobby post with a short loop, patrol routes through staff and secure rooms, and the security chief at HQ. Then, from the **population seed**: staff at their stations, the crowd for the time of day, hidden traits (off-duty cops, a hero, a teller in debt, the dye-pack drawer), the day's timeline (§16.3) and each person's schedule, and 3–5 opportunities (§17.6) with how they are found. |
| 7. Validate | `validate.ts`, `nav.ts` | The eight checks of §17.7 on a navigation grid. After every ten failed rolls one rule is relaxed, in the fixed order of `RELAX_ORDER`. A relaxed rule is still checked; it no longer rejects the bank, and the briefing names it only when this bank actually breaks it. |
| 8. Present | `src/ui/Briefing.ts`, `BankScene.showKnowledge` | The briefing panel and the blueprint layer: staff and secure rooms shown as `?` outlines that follow their shapes. Lamps hang on a grid in each of a room's rectangles (`roomLamps`), so none hangs over a neighbour. |

### The rooms

The rooms of §17.4, each with its rules in `ROOM_RULES` (zone, light, floor, what it opens onto and how that door
locks, target and most area). The programs add four with jobs where a wing has space to spare:

- **Counting room** (secure, keycard): cash being counted, loot; its door is a hard lock (§15.2) the head teller and
  the manager carry the card for. Beside the vault, in the fortress core, or behind the counter, opening onto it.
- **Records room** (staff, a lock): storage walls of files, the branch records as intel (an opportunity, §17.6).
  Repeats up to twice in a bank.
- **Staff office** (staff, keycard): the loan officers' open-plan desks. As many as the space needs.
- **Conference room** (staff, a lock): a meeting table. Repeats up to twice.

The **layout seed** fixes the building and everything in it that doesn't move (furniture, cameras, guard posts, the ways
in). The **population seed** fixes who is there and when. Replaying a layout seed with a new population seed keeps the
building and changes the people (a unit test checks this).

## Tiers (§17.3)

`tiers.ts` holds the numbers. A small branch is about 32×22 with one guard, record-only cameras and an M vault on a time
lock. A city branch is about 40×28: two guards, an operator with four monitors, the mantrap, dual control, dye packs
and sometimes the armoured car. A regional HQ is about 48×32: three or four guards and the security chief, motion
sensors in the vault, the metal detector at the doors. A whole plot comes out at about 60–80 tiles wide by 40–50 deep.

## Headline features (§17.6)

1–2 per bank. Atrium and Mezzanine Watch have theirs built in: the skylight entry and the mezzanine CCTV room. The
others are rolled from what the bank can have:
- **Scaffolding next door**: forces a building site beside the bank.
- **Old bank**: metre-thick stone round the vault.
- **Armoured car**: city branch and up; couriers on the timeline and the time lock opens.
- **Manager working late**: closing time moves later.
- **Drive-through**: corner lot or strip-mall end; a two-tile teller window in a staff room on the lane side (the ATM room, break room, office or closet), with a counter along it, its own teller, alarm button and cash drawer, and a tube terminal on the lane.
- **Bank in a mall**: strip-mall end; a second pair of front doors and a bigger crowd.

## The checks (§17.7)

All are checked on the grid: walls stop movement and sight, doors pass whatever their lock (the keys exist), glass and
railings pass sight, full-height furniture blocks sight, and no step climbs more than a third of a storey without
stairs.

- **Every approach reaches the vault**: from each approach's inside end. Also at least four approaches, from three
  categories, with one covert way that reaches the CCTV room or the alarm closet.
- **Clean-profile route**: from the lobby to the CCTV room or the alarm closet. It may not use a vault door, and may
  not enter a secure room before the one it ends in.
- **Loops**: at least two door-disjoint ways from the Public rooms to the Secure ones (a max-flow over doors), and every
  zone connected at least twice.
- **Guard overlap**: at most three guards see any one tile, counting each guard's 8-tile, 140° cone from their post
  and from every corner of their route.
- **Useful cameras**: each camera's 7-tile, 70° cone covers a door's threshold or a corridor tile.
- **Alarms and exits**: every alarm station is reachable from the lobby, and every lobby tile is within 28 steps of a
  public exit.
- **Getaways**: every getaway spot drives (by road, alley, garage or site) to at least two plot exits.
- **Vault depth**: at least two doors between the public floor and the vault, and the CCTV room doesn't open onto the
  corridor that leads into the core.

## Interiors (in progress)

The first generated banks read as big empty rectangles: a wing's last room stretches to fill what is left, and a
parcel sized for a typical room furnishes it. The plan, from [research/procedural-interiors.md](research/procedural-interiors.md):

1. **Shapes and programs** (done). A room is a union of rectangles (`parts`), not one. Each strip of the lot gets a
   program of rooms with target areas; space a program can't use becomes another room with a job (counting room,
   records room, staff office, conference room) instead of stretching one, two side by side across a wide wing. Then
   bounded, scored shape moves between neighbouring rooms: a corner handed to a neighbour (a notch and an L), a
   corridor bay, an alcove. The shape cost counts corners and concavity per room type, corridors exempt; no U-shapes,
   no arm under two tiles (three in a room, but for an alcove); the hardened core and the teller line stay rectangles.
   A locked shortcut goes where two adjacent rooms are far apart by walking. Built as described in the pipeline above
   (Programs, Shape moves, Walls and doors); `tests/generator.test.ts` checks it on every tier, archetype and plot over
   three seeds. A sweep of all of them over four seeds (224 banks) all pass §17.7, at 1.2 rolls each, with about 30%
   of the staff and secure rooms non-rectangular and shortcuts in nine banks in ten. Still to do from this step: the
   column bay in a wide hall, and a kitchenette (the break room has its kitchen).
2. **Props to furnish with.** Second-tier props that stand on desks and counters (a monitor, a lamp, paperwork, a mug,
   a photo, a cash counter, a microwave) with a per-prop elevation, and floor props for the new rooms and stories (a
   meeting table, a coat stand, a whiteboard, cash bags, a cleaning trolley, a wet-floor sign).
3. **Furnishing by activity.** Each room type is a program of functional groups (workstation, manager's desk with
   visitor chairs, meeting table, counting table, storage wall, kitchenette, lounge, locker bank, server row), each an
   anchor and satellites at set offsets and facings, with clearance tiles where they are used. The walks between a
   room's doors are kept free first. Groups are placed by scored candidates (backed onto a wall, in a corner, by a
   window, away from the door) with the `Furnisher` as the hard filter, and their number scales with the room's area.
4. **Stories.** A pass per room from its type and occupant: one or two vignettes (coffee on the desk, cash bags
   waiting, a cake in the break room, a sticky note with a code that is an opportunity), never the same twice in a bank.
5. **Metrics.** Shape cost, floor seen from the doors and tall-cover tiles per room in the validation report, asserted
   in the tests, so a change that makes rooms read as empty again fails.

## Where it simplifies

- The population, schedules, key graph and opportunities are **data**. The stealth rules that act on them (vision,
  suspicion, schedules running turn by turn) are M1 work (§22). In the preview only the patrols walk.
- Parcels are authored as code (three or more per room type, mirrored) that adapts to the room's size, not as fixed
  4-tile blocks.
- Every vault uses the round vault door art. The parking garage has no raised firing line yet. A bank in a mall is a
  strip-mall bank with more doors and more people, not a mall concourse.
