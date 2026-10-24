# BankHeist: implementation plan for the game rules

**Status:** plan, October 2026. **Source of truth:** [GAME_DESIGN.md](GAME_DESIGN.md) for the rules, [UI.md](UI.md) for screens and touch, [generator.md](generator.md) for `src/gen`. This file says how to build it: the architecture, and the work for milestones M1–M7 (§22) split into packages that one agent can implement and test in one session. Tick a package off when its acceptance checks pass on `feature/game-systems`.

## 1. What exists today

| System | State | Where |
| --- | --- | --- |
| Turn loop, actions, undo | **None.** The bank scene has no rules. People walk their patrols in real time on screen. | `src/scenes/bank/people.ts:32` (patrol), `src/scenes/BankScene.ts:149` (`movePerson`) |
| Old demo | A real-time stack demo: a joystick, a guard with a float cone, a demo HUD. Deleted in M1-16. | `src/scenes/VaultScene.ts`, `src/entities/Guard.ts`, `src/input/MoveInput.ts`, `src/level/level.ts`, `src/logic/vision.ts` (`isInCone` at line 4, `hasLineOfSight` at line 27, float pixel maths) |
| Grid and walls | Walls stand on tile edges, with a material per segment (`WallKind`). Height comes from the floor tile. | `src/level/walls.ts:19-23`, `src/level/plan.ts:38` (`Level`), `:79` (`floorHeight`), `src/gen/site.ts:9-15` (`edgeKey`, `edgeBetween`) |
| Zones | Each room has a zone: `public` / `staff` / `secure` / `neighbour` / `outdoors`. | `src/level/plan.ts:93-104`, `src/gen/rooms.ts:27-88` (`ROOM_RULES`) |
| Movement and sight (generator only) | `Nav` covers walkability, door crossing, the step-height limit, breadth-first distances and paths, and tile line of sight (`sees`). It treats glass as see-through, and full-height furniture blocks sight. | `src/gen/nav.ts:16` (`SEE_THROUGH`), `:62` (`Nav`), `:85` (`step`), `:163` (`sees`) |
| Vision constants (generator only) | Camera 7 tiles / 70°; guard 8 tiles / 140°; a cone function over tiles. | `src/gen/security.ts:16-24` |
| Generator output | `GeneratedBank`: the level, rooms, doors with their locks, props, people with role, observer class, schedule and traits, cameras, key locks, approaches, off-map routes, getaway spots, exits, police staging, timeline, opportunities, intel, stories and validation. | `src/gen/model.ts:151-182`. `GenPerson` `:115`, `ScheduleBlock` `:112`, `Door` `:53`, `KeyLock` `:69`, `GenCamera` `:109`, `Approach` `:84`, `TimelineEvent` `:127`, `Opportunity` `:130` |
| Generator data that never reaches the output | Alarm stations, loot, work stations, grates, vents and hatches (`Furnished`). The tall-furniture grid, the furniture-blocked grid, the number of CCTV monitors. | `src/gen/parcels.ts:34-46`; `src/gen/generate.ts:155-162` (tall grid) and `:174-183` (what is returned); `src/gen/tiers.ts:18` (`monitors`) |
| Schedules | Free-text activities with a room id (`'at post'`, `'patrol'`, `'lunch'`, `'closing sweep'`, `'all rooms'`, `'outside'`). Nothing can run them. | `src/gen/population.ts:178-238` |
| Traits | Free-text strings (`'off-duty cop (armed)'`, `'Bold (hero)'`, `'in debt (bribable)'`, `'dye pack in the drawer'`). | `src/gen/population.ts:129-137` |
| Key graph | Every hard lock has social, technical and violent keys, but as text. Holders are listed by id. | `src/gen/keys.ts:20-70` |
| Random numbers | A mulberry32-style generator with named sub-streams (`fork`). Its state is a private single number. | `src/gen/rng.ts:5-59` |
| Knowledge layer | Blueprint outlines and hiding the people inside them; rendering only. | `src/scenes/bank/knowledge.ts:14-52` |
| HUD and input | A demo HUD (gold counter, flash message; deleted in M1-16). Camera pan and zoom are HTML. The Briefing panel and generator bar exist. | `src/ui/Hud.ts` (gone), `src/ui/CameraControls.ts`, `src/ui/Briefing.ts`, `src/ui/GeneratorBar.ts` |
| Reference reaction matrix | The Python behind the UI mockups computes the §8.4 matrix. Use it as an oracle for test cases. | `scripts/ui-mockups/rules.py:31` |
| Door art | Walls draw door segments, but there is no open or closed state. | `src/scenes/bank/walls.ts` |

## 2. Architecture

### 2.1 Layers

```
src/sim/      pure rules: no Phaser, no DOM, no Math.random, no Date (tsconfig.sim.json and an AST test)
  core/       types.ts (World, State, Command, SimEvent), rng.ts, engine.ts, save.ts
  world/      fromBank.ts, fixture.ts (text maps for tests), materials.ts, tileProps.ts
  geo/        move.ts (reach, paths, costs), los.ts, cones.ts, sound.ts
  data/       weapons.ts, items.ts, archetypes.ts, matrix.ts: the canonical tables (§8.4, §8.9, §12, §16.2) as data
  rules/      profile, perceive, suspicion, trespass, evidence, npc/ (schedule, intent, behaviour),
              worldPhase, actions/*, carriers, cameras, checkins, knowledge, …
  preview/    safeFloor.ts, noise.ts, explain.ts ("who and why")
src/game/     Session: preview, commit, undo, autosave and resume, event playback queue, view models for the HUD
src/scenes/bank/  sim.ts (state to sprites), overlay.ts (world UI at 2×), input.ts (touch grammar to commands)
src/ui/hud/   the HTML HUD from UI.md
```

- **World.** Immutable and built once. It holds a tile grid with zone, raised, lit, blocks-move, tall (blocks sight), half cover, room and floor. It holds edges keyed by `edgeKey`, each with a material, whether it blocks sight or movement, its cover, and its door id. It also holds doors with their locks, objects to interact with (derived from prop kinds: `alarmPanel`, `breakerPanel`, `cctvDesk`, `vaultConsole`, phones and so on), people definitions with compiled schedules, cameras, the timeline and the tier constants.
- **State.** Plain JSON, kept small:
  - the turn, the phase, the bank status (Quiet / Loud / Alarm) and heat
  - the crew and the NPCs: position, facing, state, suspicion pips, the crew members they have exposed, intent, command pips
  - door and object state, live alarm carriers, crew knowledge
  - the random number streams `{name: uint32}`, a command and dice log, the undo stack's base
- **Engine.**
  - `commit(world, state, cmd) → { state, events, undoable }` copies the state, runs the reducer for the command and returns the events.
  - `endTurn` runs the world phase:
    1. committed intents are carried out in the §6.1 order: passive NPCs move together, one tile per tick with sightings checked each tick, then NPCs in combat one at a time; the intents they carry out are a frozen snapshot taken at the start of the phase;
    2. devices and carrier countdowns, last as in §6.1. A carrier ticks once per world phase but never in the world phase that created it, so it is always seen at its full countdown (at least 2) for a whole crew phase;
    3. decisions are made and intents committed.
  - NPCs never act on a decision made in the same world phase (§6.2). That is what makes the hatched preview exact.

### 2.2 How previews stay exact (§8.8)

- **One set of functions.** A move is resolved by calling `assessEnd` on each tile of the path, each observer counted once at its worst (`assessPath`, decision 46). The world phase calls `sightingsAlong(intent)`. The safe-floor overlay calls exactly these functions, the same way, directly per tile and never through `preview()` (see Overlay speed in §5). There is no second copy of any rule.
- **No dice in previews.** The `rng` handle only works in commit mode. In preview mode, rolling throws an error. An action that rolls dice (a resister, a shot, a drill jam) returns its odds or its geometry for the preview and rolls only on confirm. The roll is saved in the state and the log, so reopening the game can't reroll it (§11.2).
- **Property test (M1-09).**
  - Over many seeds, using pinned generated banks and the test fixtures, play random legal crew commands.
  - Before each commit, take the preview. After it, compare: the tint the overlay drew for that tile (and for the hatched world phase), the noise ring tiles and their ear badges, and new carriers with their countdowns, all against the real events.
  - Any difference fails the test. Later milestones add their actions to the same random player.
- **Second oracle.** A clone-and-commit check: run the real `commit` on a scratch copy and compare its events with the fast overlay for a sample of tiles.

### 2.3 Determinism

