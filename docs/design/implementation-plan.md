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
| Traits | Structured since M2-02: `PersonTraits` (`armed`, `hero`, `bribable`, `onBreak`, `driveThrough`, `radio`); `worldFromBank` passes `armed` and `hero` to the rules. | `src/gen/model.ts` (`PersonTraits`), `src/gen/population.ts` |
| Key graph | Structured since M2-05: every hard lock's social, technical and violent keys as data (`SocialKey`, `TechnicalKey`, `ViolentKey`, the vault's time-lock window), read by `src/sim/rules/keys.ts`. | `src/gen/keys.ts`, `src/gen/model.ts` (`KeyLock`) |
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

M2 is complete: every package below has landed.

- [x] **M2-01 Command rings, Hold, lapses and GO.**
  - **Covers:** §9.3, §10.1–10.5, §6.3 (Mask up).
  - **Work:** Threat from the weapon table; the command, panic and noise rings; Commanded pips; Hold; Twitchy NPCs with a telegraphed intent rolled on lapse; resisters (the chance is shown, and rolled on commit); GO (+1 action, free masks, ×1.5, Surprised).
  - **Depends on:** M1.
  - **Accept:** the ring preview matches the real outcome for everything not rolled (property test extended); the shown resist chance equals the chance rolled with.
  - **Notes (done):** `rules/command.ts` (one module: Threat, the rings, Commanded, Hold, lapses, GO, Mask up),
    `data/archetypes.ts` (the §16.2 panic weights), `preview/command.ts` (the projected rings), `ItemDef.threat` in
    `data/items.ts`. Decisions 47–52.
    - **Commands:** `command { crew }` (1 action, illegal act 'command', a loud noise of radius R + 3, the bank Loud),
      `hold { crew }` (spends what is left, at least 1: `CrewState.holding`), `go { crew }` (free, once, not once Loud:
      `State.takeover`), `maskUp { crew }` (1 action, 0 on the takeover turn, illegal act). All in `legalActions`.
    - **The rings** (`commandPlan(world, state, crew)`, the one reading the reducer applies): `radius`, `panicRadius`,
      `commandTiles`, `panicTiles` and per NPC `{ ring: command | panic, outcome: complies | resists (chance) | ignores |
      alerted | still }`. `commandPreview` keeps the NPCs the crew knows; `holdPreview` a hold's Commanded NPCs. The
      compliant go down first, then each resister rolls (`Dice.odds('resist', chance)`): a preview stops at the first, so
      the rings are what show every chance.
    - **State:** `NpcState.command { pips, by }` (pips 0: Twitchy), `NpcState.lapse` (`flee { exit }`, `reach { crew }`),
      `NpcState.surprised` (the turn whose world phase it loses). Intent actions `stayDown`, `flee { exit }`,
      `reachForWeapon { crew }`; goals `flee`, `reach`, `phone` (rules/npc). Carriers: commanding the holder counters its
      carrier (§9.1 "command"; M1-08 paused it, which let a lapse resume it at 1), so a lapse back to the alarm starts a
      fresh one at 2, telegraphed by its intent.
    - **For the UI (M2-06):** `Session.commandRings(crew)` / `holdRing(crew)` (and `window.sim.commandRings`); the grid
      offers Command, Hold, Mask up and GO after Wait; the Commanded plate counts its pips; the crew card shows 3 actions on
      the takeover turn. Events: `commanded`, `resisted`, `ignoredCommand`, `commandPips`, `lapsed`, `drewWeapon`,
      `holding`, `tookOver`, `surprised`, `maskedUp`.
    - **Tests:** `tests/sim/command.test.ts`; the preview property test plays the takeover in omniscient runs and checks
      every NPC of `commandPlan` against the commit and each resister's shown chance against the `p` it was rolled with
      (`checkCommand`, with the ring worked out again from the weapon table and line of sight), and every end of the turn
      checks each hold against its ring; a dedicated takeover game (`takeoverGame`, open floors with a crowd, a guard,
      a teller and a manager) has floors for every outcome. World-phase comparisons stop at the first `lapsed` event
      (rolled). The perception property test
      leaves the takeover out (its own test is above). Save shape hash after the review fixes (`State.held`, with
      M2-04's fields) `99f980cc1950cf4c`.
    - **Deferred:** what a panicking civilian does (cower, flee, hide, the phone), heroes and tackle, police outside
      shifting lapses toward fleeing, blocking an escapee's route as a counter (M2-02); a resister drawing and shooting
      (M3: Hostile does nothing yet); flashbangs' 10% (M3). Until M2-02 a civilian in the panic ring reacts as to any loud
      noise (Alerted, reports it).
- [x] **M2-02 Panic, civilians and armed civilians.**
  - **Covers:** §10.8, §10.9, §16.2 panic weights, the escapee and phone carriers of §9.1, §16.4 passers-by, tackle.
  - **Work:** structured traits in the generator (replacing the trait strings).
  - **Depends on:** M2-01. **∥** M2-03, M2-04.
  - **Accept:** no NPC draws without one telegraphed phase (property test); the panic-spread fixture.
  - **Notes (done):** `rules/panic.ts` (the reactions, the hooks, the escapee's counters, the crew's tackle) and
    `rules/panicState.ts` (who panics and `NpcState.panic`, apart so suspicion.ts and evidence.ts reach it without
    loading the actions). Decisions 67–74.
    - **Traits:** `GenPerson.traits` is `PersonTraits` (`src/gen/model.ts`), no strings; the rolls are unchanged, so
      every bank is the same. `worldFromBank` turns them into `PersonDef.armed` 'hidden' (M2-03's
      `NpcState.armed`, which a frisk clears) and `PersonDef.hero`.
    - **Panic** (`NpcState.panic { since, crew, tile, reaction }`, status `panicked`, glyph `drops`): a civilian panics on
      a loud noise (the shout's panic ring among them: `CommandTarget.outcome` `panics`, the ear badge `panicked`) or
      on Exposing a crew member; frozen (`panic` intent) until its reaction is rolled as the next crew phase begins
      (`panic.react`, after the lapses, stream `panic`), shown from then, done in the world phase after. Spreads after
      the walks (`panic.spread`) to civilians within 3 tiles who see a panicker of an earlier phase. Commanded, tied or
      out cold ends it.
    - **Reactions** (`reactionOdds`, shared with lapses): cower; flee (a lapse's flight and escapee); hide (`hidingSpot`:
      the nearest tile within a run no crew member sees; there and unseen it phones: `phoneCall` at 2, mobile); reach
      (a hidden weapon, panicked or lapsing, after rolling as anyone does: decision 66); tackle (a hero beside a crew member; elsewhere a hero flees where
      others cower). A passer-by always flees. Lapses now also hide and tackle (`LapseOutcome` `hide`, `tackle`).
    - **Counters:** a carrier check (`route`) counters an escapee whose runner can't reach its way out past the crew
      (`routeBlocked`); the runner then gives up and cowers (`gaveUp`). `tackle { crew, npc }`: 1 action, in reach, on
      a runner; an illegal act ('attack'); it is Commanded by the tackler. The grid offers Tackle on a runner.
    - **Events:** `panicked`, `panicReaction`, `hid`, `gaveUp`, `tackled`, `heroTackled`, `actionLost`;
      `panicReaction` is a preview secret.
    - **Tests:** `tests/sim/panic.test.ts` (the panic-spread fixture, the shout's panic ring frozen then reacting a
      phase later, the off-duty cop's telegraphed draw with no tells, heroes resisting and tackling, hiding and calling,
      the escapee blocked and tackled, the generator's traits reaching the rules); the preview property test's takeover
      game has an off-duty cop, a hero, a passer-by and shelves to hide behind, checks the `panics` ring outcome, and
      `checkTelegraphs` fails any draw, hero's tackle, hider's call or escapee whose action wasn't the NPC's intent
      through the whole crew phase before (every game, every bank; each run records the intents as every crew phase
      begins, and a missing record fails); the takeover game has a bay to hide in and a crew member who stays beside the
      hero, and requires tackles and calls; the carrier fuzz accepts a call telegraphed by
      `hide`. `wayOut` stops its flood at the first way out it settles (no cache: what a door lets an NPC through
      depends on it, its keycard too). Save shape hash
      `efa24c46300bf6cf` (updated here, as M2-01, M2-03 and M2-04 did).
    - **Reviews:** no module cache for `wayOut` (decision 73's re-routing); a re-routed or lengthened run counts
      afresh (decision 73); the shout's panickers know the shouter (`makeNoise`'s `by`), so the cop reaches at him and
      a hider's call is about him; panicking staff roll no special (`reactionOdds`' `lapse`). The property test's
      `escapeeGame` (a runner, a wall with two gaps, a crew member in and out of them) fails on a9bc953 (escapee
      Alarms with the runner still inside, in several of its 30 games) and passes since.
    - **Deferred:** "Bold" shown on Inspect within 3 tiles and the panic badges' polish (M2-06); panicked crowds jamming
      doorways (+1 move cost, with the police, M3); police outside shifting reactions toward fleeing (M3); a Hostile
      civilian firing (M3); screaming customers (§16.2 "or screams"); barricades and vehicles across a runner's lane
      (M3–M4).
- [x] **M2-03 Zip-ties, frisking, escort, coercion and disguises.**
  - **Covers:** §10.6, §10.7 (keys, drawers), §8.14 (decision Q14).
  - **Depends on:** M2-01. **∥** M2-02, M2-04.
  - **Accept:** a frisk removes hidden weapons and keycards; a disguise changes the matrix cells as §8.14 says.
  - **Notes (done):** `rules/actions/hostage.ts` (what NPCs carry, zip-ties and the frisk, freeing, escort, coercion),
    `rules/actions/disguise.ts` (where uniforms come from), the guard and courier uniforms in `data/matrix.ts`
    (`UniformDef.cells`, `seenThroughNear`, `exposes`, `holsters`) read by perceive.ts `reaction`, the holster rule in
    profile.ts `crewLook`. Decisions 59–66.
    - **What NPCs carry:** `NpcState.armed` ('holstered' | 'hidden' | null) and `NpcState.keycard`, from
      `PersonDef.armed` / `.keycard` or by class (enforcers a holstered pistol; staff and enforcers a keycard);
      `fromBank` gives the generator's off-duty cops ('off-duty cop (armed)') a hidden pistol.
    - **Commands:** `zipTie { crew, npc }` (1, in reach, hands free, `CrewState.zipTies` 4, a Commanded, Surprised or
      out-cold NPC; illegal act 'zipTie' seen on both tiles; tied; the frisk takes the weapon and the keycard
      into `CrewState.keycards`), `escort { crew, npc }` (1, a Commanded or tied NPC; `dragging` with `carrying`
      'hostage' through `CrewState.leading`, half movement; Drop lets go), `coerce { crew, npc, at }` (1, the teller's own drawer or the vault
      console; `ObjectState.codes`), `changeClothes { crew, from }` (2, a downed guard, `NpcState.stripped`, or staff
      lockers; refused in sight of an NPC the crew sees). All in `legalActions`.
    - **Old saves:** loading checks every crew member, loadout and NPC for the keys a fresh state gives them
      (core/save.ts `stateShape`), so a save from before a package added a field is refused, not read half-filled.
    - **Keys:** `crewHasKey` is true for a keycard door with any keycard taken; an NPC frisked of its keycard no longer
      passes keycard doors (`npcCanPass(person, npc)`).
    - **Lapses:** an armed civilian always reaches for his weapon (§10.9), after the same roll as anyone of his
      archetype, so his shown lapse odds are knowingly false: the one deliberate exception to "the preview is the
      outcome" (decision 66); an enforcer without a weapon stays down. A Commanded hostage led along lapses where its escort stands and shakes free (`hostageFree`)
      unless it stays down; command and hold rings read a led hostage where its escort is (`bodyPos`).
    - **For the UI (M2-06):** the grid offers Zip-tie (with the ties left), Lead, Coerce ("open the drawer", "enter the
      code") and Change clothes; recap lines for every event. Events: `zipTied`, `weaponTaken`, `hiddenWeaponFound`
      (a preview secret), `keycardTaken`, `escorting`, `hostageFree`, `coerced`, `codeEntered`, `untying`, `freed`,
      `changedClothes`, `guardStripped`.
    - **Tests:** `tests/sim/hostage.test.ts` (tying and its targets, the frisk finding a hidden weapon only on commit and
      taking a keycard that opens a keycard door, freeing, escort's penalties, coercing a teller across the window and
      a key-holder at the console, the armed civilian's lapse, changing clothes, the holster rule, and every matrix
      cell §8.14 changes); the preview property test's takeover game ties, leads and coerces (each preview equal to its
      commit, never telling of a hidden weapon), with an armed civilian among the crowd; a regression test requires an
      armed and an unarmed customer's end-of-turn and Wait previews to be identical, and the floor's loadouts gain
      a guard's uniform with a pistol; the perception property test leaves the hostage commands to it. Save shape hash
      `e3338858992b35ee`.
    - **Deferred:** NPCs setting out to free a tied colleague on purpose (they free one only when they stay in reach;
      M2-02's behaviour or M3), police freeing hostages and what a released hostage tells (M3); which keycard opens
      which door, mechanical keys and the maglock buzzer (M2-05's key graph); what the console's codes open (M2-05);
      staff uniforms only at shift change (the lockers give them at any time until then, decision 61) and the courier
      van's uniforms (M6); the shield, negotiation and trades (M3);
      the hostage drawn standing beside its escort (M2-06).
- [x] **M2-04 Loot and carrying.**
  - **Covers:** §15.1, bodies in §8.10 (drag, stash).
  - **Work:** Light, Heavy and Very heavy loot; throwing and catching; chains; dye packs; generator loot wired in.
  - **Depends on:** M1. **∥** M2-02, M2-03.
  - **Accept:** the movement penalties; the throw preview equals its outcome.
  - **Notes (done):** `rules/actions/loot.ts` (one module: the loot's state, the commands, the carry penalties, dye
    packs, the floor's loot as evidence), the weights and numbers in `data/items.ts` (`CARRY_WEIGHT`, `LOOT_CARRY`,
    `POCKETS`, `THROW_RANGE`, the penalties). Decisions 53–58.
    - **Loot** is the World's `loot` objects worth something (the generator's drawers, bags, crates and drive rack;
      `fromBank` already made them): `State.loot[id] { holder, pos, taken, dyePack, inspected, ruined }`. The 0-value
      "loot" (the manager's PC, keys, files) stays an object for M2-05. Light is pocketed (2 stacks), Heavy and Very
      heavy go in the hands (`Loadout.carrying` 'lootBag' / 'lootCrate', Armed); hands hold one thing, a body included.
    - **Commands:** `takeLoot { crew, loot }` (in reach; from where the bank keeps it the illegal act 'takeLoot'),
      `dropLoot { crew }`, `throwLoot { crew, to }` (a bag; `throwPlan` is both the reducer's reading and the preview:
      where it lands and who catches it), `pass { crew, to }` (what the hands carry, a body too: `bodyPassed`, dragging
      seen on both tiles), `inspectLoot { crew, loot }` (a pocketed stack). All in `legalActions`.
    - **Penalties** (`registerBudgetModifier('carrying')`, `registerDashCheck('carrying')`, replacing body.ts's own):
      Heavy −2 tiles a Move, Very heavy (a crate or a body) half, a Bruiser's −1 tile; neither dashes. A Very heavy carry
      leaves only sidearms in hand (command.ts `crewThreat`, and "2+ crew aiming").
    - **Dye packs:** the generator marks the drawer (`Furnished.loot[].dyePack`; the name no longer tells), `fromBank`
      passes it on and gives `World.building` (the bank's rooms under its roof). The move hook bursts it on the first
      step outside (`dyePackBurst`, the stack ruined); inspecting finds it (`dyePackFound`). `registerPreviewSecret`
      (knowledge.ts) keeps both out of every preview.
    - **For the UI (M2-06):** the grid's Take, Put down, Throw to (a teammate the bag reaches), Pass to and Inspect cash;
      the crew card's loot badge for pockets too; the overlay draws loot on the floor and a previewed throw's arc
      (`throwPlan`); `throwTargets(world, state, crew)` for the arc's tiles; `crewLoot` for the counters; recap lines.
    - **Tests:** `tests/sim/loot.test.ts` (each penalty, pockets and hands, throw range and flight, catching and chains,
      passing a crate and a body, dye packs and their secrecy, the bag as evidence); the preview property test's loot
      scenario (`playLoot`: a crew round a heap of loot, the random player loot-first) checks every throw's plan against
      the commit, the action preview and where the bag ends (`checkThrow`); an e2e test takes and throws through the
      grid (`screenshots/play-throw.png`). Save shape hash now `af1b518cc6a483b1`.
    - **Deferred:** loot into the getaway and its counters on the van (M3-08, M2-06); picking a floor tile to throw to
      in the scene (`window.sim` only until M2-06's arc); dye packs flagged by intel (planning, M6); deposit boxes'
      Light loot and vault access (M2-05); carrying a downed ally (M3); thermite scorching loot (M4); an emptied drawer
      or a burst pack as evidence.
    - **Review fixes.** One source for the hands: `rules/hands.ts` derives `Loadout.carrying` from `dragging` and
      `State.loot` (`syncHands`, its only writer; `CrewStart.carrying` is gone) and refuses a save where they disagree.
      Uninspected cash stepping out is `cashOut` (shown, final), so a move that could burst a pack is never previewed
      as undoable; `ActionPreview.mayBeDyed` and `mayBeDyed(world, state, loot)` let the view mark it. A ruined stack
      can be put down (`dropLoot { crew, loot }`). "Pistol only" is `ItemDef.pistol` (not a machine pistol or a taser).
      The deposit boxes (`loot.behind`) stay out of `State.loot` until M2-05. The property test's throw check works out
      landing and catcher from the design itself (`expectedThrow`) and compares every offered target with it; the
      skipped dash-with-a-bag test in `move.test.ts` is filled in. Save shape hash now `117209a95b7c85de` (updated here,
      as M2-01 did, rather than by the integrator).
    - **Second review.** `cashOut` leaked the pack: it stopped once a burst ruined the stack, so a path out and back in
      twice showed dyed cash one way out and clean cash three. Now a stack is settled at its first way out (a burst, or
      known clean: `inspected`), so `cashOut` comes once per stack whatever it hid (a regression test previews one path
      with each). It applies only in a bank with dye packs (none in the M1 small branch). The move hooks' `step` gets
      where the move set off (no module state). Ruined cash put down is neither a target nor drawn; autosaves are
      checked with their world (`deserialiseState(text, world)`), so the hands check is exact on every load.
    - **Cleanup.** Whether the bank has dye packs is the tier's rule (`Rules.dyePacks`, from `GeneratedBank.dyePacks`;
      fixtures default to none), what the player knows, not the hidden `loot.dyePack` flags. The pack's window is
      rolled (`parcels.ts`, its own `dyePack` fork of the room's stream, so nothing else moves; no visual baseline
      changed), no longer always the westmost (M2-02 already dropped the "dye pack in the drawer" trait). A move through a door that could refuse it (`doubtedCut`, where
      `previewCertain` stops it) whose path leaves the building beyond the door still marks the uninspected cash
      (`ActionPreview.mayBeDyed`, from the path and `mayBeDyed` alone, `carriedOut`) and isn't undoable: final either
      way, as a refusal is too; a regression test checks dyed and clean, open and locked previews are identical. The
      save shape's cached fresh state (`core/save.ts`) is worked out per load, so it can't miss a package registered
      late. Heavy generator tests have a 60 s timeout. Save shape hash now `dcff06300b8ae7eb` (`Rules.dyePacks`).
- [x] **M2-05 Vault access: wiring the key graph into the rules.**
  - **Covers:** §15.2, §15.3, §9.1 sensors, §7.2 kits and traits (Steady Hands).
  - **Work:** turn `KeyLock` into structured keys (`gen/keys.ts`); codes and dual control at the console; the manager's PC; the time-lock window from the timeline; the drill with jams (rolled) and noise; deposit boxes; lockpicking; card readers.
  - **Depends on:** M2-03.
  - **Accept:** every generated bank's vault can be opened by all three of its keys, in a scripted test per seed.
  - **Notes (done):** `src/gen/keys.ts` (structured keys), `rules/keys.ts` (the key graph as the rules read it: cards,
    code parts, the time lock; a leaf module), `rules/vault.ts` (the console, the PC, the time lock, the drill and
    thermite, the sensors, deposit boxes), door.ts's Pick and Hack. Decisions 75–81.
    - **Structured keys:** `KeyLock.social` / `.technical` / `.violent` are tagged data with the briefing's `text`
      (`SocialKey`: `code` with its `parts`, `threeKeys` with the card, `keycard` / `buzz` / `disarmCode` with
      holders; `TechnicalKey`: `drill` with phases and sensors, `reader`, `loopedReader`, `panel`; `ViolentKey`:
      `thermite` with phases, `breach`, `smash`; the drill and thermite with their noise), plus `room` and the vault's
      `timeLock` window from the timeline (the armoured car's, else its own); each of the mantrap's doors has its lock.
      No roll changed: every bank is the same, only its locks are richer. `worldFromBank` copies them into `World.locks`.
    - **Commands:** `interact … unlock` at the vault console (the crew's known parts, or Three Keys' card), `interact …
      hack` at the manager's PC (2 actions of work, Steady Hands 1; the code part into `State.codesKnown`),
      `interact … pick` at a wall of deposit boxes (lockpick set, 2 actions, Steady Hands 1), `door … pick` (mechanical)
      and `door … hack` (card reader; the mantrap's after its camera is looped), `drill { crew, at }`, `thermite { crew,
      door }`, `fixDrill { crew, device }`, `takeDrill { crew, device }`, `interact … sensors` at the console (decision
      81). Coercion enters a key-holder's part (`ObjectState.codes` now holds parts).
      All in `legalActions`.
    - **World phase:** devices work one phase each (`State.devices`, a loud noise of 6 each), the vault door is breached
      after the key graph's phases, a deposit wall after 4 (the haul appears); jams are rolled with their odds as the
      crew phase begins (`drillJammed`), Steady Hands in reach fixes for free; outside the time-lock window a shut vault
      relocks. Seismic (Class II+, on starting) and motion (Class III, stepping in outside the window) carriers through
      `raiseCarrier`, countered by the panel and the console's wiring (and the window, for motion).
    - **For the UI (M2-06):** the grid's Pick lock / Hack reader with their work ("1/2"), Unlock vault, Hack PC (1/2),
      Pick a box, Drill, Thermite and Fix drill; recap lines for every event. Events: `vaultUnlocked`, `timeLockShut`,
      `pcHacked`, `lockWorked`, `doorWorked`, `boxOpened`, `deviceSet`, `deviceWorked`, `drillJammed`, `drillFixed`,
      `vaultBreached`, `wallDrilled`, `codeEntered` (now with its part; `npc` null for the crew's).
    - **Tests:** `tests/sim/vault.test.ts`: the acceptance test opens every tier × archetype's vault (3 seeds each,
      plus a Class III one) by its social key in the time-lock window (the PC's code on every small branch, with the
      manager's card from a frisk and a real walk to the console; dual control coerced at the console on city and HQ;
      Three Keys' card from a frisk with the CCTV room held), by the drill without Steady Hands (jams fixed as they
      come, then taken back) and by thermite, each on its own copy, and walks a crew member in (the motion sensor seeing
      it on Class III); a final check requires every route to have come up. Fixtures for the PC and
      the console, dual control, the time lock, Three Keys, jams and their odds, Steady Hands, the sensors, refusals,
      the key graph's cards (the crew's and the NPCs'), card readers, lockpicks, the mantrap's looped reader, the
      sensors' counters and deposit boxes. The preview property test's vault scenario (`playVault`: a random kind of
      vault, a crew with every kit, the takeover's shout for real) drills, burns, jams, fixes, takes back, hacks, picks
      and coerces with every preview equal to its commit, each required to happen; it passes on seeds 20261016, 777 and
      12345 (its first version injected a command the rules can't make, 3 pips, which the command check rightly
      refused). Save shape hash `f3b3351d03de6ab8`.
    - **Deferred:** the vault wiring box as a prop (M5-04; its wiring is at the console until then, decision 81); a
      power cut darkening the console (M4); thermite's fire and scorched loot (M4); heat ticks while drilling (M3); the
      Silent and Beast drills (M6 planning); the armoured car's couriers opening the vault (M6); the operator buzzing
      the crew through the mantrap (M6, with bribes and inside men; until then his card opens it); the alarm panel's disarm code
      and smashing it, and the CCTV room and counting room breaches (M3–M4, with charges); the deposit box that holds
      intel (M6); safes; the threat ledger's drill jams and "Wait" stopping at one (M2-06); NPCs noticing a code
      entered or a reader hacked beyond the illegal act itself.
- [x] **M2-06 M2 interface.**
  - **Covers:** UI.md "Alarm and takeover" boards.
  - **Work:** the gold GO rail; the two-ring command preview with outcome badges and resist chances; Hold rings; lapse markers; loot counters; the throw arc.
  - **Depends on:** M2-01 to M2-04.
  - **Accept:** e2e screenshot of the §3 takeover turn.
  - **Notes (done):** view models in `src/game/views.ts` and `worldUi.ts`, drawn by the HUD (`src/ui/hud/`) and the
    overlay (`src/scenes/bank/overlay.ts`); everything shown is a rules reading the crew may see. Decisions 82–84.
    - **GO:** gold (`ActionVM.go`), a wide row heading the grid once a takeover is at hand (`ActionVM.wide`, decision 84;
      `shownActions` counts it as two places);
      Confirm turns gold (`CommitKind` 'go'). While previewed the rail turns gold (dashed) and each card shows the crew
      member as GO leaves them (masked portrait, a third gold pip) from `Session.preview`, crew fields only
      (`crewCards(…, go)`); the pill reads GO. On the takeover turn the rail stays gold (`HudViewModel.goRail`).
    - **Command:** a previewed shout draws its two rings (`commandRings`: the panic ring dashed amber round the command
      ring in steel blue, outlines over unhidden tiles only) and over each known NPC its outcome in place of its state
      plate (face down with its pips, a resister's "5%" in amber, ignores, panics, alerted, still); the cones and noise
      ring step aside. A chip under the top strip counts them with each resister's portrait and chance (`RingsVM`).
      Confirm is steel blue for Command, Hold and Coerce. GO's Surprised wear a star.
    - **Hold:** a previewed hold draws its ring and the chip counts who it keeps; the rings of everyone holding this
      turn stay on the map, dotted (`holdRings`). Commanded NPCs lie face down (the `prone` pose, hands on the head);
      a hostage led along walks on its feet behind its escort, tethered in steel blue.
    - **Lapses and panic:** a known NPC's intent shows what was rolled (`intentPlate`): a red runner with a red run
      path to the way out, a hider's amber runner and path, a red hand on a gun (draws next phase), a tackle. The
      ledger counts each crew member's face-down NPCs to the soonest lapse (paused while a hold keeps them all).
    - **Vault work:** the ledger lists each drill and charge with its work, phases left and jam odds (none with Steady
      Hands in reach); a jammed drill is amber, "fix it". Auto-advance (Wait for, Go) stops on a jam (`InterruptKind`
      'jam').
    - **Loot:** a gold counter in the top strip (`LootVM`: carried, ruined by dye) once the crew carries any; uninspected
      cash in a bank with dye packs marks the counter and the crew card with a hatched amber "?", and a move carrying it
      out says "the cash may be dyed" beside Confirm (`ActionPreview.mayBeDyed`): never whether it is.
    - **Throw:** while a throw is previewed every tile the bag reaches is outlined in dotted gold, the arc rises with the
      distance with its shadow on the floor and the bag at the top, and lands in a green ring on the catcher or a dashed
      gold square on the floor; a tap on any tile in reach throws there (a teammate's tile too), again commits. With
      nobody to catch, Throw starts at the furthest tile.
    - **Inspect:** a long-pressed NPC is named in a tag (with its cones); a hero within 3 tiles of a crew member is
      tagged "Bold" (§16.2); nothing else (an off-duty cop has no tells).
    - **Tests:** `tests/game/takeoverUi.test.ts` (the GO rail from the preview, rings and outcomes only for known NPCs,
      the resister's chance, lapse and hold rows, intent plates, the star, drills, loot), the jam stop in
      `tests/sim/vault.test.ts`; e2e "the §3 takeover turn" (`screenshots/play-takeover.png`, `play-takeover-held.png`)
      and a tap retargeting a throw (`play-throw.png`); HUD samples `go`, `shout` and `loot` at `/?scene=hud`; setups
      `takeover-go`, `takeover`, `takeover-held`, `takeover-lapse`, `inspect-guard`.
    - **Deferred:** the van's loot counter and the contract target on it (M3-08); dye packs flagged by intel (M6); the
      negotiator, release and trade UI (M3-07).
    - **Review fixes.** The command and hold previews judge on the preview's picture (`previewPicture`: unknown NPCs
      away, every door the crew can't vouch for shut, decision 44), so the rings, the outcomes and the hold's count never
      tell how such a door stands; a known NPC whose outcome those doors could change (judged with them open too) is
      `unsure` and wears a `?`, counted apart on the chip (a test draws the rings with a doubted door open and shut:
      identical; the property test checks every certain outcome against the truth, and every other known NPC in a ring
      is unsure). A hold does the same: `holdPreview` gives the NPCs it keeps for certain and those a doubted door
      decides (`unsure`, a `?` on the chip), and the lapse row reads "Lapses?" when only those might lapse. Heroes show their chance at any range (decision 82); the pill reads LOUD after the shout (decision
      83); GO's wide row only once a takeover is at hand (decision 84). Ghosts keep the pose they were last drawn in; a
      throw never aims at a hidden tile (`throwTiles`), and while one is previewed only a tap on a floor tile retargets
      it (a tap on someone still selects them). A jammed drill's row is stalled and amber (`urgent` now shows: an amber
      bar and label, sorted with the running clocks), and a Wait or a Go won't start while a drill is jammed. A running
      carrier's countdown stays over a ring's outcome and a hearer's ear (`PlateVM.keep`). The ledger reuses vault.ts's
      `steadyHand`.

### M3: Loud

- [x] **M3-01 Shot geometry.**
  - **Covers:** §11.2–11.7, §14.2 bullets.
  - **Work:** the arc per bullet; rolled points saved in the state; the bullet trace (0.5-tile hitboxes, prone bodies passed over, materials, glass, teller glass, overpenetration); half cover's 90° arc with a rolled 50% block and cover HP; leaning; height; the armour formula. `previewShot` and `resolveShot` use the same trace.
  - **Accept:** a property test that for given rolled points the preview trace equals the outcome trace; the §12.1 expected-hits table checked within tolerance (warning only).
  - **Notes (done):** decisions 85–92.
    - `data/weapons.ts` (§12.1's combat numbers, slugs, armour by crew item and NPC role, cover hit points by prop),
      `geo/angles.ts` (sin, cos and atan2 from + − × ÷ and `sqrt` only: the purity test bans `Math.sin`),
      `geo/shot.ts` (`traceBullet`: one bullet through the `ShotMap` and the `Fabric` of panes, teller glass's hits and
      cover's hit points), `rules/shot.ts` (`Shot`, `shotScene`, `shotArcs`, `traceShot`, `resolveShot`,
      `leanOptions`, armour) and `preview/shot.ts` (`previewShot`: arcs, the fan, bodies with their shields).
    - **State:** `State.shots` (the last 8 attacks with their rolls), `State.cover` (cover's hit points left by
      tile), `CrewState.leaning` / `NpcState.leaning`, and `shattered` / `hits` on edge overrides; the World's tiles
      carry `coverHp`, its rules `guardArmour` (1 from City tier). Save shape hash `b62babf5fce9ada6`.
    - **No command.** `resolveShot(ctx, shot)` is a function for M3-02's attack to call after its own checks (the
      weapon in hand, actions, ammunition, the noise, going loud): it validates the geometry before rolling, rolls on
      'combat', writes what broke, keeps the record, emits `shotFired` and returns the hits; applying damage is
      M3-03's. It rolls, so an engine `preview` of a command that calls it throws `PreviewRollError`: M3-02 previews an
      attack with `previewShot` (geometry, never an outcome, §11.7) and its noise, or stops its reducer at the shot.
    - **Tests:** `tests/sim/shot.test.ts` (every material, cover, height, leaning, the hostage shield, corners,
      resolving), `tests/sim/shot.property.test.ts` (resolve equals `traceShot` for its rolls, and bullet 1 and random
      angles agree with the fan, in a fixture with every material and in a bank of each tier; the §12.1 table against
      the fan's geometry, which it matches in every cell within range).
- [x] **M3-02 Weapons and combat actions.**
  - **Covers:** §6.3, §11.8–11.11, §12.1–12.2.
  - **Work:** attack, the fire selector, reload, swap, scavenge, melee strike, taser, Watch reactions, Suppress, Brace, flip table, fused flashbang and smoke.
  - **Depends on:** M3-01.
  - **Notes (done):** decisions 93–108.
    - `rules/arms.ts` (the drawn weapon, rounds, swap, reload, scavenge, hand a magazine, Brace, the moving penalty,
      NPCs' guns), `rules/actions/attack.ts` (attack with the fire selector and the taser, melee strike, Watch and its
      reactions, Suppress and Suppressed, the knockout windows), `rules/actions/throwables.ts` (fused flashbangs and
      smoke, flipping a table), `rules/damage.ts` (the harm interface M3-03 plugs into), `preview/attack.ts`
      (`attackCone`), `data/weapons.ts` (loads, spares, Watch arcs, Suppress, throwables, flippable props).
    - **Commands:** `attack { crew, at, target?, lean?, turn?, bullets? }`, `strike { crew, npc }`, `watch { crew, at,
      arc, lean? }`, `suppress { crew, at, arc?, lean? }`, `brace`, `swap { crew, to }`, `reload { crew, load? }`,
      `scavenge { crew, npc, take: weapon | ammo }`, `handMag { crew, to }`, `throwGrenade { crew, item, to }`,
      `flipTable { crew, at }`; all in `legalActions` (`COMBAT_COMMANDS`).
    - **Engine:** `Dice.pictured` (a preview stops at rolls it shows as a picture: `PendingOdds.p` null);
      `ActionDef.finish` (an action's rolls after its witnesses and its end in view); the world phase's first step
      `fuses`, before the phase is frozen.
    - **State:** `CrewState.arms` (`drawn`, `guns` by item with `load`/`loaded`/`spare`, `throwables`, `swapped`,
      `moved`, `braced`, `watch`, `aiming`), `NpcState.ammo`, `NpcState.suppressed`, `State.grenades`, `State.smoke`
      (geo/los.ts: smoke tiles block sight), `State.flipped`; the World's `Tile.flipHp`; `Shot.spread`. Save shape hash
      `008c440d6127791e` (with M3-04's fields and the review's `dazed`).
    - **Harm** (`dealHarm`, `registerHarmHandler`): every shot's hits and every strike, one `Harm` per person after the
      volley, emitted as `harmed`; no handler yet: hit points, Hurt, downed and death are M3-03's.
    - **For the UI:** the grid offers Fire/Tase (on the tapped NPC, else the first known one in range), Reload, Swap,
      Take gun / Take mags in stealth after the takeover entries; once loud also Strike, Watch, Suppress, Brace,
      Flashbang, Smoke, Flip table and Hand a magazine after Command and Hold; a tap on another known NPC re-aims a
      previewed attack, wedge or grenade, and on its target again confirms. `window.sim.cone(cmd)` gives `attackCone`
      (the truth, never for the HUD). Aim mode, the loupe, cone arcs and Watch wedges are M3-09's.
    - **Tests:** `tests/sim/combat.test.ts` (every command, the taser's armour, the fire selector, Watch's volley and
      a shouted-down runner, Suppress's wedge, a flashbang's Surprised and smoke's sight); `tests/sim/combat.property.test.ts`
      (random combat play: rollless commands preview to their commit, attacks stop at the bullets with no chance shown
      and are the start of their commit, the recorded rolls replay to the hits, bullet 1 stays in `attackCone`'s fan,
      every grenade lay through a crew phase before going off); `tests/game/actions.test.ts` (the grid).
    - **Review fixes:** Watch shouts runners down only in a Loud bank; a flashbang's Hostile stays knockable through the
      next crew phase (`NpcState.dazed`); half-cover tables can't be flipped; a hidden weapon can't be scavenged before
      a frisk; grenades only once Loud and no safe floor while one lies; the random players keep the stealth-legal
      combat commands; `suppressReact` for M3-05; the taser skips the face down and tied.
    - **Deferred:** what harm does (M3-03); NPCs firing, their Watch and what Suppressed does to them (M3-05, M3-06;
      `watchReact` is the hook for NPCs acting one at a time); police grenades and what they do to the crew (M3-06);
      the ammo bag, the SMG's suppressor and the noisemaker (M4); smoke in stealth (decision 101); stopping a
      shouted-down runner mid-run (decision 100); `watchReact` / `suppressReact` for NPCs acting one at a time (M3-05);
      `movedOrActed` counting an intent action due later in the passive step; the throw preview's noise ring; the grid's
      legality on the truth's line of sight (doubted doors).
- [ ] **M3-03 Wounds, downed and arrested.**
  - **Covers:** §11.12.
  - **Work:** Hurt crew limp, aim worse, bleed and leave blood trails as evidence; bleeding out over 3 phases; revive and medkits; NPC death, crawling and screaming; arrest.
  - **∥** M3-02.
- [x] **M3-04 Heat and the police director.**
  - **Covers:** §13.1–13.4.
  - **Work:** the heat track and its events; levels; arrival and refills; staging points from `GeneratedBank.staging`; perimeter cars and transport vans; the greed scaling; Contain, Negotiate, Assault, Regroup.
  - **∥** M3-01.
  - **Notes (done):** decisions 120–128 (numbered from 120 so as not to clash with M3-02's, which start at 93).
    - `data/police.ts` (§13.2's heat events, §13.3's force by level, seats, greed, §13.4's mode lengths),
      `rules/heat.ts` (`heatOf`, `addHeat`, the per-phase and vault ticks, kills and escapes read off every command,
      `heatAhead`/`phasesUntilHeat` for the forecast, `releaseRelief`/`releaseHeat` for M3-07) and `rules/police.ts`
      (`planWave`, `nextWave`, waves, vehicles, snipers on foot, getting out, the modes, `policeHit` for M3-02 and
      `policeDown` for M3-03/M3-05). Officers block movement (`occupancy`). `World.staging` from `GeneratedBank.staging` (and a fixture option).
    - **State:** `State.response.heat` is now the tick count (was `{ level, tick }`); `State.heat` (owed kills, police
      killed, releases); `State.police` (units, vehicles, mode, levels and refills sent, bags secured). Save shape hash
      `bfa5f33d8bd98f36`.
    - **Session:** the heat strip's view model (`bankView(state, go, world)`) has, from the Alarm on, the level, the
      tick and the next step ("Police at Heat 4: …" during "Police in N", then "Heat 3: SWAT van, main street, east
      end" in N); the ledger's police row names the mode and the next one; the
      recap describes the new events. Drawing the units, vehicles and sirens is M3-09's.
    - **§13.2 departure:** kills after the Alarm cost heat whether or not anyone saw them (decision 121); before it
      only witnessed kills count, landing as one summed lump when the Alarm fires.
    - **Deferred:** police sight (a kill police see, a hostage killed where they see it ending Negotiate) to M3-05;
      Release, Trade, Stall and answering the negotiator to M3-07; ramming, wrecks freeing slots, a van that can't
      leave and the van's hold for greed to M3-08; sniper nests and the helicopter leaving when not needed to M3-05 and
      M3-06; police cars parking to block the crew vehicle and the Heat 5 roadblock to M3-08.
    - **Tests:** `tests/sim/police.test.ts` (the track, every heat event, releases, greed, arrival, the mode cycle,
      the forecast equal to the wave sent before and after the arrival, refills, steps not repeated after a release,
      kills in either phase, the operator's watching kept secret until the Alarm, officers in the way, a generated
      bank of each tier; each command checked against its
      preview).
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
| Key graph (text only) | Structured keys: M2-05 (done) |
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

47. **Command radius (M2-01).** The Threat ×1.5 on the takeover turn rounds down (an LMG 6 → 9, a pistol 3 → 4).
    Threat counts only weapons in hand (`Loadout.items`), not one in the duffel or its case; unarmed is 1. The command
    ring is Euclidean (r² ≤ R²) and needs line of sight from the shouter; the panic and noise ring is the sound flood of
    R + 3 (§8.9), minus the command ring.
48. **Resisters (M2-01).** Enforcers resist (guards, the security chief, couriers); a resister already Commanded complies
    again (its pips refreshed). "2+ crew aiming" counts crew with a weapon in hand within their own command radius and
    line of sight of the NPC, the shouter included. The chances are 0.4 / 0.1, halved by an Intimidating shouter.
49. **Lapses (M2-01).** The pip loss and the lapse roll run as the next crew phase begins, after every other world-phase
    rule (the `crewPhase` step, last): the roll is the world phase's last word, so a preview of the world phase (the
    hatched carriers, `pendingCarriers`) stops cleanly at it (`Dice.odds`, one chance after another, each the share of
    what is left). Cower and hide stay down (no hiding place until M2-02); staying down keeps the NPC Commanded at 0 pips
    and rolls again after the next world phase unless held. Fleeing heads for the nearest way out (a tile anyone's
    schedule leaves the map by; none reachable: it stays down) and starts the escapee carrier as it sets off, the flee
    intent being its telegraph (decision 30's pattern); a runner at the way out leaves a phase after its carrier starts,
    never with it (so the carrier's counters can still reach it), and a runner who gets out stays out. Staff going for
    the alarm are Exposed to whoever commanded them and react by role (the button, the console, telling a guard); the
    manager's special is the phone (§16.2 "phone 40"), a call where she lies. An enforcer always reaches for his weapon:
    the intent is shown for a world phase, then he is Hostile. Commanding a holder counters its carrier.
50. **Hold (M2-01)** is the last action: it spends what is left (at least 1), needs someone Commanded, and keeps the pips
    of every Commanded NPC within the holder's command radius of that turn (×1.5 on the takeover turn: §10.3's Threat
    radius is the one the holder commands with as they hold) and line of sight as the crew phase ends (`holdTargets`,
    judged as the world phase begins, before anyone walks). GO gives a holder no third action.
51. **Surprised (M2-01).** Calm or Curious NPCs when GO is pressed: intent dropped, not re-planned in that crew phase, and
    they stand through its world phase (they still see and hear; what they decide is committed at its end). A surprised
    civilian is Commanded with 1 pip ("for one phase"), so it lapses after the takeover's world phase unless commanded.
52. **GO's masks are witnessed** like Mask up (the illegal act 'maskUp'), and GO itself isn't loud: the first shout is.
    Mask up costs 1 action; "free during GO" is GO masking everyone.

53. **Throwing (M2-04).** "2 tiles" is Euclidean like the command ring (r² ≤ 4: straight two, or one diagonal). The bag
    flies as a hand reaches on each hop (`inReach`: no wall, closed door or glass between, one level), over low
    furniture but not over anything tall, and lands only on a tile one could stand on. A teammate on the landing tile
    with free hands catches it, free and without an action of theirs, and may throw it on with their own (chains);
    with full hands it lands at their feet. A throw is neither noisy nor an illegal act (the bag in the hands is already
    Armed). It never passes a door the crew can't vouch for (decision 44): how such a door stands would decide it.
54. **Hands and pockets (M2-04).** The hands hold one thing: a bag, a crate or a body. Pockets hold 2 Light stacks
    besides, which are never thrown or passed, and put down only once a dye pack ruined them (freeing the pocket). Anything in the hands can be passed to a teammate in reach with
    free hands (1 action), a bag too; passing a body is dragging, seen on both tiles (decision 27).
55. **Taking loot (M2-04)** from where the bank keeps it is the illegal act 'takeLoot'; picking a bag up off the floor
    isn't. Loot worth nothing (the manager's PC, keys, files) isn't loot: M2-05 gives it its use; nor are the deposit
    boxes, opened box by box in M2-05 (§15.3; §15.1's "deposit-box haul" is Heavy). A bag or a crate on the
    floor is an unattended loot bag unless a crew member stands beside it (Chebyshev 1, as M1-07's placed bag).
56. **Dye packs (M2-04).** Inspecting is 1 action on a pocketed stack: it finds the pack and takes it out. Unfound, the
    pack bursts on its carrier's first step onto a tile outside the bank's building (its lot's rooms that aren't
    outdoors), ruining the stack, which stays pocketed. The player isn't told before: previews never show a pack found
    or bursting (`registerPreviewSecret`). So that previews stay honest, the first step that takes cash that may be
    dyed (taken, in a bank with dye packs, not known clean) out of the building is `cashOut`, shown and final whether
    or not a pack bursts; cash that leaves without bursting is known clean from then on, as inspected cash is.
    Inspecting is final too. The burst isn't evidence.
57. **Carry penalties (M2-04).** Heavy is −2 tiles off the Move (in half-steps, after heavy armour's 4 tiles); Very
    heavy halves it rounded down in half-steps (M1's drag), or −1 tile for a Bruiser; bodies are Very heavy too. Only
    a pistol is in hand with a Very heavy carry (not a machine pistol or a taser): it alone counts for Threat and for
    "2+ crew aiming".
58. **Hidden in the state (M2-04).** `LootState.dyePack` is the truth, never read by a view model; a pack flagged by
    intel (a later planning asset) would make it known and then shown.

59. **Zip-ties (M2-03).** A zip-tie needs free hands and a target in reach that is Commanded, Surprised (GO) or out
    cold; "compliant" in §10.6 is read as Commanded (a Twitchy NPC staying down included). One out cold is tied as it
    lies and comes round tied: the knockout's wake no longer applies. Tying clears its command, lapse and intent, so a
    tied NPC never lapses, and its carriers are countered as for anyone tied. The frisk is part of the tie: nothing
    else frisks an NPC.
60. **Keycards (M2-03).** Every staff member and enforcer carries a keycard (the cleaner's opens what his keys did); a
    frisk takes it into the crew member's `keycards`. Until M2-05's key graph says whose card opens which door, any
    taken keycard opens every keycard door (not maglocks, mechanical locks or the vault), as NPCs with keys pass them
    all. An NPC frisked of its card no longer passes keycard doors.
61. **Changing clothes out of sight (M2-03).** §8.14 "must happen out of every NPC's sight": a change is refused while
    an NPC the crew sees now (live, §8.15) would see it where the crew member stands (Core or Peripheral, doors the
    crew can't vouch for taken as shut). It is also the illegal act 'changeClothes' (`!` for whoever does see it): an
    NPC the crew can't see (refusing for one would tell the player who unseen is watching) or a camera. Staff uniforms
    come from staff lockers (`lockers` on Staff floor, the break room's) at any time for now; §16.3's shift change, when
    uniforms are left unattended, is the time to take them, and limiting it to then is deferred (M6, with the
    timeline's events). A stripped guard (`guardStripped`, final) stays the body or tied person it was (major evidence
    until stashed). Changing needs free hands; it replaces any uniform worn.
62. **Guard and courier uniforms in the matrix (M2-03).** The Staff zone reads as Public; in the Secure zone (for Clean
    and Concealed as read) staff give +1, enforcers and cameras nothing. "Any guard within 2 tiles" is any enforcer
    within frisk range (Chebyshev 2) in Core, the security chief at any range in Core; seen through, the crew member
    is Exposed (`!`) in any zone. A holstered pistol (`holsterable`) counts as Clean while the uniform holds; once it
    breaks the profile is computed as without it. The courier's uniform is the guard's ("as guard"). The unknown
    observer's worst case needs nothing new: the enforcer class within frisk range and the chief's role are already in
    it.
63. **Escort (M2-03)** is leading a Commanded or tied hostage by the arm, 1 action: the hostage is in the hands like a
    body (`dragging` with `CrewState.leading`, so `carrying` 'hostage' by rules/hands.ts), and leading it is the
    illegal act 'command' for as long as it lasts (§8.4 "commanding"; dragging's pattern, decision 27). §10.6 "at half
    movement" is all it costs: half of Move and Dash for everyone (no Bruiser's −1 tile, no Very heavy "pistol only",
    the Dash allowed). It is where its escort is; Drop lets go (1 action) and Pass hands it over. A hostage only face
    down can't be stashed. Its command still ticks: a lapse other than staying down shakes it free where the escort
    stands.
64. **Coercion (M2-03).** 1 action, the illegal act 'command': the hostage (Commanded or tied) is next to the crew
    member and in their sight, which lets a teller's drawer be opened across the teller glass; the drawer or console
    must be in the hostage's reach. Drawers stay open to taking as M2-04 made them; coercion reaches one the crew can't.
    A teller (teller, head teller, drive teller) opens their own drawer (`ownDrawer(world, npc, turn)`: the Light loot
    next to the window or desk they work on that turn, the nearest; on a break or at the shift change the window they
    left, before their first the one they are coming to), not yet taken, and the cash is pocketed. A relief teller,
    whose day is breaks and the shift change, works no window and has no drawer ("They don't work a window"); a manager or
    head teller enters their part of the code at a vault console once (`ObjectState.codes`), which M2-05 reads.
65. **Freeing (M2-03).** A free NPC (up, not Hostile) that has noticed the tied one and ends a world phase in its reach
    starts untying it (`untying`, shown for a crew phase); ending the next world phase in reach too frees it, Alerted,
    reporting its assault like a knockout victim who comes round (it doesn't Expose whoever tied it: the overlay's
    world phase would have to foresee it, and a knockout victim doesn't either). Another helper, or a gap, starts over.
66. **Weapons and lapses (M2-03).** §10.5 "reach for weapon (armed NPCs only)": an NPC with a hidden weapon (the
    off-duty cop) always reaches when his command lapses (§16.2), but rolls his archetype's lapse first as any
    customer does and then ignores it, so a preview of the world phase stops at the same roll and tells him from
    nobody (§10.9 "no tells"). An enforcer with his pistol reaches as before; one a frisk disarmed stays down (cowed):
    "go for alarm" is staff only and he has no weapon to reach for. **A deliberate exception to "the preview is the
    outcome":** the lapse odds shown for him are a customer's, and knowingly false, since whatever comes up he reaches.
    Showing his true odds (a certain reach) would be the tell §10.9 forbids; what the player is promised instead is the
    reach's telegraphed phase before he turns Hostile (§10.9, R28). Every other NPC's shown odds are the ones rolled.
67. **Who panics (M2-02).** Only civilians (observer class `civilian`: customers, passers-by, the café and shop people,
    an off-duty cop, a customer hero). Staff and guards hearing the shout are Alerted and act by role (§10.1); the
    staff's panic weights are for their lapses only. A civilian panics on hearing any loud noise (not only the shout)
    or on Exposing a crew member ("seeing violence": §16.2 "when it Exposes a crew member: panics"). One already acting
    on a lapse (running, reaching) or face down doesn't.
68. **When panic reacts (M2-02).** Panicking freezes the NPC at once (no roll, so previews stay exact); its reaction is
    rolled as the next crew phase begins, after the lapses, and carried out in the world phase after that. So an NPC
    panicked in a crew phase stands through that world phase, and one panicked by spread in a world phase picks at its
    end: either way the reaction is shown for a whole crew phase before it is done (§10.8 "carry it out a world phase
    later"). What it picks is a preview secret. This departs from §10.1/§10.8 for panic set off in a crew phase (the
    shout, an exposure during a move): the design would pick it at once and carry it out that turn's world phase; here
    it is picked a world phase later and done a turn later. Why: the pick is a roll. A roll as a world phase begins
    would cut the hatched world-phase preview (`pendingCarriers`) before its carriers start. The alternative is to roll
    at the end of the command: for the shout at the end of its reducer, where the resisters roll (the ring would show
    each pick as a chance), and for an exposure during a move in a command hook ordered last (after the carriers), so
    the move's own preview is whole before it stops at the roll. That keeps the crew phase's preview, but not the
    promise about the world phase after it: the safe floor's and a drawn path's hatched `next`, the evidence warning and
    an action's world-phase carriers (`carrierPreview`, empty for a preview stopped at a roll) all judge the world
    phase that follows the move, and in it the newly panicked would already run, hide or tackle by a roll none of them
    can show. Today they stand frozen, which every one of those previews shows exactly. It would also need the engine
    to accept a stop in a command hook. Panic set off in a world phase (spread, a noise there) follows the design
    exactly, and the frozen phase is itself shown (`panic` intent, the Panicked badge), so the crew can answer it.
69. **Spread (M2-02)** is judged after the walks and the actions at their ends, all at once, from panickers that
    panicked before that world phase: one ring a world phase. "Within 3 tiles" is Euclidean (r² ≤ 9); "who can see
    them" is the receiver's own sight field.
70. **Hiding (M2-02).** The spot is the nearest tile within a run (8 tiles) that no crew member sees (crew sight, all
    round), nobody stands on or heads for; picked when the reaction is rolled. Arriving there unseen it phones (§9.1
    phone carrier, a mobile: a jammer pauses it, no landline); seen, it doesn't and picks again. After calling it cowers.
    "May become a phone carrier" is read as "does, if unseen".
71. **Heroes (M2-02).** A hero resists commands as a guard does (§10.4 table). Its reaction: tackle a crew member in
    reach (the first by id), else flee (its cower weight goes to flight; hide and its other weights stay). The tackle
    happens only if that crew member is still in reach in the world phase: they lose one action of the next crew phase
    (after GO's extra one, if any). Then it picks again.
72. **The off-duty cop when he panics (M2-02)** is decision 66's lapse: he rolls his archetype's panic odds as any
    customer does (a preview stops at the same roll) and reaches whatever came up, at the crew member who frightened
    him or the nearest. His weapon never shows: no plate, the same ring outcome (`panics`), no preview of it.
73. **Blocking the route (M2-02).** An escapee is countered while the crew, standing where they stand, cut its runner
    off from the way out it runs for (from every tile within one of it; people other than the crew don't block). As it
    would set off again, a runner with another way out still open runs for the nearest one, with a fresh carrier at
    max(2, ⌈that way ÷ 8⌉), the flight its telegraph; with none left it gives up and cowers. If the crew steps aside
    first, the next flight starts a fresh carrier at its full countdown. An escapee's count is always of the way the
    runner has left past the crew as they stand (to the nearest tile it leaves from: its way out or one next to it), at
    a run a world phase: when the crew standing in the way makes that way longer than the count still covers (it must
    be off the map by the world phase whose tick would raise the Alarm), the carrier is countered just the same ('route
    longer') and the runner, setting off again, starts a fresh one at the longer way's count. The tile it leaves from is
    the nearest within one of the way out that it can end its walk on (nobody stands there or is headed there,
    `leavingTile`): the flight walks there and the count is of the way there. Only the crew earn these counters: a run
    held up just as much with the crew out of the way (a crowd standing on and around its way out) is paused ('way out
    crowded'), not countered, and ticks again once the runner can make it (cleanup review); people the crew put on the
    floor there count as the crew's block, and a crew block on the way there counters it whatever crowd waits beyond. So an escapee never raises
    the Alarm with its runner inside (an invariant of the preview property test and the carrier fuzz). A passer-by's way out is the nearest tile anyone leaves the map by (§16.4's "nearest plot edge"). The
    phone call's "find them" (§9.1) is listed with its counters: finding a hider is what lets the crew command or knock
    it out.
74. **The crew's tackle (M2-02)** works only on a runner (an NPC fleeing), in reach, 1 action, not while dragging a
    body. It is the illegal act 'attack', seen on both tiles, makes no noise, and leaves the runner Commanded by the
    tackler with 2 pips, which counters its escapee (the source check).
75. **Cards and keys (M2-05).** A door the key graph names opens to the cards of the people who hold its social key
    (the CCTV room's: the operator, the guards, the chief, the manager; the counting room's: the head teller, the
    manager and the guards, whose master cards their closing sweep needs; both of the mantrap's doors: the operator);
    any other keycard or maglock door to any staff or enforcer card (decision 60). A card taken in a frisk stands for
    its holder's keys: it opens mechanical locks too. No card opens the vault. NPCs follow the same rule with their own
    card (`npcCanPass(world, …)`), except that the mantrap's operator buzzes staff through (its social key), which a
    taken card doesn't get; none walks through a shut vault door, locked or not. Picking a mechanical lock (lockpick
    set) or hacking a card reader (hacking kit) is 2 actions of work kept on the door (Steady Hands 1), each the illegal
    act 'lockpick' or 'hack' and a quiet noise of 1; it leaves the door unlocked, and like any door it latches again
    when it swings shut. The mantrap's readers (its technical key: "loop the mantrap camera, then the reader") wait
    until every live camera in the mantrap is looped.
76. **The vault code (M2-05)** is entered at the console part by part (`ObjectState.codes`): one whole code, or under
    dual control the manager's half and the head teller's (split only among people the bank has; a fixture without a
    key graph is dual control). The manager knows the whole code or his half, the head teller hers. The manager's PC
    (hacking kit, 2 actions of work, Steady Hands 1, the illegal act 'hack') gives the crew the manager's part
    (`State.codesKnown`) and tells the time-lock window; the crew enters what it knows at the console (1 action, not an
    illegal act: the Secure zone already makes them trespassers). The last part unlocks the vault door (closed, to be
    walked through). §15.2's bribed or inside staff member and the sticky note are M5-02's and M6's.
77. **The time lock (M2-05; reviewed).** Its window is the timeline's (the armoured car's, else the scheduled one),
    from its turn for its duration. It blocks codes, and Three Keys' card, outside the window (§15.2); in it they are
    what opens the vault. The window doesn't open the vault by itself: §15.2's "opens itself during its scheduled window
    (usually the armoured-car delivery)" is read as the couriers' delivery, when staff open it, which comes with the
    couriers (M6); the generator's own line is "the vault's time lock lets it be unlocked". So the PC's code (every small branch, always
    time-locked) and dual control (every HQ) are live keys, used in the window. As each crew phase begins outside the
    window, a shut vault door that isn't locked locks again, whatever unlocked it, and the code entered at the console
    is cleared; an open one stays open until shut.
78. **Deposit boxes (M2-05).** The generator's deposit loot ($30k) becomes the wall's haul (Heavy, the whole value,
    where the generator put it, keeping its id) and one box per $5k (Light, "jewels from deposit boxes"). Picking a box
    (lockpick set, 2 actions of work on that wall of boxes, Steady Hands 1, the illegal act 'lockpick') opens the next
    box in the room, whose jewels then lie there to take (1 action, pocketed). Drilling the wall (4 phases) gives the
    haul instead. The two exclude each other: once a box is open the wall isn't drilled, and a drilled wall has no boxes
    left. The intel box (§15.3) is M6's.
79. **Three Keys (M2-05).** "The manager's keycard, the CCTV room disabled, and the time-lock window": a crew member
    holding the manager's card uses the console (1 action) in the window while the crew holds the CCTV room
    (`cctvControlled`: no operator left watching and one of the crew at the desk, §8.15). A bank without a CCTV desk
    has nothing to disable. The window alone doesn't open a Three Keys vault.
80. **The drill and thermite (M2-05; reviewed).** Setting either up is 1 action from beside the vault door (the drill
    also at a wall of deposit boxes in reach): the drill is the illegal act 'drill', the charge 'plantCharge' (Sapper's
    1 action less is already the minimum). The charge is used up; the drill is a kit (§7.2): it stays where it worked,
    finished or not, until `takeDrill` (1 action in reach) puts it back in a kit, which stops it with its work lost.
    Each works a phase every world phase it runs in, a loud noise where it stands (6; Three Keys' 9, and half as long
    again: §17.2 "slower and louder", in the key graph), so a drill set in a crew phase is a third through a Class M
    door after that turn's world phase. A drill jams on 15% as each crew phase begins (§15.3 "announced at the start of
    the crew phase"), rolled with its odds shown, the last roll of that step (after the lapses and the panic reactions,
    so a world phase's preview stops only at its very end); fixing it is 1 action in reach, the illegal act 'drill'.
    Steady Hands in reach of a drill as the crew phase begins fixes a jam for free and keeps it from jamming then: the
    roll isn't made, as its outcome couldn't matter. Thermite can't be stopped and never jams. Starting either on a
    Class II+ vault starts the seismic carrier (countdown 4), shown in the action's preview; on Class III a crew member
    stepping into the vault outside the time-lock window starts the motion carrier (2) at the sensor. A drill or charge
    left at a door is major evidence ('drill').
81. **The vault sensors' counters (M2-05 review).** §9.1 gives the seismic sensor "disable the sensor at the vault
    wiring box with a hacking kit (also during the countdown)" and the alarm panel, and the motion sensor the wiring box
    and the time-lock window. The wiring box has no prop yet (M5-04), so until then the sensors' wiring is reached at the
    vault console, in the same antechamber (§17.4 puts the console and the wiring box there): `interact … sensors`,
    hacking kit, 4 actions of work (§7.2 "disable … a vault sensor (4 actions)"; Steady Hands 2), the illegal act 'hack'.
    Cut, they start nothing and every running sensor carrier stops (`registerCarrierCheck('vaultSensors')`); the motion
    carrier also stops once the time-lock window opens. Each sensor carrier so has at least two counters that work in
    its countdown (the seismic's 4 world phases leave two crew phases; the motion's 2 leave one, so two crew members, or
    Steady Hands, cut it in time).
82. **A hero in the command ring (M2-06).** §10.4 says a resister's chance is shown, and a hero is a resister: a hero in
    a previewed command's ring shows its resist chance at any range, as a guard does. §16.2's "Bold within 3 tiles" is
    Inspect's tag only, for a hero outside a ring.
83. **The pill on the takeover turn (M2-06).** The pill names the bank's state (UI.md "Top strip": QUIET, GO, LOUD): GO
    while GO is previewed and through the takeover turn until the shout makes the bank Loud, then LOUD; the gold rail
    and the third gold pip go on saying GO for the rest of the turn.
84. **Where GO sits in the grid (M2-06).** The stealth boards show no GO: it is a takeover's button. Once a takeover is
    at hand (a crew member with a weapon in hand would have someone the crew knows of in their command ring for certain
    on the takeover turn, GO's ×1.5 radius in their line of sight, who isn't down yet: not face down, tied, out cold or
    Hostile; `commandPreview`'s reading) GO heads the grid, a gold row two places wide (UI.md "GO is wider, with a gold border"); until
    then it keeps its place after the stealth entries, gold but one place wide, and a full grid drops it first.
85. **The bullet's path and range (M3-01, §11.2, §11.3).** A bullet flies from the middle of the origin tile along the
    aim line (the middle of the aimed-at tile, turned by the fine aim's whole degrees) turned by its offset,
    (u − 0.5) × its arc for a uniform roll u: uniform in angle, as §12.1's table assumes. A standing body is a disc a
    quarter tile in radius in the middle of its tile (§11.3's 14° at 2 tiles). Range is a tile test like vision's
    (decision 3): the bullet stops as it enters the first tile whose middle is further than Range from the origin's,
    or leaves the map. Turning uses `geo/angles.ts`, sin and cos by series and atan by halving, never `Math.sin` (§2.3).
86. **What stops a bullet (M3-01, §11.3, §11.6, §14.2).** Full-height objects stop every bullet (they have no material
    to pierce); middle-height ones (vehicles) stop it unless the origin or the aimed-at tile is raised, as sight's
    rule. A Soft wall costs Pierce ≥ 1 one damage, and a bullet left with none stops in it. A taser's dart stops at
    any wall or pane and breaks nothing. A ray exactly through a grid corner (decision 6) passes only when all four
    edges there and both tiles beside it would let it by untouched (no wall, an open door, a fence, a railing, a
    shattered pane); anything else stops it at the corner, with no effect on the walls. A bullet that misses keeps
    flying to range.
87. **Half cover (M3-01, §11.4, §14.7).** Judged per target from the attack, not per bullet: the origin tile against the
    target's tile, in integers, so the preview's shield is the rule. A half-cover tile beside the target (orthogonal,
    with no wall between), a railing on one of its edges, or the corner a leaner leans past covers it when the origin
    lies in the 90° arc facing it, its 45° edges included; several: the most squarely facing, a tile before a railing
    before a lean, north first. A covered hit is blocked on a roll below 0.5 (rolled only then); a blocked bullet stops
    and takes its damage (with the shotgun's close bonus, before armour) off the cover's hit points: desk 6, planter 4,
    counter 10 and the rest in `COVER_HP` (default 6); railings, corners, hydrants and bollards can't be destroyed. A
    destroyed piece gives no cover but still stands in the way of walking. A shooter on raised floor ignores the half
    cover of a target on the ground (no shield shown at all).
88. **Who stands in the line of fire (M3-01, §11.3, §10.7).** Everyone on the map but the shooter: lying people (face
    down, tied, out, dead, a dragged body) are passed over unless aimed at; a stashed body isn't there; cowering and
    hiding civilians stand. A hostage led by the arm stands on its escort's tile and is met before the escort from
    every side (§10.7 "a real shield"); anyone on the origin tile is fired past.
89. **One attack is one volley (M3-01, §11.5, §11.6).** The bullets fly in order, and what they break changes the next
    (a pane shattered, teller glass's hits, a desk broken), but nobody falls mid-attack: everyone hit stays standing
    until the attack is over. Damage per hit is §11.5's formula with the shotgun's +1 added to Damage when the target's
    tile is within 3 tiles of the origin (Euclidean between middles); the DMR's ×1.5 applies to what is dealt, rounded
    down; Pierce 3 passes the first body with 3 less when it has more than 3 left, and stops at the second. The preview
    shows breakage too (§11.7, nobody is hit by surprise): each fan segment also gives the path with everything the
    attack could break broken (`brokenFabric`: panes, teller glass whose 4th hit is in reach, cover the bullets could
    wear through), and a body reached only so is `ifBroken`. A cracked shield (`mayBreak`) is claimed only when the
    bullets whose arcs reach any body it covers, each blocked once with the most damage it meets one of them with, would
    destroy it (cover is worn per piece, whoever stands behind it).
90. **Leaning (M3-01, §11.4).** A person can lean out to an orthogonal neighbour they could step to (no wall between,
    no furniture, nobody standing there) where their own tile's side toward one perpendicular way is full cover (a wall
    that blocks sight, a full-height object beyond, the map's edge) and the neighbour's same side is open. Leaning,
    their hitbox is on the lean tile, with half cover over the quadrant toward the corner. It ends as their side's next
    phase begins (the crew's crew phase, NPCs' world phase) or when they move. The step to the lean tile follows the
    movement rules (`stepCost`: no raised edge without stairs). What the crew is offered (`crewLeanOptions`, and a lean
    in `crewShotPreview`) counts only what it knows: a hidden tile is neither full cover nor open and is never leaned
    to, so an offered lean is one the truth allows (doors as pictured aside).
91. **Shot-out glass (M3-01, §11.4, §11.6).** A shattered pane (glass on its first hit, teller glass at its 4th) lets
    bullets and sound through freely (`blocksSound` false) and still stops people: getting through is a glass cutter's
    or a charge's job. Teller glass counts every bullet that reaches it, a Pierce 3 one that passes included; the 4th is
    still stopped below Pierce 3 and shatters the pane.
92. **Armour and the shot API (M3-01, §12.3).** An NPC's armour is by role: guards and couriers `rules.guardArmour`
    (0, 1 from City tier), the security chief 1, police and SWAT as §12.3 when M3-04 brings their roles; everyone
    else 0. A crew member wears the best worn armour piece. `previewShot` is omniscient, like an engine preview
    (bodies behind walls, cover's hit points, refusals naming unknown targets); the player is shown `crewShotPreview`,
    the same on the crew's picture (only NPCs it sees or predicts, a hostage it leads, doors as last seen) and on the
    map as the crew knows it (`ShotView`): the fan, its `broken` paths and the shields stop ('unknown') where a bullet
    would enter a tile neither on the blueprint nor ever seen (nor its corner's side tiles); a hidden aimed-at tile
    says nothing of its height; panes, teller glass's hits and cover's wear show as they are only where the crew sees them this turn; elsewhere
    a pane or destructible cover is drawn as built but counted as possibly broken already (`doubtOf`, in the `broken`
    paths), so a body beyond a pane shot out earlier shows as `ifBroken`, never hidden, and a shield on such cover shows as
    `mayBeGone` (no hit points, `mayBreak` always), and nothing tells how it
    really stands (the crew keeps no record of panes it saw broken, so seen-broken counts as "may be broken" too);
    hidden tiles give no cover. Two banks that differ only inside a room the crew has never seen
    preview alike. M3-09 draws from that. `resolveShot` is not a command (M3-02's
    attack calls it) and applies no damage (M3-03).

93. **The drawn weapon (M3-02, §6.3, §11.11).** A crew member fires one weapon, `Arms.drawn`: at the start the primary
    carried unpacked, else the first sidearm, else none (unarmed). Threat still comes from every weapon in hand (§10.1,
    decision 47); with a Very heavy carry only a pistol fires, as only a pistol threatens. Swap draws any other weapon
    carried unpacked: free once a turn (§6.3), 1 action for any further swap that turn.
94. **Rounds (M3-02, §11.11, §12.1).** Each weapon carried has its magazine and 3 spare magazines; the taser's 3
    cartridges are all it has. An attack takes its bullets from the magazine; the fire selector fires 1 up to the
    weapon's Bullets and no more than is loaded (unasked: as many of both). Reload is 1 action, a spare magazine in, the
    rounds left in the old one lost; the pump shotgun is reloaded with shells or slugs (`load`), both from the same
    spares, and fires the table's row of what it holds. Hand a magazine: 1 action, a spare of the drawn weapon to a
    teammate in reach who carries the same weapon.
95. **Scavenging (M3-02, §11.11).** An armed NPC (guards, couriers, the off-duty cop) carries a pistol, a full
    magazine and 2 spares (`NpcState.ammo`; police guns come with M3-04). Someone down (out cold, dead or tied) in reach
    can be searched, 1 action, the illegal act 'pickPocket': take the weapon with what is left in its magazine (not one
    of a kind the crew member already carries: take the magazines instead), or the spare magazines for a weapon of the
    same kind they carry. A frisk takes the weapon, not the magazines on the belt. A hidden weapon (an off-duty cop's)
    isn't the crew's to see: searching such a body is refused with the very reason an unarmed one gives, and the gun is
    found only by a frisk (zip-tie, `hiddenWeaponFound`), after which its magazines can be taken.
96. **Harm (M3-02, §11.5, §11.12).** Every attack's damage goes through `dealHarm`: one `Harm` per person (hits,
    damage after armour, lethal) after the volley (decision 89), emitted as `harmed`, then passed to each registered
    handler. M3-02 registers none: M3-03 adds hit points, Hurt, downed and death there. The taser and flashbangs aren't
    harm (§11.12 non-lethal): they knock out or surprise.
97. **An attack and its preview (M3-02, §11.7, §6.2, §13.6).** In order: the checks (the shot's own geometry
    included, before any roll), the actions (1, the LMG 2), the rounds, the lean, the facing, the noise at the
    weapon's radius (a loud one makes the bank Loud), the witnesses of the illegal act 'attack' and the end of the action
    in view; then the bullets (`ActionDef.finish`), set up in `Arms.aiming` and rolled after `Dice.pictured`. A preview
    stops there with no chance shown (`p` null): it shows the noise, the witnesses, the cost and, through `attackCone`,
    the cone drawn on the state it stopped at (Suppress's civilians already down), never a hit, a damage or a number
    (§11.7). What NPCs then do is the world phase's and isn't previewed in a firefight (§13.6); an end of the turn's
    preview stops at the first volley as at any roll. The moving penalty applies when the crew member moved this
    turn (`Arms.moved`, any command that changed their tile) and isn't braced.
98. **The taser (M3-02, §11.10).** A dart is the taser's shot (Aim 2, range 4, one bullet, stopped by any wall or pane):
    whoever it hits that is up is knocked out as by hand (out cold for 4 world phases, Hostile or reaching for a weapon
    too), unless their armour is 2 or more; a dart in someone face down or tied does nothing (it would untie them); a dart in a crew member does nothing until M3-03. A quiet noise of 2: it
    doesn't make the bank Loud.
99. **Watch (M3-02, §11.8).** All remaining actions (at least 1); the wedge is whole degrees up to the weapon's widest,
    aimed at a tile, from where they stand or a lean tile. It holds through the world phase after it and ends as the
    next crew phase begins. After the passive walks and draws, the first Hostile NPC in resolution order that moved
    (walked part of its committed path) or acted (carried out an intent action, or turned Hostile: drew) with its tile
    in the wedge (within half the arc of its middle line, within range, in line of sight) draws one volley: half the
    weapon's Bullets rounded up, no more than loaded, Aim ×1.5 (×1 at 15° or narrower); the Watch then ends. NPCs that
    act one at a time (M3-05) call `watchReact` as they act. A volley that would be refused (someone on the lean tile)
    isn't fired. Watch is allowed in stealth: only a Hostile draws a volley, and one is there only once the bank is loud.
100. **Shouted down (M3-02, §11.8).** An NPC running for it (its committed intent's action `flee`) whose walked tiles
    passed through a Watch wedge within the holder's Threat radius (Euclidean from the holder) is Commanded for free
    (`commandPips`) where its run ended, and nobody fires; only once the bank is Loud, when the shout costs nothing
    the guns haven't (in a quiet bank it would be a silent, free command that counters an escapee). Stopping it on the
    first tile in the wedge would mean re-resolving every walk; deferred.
101. **Grenades (M3-02, §11.10, §12.2).** Flashbangs and smoke are combat tools: thrown only once the bank is Loud,
    since a grenade lying through a crew phase changes the world phase after it (a Surprised NPC stands still, smoke
    hides, the bang is heard) outside what the safe floor judges (§8.8); while one lies the scene draws no safe floor
    (modelling `fuses` in the floor and `assessWorldPhase` is deferred, with stealth smoke). 1 action, hands free, up to 6 tiles (Euclidean) to a tile the thrower sees that isn't
    full height; the illegal act 'attack'. It lands at once (`State.grenades`, `grenadeLanded`) and goes off in the
    world phase's first step, `fuses`, before the phase is frozen: a crew grenade goes off before any NPC acts, and a
    police one (M3-06) lies through a crew phase. What it reaches is decided as it goes off: the tiles within 2
    (Euclidean) that the landing tile sees.
102. **Flipping a table (M3-02, §11.4).** Flippable props are tables and light desks (`FLIPPABLE`: café, coffee and
    dining tables, desks, writing desks; `Tile.flipHp` on the tiles they stand in the way on). Flipping is 1 action,
    hands free, in reach, once per tile, and not on a tile that is half cover already (a desk, a dining table: flipped,
    its cover would only narrow to one side): the tile becomes half cover with the prop's hit points (a wooden table 6),
    so a coffee table, too low for cover standing, becomes cover. Its arc faces away from the flipper:
    it covers only a target on the side it was flipped from (`State.flipped[].side`, the shot map's `coverSide`; north
    or south when the flipper stands so, diagonals included, else east or west), against shots within the 90° arc beyond
    it (decision 87). A quiet noise of 4 on the tile; while the bank is quiet and no alarm is up, every NPC that sees the
    flipper (its cone, `seesOn`) gains +2 suspicion of them.
103. **Flashbang (M3-02, §11.10, §12.2).** Everyone up in reach (not face down, tied, out cold or away) is Surprised for
    the world phase it goes off in: their intent dropped before the phase is frozen, so they lose it; civilians are also
    Commanded by the thrower. They stay **dazed** through the crew phase after (`NpcState.dazed`, cleared as the next
    world phase starts): a Hostile one can be knocked out then, the crew's chance (Surprised itself ends with the
    world phase, before the crew could act on it). A loud noise of 14; the bank goes Loud. The crew
    aren't affected by their own (police flashbangs on the crew are M3-06's).
104. **Smoke (M3-02, §12.2).** Its tiles block sight as a full-height object does (`State.smoke` in the sight map)
    for 3 world phases: the one it goes off in and the two after, clearing as the third ends. Someone inside is seen
    only from a tile whose line meets no other smoke tile. Bullets fly through it. A quiet noise of 4.
105. **Suppress (M3-02, §11.9).** The LMG, 2 actions, a wedge of whole degrees up to 60°; it fires every round it has
    up to its Bullets, each bullet's whole arc doubled (`Shot.spread`). Who is in the wedge is decided before the roll:
    Hostile NPCs there are Suppressed until the next intents are committed (`NpcState.suppressed`: their own Aim ×1.5
    and no Watch, M3-05/M3-06); civilians there are Commanded (2 pips). A Suppressed NPC that walks off the tile where
    it was suppressed, having had half cover there against the suppressor, draws the suppressor's free 1-bullet shot,
    once. Surprised and Suppressed open the knockout window on a Hostile (§11.10).
    The passive step asks this of every NPC, but Suppressed NPCs are Hostile and so never walk with the passive group:
    the shot waits for M3-05, whose one-at-a-time NPCs call `suppressReact` as each moves (as `watchReact` for Watch).
106. **Melee strike (M3-02, §11.11).** 1 action, hands free, on anyone in reach who isn't dead or away, fighting or
    face down; 3 damage by §11.5's formula with Pierce 0 (armour counts), lethal; a quiet noise of 2; the illegal act
    'attack' seen on both tiles. Never rolled.
107. **Brace (M3-02, §6.3).** The DMR or LMG drawn; their last action, spending what is left (at least 1), as Hold.
    Braced until they move: no moving penalty, the LMG's braced recoil (decision 85's `shotArcs`).
108. **Combat in the random players (M3-02, §2.2).** The stealth property tests' random players (preview, perception,
    the carrier fuzz) leave out only `PICTURED_COMMANDS`: attacks (the taser's too) and Suppress, whose previews stop at
    the bullets, and grenades (decision 101). Swap, reload, Brace, Watch, strike, scavenge, handing a magazine and
    flipping a table play there, offered on about one pick in seven so the stealth commands keep their share (the long
    quiet games leave out the strike as they leave out the knockout). The combat property test plays all of them, in
    fixtures that are mostly loud.
120. **One heat number (M3-04, §13.1).** `State.response.heat` counts ticks since the Alarm (0 is Heat 1, tick 0);
    `heatOf` reads the level, the tick within it and the refills past Heat 5 (each 5 ticks past 20). Heat never falls
    below 0. The +1 per world phase starts in the phase after the one that raised the Alarm, as "Police in N" does.
121. **Kills and witnesses (M3-04, §13.2).** Kills are read off the state after every command (an NPC dead now that
    wasn't), so any later rule that kills counts without calling in. A civilian or a hostage (Commanded, tied, or
    running in a command's flee lapse) is +5 and a guard or staff member +1. Before the Alarm a kill counts only if
    witnessed (§13.2): an attentive operator sees it on a live feed, or any NPC present and looking sees it (a
    bystander: the design's "a civilian who reaches the police", taken as anyone who saw and will be asked, guards and
    staff too, without following them off the map). Whether anyone saw is hidden from the crew, so these are owed with
    no event and land as one summed lump (`heatChanged` 'witnessedKills', no victim) in the world phase that raises
    the Alarm, the first moment the design shows heat: only the total is revealed, not which kills were seen. After
    the Alarm every kill counts at once, seen or not, a guard's or staff member's as witnessed. **This departs from
    §13.2 on purpose**, which charges only witnessed guard and staff kills: the police are on their way and listening
    (the radio, the dispatcher), and a +1 that depended on who looked would tell the crew what it can't know. Police sight is M3-05's. A drill or charge working on a vault door with a seismic sensor is +1 per world
    phase.
122. **Police are not NPCs (M3-04).** They are `State.police.units` (a kind, the vehicle they ride in, then a tile), so
    no stealth rule (sight, suspicion, the knowledge picture) meets them before M3-05 gives them rules of their own.
123. **Waves (M3-04, §13.1, §13.3).** A wave is what is missing from a level's strength: the first arrival the force of
    the level reached when "Police in N" runs out, then each level reached, then each refill past Heat 5. A level
    reached in the crew phase sends its wave in the next world phase. Steps only go up: a level (or a refill past Heat
    5) reached again after a release brings nothing, so a release never brings a refill sooner. Units already there
    stay however far heat falls.
124. **Greed (M3-04, §13.3).** A bag secured is a Heavy or Very heavy loot item that has been out of the building
    (carried or on the ground) and isn't ruined; once out it stays secured (`State.police.secured`, kept after every
    command), so stepping back inside doesn't shrink the next wave. The van's hold is M3-08's. Each kind's count is scaled and rounded half up;
    the negotiator isn't scaled.
125. **Vehicles (M3-04, §13.4).** Patrol officers ride 2 to a perimeter car while a staging point has one of its 2 car
    slots free (the point with the most free slots, ties in the generator's order). SWAT vans carry whole teams: a
    shield and three, then the heavy pair and two, then any SWAT left, 4 a van; police vans the negotiator and patrol
    officers without a car. Snipers walk in on foot in pairs (§13.4). Each van or pair goes to the point with the
    fewest cars (counting the wave's own arrivals). Vans on the street don't count: they drive off before the next
    wave, so the forecast holds. Units get out on the nearest free tile reachable from the vehicle (or the staging
    point) without passing a closed door; with none, they wait aboard (a van waits with them), so no two people share a
    tile. Officers out on scene block everyone's movement. The helicopter hovers over the middle of the map from Heat 4.
126. **The modes' cycle (M3-04, §13.4).** Contain (3) starts in the world phase the first units get out. Contain leads
    to Negotiate only with the negotiator out on scene (Heat 2+), else to Assault; after a Regroup it is Contain (1)
    and then Assault, and Negotiate follows a Regroup only with hostages held and the negotiator there. A mode counts
    down once per world phase from the one after it began (as a carrier does) and its length is fixed when it begins.
    A police officer hit during Negotiate (`policeHit`, which a kill includes) starts an Assault at once.
127. **The forecast (M3-04, §13.1 "Heat 3 in 2 turns: SWAT van, rear lot").** `nextWave` is `planWave` for the next
    step on the state as it is: during "Police in N", the first arrival's force at the level the track will have
    reached then; after it, the next level not yet sent (or the next refill). "In N" counts what is known to come
    (`heatAhead`: +1 a phase, and +1 a phase while a drill or charge on a Class II+ vault still has work). It assumes
    the drill keeps running: a jam (rolled as each crew phase begins) isn't foreseen, and once it happens the forecast
    is worked out again from the jammed drill, as after a kill or a release, and the strip shows that at once. The heat strip names the first vehicle that isn't the helicopter and how many
    more come.
128. **Hard promises (M3-04, §13.6).** Nothing in the director rolls or decides what the player can't see coming:
    arrivals show a phase ahead (the siren marker), mode changes are announced with their length, and breaches (which
    M3-05 announces a phase ahead) and police movement and targets are left to the units as they act.

### Critical files for implementation

- /home/user/BankHeist/src/gen/model.ts
- /home/user/BankHeist/src/gen/generate.ts
- /home/user/BankHeist/src/gen/nav.ts
- /home/user/BankHeist/src/gen/population.ts
- /home/user/BankHeist/src/scenes/BankScene.ts
