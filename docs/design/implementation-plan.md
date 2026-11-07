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
      unattended loot bag, a drill); lights out (M4-03, decision 245). Noticed only in the world phase (decision 26)
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
      (M3–M4; a barricaded door stops a runner since M4-02).
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
    - **Deferred:** the vault wiring box as a prop (done in M5-04, decision 366); a
      power cut darkening the console (done in M4-03, decision 244); thermite's fire and scorched loot (M4); heat
      ticks while drilling (M3); the
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
      combat commands; `suppressReact` for M3-05; the taser skips the face down and tied; the grid offers combat
      commands only as `legalActions` gives them with the doubted doors shut (decision 44), so no Fire or throw tells
      how such a door stands (a two-worlds test in `tests/game/actions.test.ts`).
    - **Deferred:** what harm does (M3-03); NPCs firing, their Watch and what Suppressed does to them (M3-05, M3-06;
      `watchReact` is the hook for NPCs acting one at a time); police grenades and what they do to the crew (M3-06);
      the ammo bag, the SMG's suppressor and the noisemaker (M4; done in M4-06); smoke in stealth (decision 101); stopping a
      shouted-down runner mid-run (decision 100); `watchReact` / `suppressReact` for NPCs acting one at a time (M3-05).
    - **Later fixes:** `movedOrActed` counts only what has happened by the passive step's reactions (a walk, a draw),
      not an intent's action still to come; the throw preview shows the noise each grenade makes as it goes off
      (`NoisePreview.fuse`: its ring as the sound carries now, no ears, since who hears it is decided in the world
      phase); `Tile.flipHp` only on tiles that aren't half cover already.
