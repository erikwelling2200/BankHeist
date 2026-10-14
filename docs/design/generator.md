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
| 2. Archetype | `layout.ts` | Places the bank's rooms as rectangles with the fixed orientation (§17.1): vault at the back, lobby at the front. **Two Wing**: a corridor down each wing, both meeting the vault corridor. **Three Keys**: Two Wing, with the manager's office and the CCTV room as far apart as the lot allows and the vault always on a time lock. **Mezzanine Watch**: the CCTV room raised behind the teller line, behind glass, up its own stairs. **Atrium**: a big lobby ringed by offices, the offices on one side upstairs off a gallery, a skylight. **Fortress**: a concrete core with the vault, a ring corridor round it, soft outer walls. Half of all layouts are mirrored. |
| 3. Core first | `layout.ts` `backBand` | The vault and its antechamber (and the mantrap from the city branch up) against the back wall. Secure closets go on one side, the service end (loading bay, back door) on the other, the vault corridor across in front. The CCTV room always goes in another wing. |
| Walls and doors | `build.ts`, `rooms.ts` | Walls wherever two rooms meet. The material follows from what the rooms are (§14.1): vault steel round the vault (metre-thick stone in an old bank), concrete round the secure core, plaster between staff rooms, brick outside, plaster outside on a Fortress. The street front gets piers, windows, glass doors and the ATM. Each room type opens onto the first room its rules allow (`ROOM_RULES`), then the archetype adds the links that make its loops. A layout where a room can't be reached is rolled again. |
| Neighbours | `neighbours.ts` | Café, vacant shop (a soft party wall to breach), shop, parking garage (a hidden getaway spot), building site (scaffolding up to the roofs, behind a chain-link fence), office tower (lobby, stairwell, the rented sniper nest upstairs). |
| 4. Key graph | `keys.ts` | Every hard lock (vault, mantrap, CCTV door, alarm panel) gets a social, a technical and a violent key (§15.2), with the people who hold the social one. |
| 5. Fill | `parcels.ts`, `furnish.ts` | Every room type has three or more hand-authored parcels, each also mirrored: six or more variants. A parcel places its fixed pieces and records stations (where staff and customers stand), alarm buttons, camera slots, loot, and the spots for roof hatches, floor grates and vents. Its prop slots then take random cover from a pool. `Furnisher` accepts a prop only if it fits between the walls, touches nothing in 3D, keeps the tiles in front of doors free and, for dressing, hangs on a solid wall. |
| Ways in | `approaches.ts` | At least four approaches from three categories (§17.5), their markers placed in the world. **Social**: the front door, the staff door. **Covert**: the roof route from a ladder or the scaffolding to a hatch or the skylight, the sewer from a manhole to a floor grate, an air duct. **Forced**: ramming the glass front, the shutter, a soft wall from next door. Plus the getaway spots, plot exits and police staging. |
| 6. Population and schedule | `security.ts`, `population.ts` | Cameras go in the parcels' slots, each covering a tile people must cross. Guards get a lobby post with a short loop, patrol routes through staff and secure rooms, and the security chief at HQ. Then, from the **population seed**: staff at their stations, the crowd for the time of day, hidden traits (off-duty cops, a hero, a teller in debt, the dye-pack drawer), the day's timeline (§16.3) and each person's schedule, and 3–5 opportunities (§17.6) with how they are found. |
| 7. Validate | `validate.ts`, `nav.ts` | The eight checks of §17.7 on a navigation grid. After every ten failed rolls one rule is relaxed, in the fixed order of `RELAX_ORDER`. A relaxed rule is still checked and reported; it just no longer rejects the bank. |
| 8. Present | `src/ui/Briefing.ts`, `BankScene.showKnowledge` | The briefing panel and the blueprint layer: staff and secure rooms shown as `?` outlines. |

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
- **Drive-through**: corner lot or strip-mall end; a teller window and a tube terminal on the lane.
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

## Where it simplifies

- The population, schedules, key graph and opportunities are **data**. The stealth rules that act on them (vision,
  suspicion, schedules running turn by turn) are M1 work (§22). In the preview only the patrols walk.
- Parcels are authored as code (three or more per room type, mirrored) that adapts to the room's size, not as fixed
  4-tile blocks.
- Every vault uses the round vault door art. The parking garage has no raised firing line yet. A bank in a mall is a
  strip-mall bank with more doors and more people, not a mall concourse.
