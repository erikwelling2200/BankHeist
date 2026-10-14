# Procedural interiors

Note on method: a deep-research pass in October 2026 (five angles, 23 sources fetched, 97 claims extracted). 25 claims
were adversarially verified by three voters each and all survived; seven more fell outside the verification budget.
Lessons built on a verified claim say **verified**; those built only on practitioner blogs and talks that the verifier
didn't reach (Shadows of Doubt, Skyrim's kits, Emily Short on oatmeal, Dead Cells, Heat Signature, Invisible Inc.,
Xu et al.) say **practitioner**. The academic floor-plan and furniture work is residential and 3D (2009–2015); carrying
it over to a bank on a 16px tile grid with walls on edges is our adaptation, and soft penalties in the papers become
the `Furnisher`'s hard rejections here. Nothing verified covers stealth layout or memorability directly; the lessons
on those are design judgment built on the practitioner sources, and say so.

The problem these notes answer: the generator's rooms read as big empty rectangles. Rooms are rectangles from the
archetype's stacks, a stack's last room stretches to fill what is left, and each room type has a few parcels sized for
a typical room. The research points to four layers, each fixing part of it. (1) **Program first**: the room types, their
zone and which must touch, before any geometry; split space into more rooms with jobs rather than stretching one.
(2) **Shapes from constrained growth or wall moves**: rectangles first, then L-shapes and notches on purpose, scored by
how irregular they are; never free cell growth. (3) **Furnish by activity**: functional groups (an anchor and its
satellites, at set distances and facings) with clearance kept in front of what is used and along the walks between
doors, placed by scored candidates. (4) **History on top**: who works here and what just happened, as props, wear and
small vignettes, so the room tells its story; and every variation should change play, or it is oatmeal.

## Lessons

### 1. Decide the program before the geometry: room types, zones and adjacencies, then shapes, then doors.

**Evidence (verified):** Floor-plan generators start from an adjacency ("bubble") graph of room types and required
neighbours (House-GAN takes exactly that as input). Lopes et al. 2010 then connect rooms in a fixed order: required
doors, the hallway to each adjacent public room, each private room to an adjacent public room, public rooms to each
other, then a reachability pass, so private rooms are reached through shared space and chokepoints appear naturally.
Mirahmadi and Shami 2012 cut a corridor along the shortest path when a room that must reach the hub doesn't touch it.
**Practitioner:** Shadows of Doubt places an address's rooms greedily in order of importance (living room, then
bathroom), each tried at every free position and scored; each room type lists what it may open onto, its maximum
doors, and may "steal" floor from a room placed earlier that has too much.

**For BankHeist:** The archetypes already fix the macro program and `ROOM_RULES` the doors; what is missing is the
middle: a wing's stack hands its leftover space to one room (`stretch`), which is why offices and ATM rooms grow to 15
tiles deep. Give each stack a program of rooms with target areas and let surplus space become *another room with a
job* (records, a counting room, a staff office, a conference room, a kitchenette), the Shadows of Doubt "steal"
working in reverse. Stretch only rooms that read well big (the lobby, a loading bay).

### 2. Make shapes from rectangles and L-shapes on purpose; never from free growth.

**Evidence (verified):** Lopes et al. 2010 grow rooms on a grid in three passes: the largest rectangle up to each
room's target area; then again with L-shaped growth allowed, but no U-shapes; then every leftover cell goes to the
neighbour bordering most of the gap, which turns leftovers into closets and alcoves. Green, Salge and Togelius 2019
grew rooms a cell at a time without rectangle constraints and got layouts "unlike real-world structures", full of
pockets, and disorienting at scale without landmarks.

**For BankHeist:** Keep the archetype's rectangles, then apply shape moves between neighbouring rooms: hand a corner
block of a big room to its neighbour (one gets a notch, the other an L), bend a corridor round a closet, cut an
alcove. Forbid U-shapes, arms narrower than two tiles (one for a corridor), and moves that break a door rule or a
required shared wall. Keep the hardened core (vault, antechamber, mantrap) and the teller line rectangular.

