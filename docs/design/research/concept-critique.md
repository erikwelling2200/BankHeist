# BankHeist concept critique (design only)

## 1. Core fantasy and pillars

The core fantasy is the heist film: case the bank, set up the plan, carry it out, and improvise when it breaks. The concept is less about combat than about controlling a building full of people for as long as you need it.

1. **Plan it, then break it on purpose.** The best moment is a synchronised takeover turn that the player set up during stealth. Going loud should feel like the plan working, not like stealth failing.
2. **The bank runs like clockwork you can read.** Every NPC follows a schedule, senses the world and shows what it will do next. The player wins by reading the bank and deliberately breaking it, not by out-rolling it.
3. **What you carry decides who you are.** One loadout sets conspicuousness (who notices you), command radius (how many people you control), noise, and firepower. The gun locker is also the stealth-versus-loud choice.
4. **Control matters more than killing.** Hostages, crowds, doors and alarm carriers are the real battlefield. A kill is a costly last resort that the simulation remembers.
5. **One general simulation handles every approach.** A small, consistent set of rules applies to every tool, so ramming the front door, blowing a wall and slipping through a vent are all valid and readable. No scripted special cases.

## 2. Tensions

### 2.1 Turn-based grid vs. "the bank goes about its day"
**Problem:** A living bank needs time to pass, and a turn-based grid makes time pass one tap at a time. If a turn is about 5 seconds, crossing the lobby takes 6 turns of nothing. If a turn is about 1 minute, NPCs teleport and the 2-turn hostage command means nothing. Stealth with no clock also has no pressure, and stealth with a clock punishes exploring.

**Resolutions:**
- **1 turn ≈ 15 seconds of bank time.** Moving 5 tiles per action is plausible at that scale, and a stealth phase lasts 40–80 turns (10–20 bank minutes). Schedule events every 8–15 turns: shift change, cash run to the vault, armoured car, manager's lunch, vault time-lock window, closing. That schedule is the stealth clock. Heat does not tick before the alarm.
- **Make quiet turns cheap.** The world phase resolves instantly when nothing notable happens. Add a "Wait until something changes" button, and let the player drag a multi-turn route that auto-advances until an interrupt: a new NPC comes into view, someone's intent changes, suspicion rises, or the unit arrives. Target: no player presses End Turn more than twice in a row with nothing to decide.

### 2.2 The safe-floor overlay vs. a simulation that moves and rolls dice
**Problem:** The brief's best feature, showing where a character can go without being noticed, is a promise. If NPCs move or roll after the player commits, the overlay will eventually lie. One lie destroys trust in the whole stealth layer; players called XCOM 2's red tiles "not 100% reliable" for exactly this.

**Resolutions:**
- **Perception is 100% deterministic.** Every NPC commits to its next path and facing at the end of the world phase and shows it as a faint arrow. The overlay is calculated against those committed positions over the coming world phase (drawn hatched). The preview must call the same function as the real check. That is a hard engineering requirement in the design document.
- **Dice appear only in shot cones, the cover roll and panic decisions.** Panic decisions are rolled at the end of the player turn and shown as intent icons before the player acts again. Unscouted areas are tinted "no data", never "safe".

### 2.3 Individual spotting vs. plausibility and readability
**Problem:** "Each character has to be spotted individually" is right for the mixed-team plan. Taken literally, a guard watches your heavy gun down his partner and then ignores the masked man standing beside him. With no rules for linking characters, it turns into a string of easy ambushes.

**Resolutions:**
- **Information travels physically.** A spotter knows only what they saw. A radio call is a 1-turn, telegraphed, interruptible action that shares a description of the person. Swapping outfit or ditching gear, then breaking line of sight for 2 turns, clears it for everyone except NPCs who saw the change.
- **Explicit linking rule.** A character becomes Exposed if a witness sees them (a) commit an illegal act, (b) show gear in a tier the witness reacts to in that zone, or (c) cooperate with an Exposed character within 2 tiles (handing over an item, reviving, moving with them). Once the bank is loud, an unexposed Clean character counts as a civilian to police. Police may even shout at your sneaker to get down, which is a great emergent beat.

### 2.4 The 2-turn hostage command vs. tedium
**Problem:** 4 crew against 15–25 civilians, re-shouting every 2 turns, is upkeep, not play. Payday players also ignored hostages because their benefit was barely noticeable.