- [x] **M3-03 Wounds, downed and arrested.** (partial: see Deferred)
  - **Covers:** §11.12.
  - **Work:** Hurt crew limp, aim worse, bleed and leave blood trails as evidence; bleeding out over 3 phases; revive and medkits; NPC death, crawling and screaming; arrest.
  - **∥** M3-02.
  - **Notes (done):** decisions 140–148.
    - `rules/wounds.ts` (the harm handler `wounds`: hit points, Hurt, downed, bleeding, bleeding out, NPC death and
      screams, `arrestCrew`, the `revive` and `medkit` actions), `rules/woundsState.ts` (`npcMaxHp`, `isWounded`, apart
      so the NPCs' behaviour can read them), `data/weapons.ts` (`NPC_HP` by role, §12.3).
    - **Commands:** `revive { crew, ally }`, `medkit { crew, ally }` (both in `legalActions`). Every action, Move and
      Dash first ask `actorRefusal` (core/state.ts, `registerActorCheck`): the downed and the dead can't act.
    - **NPCs:** the goal `crawl` (npc/behaviour.ts) and the pace `crawl` (npc/walk.ts, `rules.npcCrawlTiles` 1, a
      diagonal tile allowed); `wayOut` moved from rules/command.ts to npc/walk.ts (re-exported) so the intents can
      read it without a cycle.
    - **State:** `CrewState.wounds` (`hp`, `bandaged`, `bleed`, `downed`, `dead`, `medkits`), `NpcState.hp`,
      `State.custody` (the arrested). Save shape hash `1e6d9d27dadd6f11`.
    - **Session:** the crew rail and the recap show HP (`hp` in the view models, the HUD's existing bar); the grid
      offers Revive (a downed teammate in reach) and Medkit (the tapped teammate, else the most hurt in reach, oneself
      included) before Wait; the recap describes the new events.
    - **Deferred:** carrying a downed crew member (Very Heavy carry), surrendering under "Hands up!" (§16.2), and police
      walking to the downed and following fresh blood trails (M3-05, which also gives police units hit points and calls
      `policeDown` when one dies); a crawler leaving the map at its way out and the escapee carrier that would start
      (M3-05); trading back the arrested (M3-07) and jailing them at the end (§19.6, M5); what a downed crew member
      still sees, threatens or carries (loot stays carried); blood sprays and pools drawn (M3-09).
    - **Tests:** `tests/sim/wounds.test.ts` (hit points by role, Hurt's blood, limp and aim, Cool Head, bleeding and
      bandaging, downed and bleeding out, revive and medkits with Medic, arrest, an NPC killed and heat owed, a wounded
      NPC's scream and crawl; revive and medkit preview to their commit).
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
- [x] **M3-05 Police and guard routine AI.** (partial: see Deferred)
  - **Covers:** §13.5, §13.6 patrol routine, §10.10.
  - **Work:** what police know (last known positions, reports); the never-fire-through-a-standing-non-crew-body rule; freeing hostages; arrests; announced breach markers.
  - **Depends on:** M3-01, M3-04.
  - **Accept:** a property test that police never fire a shot whose preview hits a standing non-crew body; every breach is announced a phase ahead.
  - **Notes (done):** decisions 150–161.
    - `rules/routine.ts` fills the engine's `npcs.combat` step: Hostile NPCs, then officers, act one at a time by
      §13.6's simple routine (fall back Hurt; move to a clean shot at the nearest crew member in sight and fire; else in
      Assault advance on the nearest known downed crew member, then the nearest known position), what the police know,
      `cleanShot`, freeing hostages, breaches, and the `police` harm handler. `data/police.ts`: `OFFICER_STATS` (§12.3 hit
      points, armour and gun by kind), `ROUTINE_KINDS`, `COMBAT_SIGHT`, `BREACH_FROM`; `rules.officerMoveTiles` (4).
    - Officers are bodies (`rules/shot.ts`: shooters, targets, leaners); the crew's Watch, Suppress and their reaction
      shots (`watchReact`, `suppressReact`, now live) treat them as foes, as Hostile NPCs; `attack` offers them
      (`officersInRange`). Officers pass nobody standing (`occupancy`). A freed hostage is a `released` lapse with
      `freed` (heat.ts: its leaving is an escape, +1); escapees after the Alarm tell the police too (negotiation.ts).
      Arrest (wounds.ts) needs the officer to have stood there since before the world phase (`PoliceUnit.moved`).
    - **State:** `PoliceUnit` gains `hp`, `leaning`, `suppressed`, `moved` (`newUnit`); `PoliceState` gains `known`
      (by crew id; a `tile` null once seen gone) and `breaches`; `Lapse` 'released' gains `freed`. A state check
      (`police`) refuses a save from before them. Save shape hash `400a89e4928a5e1e` (`5e926a44f3e501a4` before the
      review's null `tile`).
    - **Review fixes:** a crew Watch fires at fighters that act without moving (decision 159); officers go through what
      the crew knows (decision 150); a report never brings back a place seen empty; a downed target isn't shot;
      `heldFire` names its reason; breaches are called off out of Assault; a miss ends Negotiate and gives the shooter
      away; leans count toward the shot budget; old saves are refused; decision 160's departures. Re-review: a hidden
      officer shot at or suppressed answers (Negotiate's end, the muzzle flash) only past the preview's stop, so no
      preview tells of it; a fighter leans out before the Watch check, so a wedge on its lean tile catches it; the
      crew's own volley at a hidden foe is told without naming the target. Third review: a told shot names nobody hidden
      (its hits dropped, a bullet's step into them kept with an empty id); a Hostile guard unlocks and opens a locked door
      it may pass, as on its rounds; the grid offers Watch and Suppress on officers the crew sees; `heldFire` names its
      `blockers`, and is told as a plain hold (its reason may rest on someone hidden); fighters look from their lean
      tiles too; a
      fighter's shot is told (`fighterFired`, then the bullets, then its noise and Loud) only once it is fired. A told shot
      leaves out a hidden body's step and hits altogether (no hit, damage or armour to read).
    - **Known limitations:** the carriers' preview of the coming world phase (`pendingCarriers`, `carrierPreview`)
      stops at the first fighter's shot (`Dice.pictured`), so carriers that phase would start later (check-ins, vault
      sensors and the patrol car in `devices`) are missing from "this would start"; with a Hostile guard about, that is
      every phase. Cost: on a 40×24 fixture with 8 officers in Assault an end of turn commits in about 20 ms, and each
      move's `actionPreview` takes about 22 ms because `pendingCarriers` replays the whole world phase, the routine
      included, even after the Alarm; fine for now, but it grows with the force.
    - **Session:** the recap names the new events (an officer by kind); the threat ledger shows each announced breach
      at its door ("Breach next phase: …", 1); the grid's Fire offers officers in the shooter's sight. Drawing police,
      their moves and the breach marker on the map are M3-09's.
    - **Tests:** `tests/sim/routine.test.ts` (Contain fire, unmasked strangers and Negotiate left alone, a bystander
      in the line held for and moved round in Assault, a hostage shield never fired through, advancing on a report,
      falling back Hurt, officers as bodies with hit points and Negotiate's end, a crew Watch on an officer walking in,
      freeing Commanded and tied hostages and a Hold keeping them, the freed walking out and telling, breaches
      announced, carried out, refused below Heat 3 and called off, the arrest a world phase after walking up, a guard
      firing, reloading and suppressed); `tests/sim/routine.property.test.ts` (60 random loud fixtures over 6 world
      phases: no officer's or guard's bullet meets anyone but the crew, every door blown had its marker by the same
      officer through the crew phase before, markers only ever for the next phase, each carried out or called off once,
      with the crew playing Watch, Suppress, attacks, leans and moves; the same game twice ends the same); review tests:
      Watch on a standing officer and a Hostile NPC that fire, the two worlds of a hidden officer (grid, shot preview,
      told events), an old report, a miss in Negotiate, an old save, a breach called off as Assault ends.
    - **Deferred:** police hearing noises and following fresh blood trails, and a hostage killed where police see it
      ending Negotiate (police sight of kills, from M3-04); advancing cover to cover along the way they came in, and
      holding the exits at Heat 1 (they take the shortest way); the patrol shotgun, the shield's frontal shield, sniper
      nests and fire, and SWAT's own play (M3-06; SWAT run this routine until then); breaching windows and walls,
      barricades (M4-02) and breach charges as kit (M3-06); a melee strike or taser dart on an officer (the dart is spent);
      flashbangs and knockout windows on officers; the wounded crawler leaving the map and its escapee carrier (from
      M3-03); carrying a downed crew member and surrendering (§16.2); projecting the recap's police lines through what
      the crew knows (M3-09).
- [x] **M3-06 SWAT team AI.** (partial: see Deferred)
  - **Covers:** §13.6 SWAT.
  - **Work:** fire and movement; Watch wedges; flanking; focus fire; timed breaches; kit use; casualties.
  - **Depends on:** M3-05. Split into two sessions if it runs past about 1,500 lines.
  - **Notes (done):** decisions 180–186.
    - `rules/swat.ts`: a SWAT van's four are a team (`PoliceUnit.team`, the van's id; `PoliceState.teams`) acting by one
      plan a world phase, made as the first member acts (`SwatTeam`: focus, movers, pulling, stack); rules/routine.ts
      hands team members to it (`registerTeamPlay`) and exports its pieces (`fight` gains flanking, `advance` an
      `atDoor` callback, `dueBreach`, `announceBreach`). Fire and movement, focus fire by §13.6's priority, flanking,
      police Watch wedges held through the crew phase (`PoliceUnit.watch`, tripped by `tripWedges` from every crew move
      step and every other command, fired as the next world phase's combat step starts: hook `swat.wedges`), flashbangs
      on clustered crew and through a door just blown (`OFFICER_FLASHBANGS`, `policeGrenade`), timed breaches (stacks
      announced together by hook `swat.breaches`), and pulling back from a casualty (`policeDown` sets `lost`).
    - rules/actions/throwables.ts: a flashbang catches officers (`PoliceUnit.surprised`, `officerFlashed`: the phase,
      the wedge and the lean lost; a due breach called off) and, a police one, the crew (`crewFlashed`: Watch and Brace
      lost). rules/police.ts: Negotiate takes the wedges down. `seenWedges` gives the wedges of officers the crew sees,
      for M3-09; `WEAPON_WEIGHT` in data/police.ts.
    - **State:** `PoliceUnit` gains `team`, `watch`, `flashbangs`, `surprised` (`newUnit`'s `team`); `PoliceState`
      gains `teams` (`newTeam`). The `police` state check refuses saves without them. Save shape hash `fda9ebb5783a8b3a` (with M3-08's fields).
    - **Session:** the recap names the new events. Drawing the wedges, the police grenade and its radius is M3-09's.
    - **Tests:** `tests/sim/swat.test.ts` (halves moving and covering, the halves swapping, focus on the exposed, a
      mover flanking out of the target's cover, a wedge set on the last known tile, tripped and fired where crossed,
      not tripped outside it, a hidden officer's wedge telling nothing in a move's preview nor in `seenWedges`, wedges
      down in Negotiate, a flashbang on a cluster lying through a crew phase and costing a Watch, a crew flashbang
      costing an officer its phase, two doors stacked and blown together with a flashbang first and the team holding, a
      lone stacker waiting a phase, pulling back from a casualty, a team with nobody left); `tests/sim/police.test.ts`
      (a SWAT van brings a team); `tests/sim/routine.property.test.ts` extended: a SWAT team of 2–4 half the time, the
      crew throwing flashbangs: every police grenade lands in one world phase and goes off as the next starts, only a
      team's movers (and the Hurt falling back) walk outside a pull back and never the whole team, and the wedges'
      volleys meet only the crew.
    - **Deferred (M3-06b):** the shield's frontal cover and leading through corridors; snipers' nests and fire (§13.5; done in M4-05);
      the patrol shotgun and patrol flashbangs from Heat 2 (overwatch camping, a held doorway); gas on barricaded rooms
      (Heat 4) and pushing characters out of their tiles; suppressive fire as cover; wedges on the angles a plan
      depends on beyond the crew's known positions (the doorway to flank by, the loot corridor, the route to the van);
      a pair going to free hostages out of crew fire (§13.6, they still free those on their way); breaching windows and
      walls, and breach charges as kit (barricades: M4-02); dragging a casualty out; clearing rooms after a trap; the threat
      ledger showing police grenades and wedges (M3-09).
- [x] **M3-07 Negotiation, release and trade.**
  - **Covers:** §10.7, §13.4. The release cap is a constant (decision Q17).
  - **∥** M3-05.
  - **Notes (done):** decisions 130–134.
    - `rules/negotiation.ts`: the negotiator's call (`negotiatorCalling`, `negotiatorCalls`), answering it
      (`negotiate { crew, offer, npc?, member? }`: Release, Trade, Stall, Hang up), hostages walking out (a `released`
      lapse, npc/behaviour.ts `walkOut`, npc/intent.ts), what they tell (`State.negotiation.reports`) and crew traded back
      (M3-03's `State.custody`; `tradeable`, `returns`, `crewReturned`). `offerEffect` gives each offer's heat or clock delta. `STALL_PHASES` in
      data/police.ts; `exitTile` exported from rules/police.ts. heat.ts: a hostage walking out killed is a hostage
      killed (+5), reaching the police no escape (+1). command.ts: a hostage walking out ignores commands.
    - **State:** `State.negotiation` (answered, stalled, returns, reports); `Lapse` gains `released`. Save
      shape hash `dafd28410c209e29`.
    - **Session:** the action grid offers Release ("Release (-3 heat)", the tapped hostage else the first the crew holds
      and knows of), Trade, Stall ("+2 turns") and Hang up while the negotiator calls; the recap names the new events.
    - **Deferred:** the negotiator dialog (M3-09); phones as props (decision 130); the police using the reports (M3-05); the police freeing or
      taking a hostage walking out (M3-05); a deadline for a trade whose hostage can't reach its way out (it waits in
      `returns` until it does, or is killed or downed).
    - **Tests:** `tests/sim/negotiation.test.ts` (the call, Stall, release with its capped relief and the heist cap, a
      hostage led along, walking out and telling, ignoring commands, a kill on the way out, trade and return, the action
      grid; each command checked against its preview).
- [x] **M3-08 Getaway driving and the outcome.** (partial: see Deferred)
  - **Covers:** §14.4 (driving, boarding, doors; no ram), §15.4, §15.5.
  - **Work:** reachable vehicle footprints with turning curves; leaving the plot; the outcome screen and debrief data.
  - **Accept:** the swept-path preview equals the real path.
  - **Notes (done):** decisions 170–179 and 190–193 (from the review; 180–186 are M3-06's).
    - `geo/drive.ts` (poses, footprints, door tiles, the manoeuvres and their sweeps, `driveReach`/`drivePath`, `vehicleAt`),
      `rules/vehicles.ts` (`board`, `getOut`, `stow`, `drive`; `driveMap`, `vehicleReach`, `drivePlan`, the actor check
      'aboard'), `rules/getaway.ts` (leaving the plot, Failure, `State.outcome`, the command gate), `data/vehicles.ts`.
      The engine gains `registerCommandGate` (no command once the heist is over). `worldFromBank` takes the generator's
      van out of the furniture into `World.vehicles` and marks outdoor ground `Tile.drivable`; the fixture takes
      `vehicles` and `drivable`. Vehicles block steps (`stepCost`), sight and bullets (full height) where they stand
      now; crew aboard are skipped by perception, shots, occupancy and command aiming. Greed now counts bags in the
      getaway (`inGetaway`), replacing M3-04's "bags out" placeholder.
    - **State:** `State.vehicles` (pose, driver, hold, gone), `CrewState.aboard`, `State.outcome`; `World.vehicles`,
      `Tile.drivable`, `rules.driveTiles`/`wheelmanDriveTiles`/`contractTarget`. Loot in a hold has the vehicle's id as
      its `holder`. Save shape hash `6931d7e188213ab4` (with M3-05's fields).
    - **Session:** the grid offers Get in and Load the van at the van's doors, and aboard the driver's Drive (toward the
      plot's edge, `getawayDrive`, decision 179) and Get out; Move is off aboard. `outcomeView` and the HUD's outcome
      screen (HTML, over everything, New heist clears the save); `/?scene=hud&state=outcome`. The scene draws the van
      where the state has it (`scenes/bank/vehicles.ts`, baked afresh where it stops) and hides crew aboard;
      `sim.getaway()` gives the next Drive. The recap and event log name the new events.
    - **Deferred:** the driving overlay (the highlight, rotate buttons, the swept path drawn, picking any pose, the
      drive animated) to M3-09; hitting people in the way, ramming, vehicle hit points, armour, a disabled van and the
      backup car (M4-04, M4); throwing loot into the van and taking it back out; the side door opened to shoot from;
      police cars parking to block the van, the Heat 5 roadblock and wrecks (with M3-05's police movement and M4-04's
      ram); carrying a downed ally or a hostage aboard; the other exits (sewer, roof, the garage's backup car, §14.7);
      "none can still escape" as a Failure while someone is up; the crew's shares (§19.4), style (§19.8) and jail
      (§19.6) in the payout; the police's reaction to the van (M3-05); choosing the getaway spot in planning (M4); the
      van's baked sun shadow stays where it was parked; the overlay must project NPCs the crew can't see out of the
      drive's reach before M3-09 draws it (`vehicleReach` is the truth). Known limitation: a crew member downed aboard
      can't be revived or given a medkit there (nobody reaches into the van, decision 174, and those aboard act only by
      driving or getting out): they ride out with the van and count as escaped. Reviving aboard, and carrying a downed
      ally out of the van, come with M4's vehicle actions.
    - **Tests:** `tests/sim/getaway.test.ts` (footprints and doors, turns as curves and in reverse, drifts, boarding and
      the hold, aboard, getting out, every reachable pose's swept path equal to the preview's and the commit's, walls
      and people in the way, the Wheelman, leaving the plot with Success and Partial, Failure, the generated van and its
      way off the plot); `tests/game/getaway.test.ts` (the grid's entries, a drive at a time off the plot, the outcome
      view); the e2e "the getaway" (`screenshots/play-drive.png`, `screenshots/play-outcome.png`).
- [x] **M3-09 Loud interface.** (partial: see each half's Deferred)
  - **Covers:** UI.md "Loud".
  - **Work:** aim mode with the loupe; nested cone arcs; cover shields; dragging Watch wedges; police markers, ghosts and pings; one-at-a-time world phase playback; the negotiator dialog; the heat strip; the driving overlay.
  - **Depends on:** M3-01 to M3-08.
  - **Notes (first half done):** aim mode, cones, cover, police markers and ghosts, breach markers, one-at-a-time playback.
    - **Rules:** `Knowledge.officers` (rules/knowledge.ts): where each officer was last seen, kept by `updateKnowledge`
      (`learnOfficers`) while it is on a tile seen this turn, and one the crew saw walk out of view during a command or
      world phase on the last tile it was seen on (`officersPassed`, as `passedInEvents` does for NPCs, §8.15), its
      walk told (`projectEvents`: its memory of it changed during the command, as an NPC's `seenDuring`); dropped
      once older than `ghostTurns`, or when the crew sees it go down (told of the fall, `projectEvents`' rule: seen before
      it, and standing on a tile seen then); an unseen fall leaves the ghost to run out its turns, as a standing
      officer's would; `officerMarkers` gives the officers seen now and the ghosts (never predicted). Optional (older
      saves: none); the state check validates it. An officer seen anew emits `revealed` (`what: 'officer'`), so a move
      that shows one is final, as one showing an NPC is (it could be undone before). `FanSegment.outline` (and `broken.outline`): `[angle, distance]` where
      each traced piece's bullet stops, for drawing the cone. Save shape hash `bbe89785cf6778cb`.
    - **Game:** `src/game/loudUi.ts`: `aimView` (an attack's or Suppress's cone from `crewShotPreview` on the crew's
      picture, planned with `attackPlan`/`suppressPlan` on `crewPicture`; never `attackCone`), each body placed where the
      crew pictures it with its kind (hostile, civilian, crew) and its shield on the side facing the shooter
      (covered, flanked, `mayBreak`, `mayBeGone`); `policeMarkers`, `breachMarkers` (every announced breach, as the
      ledger has them) and `fireSelector`.
    - **Scene:** `scenes/bank/loudDraw.ts` (the overlay's loud layer: nested arcs per bullet, bullet 1 brightest, the
      reach past what the attack can break dashed, the aim crosshair, the body markers dashed when `ifBroken`, shields
      with end ticks and glow, a notch when it may break, `?` when it may be gone, flanked dashed grey; breach plates
      bracketed on their doors; red brackets on the acting unit), `scenes/bank/loupe.ts` (the loupe above the finger,
      painted from the game's and the overlay's canvases at POST_RENDER). `People.add` makes an officer's sprite the
      first time the crew is shown it (police or SWAT look), drawn live only on tiles seen this turn and faded as a
      ghost with "seen N turns ago". Aim mode: with an attack or Suppress previewed, a drag that doesn't start on the
      shooter moves the aim point a tile at a time (on the known person there, or the bare tile) under the loupe; the
      fire selector (HTML, `.fire-selector`, beside the action grid in the right thumb's zone, fewest rounds lowest) sets
      `bullets`. Playback: each officer's `policeMoved` steps are one walk, the sprite entering at its first step in
      sight and walking to its last (hidden on tiles between not seen this turn), the camera and the red bracket there;
      a shot, a wedge or a breach holds the camera on its unit where the crew last saw it (`shownPos`, never its true
      tile), its tracer starting there; the queue strip (`.loud-queue`) shows done, acting and next. `debugState.play.loud`.
    - **Setups:** `loud-aim` in e2e/setups.ts (two steps: Mara masked with a rifle in the thick of the lobby, then a patrol
      officer in sight, a breach and a SWAT ghost); `npm run shot -- '/?new' --setup loud-aim`.
    - **Tests:** `tests/game/loudUi.test.ts` (officer markers and ghosts, a ghost on the last tile an officer was seen
      walking on and never its new tile; two worlds, downed out of sight or standing there, give the same ghost; gone
      when seen going down; a move that
      first shows an officer is final, the turn after isn't; the aim view
      never names someone behind a wall the truth's cone reaches; nested arcs; shields; teller glass's `ifBroken` and
      the dashed reach past it; breach markers); e2e/loud.spec.ts (`screenshots/loud-aim.png`, `loud-loupe.png`,
      `loud-world.png`: aim mode, the fire selector, the loupe, police and ghost and breach shown, the world phase one
      unit at a time with the strip).
    - **Tracers:** a shot the crew is told of (`fighterFired`, the crew's `attacked`) draws a dashed tracer from the shooter
      to its aim point for a moment (red for the police and NPCs, cream for the crew).
    - **Deferred (this half):** hit flashes for shots in playback; the sniper laser and police grenades with
      their radius (UI.md "Police: announced versus visible"; the grenade is the second half's with the wedges); the
      cone's lean options as tap targets (`crewLeanOptions`) and the fine aim (`turn`) by drag; officers' facing (the
      rules keep none: drawn facing the nearest crew member); an officer walking out of sight mid-walk is hidden on unseen
      tiles but the walk's timing still runs; the loupe and fire selector on the tactical map; blood drawn (M3-03's).
  - **Notes (second half: wedges, heat strip, negotiator, driving, grenades):**
    - `src/game/loudBoards.ts` makes the loud boards from what the crew knows: `loudView` (the crew's Watch wedges, set and
      previewed; police wedges from `seenWedges` only, their reach the officer's gun capped at `COMBAT_SIGHT`; grenades
      the crew threw or sees lying, `inView`/`fresh`, with the world phases to their fuse), `driveView` (every footprint
      of `vehicleReach` tinted, the chosen one, `drivePlan`'s swept tiles and pose middles, crew left on foot),
      `posesCovering` (the reachable poses over a tapped tile, cheapest first) and `negotiatorView` (the four offers as
      the answerer's grid has them, with their effect and reason). `src/scenes/bank/loud.ts` draws it on the overlay
      (`OverlayContent.boards`, `debugState.play.boards`): wedges as outlined sectors with a faint fan (steel blue, dashed while previewed; red),
      grenades as a dashed radius, a dot and a fuse plate (red for police, amber for the crew's), the drive as a sage
      reach outline, a dashed steel-blue sweep and dotted middle line, the chosen footprint bracketed in cream with a
      chevron for its heading, and an amber flag over crew on foot.
    - **Watch wedges dragged:** with a Watch previewed, a drag from the crew member or from the wedge's aim re-aims it
      to the tile under the finger, and a tap on a floor tile does; only tiles the crew sees now, so a refusal tells
      nothing hidden; a tap on the aim sets it.
    - **Heat strip:** `HeatVM.mode` (the police's mode and its phases left: Contain, Negotiate, Assault, Regroup, the
      current lit) and the forecast's level, vehicle icon, phases and short name (`next.level`, `icon`, `short`); on
      screens under 760px only the current mode and no words. The pill says plain "ALARM" once the police are on site.
    - **Negotiator dialog** (HTML, `[data-region="negotiator"]`): over the map while the call rings; each offer an
      exchange with its heat or clock delta, one that can't be given dimmed with why; an answer commits at once by
      whoever can answer (the selected crew member first); Later puts it aside for the turn (the grid keeps the
      answers). `/?scene=hud&state=negotiator`.
    - **Driving overlay:** the grid's Drive previews the getaway drive; a tap on a tile any reachable footprint covers
      drives there instead, a tap again on the chosen footprint the next pose over that tile (turning the van). The
      drive plays from its `driven` event: `Vehicles.animate` shows the van at each pose along the path
      (`DRIVE_POSE_MS`), the camera on its end (`debugState.play.driving`); a cut drive plays only what was driven.
      The van stays at its last frame when the drive ends. The chosen footprint is steel blue, gold with two chevrons at
      the plot's edge for a drive off the plot (`DriveVM.exit`), red when it can't be reached; the path is cream, apart
      from the reach's colour in either palette. The forecast headlines the step's most significant force (SWAT van,
      helicopter, snipers, police van, then cars). With a Watch previewed only a drag from the aim tile moves the wedge
      (a cancelled one puts it back); a drag from the crew member still draws a path, and any other pans.
    - **Setups and tests:** `npm run shot` presets `loud-standoff`, `watch-wedge`, `negotiator`, `drive`
      (`e2e/setups.ts`, `window.sim.officer(kind, pos, state)` for scripted officers); `tests/game/loudBoards.test.ts` (a
      hidden officer's wedge not told, a seen one's; the crew's wedge previewed then set; a grenade where seen; the mode
      in the strip; the dialog's offers; the reach, sweep and on-foot flags, a tapped pose committing to itself, an
      unseen NPC not shrinking the reach); `e2e/loudBoards.spec.ts` (`screenshots/loud-standoff.png`, `loud-watch.png`,
      `loud-negotiator.png`, `loud-drive.png`).
    - **Deferred:** the rotate buttons beside the chosen footprint (tapping it again turns it); the drive animated
      between poses (it steps pose to pose) and its sun shadow; wedges clipped to what their holder sees (drawn as the
      full sector to their reach); a Watch arc narrower than the gun's widest (the fan's edge dragged); blast tiles
      (the radius is drawn as a circle); officers drawn on the map, ghosts and pings, breach markers and the world
      phase one unit at a time (the first half's); the sniper laser (with M3-06b's snipers; done in M4-05).

### M4: Sandbox v1

- [x] **M4-01 Charges, gaps and explosions.** (partial: see Deferred)
  - **Covers:** §12.2, §14.2.
  - **Work:** breach and shaped charges; thermite; tripwires; edge state changes; the loot-loss preview; debris cover; wall-gap art.
  - **Notes (done):** decisions 200–208. `src/sim/rules/actions/charges.ts`: `placeCharge { crew, item, edge }` (breach,
    shaped), `placeTripwire { crew, at }`, `State.charges` (gone off in the `fuses` step, `charges.fuses`),
    `State.tripwires`, `State.debris`, `CrewState.charges` (kit counts), `EdgeProps.gap`; `chargeBlast` (what a charge
    would do now: the door breached or the gap, the far side's tiles, the loot lost, the debris) is both the fuse's and
    the preview's; `scorchTiles`/`scorch` for thermite at the vault door (rules/vault.ts). `Harm.cause` 'blast'. The
    walks of the world phase call `steppedOn`/`stopsWalk` (`src/sim/rules/steps.ts`), which charges.ts registers, so
    the walks don't import it. Data: `CHARGES`, `TRIPWIRE` (data/weapons.ts), the `tripwire` noise (14). Debris is half
    cover nothing shoots away in `shotFabric`. `lootDestroyed` on a hidden tile isn't told (`projectEvents`).
  - **Game and scene:** the grid's Breach charge, Shaped charge (with the kit's counts) and, once loud, Tripwire
    (actions.ts); the loud board's `charges` (lying, previewed, thermite burning or previewed: the far side outlined, a
    red cross on each piece of loot it would destroy, its fuse; only tiles not hidden) and `tripwires`
    (`chargeViews`, loudBoards.ts; drawn in loud.ts); a lying charge hides the safe floor as a grenade does; wall gaps
    (`gapWallArt`, src/art/bank/gaps.ts: the segment's own art at each cut step with a ragged hole, darker torn stubs
    and rubble of its material on the footprint; `Walls.setGap`) and debris heaps (`debrisArt`, `Walls.addDebris`),
    synced from the state. Recap lines for every event.
  - **Setups and tests:** `npm run shot` presets `charge-preview`, `wall-gap`, `wall-debris`; `tests/sim/charges.test.ts`,
    `tests/game/charges.test.ts`, `e2e/charges.spec.ts` (`screenshots/charge-preview.png`, `wall-gap.png`,
    `wall-debris.png`). Save shape hash `ebfdf01cb70013e2` (with M4-02's fields); the `charges` state check refuses saves from before.
    No visual baseline changed (nothing new shows at the start).
  - **Deferred:** police breaching windows and walls and using charges as kit, spotting tripwires from Heat 3 and
    disarming them (M3-05/M3-06's breaches stay door-only); thermite's fire on the tile, and thermite through a floor;
    picking which wall beside a crew member a charge goes on by tapping it (the grid takes the tapped door, else the
    wall faced, else the first); vehicle-ram gaps of 3 segments (M4-04); a charge's blast or a tripwire on loot held
    in the hands; police and NPCs routing round known tripwires; the blast's own animation (the scene shows the result);
    the baked lamps re-traced through a new gap (light still stops where the wall stood, `src/art/bank/lamps.ts`);
    the long-press material tag (§14.2 "which of the squad's tools can open it").
- [x] **M4-02 Fortifying.** (partial: see Deferred)
  - **Covers:** §14.3.
  - **Work:** barricades, reinforcing, blinds; police breaking barricades.
  - **∥** M4-01.
  - **Notes (done):** decisions 220–226.
    - `rules/fortify.ts`: `fortify { crew, edge, action }` on a wall segment beside the crew member: `barricade` and
      `clear` (a shut door that isn't the vault's, or a window; 1 action, hands free; not while a strike or breach is
      announced there), `reinforce` (a Soft wall or shut door; `rules.reinforceActions` 2 actions and a kit use; a door's
      bar `barredFrom` the crew member's side), `unbar` (from that side, 1 action), `lowerBlinds` / `raiseBlinds` (a window; 1 action, no
      noise). What it changes lives on the edge: `EdgeProps.barricade` (hit points, `rules.barricadeHp` 2),
      `blinds`, `reinforced` (with `material: 'reinforced'`); `edgeNow` lets a barricade block movement and sight
      whatever the door does and blinds block sight. geo/move.ts `barred` and `MoveOptions.canBreak`: nobody passes a
      barred door but a police plan that will break it; geo/shot.ts: a barricade is half cover for the tiles either side,
      like a railing; rules/actions/door.ts: a barred door doesn't open and its lock isn't worked.
    - rules/routine.ts and swat.ts: officers allowed to breach plan through barred doors they can break (`canBreak`,
      `toBreak`) and announce at them like a breach (a SWAT team stacks there); the due act strikes a barricade
      (`barricadeStruck`) and re-announces while it has hit points left, the last strike breaking the door; a door blown takes the crew's reinforcement
      with it; nothing at a door changes under an announced breach. `dueBreach` returns `{ door, blown }` (a flashbang
      follows only a door blown).
    - **State:** `CrewState.reinforcements` (kits × `rules.reinforceUses` 2); `EdgeProps.barricade`, `blinds`,
      `reinforced`, `barredFrom`. The `fortify` state check refuses saves without `reinforcements`. Save shape hash
      `2c057f90eff4f952` (with M4-01's fields).
    - **Session and UI:** the grid's Barricade / Clear barricade and Reinforce on the door, else Blinds and Barricade on
      the first window beside them, else Reinforce wall (`fortifyEntries`: in stealth last, once loud after Command);
      the recap names the new events; the ledger's breach reads "Barricade struck next phase" on a barricaded door;
      the world overlay draws fortified edges (`fortifyMarkers`, loudDraw.ts: planks with a pip per hit point, slats,
      a riveted bar), in stealth too; `debugState.play.loud.fortified`.
    - **Tests:** `tests/sim/fortify.test.ts` (a barricaded door shut for everyone and Clear; a window barricade's sight
      and half cover; refusals; suspicion seen in stealth; reinforcing a wall and a door, kit uses; blinds against the
      patrol car; an officer striking a barricade twice, each announced, the last breaking the door; a barricade on a
      locked door struck through; nothing below Heat 3; only heavy SWAT through a reinforced door; preview equals commit, legalActions, the save; the grid); review: re-barricading every crew
      phase holds a breach 3 phases at most, nothing changes at a door under an announced breach, Unbar only from the
      bar's side and sound stopped at a reinforced door, SWAT stacking at a barricade and a heavy team blowing a
      reinforced door, an officer below Heat 3 staying outside; the random player of
      `perception.property.test.ts` plays fortifying now and then; `e2e/fortify.spec.ts` (`screenshots/barricade.png`)
      and the `barricade` shot preset.
    - **Deferred:** furniture actually pushed from its tile (the barricade is abstract, decision 220) and barricade,
      blinds and reinforcement drawn as props in the bank (they are world-UI markers for now, as flipped tables aren't
      drawn either); tapping a window to choose it (the grid takes the first beside the member); the police's breach
      charge on a nearby Soft wall when every entry is barricaded, and breaching windows and walls (with M4-01's gaps);
      barricading a gap or a blown door (M4-01); gas on barricaded rooms (M3-06b); the crew's shaped charge on a
      reinforced wall (M4-01); a vehicle ramming a barricade (M4-04); staff reading a barricade or lowered blinds as
      evidence (§8.10); the reinforcement kit bought in planning (M4-07).
- [x] **M4-03 Power grid and darkness.** (partial: see Deferred)
  - **Covers:** §8.13, §14.6.
  - **Work:** the breaker and generator; Lit; maglocks; the console going dark; a dim-lighting variant for the art (decision Q10).
  - **Notes (done):** decisions 240–247. `src/sim/core/power.ts` (`State.power`, `powerOn`, `litNow`, `darkensAt`,
    `failSafeDoors`, `lockReleased`, `rules.generatorPhases`) and `src/sim/rules/power.ts` (the `breakerPanel`'s `cut`
    and `reset`, the `generator`'s `disable`, the `power.generator` crew-phase hook, the `power` evidence source;
    events `breakerCut`, `breakerReset`, `generatorDisabled`, `generatorStarted`, `powerOut`,
    `powerBack`). Read by geo/los.ts (the sight map's `lit`), geo/cones.ts (`cameraObserver`), geo/move.ts
    (`doorStatus`), rules/keys.ts (`vaultShut`), rules/cameras.ts (panning), rules/knowledge.ts (unknown watchers, the
    cameras' status), rules/routine.ts (`seesTile`), rules/evidence.ts (`Evidence.everywhere`) and door.ts (locking, the
    looped reader). `World.building` moved into core/types.ts; fixtures take `building`.
  - **Game and scene:** the grid's Cut power, Restore power and Disable generator (VERBS), recap lines for every event
    ("Lights out"); `PowerCut` (scenes/bank/power.ts) draws the dark, synced from the
    state and the `powerOut`/`powerBack` events; `debugState.powerOut` and `timings['power cut']`.
  - **Setups and tests:** `npm run shot` preset `power-out`; `tests/sim/power.test.ts` (the cut, three dark world phases
    and the generator, reset, disabling before and while it runs, no generator, the illegal act seen beyond half range
    in the light it was done in, a cut restored in the same crew phase still noticed, sight halved,
    combat sight halved (in a cut and in an unlit room), cameras off and still, maglocks fail safe (the crew's move and
    an NPC without a card through it) and secure, the dark console, lights out noticed by
    staff and guards in the building and not by civilians or anyone outside, a guard sent to the breaker, the save and
    its check, the grid and recap; previews equal commits); `e2e/power.spec.ts` (`screenshots/power-on.png`,
    `power-out.png`: cut from the grid, drawn in under 500 ms, people relit darker, restored). Save shape hash
    `c8e8c40712338aa8` (with M4-01's and M4-02's review fields and M4-06's); the `power` state check refuses saves from before.
    No visual baseline changed.
  - **Deferred:** a guard resetting the breaker when he reaches it (he only looks for now) and staff reading a cut as
    more than minor; a HUD chip for the power (and the generator's countdown, once the crew can know of the generator); the grid
    offers the first object in reach, so beside both panels the breaker needs tapping; the manager's PC, card readers
    on Secure doors and the phones needing power; cutting the phone line (§9.1); SWAT's wedges (`wedgeReach`) and
    police aim not halved in the dark (their sight is); raised floors, debris, gaps' rubble and the walls' doorways
    opened after the cut drawn untinted, and daylight through windows not lighting the dark rooms more than it did;
    the fire alarm (v2); the generator and breaker as assets on the planning screen (M4-07).
- [x] **M4-04 Vehicles in full.** (partial: see Deferred)
  - **Covers:** §14.4.
  - **Work:** ramming; the ram truck; the backup car; police cars blocking; vehicle damage.
  - **Depends on:** M3-08.
  - **Notes (done):** decisions 280–285.
    - `rules/ram.ts`: `ram { crew, vehicle }` (1 action of the driver): straight ahead into the first thing within one
      Drive, after at least 2 clear tiles of run-up; `ramPlan` (the preview's and the commit's plan, on what the crew
      knows) and the cut before someone unseen (`driveCut`, as decision 192). A Glass or Soft wall opens a gap of the
      van's width plus one segment (doors breached, barricades and reinforcing gone with them, `openSegment` shared with
      M4-01's charges), 6 damage (Harm cause 'ram') across it, the vehicle stopping in the breach; people in the way are
      hit; police cars and wrecks are rammed and shoved sideways out of the lane, roadblock pieces knocked away; crew
      vehicles rammed; anything harder stops it dead. Rammer 10 (halved with a Wheelman, again in the ram truck), rammed 10;
      the `vehicleRam` noise (16) and the bank goes Loud. Events `rammed`, `vehicleShoved`, `roadblockCleared`.
    - `rules/vehicleDamage.ts`: `VehicleState.hp` and `PoliceVehicle.hp` from `VEHICLES`/`POLICE_VEHICLES` (hit points
      and armour); `damageVehicle` (armour off every bullet or blast, a ram's flat), `blastVehicles` (charges and
      tripwires, charges.ts), bullets that stop on a crew vehicle (`resolveShot`; the shot step `object` carries the
      bullet's damage left); a crew vehicle at 0 is disabled (no Drive, no Ram, the crew can still get out), a police
      one a wreck (`status: 'wreck'`, frees its staging slot, stays in the way). Events `vehicleDamaged`,
      `vehicleDisabled`, `policeWrecked`.
    - Police vehicles park on their whole footprint (car 2×3, van 2×4, lying along the street, `policeFootprint`,
      `parkingSpot`) at the staging points, which are the plot's exits, and block drives there; the Heat 5 wave puts up the
      roadblock (`PoliceState.roadblock`, `roadblockTiles`, `roadblockSet`) across each staging point's column.
    - `VEHICLES` gains the ram truck (2×4, 40/3) and the backup car (2×3, 20/1); with several crew vehicles the heist
      goes on after one leaves while someone up is left with a vehicle that can drive (rules/getaway.ts), and the outcome
      counts everyone aboard any vehicle that left.
    - **Game:** the grid's Ram for the driver (shown with something to ram within reach; refused without the run-up);
      recap lines for the new events.
    - **State:** `VehicleState.hp`, `PoliceVehicle.hp` and `'wreck'`, `PoliceState.roadblock`; the `vehicleDamage` and
      `police` and `escaped` state checks refuse saves from before. Save shape hash `2a158b4985ad16e9` (with M4-03's and M4-06's fields).
  - **Deferred:** the planning screen placing the ram truck and the backup car (M4-07; nothing generates them yet), and
    their art in four facings (`van.ts` is the model); police cars, wrecks, the roadblock and a disabled van drawn in
    the bank (the rules have them; the scene draws only the crew's van, and M3-09's driving overlay is still to come),
    and a vehicle's hit points in the HUD; the ram's crash animated (the scene drives the run and syncs the gap);
    police vehicles as cover and obstacles on foot, and bullets hitting them; a Drive running people down (decision 172
    stays: it goes round them; only a ram hits); driving into a rammed gap (the building's floor isn't Drivable);
    rams into fences and railings (they stop it dead), into teller glass; breakable street dressing smashed (§20.9);
    police reacting to the van (ramming it, blocking its path on purpose rather than parking at the exits); the side
    door opened to shoot from; reviving or carrying a downed ally aboard. **Depends on
    M4-05:** a van disabled by bullets or blasts (its own ram is refused first, decision 281) leaves the crew the on-foot exits
    (§15.4 "escape is always possible").
  - **Review (done):** decisions 281, 282 and 283 amended, 286 added: those who got away are out of play
    (`State.escaped`, `crewEscaped`); a ram that would disable the crew's last drivable vehicle is refused (any other takes
    its full damage) and rams always clear a lane (a boxed-in police car is shunted ahead, pushed off the street only when
    that fails too); seen people never cut a ram and are hit wherever they stand; the dead and stashed
    aren't hit; the ram stopping short of the breach recorded. Tests: escaped crew through 20 world phases, the last-way-out
    refusal and a spare vehicle rammed to 0, the shunt ahead, bodies spared, someone seen on undrivable ground, unseen people beyond a breached wall (preview against
    commit), a boxed-in car pushed clear.
  - **Tests:** `tests/sim/vehicles.test.ts` (a Soft frontage rammed: the gap, the run, who across it is hit, the damage,
    the noise; a door and its barricade; the extra segment's side and a Reinforced wall stopping it; the Wheelman and the
    ram truck; run-up and nothing to ram; a police car shoved, wrecked, boxed in; the roadblock; someone seen in the way;
    the cut before someone unseen and its preview equal to the ram with nobody there; armour, disabled; bullets on the
    van; police footprints parked clear and blocking; the roadblock's tiles; the backup car as a second way out); every
    ram checked against its preview; `tests/game/getaway.test.ts` (the grid's Ram).
- [x] **M4-05 Height, the sniper nest and off-map routes.** (partial: see Deferred)
  - **Covers:** §14.5, §14.7.
  - **Work:** the transit track for roof and sewer routes; vents.
  - **∥** M4-01.
  - **Notes (done):** decisions 300–306.
    - `src/sim/core/transit.ts` (`World.routes`: `AccessRoute` with its two ends, kind `roof` / `sewer` / `duct` and
      turns; `CrewState.transit`; `offMap`, which every check that skipped crew aboard a vehicle now uses: sight,
      perception, occupancy, bullets, blasts, Command's guns, evidence, SWAT targeting) and
      `src/sim/rules/transit.ts`: `enterRoute { crew, route, escape? }` (1 action, an end in reach, nothing heavier than
      Light in the hands, no body; the roof and the duct closed while the helicopter is over the plot), seen going in
      as an action ending there; the `transit.track` devices hook (after the police) takes a phase off and puts them out
      on the far end (or the free tile nearest it), turns roof and duct travellers back when the helicopter is over;
      `escape` takes them off the plot instead (`routeEscaped`), out of play as escaped (rules/getaway.ts `leaveOnFoot`,
      `Escaped.vehicle` null with its `route`, as decision 286's drive off), and a
      vehicle leaving doesn't end the heist while one is still on the way out. Cash out of the building that way settles
      its dye pack (`cashLeaves`, factored out of loot.ts's step hook). The actor check `transit` and a crew-phase hook
      keep them actionless; the `transit` state check refuses saves without the field.
    - The generator (src/gen/approaches.ts) names its routes and adds the duct from the roof ladder to the server room's
      vent grille as a route (`OffMapRoute.kind: 'duct'`, 2 turns); `worldFromBank` and fixtures take `routes`.
    - Police snipers: `src/sim/rules/sniperPosts.ts` (posts outside the building that see its windows, raised first,
      ranked once per World on the bank as built; a sniper is deployed at the best free one nearest its staging point,
      rules/police.ts `unload`) and `src/sim/rules/snipers.ts` (`registerKindPlay('sniper', …)`, rules/routine.ts:
      the laser `PoliceUnit.laser`, `sniperAimed` / `sniperAimOff`, the shot through `fire`/`cleanShot` a phase later at
      the one lasered if still in long sight, held in Negotiate, a flashbang taking the laser; `sniperLasers` for the
      view, told always).
    - Height (§14.7) was already whole (M3-02's raised shooter ignoring ground half cover, railings' half cover, sight
      over middle-height things from a raised end); a sniper on a raised post gets it through the shot trace.
  - **Game and UI:** the grid's Up to the roof / Down the manhole / Into the duct (or the way back) and Escape over the
    roof / by the sewer / by the duct at a route's end in reach (`ROUTE_LABEL`, `ESCAPE_LABEL`), nothing in transit; the
    rail's transit badge (`CrewVM.transit`: turns left); crew in transit hidden from the map; the laser drawn in
    the loud layer (`laserMarkers`, loudDraw.ts `drawLaser`; `debugState.play.loud.lasers`); recap lines.
  - **Setups and tests:** `npm run shot` preset `sniper`; `tests/sim/transit.test.ts` (out at the far end after the
    route's turns, the nearest free tile, back the other way, Light only, the helicopter closing the roof and forcing
    back, unseen and unshot while gone, escaping and the outcome, the save and its check), `tests/sim/snipers.test.ts`
    (posts raised and nearest, the laser a phase before the shot, out of sight loses the shot, Negotiate, a bystander
    in the line holds fire, the laser told while the sniper is unseen); `e2e/snipers.spec.ts`
    (`screenshots/sniper.png`). Save shape hash `3b36ab13a46112be` (with M4-04's review fields). No visual baseline changed.
  - **Review (MAJORs and MINORs fixed):** a crew member off the map is nobody's teammate to reach: every command naming
    one (`to`, `ally`: pass, hand a magazine, revive, medkit) is refused (act.ts `teammateRefusal`), and a thrown bag
    lands on the floor of the tile they left; every rule that read the crew's tiles skips those in transit (rams, the
    roadblock, police parking, tackles, the panic and patrol-car eyes, the CCTV desk, doors swinging shut, NPC walks,
    knockouts, leans, loud noises heard, steady hands at the drill); no route again in the crew phase right after
    coming out (`CrewState.cameOut`); coming out (`routeExit`) is onto the end or the nearest tile of its room reachable
    without a door, passing over a tile someone stands on (a body lying there is no bar; re-review: never held by a
    person, so nobody hidden keeps them off the map nor betrays themselves by it; held a phase only with the whole room
    taken, `routeHeld`), is seen as an action ending there, and is a preview secret; the heist's end (now also in §15.4 and decision 177) is one rule after every
    command (rules/getaway.ts `heistOver`): nobody but the dead left, or after a drive off nobody up behind, or those
    behind with no crew vehicle and no route off the plot (they are arrested), never while someone is on a route out;
    the outcome's `vehicle` is the last that drove off. A sewer route the crew can reach is a §17.7 rule never relaxed
    (`sewerExit`, src/gen/validate.ts), so a crew turned back off the roof by the helicopter still has a way out.
    Save shape hash `764c026126418108`.
  - **Deferred:** the crew's own sniper nest bought in planning and its pane (§14.5, M4-07: the nest room is generated
    and raised; any crew member on it already shoots with the height rule) and the police countering a known nest at
    Heat 4–5 (SWAT clearing the building); snipers walking to their posts (they appear there a phase after their wave)
    and moving posts when they see nothing; the laser's preview of the tiles its sniper sees (only the line is drawn);
    staff reading someone vanishing down a hatch as more than a step ended there; a crowbar for the manhole (§15.4: no
    such item yet); the helicopter leaving (M3-05's deferral) and so reopening the roof; the transit track's own strip at
    the screen edge (the rail's badge stands for it) and route ends marked on the map; vents as a crawl through walls
    between rooms (the generator makes only the duct from the roof); the state of a previewed world phase still holding
    whoever came out (only its events are kept secret).
- [x] **M4-06 Distractions and gadgets.** (partial: see Deferred)
  - **Covers:** §8.13, §12.2.
  - **Work:** the noisemaker; ringing a desk phone; the jammer; the ammo bag; the reinforcement kit.
  - **Notes (done):** decisions 260–267. `src/sim/rules/actions/gadgets.ts`:
    - `throwNoisemaker { crew, to }`: 1 action, hands free, up to `NOISEMAKER.range` 6 (Euclidean) to a tile the thrower
      sees that isn't full height, in stealth too; `NOISEMAKER.count` 3 per kit item in `Arms.throwables.noisemaker`
      (rules/arms.ts), the last taking the item off. It sounds as it lands (`noisemakerLanded`, then the quiet
      `noisemaker` noise of 3 at the landing tile): the hearers react as to any quiet noise (rules/evidence.ts), so the
      preview's ring and ears are the outcome. `noisemakerTargets` / `noisemakerBlocked`; every target is a candidate.
      Throws (the noisemaker and the crew's grenades) fly through `throwMap` (geo/los.ts): sight's map with every edge
      that stops a body but a railing or fence, so never through intact glass or a shut door. Seen thrown in a quiet
      bank it costs 1 pip with each NPC who sees the thrower (decision 267); the last one takes every kit item off.
    - The ammo bag: `dropAmmoBag { crew }` (1 action, hands free, Loud only, on their tile; `State.ammoBags`,
      `rules.ammoBagUses` 4) and `refillAmmo { crew, bag }` (1 action, in reach: every gun's spares back to its start,
      `refillMagazines`; the last use leaves nothing). The `gadgets` state check refuses saves without `ammoBags`.
    - The reinforcement kit (rules/fortify.ts `spendReinforcement`): a kit whose two uses are spent comes off.
    - The suppressed SMG: its own item and weapon row (`suppressedSmg`: the SMG's numbers, quiet noise 4).
    - The jammer was already whole (M1-08: radios and mobile phone carriers paused in its radius 8, check-in calls not
      reaching a guard in range, dispatch's lost contact after 10 phases); it is now drawn.
  - **Game and scene:** the grid's Noisemaker (n) thrown as far as it goes ahead of them (`noisemakerTiles`: the targets
    with the doubted doors shut, none hidden), a tap on another tile it reaches while previewed moving it, the throw's
    arc and range drawn as a bag's; Ammo bag and Refill (n); the world overlay draws a running jammer with its radius and
    an ammo bag with a pip per refill left, in stealth too (`gadgetMarkers`, loudDraw.ts `drawGadget`;
    `debugState.play.loud.gadgets`); barks and recap lines.
  - **Setups and tests:** `npm run shot` presets `noisemaker`, `gadgets`; `tests/sim/gadgets.test.ts` (the lure: ring,
    ears, the guard sent and walking at once, back once beside the spot; refusals; glass and a railing, for grenades too; the pip when seen; two kits; the last noisemaker; the grid and
    `legalActions`; the ammo bag Loud only, refills, reach, the last use, the save; reinforcement kits coming off; the
    suppressed SMG's quiet shot); `e2e/gadgets.spec.ts` (`screenshots/noisemaker.png`, `gadgets.png`). Save shape hash
    `7af157e58b930bf7` (with M4-03's fields). No visual baseline changed (nothing new shows at the start).
  - **Deferred:** ringing a desk phone (done in M5-04, decisions 360–361); a phone-alarm noisemaker set to go off later (a fuse in
    stealth would change a world phase the safe floor doesn't judge, decision 101); picking the jammer or an ammo bag
    up again; the ammo bag in the van or a stash drop (§18.2); the suppressor as an attachment fitted or taken off in
    play (it is its own item); the police's own grenade throws through `throwMap` (rules/swat.ts); the jammer's and the ammo bag's
    own prop art (they are world-UI markers); every gadget bought in planning (M4-07).
- [x] **M4-07 Planning screen.** (partial: see Deferred)
  - **Covers:** §18.
  - **Work:** crew and loadouts; starts; vehicle spots; assets with their costs and the favour cap of 8, placed on the map; output a `HeistSetup` that becomes the starting state.
  - **Depends on:** M4-01 to M4-05 for which assets exist.
  - **Notes (done):** decisions 320–329. `src/game/plan.ts`: the `ROSTER`, slots (`SLOT_ITEMS`), `ASSETS`,
    `PLANNING_CASH`, `FAVOUR_CAP`; `HeistSetup` (crew with loadout and start, each vehicle's spot, the jammer, the nest);
    `planOptions` (each vehicle's spots and poses, the nest's tiles), `setupProblems`, `spent`, `jammerSpot`;
    `heistFromSetup` builds the World with the plan's vehicles (`bankVehicles` is the generator's, rules' and scene's
    shared start) and the State (crew by or in their vehicle, as `crewStarts` places the M1 crew, or in the nest; the
    jammer running). `newHeist`/`startHeist` take an optional setup; without one the M1 heist is as before. The rules
    gained only `CrewStart.aboard` (decision 321); no state field, so the save shape hash is unchanged.
  - **Screen:** `src/ui/planning/Planner.ts` (HTML over the bank scene's tactical map in its planning mode: no camera
    buttons, nobody moving, the blueprint's knowledge): the contract strip (target, police in, vault; cash left and
    favour pips), the crew rail (portrait in the crew colour, profile, weapon, start; a tap opens the loadout sheet with a
    select per slot and the start, and brings or leaves out), the assets with price and favour pips, the map's pins
    (each vehicle's spot with who starts there and a police-view eye, the spots the one being moved could take, the nest,
    the jammer with its radius), Start with the first problem above it; the planned vehicles drawn where they wait and
    only the NPCs the crew knows (decision 328). Narrow screens keep each asset's short name. `BankScene.tileAtPage` for its taps; the scene
    draws a vehicle the plan parked away from the generator's spot, the backup car and the ram truck in the van's art.
  - **Tests:** `tests/game/plan.test.ts` (the default plan, vehicles at their own spots with drivers, the nest, the
    jammer outdoors only, the NPCs the free starts know, plans that aren't one, cash, the save and resume); `e2e/planning.spec.ts` plans and
    starts a heist, shows only the NPCs play shows at turn 1, asks before overwriting a saved heist (and goes back on
    Keep planning), and the outcome's New heist goes to planning (`screenshots/planning.png`,
    `planning-assets.png`, `planned-heist.png`). No visual baseline changed.
  - **Deferred:** the other §18.2 assets: Blueprints and Guard rota (done in M5-03), Inside man (M5-02), Stash drop (needs Gear
    up and a stash to take from), Cut phone line (M5-04's phone line), Tow truck (police arriving by side), pre-placed
    charges (a remote detonator), staff uniforms (M5-04), the Silent and Beast drills (M6), the Medic bag (shared
    medkits in the van), the generator and breaker (M4-03); Gear up, and so packing a long gun or armour in planning;
    the backup car's and ram truck's own art (M4-04's deferral; the car wears the longer van's); the campaign's money,
    roster and contract crew size (M6-02, M6-03, M6-04) and intel on the planning screen (done in M5-03); dragging assets onto
    the map (they are tapped); the shadow the generator's van leaves baked at its spot when the plan parks it elsewhere
    (as after a drive).
  - **M4 is complete apart from its partials' deferrals.**

### M5: Procedural banks (mostly built; these are the gaps)

| Already built | Gap, and the package that closes it |
| --- | --- |
| Plots, archetypes, programs, shapes, parcels, furnishing, stories, metrics | none |
| Key graph (text only) | Structured keys: M2-05 (done) |
| Population and schedule (text activities) | Typed activities: M1-06 (done) |
| Traits (strings) | Typed traits: M2-02 |
| Validation §17.7 on the rules' vision | none (M5-01 done) |
| Opportunities as mechanics | none (M5-02 done, partial) |
| Knowledge layers (blueprint outlines, rendering only) | M1-10 for in-heist casing, then M5-03 |
| Furnished data not exported | M1-02 |

- [x] **M5-01 Validation on the rules' own vision.**
  - **Work:** `validate.ts`'s guard-overlap, useful-camera and Clean-route checks call `src/sim/geo`. The Clean route must be a path the safe floor shows green for a Clean crew member on turn 1.
  - **Accept:** the sweep passes; any change in the number of banks rejected is reviewed.
  - **Notes (done):** decisions 340–344. `finishBank` builds the bank, then `validate` gets its World (`worldFromBank`)
    and checks sight on its turn-1 state: the guards with the calm profile (`fieldOn`), the cameras through
    `cameraObserver` (both pan facings), the Clean route through `pathSafety` and `safeFloor` (`cleanRoute`).
    `placeCameras` ranks its slots by the same sight, on a bare World of the bank (nobody in it, a camera in every
    slot); the generator's own `cone` and its constants are gone. `cleanRoute` and `pointlessCameras` are exported
    and tested on their own (tests/validate.test.ts: a guard watching the goal's doors, a camera facing a wall). The
    sweep (224 banks) still passes with no relaxed rule; the review is in decision 343.
- [x] **M5-02 Opportunities as mechanics.** (partial: see Deferred)
  - **Covers:** §17.6.
  - **Work:** discovery triggers (eavesdropping within 2 tiles for 1 turn, document objects, intel); effects wired in (the keycard in the drawer, the propped fire door, the bribe, the IT tech's card, the vault code note); the Intel journal UI with Full, Minimal or Off guidance.
  - **Done:** `src/sim/rules/opportunities.ts` (decisions 380–388). `worldFromBank` makes each generated opportunity an
    `OpportunityDef` (`World.opportunities`: its speakers, its document, where and when it plays out, what it wires
    in) and `document` objects (every stack of papers on the staff side, the note among them; the manager's papers;
    the records); the drawer keycard
    object is in every bank with a manager's desk. Found ones are `State.opportunitiesFound` (in order, with how and
    when). Found by **eavesdropping** (a conversation in earshot for a whole turn: always chatter, the topic by
    chance), by
    **reading** a document (`interact … read`, always final), or by the **intel** box (the intel ones, and those
    nothing else in the bank would tell). Wired in: the drawer keycard only once `keycard-drawer` is found; the
    operator props the back door on his smoke break (`DoorState.proppedBy`; doubtful to the crew's picture); the
    `bribe` command (Smooth Talker, seen as a pickpocket's act; the teller in debt stays off the alarm); the visiting IT
    technician's card logs into the alarm panel without a kit, at once, once his visit is known; the vault code note
    gives its part of the code or the time-lock window. The grid offers Read and Bribe.
    The **Intel journal** (src/ui/hud/, `journalView` in src/game/views.ts) beside the ledger in the top strip (J):
    found entries only, marked overheard, read or intel; Full adds when (amber ahead, the safe colour while on, struck
    through once over) and a Show button, Minimal the text alone, Off also no new-entry badge or bark; remembered on
    the device (`bankheist.guidance`), Full by default (§22). `/?scene=hud&state=journal`.
  - **Tests:** `tests/sim/opportunities.test.ts`, the M5-02 case in `tests/sim/fromBank.test.ts`, the drawer case in
    `tests/sim/phones.test.ts`; e2e: the journal in `e2e/hud.spec.ts` (and every sample's layout) and
    `e2e/play.spec.ts`. No generator change: the banks and visual baselines are as before. Save shape hash
    `15cec6b111e4f5de`.
  - **Deferred:** intel bought or shown on the planning screen (M5-03); a conversation between two people with its
    own bark (talk is two NPCs in earshot or a phone call, no scheduled talk blocks), and map pins for Full guidance
    (Show moves the camera); the bribe's price (M6's money); the text-only opportunities stay text (cash cart, café
    wall, vent,
    scaffolding, records, cleaner's keys, check-ins, manager's PC: their mechanics are the map's or other packages');
    the guidance toggle on a settings screen (§19.9; it lives in the journal).
- [x] **M5-03 Knowledge across days.** (partial: see Deferred)
  - **Covers:** §17.8.
  - **Work:** the Blueprints and Guard rota assets; casing persisting between days; intel shown on the planning screen.
  - **Depends on:** M4-07.
  - **Done:** decisions 400–406. The rules' `Intel` (`World.intel`, rules/knowledge.ts) is all the crew knows of a bank
    before a heist: the Blueprints and the Guard rota, and the casing of earlier heists there (the tiles seen, the
    routines learned, the opportunities found, with how). A heist starts knowing it: the tiles seen stale (their
    layout, rooms and cameras), the routines predicted from turn 1 as the rota's are, the finds in the journal (turn 0);
    nothing that moves or belongs to the day (who stands where, doors, feeds, codes). `intelOf(world, state)` gives the
    heist's intel back, grown (`Knowledge.routines` keeps every routine ever known). `src/game/intel.ts` keeps it per
    bank (`intelKey`, by `bankPrint`), merging (`mergeIntel`) as the Session saves; planning loads it (`loadIntel`,
    checked by `intelProblem`) into `HeistSetup.intel`. The planner sells the Blueprints ($2k, 1) and the Guard rota
    ($3k, 1), paid as bought; the planning map draws the start's tiles as play does at turn 1 (`startView.visibility`)
    with the intel and the intel assets; the top strip's Intel chip opens what the intel holds (`intelSummary`).
  - **Tests:** `tests/game/intel.test.ts`; the shape sample in `tests/sim/save.test.ts`; `e2e/planning.spec.ts` buys
    both assets, starts, and plans the next heist with the intel (`screenshots/planning-intel-assets.png`,
    `planning-intel.png`). Save shape hash `6a302cf30755c37c`. No visual baseline changed (nothing new at the start of an
    unplanned heist or in the viewer).
  - **Must-do for M6-01:** price casing in days. Today a planned heist played a turn and abandoned keeps its casing,
    so repeating heists in a bank scouts it for free (decision 406).
  - **Deferred:** days (M6-01): a bank's intel only grows here; a rota or schedule that changes between days, a routine
    whose NPC isn't on today's roster and intel that goes stale are the campaign's to drop. The Guard rota's check-in
    times (the guards' radio check-ins shown in planning or the HUD); money that stays spent (an intel asset bought and the
    planning page reloaded is bought again; M6-03); the journal marking finds from earlier heists apart from today's;
    pruning old banks' intel from storage; the other §18.2 assets (as M4-07 lists them).
- [x] **M5-04 Generator content for the rules.** (partial: see Deferred)
  - **Work:** desk phones and their owners; the phone line; uniforms in the break room; keycards as items; the deposit-box intel box; a hook for placing side objectives (needed by M6).
  - **Missing interactables (found in M1-02):** the catalog has no desk phones or phone-line point (the line §9.1's calls go out on), and no vault wiring box; `worldFromBank` derives no objects for them until they are props.
  - **Done:** four new props, each with a catalog entry and four hand-drawn facings (`/?scene=props`): the `deskPhone`
    (on every clerk's workstation, both desks of a desk pair and the manager's desk, `src/gen/activities.ts`), the
    `phoneLine` junction box (alarm closet), the `uniformRack` (break rooms; a small one already full keeps its lockers
    as the uniform source; kept at 1.55m on purpose, under the sight cutoff) and the vault sensors' `wiringBox` (antechamber, clear of the vault door); the rack
    and the wiring box go in last, so their rooms roll as before. `validate.ts` checks the last three are reachable. `worldFromBank` makes them objects; a desk
    phone's owner is the person whose post is beside it (decision 360). Rules (`src/sim/rules/phones.ts`):
    `ringPhone` (decisions 361, 368) and cutting the phone line (decision 362). The uniform rail is a source of staff
    uniforms as the lockers are. The manager's keycard lies in his desk drawer during lunch when the generator's
    `keycard-drawer` opportunity says so (`rules/actions/keycards.ts`, decision 364). One deposit box holds the intel
    (`loot.intel`, `State.intelFound`, decision 363). `GenerateOptions.objectives` places side objectives
    (`src/gen/objectives.ts`, decision 365). The sensors are cut at the wiring box (decision 366). Review fixes: decision 368. The action grid offers
    Ring phone (cycling through the phones as Loop feed does cameras), Cut phone line and Take keycard.
  - **Tests:** `tests/sim/phones.test.ts`, `tests/objectives.test.ts`, the M5-04 case in `tests/sim/fromBank.test.ts`.
    The pinned M1 bank `31-2` and every generated bank change (phones on the desks, the new props, the furnishing that
    follows them; in `31-2` the roof hatch moves along the closet wall): the visual baselines are updated, and the M1
    recording (e2e/m1Run.ts) still plays unchanged. Save shape hash `90db9eea5c64824a`.
  - **Deferred:** the Cut phone line and Staff uniforms planning assets (§18.2: the plan's shape and the planner UI);
    what the intel tells and the drawer card's discovery (done in M5-02); counting side objectives at the debrief and placing
    them from contracts (M6-02); a landline caller turning to a mobile on a dead line; the owner answering in an
    animation of their own (they walk as an investigator, status Investigating); a phone picker on the map (the grid
    cycles); the security chief's absence and the other finale effects (M6/M7).
- [x] **M5-05 Playability bot (stretch).** (partial: it gets through 41% of the sweep's banks with the Blueprints and 8%
  without since the way back, decision 462; not a validation gate, decision 423)
  - **Work:** a scripted Clean infiltrator that must reach the alarm closet unexposed on N seeds, run in the sweep.
  - **Done:** `src/game/bot.ts` (`playBot`, decisions 420–424): a player, not a walker. It plays a planned heist's real
    start (`heistFromSetup`: Jun alone on foot by the van, Clean, the lockpick and the hacking kit) through the real
    commands (Move, Dash, End turn, open, pick, hack, the noisemaker), on what the crew knows (the safe floor, the
    previews, the tiles and doors as known), from the van to the alarm closet or the CCTV room; with `intel` the heist
    buys the Blueprints (§18.2, M5-03's asset). `npm run sweep` plays it in every bank and prints its success rate per
    tier × archetype (`SWEEP_BOT=blueprints|cold|both|off`) and why it failed where it did.
  - **Tests:** `tests/game/bot.test.ts`: the start, the pinned M1 bank `31-2` and three more banks with the Blueprints,
    one without, and that it plays the same every time.
  - **Deferred:** a stronger bot (a crew of two, casing from the public floor, a disguise, knocking out a lone
    watcher, the Guard rota, intel from earlier heists in the bank). The design questions of decision 424 are settled
    by decisions 460 (green and unseen walkers: the caveat stands, said in words) and 461 (the way back).

### M6: Campaign

- [x] **M6-01** Campaign state and save; days; the Squeeze, its thresholds and complications (§19.2). Pure, in `src/campaign/`. (partial: see Deferred)
  Must price casing (M5-03, decision 406): a heist abandoned after a turn keeps its intel for free today.
  - **Done:** decisions 440–446. `src/campaign/` (`campaign.ts`: `Campaign`, `commitCampaign`, `campaignRefusal`,
    `timeline`, intel by the day; `squeeze.ts`: the thresholds, the Raid, the gains; `complications.ts`: the pool and its
    seeded draw). `src/game/campaign.ts`: the save (`CAMPAIGN_KEY`, `CAMPAIGN_FORMAT`, `campaignProblem`), `campaignAct`,
    `campaignIntel`, `campaignKeeper`. The Session takes `keepIntel`; `startHeist` tags a campaign heist
    (`savedHeist().campaign`); `?campaign` (`src/ui/campaign/CampaignPage.ts`), `?plan&campaign` and its heist in
    `src/boot.ts`; `askPlayer` moved to `src/ui/askPlayer.ts`. Casing is paid: a heist spends its day as it starts.
  - **Tests:** `tests/campaign/campaign.test.ts` (thresholds and their days, complications drawn and landed, the false
    tip, days, failed and abandoned jobs, the Raid and the phases, intel ageing); `tests/game/campaign.test.ts` (the save's
    round trip and refusals, a campaign heist paying its day, its intel kept in the campaign only, a sandbox heist and an
    old day's heist sending nothing, a failure counted once); `e2e/campaign.spec.ts` (start, lay low, plan and play a
    heist that spends its day, New heist back to the campaign; `screenshots/campaign.png`). No sim state change: the save
    shape hash is unchanged; no visual baseline changed.
  - **Deferred:** what the complications, the Raid and the finale do (M7); difficulty's Squeeze per day (×0.75, ×1.25:
    M6-07); Notoriety's and a talking prisoner's Squeeze wired from the roster (M6-04; the rules' `squeeze` command
    takes them) and the false tip from its side job (M6-02); the case day action's visit mode (M6-07; the rules spend
    the day and take what it learns); contracts and their banks (M6-02: the campaign plans the pinned bank); money
    (done in M6-03, decisions 480–487: the campaign's planning screen spends the campaign's money, and an intel asset
    bought there is paid at once and kept); the city map and its timeline (M6-06); a
    routine seen again in a heist renewing its date (decision 442 is strict); a population that changes between days
    (the bank's people are its seed's; intel drops day-bound parts all the same); the sandbox's free casing (decision
    406, no clock there).
- [ ] **M6-02** Contracts by stakes; chain escalation; side objectives placed through M5-04 (§19.3, §19.5).
- [x] **M6-03** Money, laundering, the fence, crew shares, the black market and contacts (§19.4). **∥** M6-02. (partial: see Deferred)
  - **Done:** decisions 480–487. `src/campaign/money.ts` (the laundering rate, fronts, the fence's cut, the starting
    cash, shares and kit, stakes by tier, the black market's prices); `src/campaign/campaign.ts`: `Campaign.money`
    (clean, dirty), `fronts`, `contacts`, `armoury`, `shares`; the visit's `job` and `payout`; commands `buyIntel`,
    `buy`, `buyFront`, `fence`, and `heist` / `heistOver` carrying the job, its cost, its take and the gear kept;
    `fenceCut`, `launderPerDay`, `favoursToday`. `src/game/campaign.ts`: the save at format 2 with the new fields'
    checks, `campaignPurse`, `campaignJob`, `buyCampaignIntel`, `gearKept`, the keeper sending the take and the gear.
    `src/game/plan.ts`: `Purse` (`SANDBOX_PURSE`), `setupProblems` and `setupFromAddress` within a purse (cash, favours
    left, the armoury), `gearOf`, `fitArmoury`. The planner takes `PlannerFunds` (`?plan&campaign`); `?campaign` shows
    the money, the fence, fronts and the armoury with the black market.
  - **Tests:** `tests/campaign/money.test.ts` (the starting money and kit, a heist paying its assets and taking its
    gear, refusals beyond the money, the armoury or the crew, the take once less the shares, the gear back capped by what
    went in, failure and abandoning losing the gear, the Raid stopping a heist spending nothing, laundering with fronts,
    the fence and the nervous fence, the market, contacts, intel bought, its favours and its ageing);
    `tests/game/campaign.test.ts` (the save's new checks and format 2, the purse in planning and from the address, intel
    bought saved and known on reload, a heist's gear out as it starts and lost when abandoned, the take and gear through
    the keeper counted once, a start refused when the money is gone); `e2e/campaign.spec.ts` (the readout's money and a
    purchase, the Guard rota paid on the campaign's planning screen and still paid after a reload;
    `screenshots/campaign-money.png`). No sim state change; no visual baseline changed.
  - **Deferred:** the roster's own shares and signing fees (M6-04: the sandbox roster's four with fixed shares until
    then); the contract's bonus and payout ranges, and stakes from contracts rather than the bank's tier (M6-02: any
    bank the address names can be the campaign's heist, its tier its stakes); style bonuses in the payout (M6-05, §19.8);
    finale purchases unlocked by contacts and contacts from motives and styles (M7, M6-04, M6-05); selling gear back;
    the items §19.4 doesn't price (the taser, suppressed guns, smoke, noisemaker, tripwire, jammer, glass cutter,
    reinforcement kit) are not on sale; the black market as part of the city map (M6-06); a partial amount at the fence
    from the page (the rules take any amount; the page fences it all); gear lost per crew member on a success
    (what escapes comes back, nothing else is tracked: an arrested crew member's kit is gone, not held as evidence).
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
- **The generator and the rules disagreeing about sight.** M1-02 shares the tile properties and M5-01 moved validation onto the rules' vision.
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
10. **Lit.** A room is lit unless its light is `none` and it is indoors; outdoors is lit by day. A power cut darkens the building (M4-03, decision 241), and the baked lamps are not a rules input. Darkness is judged by the *seen* tile: an unlit tile is seen only within half of each range (rounded down), so a guard in a dark room still sees the lit lobby.
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
    command), so stepping back inside doesn't shrink the next wave. M3-08 counts the getaway instead (decision 176). Each kind's count is scaled and rounded half up;
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

130. **The phones (M3-07, §13.4).** The negotiator calls in every crew phase of Negotiate while the negotiator is out on
    scene, one answer a crew phase. The bank's lines ring on every desk, and phones aren't props yet, so any crew
    member inside the building can answer (1 action).
131. **Release (M3-07, §10.7, §13.2).** An offer on the phone: any hostage the crew holds (Commanded or tied, on the
    map, not stashed), however far from the phone. The heat falls at once by the capped relief (what the offer shows);
    the hostage gets up, no longer led or held, and walks (4 tiles a phase) to the nearest way out, its path the intent,
    and leaves there. Once police are on scene they control every exit. The hard cap stands (Q17): one a turn (one
    answer a turn anyway), three a heist; a release past the cap isn't offered at all.
132. **On the way out (M3-07).** A hostage walking out can't be taken again: it ignores commands and can't be knocked
    out (so nor tied): `knockOut` itself refuses it, whatever the path, and a taser dart in it is spent. Wounded, it crawls out and still leaves. It still counts as a hostage if killed (+5), and
    reaching the police is no escape (+1). As it leaves the map it tells the police each crew member it saw, where and
    when it last saw them (`reports`, for M3-05).
133. **Trade (M3-07, §10.7).** A hostage for a crew member in custody: the hostage walks out as for a release but takes
    no heat off and counts toward neither cap (it buys the crew member, not time). The member is handed back on the free
    tile nearest that way out as the crew phase after the hostage reaches the police begins ("release a hostage to get
    back"); until then they stay in `State.custody`, off the map. A hostage killed or downed on the way calls it off
    (`tradeOff`): the member stays in custody and can be traded for again. They come back as they were taken: a downed
    one still down (its bleed-out clock stood while away), with no actions.
134. **Stall and Hang up (M3-07, §13.4).** Stall adds 2 world phases to Negotiate's count, once a heist; Hang up only
    spends the action. An unanswered call has no consequence.
140. **Hit points (M3-03, §7.1, §12.3).** Crew 8 (`rules.crewHp`); NPCs by role (`NPC_HP`: guards and couriers 5, the
    security chief 6, police 6/7/12 for M3-05), an armed civilian (the off-duty cop) 5, anyone else 3. Every attack's
    damage reaches them through `dealHarm`'s `wounds` handler; harm of 0 changes nothing.
141. **Hurt (M3-03, §11.12).** Half the crew member's hit points or less while up. Limp: a Move's budget −1 tile, a
    Dash's −2 (one per move action). Aim ×1.25 (not with Cool Head), folded into the shot's `aimFactor` by the attack
    and the Watch volley, so `attackCone`, the commit and a replay of `State.shots` agree. Blood: one `blood` item
    (major evidence, §8.10) on the tile where they become Hurt or go down and on every tile they walk onto, never two
    on a tile.
142. **Bleeding (M3-03, §11.12).** In the world phase's devices step (as a timer), each world phase a crew member spends
    Hurt, up and unbandaged counts toward the next HP lost: −1 at every 2nd. A medkit's bandage stops it until the next
    harm. Bleeding to 0 downs them.
143. **Downed (M3-03, §11.12).** At 0 HP: no actions now or in later crew phases, the body or hostage let go of, the lean,
    Watch, brace and aim ended. They bleed out over 3 world phases counted from the first world phase after the one
    they went down in (so one downed in a crew phase dies as that turn's world phase + 2 ends), then are dead for good
    (`crewDied`; they stay where they lie). Further harm on someone down does nothing more.
144. **Revive and medkits (M3-03, §6.3, §12.2, §7.2).** Revive: 1 action, a downed teammate in reach, up with 3 HP (Medic
    6), still Hurt and bleeding. Medkit: 1 action, one of 2 uses per kit carried, on a teammate in reach or oneself:
    a downed one is revived with 4 HP (Medic 6), anyone else up heals 4 (Medic 6) up to full; either way bandaged. A
    revived crew member gets their actions back with the next crew phase. Neither rolls: their previews are the commit.
145. **NPC death (M3-03, §11.12).** Lethal harm (every bullet and blow) to 0 HP kills: status `dead`, intent, goal,
    route, search, lapse, panic and lean dropped, as a knockout does; a hostage led by the arm becomes a body in hand.
    Heat counts the kill off the state (decision 121). Non-lethal harm at 0 would leave 1 HP (nothing deals it yet).
146. **Screams (M3-03, §11.12).** A wounded NPC (alive, half its hit points or less, on the map and not out cold)
    screams once per world phase in the devices step: the loud noise `scream` (radius 6) from its tile, heard at once,
    so hearers react before the intents are committed and the crew phase shows what they will do (Alerted, as by any
    loud noise; the scream itself doesn't make the bank Loud).
147. **Crawling (M3-03, §11.12).** A wounded NPC that decides for itself and isn't Hostile has the goal `crawl`, ahead of
    a lapse's run, panic and anything it wants (its badge Alerted, not Panicked): a 1-tile walk (a diagonal one allowed) toward the nearest way out, committed and
    shown as any intent. It is Alerted. Hostile ones fight on (M3-05, M3-06). It doesn't leave the map yet.
148. **Arrest (M3-03, §11.12).** In the devices step after the director, a downed crew member with an officer in reach
    (patrol, SWAT, shield or heavy SWAT: not the negotiator or a sniper) who was already on foot before this world
    phase (got out in an earlier one, so the crew saw it standing there for a crew phase) is arrested: taken out of
    `State.crew` into `State.custody` (with the unit and the turn), and every reference to them is taken out of the
    NPCs and the state (`forgetCrew`: suspicion, exposure, last seen, frisks, warnings, challenges, wants, reports,
    camera reports, intent actions and goals aimed at them, a lapse, panic or suppression of theirs; a command they
    gave passes to the first crew member left), so no rule looks for them on the map. Auto-advance stops on any
    wound, downing, bleeding out, death or arrest (`wound`). Police don't walk to them before M3-05.

150. **Officers are bodies (M3-05, §12.3).** Not NPCs (decision 122), but shooters, targets and leaners in the shot
    rules: hit points, armour and gun by kind (`OFFICER_STATS`: patrol 6/1/pistol, SWAT 7/2/AR, shield 7/2/pistol,
    heavy 12/3/LMG, sniper 6/1/DMR, the negotiator 6/1 and unarmed). Their harm goes through `dealHarm` (handler
    `police`): any hit that lands is `policeHit`, 0 HP is `policeDown` (killed). A shot aimed at an officer, or a
    Suppress wedge holding one, ends Negotiate whether it hits or not (`policeShotAt`, §13.4 "shooting police"; decision
    126's "a miss is not a hit" now only names the `policeHit` event), and its muzzle flash tells the police where the
    shooter is. The crew's Watch, Suppress and reaction shots treat officers as Hostile NPCs; a strike or a dart on one
    is deferred. The crew knows of an officer only while it sees its tile this turn (`officerSeen`): the grid, the crew's
    shot preview (`crewPicture`), a move's plan (it bumps into a hidden one) and the events told (`projectEvents`, with
    `shooter` and `unit` among the fields naming someone) go through it; remembered and predicted officer markers are
    M3-09's.
151. **Combat sight (M3-05, §13.6).** An officer, or a Hostile NPC, sees all round to `COMBAT_SIGHT` (10) tiles in line
    of sight (smoke blocks, the dark doesn't). It takes a crew member for a target once masked or already known to it
    (the police's shared picture; a guard's exposure or last sighting): an unmasked stranger is left alone.
152. **What the police know (M3-05, §13.6).** One picture over the radio (`PoliceState.known`: a tile, a turn, down or
    not, by crew member): each officer's sight as it acts, before and after moving, and the reports of hostages let go
    or freed and of escapees after the Alarm (`NegotiationState.reports`), newer over older. A known tile an officer sees
    with nobody there is marked gone as of then (`tile` null), so no older report brings it back; an arrested crew
    member is forgotten. Guards keep their own `lastSeen`.
153. **The routine and the modes (M3-05, §13.4, §13.6).** In the combat step Hostile NPCs act in resolution order, then
    officers in the order they came; each decides as it acts. Hurt (half its hit points), it falls back to the nearest
    tile out of sight of every crew position it knows. In Negotiate officers hold fire and position; in Contain and
    Regroup they fire from where they stand; in Assault they move up to `officerMoveTiles` (4) and fire, or with nobody
    in sight advance on the nearest known downed crew member, else the nearest known position, the shortest way. Guards
    fight whatever the mode, at a hurry (5 tiles), reload as their act, and pass doors as in peace. SWAT kinds run this
    routine until M3-06; snipers and the negotiator don't act yet. At Heat 1–2 Assault pushes in through open or unlocked
    doors (§13.4, read over §13.6's "hold the exits at Heat 1").
154. **Never through a standing non-crew body (M3-05, §13.5, §10.7).** A fighter fires only a shot whose preview
    (`previewShot`: every bullet's arc, through people and through what the shot can break) meets the crew alone
    (`cleanShot`): no bystander, no hostage held up as a shield, no other officer; lying people are passed over unless
    aimed at. It picks its tile among those in its move, cover against the target first, then nearest, then row order,
    previewing at most 24 shots in all (each tile and each lean from it with a line of fire); asks again as the bullets
    leave, of a target still up; with none, `heldFire` with the reason nearest to firing (out of range, no line of fire,
    no shot the rules allow, someone in the way). With 8 officers in Assault among bystanders a world phase took 60 ms
    before counting leans toward the 24 and 47 ms after (this sandbox).
155. **Fighters' shots (M3-05, §11.2, §11.9).** Through `resolveShot`, every bullet of its gun (a guard's no more than
    its magazine; officers have rounds to spare), the moving penalty after moving, Aim ×1.5 Suppressed; the weapon's
    noise (Loud). `Dice.pictured` before the bullets, so a preview of the world phase (`pendingCarriers`) stops there, as
    at a crew Watch volley.
156. **Freeing hostages (M3-05, §10.10).** An officer ending its act beside a Commanded hostage frees it for free (every
    one), and with no shot fired cuts one tied hostage loose; not one led by the crew, nor one a Hold keeps this phase
    (§10.3). Freed, it walks out (as a release, to the nearest way out: the police hold every exit, decision 131), its
    leaving is an escape (+1) and it tells. Officers free only those they reach on their way (SWAT pairs, M3-06).
157. **Walking up to arrest (M3-05, §11.12).** Officers advance on a downed crew member they know of; the arrest
    (decision 148) needs one that hasn't walked this world phase (`PoliceUnit.moved`), so a crew phase shows it
    standing there first.
158. **Breaches (M3-05, §13.4, §13.6).** From Heat 3, in Assault, an officer whose shortest way runs through a locked door
    stops beside it and announces the breach (`State.police.breaches`, one per door), which the crew phase shows (the
    ledger: "Breach next phase", 1); in the next world phase it blows the door (breached, the breach charge's noise) as
    its act. Its officer down, or Assault over, the breach is called off at once (`policeDown`, `startMode`): every
    marker is carried out or called off. Doors only: windows, walls, barricades and charges as kit are M3-06's.
159. **Watch on fighters (M3-05, §11.8).** Every step a fighter takes and every act (firing, breaching, freeing a
    hostage, a guard's reload) goes through `watchReact` before it resolves: a crew Watch wedge holding the fighter fires
    first, and a fighter downed by it doesn't act. One that neither moves nor acts draws nothing.
160. **Departures (M3-05).** Officers in Contain and Regroup hold their tiles (§13.4's "take cover" and "pull back" are
    left to M3-06's planning); freeing a hostage needs no move toward it (an officer frees what it ends beside); there
    are no barks yet (§13.5, the HUD's, M3-09).
161. **Hard promises (M3-05, §13.6).** Nothing a fighter does is previewed but the breaches, announced a phase ahead and
    carried out as shown; a Hostile NPC fires only after its telegraphed draw; officers are on the map from their
    announced arrival. Movement and targets are decided as each acts, from what it knows then.
170. **The van in the rules (M3-08, §14.4, §15.4).** The generator's van is `World.vehicles`, not furniture: the tiles
    under it are street, so it can drive away. Its footprint is the 2×4 of §14.4, the tiles its box stands in the way
    on where it was parked, its heading the way its nose points. Where it stands now it blocks every step, sight and
    bullets (full cover, §14.4), as the parked van did as full-height furniture. Nothing is thrown onto it.
171. **Manoeuvres (M3-08, §14.4).** A Drive is a path of manoeuvres: 1 tile forward or back (1 tile of path), a drift of 2
    along and 1 across (2), a quarter turn forward or in reverse, left or right (3: the middle follows a quarter circle
    of radius 2, π rounded to whole tiles). A half turn is two quarter turns and ends beside the start, 2 tiles clear,
    facing back. A turn sweeps every tile the body covers on the way, sampled every 3° from a whole-number table, 16
    points a tile, worked out once and turned onto every heading; a reverse turn sweeps what the forward turn back does.
    Reach is Dijkstra over poses with fixed tie-breaks, so the overlay, the preview and the commit share one path.
172. **People in the way (M3-08, §14.4).** Nobody is driven over: anyone standing or lying on a tile blocks it, and the
    path goes round them. Hitting people (6 damage) comes with ramming (M4-04), whose damage rules it shares.
173. **Off the plot (M3-08, §14.4, §15.4).** §14.4 has the driver drive off "a plot edge"; the generator's plot is
    bounded north and south by building fronts and pavements, and its roads run off its west and east edges. So a
    vehicle leaves past the west or east edge on any row whose edge tile is drivable: the main street and the alley
    (the generator's four plot exits), and the pavements, lots or open ground beside them where those reach the edge.
    Not past the north or south edge. A pose with a tile off the map has left the plot and ends the path.
174. **Aboard (M3-08, §14.4).** Getting in (1 action, from a tile a door opens onto: the sliding door on the right, the
    rear doors) is seen as ending an action at the door; getting out is seen where they step. Aboard, the doors are
    shut: nobody sees them, nobody shoots them, they block nobody, and they act only through the vehicle (getting out,
    driving). Nobody reaches them either: `inReach` is false into or out of a vehicle's footprint, so no arrest, tackle,
    revive, pass or hand-off goes through the doors, and getting in drops what NPCs meant to do to them (`dropTargets`:
    challenges, wants, a tackle, goals and intent actions aimed at them; what they know of them stays). Driving is no
    illegal act and makes no noise in M3 (a parked vehicle is ignored, §14.4; the police's eyes on it are M3-05's).
175. **The contract's target (M3-08, §15.1).** By tier until the campaign's contracts (M6): $75k for a small branch,
    $150k for a city branch (§3), $200k for a headquarters.
176. **Greed counts the getaway (M3-08, §13.3).** A bag is secured once it has been in a crew vehicle (in the hold, or
    carried by someone aboard), not when it leaves the building: "secured" is what the crew has got away with so far.
177. **The end (M3-08, §15.4, §15.5; widened by decisions 284 and 303).** A crew vehicle leaving takes those aboard away
    with what they carry and the hold. The heist then ends (rules/getaway.ts `heistOver`) when nobody up is left
    behind, or those left behind have no way out: no crew vehicle that can drive and no route off the plot on foot
    (decision 303); they are arrested, the dead stay dead. Never while someone is on a route out. Every crew member dead or in custody after
    any command is a Failure; a crew all down is played on until each is arrested or has bled out (§15.5 counts them
    out already, but the debrief then tells which, and nobody up can change it). Success needs the target in value (not ruined) and someone away; below it, Partial.
    The payout is the value that left until shares and style (M6). Once over, no command is given, End Turn included.
178. **The hold (M3-08, §14.4).** A bag or crate in the hands goes into the hold on getting in, or with Load the van (1
    action) from a door tile. Cash stays pocketed. Loot in the hold has the vehicle's id as its holder and stays there.
179. **The getaway's Drive on the grid (M3-08).** Until M3-09's overlay picks a pose by hand, the grid's Drive goes
    along the cheapest path off the plot (64 tiles ahead, on what the crew knows), as far as one Drive reaches: a pose
    on that path within the Drive's tiles has the same cost in the Drive's own reach, so the sim drives it. With no way
    off in sight it drives as near the west or east edge as one Drive gets.
180. **SWAT teams (M3-06, §13.6).** A SWAT van's units (a shield and three, or the heavy pair and two; a refill van's
    too) are a team named after the van (`PoliceUnit.team`, `PoliceState.teams`); the others run the routine. A team makes
    one plan a world phase, as its first member acts, after every member has looked (what any of them sees goes on the
    radio first); members still act one at a time in the officers' order, and decide their moves and shots as they act.
    Nothing of the plan is announced but its breaches.
181. **Fire and movement, focus and flanking (M3-06, §13.6).** In Assault half the team moves: members alternate by
    their order in the team and the turn's parity (a team of one moves alone); out of Assault nobody moves. The focus
    is kept until down or out of every member's sight, then chosen among the crew members seen by §13.6's priority:
    exposed (leaning, or without cover against a member who sees them) → Hurt → carrying something → the heaviest
    drawn weapon (`WEAPON_WEIGHT`) → nearest → by id. Members fire at the focus when they see it, else the nearest.
    A mover looks for its firing tile first where the target has no cover against it (flanking), then its own cover,
    then nearest; a coverer fires from where it stands.
182. **Police Watch wedges (M3-06, §13.6, §11.8).** A coverer with no clean shot, or nobody in sight, sets a wedge on
    its target's tile, else the focus's last known tile, else the nearest known (its gun's widest Watch arc, out to its
    range but no further than `COMBAT_SIGHT`, what the officer sees), held through the next crew phase. The first crew
    member it would take for the crew (masked or known, decision 151; not aboard a vehicle) to move in it (from a tile
    in it, stepping out included, or onto one) or to give any other command standing (or leaning) in it trips it,
    silently; its volley comes as the next world phase's combat step starts, before any fighter acts (after the
    grenades' fuses and the passive NPCs): half its gun's bullets rounded up, Aim ×1.5 (×1 at 15° or narrower), aimed
    at the tile where they tripped it with them put back there for the shot, through `cleanShot`, its report after
    the bullets as every fighter's.
    §11.8's volley interrupts the move; here it comes after it, so a crew move's preview (and whether it can be
    undone) is the same whether a hidden officer watches or not. Only wedges whose officer the crew sees are given
    out (`seenWedges`). They come down in Negotiate, and with their volley or the next world phase.
183. **Flashbangs (M3-06, §11.10, §13.6).** SWAT carry one each, the heavy none (`OFFICER_FLASHBANGS`). In Assault a
    member throws one on clustered crew (two or more the police saw this turn within its radius of one tile it sees in
    range) and its breacher through a door just blown; never where its blast would catch an officer or where a police
    one already lies. It lands with `policeGrenade` (told without its thrower, wherever thrown from) and goes off as the
    next world phase starts, so the crew has a crew phase to move out. Caught, a crew member loses their Watch and
    Brace (they are Surprised through the world phase it goes off in); an officer caught by a crew one loses that phase,
    its wedge and its lean, and a breach it announced is called off. Pushing characters out of their tile is gas's.
184. **Timed breaches (M3-06, §13.6).** A mover whose way runs through a locked door stops beside it and stacks
    (`SwatTeam.stack`); after everyone has acted the team announces its stacked doors together once two doors are
    stacked, a member has waited there a whole phase, or every member is stacked. Each is blown in the next world phase
    by its own officer, all in that phase, while the team holds (no movers); each breacher then throws a flashbang
    through (the nearest crew position it knows beyond the door, else two tiles in, else the tile beyond), so they go
    in after it has gone off.
185. **Casualties (M3-06, §13.6).** A member down (killed or otherwise off the force) makes the team pull back once:
    in its next plan, or at once for the members still to act when it went down in the world phase after the plan
    (which then answers it). Each member steps one tile, out of sight of the crew positions the police know if it can and never closer to
    them, then covers the nearest with a wedge; then the team re-plans. A downed officer leaves the map (decision 150),
    so nobody is dragged out.
186. **Hard promises (M3-06, §13.6).** Every police shot, the wedges' volleys included, goes through `cleanShot`; every
    police grenade lies through a crew phase before it goes off, and officers don't walk to a tile one will reach
    (routine.ts `underGrenades`); breaches are the only part of a plan shown ahead; every
    wedge, throw, shot and breach is an act a crew Watch answers first (decision 159).
190. **Looking out of the van (M3-08 review, §14.4).** The crew aboard sit in the cab (its front tile on the left) and
    face the way the van points; the van's other tiles block their sight, so they see out of the cab's windscreen and
    side windows only, not all round from a moving hide. Chosen over making the van visible to NPCs as it moves: it is
    the smaller rule, and §14.4 has a parked or moving vehicle ignored while nobody sees inside.
191. **The wheel (M3-08 review, §14.4).** After every command the seat stays with its holder while they are aboard and
    up; otherwise it goes to the first crew member aboard who is up, in crew order, or is free. A driver downed, dead,
    arrested or out frees it, and someone getting in takes a free one. An arrest also clears it (`forgetCrew`).
192. **Driving on what the crew knows (M3-08 review, §8.15).** A Drive is planned on the crew's picture: the crew, the
    NPCs it sees now (`markerKind` live), the officers it sees and the police vehicles are in the way; anyone else is
    taken to be absent, so no reach or route length tells of someone unseen. The drive then goes a manoeuvre at a time
    and stops before the first whose sweep meets someone (`driveCut`, final): the action is spent, the van stands where
    the path was and `driven` counts the tiles actually driven. The player's preview (`previewCertain`, through
    `registerCertainView`) drives it with everyone unknown on the plan's sweep set aside and put back after, so a drive
    into someone unseen previews exactly as the same drive with nobody there: its events, the van's pose, its undo.
193. **Police vehicles park clear of the van (M3-08 review, §13.4).** A police vehicle stops at its staging point, else
    on the nearest drivable tile to it (rings, row-major) nothing blocks and no crew vehicle or person stands on. A drive never counts
    anything on the vehicle's own footprint as in its way, so nothing there can shut it in.
200. **Wall charges (M4-01, §12.2, §14.2).** `placeCharge { crew, item, edge }`: 1 action, hands free, not aboard,
    from a tile beside the segment, the illegal act 'plantCharge'; a breach charge opens Glass and Soft, a shaped charge
    Reinforced and teller glass too (armoured, as for sound); never Vault, railings or fences. Not on a segment open
    already (an open or breached door, a gap) or one with a charge on it. Allowed in stealth: it lies one crew phase,
    so the scene draws no safe floor while one lies (decision 101's rule), and the end-of-turn preview shows the blast.
    Each kit carries 2 breach charges, 1 shaped charge (`CrewState.charges`); the last one takes the item off them.
201. **The blast (M4-01).** Goes off in the world phase's `fuses` step after the grenades, before anyone acts. A door on
    the segment is breached (one door over several segments goes with it); any other wall gets a gap: `State.edges`
    `{ blocksMove, blocksSight, blocksSound, midHeight: false, gap: true }`, so movement, sight, sound, bullets
    (`BulletEdge.open`) and the NPCs' paths pass it, and the evidence source tells it as a hole. The **far side** is the
    tile across and its two neighbours along the wall (each unless a sight-blocking wall stands between it and the tile
    across): everyone on foot there (crew, NPCs and bodies, officers) takes the charge's damage (4; shaped 6), lethal,
    through `dealHarm` ('blast'). The near side is spared (charges are shaped to blow outwards). A loud noise (14;
    shaped 18) where it was set; the bank goes Loud.
202. **Loot lost (M4-01, §14.2).** "Within 1 tile" is both sides' strips of three tiles: loot there nobody holds (where
    the bank keeps it, or dropped; not in a hand, a pocket or a hold) is destroyed (`ruined`). `chargeBlast` decides
    it, as the fuse does, and the preview draws it (a red cross per piece) for the charge previewed and every charge
    lying, recomputed each refresh, so picking a bag up before the world phase takes its cross away. Loot on hidden
    tiles is neither drawn nor told.
203. **Debris (M4-01).** Only a shaped charge (§12.2's table, the more specific) opening a wall (not a door) leaves debris.
    This departs from §14.2's wording ("explosions … leave debris"), which would give every charge debris. It falls on
    the tile across, unless something stands there already (furniture, cover, a flipped table, debris, a vehicle): half cover
    nothing shoots away (`INDESTRUCTIBLE` in the fabric); it doesn't block movement.
204. **Tripwires (M4-01).** A combat tool as grenades are (decision 101): laid only once Loud, 1 action, hands free, on
    their own tile or a neighbour they could step to, 'plantCharge'; 2 per kit. They go off when an NPC or an officer
    steps on the tile, at that moment (a passive walker as it walks, those after it still where they stood; one
    entering the map onto it; a fighter before the Watch reactions). A walker it fells lies there and walks no further
    (its frisk or telling, judged on where its walk would end, is dropped; a walker felled before its turn doesn't
    walk); one it doesn't fell walks on, so no two people ever end on one tile (bodies lie, which stops no walk). 6 damage, lethal, to everyone within radius 1 (Euclidean) the tile sees, the crew included; a loud
    noise of 14. Police spotting and disarming them is deferred.
205. **Thermite scorches (M4-01, §12.2).** Every world phase thermite burns at the vault door, loot lying in the strips
    either side of each of the door's segments is scorched (`lootDestroyed` 'thermite'); its preview, and a burning
    charge, show the crosses. Fire on the tile is deferred.
206. **Steps (M4-01).** `src/sim/rules/steps.ts` is a registry of what stepping on a tile sets off (`registerStepHook`),
    so the walks (rules/npc/act.ts, rules/routine.ts) call it without importing charges.ts, which reaches most of the
    rules (an import cycle otherwise).
207. **Gap art (M4-01).** A gap is the segment's own bitmap at each cut step with a ragged hole from the floor to its top
    (stubs of 1–3 pixels, their torn columns darker) and rubble of its material on its footprint; a north-south segment
    loses the middle of its section. So it follows the wall's real thickness and its cut height. A breached door shows
    as an open door, as police breaches do. Debris is a low heap of the wall's material on the tile across. A gap is a
    hole: nothing is barricaded, reinforced or blinded on it (`fortifyBlocked`), and blowing a reinforced wall or door
    takes its reinforcing (`reinforced`, the `material` override) with it.
208. **Charges together (M4-01 review).** Charges lying go off in the order they were set, each on the bank as the
    ones before left it: an earlier gap can widen a later strip, loot an earlier blast took isn't counted again, debris
    can fall only once on a tile. The overlay draws every charge lying, and the one previewed after them, through the
    same order (`blastsInOrder`: each blast and its fabric change, `openUp`, played on a copy). Not foreseen: a bag
    a crew member drops as an earlier blast downs them, which a later blast can then destroy (rare; deferred).

220. **Barricades are abstract furniture (M4-02, §14.3).** "Furniture is everywhere": a barricade takes 1 action and
    nothing from the floor (no desk leaves its tile, no count). It goes on a shut door (closed or locked; not the
    vault's, a jammed or a blown one: a door must be closed first) or a window (glass that isn't a door), from either
    tile beside it, with hands free; Clear takes it down the same way. It lives on the edge (`EdgeProps.barricade`, its
    hit points), so every rule that reads walls through `edgeNow` sees it.
221. **What a barricade stops (M4-02, §14.3, §11.4).** It blocks movement and sight whatever the door behind does
    (`edgeNow`), so nobody walks through it, an escapee's way is blocked and the door can't be opened, picked or
    hacked. Bullets: it is half cover for the tiles either side, as a railing (`BulletEdge.halfCover`); what it stands
    in (the door's wood, the pane) still slows, stops or shatters as before. Its hit points count only against the
    police (§13.5), not bullets.
222. **Reinforcing (M4-02, §14.3).** 2 actions and one of a kit's 2 uses (`CrewState.reinforcements`), on a Soft wall
    or a shut Soft door: its material becomes Reinforced (`EdgeProps.material`, `reinforced`), so bullets stop and sound
    doesn't carry, through a wall (§8.9) and through a door alike: plated and barred, a door stops sound as the wall
    beside it would (geo/sound.ts; a steel door the bank built still costs a closed door's 3). A reinforced door is
    barred shut for everyone: reinforcing an unlocked door would otherwise stop nobody. The bar goes on the side the
    crew member stands on (`EdgeProps.barredFrom`), and from there only Unbar (1 action) lifts it again, the kit's use
    spent: the crew can't trap itself, and nobody outside lifts it. From the far side a crew shaped charge (M4-01, which
    clears the edge's fortifications) is the way through; no warning is needed, since the side that barred it can always
    unbar it. Only heavy SWAT open it from outside (§14.3 "only
    shaped charges or heavy SWAT"), by a breach that takes the reinforcement with the door. A wall's can't be undone.
223. **Police break barricades as they breach (M4-02, §13.5, §13.6).** From Heat 3 in Assault an officer plans through
    a door barred by what it can break (`canBreak`: any officer a barricade, only heavy SWAT a reinforced door, a
    barricade on one first by anyone), stops beside it and announces as for a locked door (a SWAT team stacks there).
    The due act, a Watch answered first, strikes a barricade for one hit point (`barricadeStruck`) and, while some are
    left, announces the next strike at once: every strike stands announced through a crew phase. The last strike
    breaks the door with it (breached, the lock and the crew's reinforcement too when heavy SWAT strike it; a reinforced
    door struck by anyone else stays barred), so it is the one announced breach. While a strike or a breach stands
    announced at a door, the crew can't barricade, clear or reinforce it: what is announced happens. Together these
    make a barricade cost the police 2 phases once, never more: no clearing and re-barricading resets it, and a broken
    door takes none again (review of 90b355a: 5 actions had held an officer for 15 phases). The ledger reads "Barricade
    struck next phase" on a barricaded door, and "Breach next phase" for a last strike that will break it.
224. **Blinds (M4-02, §14.3).** Down on a window (1 action, no noise, no suspicion: staff lower blinds too) the pane
    blocks sight both ways, so the patrol car's drive-by sees nothing through it (`patrolSightings` reads sight); up
    again the same. Only a window has them, glass doors and the teller glass not.
225. **Fortifying seen in stealth (M4-02, §11.4).** Barricading, clearing a barricade, reinforcing and unbarring make a quiet noise of 4 (`barricade`,
    `reinforce`) and cost what a table flip costs (`FLIP_PIPS`) with everyone who sees the crew member while the bank
    is quiet, judged before the barricade goes up (it would hide them in a window).
226. **Drawn as markers (M4-02).** Fortifications are drawn in the world overlay (planks with a pip per hit point
    left, slats, a riveted bar), in stealth too, not as props in the bank: hand-drawn furniture against doors in four
    facings is deferred with pushing real furniture (decision 220). The crew made each, so showing them tells nothing.
240. **The grid (M4-03, §8.13, §14.6).** `State.power` (`core/power.ts`, so sight, cameras and doors in `geo` can read
    it): powered while the mains breaker is on or the generator runs. `interact … cut` at the `breakerPanel` (1 action,
    the illegal act 'hack', no noise) cuts the mains; the generator starts by itself as the crew phase
    `cutAt + rules.generatorPhases` (3) begins (`power.generator`, a crew-phase hook), so the dark lasts three world
    phases and the crew phases between. The recap says only "Lights out": when (or whether) a generator starts isn't
    told, since the crew may not know of one. `interact … disable` at the `generator`
    (1 action, 'hack') disables it for good: the next cut lasts, a running one stops. `interact … reset` (1 action, not
    illegal) turns the mains back on and stands the generator by. A bank without a generator has no backup. Nothing
    rolls a die.
241. **Dark (M4-03, §8.3, §14.6).** With the power out every tile of the bank's building (`World.building`; every tile
    of a world without one) is unlit (`litNow`, the sight map's `lit`, `sightInputs` gains `|dark`): sight onto it is
    halved, as for rooms without lamps; outdoors and next door stay lit. The safe floor's unknown watchers read the same
    `lit` (and no unknown camera sees anything), and combat sight (`seesTile`) is halved onto a dark tile, so the police
    see half as far too.
242. **Maglocks (M4-03, §14.6).** A card or maglock door with no Secure side is a staff door and fails safe: with the
    power out a locked one reads closed (`doorStatus`, `lockReleased`), anyone walks through, and it can't be locked
    ("The maglock has no power"); the power back, it holds again. A door with a Secure side fails secure: it stays
    locked, its reader on the security circuit's battery like the alarm panel's, so cards and hacking work as before.
243. **Cameras (M4-03, §14.6).** Every camera is off with the power out, whatever its tier (`cameraObserver` is null):
    no reports, footage or lookout; they don't pan; the mantrap's looped reader isn't watched; the crew sees them `off`
    (a cut is plain to see). They aren't `cameraDown` evidence: lights out is the evidence.
244. **The console goes dark (M4-03, §15.2).** `vaultShut` refuses with the power out ("The console is dark"), so no
    code (the crew's or a coerced key-holder's) and no Three Keys card; the sensors' wiring can still be cut.
245. **Lights out (M4-03, §8.13).** Minor evidence bank-wide: `lightsOut:<lastOut>` at the breaker, with
    `Evidence.everywhere`, is noticed by every staff member and guard in the building in the next world phase, seen or
    not; the investigator (a guard first, `pickInvestigator`) walks to the breaker, which the intent shows, and the
    others look its way. Each outage is its own. `PowerState.lastOut` records the turn the lights went out as they do,
    and is kept: the evidence lasts while the power is out and through the world phase of the turn it went out, so a
    cut restored in the same crew phase is noticed all the same (its free phase of dark cameras and open maglocks costs
    the evidence); once the power is back after that, it is forgotten.
246. **The dark drawn (M4-03, decision Q10).** Not a rebake (floor, walls, props and people take about 0.6 s at load):
    `PowerCut` (scenes/bank/power.ts) works out what the powered lamps (`bankLamps`' `electric`: ceiling lamps and the
    props' lights, not the exit signs on their battery) gave with the bake's own formula for a floor facing up, and
    multiplies it away: a shade over the building's floor (under the sun's shafts), a tint on each prop and wall
    segment for where it stands, people relit without the lamps (`Baker.off`), powered glows put out; all under a cool
    emergency cast. Made the first time the power goes out (`debugState.timings['power cut']`, about 70 ms on the dev
    server here) and kept; with the power on nothing is drawn differently.
247. **Seen before the dark, and for good (M4-03 review).** Cutting the power (and disabling the generator) is
    witnessed on the world it began in (`InteractionVerb.witnessBefore`, the action's `illegal.before`: judged before
    `run`, applied after), so a teller or camera beyond half range of the breaker still sees it. Cutting, restoring and
    disabling, and the power going out or coming back, block undo: they change the whole bank. Combat sight
    (`seesTile`) is halved onto every unlit tile, a room without lamps as much as a power cut (§8.3 "Darkness (power
    cut, unlit rooms) halves all vision ranges", §14.6 "police included"), so M3's police and fighters see half as far
    into a dark room; tested in `tests/sim/power.test.ts`.

260. **The noisemaker sounds as it lands (M4-06, §8.13, §12.2).** Thrown (1 action, hands free, up to 6 tiles
    Euclidean to a tile the thrower sees, as a grenade) it makes its quiet noise of 3 at once, in the crew phase: no
    fuse, so it is legal in stealth (decision 101 kept grenades out of stealth for their fuse) and the noise ring and
    ears the preview shows are the outcome, by the same `hearing`. "Timed" is the lure's length (decision 261), not a
    delay; a phone alarm set to ring later is deferred.
261. **The lure lasts as a quiet noise does (M4-06, §8.13 "investigates it for 2 phases, then goes back").** The one sent
    (the nearest of the right role, `pickInvestigator`) walks to the landing tile at the hurried pace in the next
    world phase and goes back to its routine once beside it (rules/evidence.ts `evidence.settle`), or after
    `rules.evidencePhases` (3) at the latest: in a radius of 3 that is the design's two phases (the walk there and the
    walk back). The others who hear it face it for the phase. Throwing it is no illegal act and Clean: whoever sees the
    thrower sees a customer, but those who turn to the noise see what is there.
262. **The ammo bag is for when the bank is loud (M4-06, §11.11).** Dropped (1 action, hands free) on the crew member's
    tile only once Loud, like the grenades and tripwires: a bag lying through a quiet world phase would be evidence
    nobody judges. A refill (1 action, the bag in reach) tops up every gun the crew member carries to the spare
    magazines it started with (3; the taser none), one of the bag's 4 uses; it is refused when nothing is short.
263. **Kits come off when spent (M4-06, §12.2).** A reinforcement kit whose two uses are spent comes off the crew member
    (its Concealed profile with it), as the last grenade or noisemaker does; with two kits, one at a time.
264. **The suppressor is an SMG of its own (M4-06, §12.1 "suppressor optional").** `suppressedSmg` is a kit item with the
    SMG's row but a quiet noise of 4 (§8.9), Armed as the SMG: chosen in the loadout, as the suppressed pistol is,
    rather than fitted in play.
265. **The jammer is drawn (M4-06, §12.2).** It already paused every radio and mobile phone carrier drawn within its
    radius (M1-08; landline calls and wired carriers go on); the world overlay now draws a running jammer and its
    radius, so the player sees which carriers it reaches. The crew placed it, so it tells nothing hidden.
266. **No desk phones yet (M4-06, §8.13).** Ringing a desk phone needs the phones and their owners, props the
    generator doesn't place (M5-04); without them there is no desk to ring, so it waits for them rather than guessing
    owners from the schedule.
267. **A throw seen is a little odd (M4-06 review, §8.5).** Throwing a noisemaker isn't one of §8.4's illegal acts (a
    coin is Clean, and `!` would make every lure a giveaway), but while the bank is quiet each NPC who sees the thrower
    gains 1 pip of them (`NOISEMAKER.pips`), as fortifying costs `FLIP_PIPS`, judged before anyone turns to the noise;
    cameras register only `!`, so none. Throws stop at what stops a body (`throwMap`): glass, a shut door; a railing or
    a fence doesn't.
280. **Vehicle hit points (M4-04, §14.4).** Every vehicle with a body has the hit points and armour of §14.4's table
    (`VEHICLES`, `POLICE_VEHICLES`). Each bullet that stops on a crew vehicle (full cover) and each blast whose tiles
    reach its footprint deals its damage less the armour; a ram deals a flat 10 to the vehicle rammed and to the rammer.
    A crew vehicle at 0 is disabled where it stands, still full cover: no Drive or Ram, getting out still works. A police
    car or van at 0 is a wreck: it stays in the way of every drive and frees its staging slot. Police vehicles aren't
    cover in the shot map, so bullets don't reach them yet.
281. **The ram (M4-04, §14.4, §14.2).** Straight ahead, up to the driver's Drive tiles, after at least 2 clear tiles of
    run-up; a row ahead is clear as a Drive's tile is. It drives into, in this order: a wall across its front (all Glass or
    Soft: a gap of its width plus the next segment along on its right, else its left, if that one is Glass or Soft and
    shut; a door among them is breached; else it stops dead); someone living it can see in the row (on any tile); a tile
    it can't drive on; another crew vehicle; a police vehicle, wreck or roadblock piece. It stops the tile before.
    **Departing from §14.4's "ends up in the breach":** its nose stops against the gap on the street side, not in it. The
    building's floor isn't Drivable, so a vehicle standing on it could never reverse out (a drive sweeps the tiles it
    starts on); against the gap it still plugs the breach as full cover, the extra segment the way through. Everyone
    living in the impact area takes 6, lethal: the tiles across the gap, else the row, plus where a shoved car slid to.
    The dead and stashed bodies are no one to hit (as a blast). A police vehicle rammed is slid sideways the least that
    clears the lane, its right first, onto drivable tiles with no vehicle or roadblock and no wall crossed. With no room
    either side it is shunted ahead along the lane on the same terms, as far as it goes up to 3 tiles (so the next ram
    has its run-up); shunted past the plot's edge, or with no room at all, it is pushed clear off the street (out of
    play, any officers aboard get out at its staging point), so rams always clear a lane (§15.4). The rammer takes 10,
    halved (rounded down) with a Wheelman and again in the ram truck, in full. **A ram that would take the crew's last
    drivable vehicle to 0 is refused** ("it is the crew's last way out"), so ramming can't strand the crew (§15.4
    "escape is always possible"); a vehicle with another that can still drive may be rammed to a standstill. Bullets and
    blasts can still disable a vehicle; then the on-foot exits (M4-05) are the way out.
    The `vehicleRam` noise (16) at its nose, and the bank goes Loud. With nothing within reach (open street, the plot's
    edge) it is refused: that is a Drive.
282. **Ramming on what the crew knows (M4-04, as decision 192).** The ram is planned on the crew's picture. Someone
    unseen in the run-up, or in the row ahead of anything but a wall or a person, cuts it before them (`driveCut`):
    nothing is rammed, the action is spent. Someone the crew sees never cuts it: they are in the plan (`RamPlan.people`). Those beyond a breached wall, and on a shoved car's new tiles, are hit
    whoever they are. The player's preview sets everyone unknown on any tile the ram touches aside (`asideUnknown`, also
    the drive's), so it is exactly the ram with nobody there; the commit then tells of whoever it hit.
283. **Police vehicles on the street (M4-04, §13.4, §15.4).** A police car (2×3) or van (2×4) stands on a footprint
    lying along the street from its `pos` (the north-west tile), parked at the spot nearest its staging point where the
    whole of it fits (decision 193's rule, the footprint for the tile). The staging points are the plot's exits, so the
    perimeter cars block the getaway there: driven round or rammed aside. They block drives only; as cover and on foot
    they stay as before (deferred). They block drives before they are drawn in the bank (deferred): their coming is
    announced by the heat strip's forecast (`nextWave`, "SWAT van, the alley mouth") and the recap's arrival lines, the
    roadblock by its recap line (`roadblockSet`), and a drive's refusal or the grid's "No way off the plot from here".
284. **The ram truck and the backup car (M4-04, §14.4, §15.4).** Data and rules now, placed by planning (M4-07). The ram
    truck is a van-sized vehicle that takes half a ram's damage. With more than one crew vehicle, one leaving takes its
    crew away and the heist goes on while someone up is left on the plot with a crew vehicle that can still drive; it ends
    as the last such leaves, or once everyone left behind is dead or in custody. The outcome counts everyone aboard any
    vehicle that left; `vehicle` names the last.
285. **The Heat 5 roadblock (M4-04, §15.4).** As the Heat 5 wave is sent (not a refill), each staging point gets a
    roadblock: a piece on each drivable tile of the point's column running unbroken through it, at most 3 each way, but
    where a vehicle or anyone stands. Pieces block drives and are knocked away by a ram through them.
286. **Those who got away are out of play (M4-04 review, §15.4).** As a vehicle leaves the plot, everyone aboard moves
    from `State.crew` to `State.escaped` (as they were then, the vehicle and the turn; `crewEscaped`) and is forgotten
    by the map (`forgetCrew`, as an arrest): no world-phase rule bleeds, kills or arrests them, nobody sees or targets
    them, and they are no crew eyes. Their loot keeps them as its holder; the outcome counts them escaped (dead if they
    died aboard before leaving) with what they and the vehicle carried.

300. **Off-map routes are one transit (M4-05, §14.7).** A route is its two ends and its turns; the crew member goes in
    from either end (an end in reach, 1 action, the rest of the turn's actions with it) and is off the map until the
    devices step of the world phase that brings the count to 0, then out on the far end or the free tile nearest it.
    Entered in turn T's crew phase, a 2-turn route has them acting again in T+2. Off the map they are seen by nobody,
    stand in nobody's way, are no body for a bullet or blast and see nothing themselves (`offMap`, the same checks as
    aboard a shut vehicle), nor a teammate anyone can hand anything to; going in and coming out are each seen as an
    action ending on that tile. They come out onto the far end or the nearest tile of its room reachable without a door
    (the next such tile past anyone standing there, a body lying there no bar), and
    can't go into a route again in the crew phase they come out into: nobody is off the map through every world phase.
301. **Light only, no bodies (M4-05, §14.7).** Loot in the hands (Heavy or Very heavy) and a dragged body or a led
    hostage can't go; pocketed Light loot goes with them.
302. **The helicopter closes the roof (M4-05, §14.7).** While it is over the plot (it doesn't leave yet) the roof route
    and the duct (which starts on the roof) can't be entered, and anyone on either is put back out where they went in
    at the next world phase's devices step, after the police have come.
303. **Escaping on foot (M4-05, §15.4 "Escape is always possible").** Any route can be taken off the plot instead of to
    its far end (`escape`): when its transit is over the crew member is out of play with what they carry and counts as
    escaped, as those who drive off (decision 286). The heist ends when nobody of the crew is left on the plot but the dead,
    or, once a vehicle has driven off, when nobody up is left behind or those behind have no way out (no crew vehicle
    that can drive and no route off the plot: the sewer always, the roof and duct while no helicopter is over); never
    while someone is on a route out. A sewer route is in every bank (§17.7 `sewerExit`). Cash taken out of the building
    that way settles its dye pack. This widens decision 177: a crew member left behind by the last vehicle plays on
    while a route off the plot is open.
304. **Sniper posts (M4-05, §13.4, §13.6, §14.7).** Snipers "walk in" to posts: tiles outside the building that see a
    pane of its outer wall within the DMR's range, raised floor first, then the most panes seen; they appear on the best
    free one, nearest their staging point among equals, a phase after their wave. Posts are worked out on the bank as
    built (no door, pane or vehicle as the heist left it), so a save loaded later finds the same ones. No post: they
    stay by their staging point.
305. **The laser telegraphs the shot (M4-05, §13.6 "Sniper lines are always visible").** Each world phase a sniper puts
    its laser on one crew member in its sights (DMR range, halved onto a dark tile, line of sight; masked or known, up,
    on the map): one leaning out first, then the nearest. The shot comes only in a later world phase, at that crew
    member, if the sniper still sees them, and only if clean (`cleanShot`): never through a standing non-crew body; in
    Negotiate it holds fire. The laser is told always, wherever the sniper stands; its shot is told as any police shot.
306. **Snipers keep their posts (M4-05).** They don't move, fall back, breach, free hostages or arrest; a flashbang that
    costs one its phase takes its laser off.

320. **Vehicle spots (M4-07, §18.1, §15.4).** The crew's vehicles wait at the generator's getaway spots (the curb, the
    alley, a garage, the side road, the lot), one vehicle a spot. At its own spot the van keeps the generator's pose;
    anywhere else a vehicle takes the pose whose north-west tile is nearest the spot (by rings, then steps) where its
    whole footprint fits: on the map, drivable, open, on the ground, nobody standing there and no wall across it,
    lying west, then east, before north or south. A spot nothing fits at isn't offered.
321. **Starting in a vehicle (M4-07, §18.1 "in the van").** `CrewStart.aboard` seats a crew member in a vehicle's cab
    from turn 1 (rules/vehicles.ts: the `aboard` crew init, the `crewVehicles` state init seats them and gives the wheel
    to the first in crew order who can drive): out of sight as anyone aboard (decision 300's `offMap`). "In the van"
    and "by the van" (on foot beside it, as the M1 crew starts) are both starts.
322. **Loadouts in the sandbox (M4-07, §7.3).** A primary, a sidearm, armour and two gadgets, any item of the slot, free
    (the black market and money are M6-03's); zip-ties are fixed (the phone, mask and scanner are no items yet). Nothing
    starts packed and the duffel isn't offered: there is no Gear up action to take a packed item out (deferred). The
    roster is §3's four with their traits (Mara Smooth Talker; Jun Steady Hands; Dex Intimidating, Bruiser; Sol
    Marksman); the plan opens on all four, Mara and Jun by the van, Dex and Sol in it, nothing bought.
323. **Cash and favours (M4-07, §18.1, §18.2).** The sandbox has $24k for assets (the campaign's money is M6-03's) under
    the favour cap of 8. The assets are those the rules carry out so far: the ram truck ($8k, 2), the backup car ($6k,
    1), the sniper nest rental ($6k, 2) and the jammer pre-placed ($5k, 2); all four cost $25k, so one has to go.
324. **The pre-placed jammer (M4-07, §18.2, §12.2).** On open ground outdoors (the street, the alley, a lot; never in
    the bank or a neighbour) within 2 tiles (Chebyshev) of the building, nobody standing there; it runs from turn 1 as
    a placed jammer does (`State.jammers`, `crew` ''), so dispatch's lost-contact count (`rules.dispatchSilence`) starts
    then and nothing in play takes it back: the hint, its card and its pin say so (review).
325. **The sniper nest (M4-07, §18.1, §14.5).** Renting it lets a crew member with a long gun start in the bank's nest
    room (the generator makes one at most): on its free tiles nearest the lobby first, facing the lobby. Giving the
    rental back, or the long gun, puts them in the van.
326. **Each crew member's own colour (M4-07, UI.md "Crew").** Mara, Jun, Dex and Sol wear their colours wherever they
    stand in the crew's order (`crewColour`); anyone else takes the colour of their place.
327. **Planning in the game's flow (M4-07).** `?plan` (`&seed=…` for another bank) opens the bank's tactical map at the
    crew's starting knowledge with the planner over it; Start opens the game with the plan in its address (`?play`,
    the bank's address and `&setup=` the plan's JSON, never `new`), which starts it there, asking first if a heist is
    saved ("Keep planning" goes back), so the plan survives the page change with no storage; a plan that can't be
    read or played goes back to planning. The address drops `setup` once started. The outcome's New heist forgets the
    finished heist for good (the session retired, so leaving the page doesn't save it again) and plans the next one in
    the same bank. `/` with no heist saved still starts the M1 crew unplanned (`newHeist` without a setup).
328. **The planning map shows what the crew knows at the start (M4-07 review, §17.8).** The NPCs drawn are those the
    crew sees or predicts at turn 1 from the plan's free starts (`startView` on `freeSetup`: the van alone, everyone
    who starts by or in a bought vehicle or the nest at the van instead; `markerKind`, as play draws them at turn 1, a
    predicted one translucent), recomputed after each change to a playable plan, and the vehicles stand where the plan
    parks them. Cash is spent only at Start, so what a paid start would see shows only once the heist starts: renting
    the nest, looking and giving it back scouts nothing (re-review). Guard posts and anyone else unknown stay hidden
    until intel (M5-03: decisions 401, 402).
329. **A plan from the address is checked whole (M4-07 re-review).** `setupShapeProblem` refuses anything but a
    `HeistSetup`'s exact fields and types: unknown keys, items that aren't items, other than two gadget slots (§7.3), a
    start that isn't one (`aboard` a boolean, the nest with nothing else), `nest` not a boolean, a vehicle type that
    doesn't exist, a jammer off the grid, and no van (no getaway). `setupProblems` reports it first, so the game sends
    such an address back to planning.
360. **Desk phones and their owners (M5-04, §8.13).** The generator puts a phone on the desks of the workstations,
    desk pairs and the manager's desk (the building, which doesn't change with the population, §17.2). Every one is a
    rules object; one where nobody in this population works rings like any other (final, the same pause) and brings
    nobody, so the offer to ring a phone says nothing about who works at its desk. An owner is someone whose `post` block
    stands within a tile of it, in its room, staff or a guard (never a customer), paired one owner a phone and one
    phone an owner, nearest first (`src/gen/phones.ts`); they answer it
    from that post (`answerAt`). The CCTV operator's console has no phone (he has the radio and the console), nor have
    visitors such as the IT tech.
361. **Ringing a desk phone (M5-04, §8.13).** `ringPhone { crew, phone }`, 1 action: from another desk phone in reach
    (Clean, no illegal act), or anywhere with a hacking kit (the illegal act 'hack'). A calm owner who is present and
    deciding for themselves is sent as an errand (`sendToLook`, `phone:<id>:<turn>`): the walk is telegraphed in the
    crew phase and ends beside the post or after `rules.evidencePhases`, as a guard sent to look. The ring event never
    names the owner. A dead line rings nothing.
362. **The phone line (M5-04, §9.1).** `interact … cut` at the alarm closet's `phoneLine` (1 action, 'hack', no kit):
    a landline call (`Carrier.line`) doesn't start (`lineDead`, as `alarmDead`) and one under way is countered
    (`registerCarrierCheck('phoneLine')`); mobiles are the jammer's. Dispatch notices after `rules.phoneLineNoticed`
    (15) world phases counted from the cut, inclusive, once (`ObjectState.lineNoticed`), and sends a drive-by
    `driveByLead` later (`deadLineNoticed`) unless one dispatch sent is still to come; not once the Alarm is up. The
    grid's entry says so ("dispatch notices in 15"). Undoable: nobody sees a cut line.
363. **The intel box (M5-04, §17.4).** The deposit parcel picks which box holds the intel from a stream of its own
    (`Loot.intelBox`); `worldFromBank` marks that box (`loot.intel`). Opening it, or drilling its wall, adds it to
    `State.intelFound` (`intelFound`, a preview secret). Opening any deposit box is now final (`boxOpened` undo-blocking),
    so neither the intel nor an undo tells which box held it; what the intel tells is M5-02's.
364. **Keycards as things (M5-04, §15.2, §17.6).** A `keycard` object is a card lying somewhere with its `holder`, from
    `from` until `until`; `worldFromBank` makes the manager's, in his desk drawer through his lunch (the timeline's own
    turn and duration), when the generator's `keycard-drawer` opportunity is rolled. It is there only while the holder
    has actually left (status 'away': not knocked out or held before he could go) and still has it (no frisk). Taking it
    (1 action, 'takeLoot') gives the crew the holder's card (`CrewState.keycards`) and takes it from the holder
    (`NpcState.keycard`); it is always final (`keycardFromDrawer`, naming nobody), so its preview and its commit agree
    whether or not the crew knows the manager. The grid offers it only while it can be taken, so the drawer tells
    nothing before lunch.
365. **Side objectives (M5-04, §19.5).** `GenerateOptions.objectives` places each after the furnishing (so nothing else
    in the bank changes): the blueprints and the chief's dirt as one more deposit box (the manager's office without a
    deposit room), the blackmail material and half the code at the manager's desk, moved out of reach once the Alarm is
    up (`lostOnAlarm`, refused by `takeLoot` unless already taken). They are Light loot worth $0, pocketed (a pocket
    slot), and come open with a drilled wall; M6 counts the one its carrier escapes with.
366. **The vault wiring box (M5-04, decision 81).** Where the antechamber has a `wiringBox`, the sensors are cut there
    (same work and act as before); the console refuses ("The sensors are wired at the wiring box"). A bank without one
    keeps decision 81's console. The box hangs clear of the wall beside a door (a vault door's leaf needs it).
368. **A ring is final, and busy owners let it ring (M5-04 review).** Whether a hidden owner answers would otherwise
    show through undo (their status change blocks it, but a projected preview drops it), so `phoneRang` blocks undo
    whatever came of it. A ring never takes an owner off what they are dealing with: one not calm, with evidence of any
    kind, a want about the crew or a search lets it ring (so a Clean ring can't wipe minor evidence). A phone rings at
    most once every `rules.phoneRingPhases` (4) turns, a little more than the walk to answer it and back (§8.13's
    "about 2 phases"), so the same desk can't be used to hold someone at it.

380. **Opportunities are rules data, and only found ones reach the player (M5-02, §17.6).** `worldFromBank` turns each
    generated opportunity into an `OpportunityDef`; the crew's finds are `State.opportunitiesFound` (`{ id, how,
    turn }`, in order). The journal, the grid and the barks read only the finds; `opportunityFound` is a preview
    secret and blocks undo. Every heist has its journal button, whatever the bank holds.
381. **Documents (M5-02; re-review).** Every stack of papers on the staff side (`paperStack` props in Staff and Secure
    rooms, all named "Papers": the sticky note is the one nearest the `sticky-note` vignette, among the coffee-stained
    files and meeting notes the other vignettes leave), the manager's papers (on his desk) and the records (the records
    room's first filing cabinet) are `document` objects, whether or not anything is written in them: a document that
    existed only with its opportunity would give it away by being offered. A written opportunity is in the note (its
    own), the records (`records`), else the manager's papers, else the records. Reading is 1 action, no illegal act
    (the zone judges being there), and always final (`documentRead`), so neither the offer, the refusal ("Read
    already") nor an undo tells what it held. The grid has its own Read entry, so a document never hides behind the
    desk it lies on.
382. **Eavesdropping (M5-02; review, re-review).** NPCs talk in conversations, as far as the crew can tell: a calm NPC
    on its feet, not under the crew's control, that the crew sees or predicts, with another such NPC in earshot, or at
    its own desk phone (the manager on the line). Someone the crew doesn't know of neither talks nor makes another
    talk, so chatter or its absence never tells of an unseen NPC (the first review's version found partners in the
    truth, and sound turns corners: a hidden clerk round a wall made a seen teller talk). Known is judged on sight as
    things stand at each sample (`knownAsNow`: in the crew's sight now, or on a routine it knows and still on it), not
    on the stored knowledge, which a world phase brings up to date only once it is over (a talker who walked round a
    wall in the phase would otherwise still count as seen). Talk reaches
    `rules.eavesdropRange` (2) steps (a diagonal where either way round the corner is open) through open air and open
    doors only: no wall, no glass, no shut door (sound, not sight). A crew member able to act who is in earshot of the
    same talker as one world phase ends, as the next begins and as it ends (a whole turn) overhears the conversation:
    always some chatter (`overheard`, opportunity or not), and with `rules.overhearChance` (½) the first unfound
    opportunity that talker knows. The roll is made for every conversation overheard, whatever it is about, as the next
    crew phase begins after every other rule (`crewPhase`, last: decision 49), so a preview of the world phase runs whole
    before it stops there. Both `overheard` and `opportunityFound` are preview secrets. **Accepted:** absence still
    tells by probability (five silent turns beside someone leave a 1-in-32 chance they knew something). Chance is the
    point: any rule that found an opportunity for certain after some turns would make absence certain, and none at
    all would make eavesdropping no way to find anything. Listening longer is the cost, paid in turns.
383. **What the intel tells (M5-02, §17.4).** The intel box tells every opportunity found by intel, and any this bank
    gives no other way to find (no speaker in its population, no document).
384. **The drawer keycard needs the opportunity (M5-02).** The crew doesn't know to look until `keycard-drawer` is
    found; until then the grid has no entry and a take is refused as if there were no card. The card object is in
    every bank with a manager and his desk (`from`/`until` only when he leaves it), so a refusal by id tells nothing
    either.
385. **The propped fire door (M5-02; reviews).** On his smoke break, calm and at his spot outside the back door (the
    door whose edge touches it), the operator wedges it open (`propped`, `proppedBy`, `doorPropped`) once a break
    (`wedgedOn`: a door the crew shuts again stays shut); it stays open while he is out, and if he never comes back in.
    He pulls the wedge as his walk takes him in through that door (from its outside tile to its inside one), whatever
    his state; back inside some other way, only once his break is over and he passes within a tile of it on the inside
    (never from across the bank); down outside, never. It then swings shut and locks as doors do. A door an NPC
    propped is still doubtful to the crew (knowledge.ts `isDoubted`).
386. **The bribe (M5-02, §7.2; review).** `bribe { crew, npc }`, 1 action, in reach, a Smooth Talker, once `bribe` is
    found, on the teller in debt while she is calm. Cash changing hands is the illegal act 'pickPocket' (seen on both
    tiles): anyone who sees it Exposes the crew member, so it is done out of others' sight. She stays off the alarm:
    her reaction to anyone she Exposes is to watch, she reports no evidence, and a lapsed command doesn't send her to
    the phone (npc/behaviour.ts); others still react. Anyone else, or her before the find, is refused with the same
    words. The grid offers it only for her as the crew knows her (seen or predicted, on her feet, in reach). It changes
    an NPC, so it is final.
387. **The IT technician's card (M5-02; review).** The visiting technician's card (`it-tech`'s `npc`; a frisk takes it,
    decision 60) disables the alarm panel without a hacking kit, in one action, once the crew has found his visit.
    Before that it is any staff card, so holding a technician's card tells nothing about whether he visits. Widening
    the key graph instead (his card on the CCTV door) would have changed which doors NPCs walk through.
388. **The vault code note and guidance (M5-02; review).** Reading the `sticky-note` gives its part of the code
    (`State.codesKnown`: the whole code, or the head teller's half under dual control) or, under Three Keys, the
    time-lock window (`noteRead`, as `pcHacked` tells it; a preview secret); its text is rewritten to say what it
    gives (dual control without a head teller has one whole code). The journal is the crew's knowledge: Show and its
    position only on tiles that aren't hidden (never into a room the crew hasn't seen), and an entry whose NPC the crew
    knows is down or held reads "off", else "due now" while its window is open. Guidance is the player's, not the
    rules': Full (when, where, Show), Minimal (text) or Off (text, no badge, no bark), kept in `localStorage`, Full by
    default (§22's first banks).

400. **Intel is everything known before the heist (M5-03, §17.8).** The rules' `Intel` (`World.intel`) holds the intel
    bought (Blueprints, Guard rota) and the casing of earlier heists in the bank: the tiles seen (a bitset as
    `Knowledge.seen`), the NPCs whose routine was known (`Knowledge.routines`: every routine known at any time in a
    heist, kept after the NPC leaves it), the opportunities found and how. A heist starts with the tiles seen stale (their
    layout and furniture, the rooms and the cameras on them), the routines known as the rota's are (predicted from turn 1,
    known again whenever back on them) and the finds in `opportunitiesFound` at turn 0 (wired in: the drawer card, the
    bribe, the technician's card). Nothing that moves or belongs to the day carries: no NPC where it stood, no door as it
    stood, no feed status (the CCTV room is scouted only by a tile of it in view in this heist, `scoutCctv`, so a room
    cased yesterday tells nothing of today's monitors), no codes (the note is read again), keycards, evidence or the
    intel box. Stale tiles stay where unknown NPCs may stand (unknown risk), so the safe floor promises nothing the
    casing doesn't. `intelOf(world, state)` is the heist's intel grown by what it learned.
401. **The intel assets are paid as they are bought (M5-03, §18.2).** Blueprints ($2k, 1 favour) and Guard rota ($3k, 1)
    are planning assets. The planning map shows what they tell at once (planning shows what the assets bought and the
    intel justify), so a bought one can't be given back (its button is disabled), and one that would go over the cash or
    the favours can't be bought; one known from an earlier heist is ticked and free, and a plan buying it again is
    refused. Decision 328 holds for the starts: renting the nest and giving it back still scouts nothing. **Accepted:**
    the sandbox's cash isn't kept (M6-03), so reloading the planning page forgets a purchase not started, though the
    player has seen what it showed.
402. **The planning map draws the start's knowledge (M5-03).** `startView` also gives each tile's visibility at turn 1
    from the free starts with the intel and the intel assets (`freeSetup` keeps them); the scene draws its hidden tiles
    as play does (`Knowledge.showHidden`, a predicted NPC over the block) in place of the blueprint's room outlines.
403. **Intel is kept per bank and only grows (M5-03).** `src/game/intel.ts` keeps it under `intel:` and the bank's print
    (a hash of its World without the plan's vehicles and intel), so a generator change that rebuilds the bank under the
    same address never shows yesterday's layout. The Session merges `intelOf` into it after each save that grew it (a
    failure never fails the save); the planning screen loads it (`loadIntel` refuses anything `intelProblem` doesn't read
    as this bank's: routines of its people, its own opportunities, a tile set of its size). Unplanned heists (`/`, the M1
    crew) add to it but never start from it, so M1 plays as before. Days, and forgetting, are M6-01's.
404. **The plan carries its intel (M5-03).** `HeistSetup` gains `blueprints`, `guardRota` (bought now) and `intel` (known
    from before); the address carries them, `setupShapeProblem` refuses a plan without them (an older address goes back
    to planning) and `setupProblems` checks the intel against the bank. `heistIntel` is what the heist starts knowing.
405. **The address is never a source of intel (M5-03 review).** A plan from the address (`setupFromAddress`) has its
    `intel` replaced by what this device keeps for the bank (`loadIntel`) before it is checked, so an edited address
    claims no casing; the intel assets it buys are paid in that plan, as the cash check counts them.
406. **Only a planned heist, once its first turn is played, adds to the bank's intel (M5-03 review).** A planned heist's
    World always carries its intel (`{}` for none); the Session keeps intel only for such a World and only from turn 2,
    so the M1 crew's heists and a heist started and left at once (a rented nest looked through and given back) scout
    nothing. **Accepted until M6-01:** a planned heist played a turn or more, then abandoned with New heist, still keeps
    its casing for nothing: repeating heists scouts for free. **M6-01:** in the campaign a heist spends its day as it
    starts (decision 441); the sandbox (`?plan`) has no days and keeps this, its intel never reaching a campaign.
440. **The campaign is pure, and saved beside the heist (M6-01, §19).** `src/campaign/`: a plain-JSON `Campaign` (seed,
    the day not yet spent, the Squeeze, the drawn complications, the day each threshold landed, the false tip, the
    phase, the days spent, the day's visit, intel per bank print) changed only by a `CampaignCommand` through
    `commitCampaign` (a copy and its `CampaignEvent`s; `campaignRefusal` says why not, `CampaignRefused` is thrown), as
    the rules' commit does. No clock, no `Math.random`: the complications are drawn from the campaign's seed
    (`drawComplications`, the generator's `Rng`), 7 of §19.2's 10, one per threshold before the Raid, so the timeline is
    whole from day 1. `src/game/campaign.ts` saves it under `campaign` as `{ format: CAMPAIGN_FORMAT, campaign }`;
    another format, or anything `campaignProblem` doesn't read as a campaign (exact fields and types, the days spent
    exactly those before today, every threshold the points reached landed, the phase the landings make, the visit a
    day spent), is refused as the rules' saves are (`SaveFormatError`), and the page says it can't be read.
441. **A heist spends its day as it starts (M6-01, §19.3; decision 406's must-do).** Start on `?plan&campaign` commits
    the campaign's `heist` and saves it before the heist exists, so a heist left after one turn, or none, has cost its
    day (+2 Squeeze). The heist is tagged with its campaign's seed and day (`CampaignTag`, kept with the saved heist's
    bank entry); its Session sends what it learns to that day through `SessionOptions.keepIntel` (`campaignKeeper`)
    from the first save, never to the device's `intel:` store, and a sandbox heist never reaches a campaign. A tagged
    heist whose day's visit is no longer the campaign's (a later day action came) sends nothing; a day action from the
    campaign page drops it from the save slot. Casing is a day action in the rules too (`case`, a visit like a heist's;
    its no-combat visit mode is M6-07's).
442. **Intel ages by the day (M6-01, §17.8; M5-03's deferral).** The campaign keeps what each visit learned, per bank
    and dated (`DatedIntel`, one record per visit, replaced as the heist learns more). The layout (the Blueprints, the
    tiles seen) holds for good: the building doesn't change. The day-bound parts (the Guard rota, the routines, the
    opportunities found) hold for `INTEL_FRESH_DAYS` = 3 days after the day learned, then go, from the save too
    (`pruneIntel`): rotas are redrawn and staff rotate, and stale intel is dropped, never shown wrong. A visit's record
    leaves out the day-bound parts it started knowing (`learnedOf` against `Visit.prior`), so carrying a routine into a
    heist doesn't re-date it: it ages from the day it was learned (strict: one seen again in that heist isn't renewed).
    `campaignIntel` merges the fresh records, each checked against the bank (`intelProblem`), into the plan's intel.
443. **An abandoned heist is a failed job (M6-01, §19.2).** A heist that ends in failure adds the failed job's +2 once
    (`heistOver`, sent by the keeper at the outcome); a partial success is no failure. A heist still unfinished when the
    next day action comes (laying low, the next heist) was abandoned: +2 too, asked first. Otherwise leaving a heist
    going wrong would dodge the failure.
444. **Days and thresholds (M6-01, §19.2).** Day 1 starts at 0. A day action spends the day now: +2, then every
    threshold reached lands on that day, so the daily gain alone lands them on days 4, 8, 11, 13, 15, 17 and 18 and the
    Raid on day 19 (`timeline`, `projectedDay`: the day each lands if nothing but the days adds, moving forward on the
    spot when something does). Squeeze from elsewhere (`squeeze`: Notoriety gained per crew member, a prisoner who
    talks, the false tip once) lands on the last day spent. A landed complication is never taken back: the false tip
    lowers the points (never below 0), and climbing past a landed threshold again lands nothing. At 38 the Raid stops
    the day actions: `raid` until `raidOver` (survived: `finaleDue`, else `over`); `finale` ends the campaign from
    `open` or `finaleDue`. What each complication, the Raid and the finale do is M7's.
445. **Reaching the campaign (M6-01).** `?campaign` is a plain HTML readout (`src/ui/campaign/`, no Phaser): the day,
    the Squeeze, the whole timeline with each step's day, the day's heist and the days spent, and the day actions so
    far: Plan a heist (`?plan&campaign`, the pinned bank until contracts, M6-02) and Lay low; New campaign asks first.
    A campaign heist's New heist comes back to it, and its address drops `campaign` once started so a reload resumes the
    heist. The planning screen's cash stays the sandbox's $24k (decision 323): the campaign's money is M6-03's, which
    this doesn't need. `window.campaign` (`get`, `act`, `start`) on that page is for tests and the console.
446. **The abandoned heist settles first (M6-01 review).** A day action that abandons the day's heist adds the failed
    job's +2 first and asks again whether it may go on (`campaignRefusal`): when that +2 landed the Raid it stops there
    (a `stopped` event, no day spent, no new visit; the page says so and a planned heist goes back to the campaign).
    `campaignProblem` refuses a day spent after the Raid (it lands on the last day spent) and a visit that isn't the
    last day spent. A campaign heist's bank entry, tag included, is written before the heist in one write replacing the
    old one, and a campaign heist that can't be tagged doesn't start. Its keeper drops the heist (`'drop'`: the Session
    retires and forgets it) once its campaign day is over, so a tab left open on it after Lay low saves it no more; an
    untagged heist resumed in the bank of the campaign's unfinished heist keeps nothing on the device (`untaggedKeeper`). A heist whose
    visit already has its result (ended, or abandoned into the Raid) is dropped too, and a stopped Start drops it at once.
340. **Validation sees with the rules (M5-01, §17.7).** The checks of what is seen run on the World the game builds from
    the bank (`worldFromBank`) in its state on turn 1 (`initialState`: everyone where they start, the doors as they
    start), through `src/sim/geo`: §8.3's arcs and ranges, darkness halving them, cameras blind on an unlit tile, the
    corner rule. Guard overlap counts the calm profile (Core 6 over 90°, Peripheral 8 over 140°) from each guard's
    post, facing as posted, and from every tile of its route out and back, facing the way it walks; a camera is useful
    when `cameraObserver` sees a traffic tile in either of its facings (both pans of a panning one).
341. **Cameras are hung by the same sight (M5-01).** `placeCameras` ranks its slots by what the rules' camera in each
    would see, on a bare World of the bank (nobody in it yet, a camera in every slot), so it never hangs one the check
    then finds pointless. A camera pans (the 1-in-3 roll is kept) only when its pan also covers a traffic tile: the pans
    turn it 45° off its own facing, so a pan could leave it covering nothing. The generator's own `cone` and its range
    and angle constants are gone.
342. **The Clean route is green on the safe floor and walks (M5-01, §17.7, §8.8; review).** From the lobby to the CCTV
    room or the alarm closet, a Clean crew member (nothing on them) walks through the rules (`commit`) from turn 1:
    each Move the longest the path under the finger (`pathSafety`) shows green on the bank as it stands then, two a
    turn, every turn's end played, the world phase after the last Move too. It counts only if nothing auto-advance
    stops on happens (`UNSAFE_EVENTS`: a suspicion pip, an exposure, a challenge, a camera sighting, an alarm), nobody is
    put on edge, and no Move is refused or cut short (`SPOTTED`; `walksUnseen` plays a found route again, and
    tests/validate.test.ts has a guard who turns to watch the corridor on turn 2 reject it). Where nothing down
    its way is green, the walker does what a player would: it **waits** (ends the turn where it stands) if the safe
    floor (`safeFloor`) shows staying green, or else steps aside to the green tile nearest the goal; at most 6 turns
    in a row without a Move down the way (`ROUTE_WAITS`) and 20 turns in all (`ROUTE_TURNS`). The route is the bank's,
    not a crew's: the walker knows the whole bank (every tile seen, every NPC and camera, the feeds), so the floor
    judges the truth, not the turn-1 picture (where every staff room is still an outline, grey). It holds everyone's
    card (§15.2: the keys exist), so a locked door is opened with its key, not picked (picking one in the lobby is an
    illegal act every customer sees). That is about as lenient as letting it pick every lock unseen: a real crew has
    to come by those cards (or pick, or hack) first, so the route promises a way past the eyes, not past the locks. The
    vault and the mantrap stay off its way. Its way is the shortest over the
    tiles nobody reacts to on turn 1 (`assessEnd`, walked out from the goal with `stepCost`), counting a panning
    camera's both facings and judging the goal's own tiles with its doors open (a camera that looks through the
    closet's door when it opens). Without such a way from the lobby the roll is drawn again at once, before any walk:
    stricter than it need be (a tile watched on turn 1 may be clear later), and the cheap rejection. The check is the
    last of §17.7 and is skipped when another check (one not relaxed) already rejects the roll. The first version
    judged every Move on the turn-1 state alone, and a review replaying its routes found 5 of 25 that a patrol, the
    manager or an NPC walking onto the route stopped.
343. **What the rules' vision changed in the sweep (M5-01 review).** The sweep still builds all 224 banks with no
    relaxed rule. Rolls a bank (16 banks each), before → after: small twoWing 1.4 → 1.6, atrium 1.0 → 2.1, threeKeys
    1.4 → 1.9, fortress 1.6 → 1.7; city twoWing 1.1 → 1.2, atrium 1.1 → 1.3, threeKeys 1.1 → 1.2, fortress 1.1 → 1.6,
    mezzanineWatch 1.1 → 1.1; HQ twoWing 1.1 → 1.9, atrium 1.1 → 1.1, threeKeys 1.1 → 2.1, fortress 1.1 → 1.5,
    mezzanineWatch 1.1 → 1.6; in all 1.15 → 1.55. The rules see far more than the old door-graph check did (tellers
    facing the counter gate, clerks in the staff offices, the operator, a patrol or the cleaner in a corridor). Time a
    bank, measured back to back under the same load (with M5-04's content on top after): mean 609 → 1098 ms, small
    396 → 768, city 530 → 860, HQ 859 → 1600, the slowest 1.8 → 4.9 s (an HQ bank on its fifth roll). Guard overlap
    rejects a roll now and then, the cameras none (they are hung by the same sight, decision 341). Each roll builds
    two Worlds of the bank: the bare one the cameras are hung by depends on the roll, so it can't be shared. The pinned
    M1 bank `31-2` is unchanged by M5-01 (M5-04's new props change it, on its first roll still), and
    tests/validate.test.ts pins its hash; the visual baseline city-twoWing (`31-2` as a city branch) changed on
    purpose, its sixth camera hung elsewhere by the rules' sight. The bank cache's key follows the generator's imports,
    so it now covers `src/sim` too: a change to the rules builds the test banks afresh (tests/bankCache.test.ts).
344. **Banks the stricter checks roll found two old faults (M5-01 review).** An event's set-off (`routines.ts`) counted
    the walk from the NPC's post and from its last event, but not from the far end of the route it walks in between: a
    cleaner sweeping the corridors could reach the break room a turn late for the shift change. It now counts the walk
    from every corner of that route too. And the vault test fetched each dual-control key-holder to the console inside
    the time-lock window; with a short window and a long way between them it shut again before the crew was through.
    Both are now fetched before the window opens (tests/sim/vault.test.ts).
420. **The playability bot is a player, not a walker (M5-05).** The Clean route of §17.7 (decision 342) knows the whole
    bank and holds every card; the bot (`src/game/bot.ts`) plays a planned heist's real start (`heistFromSetup`, §18.1):
    Jun alone on foot by the van, Clean (Steady Hands halves the work on a lock), with the lockpick and the hacking kit;
    with the Blueprints, which show every lock, a noisemaker for the lockpick where no lock is mechanical. Only the
    real commands (Move, Dash, End turn, open, pick, hack, the noisemaker), and only on what the crew knows: the safe
    floor (§8.8) and `previewDanger` judge on the crew's picture, the doors are `knownDoorStatus`, the tiles
    `tileVisibility`. A goal room (the alarm closet or the CCTV room) is known once a tile of it is: seen, or on the
    blueprint's layout. Until then it explores, and staff rooms are unnamed outlines, so the nearest door with hidden
    tiles beyond is next, dearer by its room's outline area unless the room is narrow as a corridor (the goal rooms are
    small; a big room holds more people). It holds no card it didn't take. With `intel` the same plan buys the
    Blueprints (§18.2, M5-03); it carries no intel from earlier heists.
421. **How the bot plays (M5-05).** Each Move ends on the green tile nearest its target (distances over the tiles the
    crew can plan on, through closed doors and locks its kit opens). Where nothing green gets nearer, it steps into
    unknown risk (hatched grey: exploring is impossible without it) the shortest step that does, only as a turn's first
    action, and where staying is green only after 2 turns' wait; never onto amber, a hand, a camera or red. Off the
    public floor the turn's last action is kept for getting away (a Move there could show someone it could do nothing
    about before the world phase), unless it reaches the goal. Otherwise it waits where staying is green, or steps to
    a green tile, or back toward the public floor, or Dashes. A closed door with hidden tiles beyond it is opened to
    see in; a lock on its way is picked or hacked when the preview warns of nothing and staying is green (after 3
    turns' wait, in unknown risk too). Where someone would see the work, it throws a noisemaker that turns them away if
    one does (the preview of the throw shows nobody making it, and the preview of the work after it nothing), else
    waits 3 turns and then looks for another way for 10. Challenged (§8.6), it makes for the public floor, working a
    lock on the way whoever sees it. It gives up after 80 turns, or 30 in a row ending no nearer and seeing nothing new.
422. **What counts as unexposed (M5-05).** The run fails at an exposure, a camera's sighting, an alarm carrier, an
    alerted NPC or the bank going loud, or a command the rules refuse. Suspicion pips and challenges don't fail it (a
    player recovers from both; a challenge not complied with ends as an exposure anyway). The failure says whether the
    crew knew of whoever made it before the command.
423. **The bot's success rates (M5-05).** The sweep's 224 banks (4 seeds × every tier, archetype and plot), with the
    Blueprints / without: small twoWing 4/16, 1/16; atrium 12/16, 0; threeKeys 1/16, 0; fortress 7/16, 0; city twoWing
    4/16, 0; atrium 2/16, 0; threeKeys 5/16, 0; fortress 9/16, 0; mezzanineWatch 13/16, 8/16; HQ twoWing 4/16, 0;
    atrium 5/16, 1/16; threeKeys 1/16, 0; fortress 1/16, 0; mezzanineWatch 8/16, 7/16; in all 76/224 (34%) and 17/224
    (8%), 1.8 s a run. The pinned M1 bank `31-2` gets through with the Blueprints (turn 48) and not without (exposed
    on turn 72). It is far from "nearly every bank", so it is no validation gate: the sweep reports it and fails on
    nothing it finds. Why it fails, with the Blueprints / without: stuck 30 turns short of the goal 78 / 15 (a lock on
    the only way watched for good, by a teller facing the staff door from the counter, say, with no noisemaker in the
    kit or none that turns them away); exposed 54 / 87, nearly all after a challenge it could not comply with;
    exploring without finding the goal 0 / 61 (stuck) and out of turns 13 / 40; exposed by someone unseen 2 / 4, a
    camera 1 / 0. No run was refused a command.
424. **What the bot's failures say (M5-05).** Mostly that the bot is weak, not that the banks are unfair: the Clean
    route (decision 342) gets an all-knowing walker through every one of them, and a lone Clean infiltrator with two
    gadgets is the weakest crew there is (no second member to watch or distract, no disguise, no knockout). Two
    findings about the game, not changed here: (a) **green doesn't cover NPCs walking in unseen.** Unknown risk
    (`isUnknownRisk`, decision 24) is the sight of someone who could stand on a tile the crew hasn't seen since the
    last world phase; an unseen NPC who *walks* into view in the world phase isn't counted, so a stay shown green can be
    challenged. In a 56-bank probe, 11 of the 30 challenges without the Blueprints came on a wait the floor showed
    green, every one by an NPC the crew hadn't seen; every challenge by an NPC the crew knew came where the floor
    showed the trespass hand (a turn ended out of actions after a Move showed them), so no preview broke its promise.
    The knowledge header's "green means nobody, known or not, would do anything" is true of where they stand, not of
    where they walk. (b) **A challenge behind a latched staff door can't be complied with.** Doors latch locked as
    they swing shut (rules/doors.ts), so the way back to the public floor runs through a lock, and picking or hacking
    it in the challenger's sight is an illegal act: Exposed. A lone Clean crew member challenged in a locked staff wing
    is done for; the design may want a door that opens from the inside without its key, or a crew wedge.
460. **Green doesn't count someone unseen walking in, and says so (M5-05 follow-up, §8.8, §8.15; decision 424 a).** The
    design accepts the caveat rather than widening unknown risk: §8.8's promise covers every NPC the crew knows of,
    hatched grey is someone unseen who "could be watching the tile" from where they could stand now (decision 24), and
    the corner marker is the world phase of the known NPCs' committed walks. Counting unseen walkers too (from where one
    could stand, `unknownAt`, a fastest pace of 8 tiles, then an Alerted NPC's sight) would hatch every green tile off
    the public floor: in a 30-bank probe of the bot's waits, 859 of 859 green stays off the public floor (and 619 of
    619 on it) were within such a walk, so green would never show there and would mean nothing. Every challenge on a
    green wait was by such a walker (3 of 3 in that probe); none by a known NPC. So the tint is unchanged and the overlay
    drawer's note (`SAFE_FLOOR_LEGEND`, src/ui/hud/derive.ts) now says what green means and where it stops: "nobody
    reacts to this move, seen or unseen, nor anyone the crew knows of in the next world phase …; someone unseen can still
    walk in then". The old note ("green counts only the NPCs the crew knows of") undersold green now and didn't name
    the world phase. GAME_DESIGN §8.8 and UI.md say the same. (The evidence warning, which marks one item, not every
    tile, still counts unseen walkers: decision 24.)
461. **The way back: a latched door lets you out the way you came (M5-05 follow-up, §8.6; decision 424 b).** A crew
    member who walked through a door may go back through it without its key once it has latched (`wayBack`,
    crew/movement.ts), as the thumb-turn, lever or push bar on its far side lets anyone out: a challenged crew member
    behind a staff door that latched always has a legal way out (§8.6 "they walk out themselves, using their normal
    actions"), and nobody picks a lock in the challenger's sight to comply. Of the options (the challenger escorting
    them out, compliance counted at an exit route within N, egress only while challenged), this is the one that fits
    decision 25 (the thumb-turn on the side you are on) and lets nobody in.
    - **What is remembered**: `CrewState.cameThrough`, per door, the tile beside it the crew member came from on their
      last crossing that wasn't itself the way back (every step of a Move or Dash across a door, open or not, records
      it). Going back through it, onto that tile, needs no key; the other way does. A crossing back doesn't turn the
      record round, so going out the way you came doesn't open the way in again. The vault door has no such hardware.
    - **It lets nobody in**: only a crew member's own walk opens the way, and only back onto a tile they stood on.
      (A crew member who walked out through a door left open, say, may go back in through it once it latches: in to
      where they had been.) tests/sim/egress.test.ts holds every tier and archetype, three layouts each, to it: with
      every lock latched and no key, the Public floor reaches exactly the tiles it does without the way back (the first
      version, a per-tile "exit side" from the layout, let a keyless crew from the teller line through a keycard door
      into whole staff wings in 12 of 42 banks); and from the deepest tiles a crew member walks to with the doors
      unlocked, once every lock latches, the way back reaches the Public floor.
    - **What it allows**: `open` on a locked door going back (not `unlock`, which still takes the key), and a Move or
      Dash walks through one that way, opening it (`crewCanUnlatch`: `canPassDoor` is told the side it is stepped
      through from), so the safe floor, the drawn path and auto-advance reach past it by the same rules. Neither is an
      illegal act. Like any door it latches again when it swings shut.
    - **Knowledge**: it depends on nothing but the crew member's own walk, never on layout the crew hasn't seen (a test
      plays the same walk in two banks that differ out of sight); `doorMayRefuse` doesn't hatch a step through a
      doubted door going back.
    - **Save shape**: `cameThrough` is a new record on the crew; the shape hash is now `ba07a883585c7ec8`.
    - **NPCs** pass doors by their cards as before (their routes are the generator's).
    - **The bot** walks back out through such a door instead of working its lock, and plans through them at no lock
      cost.
    - Rates and the property test: see decision 462.
462. **The bot after the way back (M5-05 follow-up).** The sweep's 224 banks, with the Blueprints / without: before
    decision 461, 76/224 (34%) and 17/224 (8%), as decision 423; after it, 92/224 (41%) and 19/224 (8%)
    (small twoWing 8/16, 0; atrium 12/16, 0; threeKeys 6/16, 0; fortress 9/16, 0; city twoWing 4/16, 2/16; atrium
    6/16, 0; threeKeys 6/16, 0; fortress 9/16, 1/16; mezzanineWatch 13/16, 8/16; HQ twoWing 4/16, 0; atrium 5/16,
    1/16; threeKeys 1/16, 0; fortress 1/16, 0; mezzanineWatch 8/16, 7/16). Exposures fell from 147 to 98 of the 448
    runs, and only 6 now come from working a lock on the way out of a challenge (64 before: a shorter way out than the
    one it came in by); the runs it saved mostly run out of turns instead (53 → 82): the cold bot's failures are
    exploring, as decision 424 says. (The first version of decision 461, an exit side from the layout, gave 93/224
    and 19/224, partly by walking keyless into staff wings.) The preview property test's vault fixtures now count
    their rare commands from their own start (`Run.rareFrom`), so what the fixtures before them happen to play
    doesn't starve them of a coercion.

480. **Money is the campaign's, in whole dollars (M6-03, §19.4).** `Campaign.money` is clean (to spend) and dirty
    (waiting to be laundered); `fronts`, `contacts`, the `armoury` (gear by item: how many) and each crew member's
    `shares` (percent) beside it. A new campaign starts with the sandbox's $24k clean (decision 323), the sandbox
    roster's default gear as its armoury (so the default plan is playable on day 1) and fixed shares for the four
    (Mara 10%, Jun 8%, Dex 10%, Sol 12%: 40% together) until the roster is the campaign's (M6-04). The save is format 2;
    an M6-01 save (format 1) is refused like any other, and the page offers a new campaign.
481. **A heist pays as it starts (M6-03, §18.2, §19.3; decision 441).** Start on `?plan&campaign` sends the `heist`
    day action with its job (the crew, the gear they carry, the stakes) and its assets' cost (`campaignJob`): the cost
    leaves the clean money and the gear leaves the armoury there, before the heist exists, so leaving it after a turn
    has cost them. The rules refuse a job beyond the clean money, gear the armoury doesn't hold (fixed items and
    non-items are no gear), or a crew with someone who has no share; a heist the abandoned one stopped (decision 446)
    spends nothing. The planning screen plans within the campaign's `Purse` (its clean money, the favours left under
    the cap, the armoury), and a plan from the address is checked against it too (`setupFromAddress`), so an edited
    address takes nothing it can't pay for. It opens on the default plan cut to the armoury (`fitArmoury`), and its
    loadouts offer what the armoury holds. The sandbox's purse stays $24k with free gear.
482. **The take comes in once, as dirty money less the shares (M6-03, §15.5, §19.4).** The keeper sends the heist's
    end with `State.outcome.value` (the loot that left, dye-pack losses already out) and the gear the escaped crew
    still carry (`gearKept`); `heistOver` is taken once per visit (it has a result after), and the keeper then drops
    the heist, so saving again, resuming or reloading counts nothing twice. Every crew member who went takes their
    share (floored to the dollar), whatever became of them: shares are agreed going in, so losing crew never pays.
    A failure, or an abandoned heist, brings nothing in and loses all the gear brought in (§19.3); otherwise what the
    escaped carry comes back, never more of an item than went in (a guard's gun picked up isn't the crew's).
483. **Laundering (M6-03, §19.4).** Each day spent launders up to $60k of dirty money, $60k more per front ($150k
    clean each), as the day is spent: a heist's take, coming in later that day, is laundered from the next day action.
    The fence launders any whole amount at once for 50% (floored to the dollar), 65% once the "Nervous fence"
    complication has landed. Neither spends a day or adds Squeeze.
484. **The black market and contacts (M6-03, §19.4).** It sells what §19.4 prices, at those prices, for clean money,
    into the armoury; heavy armour, the DMR and the LMG need a contact. A contact comes with each Success of a
    high-stakes job (a Partial isn't one); stakes follow the bank's tier (small low, city medium, HQ high) until
    contracts set them (M6-02). Shopping takes no time and is open until the campaign is over.
485. **Intel bought in the campaign is paid at once and stays paid (M6-03; closes decision 401's gap).** On
    `?plan&campaign` the Blueprints or the Guard rota are bought from the campaign (`buyIntel`): paid from its clean money
    and saved before the map shows them, and kept as a dated intel record of the bank marked with the favours called
    in (`DatedIntel.favours`), so a reload shows them known and free and nothing is charged twice. They count against
    the day's favour cap for that bank (`favoursToday`), age like what a visit learns (the rota goes after 3 days and can
    be bought again; the layout stays), and the day's heist starts knowing them, so its own record (`learn`) leaves them
    out and never replaces the bought one. They're bought only while heists can be planned (the phase is open).
486. **The readout shows the money (M6-03).** `?campaign` shows clean and dirty money, what is laundered a day, the
    contacts and the fence's cut; buttons fence all the dirty money (with what it pays) and buy a front; the armoury and
    black market list each item with how many the crew holds and its price to buy one (dimmed when it can't be bought).
    The day's heist says what it brought in after the shares. The city map is M6-06's.
487. **Money exploits checked (M6-03).** Reloading the planning page keeps intel paid and charges nothing again;
    abandoning a heist keeps its costs and loses its gear; the outcome is counted once (the visit's result, then the
    keeper drops the heist); the address can neither claim intel (decision 405) nor buy beyond the purse, and the rules
    check the money and gear again at Start (another tab may have spent them); a sandbox heist never reaches the
    campaign's money; a take is whole and never negative.

### Critical files for implementation

- /home/user/BankHeist/src/gen/model.ts
- /home/user/BankHeist/src/gen/generate.ts
- /home/user/BankHeist/src/gen/nav.ts
- /home/user/BankHeist/src/gen/population.ts
- /home/user/BankHeist/src/scenes/BankScene.ts