### 3. Score shapes, with corridors exempt.

**Evidence (verified, one paper):** Merrell, Schkufza and Koltun 2010 score a plan with missing connections, room area
and aspect ratio against real distributions, and a convexity cost Mc = (hull area − area) / area + number of outline
edges, with hallways exempt. Concave corners appear by splitting a wall and sliding half of it, and a moved wall snaps
to a nearby wall line so shapes don't drift. **Practitioner:** Shadows of Doubt weights floor area, "uniform shape"
(the number of corners) and windows differently per room type.

**For BankHeist:** Give each room type a shape budget: offices and the teller line want few corners (cost high), the
lobby and the break room tolerate an L, corridors are free. A shape move is accepted when it lowers the total cost
(area off target, aspect ratio, corners) or with a small seeded chance, a bounded Metropolis-style search. Snap to the
existing wall lines: on a 16px grid that comes for free.

### 4. If a footprint is subdivided, squarify; never slice-and-dice.

**Evidence (verified):** Slice-and-dice subdivision gives long thin strips (aspect ratios of 16 and 36 in Bruls et
al.'s example); squarified treemaps push each block toward a square. Mirahmadi and Shami apply it level by level down a
zone hierarchy (outside, the public room, then service and private zones).

**For BankHeist:** The wing stacks are slice-and-dice along one axis. When a wing is deep, split its surplus across
the wing too (two rooms side by side), choosing the cut that keeps both nearer square, rather than one long room.

### 5. Furnish by activity: functional groups, not object lists.

**Evidence (verified):** Yu et al. 2011 ("Make it Home") learn pairwise relations from examples: desk and work chair,
supervisor's desk and chair, sofa and television; objects come in two tiers, floor and wall pieces first, then what
stands on them (a lamp, a monitor). In their study, wrong *orientation* was noticed more than wrong distance. Fisher et
al. 2015 synthesise rooms around the activities they support (sleeping, eating), and Fisher et al. 2012 generalise a
few example rooms with one model for which objects co-occur and one for where they sit relative to each other.

**For BankHeist:** Author each room as the activities its people do: a workstation (desk, chair, the person's station,
a monitor and a lamp on the desk, a bin), a meeting (table, chairs round it), a counting table (cash cart beside it),
a storage wall (a run of shelving), a queue (rails and the people in it), a kitchenette (counter, fridge, cooler). A
group is an anchor plus satellites at fixed offsets and facings in the anchor's frame, placed and turned as one; the
chair always faces the desk. Second-tier props sit on a first-tier box (`Furnisher` checks the support).

### 6. Keep clearance where things are used and where people walk.

**Evidence (verified, one paper):** Yu et al. give each object's usable face an "accessible space" rectangle (where the
chair and the person go), objects that must be seen a viewing strip, and each door-to-door walk a chain of free
rectangles; any object entering them costs.