**Resolutions:**
- **Add a Hold stance.** A crew member who keeps commanded NPCs inside their command radius and line of sight at the start of the world phase stops those NPCs' timers from ticking. Commanding costs 1 action but does not end the turn. Commanding 3 or more NPCs at once gives a free 2-tile Reposition move, so control drives momentum.
- **Give hostages a visible benefit.** Each controlled hostage adds +1 turn to the police Negotiate phase (cap +6). Releasing one gives −2 heat (max once per turn, −6 per heist) or trades for an arrested crew member. A lapsed command does not reset the NPC to Calm: they come back Alerted with a grudge, and their next intent is shown.

### 2.5 Heat, turtling and the sandbox
**Problem:** "Heat rises the longer the heist goes on" is a doom clock. If it starts at mission start, it punishes the casing and setup that make up the immersive-sim half (XCOM 2's timer backlash). If it is too weak, players camp in overwatch. Reducing heat by releasing hostages also creates an exploit loop: command, release, repeat.

**Resolutions:**
- **Reinterpret the brief.** Heat starts at 0 and ticks only after the Alarm, on a segmented track: 5 tiers × 5 ticks, +1 tick per turn. Event spikes are listed in §5.6. Before the alarm, only discovered evidence (a body found, a camera seeing a weapon) raises the bank's *vigilance*, not police heat.
- **Escalate instead of failing.** Running out of time brings snipers, then SWAT, then gas and roadblocks, never a mission-failed screen. Police break turtling with flashbangs and teargas from Heat 2 and above, and they breach a different wall when barricades block them. Releasing hostages is capped as above, and a release only counts at an exit the police control, so it costs you that hostage for good.

### 2.6 Aim cones vs. touch precision and fairness
**Problem:** A 16px tile is about 6mm on a phone, well under the 44pt touch minimum. Free-dragging a cone at native scale is a fat-finger lottery. Cones also have to match the simulation exactly: Phoenix Point's shots clipping railings read as bugs.

**Resolutions:**
- **Make aiming forgiving.** Tap a target and the cone snaps to its centre of mass. Dragging is optional fine aim in 1° steps, with a magnified inset drawn above the finger. A separate Confirm button of at least 48dp fires. Selecting a unit automatically zooms the camera 1.6–2× into an "Act" view.
- **Make bullets match the preview.** Hit tests use tile-sized target boxes, never per-pixel sprites. The cone wedge stops at the first full-height blocker. Every body in the cone shows expected hits before the player commits, colour- and shape-coded: hostile, civilian, crew. Bullets fan evenly across the cone (stratified spread, see §5.11), so a 6-bullet burst at a target filling a third of the cone almost always lands about 2 hits.

### 2.7 Per-bullet 50% cover vs. weapon identity
**Problem:** A 50% roll per bullet means 8-bullet SMGs get dependable damage through cover while 2-bullet ARs swing between all and nothing. Without more stats, spray weapons answer every cover position and the AR-vs-Uzi distinction falls apart.

**Resolution:** Fix per-bullet Damage, add Pierce, and give armour a flat per-bullet value (formula and roster in §5.11). The Uzi becomes the tool for unarmoured targets in cover and for crowds, and does nothing to heavy SWAT. The AR and DMR handle armour. Weapons are also balanced by conspicuousness, noise, the penalty for moving before firing, and ammo, not only by spread.

### 2.8 "The simulation should handle it all" vs. scope
**Problem:** Rams, walls you can blow open, sniper nests, traps, barricades, a getaway car placed anywhere: each of these multiplies AI, pathing and QA work. Built as special cases, the project never ships, and the special cases contradict each other.

**Resolutions:**
- **A closed vocabulary of properties.** Tiles and objects have Material (Glass, Soft, Reinforced, Vault, Boundary), BlocksSight, BlocksMove, Cover (none, half, full), HP, Powered and NoiseDamping. NPCs have Role, State, Knowledge, Morale and Schedule. Every tool is defined only by how it changes those properties. A feature that cannot be expressed in them is cut or earns one new general property, never a one-off script.
- **Two canonical tables in the design document:** NPC reaction (Role × Stimulus × Zone → Response) and tool × material. Any player-facing outcome that cannot be predicted from the tables is a bug.

### 2.9 Free-form sandbox vs. procedural maps
**Problem:** Hitman-style freedom comes from authored places with loops, opportunities and readable public and private space. Raw procedural generation gives "10,000 bowls of oatmeal" and can produce banks that are unsolvable or trivial.

**Resolutions:**
- **Three layers.** Hand-designed site plots and bank archetypes (cycle structures), hand-authored room parcels (6–12 variants per room type, each with a gameplay job), and random detail only (prop slots, staffing, schedule, opportunities, which walls are which material).
- **Validate every seed and reject failures** (rules in §5.15).

### 2.10 Many NPCs vs. enemy-turn length
**Problem:** 25 civilians, 6 staff, 3 guards and a police wave, animated one at a time, means minute-long world phases. That kills pacing, especially on phones.

**Resolution:** Fixed world-phase order: civilians, staff, guards, police. Within each group, everyone moves in one simultaneous tween. Budget 2 seconds or less for a quiet world phase and 5 seconds or less for a loud one. The camera pans only to events that matter (a new suspicion, alarm progress, shots at the crew, an escape). Everything else goes to a tappable threat ledger. Offer 1×, 2× and instant speeds, and tap to skip.

### 2.11 The unarmed walk-up vs. challenge
**Problem:** If Clean characters are ignored, one unarmed sneaker can do everything and the heavies are pointless. If they can't do anything, the sneaker is pointless.

**Resolution:** Clean characters can go anywhere in Public freely. Staff areas mean being escorted out, and a second offence exposes them. Secure areas expose them on sight. Unarmed command radius is 1 tile (adjacent only), so a sneaker cannot control a room. Their verbs are systems work: loop or cut cameras, kill the alarm line, unlock the staff door for the van team, steal the keycard, cut phone lines, pre-plant charges. Heavies are needed for crowd control, the drill defence and the police.

### 2.12 Information density at 320×180
**Problem:** Vision cones, sound rings, zones, cover, intents, countdowns and the safe tint all at once become overlay soup on a 6-inch screen.

**Resolution:** Always on: the selected character's safe-floor tint, intent arrows and countdown pips. In context: the sound ring and cone while previewing an action. Long-press shows a single NPC's cones, a tile's cover, or a wall's material. Everything else lives in an overlay drawer. Every state uses shape plus colour, with a fixed icon set readable at 16px.

## 3. Biggest risks to fun, ranked

1. **The sandbox outgrows the simulation.** Each new toy adds special cases, and the result is inconsistent, buggy and never finished. *Mitigation:* the closed vocabulary and two canonical tables from §2.8. Build a greybox one-room bank covering stealth, the takeover, command, zip-ties, a breach and an alarm carrier before any procedural work. V1 toy list: breach charge, barricade, tripwire charge, a vehicle ram on the glass front, a sniper position on a neighbour's roof, a placed getaway car. Everything else waits until v2.
2. **The safe overlay lies once.** *Mitigation:* §2.2. Deterministic perception, overlays calculated against committed NPC moves, and one shared detection function. Add an automated test that replays thousands of random moves and asserts the preview matches the outcome.
3. **Stealth is either a slog or trivial.** *Mitigation:* the schedule as the clock, auto-advance routes, active stealth goals that pay off when loud (keycard, alarm line, cameras, phone line, unlocking a door, pre-planted charges), tools for misdirecting NPCs (a ringing desk phone, a fire alarm, a dropped wallet), and the escalation ladder Calm → Curious → Investigating → Alerted → Alarm, with interruptible rungs.
4. **The loud phase is either hopeless or exploitable.** "Detected means doomed" makes players reload instead of improvising, and endless trickle waves give no room to decide. *Mitigation:* police arrive physically, announced a turn ahead, from staging points. Police cycle Contain/Negotiate → Assault (4–6 turns) → Regroup (2–3 turns), so players can schedule loud work into the breaks. Extraction is always possible, and leaving with less loot is a partial success.
5. **Hostage babysitting.** *Mitigation:* Hold stance, group commands, a felt hostage economy (§2.4), a finite zip-tie supply and visible "twitchy" markers.
6. **Unfair surprises.** An armed civilian who shoots without warning, or a teller who presses the alarm out of nowhere. *Mitigation:* armed civilians are rolled when the bank is generated (about 1 in 20), have a tell visible within 3 tiles or on Inspect, are found by frisking during a zip-tie, and must spend one telegraphed turn reaching for the weapon before they shoot. Every alarm carrier shows a countdown.
7. **Turn pacing on mobile.** *Mitigation:* §2.10, plus autosave after every committed action with exact state restore (the OS may kill the app), heists of 20–40 minutes split into chapters, and a recap card on resume.
8. **Procedural sameness.** *Mitigation:* each bank gets 1–2 headline features, 3–5 seeded opportunities, difficulty that adds new kinds of security rather than bigger numbers, and banks that change if you hit the same chain twice.
9. **Weapon degeneracy or swingy shots.** *Mitigation:* §2.7, stratified spread, a first bullet that always flies down the aim line, and spread seeded per turn so a rewind replays the same rolls.
10. **The campaign snowballs.** *Mitigation:* flat HP (armour is gear, not levels), per-character Notoriety that raises conspicuousness in later heists and forces rotation, contract-set crew sizes, and a campaign clock (an investigation meter).

## 4. Missing pieces the concept must define

- **Win and lose conditions.** A heist succeeds when the minimum loot reaches the getaway vehicle and at least one crew member escapes. Payout tiers come from loot, heat at exit, deaths and styles. A heist fails only when every crew member is out (downed, arrested or dead), or when nobody can reach the getaway.
- **Phase structure.** Planning (one screen) → Casing (optional, everyone Clean) → Execution (stealth, then loud) → Extraction. Who decides when stealth ends, and what does the takeover turn give?
- **Time scale.** What a turn means in bank time, schedule density, and when the bank closes and what closing does.
- **Action economy.** Actions per turn, movement, costs for attack, command, zip-tie, lockpick, carry, reload, overwatch and dash, and whether an action ends the turn.
- **Loot.** Weight classes, effect on movement, bag throwing, carrying two items, the conspicuousness of a carried bag, dye packs, loot that explosions destroy.
- **Vault access.** Per vault tier: a social key (codes from two staff), a technical key (drill, N turns, jams), a violent key (shaped charge or thermite), plus time locks and seismic sensors.
- **Escape and getaway.** Where the vehicle can be placed, arrival time when called, capacity, police blocking routes, ramming, and the off-map driver.
- **Off-map and staged crew.** How the van team waits, is called in, and enters (N turns, through a chosen entry). What the sniper does when not on the grid.
- **Downed, injured, arrested and dead.** Bleed-out timer, revive, carrying a downed teammate, arrest, trading a hostage to recover them, campaign consequences.
- **Non-lethal toolkit.** Melee knockout, taser, how long a knockout lasts, bodies and evidence, guard radio check-ins.
- **Cameras and the control room.** Who watches, how a sighting is confirmed, what a power cut does, how a loop works, and whether footage carries into Notoriety.
- **Doors and locks.** Open or closed doors and their effect on sound and sight, keycards, mantraps, lockpicking, maglocks.
- **Disguises.** Staff uniforms, who sees through them (managers, the guard captain), and whether armour can be hidden (it cannot).
- **Police AI.** Unit types per heat tier, entry logic, behaviour around hostages (no firing through them), how they counter barricades, nests and traps, negotiation.
- **Armed resistance inside the bank.** Guard behaviour once loud, whether guards surrender, and armed civilians.
- **Ammo, reloading and overwatch.**
- **Undo, rewind, saving and difficulty.**
- **Map scale and floors.** Interior size, plot size, a roof layer, and whether there is a basement.
- **Information layers.** What is known before casing (blueprint), what casing reveals, what intel can be bought, and how unknowns are drawn.
- **Between-mission loop.** Money, crew recruitment and pay, gear, Notoriety, campaign length and climax, meta unlocks, monetisation stance.
- **Onboarding.** Hand-authored tutorial banks that teach the zone × tier matrix before procedural banks begin.
- **Fixed vocabulary.** Suspicion, Alert, Alarm, Heat, Exposed. "Alarm" must never mean a local alert.

## 5. Decisions recommended outright

1. **The whole heist is turn-based and side-based.** The crew acts in any order, then the world phase resolves civilians, staff, guards, police. *Why:* coordinated multi-character plans are the fantasy, and interleaved initiative (Chimera Squad) breaks them.
2. **Two actions per character per turn.** A move is up to 5 tiles (4 in heavy armour), and dashing spends both actions for 10 tiles. Pistol, SMG and AR attacks and Command cost 1 action and don't end the turn. LMG, sniper fire and a shotgun breach cost 2. Zip-tie, lockpick, picking up a bag, answering a radio and reloading cost 1. *Why:* readable on a phone and enough room for combos.
3. **A squad of 4 by default.** Contracts set 2–5. Roles: Face, Tech, Muscle, Marksman, Demolitions, Driver, one defining verb each. *Why:* each loss matters, 4 portraits fit on one screen edge, and it avoids steamrolling.
4. **Conspicuousness is 4 tiers computed from gear:** Clean / Concealed / Armed / Heavy. Zones are Public / Staff / Secure. Reactions come from a published lookup matrix. Guards and the control-room operator are "enforcers" one tier more sensitive. Managers and the guard captain see through disguises and carry a badge. *Why:* a small rule set the player can learn, which the overlay can calculate exactly.
5. **Detection uses 0–3 suspicion pips per NPC per character.** Pips are deterministic and decay by 1 per turn out of sight. Instant spotting on: an illegal act in core view, Heavy in core view, Secure zone in core view. Vision is a core arc (6 tiles, 90°) and a peripheral arc (8 tiles, 140°), drawn as tile tints. What an NPC witnesses is recorded immediately, but the NPC acts only in the world phase, so the crew can silence a witness the same turn. *Why:* a visible ladder instead of a cliff, and same-turn double takedowns become the core stealth move.
6. **An Alarm happens only when a carrier finishes its action, and every carrier shows a countdown with at least two counters.** Carriers: a teller reaching the foot rail (1 turn), a guard radioing dispatch (1 turn), the operator confirming a camera sighting (1 turn), a civilian escaping (path plus N turns), a phone call (2 turns), a vault sensor (shown before drilling starts). Counters include commanding, knocking out, blocking the route, cutting the line or power, and looping the feed. *Why:* it delivers the brief's "only when actually triggered" rule in a way the player can intercept.
7. **Sound is a ring calculated by flood fill and drawn clipped.** A closed door costs 3 tiles, a Soft wall 3, and Reinforced or Vault walls block sound. Radii (tiles): walk 0, dash 2, lockpick or zip-tie 1, Command equal to its command radius, suppressed pistol 3, pistol 8, SMG 10, AR or shotgun 12, LMG or DMR 14, breach charge 14, vehicle ram 16, drill 6 per turn. Soft sounds make NPCs Curious; gunshots and explosions make them Alerted. Nobody is spotted from sound alone. *Why:* closing a door and choosing a quiet route become real decisions, and the preview stays true.
8. **The takeover turn.** Before anyone is Exposed, crew can queue Trigger orders that fire when the player presses Go or a crew member is Exposed. In the first world phase after going loud, Unaware NPCs are Stunned for 1 turn, Suspicious ones reposition only, and Command radius is ×1.5 that turn. *Why:* it rewards stealth set-up and makes "Everybody down!" the signature beat.
9. **Heat.** 0 before the alarm. After it: 5 tiers × 5 ticks, +1 tick per turn, +3 for a kill seen by police or a camera, +5 for any civilian death or a cop killed, +1 per turn drilling a top-tier vault, −2 per release (max 1 per turn, −6 per heist). The HUD always shows "Heat N in X turns: what it brings and where it enters". Tier contents:
   - Heat 1: patrol cars.
   - Heat 2: more patrols, flashbangs and gas, a negotiator.
   - Heat 3: SWAT with shields.
   - Heat 4: rooftop snipers and a helicopter.
   - Heat 5: heavy SWAT, roadblocks.

   *Why:* honest pressure that is visible and stepped, that the player can act on, and that never fails the mission outright.
10. **Police come physically, in a rhythm.** They enter from map-edge staging points announced 1 turn ahead, and doors or windows they intend to breach are marked. They cycle Negotiate (+1 turn per hostage, cap +6) → Assault (4–6 turns) → Regroup (2–3 turns). They never fire through a hostage, and they breach elsewhere when barricades block them. *Why:* traps, barricades and sniper nests only matter if police have to walk past them.
11. **Shooting.**
    - Stats: Aim and Recoil in degrees, Bullets, Damage, Pierce, Threat (command radius), Noise, Conspicuousness, and a penalty for having moved (AR ×2, DMR ×6).
    - Damage per hit = max(0, Damage − max(0, Armour − Pierce)), with armour 0–3.
    - Stratified spread: each bullet gets its own slice of the cone, jittered only inside that slice. The first bullet flies down the aim line. Spread is seeded per turn.
    - Fire selector from 1 up to Bullets.
    - Cover: an object in the tile next to the target, whose edge the bullet crosses, blocks 50% of bullets that would otherwise hit. Shown as a half-shield in the preview and greyed out when flanked. Blocked bullets damage the cover (desk 2 HP, glass 1).
    - The preview reads "Hits 2–3 (likely 2) → 6–9 damage → likely KILL", and every body in the cone is shown.
    - Only two random layers: bullet position within its slice, and the cover roll.

    *Why:* honest, bounded variance, and every weapon gets a job.
12. **Starting roster.** Concealed pistol: Threat 3, Bullets 1. Uzi: Damage 2, Pierce 0, Bullets 8, wide cone. Suppressed SMG. Pump shotgun: breaching, pellets fixed, +1 damage within 3 tiles. AR: Damage 4, Pierce 1, Bullets 2–3, tight cone. DMR: Damage 9, Pierce 3, Bullets 1, overpenetrates. LMG: Threat 6, a dragged suppression wedge. Command radius equals Threat: unarmed 1, pistol 3, SMG 4, shotgun or AR 5, LMG 6, +1 for armour.
13. **Hostages.** Command keeps NPCs down for 2 turns, plus a Hold stance (§2.4). Zip-ties: 4 per character, 1 action, adjacent, and include a frisk. A tied NPC can be freed by another NPC spending 2 turns. Hostage uses: negotiation turns, release for heat, trading for an arrested crew member, and deterring snipers at windows. *Why:* control is a resource, not upkeep.
14. **Undo moves freely until new information appears** (a reveal, a roll, an NPC reaction). Turn rewinds by difficulty: Casual unlimited, Normal 3, Hard 1, Ironman 0. A rewind replays the same seed. Every action is two-step: preview, then confirm. *Why:* fat fingers never cost a heist, and players can't reroll their way to lucky shots.
15. **Bank generation.** Site plot, then archetype (cycle type), then vault, then security room in a different wing, then approaches, then the key graph (every hard lock has a social, a technical and a violent key), then parcels, then random detail, then validation. Validation: every approach reaches the vault, at least 2 loops between Public and Secure, a Clean-tier stealth route to the alarm or camera room, no deploy point in view of a guard or camera, no more than 3 guards able to see the same tile, getaway candidates connect to 2 exits. Orientation: the street is always at the bottom and the vault at the top. Size: interior about 40×28 tiles, whole plot about 60×40, lobby no more than 16 tiles corner to corner, ground floor plus roof only in v1. Four wall materials, each with distinct art. *Why:* banks the player can read and plan, with real variety.
16. **Loot.** Light (cash bundles, jewels): no penalty, carry 2. Heavy (cash bag): −2 movement, no dash, throw 2 tiles. Very Heavy (gold, servers): half movement, pistol only, pass to an adjacent ally only. A carried bag adds +1 conspicuousness tier in Public. A minimum bag count is required for success; everything above it is greed priced against heat. *Why:* extraction becomes a moving tactical puzzle and the climax.
17. **Getaway.** Placed during planning on a candidate tile. Arrival time once called depends on the spot (a side street is about 2 turns, the rear garage about 4 but safer). The Driver can reposition it once during the loud phase. Escape is always possible. *Why:* a planned, telegraphed climax instead of a fail state.
18. **Failure costs resources, not the run.** Downed crew bleed out in 3 turns. Left behind, they are arrested, not killed, unless the heat tier allows execution. Arrested crew can be recovered by trading a hostage, or become a rescue contract later.
19. **Campaign.** 8–12 heists building to "The Big One", 6–12 hours. A campaign clock: an investigation meter that kills and loud jobs push forward. Per-character Notoriety that adds conspicuousness. Dirty money must be laundered. Payouts list styles (Ghost, Inside Job, Cowboys, Clean Hands, Fortress), so stealth is never strictly the best way to play. *Why:* every heist matters beyond its own map, without grind or snowballing.
20. **Mobile stance.**
    - Landscape only. The left thumb gets crew and camera controls; the right thumb gets actions, Confirm, and a hold-to-confirm End Turn.
    - Two camera states: Overview and Act.
    - Autosave after every committed action.
    - Premium one-time purchase. No energy systems, ads, daily logins or gacha.

    *Why:* premium turn-based depth works on phones (XCOM: EU on iOS 91 Metacritic), and the brief rules out mobile tropes.
21. **The design document's canonical artifacts:** the zone × tier matrix, the NPC reaction table, the tool × material table, the noise table, the heat tier table and the weapon table. Every feature request is checked against them before it is accepted.