- Geometry is on whole tiles. Cone membership uses integer dot and cross products against precomputed thresholds; never `atan2` in the rules, because it can differ in the last bit between engines.
- Iteration is always by sorted id: rules walk records with `sortedIds` (the purity test bans `Object.keys/values/entries` under `src/sim/rules`). Copying is done with `clonePlain`, a plain-JSON copy (the engine's ES2022-only build has no `structuredClone`).
- A test runs the same commands twice and requires identical state hashes. Another reloads a mid-heist save and requires the same continuation.

### 2.4 Saves (§6.6, §20.6)

- **Contents:** `{ format, genVersion, world (or seeds + generator version), state }`. The random streams and the dice log are inside `state`. The Session writes it to `localStorage` after every commit.
- **Undo:** the Session keeps snapshots only while every action since the last final one was undoable. An action is undoable when its events show nothing revealed, no perception check and no dice.
- **Resume:** loads the latest save and shows the recap card.

### 2.5 Rendering and input

- The scene subscribes to the Session.
- **World phase playback:** events are queued and tweened through `movePerson`, at 1×, 2× or instant. The camera visits only the events §20.5 lists.
- **Overlays** are drawn at 2× the art resolution (UI.md, "Two layers").
- **Input** follows the UI.md touch grammar:
  - tap to preview, a second tap or Confirm to commit
  - a drag that starts on the selected crew member draws a path
  - long-press asks why
- **HUD** reads view models from the Session; it never reads the state directly.
- **Debugging and e2e:** `window.sim` exposes `{ state, world, preview(cmd), commit(cmd), endTurn() }`.
- **Routes:** the game is the default page (`/`; in another bank `?play&seed=…`, `?new` to start afresh); the generated-bank viewer moved to `?view` (M1-16), and a bare `?seed=…` (an old link to it) opens it as `?view&seed=…`, never a heist. The visual tests open `?view…` where they used the default page, so they show what they did.

### 2.6 Tests

- **Unit tests** per module, written against text-map fixtures (`fixture.ts`): the plan legend from `plan.ts` plus a small legend for people, crew and objects.
- **Scenario tests** replay short scenes from §3 ("Jun waits one turn for the cleaner", "panel work, radius 1, the cleaner stays calm").
- **Property tests** as in §2.2.
- **e2e** drives the game through `window.sim` and takes screenshots.

## 3. Milestone work packages

Each package lists its goal, the design sections it covers, the files, what it depends on, and its acceptance checks. "∥" names packages that can run at the same time.

### M1: Stealth core

**Done** (M1-16): every package below has landed; the scripted run proves the bank is readable clockwork.

- [x] **M1-01 Sim contracts and engine.**
  - **Covers:** §6.1–6.2, §6.6, §20.6.
  - **Files:** `src/sim/core/*`, a minimal `src/sim/world/fixture.ts`, `tests/sim/engine.test.ts`.
  - **Work:** the types for World, State, Command and SimEvent. Random streams kept in the state, with preview mode refusing to roll. `commit` and `endTurn` with an empty world phase. Undo snapshots. Save and load with a format version. A purity test that no `src/sim` file imports Phaser, `window`, `Math.random` or `Date`.
  - **Depends on:** nothing.
  - **Accept:** a determinism hash test; a save round trip; preview mode throws on a roll.
- [x] **M1-02 World from a bank, and the generator export gaps.**
  - **Covers:** §8.1, §14.1, §17.
  - **Work:**
    - Add `alarms`, `loot`, `stations`, `grates`, `vents`, `hatches` and `monitors` to `GeneratedBank`.
    - Move the grid that says which tiles are blocked, tall or half cover into one shared function, `src/level/tileProps.ts`, built from props and `CATALOG`. Make `gen/nav.ts` and `generate.ts` use it.
    - Write `worldFromBank`.
    - Write the wall-kind-to-material table (`materials.ts`).
    - Set door start states and locks.
    - Derive the objects to interact with from prop kinds.
    - Work out Lit from the room's light and whether it is outdoors (no baked lamps).
  - **Files:** `src/gen/model.ts`, `generate.ts`, `nav.ts`, `src/level/tileProps.ts`, `src/sim/world/*`.
  - **Depends on:** M1-01. **∥** M1-03, M1-04, M1-12, M1-15.
  - **Accept:**
    - every tier × archetype builds a world;
    - each tile's zone matches its room;
    - `npm run sweep` is unchanged;
    - `VISUAL_EXACT=1 npm run test:visual` passes.
- [x] **M1-03 Movement and sound.**
  - **Covers:** §6.3 (move 5, diagonal 1.5, no cutting corners where a wall ends, dash 12, heavy armour 4), §8.9, §14.7 step limits.
  - **Work:** reachable tiles within a cost budget; path validation; door passage by lock and key; the noise flood (−3 per closed door or Soft wall, Reinforced and Vault stop it, open doors, gaps and holes cost nothing).
  - **Files:** `src/sim/geo/move.ts`, `sound.ts`.
  - **Depends on:** M1-01. **∥** M1-02, M1-04.
  - **Accept:** table tests on fixtures (corner cutting, diagonals, the ring through a closed door is 3 shorter, Vault stops it).
- [x] **M1-04 Sight.**
  - **Covers:** §8.3, §8.15.
  - **Work:**
    - Tile line of sight: walls, closed doors and tall furniture block; glass doesn't; an observer on a raised tile sees over low objects.
    - Core (6 tiles, 90°) and Peripheral (8 tiles, 140°) arcs; Alerted (8 and 10, Peripheral counts as Core).
    - Darkness halves every range.
    - Camera core arc (7 tiles, 70°), with pan facings.
    - Crew sight: 360°, 13 tiles (decision 39).
    - Integer cone tests.
  - **Files:** `src/sim/geo/los.ts`, `cones.ts`.
  - **Depends on:** M1-01. **∥** M1-02, M1-03.
  - **Accept:**
    - line of sight is symmetric;
    - the corner cases of §11.4 ("standing next to a corner doesn't expose anyone");
    - matches `Nav.sees` on the sample, except where §6 decision Q6 says otherwise.
  - **Notes (done):** low objects (desks, counters, low walls, railings) never block sight (§8.3); things of middle
    height (vehicles, wrecks: `Tile.midHeight`, `EdgeProps.midHeight`) do, except on a line with a raised end (§14.7).
    Darkness is judged by the seen tile (§6 decision 10). Only cameras with `seesInDark` (Regional HQ and up) see an
    unlit tile. Perception and the overlay take `sightMap(world, state)` once per evaluation and ask `seesOn`/`fieldOn`
    on it; any state that changes sight must join `sightInputs` (los.ts).
- [x] **M1-05 Perception rules.**
  - **Covers:** §7.4, §8.2, §8.4–8.7, §8.14 (uniform flags only).
  - **Work:**
    - The profile from the loadout; the item and weapon data tables.
    - The reaction matrix as data.
    - The perception functions `assessStep`, `assessEnd` and `sightingsAlong`.
    - Suspicion pips and their decay; exposure.
    - The trespass challenge as a state machine; Warned.
    - Alerted and on edge; eyes down.
  - **Files:** `src/sim/data/*`, `src/sim/rules/{profile,perceive,suspicion,trespass}.ts`.
  - **Depends on:** M1-04.
  - **Note from M1-04:** Alerted must be a flag separate from the NPC's status: a commanded guard stays Alerted (§8.7).
    `npcObserver` (geo/cones.ts) reads `alerted`/`hostile` statuses as Alerted until that flag exists; switch it over.
  - **Accept:** every cell of §8.4 is tested, Core and Peripheral, using cases taken from `scripts/ui-mockups/rules.py`; the trespass sequence; the on-edge reading.
  - **Notes (done):** the one copy of each rule is in `rules/perceive.ts`: `reaction` (the matrix lookup with every
    modifier), `assessStep` (mid-move, only `!`), `assessEnd`, `sightingsAlong` / `assessWorldPhase` (an NPC walking
    its committed intent; doors it walks through open for the rest of its walk; cameras at the facing they pan to) and
    `witness` (illegal acts), all pure and returning `Sighting`s (who, from where, cell, outcome, why);
    `applySightings` is the only writer. A move judges its steps and end against the NPCs as the move began and
    applies them together at the end; the world phase judges every sighting before applying any, before anyone moves
    (`perception.world`, passiveNpcs order −100), then checks trespass deadlines (−90); decay runs in devices (40).
    A sighting that reads "—" is no perception check in the crew phase (undo stays free) but stops decay in the world
    phase. `NpcState.alerted` is the on-edge flag (cones.ts reads it); statuses are M1-06's. NPCs hand their reactions
    to M1-06 as `NpcState.wants` (react > challenge > escort > investigate > face, with the tile last seen and when it
    was decided); camera `!`s queue in `State.cameraReports` for M1-08. Later actions call `perceiveEnd(ctx, crew)`
    after every action and `witnessAct(ctx, crew, act)` for illegal acts. Frisk range is Chebyshev (rules.py uses
    Euclidean 2.2); civilians in the Secure zone read the Staff zone's civilian column (rules.py: nothing). Only the
    staff uniform is in (the guard and courier uniforms are M2-03's; `holsterable` marks the pistols they affect).
    `assessPath` judges a whole move (the move hook applies exactly it); `worldPoses` works out every NPC's walk once
    so the overlay can ask `assessWorldPhase` about many tiles; `assessWorldPhase` includes a trespass deadline falling
    due (`deadlineOutcome`, the same function the deadline hook uses). Each NPC's walk opens only its own doors.
    Deferred: §8.7 "once loud, an unexposed Clean crew member counts as a civilian" (→ M3); the security chief
    remembering faces (§16.2).
- [x] **M1-06 NPC schedules and intents.**
  - **Covers:** §6.1, §6.4, §16.1, §16.3, §8.5 (Curious turns, Investigating walks), "one investigates, the others watch".
  - **Work:**
    - Change the generator to emit typed `ScheduleBlock.activity` values plus target tiles.
    - A schedule interpreter that gives each NPC a goal for each turn.
    - Committed intents with path, facing and action.
    - Routine walking (§6 decision Q4).
    - The Calm → Curious → Investigating → Alerted states; the cautious search.
  - **Files:** `src/gen/population.ts`, `src/sim/rules/npc/*`.
  - **Depends on:** M1-02, M1-03. **∥** M1-05.
  - **Accept:** a generated bank runs 45 turns with nobody stuck or on a blocked tile; intents equal what was carried out the next phase.
  - **Note from M1-05:** NPC reactions arrive as `NpcState.wants` (rules/suspicion.ts). A want formed in the crew
    phase must rewrite `npc.intent` at once (in the same command), so its telegraph shows during that crew phase and
    the world phase's perception (`sightingsAlong`, judged on the intents frozen at the start of the phase) looks along
    the new facing and path. A want formed in a world phase becomes the intent committed at its end (§6.2).
  - **Notes (done):** `src/gen/routines.ts` types each person's text schedule into `GenPerson.routine` (`RoutineBlock`:
    `Activity` post, window, break, lunch, shiftChange, cashRun, inspection, smokeBreak, serviceVisit, queue, wait,
    counter, patrol, sweep, closingSweep, leave, offMap; `at`/`facing` or `route`; `label` for the card), which
    `worldFromBank` turns into `PersonDef.schedule`. Its rolls (customers leaving and coming back) are a `routines`
    stream; population.ts is untouched, and the sweep and the visual baselines are unchanged. Event blocks carry a
    `setOff` (travel time, so the NPC is there on the timeline's turn); an event that clashes with an earlier one of the
    same person moves to the nearest free turn before closing (its timeline entry with it) or is called off; an IT
    visit without a technician is dropped. World-phase sightings are judged along the walks as they will be taken
    (`worldWalks`: a crew member in the way or a newly locked door limits sight), and `assessWorldPhase` for a tile the
    crew member isn't on applies ending the move there first (sightings, then `reconsider`) on a copy. `rules/npc/`:
    `schedule.ts` (queries: `activityAt`, `nextActivity` "vault inspection in 6", `scheduleTurns`/`nextScheduleTurn`
    and `startingOn` for Wait for), `behaviour.ts` (goals from wants: Curious faces, Investigating walks hurried and an
    enforcer frisks next to them, one investigates (`investigatorOf`/`pickInvestigator`) and the others watch, a lost
    trail searches 2 phases, the challenger walks over, the escort keeps off the Public floor; statuses; reactions by
    role through `registerReaction`), `intent.ts` (`npcs.intents` commits every NPC in resolution order, and at the
    start of a heist; `reconsider` re-plans in the crew phase only the NPCs whose goal changed, called by
    `applySightings`), `walk.ts` (paces 4/5/8, doors by observer class, `planWalk`, `resolveWalks`) and `act.ts`
    (`npcs.passive`: walks exactly the frozen intents, stopping before a crew member or a door that became impassable,
    then frisks and telling a guard; `npcActSightings` feeds both into `assessWorldPhase`). A committed walk never ends
    on another NPC's tile or committed end, so NPCs never share a tile. NPCs keep out of the vault (M2-05). Off-map
    people have the status `away` (absent from sight, sound, occupancy and doorways; the scene must hide them).
    **For M1-08:** reactions that start carriers are intents `{ kind: 'raiseAlarm', carrier, crew }`, committed only
    once the NPC is at its station; carry them out from `WorldPhase.intents` in a passiveNpcs hook ordered after
    `npcs.passive` (0), then add the crew id to `NpcState.reported` so the reaction only watches; the guard's
    "Hands up!" can replace the guard reaction with `registerReaction(role, …, { replace: true })`. Panicking
    civilians commit `panic` (M2-02).
- [x] **M1-07 Turn loop and crew actions.**
  - **Covers:** §6.1–6.3, §6.6, §8.10, §11.10 (knockout).
  - **Work:**
    - The crew phase: 2 actions each, interleaved between crew members.
    - Move, Dash, Interact with doors (open, close, lock).
    - Knockout: out cold 4 phases, wakes Alerted.
    - Evidence (§8.10): minor and major evidence, and the NPC who investigates it.
    - End turn running the world phase in the §6.1 order.
    - Whether each action can be undone.
  - **Files:** `src/sim/rules/actions/*`, `worldPhase.ts`, `evidence.ts`.
  - **Depends on:** M1-05, M1-06.
  - **Accept:** the §6.2 double takedown (a witness dropped in the same crew phase never acts); undo is allowed only when nothing was revealed, checked or rolled.
  - **Notes (done):** `rules/actions/act.ts`: every action but Move and Dash is a `registerAction(type, { whyNot,
    candidates, cost, illegal, run })`, whose reducer checks (`whyNot`, before anything changes or rolls), spends
    (`spendActions`, the one helper, Move and Dash included), runs, has witnesses judge an illegal act (`witnessAct`)
    and ends with `perceiveEnd`. `legalActions(world, state, crew)` lists every such command allowed now (the UI's
    menu; the property test's random player) and `whyNot(world, state, cmd)` says why one isn't. Commands:
    `door { crew, door, action: open|close|lock|unlock }` (beside the door; decision 25), `knockout { crew, npc }`
    (`inReach`: a neighbour with no wall between; not Hostile unless a `registerKnockoutWindow` says so; quiet noise 2;
    out cold `rules.knockoutPhases` (4) world phases, `NpcState.outCold`, intent cleared at once; wakes Alerted where it
    lies at the end of the 4th, `knockout.wake` in devices, and reports its assault), `drag { crew, npc }` (a body or a
    tied person in reach; `CrewState.dragging`, `carrying: 'body'` so Armed; half reach and no Dash through
    `registerBudgetModifier` / `registerDashCheck` in crew/movement.ts; the body follows each step), `drop { crew }`,
    `stash { crew, at? }` (a `dumpster`/`closet` object in reach, or anywhere in `World.stashRooms`, the cleaner's
    closet; `NpcState.stashed`), `wait { crew }` (now ends an action in view), and the generic
    `interact { crew, object, verb }` dispatched to `registerInteraction(kind, { verb: { cost, illegal, whyNot, run } })`
    (no kinds yet: M1-08 adds the panels). The world phase order stays the engine's (§6.1); there is no worldPhase.ts.
    `crewBudget(world, member, mode)` and `dashRefusal(world, state, crew)` are what the move/dash commands use: the
    reach overlay and the dash band (src/game/movement.ts, debug.ts) should call them instead of `moveBudget` /
    `dashBudget`, or a crew member dragging a body is shown twice the reach the commit allows. The scene should hide
    stashed NPCs (`stashed !== null`) and draw a dragged one with its dragger.
    - **Evidence** (`rules/evidence.ts`): sources (`registerEvidenceSource`) make `evidenceOnMap(world, state)`: bodies,
      tied people, missing colleagues and empty teller windows (staff or guards down, stashed or dragged off while their
      schedule has them standing somewhere), a Secure door left open with nobody in the doorway, holes (breached doors,
      opened walls), dead cameras, and `State.evidence` items left on the floor (`placeEvidence`: weapon, blood, an
      unattended loot bag, a drill); lights out waits for power (M4). Noticed only in the world phase (decision 26)
      along the very walks perception judges (`worldPoses`): `evidenceWorldPhase(world, state, sight, options)` is both
      the hatched overlay's answer (with `crew`/`tile` for a crew member elsewhere, on a copy) and what the
      `evidence.judge` (−101) / `evidence.notice` (−95) hooks apply. Each NPC reacts once per item (`NpcState.noticed`);
      a `bark { npc, cause, evidence, first }` names the kind the first time in the heist (`State.barked`). Minor: one
      `inspect`s (`pickInvestigator`), the others `look` for a phase. Major: Alerted, one `report`s, the others look.
      **For M1-08:** a guard's report is the intent action `reportEvidence { evidence, carrier: 'guardRadio' }` (and
      `phoneCall` for anyone with no guard about); carry it out from `WorldPhase.intents` like `raiseAlarm`, then call
      `clearEvidence(ctx, npc)`. Others walk to the nearest guard with `tellEvidence { npc, evidence }` (carried out
      here, `evidence.tell`): the guard gets the evidence and reports it. Cameras' major evidence queues in
      `State.cameraEvidence` (a `cameraSawEvidence` event), beside `cameraReports`, for the operator; a dead camera's
      feed is noticed here only by someone seeing the camera, the operator's monitors are M1-08's.
    - **Undo:** by the engine's rule. A door opened or closed through known space with nobody noticing stays
      undoable, so do a wait out of view, taking hold of a body and walking with it unseen; knockouts, drops and stashes
      are final (they change an NPC).
    - **Hearing** (§8.9, `rules/evidence.ts` `hearing`, a noise hook, crew and world phase alike): a quiet noise is
      minor evidence (`quietNoise`: hearers Curious, the nearest of the right role `inspect`s the source, the others
      look), a loud one major (`loudNoise`: Alerted, cause `noise`, one reports it: carriers for M1-08). Face-down NPCs
      hear but don't react. In a crew phase intents are rewritten at once. `noiseReactions(world, state, what, sources,
      cause)` labels the noise ring's ears (`status`) by the same function.
    - **Review fixes.** Dragging is an illegal act for as long as it lasts (`CrewLook.act`, `!` in `reaction` for any
      observer, Core or Peripheral, mid-move too). A dragged body is where its dragger is (`rules/place.ts`
      `bodyPos`; `onFloor` takes dragged NPCs out of occupancy and walks, `placeCrew` is how overlays move a crew
      member), so taking hold and walking unseen stay undoable; drop and stash are final. Knockouts: not on the tied or
      the commanded, not while dragging, witnessed on the attacker's and the victim's tiles (`witnessOn`); waking
      searches outward by legal steps (`reachable`, no walls, doors or ledges) for a free tile. `inReach` respects
      levels (only up or down a climb). Evidence is per occurrence (`evidence.forget` drops what is gone from
      `noticed` as each crew phase begins); bodies don't hold doors open; a bark only uses up its named first time when
      the crew can see the barker; `projectEvidenceSightings` filters predictions to NPCs and cameras the crew knows.
    - **The hatched overlay of a planned move is judged on its preview** (`assessWorldPhase(world, preview.state,
      …)`, `evidenceWorldPhase(…, { move })`): the bare-tile form misses a `!` mid-path, the doors the path opens and
      a dash's noise. The property test does so for moves and dashes.
- [x] **M1-08 Alarm carriers, check-ins and cameras.**
  - **Covers:** §8.11, §8.12, §9.1 (the stealth carriers), §9.2, the patrol drive-by and dispatch in §16.4.
  - **Work:**
    - Each carrier has a countdown of at least 2 and its counters.
    - Disabling the alarm panel: hacking kit, 4 actions.
    - The operator's monitors cycle through the live feeds; verify; looping a feed; the recorder.
    - Check-ins and answering them; the missed-call carrier.
    - The Alarm event and "Police in N".
  - **Files:** `src/sim/rules/{carriers,cameras,checkins}.ts` (and `alarms.ts`, `cctv.ts`).
  - **Depends on:** M1-07. **∥** M1-10, M1-11.
  - **Accept:** a property test that every carrier is created with a countdown of at least 2 and every carrier type has a counter that works mid-countdown; scenario "the panel is dead, so the teller's button is dead".
  - **Note from M1-05:** camera `!` sightings wait in `State.cameraReports` (one per camera and crew member; a
    `cameraSaw` event each time). The hatched overlay judges each camera at the facing it pans to next
    (`cameraObserver(…, next = true)`), so a panning camera must advance exactly one step per world phase.
  - **Notes (done):** `rules/carriers.ts` (the table, starting, counters, ticking, the Alarm, previews), `alarms.ts`
    (carrying out the NPCs' alarm intents, "Hands up!", the alarm panel, the jammer, traits, the escapee's starter),
    `cameras.ts` (panning, the operator, looping, footage and the recorder, the controlled CCTV room), `checkins.ts`
    (check-ins, answering, dispatch, the patrol drive-by) and `cctv.ts` (who watches: the desk, the operator, the
    monitors' feeds). Decisions 29–36.
    - **Carriers** (`CARRIERS[kind]`: label, wired, radio, the design's counters with `now: true` or the milestone that
      brings them). Every rule starts one through `raiseCarrier` (refused once the Alarm is up; a wired one with a
      dead panel emits `alarmDead` instead; a source keeps one carrier per kind). `Carrier.about` is the crew member,
      `subject` the NPC (the guard of a missed check-in). Counters that are conditions are `registerCarrierCheck`s,
      applied after every command and before the tick (`settleCarriers`): the source NPC down (out cold, dead, tied,
      stashed, dragged) counters, commanded pauses; the dead panel counters wired kinds (in progress too); a jammer in
      range (8) pauses radio kinds. A countered carrier is removed (`carrierStopped { why }`); a paused one stays with
      `halted: 'paused'`. `carrierStarted` carries `holder` and `pos` (not `source`, so the projection never drops a
      carrier). At 0: `bank.alarm`, `State.response { raised, by, policeIn: rules.policeEta (tier: 8/6/4, set by
      worldFromBank), heat: { level 1, tick 0 } }`, every other carrier stops (`why: 'alarm'`); `policeIn` counts
      down one per world phase from the next (`policeCountdown`); arrival is M3's.
    - **Previews** (for M1-09): `pendingCarriers(world, state)` is the coming world phase's new carriers, by the world
      phase's own reducers on a copy (the hatched overlay's carriers; not per tile); `carrierPreview(world, before,
      result)` gives what a previewed command starts and stops at once and what it makes the world phase start ("this
      would start: Operator verifies (2)"); `projectCarriers` keeps those of NPCs the crew sees or predicts. The
      property test checks every `carrierStarted` is ≥ 2 and `pendingCarriers` equals what `endTurn` starts
      (3,000 worlds pass); `tests/sim/carriers.test.ts` plays a counter mid-countdown for every kind.
    - **Commands for the UI:** `interact { object: <alarmPanel>, verb: 'disable' }` (hacking kit, 1 action each, quiet 1,
      'hack'; `panelWorkLeft` for "2 more actions"), `interact { object: <recorder>, verb: 'take' | 'destroy' }`,
      `loopFeed { crew, object: <cctvDesk|serverRack>, camera }`, `answerRadio { crew, npc: <guard> }` (also during a
      missed check-in's countdown), `placeJammer { crew }`. All in `legalActions`. Crew traits: `CrewStart.traits`
      (`steadyHands`, `smoothTalker`, …; `CrewState.traits`).
    - **Data for the HUD:** `state.carriers` (+ `CARRIERS[kind].label`), `state.response`, `state.radio.calls[guard]`
      (`next`, `missed`, `ringing`: the guard tag's next call), `answersLeft`, `nextDriveBy`, `state.jammers`,
      `state.footage` / `filmedCrew` / `footageKept` (the debrief), `knownView(...).cameras[i].monitored` and
      `loopedUntil` once the CCTV room is scouted, `cctvControlled`. Events: `confronted`, `alarmAttempt`,
      `alarmDead`, `operatorVerifies`, `operatorSentGuard`, `checkInRinging`, `checkInMissed`, `checkInSearch`,
      `radioAnswered`, `dispatchLostContact`, `patrolPassed`, `feedLooped`/`feedRestored`, `cameraPanned`,
      `panelWorked`/`panelDisabled`, `footageRecorded`, `recorderTaken`/`recorderDestroyed`, `carrierPaused`/`Resumed`.
    - **Review fixes.** With an operator, a missed check-in is always his to call in: once every operator is
      neutralised, rings still pending die (no miss) and the silence takes dispatch's lost-contact path; missed
      check-ins are one carrier per guard (`raiseCarrier` dedupes by source, kind and `subject`), and answering one
      guard's radio counters only his. Projections redact instead of hiding: `carrierStarted` (`holder`, `pos`, now
      `string | null` / `Pos | null`) and `projectCarriers` null the holder and place of an NPC the crew doesn't know,
      keeping kind, countdown and `about`; `knownCarriers(world, state)` is the ledger's running carriers, the same way.
      `walkingToAlarm(world, state)` lists NPCs on their way to start a carrier (§4): kind, `eta` (world phases until it
      starts, exact for a committed action, else the committed walk plus the straight way left at its pace), `alarmIn`
      (eta + 2), holder and destination redacted the same way; a dead panel's buttons and anything after the Alarm
      aren't listed. A phone call made at the caller's own desk or window is a landline (`Carrier.line`) a jammer
      doesn't stop (cutting the line will, M4); anyone else uses a mobile. The operator's carriers (verify, missed
      check-in) are drawn at the CCTV desk, so a jammer must reach the desk, and a verifying operator's intent stays at
      the desk (`pinVerifiers`). `pendingCarriers` is cached per state; `carrierPreview` also names a world-phase carrier
      whose countdown or crew member the command changes. `tests/sim/carriers.fuzz.test.ts` fuzzes the promises on
      generated banks (every tier × archetype; larger with `CARRIER_FUZZ_*`).
    - **Known gap until M3:** the passing patrol car has one working counter (a jammer); taking both officers down
      comes with combat. `tests/sim/carriers.test.ts` ('known gaps') fails once M3 makes it work, as a reminder.
    - **Not yet:** shooting cameras and the officers (M3), the escapee's and commanding's starts and counters (M2:
      `startEscapee` is the hook), cutting the phone line (M4), the vault sensors' starters and wiring box (M2-05).
- [x] **M1-09 Previews, safe floor and the property test.**
  - **Covers:** §8.8, §8.9 preview, §20.2.
  - **Work:**
    - `safeFloor(crew, path?)` with every tint: green, amber with a pip count, challenge, red, the hatched versions, camera, grey, hatched grey.
    - The eye icon on the first unsafe tile; "who and why"; the noise ring with an ear badge per NPC; a preview of the carriers an action would start.
    - The property test of §2.2.
    - What the player sees is projected through the crew's knowledge (M1-10). A `PreviewResult` is engine-internal: it is the truth, including NPCs and decisions the crew can't know, so it is never shown as it is.
  - **Files:** `src/sim/preview/*`, `tests/sim/preview.property.test.ts`.
  - **Depends on:** M1-07, M1-08, M1-10.
  - **Accept:** 0 differences over 5,000 random commands across 20 seeds plus the fixtures. The test runs under 30 s in `npm test`, with a larger run behind an environment variable.
  - **Notes (done):** `src/sim/preview/`, exported from `src/sim/index.ts`.
    - **The picture** (`picture.ts`, `previewPicture(world, state)`): every preview judges on it, never on the truth. NPCs
      the crew doesn't see or predict are `away` with no intent (absent from sight, sound, walks and doorways, as
      `crewPicture` leaves them out, yet the whole engine can run on it); cameras it has never seen are off; until the
      CCTV room is scouted every known camera counts as live.
    - **Safe floor** (`floor.ts`, `safeFloor(world, state, crew, { bands?, look?, dash? })`): per tile `{ pos, band:
      stay | move | dash, cost, path, knowledge, unknownPath, now, next, tint }`, `tint = { kind: safe | amber | red |
      trespass | camera | grey | unknownRisk, hatched, pips: [{ npc, pips }], eye, camera }`. `now`/`next` are
      `Effect`s (`effect.ts`: exposed, watching (seen by one who already knows them: red), pips by NPC, challenged,
      cameras) read off the events of `applySightings` on a copy, so pips adding up to Exposed, a second challenge or a
      camera reporting twice come from the one writer. Now: `assessStep` on the tiles passed and `assessEnd` at the
      end, per door set (`sightsAlongWalk`), the reach being a tree so each tile is judged once; a dash someone in the
      picture hears first has them react (`reactToNoise`). Next: `assessWorldPhase` on what the move leaves, each door
      set's `worldPoses` worked out once and only changed walks walked again (`posesAfter`). Tint: the worse of now and
      next (hatched when next is strictly worse); grey for unscouted, hatched grey (`unknownRisk`) where the known NPCs
      leave it green but the tile, or a tile its path passes, is unknown risk for this crew member (decision 24). Cached per state object; `bands` lets the
      scene draw the Move band at once and the Dash band a frame later. `overlayTiles(floor)` maps it to the world
      overlay's `safeFloor` states.
    - **Drawn paths** (`pathSafety(world, state, crew, path, { mode? })`): each step's `!`s (only `!` counts mid-move),
      `firstUnsafe` (the eye: the first step with a `!`, else the end when its tint warns), the end judged as a floor
      tile. **Who and why** (`explain.ts`, `explain(world, state, crew, tile, { path? })`): one line per observer and
      phase that acted, `{ observer, by, phase: now | next, from, to, outcome, known, why, text }` ("Guard: sees
      Armed", "Teller: +2 (Staff zone)", "Camera 2 would see you", "Teller: \"Hey, you can't be back here\""), or why
      the crew can't tell. **Any command** (`action.ts`, `actionPreview(world, state, cmd)`): previewed on the truth and
      projected: events, noises (ring tiles, an ear per known hearer with its badge and who is sent), witnesses,
      carriers (starts, stops, world phase), undoable as far as the crew can tell, cost, odds, a move's `pathSafety`.
    - **Fixes elsewhere.** `rules/knowledge.ts`: an NPC seen standing as a world phase ended became a ghost as soon as
      the crew looked away in the crew phase, though it hadn't moved (its tick equalled `phaseTick`), so the picture
      dropped an NPC on a fresh tile and the safe floor showed green where it watched; the end-of-phase look is now dated
      after `phaseTick` (walk-only sightings stay at it). `rules/npc/walk.ts`: `search` toward a target someone stands
      on explored the whole map (a dash's hearers walk to the noise at the crew member's feet: 20–200 ms per dash
      preview on HQ banks); it now stops once its answer is certain, with the same walks (checked against the full
      search over the whole test suite). `rules/evidence.ts` exports the hearing hook's body as `reactToNoise`.
    - **Measured** (desktop Node, generated banks in play): Move band median 2 ms, p90 5 ms, max 10 ms (HQ) to 30 ms
      (small); with the Dash band median 2–5 ms, p90 20–30 ms (in the property test, omniscient crews included, p90
      35–70 ms): a dash heard by NPCs is judged with their reactions, tile by tile.
    - **Property test** (`tests/sim/preview.property.test.ts`): random fixtures and generated banks (every tier ×
      archetype), omniscient and real-knowledge crews, random legal commands (moves and dashes to floor tiles, drawn
      paths, every `legalActions` action). Each move's tile is checked against the move and the end of the turn
      committed on the picture (0 differences allowed) and against the truth as the crew perceives it (omniscient: 0
      differences; otherwise only what the crew can't know, by class); each crew member's own tile before every end of
      turn; the eye, "who and why", action previews (events, carriers, ears and badges) and the dash ring. Default 40
      fixtures + 10 of the 13 banks (every fourth tier × archetype left out, a different one per seed: generating a
      bank is most of the time; ~575 commands, 16 s alone, 20 s within `npm test`); `PREVIEW_PROBE_SCALE=10`: 6,092 commands over 540 seeds, 4,952 tile
      and 3,916 stay checks, 0 differences; the truth differed only by 249 moves cut by someone unseen. Green never got
      the crew member spotted during the move (1,333 green moves); in the world phase 36 of 2,747 green tiles were
      spotted by NPCs the crew didn't know (decision 24 promises only the known NPCs' walks), never by a known one.
    - **For the UI** (src/scenes, src/game): fill the overlay's `safeFloor` with `overlayTiles(job.floor())` for the
      selected crew member, where `job = safeFloorJob(world, state, crew)` is stepped each frame with `job.step(now +
      6, now)` (the rules read no clock: the scene lends `performance.now`) until `job.done`; `safeFloor` is the same
      job run to the end. While a path is drawn, `pathSafety` for its tints and eye (`firstUnsafe`; each step's `stop`
      is what stopping there does); long-press: `explain`; Confirm's preview: `actionPreview` (its `noises` feed the
      ring and ears, `carriers` "this would start", `witnesses` the eyes over heads).
    - **Review fixes.** The incremental job above. The tint's pips are every pip added this turn, per NPC (the move and
      the world phase together), and `overlayTiles` draws the most any one NPC adds (2 or more: two) with the list;
      a hatched tint keeps the move's camera flag. A drag that ends on a teammate is judged up to its last tile it can
      stop on. "Who and why" adds its knowledge line to grey and unknown-risk tiles whatever else it says. Faster: the
      copy a tile is judged on deep-copies only the NPCs that see or hear (the rest shallowly, with their routes), a
      dash's ring holds only the tiles NPCs stand on (all hearing reads), a world phase in which standing NPCs only
      turned keeps every walk, unknown risk is remembered per state object (`rules/knowledge.ts`). Not done: memoising
      the hearers' reactions by the hearing alone, which isn't exact (the one sent to look walks round the crew member's
      own tile, which differs per tile). Measured before → after, p50 / p99 ms (desktop, generated banks, 15-turn
      games): Move band small 2.7/26.5 → 1.9/20.3, city 2.0/10.7 → 1.5/8.6, HQ 2.1/11.0 → 1.7/9.0; whole floor small
      7.9/130 → 6.4/90, city 2.3/65 → 2.0/58, HQ 2.9/83 → 2.7/43. The property test's truth check now accepts a
      difference only when NPCs the crew doesn't know acted on the crew member, told a known NPC, or left a known NPC
      walking or standing otherwise than on the picture (both runs compared), and plays long quiet games
      (`PREVIEW_LONG_GAMES`, `PREVIEW_LONG_TURNS`, default 2 × 25 turns); it also checks every drag prefix against the
      floor, each step's stop, "who and why" naming exactly the observers behind the effects, and the stepped job
      against `safeFloor` (and that neither changes the state). `PREVIEW_PROBE_SCALE=10 PREVIEW_LONG_GAMES=26`: 7,667
      commands, 6,313 tile and 5,194 stay checks, 4,940 drag prefixes, 0 differences; the truth differed by 320 moves cut
      by someone unseen, one tile someone unseen also acted on and one told by someone unseen.
    - **Follow-up fixes.** Turn 1's hatched grey is not an empty fresh set: the state's initialiser already makes the
      tiles the crew sees fresh (a test now checks it, and that a resumed save keeps them). It is decision 24 at work:
      the crew sees 13 tiles round them in the open (10 before decision 39) and `unknownReach` is 8 (10 before decision 38), so every seen tile of the street is within
      reach of one it can't see; only spaces seen whole (rooms) read green. The scene uses `safeFloorJob` directly
      (src/game/floorJob.ts is gone) and tints the Move band a tile at a time, so the Dash band is left to the frames
      after (6–7 ms slices); `actionPreview`'s stopped carriers are typed `CarrierKind`. Selecting a crew member
      stalled ~100–160 ms in the sandbox: resizing a WebGL canvas (Act view's zoom) waits for the GPU process, which a
      software renderer keeps a few frames behind, and then the world overlay was drawn again on every frame of the
      pan to the crew member (thousands of fills each, a 1×1 rect per pixel of the Dash hatch). Now a closer zoom keeps
      the canvas and scales it in CSS (`BankCamera.applyZoom`; the filters' drawing contexts and the copy shader are
      readied while the bank builds), the overlay shifts while the view moves and is drawn afresh once it holds still,
      and the hatch is a pattern. Measured over 5 selections each (city and HQ banks, Chromium/SwiftShader): the longest
      main-thread task 117/132 ms → none over 50 ms; the worst of the first five frames 146/156 → 56/55 ms (the idle
      frame is ~38 ms there).
- [x] **M1-10 What the crew knows.**
  - **Covers:** §8.15, §17.8 (the casing layer inside a heist).
  - **Work:**
    - Tiles seen; NPCs shown live; ghosts, behind the flag for decision Q16.
    - Known routines: an NPC watched for 3 turns becomes a predicted marker.
    - Unknown-risk tiles, for the hatched-grey overlay.
    - Sound pings; the blueprint layer as data.
    - The projection from the engine's truth (states, events, `PreviewResult`s) to what the crew knows; the HUD and the overlay show only that.
    - Leaks in play mode (M1-13) to route through the projection:
      - Reach, tap snapping and drag validation (`src/scenes/bank/sim.ts`, `sim.path` in `src/game/debug.ts`) run on
        the true state, so a tile an unseen NPC stands on reads as blocked instead of open: plan against the crew's
        picture (unseen NPCs' tiles open), and let the commit say what happens.
      - Confirm's colour comes from the preview's events (`heard` makes it amber, `confirmView` in `src/game/views.ts`):
        filter them through the projection (`projectPreview` in `src/game/session.ts`) first.
      - World-phase playback: the camera visits (and `describeEvent` lines) should cover only events the crew
        perceived; today every important event is visited.
  - **Files:** `src/sim/rules/knowledge.ts`.
  - **Depends on:** M1-04, M1-06. **∥** M1-08.
  - **Accept:** a predicted NPC knocked off its routine turns into a ghost; an unscouted tile is never safe.
  - **Notes (done in the sim; call sites in src/game listed below):** `rules/knowledge.ts` keeps `State.knowledge`:
    the seen tiles and the fresh tiles (decision 24) as 6-tiles-per-character bitset strings (`knowledgeBits.ts`,
    one string per set), the rooms and cameras seen, whether the CCTV room is scouted (until then known cameras read
    `unknown` and count as live), each door's status when last seen, what the crew knows of each NPC it has seen
    (last place, facing and turn, live, turns watched, routine known, from the rota) and the loud noises heard
    (`pings`, where the sources centre, kept `rules.pingTurns` turns). It is updated by an engine command hook after
    every command (`registerCommandHook`, with the command's events, the world phase included), by a move hook at
    every step of a move and by a noise hook (`registerNoiseHook`); loaded saves are checked (`registerStateCheck`,
    a `SaveFormatError` for a broken tile set or record). SAVE_FORMAT stays 1 (save policy: the integrator bumps it).
    - **NPCs.** Live while in view, and until the next world phase once seen in this crew phase (it hasn't moved).
      NPCs seen on the way count: at a crew move's steps, along their own world-phase walks across the crew's view
      (`npcWalked` against the crew's fields at the end of the phase; a door opened and shut again mid-walk is not
      seen through), and when bumped into. A known routine (3 turns seen, in stealth, on routine; or the Guard rota,
      again whenever back on it) is predicted at the NPC's true position while `onRoutine` holds and the bank is in
      stealth: routines are deterministic, so the prediction is the truth. Otherwise it is a ghost at its last known
      place for `rules.ghostTurns` (2) turns (`rules.ghosts`, decision 16).
    - **Undo.** Every new tile, NPC in view (or seen on the way), staff or secure room, camera, CCTV room and known
      routine emits `revealed`, so a move that shows anything new is final and one through known space with nobody
      new in view stays undoable (decision 13). A move an unseen NPC noticed is final too (its perception check), with
      nothing shown about who: `noticedUnseen(world, before, result)` lets the UI say "something stirred".
    - **Moving in unknown space.** Moves are planned and validated on `crewPicture` (`registerPlanView`): an unseen
      NPC's tile reads as open. The move stops on the step before an NPC standing in its way (or before ending on
      anyone), worked out before the first step on the doors as the walk opens them; someone new coming into view
      doesn't stop it, but is revealed on the way (decision 40). When it stops, the action is spent, a `moveCut` event
      says why, and perception judges exactly the tiles walked. The preview (the truth) stops there too, but its projection shows
      the drawn path: a preview can't promise the whole path through unknown space.
    - **Unknown risk** (`isUnknownRisk`, `floorKnowledge`): a seen tile that isn't fresh, or that a tile that isn't
      fresh sees within `unknownReach` (8, the longest NPC or camera arc, from the rules; halved on a dark tile); for a crew member (`floorKnowledge(…, { crew })`,
      `unknownWatcher`), only where such an unknown observer, at its worst, would react to them (decision 24). Worked out per tile on demand, cached per sight
      map and fresh set. A tile is `hidden` (grey, never safe) only when it is neither seen nor on the blueprint's
      layout (`tileVisibility`, decision 44).
    - **Measured** (4 crew): one update after a move 0.32 ms mean on a city bank, 0.13–0.60 ms on HQ banks; one more
      step of a move ~0.1 ms; unknown risk over a move's reach 1.5 ms (city) to 4.7 ms (HQ atrium) cold.
    - **Projection and call sites.** `projectEvents(world, after, events, before, { mode })` drops events naming an
      unknown NPC in any of `npc`, `by`, `guard`, `source`, `observer`, unknown cameras, and door events nobody of the
      crew sees (unless a crew member opened it), and cuts `heard` lists. Preview mode (`projectPreviewEvents(world,
      before, result)`) judges by `before` alone, drops `revealed` and shows a cut move along its drawn path;
      playback mode (the default) also tells about NPCs seen during the command. `projectPreview` in
      src/game/session.ts must switch to `projectPreviewEvents(world, before, result)` (its current call is the
      playback form); world-phase playback and committed actions keep `projectEvents(world, after, events, before)`.
      Reach, tap snapping and drag validation use `crewPicture`; the overlay and HUD draw `knownView` (markers,
      seen / fresh / in-view tiles and each tile's visibility, doors as known, blueprint, cameras, pings,
      `unknownRisk(p)`); the safe floor (M1-09) reads `floorKnowledge` per tile: `hidden` → grey, `unknownRisk` → hatched grey where the known NPCs
      leave it green.
- [x] **M1-11 Auto-advance and Wait for.**
  - **Covers:** §6.5.
  - **Work:** multi-turn routes; the interrupt conditions; "until the manager leaves" and similar.
  - **Files:** `src/sim/rules/autoAdvance.ts`, Session hooks.
  - **Depends on:** M1-07, M1-10.
  - **Accept:** every interrupt condition stops the advance; replaying the same route reaches the same state.
- [x] **M1-12 Game Session.**
  - **Covers:** §6.6, §20.6.
  - **Work:** owns world and state; preview, commit and undo; autosave to `localStorage` and resume; the event queue; view models; `window.sim`.
  - **Files:** `src/game/*`.
  - **Depends on:** M1-01. **∥** wave 1.
  - **Accept:** unit tests with a fake storage; resume restores selection and camera.
- [x] **M1-13 Scene integration.**
  - **Covers:** §20.1, §20.2, §20.5, UI.md touch grammar.
  - **Work:**
    - Add `?play`.
    - The People layer is driven by the state; real-time patrols are switched off in play mode.
    - Crew sprites with masks, colours and ground rings.
    - Door open and closed art.
    - Taps and drags become commands; long-press.
    - World phase playback at 1×, 2× or skip, with the camera visiting important events.
  - **Files:** `src/scenes/bank/{sim,input}.ts`, `BankScene.ts`, `src/main.ts`.
  - **Depends on:** M1-12, M1-02.
  - **Accept:** an e2e test plays 3 turns through taps; screenshot `screenshots/play-start.png`.
- [x] **M1-14 World UI overlays.**
  - **Covers:** UI.md visual language, §20.4.
  - **Work:**
    - A 2× UI layer.
    - Safe-floor tints and glyphs; the path and eye icon; noise rings and ear badges; cones on long-press.
    - Badges and pips over heads; intent arrows; predicted markers; ghosts; carrier countdowns.
    - The colour-blind preset.
  - **Files:** `src/scenes/bank/overlay.ts`, `src/art/ui/*`.
  - **Depends on:** M1-13, M1-09 (an API stub is enough to start).
  - **Accept:** e2e screenshots of the §3 "hatched amber" moment and of a noise ring; a visual baseline for one `?play&still` view.
- [x] **M1-15 HTML HUD (stealth).**
  - **Covers:** §20.3, UI.md screen layout.
  - **Work:**
    - The top strip: state pill, schedule timeline, turn number.
    - The crew rail; the action grid.
    - Confirm, coloured by the kind of commitment; Undo; End turn as a hold.
    - The threat ledger; the overlay drawer; the recap card.
    - Safe-area insets.
  - **Files:** `src/ui/hud/*`, `src/style.css`.
  - **Depends on:** M1-01 (view model types). **∥** wave 1, then wired up in M1-13.
  - **Accept:** e2e layout checks at 844×390 (nothing overlaps, targets are at least 44px); screenshot.
- [x] **M1-16 The M1 bank, end to end, and cleanup.**
  - **Covers:** §22 M1 "Proves".
  - **Work:**
    - A pinned small-branch seed (decision Q1).
    - A crew of 2 with fixed loadouts, starting at the van.
    - A scripted e2e run: walk in, wait for the cleaner, disable the panel, KO and tie the operator… or the M1 subset without tying.
    - Make `?play` the default route.
    - Delete VaultScene, Guard, MoveInput, `level/level.ts`, `logic/vision.ts` and the demo HUD and e2e tests.
    - Update CLAUDE.md.
  - **Depends on:** all of M1.
  - **Accept:** typecheck, unit tests, smoke e2e and visual tests pass; the scripted run ends Quiet with the panel dead.
  - **Done.**
    - **The pinned bank (decision Q1): `31-2`, small, Two Wing** (Granite Savings, Quay Street; `PLAY_BANK` in
      `src/boot.ts`). Kept from M1-13 because the M1 plan works there: the cleaner's sweep takes him through the
      keycard staff door from the lobby on turn 11, so a crew member standing in the doorway behind him keeps it from
      swinging shut (a door stays open while someone stands beside it); the staff corridors have corners near the
      alarm closet where nobody looks for 50 turns; and after closing (turn 44) the lone guard's closing sweep takes him
      just inside the alarm closet on turn 70, with his back to the door.
    - **The crew** (GAME_DESIGN §3): Mara (Smooth Talker) has the zip-ties, no gun, and walks in Clean; Jun (Steady
      Hands) carries the hacking kit, the jammer, a duffel and a concealed pistol (Concealed, two gadgets).
    - **The scripted run** (`e2e/play.spec.ts`, "the M1 heist", @smoke, ~30 s), through `window.sim`'s commands
      only (`safeFloor` + `commit`, `waitOptions` + `waitFor`, `endTurn`): Mara and Jun walk in from the van to the
      lobby; "Wait for…" the known schedule events until turn 10; Jun slips through the staff door behind the cleaner
      (turn 11) and keeps out of sight near the alarm closet; on turn 70 he steps up behind the guard, knocks him out
      in the closet's doorway (which keeps the door open), walks in past the body and kills the panel (2 actions with
      Steady Hands); turn 73 is still Quiet. Every move is played along the path its safe-floor tile judged and its
      solid part must equal what the move did; when End turn follows it, its hatched part must equal what the world
      phase did and the tint must name the worst of the two. The route was found by a beam search over the real rules
      (green or unknown-risk tiles only, nothing noticed) and recorded; the rules are deterministic. The one exception
      is the step up behind the guard on turn 70: red, hatched, for the world phase the knockout then takes away. The
      knockout and the panel work are previewed first, and the test checks that the preview was the outcome.
    - **Not in the run: stashing the body.** In a small branch nothing makes it possible yet:
      - every small bank's alarm panel is in the alarm closet behind a keycard door, and the crew has no keys
        (`crewHasKey` is false until M2-05), so the only way in is a door an NPC opened, held by standing in it;
      - the only NPC who ever opens the alarm closet is the one guard, on his closing sweep, and the closet is a dead
        end, so whoever holds its door blocks his way out: the crew gets in only by knocking him out in the doorway;
      - he is out cold for 4 world phases (`knockoutPhases`), and wakes even in a stash; tying him up is M2-03;
      - the stashes are the cleaner's closet (a mechanical lock, opened only by the same guard's sweep, here on turn
        73, after the alarm closet) and dumpsters outdoors (behind keycard doors from the staff side, 60+ tiles away
        at half speed while dragging).
      The body therefore lies just inside the closet with the door shut. Once keys (M2-05) or zip-ties (M2-03) exist,
      the run can take the guard's keycard or tie him and stash him.
    - **Known gaps.**
      - No stashing a body on a small branch until keys (M2-05) or zip-ties (M2-03): the guard wakes after 4 world
        phases, and the stashes are behind his locks (above).
      - The patrol car has a single counter (its carrier, 2) until M3: taking the officers down is combat's.

### M2: Takeover and control

- [ ] **M2-01 Command rings, Hold, lapses and GO.**
  - **Covers:** §9.3, §10.1–10.5, §6.3 (Mask up).
  - **Work:** Threat from the weapon table; the command, panic and noise rings; Commanded pips; Hold; Twitchy NPCs with a telegraphed intent rolled on lapse; resisters (the chance is shown, and rolled on commit); GO (+1 action, free masks, ×1.5, Surprised).
  - **Depends on:** M1.
  - **Accept:** the ring preview matches the real outcome for everything not rolled (property test extended); the shown resist chance equals the chance rolled with.
- [ ] **M2-02 Panic, civilians and armed civilians.**
  - **Covers:** §10.8, §10.9, §16.2 panic weights, the escapee and phone carriers of §9.1, §16.4 passers-by, tackle.
  - **Work:** structured traits in the generator (replacing the trait strings).
  - **Depends on:** M2-01. **∥** M2-03, M2-04.
  - **Accept:** no NPC draws without one telegraphed phase (property test); the panic-spread fixture.
- [ ] **M2-03 Zip-ties, frisking, escort, coercion and disguises.**
  - **Covers:** §10.6, §10.7 (keys, drawers), §8.14 (decision Q14).
  - **Depends on:** M2-01. **∥** M2-02, M2-04.
  - **Accept:** a frisk removes hidden weapons and keycards; a disguise changes the matrix cells as §8.14 says.
- [ ] **M2-04 Loot and carrying.**
  - **Covers:** §15.1, bodies in §8.10 (drag, stash).
  - **Work:** Light, Heavy and Very heavy loot; throwing and catching; chains; dye packs; generator loot wired in.
  - **Depends on:** M1. **∥** M2-02, M2-03.
  - **Accept:** the movement penalties; the throw preview equals its outcome.
- [ ] **M2-05 Vault access: wiring the key graph into the rules.**
  - **Covers:** §15.2, §15.3, §9.1 sensors, §7.2 kits and traits (Steady Hands).
  - **Work:** turn `KeyLock` into structured keys (`gen/keys.ts`); codes and dual control at the console; the manager's PC; the time-lock window from the timeline; the drill with jams (rolled) and noise; deposit boxes; lockpicking; card readers.
  - **Depends on:** M2-03.
  - **Accept:** every generated bank's vault can be opened by all three of its keys, in a scripted test per seed.
- [ ] **M2-06 M2 interface.**
  - **Covers:** UI.md "Alarm and takeover" boards.
  - **Work:** the gold GO rail; the two-ring command preview with outcome badges and resist chances; Hold rings; lapse markers; loot counters; the throw arc.
  - **Depends on:** M2-01 to M2-04.
  - **Accept:** e2e screenshot of the §3 takeover turn.

### M3: Loud

- [ ] **M3-01 Shot geometry.**
  - **Covers:** §11.2–11.7, §14.2 bullets.
  - **Work:** the arc per bullet; rolled points saved in the state; the bullet trace (0.5-tile hitboxes, prone bodies passed over, materials, glass, teller glass, overpenetration); half cover's 90° arc with a rolled 50% block and cover HP; leaning; height; the armour formula. `previewShot` and `resolveShot` use the same trace.
  - **Accept:** a property test that for given rolled points the preview trace equals the outcome trace; the §12.1 expected-hits table checked within tolerance (warning only).
- [ ] **M3-02 Weapons and combat actions.**
  - **Covers:** §6.3, §11.8–11.11, §12.1–12.2.
  - **Work:** attack, the fire selector, reload, swap, scavenge, melee strike, taser, Watch reactions, Suppress, Brace, flip table, fused flashbang and smoke.
  - **Depends on:** M3-01.
- [ ] **M3-03 Wounds, downed and arrested.**
  - **Covers:** §11.12.
  - **Work:** Hurt crew limp, aim worse, bleed and leave blood trails as evidence; bleeding out over 3 phases; revive and medkits; NPC death, crawling and screaming; arrest.
  - **∥** M3-02.
- [ ] **M3-04 Heat and the police director.**
  - **Covers:** §13.1–13.4.
  - **Work:** the heat track and its events; levels; arrival and refills; staging points from `GeneratedBank.staging`; perimeter cars and transport vans; the greed scaling; Contain, Negotiate, Assault, Regroup.
  - **∥** M3-01.
- [ ] **M3-05 Police and guard routine AI.**
  - **Covers:** §13.5, §13.6 patrol routine, §10.10.
  - **Work:** what police know (last known positions, reports); the never-fire-through-a-standing-non-crew-body rule; freeing hostages; arrests; announced breach markers.
  - **Depends on:** M3-01, M3-04.
  - **Accept:** a property test that police never fire a shot whose preview hits a standing non-crew body; every breach is announced a phase ahead.
- [ ] **M3-06 SWAT team AI.**
  - **Covers:** §13.6 SWAT.
  - **Work:** fire and movement; Watch wedges; flanking; focus fire; timed breaches; kit use; casualties.
  - **Depends on:** M3-05. Split into two sessions if it runs past about 1,500 lines.
- [ ] **M3-07 Negotiation, release and trade.**
  - **Covers:** §10.7, §13.4. The release cap is a constant (decision Q17).
  - **∥** M3-05.
- [ ] **M3-08 Getaway driving and the outcome.**
  - **Covers:** §14.4 (driving, boarding, doors; no ram), §15.4, §15.5.
  - **Work:** reachable vehicle footprints with turning curves; leaving the plot; the outcome screen and debrief data.
  - **Accept:** the swept-path preview equals the real path.
- [ ] **M3-09 Loud interface.**
  - **Covers:** UI.md "Loud".
  - **Work:** aim mode with the loupe; nested cone arcs; cover shields; dragging Watch wedges; police markers, ghosts and pings; one-at-a-time world phase playback; the negotiator dialog; the heat strip; the driving overlay.
  - **Depends on:** M3-01 to M3-08.

### M4: Sandbox v1

- [ ] **M4-01 Charges, gaps and explosions.**
  - **Covers:** §12.2, §14.2.
  - **Work:** breach and shaped charges; thermite; tripwires; edge state changes; the loot-loss preview; debris cover; wall-gap art.
- [ ] **M4-02 Fortifying.**
  - **Covers:** §14.3.
  - **Work:** barricades, reinforcing, blinds; police breaking barricades.
  - **∥** M4-01.
- [ ] **M4-03 Power grid and darkness.**
  - **Covers:** §8.13, §14.6.
  - **Work:** the breaker and generator; Lit; maglocks; the console going dark; a dim-lighting variant for the art (decision Q10).
- [ ] **M4-04 Vehicles in full.**
  - **Covers:** §14.4.
  - **Work:** ramming; the ram truck; the backup car; police cars blocking; vehicle damage.
  - **Depends on:** M3-08.
- [ ] **M4-05 Height, the sniper nest and off-map routes.**
  - **Covers:** §14.5, §14.7.
  - **Work:** the transit track for roof and sewer routes; vents.
  - **∥** M4-01.
- [ ] **M4-06 Distractions and gadgets.**
  - **Covers:** §8.13, §12.2.
  - **Work:** the noisemaker; ringing a desk phone; the jammer; the ammo bag; the reinforcement kit.
- [ ] **M4-07 Planning screen.**
  - **Covers:** §18.
  - **Work:** crew and loadouts; starts; vehicle spots; assets with their costs and the favour cap of 8, placed on the map; output a `HeistSetup` that becomes the starting state.
  - **Depends on:** M4-01 to M4-05 for which assets exist.

### M5: Procedural banks (mostly built; these are the gaps)

| Already built | Gap, and the package that closes it |
| --- | --- |
| Plots, archetypes, programs, shapes, parcels, furnishing, stories, metrics | none |
| Key graph (text only) | Structured keys: M2-05 |
| Population and schedule (text activities) | Typed activities: M1-06 (done) |
| Traits (strings) | Typed traits: M2-02 |
| Validation §17.7, with its own vision constants | M5-01 |
| Opportunities (text) | M5-02 |
| Knowledge layers (blueprint outlines, rendering only) | M1-10 for in-heist casing, then M5-03 |
| Furnished data not exported | M1-02 |

- [ ] **M5-01 Validation on the rules' own vision.**
  - **Work:** `validate.ts`'s guard-overlap, useful-camera and Clean-route checks call `src/sim/geo`. The Clean route must be a path the safe floor shows green for a Clean crew member on turn 1.
  - **Accept:** the sweep passes; any change in the number of banks rejected is reviewed.
- [ ] **M5-02 Opportunities as mechanics.**
  - **Covers:** §17.6.
  - **Work:** discovery triggers (eavesdropping within 2 tiles for 1 turn, document objects, intel); effects wired in (the keycard in the drawer, the propped fire door, the bribe, the IT tech's card, the vault code note); the Intel journal UI with Full, Minimal or Off guidance.
- [ ] **M5-03 Knowledge across days.**
  - **Covers:** §17.8.
  - **Work:** the Blueprints and Guard rota assets; casing persisting between days; intel shown on the planning screen.
  - **Depends on:** M4-07.
- [ ] **M5-04 Generator content for the rules.**
  - **Work:** desk phones and their owners; the phone line; uniforms in the break room; keycards as items; the deposit-box intel box; a hook for placing side objectives (needed by M6).
  - **Missing interactables (found in M1-02):** the catalog has no desk phones or phone-line point (the line §9.1's calls go out on), and no vault wiring box; `worldFromBank` derives no objects for them until they are props.
- [ ] **M5-05 Playability bot (stretch).**
  - **Work:** a scripted Clean infiltrator that must reach the alarm closet unexposed on N seeds, run in the sweep.

### M6: Campaign

- [ ] **M6-01** Campaign state and save; days; the Squeeze, its thresholds and complications (§19.2). Pure, in `src/campaign/`.
- [ ] **M6-02** Contracts by stakes; chain escalation; side objectives placed through M5-04 (§19.3, §19.5).
- [ ] **M6-03** Money, laundering, the fence, crew shares, the black market and contacts (§19.4). **∥** M6-02.
- [ ] **M6-04** The roster: recruits, trait growth, injuries, jail, Notoriety and its decay, motives (§19.6, §19.7). In the rules, Notoriety raises the crew member's profile in `profile.ts`.
- [ ] **M6-05** Debrief: styles, payout, Notoriety from footage and witnesses (§15.5, §19.8).
- [ ] **M6-06** City map UI and the Squeeze timeline (UI.md "Map, planning and campaign").
- [ ] **M6-07** The case day action (a no-combat visit mode); difficulty settings and toggles (§19.3, §19.9).

### M7: The Big One

- [ ] **M7-01** The hand-authored depot site, in an authoring format that produces the same `GeneratedBank` shape (plan text plus a typed side file).
- [ ] **M7-02** Defences and the dossier: model and UI (§19.1).
- [ ] **M7-03** Finale advantages wired into the depot setup (§19.5).
- [ ] **M7-04** The Raid as a forced-escape mission; endings; carry-over and unlocks (§19.1, §19.2, §19.9).
- [ ] **M7-05** Onboarding: the three tutorial jobs (§21), if they were not done after M3 (decision Q15).

## 4. Parallel waves for M1

| Wave | Packages |
| --- | --- |
| 0 | M1-01 |
| 1 | M1-02 ∥ M1-03 ∥ M1-04 ∥ M1-12 ∥ M1-15 |
| 2 | M1-05 ∥ M1-06 ∥ M1-13 |
| 3 | M1-07 ∥ M1-10 |
| 4 | M1-08 ∥ M1-11 |
| 5 | M1-09 ∥ M1-14 |
| 6 | M1-16 |

Later milestones: within each milestone, the `∥` notes in §3 apply. UI packages (M2-06, M3-09) start once the rules they draw have stable preview APIs.

## 5. Risks

- **Preview drift.** Keep one function per rule. The property test is the gate for every package from M1-09 on.
- **The generator and the rules disagreeing about sight.** M1-02 shares the tile properties and M5-01 moves validation onto the rules' vision.
- **Saves breaking when the generator changes.** Store the world in the save (decision Q22).
- **Overlay speed.** The safe floor over about 300 reachable tiles must take under 16 ms on a phone. Precompute each NPC's sight for this phase and its committed path once per state change.
  - The overlay calls the shared assess functions (§2.2) directly for each tile and never runs `preview()` per tile: a preview copies and checks the whole state. `preview()` is for the command the player tapped and for the oracle's sample.
  - Big per-tile data (what the crew has seen) stays out of `State`, or is stored compactly (bitset strings), because the state is copied on every command.

## 6. Ambiguities, with recommended defaults

1. **The M1 hand-made bank.** Use a pinned small-branch seed, plus text-map fixtures for unit tests. Don't convert `?bank=example`: it has no doors, roles or schedules.
2. **Facing.** 8 directions in the rules. The art only has front and back views, so either add side views or show facing through the intent and cone overlays.
3. **Distance metrics.**
   - Vision and command radius: Euclidean between tile centres, with `r² ≤ R²` in integers.
   - Noise: a flood in steps that cost the same as movement (diagonal 1.5).
   - "Within 2 tiles" (frisk range): Chebyshev.
4. **NPC speed per world phase** (not in the design): routine walk 4 tiles, hurried or investigating 5, running (flee or escape) 8. The escapee's countdown is max(2, ceil(path ÷ 8)).
5. **Cone tests.** Integer cross and dot products against precomputed cos² thresholds; no `atan2` in the rules.
6. **Line of sight at corners.** A diagonal step needs both edge paths clear (so a corner never exposes anyone, §11.4). The rule is symmetric and shared with the generator, whose current check (`nav.ts:171`) only needs one path. Low objects never block sight (§8.3); vehicles (middle height) do, except for a raised observer or target (§14.7).
7. **Zones beyond the bank.** `outdoors` and `neighbour` count as Public. The mantrap is Secure, as ROOM_RULES already says.
8. **Materials.**
   - plaster, doorWood, boarded, shutter → Soft
   - concrete, brick, pier, brickPier, atm, doorService, doorBack, doorKeycard → Reinforced (keycard doors are steel)
   - vault, vaultDoor, thick → Vault
   - window, doorGlass, curtain, doorTower → Glass
   - tellerWindow → Teller glass
   - fence → Fence (its own material): passes sight, sound and bullets, blocks movement
   - rail → Rail (its own material): passes sight, sound and bullets, blocks movement; half cover, low
   - Boundary is only the plot's edge.
   - Sound (§8.9, M1-03): Glass (windows, glass doors, curtains) counts as Soft, costing 3 tiles of reach; Teller glass is armoured and counts as Reinforced, stopping it; Fence and Rail carry it for free. A closed door costs 3 whatever its material, except a vault door, which stops it.
9. **Doors.** Leaf doors start closed and close themselves at the end of the world phase unless propped (§3's staff door swings shut). Doors with a lock are locked. Staff carry the keys their role and the key graph give them.
10. **Lit.** A room is lit unless its light is `none` and it is indoors; outdoors is lit by day. Power cuts and darkness come in M4, and the baked lamps are not a rules input. Darkness is judged by the *seen* tile: an unlit tile is seen only within half of each range (rounded down), so a guard in a dark room still sees the lit lobby.
11. **Several observers per action.** Each NPC applies its matrix cell independently; the preview shows the worst tint plus a pip count per NPC.
12. **Previews that involve dice.** They show odds or geometry, never an outcome. The property test checks only the parts that aren't rolled, plus that the shown odds equal the odds rolled with.
13. **Undo.** Undoable only if the events contain movement and nothing else: no new tile seen, no perception check, no dice.
14. **Disguises (§8.14)** are in no milestone. Put them in M2-03, with tying.
15. **Onboarding (§21)** is in no milestone. Do it after M3, as M3.5, on hand-authored maps.
16. **Fading ghosts (§23.11).** Implement them behind a setting, on by default; decide in M1 playtests.
17. **The release cap (§23.10).** A constant set to the hard cap; decide in M3 playtests.
18. **Camera panning.** The generator stores `pan: [dirA, dirB]` (facing ±45°). The live feeds cycle round-robin over the monitors each world phase.
19. **Saves.** Store the whole world plus the state, not only the seeds.
20. **Property-test library.** Use the repo's own seeded `Rng`; no new dependency.
21. **Suspicion decay and undo (M1-05).** A pip decays at the end of a world phase in which the NPC didn't see that crew
    member. A crew-phase sighting that reads "—" doesn't count as seeing (it changes nothing, so the move stays
    undoable and the overlay's green holds); one in the world phase does. Seeing with an effect, in either phase, does.
22. **Second offence and cameras (M1-05).** A Warned crew member's `T` becomes `!` for the NPC that warned them and for
    any enforcer NPC, not for cameras: cameras register only `!` cells (§8.4) and the operator doesn't know who was
    warned.
23. **Civilians in the Secure zone (M1-05).** §8.4 doesn't list them; they read the Staff zone's civilian column (only
    Armed and Heavy matter to them, §8.2).
24. **Unknown risk from stale tiles (M1-10 review).** Hatched grey comes from tiles not seen since the last world phase
    ended, not only from tiles never seen: NPCs move only in the world phase, so a tile the crew has seen since then
    holds nobody it doesn't know about, while one seen earlier may. Green therefore means that no NPC, known or not,
    sees the tile during this crew phase. The fresh set restarts at the end of each world phase from what the crew sees
    then, and grows with every step and command. (The hatched world-phase overlay, about where NPCs walk next, still
    covers only the known NPCs' committed walks; the evidence warning, src/game/evidenceWarning.ts, also covers unknown
    NPCs walking into sight in the world phase, from where they could have walked unseen since the fresh sets of the
    last two crew phases, `fresh1` and `fresh2`.)
    **Per crew member, by the reaction rules (M1-09/M1-10 follow-up).** A seen tile is hatched grey for a crew member
    only where someone unknown could actually change something for them there: pips, exposure, a challenge or a camera
    report. The unknown observer is taken at its worst: any class (and the manager or the security chief, who see
    through a uniform), Alerted (one profile higher, both arcs Core, reaching 6 and 8: decision 38), facing the tile, from the
    nearest stale tile with a line of sight (which settles the band and frisk range); or a camera of unknown status,
    taken as live (it registers only `!`). Judged by `reaction` itself, with Notoriety, uniforms and a Warned crew
    member's second offence, so there is no second copy of the matrix; trespass counts; a tile passed mid-move counts
    only for a `!`. A reaction only grows as the observer comes nearer, so the worst is that of the nearest stale tile
    in sight or the nearest within frisk range, both worked out once per tile and shared by the crew
    (`rules/knowledge.ts` `unknownWatcher`; `isUnknownRisk` is the geometry alone). Why: the street at the van is within
    `unknownReach` (8, the furthest any NPC or camera sees) of unseen space, so every reachable tile used to hatch, though nobody, not even an Alerted guard, reacts
    to a Clean crew member in Public unless within frisk range: the hatch cried wolf and taught players to ignore it.
    Now Clean in Public hatches only within 2 tiles of unseen space; Concealed (read as Armed), Armed, a Clean crew
    member in the Staff zone (read as Concealed: `!` to a guard; a uniform doesn't help, the security chief sees
    through it) and Known or Wanted crew hatch as before. Grey (never seen) stays grey whatever they carry. "Who and
    why" says it: "An unseen guard could see you here (Armed)". The overlay draws it as the grey hatch alone, without
    the `?` glyph. Speed: the floor is as fast as before (same bench before → after, p50 / p90 / p99 ms, generated
    banks, 3 crew with clean, pistol and rifle, 15 turns × 3 layouts: Move band small 2.3/5.5/16.3 → 2.8/5.6/10.3,
    city 2.6/4.6/5.8 → 2.7/4.8/8.2, HQ 3.1/5.3/9.2 → 3.0/4.4/6.9; whole floor small 9.0/21.5/29.2 → 9.4/20.5/32.7,
    city 7.7/17.0/29.9 → 8.5/16.9/22.1, HQ 10.2/16.2/31.0 → 8.7/16.1/26.2).

25. **Doors by hand (M1-07).** Closing a door eases it shut without latching it (closed, not locked). Without a key,
    the crew can lock only a mechanical lock, and only from its inner side (the higher zone's, Public < Staff < Secure;
    either side between equal zones), where a thumb-turn needs none; keycards and maglocks need the key, and the vault
    door's time lock is neither. Unlocking always needs the key (keys come with the key graph). A door that swings shut
    by itself at the end of a world phase latches.
26. **Evidence is noticed in the world phase only (M1-07).** NPCs look for evidence along the walks they take in the
    world phase (from where they stand, so anything in view at the end of the crew phase counts), not after each crew
    action. What they decide is committed at the end of that world phase and carried out in the next (§6.2), so the
    crew always has a crew phase to stash the body or close the door. Seeing the act itself is the illegal act's `!`.
27. **Dragging a body (M1-07).** Dragging is the illegal act "dragging a body" for as long as it lasts (§8.4): taking
    hold, every tile walked, every action ended and the stash are `!` for anyone who sees them, Core or Peripheral, any
    zone; carrying a downed crew member is only Armed (§7.4, §11.12). The body is where its dragger is: its own
    `pos` is the tile it was lifted from, set again only when it is dropped, stashed or comes round, so dragging
    unseen changes no NPC and stays undoable (§6.6).
28. **Knockout targets (M1-07 review).** Tied and commanded NPCs can't be knocked out: they are face down and do as
    they are told, and there would be no status to give back when they wake. Nor can a crew member with a body in
    hand. A knockout is witnessed from the attacker's tile and the victim's.

29. **Panel work across turns (M1-08).** Disabling the alarm panel is 4 actions of 1 each (`interact … disable`), so
    with 2 actions a turn it spans turns; the work stays on the panel (`ObjectState.progress`, counted in plain
    actions' worth) and anyone with a hacking kit can carry on. Steady Hands does two actions' worth per action (2
    actions). Each action is a quiet noise of radius 1 and the illegal act 'hack'.
30. **Alarms at a station start on arrival (M1-08).** A teller or the manager Alerted away from the button walks there
    (the intent arrow, with its action, is the telegraph) and starts the carrier (2) once there, rather than a carrier
    of path + 1 from the moment of the alarm: the crew sees the same walk, and the countdown is never below 2.
31. **The operator acts in the world phase (M1-08).** A camera's `!` in a crew phase waits for the world phase (§6.2):
    an operator dropped in the same crew phase never verifies. A report counts only if its camera was on a monitor that
    turn (the feeds cycle round-robin over the cameras in id order, `monitors` at a time, the same in a turn's crew
    and world phase); off the monitors it is gone (only the recorder keeps illegal acts). Major evidence waits on its
    camera until the feed comes up, then the operator sends the nearest free guard to look (minor `sent`).
32. **"Hands up!" (M1-08).** Only a guard who sees the crew member when he raises the alarm confronts (draws and
    shouts: loud 6, the bank goes Loud) and the radio carrier (2) starts with it. He is not Hostile until combat (M3),
    so knocking him out still counters it.
33. **Check-in timing (M1-08).** A call is made in the world phase; a downed guard's radio buzzes (quiet 3) and rings
    through the next crew phase (answer: 1 action in reach of the body); unanswered at the next world phase it is
    missed. A guard inside a jammer's range is tried again the next phase. Answering also counters a missed
    check-in carrier mid-countdown (it uses an answer). An operator away (smoke break) calls once back; a neutralised
    one never: then dispatch counts the silence (also while a jammer runs).
34. **The patrol drive-by (M1-08).** A scripted outside observer for M1: the car drives the main street lane
    (`World.patrol`, from the plot's street exits) in the world phase of the timeline's drive-by turns and of
    dispatch's; its officers look both ways from every other lane tile with the calm NPC profile and read the crew as
    cameras do (only `!`), see major evidence, and hear loud noises that reach the lane that turn.
35. **Carriers after the Alarm (M1-08).** The Alarm is one event: once it is raised the other carriers stop and no new
    one starts.
36. **Footage needs a recorder (M1-08).** Cameras record to the CCTV desk's recorder; a bank without one (the small
    branch's record-only cameras have no desk in the generator yet) keeps no footage for now.
37. **Routes and auto-advance (M1-11).** A multi-turn route is the player's plan, not the bank's: the Session keeps it
    with the UI state (saved and resumed with it), not in `State`, and `autoStep` takes and returns it. Each crew phase
    a crew member walks it with one Move per action left (two a turn), each as far as Move's budget reaches on the
    crew's picture; a Dash is never automatic (noise is a decision). Auto-advance stops on what the crew can know only:
    projected events and NPCs it sees or predicts, so an unseen NPC's change stops nothing. Interrupts are the §6.5 list
    plus any carrier, a cut move, evidence noticed, a challenge, an exposure and an NPC turning Alerted; a crew move's
    interrupt stops before the next command, so the rest of the crew phase is the player's. Schedule events are those
    of NPCs whose routine the crew knows. While waiting for something else, schedule events don't interrupt. "Until X
    leaves" means leaving the room it was in (or the map), "until the guard passes" its walk crossing a chosen tile
    (the menu offers the tile of its intent nearest the selected crew member). A run plays at most 20 turns.
    Review: a step is never auto-committed if its preview (projected) warns of suspicion, exposure, a challenge, a
    carrier or a camera sighting: the Move is cut before it and the run stops `unsafe` there (the drawn route marks
    this turn's unsafe tiles; later turns' numbers read "~N"). Routes advance by the steps walked, so loops walk as
    drawn; a known NPC in the way gets one turn to move on. Stops point at where the crew knows an NPC to be. A wait
    walks no routes and ignores public civilians coming into view; a Go counts schedule events only within 12 tiles
    (or the room) of the crew or its routes. Routes come back with an undo, and the last stop is kept with the UI.
38. **Alerted NPCs see no further (§8.3, §8.7).** An Alerted NPC keeps a calm one's ranges (Core 6 tiles / 90°,
    Peripheral 8 / 140°) but its whole cone counts as Core, so any movement in it gets the full reaction; it still
    reads every crew member one profile higher, and darkness still halves the ranges. Before, it also saw 2 tiles
    further in both arcs (Core 8, Peripheral 10, `alertedRangeBonus`, now gone). Why: one effect, not two: alerted NPCs
    watch their whole cone closely but see no further. `unknownReach` follows from the profiles (`geo/cones.ts`), so
    the unknown-risk reach is 8, the furthest any NPC or camera sees.
39. **Crew sight is further than a Dash (§8.15).** Crew members see all round to 13 tiles (`crewRange`, was 10;
    darkness still halves it). Why: a Dash reaches 12 tiles, and a crew member who could dash further than they can
    see felt wrong; at 13 a Dash in the open always ends on ground they could see before moving. Larger fields cost
    little (10 → 13, 3 runs each, `knowledge.test.ts` and `PREVIEW_PROBE_VERBOSE=1` preview property): one fresh crew
    field 0.08–0.11 → 0.13–0.19 ms; knowledge update after a move, mean 0.24–0.37 → 0.26–0.42 ms (city and HQ); safe
    floor median / p90 ms small 8.6 / 31.8 → 6.0 / 34.2, city 4.9 / 45.9 → 4.6 / 31.3, HQ 5.2 / 24.4 → 5.2 / 20.8.
40. **A stranger coming into view doesn't stop a move (§8.15).** A Move or Dash walks its whole drawn path when an NPC
    the crew has never seen comes into view on the way; the NPC is revealed as it is passed, and the move becomes
    final (it revealed something). Only a bump stops a move short (`moveCut`, reason `bump`). Before, the move stopped
    at the step the stranger came into view, the action spent ("Hold up, someone there!"). Why: the player chose the
    path, and the stop threw a planned move away for nothing they could act on; with crew sight at 13 tiles it came
    up on most long moves.
41. **Focusing on a character keeps the zoom (§20.1).** Selecting a crew member (a tap, their card or their key)
    centres on them at the player's zoom, without zooming in to Act view. On the tactical map the map stays, showing
    the whole plot, and leaving it lands on them. Playback and the ledger only pan. Why: the player sets the zoom, and
    focusing on someone shouldn't take it away.
42. **Tapping the selected crew member deselects (UI.md "Touch grammar").** A plain tap on them (their tile or their
    drawing), their rail card or their number key selects nobody and drops any pending preview: no range, safe floor or
    action grid, as at the start of a heist. Before, a tap on their tile did nothing and their card or key only
    refreshed. A drag that starts on them still draws a path. The camera stays where it is.
43. **Unknown observers only where one could be (§8.8, refines 24).** An unknown NPC stands only on a tile that isn't
    fresh: anywhere on a hidden one (what stands there isn't known), and on a stale one only where a person can stand
    (not known furniture: `blocksMove`, what the Move and Dash bands go round). Sight from unknown space runs on the
    layout as the player knows it (`knownSight`): what stands on hidden tiles and the walls between two hidden tiles
    let it through; the outline where hidden tiles meet known ones stops it. An
    unknown camera hangs only where the player can't see the layout: a tile never seen in a room the blueprint shows
    only as an outline (nowhere, with Blueprints); furniture doesn't stop one. Cameras don't move, so a camera on the
    blueprint's layout is known from the start, and one elsewhere once its tile has been seen: from then on it is a
    known camera (feed status unknown counts as live) and never unknown risk. Each kind has its own reach (an Alerted
    NPC's 8; a camera's 7, none on a dark tile for cameras blind in the dark), and frisk range only matters for NPCs.
44. **Three tile states: hidden, not seen this turn, seen this turn (§8.8, §8.15, §17.8; `tileVisibility`).** Hidden is
    a tile neither on the blueprint's layout nor ever seen (without Blueprints, the Staff and Secure rooms until looked
    into): an opaque dark block, nothing of the room drawn (props, cameras, the floor, doors, people as they are; flat,
    a raised floor under it not lifted). No move is planned into or through one (`planMoveOptions`: off limits to
    reach, the safe floor, drag snapping, path checks, routes and the move command's check), so nothing drawn traces
    what stands there; a room is entered once its tiles are seen (from the doorway). The truth (how a move walks) is
    unchanged. A route's unsafe marks preview each Move from where the player's preview of the one before leaves it
    (`previewCertain`, the crew's knowledge as before the route), and stop once that can't be told (a known NPC in the
    way, a door that could refuse, a look into hidden tiles). Seen this turn is a fresh tile: drawn as it is, people
    included. Every other tile is not seen this turn (stale, the grey veil); public floor starts there, never hidden. On
    a stale tile what doesn't move is known (the layout, furniture, cameras, whether a door locks); what moves isn't: an
    NPC is drawn there only as a predicted or ghost marker, never as it is, and a door shows as last seen, plain closed
    if never seen. Predicted and ghost markers show over hidden tiles too (above the block, at floor level), their cones
    and walks, the cameras' cones, a noise's ring and the reach band drawn only over tiles that aren't hidden. A door
    whose status the crew can't vouch for (`doorDoubt`: no tile beside it seen this turn, and a status something unseen
    could change; not breached, jammed, or an open one that never swings shut: built open, propped, the vault's) never
    shows through a preview: previews and the safe floor judge with every such door shut (`withDoubtedShut`:
    `previewPicture`, and `previewCertain` for action previews and auto-advance), and sight and hearing only grow as
    doors open, so all they show happens however those doors stand: the certain lower bound, never hidden. The world
    phase's walks don't grow that way, so an NPC that reacts to something such a door decides counts none of its
    world-phase sightings, and one whose walk such a door could stop counts only its steps before it (`CertainWalks`;
    a previewed world phase shows only those steps of its walk, and nothing else of it when its sighting of the crew
    could change with the door). A
    tile such a door could make worse than that (`doorRisk`: a known observer's sight of a tile passed (a `!`) or ended
    on, a dash's reach at an NPC, a known NPC's or camera's world-phase sight through one or from beyond one that could
    stop it) is hatched over its certain tint; a red one can't get worse; green with it is unknown risk. An action
    preview shows every sighting and hearing that happens with them shut, so a certain one is never dropped for another
    observer's doubted line; of a move through one that could refuse the mover, only who notices them on the way up to
    it shows. A noise whose hearers one could change names nobody as sent to look. Unknown observers look
    through every such door as if open. The crew plans on that picture (`crewPicture`): a move through a door pictured
    open or closed walks on, opening a closed one; one found locked or jammed stops the move on the tile before it, the
    action spent and the move final (`moveCut`, reason `door`, with the status found: "It's locked!"), as a bump does,
    and the preview shows the drawn path. A path through such a door that could refuse the crew member (it has a lock
    they hold no key to, or only hidden tiles beside it, so whether it locks is unknown) is hatched from there on
    (`unknownPath`). Unknown NPCs may stand on stale or hidden tiles; unknown cameras only on hidden ones. Why: a clear
    visual of what is and isn't known; immobile is known, mobile is unknown when not seen this turn; and uncertainty may
    only add a warning, never hide a certain one (a hatch over a red eye would hide the danger the player most needs).
45. **Hearing: the last tile heard, and looking at once (§8.9, §6.2).** Each NPC that hears a noise reacts toward the
    last of its sources whose sound reaches it (`Ring.lastHeard`: the source tiles a flood from the hearer reaches within
    the noise's budget, through doors and soft walls as when it was made; for a dash, its last tile heard there), not the
    source nearest it; the one sent walks to its own last-heard tile, and who is sent is judged by those tiles. In a
    crew phase, those who look (goal `look`) and the one sent to investigate (`inspect`, which still walks there in the
    world phase) turn to face their last-heard tile within the same command (`queueLook`, applied by
    `turnLookers` once the command's own perception is judged: after a move's or dash's sightings are worked out, after
    an act is witnessed), and turning means seeing: their sightings of every crew member where they stand
    (`lookSightings`, ending an action there) join the command's own, still one per observer and crew member, through
    `applySightings`. A hearer whose stronger want wins (react, challenge, escort, investigate a crew member) glances:
    it turns the same way for the rest of the crew phase and what it sees counts, but it keeps its goal and suspicion
    and in the world phase walks its want, facing as that walk has it (a teammate's noise turns a guard's eyes away so
    another crew member can leave its cone unseen). The glance lasts the turn: the NPC remembers the facing it turned
    from (`glancedFrom`), and one that stands through the world phase with no facing of its own faces that way again
    (npc/act.ts), a search turning on from it too (`perception.glances` forgets it before the next intents). Nobody
    face down turns. Only the facing changes; positions still
    change only in the world phase, so the fresh-tile model holds. A live knowledge marker of an NPC turned out of sight
    (seen this crew phase) takes the facing the crew could foresee (`learnNpcs`, `foreseenFacing`): with no door it
    can't vouch for, the turned facing; else the facing after the command as previewed (`previewCertain`, those doors
    shut) when it is the same with them open, otherwise the facing last seen, so the marker never tells how such a door
    stands; an NPC first seen during the command keeps the pose it was seen in. A predicted NPC that hears leaves its
    routine. The `look` evidence expires in `evidence.settle`. The safe floor and every preview run the same
    steps on their copies (`judgeEnd`: `reactToNoise`, `turnLookers`, `lookSightings`; the dash band's ring gives the
    same `lastHeard` from its per-tile rings); a turned NPC that could see a crew member through a door not seen this
    turn counts as uncertain (`viewDoubted` on its new pose: door risk, its world-phase sightings skipped), as does
    every hearer of a dash whose hearing such a door could change (`dashDoubted`). What the turned NPCs do to the rest
    of the crew counts on the mover's tile (`FloorTile.teammates`, the tint the worst over the crew, "who and why"
    naming the teammate), and so does the world phase after the move for each teammate where the move could change it
    (it touched an NPC, opened a door, or stands on or leaves a committed path): judged where they stand on the state
    the move leaves, kept as their hatched `next` where it adds to that world phase without the move (`addsTo`): "Mara
    next phase: Exposed (teller)". Door risk includes both: a doubted door that could change the teammate's view now,
    or their world phase with the move or without it. A hearer that no move or action turned (a noise made
    outside one) turns in the `hearing` command hook, which runs before every other (order -10), so the carriers, the
    cameras and the knowledge see what it saw. Unknown observers are
    already judged facing the tile at their worst, so unknown risk is unchanged. Why: an NPC that hears footsteps
    looks where they stopped, not where they first passed, and it looks then, not a turn later: a dash that ends in
    the view it turns to costs what it should.
46. **Passing through a cone counts like stopping in it (§8.5).** During a Move or Dash each observer (NPC or camera)
    that sees the crew member on any tile of it reacts once for the move, with the worst reaction it would have at any
    of those tiles as if the move had ended there (`assessPath`: `assessEnd` on every tile, `onePerObserver`: the worst
    sighting whole, the later of equals, its reaction and "who and why" that tile's; a later tile it reacts to them on
    is its `lastTile`, where it investigates, reports and their last known tile); ending in view is one of those tiles. The same everywhere:
    the safe floor's Now (each node keeps its path's worst per observer), a drawn path's steps and eye (the first step
    anyone reacts to; each step tinted by who reacts there), `explain`, unknown risk (`unknownWatcher` has no mid-move
    option: an unknown observer's pip or challenge on a tile passed hatches the tiles beyond, `unknownPath`), the
    doubted-door test (`nowDoubted`), and auto-advance through the previews. A challenge from passing through Staff
    floor in view is issued as if the move ended there; ending on Public floor then complies at the deadline (Warned),
    which breaks no rule. NPC walks in the world phase were already one reaction per observer per walk
    (`strongestAlong`). Why: walking through a guard's view is as visible as stopping in it.

### Critical files for implementation

- /home/user/BankHeist/src/gen/model.ts
- /home/user/BankHeist/src/gen/generate.ts
- /home/user/BankHeist/src/gen/nav.ts
- /home/user/BankHeist/src/gen/population.ts
- /home/user/BankHeist/src/scenes/BankScene.ts