**For BankHeist:** A group declares its clearance tiles in its own frame (the chair and the person in front of the
desk, the space in front of a cabinet's drawers, the strip in front of the teller window), and the `Furnisher` keeps
them, the way it keeps door tiles. Before furnishing, keep the shortest walk between each pair of a room's doors
free. Patrols and players need those walks, and it is what makes a furnished room still read as passable.

### 7. Place groups by scored candidates with the seeded RNG, the Furnisher as the hard filter.

**Evidence (verified):** Merrell et al. 2011 turn interior-design guidelines into a density function sampled by Monte
Carlo; Yu et al. minimise a weighted cost (accessibility, visibility, paths, pairwise relations, distance and angle to
the nearest wall) by simulated annealing. Germer and Schwarz 2009 furnish whole buildings with each object as an agent
seeking its preferred wall, corner or partner, a lighter alternative. **Practitioner:** Shadows of Doubt scores every
free position for a room and keeps the best.

**For BankHeist:** For each group, generate candidate placements (each wall it can back onto, each facing, mirrored),
reject those the `Furnisher` refuses, score the rest (against its wall, in its preferred corner or by the window, away
from the door, near its partner group) and take the best or a seeded pick among the best few. Bounded and
deterministic; no annealing, so it stays fast on a phone and testable.

### 8. Scale the number of groups with the room, by density rules.

**Practitioner:** Dead Cells places enemies by density (one per five combat tiles), with each type adding its own
limits. Heat Signature's ships read as "random, empty mazes" until they were built from sectors with something in each.

**For BankHeist:** A room's program gives groups per area: one workstation per 12 tiles in a staff office, a meeting
group from 20 tiles, one storage wall per wall long enough, cover every 8–10 tiles. Big rooms fill with more of what
the room does, instead of one desk in a hall.

### 9. Give every room a history: who uses it and what just happened.

**Evidence (verified, one talk):** Smith and Worch, "What Happened Here?" (GDC 2010): environmental storytelling lets
the player piece together implied events, through props, texturing, lighting and composition, and game systems can
extend it (the space reacts to what the player did). **Practitioner:** Shadows of Doubt's apartments got "much-needed
character" only once furnishings went in, and its compelling locations come from props the citizens' simulation drives.

**For BankHeist:** After the functional groups, a story pass per room from its type and occupant: the manager's
office has framed photos and a coat on the stand; the break room has a half-eaten cake and mugs by the sink; the
counting room a stack of bags waiting to be counted; the CCTV desk a cold coffee; a cleaner's trolley parked where the
cleaner was. One or two vignettes per room, chosen by the room's activity, and in the briefing's "what you notice"
list when they matter (a sticky note with a code is an opportunity, §17.6).

### 10. Repeated small details are noticed before repeated architecture.

**Practitioner:** Bethesda built over 400 Skyrim dungeon cells from seven modular kits; players reacted to repeated
clutter faster than to repeated architecture, and copy-pasted cells (Oblivion's warehouses) eroded authenticity. The
kit gives a space its identity; dressing gives each space its character.

**For BankHeist:** Spend variation on dressing and story props, not on room shells. Keep per-bank rules that stop the
same vignette or the same prop pairing appearing twice in a bank, and let the bank's age and kind (old bank, mall
bank) pick its dressing palette, so a bank reads as one place.

### 11. Variation only counts when it changes play (the oatmeal test).

**Practitioner:** Kate Compton's "10,000 bowls of oatmeal" (via Emily Short): generating variants is easy, making the
differences matter is hard; the test is whether the variation is tied to a mechanic. Procedural generation is a way of
designing content, not a substitute; interlocking generated parts and the occasional unexpected result make it rich.

**For BankHeist:** Every shape move and group must change something a crew can use: an L-shaped office hides its
inner arm from the door (a blind corner), a column bay gives cover across a hall, a storage wall blocks a sight line,
a meeting table is low cover, a notch makes a closet someone can hide in. Measure it (lesson 13) so variation that
changes nothing is visible in tests.

### 12. Build mid-scale structure, and put loops where they shorten long ways round.

**Practitioner:** Heat Signature fixed its "random, empty mazes" with sectors of 3–6 modules (a long room, a row of
small rooms, a corridor) between the cell and the ship. Storing each room's distance from the entrance shows where to
add a shortcut door: two rooms side by side whose distances differ a lot. Depth-first placement makes one long snake;
breadth-first makes parallel paths; the order of directions tried changes the shape a lot.

**For BankHeist:** A wing is a sector: a corridor with a row of rooms off it. When shapes change which rooms touch,
recompute door distances and add a locked shortcut where two adjacent rooms are far apart by walking (a second loop,
§17.7), never a loop between rooms that are already close.

### 13. Place observers apart, and measure stealth with a solver.

**Practitioner (PCG workshop paper):** Xu et al. 2014 place n guards and cameras by a constrained Voronoi split of the
walkable cells into 2n−1 regions, keeping the n biggest so observers stay apart; a guard patrols between the two
farthest mutually visible points of its region, and a camera keeps its two longest sight lines. A randomized path
solver (20 trials of 20 agents) measures difficulty as the share of agents that reach the goal unseen; sweeping cameras
proved harder than patrolling guards at equal numbers, and difficulty jumped non-linearly with observer count where
geometry routes paths through chokepoints. A level is "stealth friendly" when the tools that hide outweigh those that
detect.

**For BankHeist:** Add metrics to the validation report and the tests: per room, the share of floor seen from its
doors and the number of tall-cover tiles; per bank, an unseen path from each covert approach to the vault corridor
(already §17.7), and the solver's success share as a difficulty readout per tier. Shapes and groups should raise cover
in staff rooms without making the public floor hard to read.

### 14. Keep landmarks so big generated buildings stay legible.

**Evidence (verified):** Green, Salge and Togelius note that large generated buildings disorient without interior
landmarks. **Practitioner:** Dead Cells places special rooms on a hand-authored concept graph first, then the rest.

**For BankHeist:** The fixed orientation (street at the bottom, vault at the top) is the main landmark; add one per
wing (the manager's glass-fronted office, the break room's kitchen, a records room's tall shelves, the atrium's
skylight) so a player can name where a guard is.

## Pitfalls

- Free cell-by-cell growth: organic rooms full of pockets that no architect would draw (Green et al.).
- Slice-and-dice subdivision: long thin rooms (Bruls et al.); a wing's stretched last room is the same failure.
- Stretching rooms to fill space: big rooms with one parcel's worth of furniture read as empty (the review's finding).
- Object lists without groups: a chair that doesn't face its desk is noticed first (Yu et al.).
- Furniture in the walk between doors: rooms that look full but can't be crossed, patrols that jam.
- Decorative variation: shapes and props that never change a sight line or a route are oatmeal (Compton, Short).
- Repeated clutter: the same vignette twice in a bank breaks it faster than repeated rooms (Skyrim).
- Tiny loops: a door between two rooms already a step apart adds nothing and looks silly (Francis).
- Optimisers on a phone: annealing is slow and hard to test; bounded scored candidates with a fixed seed are enough.
- Second-tier props floating: a monitor or a mug needs a desk under it.

## Ideas

- **Room programs:** per wing, rooms with target areas and a priority order; surplus becomes another room with a job.
  New staff rooms that fill space with purpose: counting room (cash being counted, loot), records room (tall shelving,
  documents with intel, §17.6), staff office (open-plan desks for loan officers), conference room (a schedule event),
  kitchenette, locker room, mail room, IT closet.
- **Shape moves:** corner transfer (notch and L), corridor bend round a closet, alcove cut, column bay (pillars in a
  hall wider than eight tiles), glass partition (an office on the floor behind windows).
- **Groups:** workstation, manager's desk with visitor chairs, teller window, meeting table, counting table, storage
  wall, kitchenette, lounge (sofa and coffee table), locker bank, cleaning station, server row, deposit wall.
- **Story vignettes:** coffee on the desk, coat on the stand, open drawer, stack of cash bags, birthday cake in the break
  room, mop bucket by a wet floor sign, a sticky note with a code (an opportunity), a jammed printer.
- **Metrics:** shape cost per room, floor seen from the doors, tall-cover tiles per staff room, the solver's success
  share per tier, reported in the briefing's checks and asserted in tests.

## Open questions

- Which shapes help stealth rather than only looking believable: do L-shapes and column bays make useful sight-line
  breaks, do two-door rooms make patrol loops? Score them next to the shape cost?
- How to keep banks recognisable yet distinct: landmarks, set-piece rooms, archetype signatures. No verified evidence.
- What shipped games actually do for interiors and clutter (Shadows of Doubt in depth, Heat Signature's interiors,
  Invisible Inc., Monaco, RimWorld, Prison Architect): a second pass on postmortems and talks.
- Greedy scored placement or a full stochastic optimiser for furnishing: what does a room cost on a phone?

## Sources

Verified (three-voter adversarial check):

- [Lopes, Tutenel, Smelik, de Kraker, Bidarra - A Constrained Growth Method for Procedural Floor Plan Generation (GAME-ON 2010)](https://graphics.tudelft.nl/~rafa/myPapers/bidarra.GAMEON10.pdf)
- [Green, Salge, Togelius - Organic Building Generation in Minecraft (FDG PCG workshop 2019)](https://arxiv.org/pdf/1906.05094)
- [Merrell, Schkufza, Koltun - Computer-Generated Residential Building Layouts (SIGGRAPH Asia 2010)](https://www.cs.princeton.edu/courses/archive/spring11/cos598A/pdfs/Merrell10a.pdf)
- [Mirahmadi, Shami - A Novel Algorithm for Real-time Procedural Generation of Building Floor Plans (2012)](https://ar5iv.labs.arxiv.org/html/1211.5842)
- [Nauata et al. - House-GAN (ECCV 2020)](https://arxiv.org/abs/2003.06988)
- [Merrell, Schkufza, Li, Agrawala, Koltun - Interactive Furniture Layout Using Interior Design Guidelines (SIGGRAPH 2011)](https://graphics.stanford.edu/projects/furniture/)
- [Yu, Yeung, Tang, Terzopoulos, Chan, Osher - Make it Home: Automatic Optimization of Furniture Arrangement (SIGGRAPH 2011)](https://ww3.math.ucla.edu/camreport/cam11-49.pdf)
- [Fisher, Savva, Li, Hanrahan, Niessner - Activity-centric Scene Synthesis for Functional 3D Scene Modeling (2015)](https://graphics.stanford.edu/~mdfisher/actSynth.html)
- [Fisher, Ritchie, Savva, Funkhouser, Hanrahan - Example-based Synthesis of 3D Object Arrangements (2012)](https://graphics.stanford.edu/projects/scenesynth/)
- [Germer, Schwarz - Procedural Arrangement of Furniture for Real-Time Walkthroughs (CGF 2009)](https://diglib.eg.org/handle/10.2312/CGF.v28i8pp2068-2078) (abstract only)
- [Survey of procedural content generation for indoor scenes (arXiv 1706.09577)](https://arxiv.org/pdf/1706.09577) (secondary)
- [Smith, Worch - What Happened Here? Environmental Storytelling (GDC 2010)](https://gdcvault.com/play/1012647/What-Happened-Here-Environmental)

Practitioner (fetched, not verified):

- [ColePowered - Shadows of Doubt devblog: generating interiors (2019)](https://colepowered.com/2019/02/)
- [ColePowered - Shadows of Doubt devblog 15: moving in the citizens (2019)](https://colepowered.itch.io/shadows/devlog/78044/shadows-of-doubt-devblog-15-moving-in-the-citizens)
- [Joel Burgess - Skyrim's Modular Approach to Level Design (2013)](https://www.gamedeveloper.com/design/skyrim-s-modular-approach-to-level-design)
- [Emily Short - Bowls of Oatmeal and Text Generation (2016)](https://emshort.blog/2016/09/21/bowls-of-oatmeal-and-text-generation/)
- [Sébastien Bénard - The Level Design of Dead Cells: a Hybrid Approach (2017)](https://deepnight.net/tutorial/the-level-design-of-dead-cells-a-hybrid-approach/)
- [Tom Francis - Teaching Heat Signature's ship generator to think in sectors (2015)](https://pentadact.com/2015-11-14-teaching-heat-signatures-ship-generator-to-think-in-sectors)
- [Tom Francis - Laying out Heat Signature's ships: snakey vs branchy (2015)](https://www.pentadact.com/2015-11-26-laying-out-heat-signatures-ships-snakey-vs-branchy/)
- [James Lantz - Designing Procedural Stealth for Invisible, Inc. (GDC 2015)](https://gdcvault.com/play/1021919/Designing-Procedural-Stealth-for-Invisible) (abstract only)
- [Xu, Tremblay, Verbrugge - Procedural Generation of Stealth Levels (PCG Workshop 2014)](https://www.pcgworkshop.com/archive/xu2014procedural.pdf)
