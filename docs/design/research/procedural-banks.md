# Procedural banks

Note on method: the shared web-search budget for this run ran out before my first query, so I could not use WebSearch at all. Everything cited below comes from fetching pages directly (Boris the Brave's generator breakdowns, Darius Kazemi's Spelunky analysis, Kate Compton's essay, Tom Francis's design blog, Wikipedia and the Darkest Dungeon wiki). The Payday and Invisible Inc fandom wikis and the XCOM 2 plot/parcel write-ups were blocked or returned 404. Points marked 'from memory' (some Invisible Inc and XCOM 2 details) are not backed by a fetched source and should be checked.

The generators people remember (Spelunky, Enter the Gungeon, Unexplored, XCOM 2, The Binding of Isaac) do not build levels from raw tiles. They work in three layers. The top layer is an authored structure: a critical path, a hand-made flow graph, one of 24 cycle types, or an XCOM 2 'plot'. The middle layer is a large pool of hand-made rooms: Spelunky has 8-16 templates per room type, Gungeon about 300 rooms for its first stage, XCOM 2 has 'parcels'. Only the bottom layer is random: probabilistic tiles, 5x3 obstacle chunks, mirroring, and where enemies and devices go. The level's structure and pacing are designed, and randomness supplies surprise. Handcrafted alternatives show what depth needs. Hitman uses 'Swiss cheese' layouts with many ways in and out, readable public and private spaces, and NPCs on routines. Critics panned its Colorado level for having no public space. Door Kickers and Monaco stay handmade; Door Kickers' built-in generator is described as limited, and reviewers praised its randomised enemy placement instead.

BankHeist has an advantage most procgen games lack: a bank is a building type everyone already knows how to read. The public front, staff middle and hardened back core (vault, safe deposit, cash room, CCTV room, loading bay) form a grammar that players understand before they see a map. That makes generated banks readable and plannable, provided the generator respects the grammar. It should vary the decisions players make (where the vault is, what kind of lock it has, which neighbours offer approaches, how security is staffed, the day's events), not the furniture. Kate Compton's '10,000 bowls of oatmeal' warning is the central risk. Tom Francis's comparison of Heat Signature with Void Bastards is the other: generated rooms only matter if every room type has a gameplay job.

Recommended recipe, in design terms. (1) Choose a site plot: a city block with street frontage, an alley, a service road and neighbouring buildings. (2) Choose a bank archetype that fixes the loop structure between the approaches and the vault, like Unexplored's cycle types. (3) Place the vault first, then the security room, then the approach points. (4) Build the lock-and-key graph: every hard lock gets at least a social, a technical and a violent key. (5) Fill the zones with security tiers 0-4 from hand-authored room parcels on the 16px grid. (6) Apply micro-variation: props and cover, wall materials, device and NPC placement, daily schedule events. (7) Validate and reject failing seeds: every approach can reach the vault, no dead filler rooms, a stealth path exists, nothing is visible from deploy points. (8) Show the result in a planning view whose information is layered by scouting: blueprint, casing, intel. The 320x180 view (about 20x11 tiles) limits size. A small branch should be about 2x2 screens of interior on a plot of about 3x3 screens, using at most a ground floor plus roof (and an optional basement) shown as separate layers.

## Lessons

### 1. Generate in three layers: authored macro structure, authored room modules, random micro detail. Never build from raw tiles.

**Evidence:** Spelunky: a 4x4 grid of rooms, each room type has about 8-16 templates of about 10x8 tiles, plus probabilistic tiles (e.g. '2' = 50% block, '3' = 33% spike) and 5x3 obstacle chunks, with left-right mirroring. Enter the Gungeon: 4 hand-authored flow graphs for stage 1 and 8 for stage 2, about 300 hand-made rooms for stage 1, and no room repeats within a floor. XCOM 2 dropped procgen for Enemy Unknown, got repetition complaints about its handmade maps, then moved to plots and parcels, which the producer called 'quilts'.

**For BankHeist:** BankHeist needs (a) a small set of hand-designed bank archetypes and site plots, (b) a library of hand-authored room parcels (6-12 variants per room type: teller line, manager office, vault antechamber, CCTV room, break room, server/alarm closet, loading bay, restrooms, safe deposit room), and (c) probabilistic prop slots inside parcels (desk/plant/filing cabinet/nothing) that change cover without breaking the room's role. Parcels can be mirrored and rotated in 90-degree steps on the 16px grid.

### 2. Use loops (cycles), not trees, so there are always at least two ways to the goal.

**Evidence:** Unexplored starts from a loop between entrance and goal and picks one of 24 'major cycle types': two alternative paths, lock-and-key, a 'hub' with the exit locked, a 'lake' around a central space, and 'ThreeLeverHub' where the goal needs three randomly placed keys and a guardian watches the door. Hitman's 'Swiss cheese' rule: several ways in and out, no dead ends that force backtracking.

**For BankHeist:** Define bank archetypes as cycle types. 'Two Wing': a public-side route and a service-side route both reach the vault corridor. 'Atrium Lake': the lobby is the central lake, ringed by offices and a mezzanine. 'Three Keys Hub': the vault needs the manager's card, the CCTV room disabled and the time lock, all in different wings. 'Fortress': one hardened core with many breachable outer walls. Every zone gets at least 2 connections (door plus window, vent or breachable wall). Dead ends are allowed only for rooms meant as traps or hideouts.

### 3. Locks and keys are abstract: a key can be an item, a person, knowledge or a system state. Hard locks need several keys so the player has real choices.

**Evidence:** Unexplored: 'a key can be an item, a switch, or a piece of knowledge', with hard and soft locks, and each key is linked to its lock so the pair survives graph shuffling. Boris the Brave: mission graphs show how much real choice a layout gives; a maze-looking layout can still be linear.

**For BankHeist:** The generator outputs a heist key graph alongside the map. Example: Vault (dual control) = Manager code + Head Teller code (social: coerce two hostages), OR thermal drill for N turns (technical, loud), OR shaped charge (violent, very loud, raises heat). Every hard lock (vault, CCTV room door, staff mantrap, alarm panel) must have at least one social, one technical and one violent key, so stealth, mixed and loud teams can all plan. The planning screen shows this graph as an objectives board, and it also lets the game check that a seed is solvable.

### 4. Place the most important features first, and keep the goal far from the start.

**Evidence:** Gungeon generates 'the parts of the map that are hardest / most important first' and keeps the boss a reasonable distance from the start. Isaac puts the boss in the last (usually farthest) dead end, and its secret room next to three or more rooms.

**For BankHeist:** Order: (1) vault core at the back, away from the street, (2) CCTV/security room (another wing from the vault, so a sneaker has a real trip), (3) alarm panel or electrical room, (4) approach points on the plot, (5) public front and teller line, (6) filler parcels. Rules: the vault is at least 2 doors from any public tile; the CCTV room is not on the vault's corridor; at least one silent-alarm teller station has a clear line to the lobby, so suppressing tellers is a real problem.

### 5. Assemble the site from a street plot and parcels, so the outside of the bank becomes part of the plan.

**Evidence:** XCOM 2's plots and parcels: a large environment layout with randomly generated holes that take buildings or objects. Side missions, enemy placement and reinforcements are randomised on top (Wikipedia). Plot-type details are from memory and unverified.

**For BankHeist:** The brief's freedoms (vehicle ramming, sniper nest in a nearby building, chosen getaway spot, roof or sewer entry) all happen outside the bank, so the plot matters as much as the floor plan. A plot = main street (front, ramming lane), side alley (staff door, dumpster cover), service road (loading dock), and 2-4 neighbour parcel slots chosen from a list: office tower (sniper nest, roof bridge), cafe (shares a wall with the lobby), parking garage (getaway spot, elevated firing line), construction site (scaffold to the roof), empty retail (tunnel start), utility manhole (sewer). Police arrival points sit at the street ends of the plot, which the player can barricade or mine.

### 6. Make the security gradient readable: public, then staff, then secure, then core, with distinct visuals for each.

**Evidence:** Hitman 2016: public spaces let players move freely and learn local norms; private spaces are marked by distinct art and reward curiosity. Colorado was criticised for having no public spaces. Real banks: public lobby and teller line; staff areas behind bandit barriers; the vault behind a day gate; the vault inside the building's structure (Wikipedia, Bank vault).

**For BankHeist:** Security tiers. T0 Street (free). T1 Public lobby (anyone, even armed characters at low suspicion, as the brief says). T2 Staff (seen by staff = 'you can't be back here', you get escorted out and suspicion rises; seen twice = investigate). T3 Secure, keycard (seen = guard investigates, the CCTV operator raises the alarm). T4 Vault core (any presence seen = alarm). Each tier has its own floor material and colour (carpet, linoleum, concrete, steel plate), so the 320x180 art carries the information. The 'safe to walk here' floor overlay from the brief is computed from tier, line of sight and the character's conspicuousness.

### 7. Real bank security features provide ready-made locks, keys and timers. Use them faithfully but scale them for play.

**Evidence:** Time locks block opening until a preset time even with the right combination; they were invented to defeat hostage-coercion robberies (Great Barrington, 1875). Dual-control locks need two people with separate combinations. UL-608 vault classes run from Class M (15 minutes to breach) to Class III (120 minutes); EN 1143-1 grades 0-XIII. Thermal lances are the modern threat. Mantraps: the second door opens only after the first closes, can be run manually by a guard watching a camera, and may have metal detectors. Hold-up alarms are almost always silent and can be triggered by button, foot rail or money clip. Dye packs arm when lifted from their plate and burst at least 10 seconds after leaving the building.

**For BankHeist:** Use vault classes as the difficulty tier. Drill time: Class M = 3 turns, Class I = 5, Class II = 8, Class III = 12, each drilling turn making a large sound circle. Use the time lock as a schedule: the vault opens on its own at turn X (e.g. for the armoured car), which rewards patient stealth players the way a Hitman opportunity does. Dual control turns two specific staff into key holders. A mantrap at the staff entrance with an operator buzzer is a social-stealth chokepoint. Each teller station gets a foot rail (silent alarm) unless the teller is commanded or restrained. Teller-drawer cash may hide a dye pack that ruins it a turn after leaving the building unless the player spends an action inspecting it.

### 8. Aim for variety players can perceive, not variety that only exists mathematically. Each bank needs a headline.

**Evidence:** Kate Compton: 10,000 mathematically unique bowls of oatmeal still read as 'a lot of oatmeal'. Perceptual uniqueness means each output is memorable, but background outputs can be ordinary so the characterful ones stand out. Signs of process (soil pushed up around a tree) make generated things feel real.

**For BankHeist:** Every generated bank gets 1-2 headline features from a curated list: a glass-roofed atrium over the lobby (roof entry, sniper line), a vault in the basement under the lobby (floor breach), a CCTV room on a mezzanine overlooking the floor, construction scaffolding next door, an armoured car delivery mid-heist, a manager working late, or an old bank with a round vault door and thick walls. Mission briefings name the headline. Variation knobs should change decisions (archetype, vault class and lock, approaches available, staffing, events), not shuffle furniture. Add 'signs of process' such as a worn floor path to the staff door, coffee cups in the break room and a smoker's corner by the alley door, which also hint at NPC routines.

### 9. Every room type must have a gameplay job. Filler rooms waste the player's attention.

**Evidence:** Tom Francis on Heat Signature: ship systems existed but 'rarely end up relevant', and only the cockpit mattered. In Void Bastards every area has a purpose (Helm gives the map, Gen powers ships down), which he calls a clear engagement improvement. He warns that universal rules can make play rote ('If X, then Y').

**For BankHeist:** Room roles. CCTV room: operator plus monitors; disable or loop cameras. Electrical/alarm closet: cut power (lights out, cameras off, but staff notice) or the alarm line. Manager office: keycard, half of the vault code, computer intel. Break room: staff uniforms (lower conspicuousness) and staff gathered at shift change. Janitor closet: tools and a hiding spot. Server room: remote camera access. ATM service room: cash cassettes, a secondary loot target. Loading bay: vehicle access, armoured car events. Restrooms: a public hiding spot. To avoid rote play, vary each room's behaviour with knobs: the CCTV operator may be absent at lunch, or cameras may be record-only in small branches with no live operator.

### 10. Mandatory points the player must reach must be reachable, and the routes to them must be visible. Better still, let the player choose them.

**Evidence:** Tom Francis's XCOM 2 VIP extraction: a fixed evac zone on a distant roof, no visible route up, a 2-turn timer and too little movement. He discovered that the zone relocates only by experimenting and reloading.

**For BankHeist:** Getaway vehicle and evac points are chosen by the player from generated candidate spots on the plot (curb, alley, garage level, loading dock). The planning view shows path lengths in turns from the vault to each spot. Vertical connectors (ladders, stairs, roof hatches, scaffolds) are always drawn and highlighted. Never hide a required route. Rules that change things mid-mission (police roadblocks closing a street end) are announced a turn ahead.

### 11. Structure information in layers and make scouting a decision. What the player sees must be accurate.

**Evidence:** Darkest Dungeon: base 25% scouting chance; a scout reveals adjacent corridors and the rooms they lead to, a critical scout reveals two corridors deep, and traps and secret rooms show only through scouting. Monaco: everything outside line of sight is greyed out, but reviewers said it allows little advance planning. Invisible Inc: fog-of-war layouts where information is scarce and spent.

**For BankHeist:** Three knowledge layers. (1) Blueprint: the public floor plan and exterior are always known, from public records. (2) Casing: walking an unarmed character through the open bank during business hours reveals the staff-side layout they can see through doors and windows, plus camera positions in line of sight. The stealth phase doubles as casing. (3) Intel, bought or earned between heists (insider, stolen plans): guard count, vault class, CCTV operator schedule, which neighbour shares a wall. Unknown things are marked unknown (a '?' room or an unscanned wall) rather than hidden, so nothing seen is ever wrong.

### 12. Wall materials are the main structural knob once most walls can be destroyed.

**Evidence:** The brief asks for 'explode most walls'. Real vaults use steel-reinforced modular concrete, and a 3-inch specialised panel can be 10x stronger than an 18-inch standard one. The historical sewer-tunnel heist (Bank of Australia, 1828). XCOM 2's destructible parcels still keep a readable map.

**For BankHeist:** Four materials, each with its own art. Drywall or glass partition (any tool or small charge; a quiet breach is possible). Brick exterior (charge; loud). Reinforced concrete (shaped charge or thermal lance over several turns). Vault armour (drill or lance only). The generator guarantees at least one brick exterior wall next to a T2 or T3 room (wall-breach approach). In some archetypes the vault touches a neighbour or basement wall (tunnel approach). Glass storefronts on the main street are the ramming lane. If every wall breaks equally, layouts stop mattering, so the materials have to differ.

### 13. Guarantee several approaches of different kinds and show them on the plot.

**Evidence:** Hitman's fortress levels vs snailhouse levels, with multiple entry points. Monaco's characters (Mole digs through walls, Locksmith, Hacker shuts down security) open different routes through the same level. Heists on the Payday 2 Wikipedia page split into stealth and loud with escalating assault waves.

**For BankHeist:** Each bank guarantees at least 4 approach points from at least 3 categories. Social: front door (open hours), staff side door with keycard or mantrap. Covert: roof hatch or skylight, sewer or basement, air duct where the archetype allows. Forced: wall breach, rolling door at the loading dock, vehicle ramming through the glass front. Planning shows each approach with an icon and what it requires (tool, character skill, noise). The mixed-team play in the brief needs at least one covert approach to the CCTV or alarm room.

### 14. Raise difficulty by adding new kinds of security system, not just bigger numbers.

**Evidence:** Invisible Inc corporations each bring their own guard and device sets, and difficulty rises day by day (from memory; corp details unverified). Payday 2 assault waves move through police, FBI, contractors and Homeland Security unit types. Tom Francis on XCOM snowballing suggests per-mission squad-size limits and 'low profile' missions that bar famous soldiers.

**For BankHeist:** Bank tiers. Small-town branch: 1 guard, record-only cameras with no operator, Class M vault with a time lock. City branch: 2 guards, a live CCTV operator, staff mantrap, Class I-II vault, dye packs. Regional HQ: a security team on patrol routes, motion sensors in the vault, armoured car bay, Class III dual-control vault, 2 floors. Private or reserve bank (finale): biometric doors, a vault seismic sensor that alarms on drilling, an armed response team on site. Tiers can also cap crew size or ban 'known' characters to stop snowballing.

### 15. Size maps for the screen. On a phone a small view and a large map both hurt.

**Evidence:** Some critics found Hitman 2016 levels too big. Spelunky levels are about 40x32 tiles (4x4 rooms of about 10x8). Isaac floors start at 7-8 rooms and grow by about 2-3 per level. BankHeist's view is about 20x11 tiles.

**For BankHeist:** Small branch interior about 32x22 tiles (about 2x2 screens). City branch about 40x28. Regional HQ about 48x32 plus a second floor. Whole plot including street and neighbours about 60x40. Firefight distances (cone weapons) should mostly fit on one screen: keep the lobby within about 16 tiles corner to corner. Parcels snap to a coarse 4-tile sub-grid for clean composition, and corridors are 2 tiles wide where squads must pass each other.

### 16. Use fixed orientation conventions so every generated bank reads at a glance.

**Evidence:** Void Bastards: when the Helm (map) is missing, players fall back on a consistent search order. Readability depends on a stable way to orient yourself (Tom Francis).

**For BankHeist:** Convention: the main street always runs along the bottom of the map, public spaces are at the front (bottom), and the secure core is at the back (top). The service road or alley is at the top or a side. Variation comes from corner lots (a second street on the left or right), mezzanines and neighbour parcels. Players learn 'the vault is up and back' while still having to work out the route each time.

### 17. Validate every seed with generate-and-test checks, and use the key graph to check solvability.

**Evidence:** Kate Compton: list deal-breaker constraints and use generate-and-test, but beware many compounding constraints that make passing outputs rare. Unexplored keeps lock-key links so the game can find and fix blockages. Gungeon retries room choices up to 3 times before backtracking; Isaac relaxes secret-room criteria after 300 and then 600 attempts.

**For BankHeist:** Deal-breaker checks. Each guaranteed approach reaches the vault. At least one fully stealthy route exists to the CCTV or alarm room for an unarmed character. No deploy point is inside a camera or guard view cone. Every camera covers a tile someone must cross. Silent-alarm stations and civilian exits are within reach of the lobby. The player's getaway candidates connect to the street. If too many seeds fail, loosen constraints in a fixed order (as Isaac does) rather than failing the seed.

### 18. Let the bank's daily schedule be the clock and the source of opportunities, rather than an arbitrary turn timer.

**Evidence:** Invisible Inc's alarm rises every turn and brings more security. XCOM 2 turn timers got mixed reviews: 'merciless' (Destructoid) vs tension that encourages risk (Eurogamer). In Hitman, NPC routines and disrupting them (e.g. destroying the virus in Sapienza changes a target's loop) create opportunities.

**For BankHeist:** The generator writes a schedule for each bank. Examples: shift change at turn 8 (staff gather in the break room); armoured car at turn 14 (vault time lock opens, armed couriers in the bay); manager's lunch at turns 10-16 (office empty, keycard leaves with them); closing time at turn 20 (customers leave, which is good for stealth, but the vault seals). Heat from elapsed time (brief) runs alongside but is softened by these optional windows, and the schedule is visible after casing or intel.

### 19. Randomising NPCs, devices and schedules gives replay value even when parcels repeat. Let players replay a bank.

**Evidence:** Rock Paper Shotgun praised Door Kickers' 'randomised enemy placements' on handmade maps. Hitman built replay around few, deep, well-learned levels (mastery, new starting points, escalations). Monaco's later levels were criticised as trial-and-error.

**For BankHeist:** Separate the 'layout seed' from the 'population seed'. A layout can be replayed with a new population (guard posts, camera positions within allowed slots, which teller has the dye pack, which civilian is armed). Seeds can be shared and replayed. Campaign banks can be revisited at a higher alert tier (more guards, cameras moved) for a Hitman-style mastery loop without trial-and-error memorisation.

### 20. Consider a hybrid: handcrafted landmark heists plus procedural branches, or handcrafted set-pieces inside procedural sites.

**Evidence:** Hitman's six dense handmade levels were praised for depth; Door Kickers' campaigns are handmade and its generator is limited; Monaco is fully handmade around its character abilities. XCOM 2 moved from handmade to plot/parcel to fix repetition but kept authored parcels.

**For BankHeist:** Hand-design the vault-complex parcels (antechamber, day gate, vault, safe deposit wing) as rich set-pieces with built-in variations, because the most-visited space deserves the most authoring. Optionally hand-make 3-5 story 'landmark banks' for campaign milestones, with procedural branches between them.

### 21. Civilian exits, alarms and hostage geography should be deliberate generator outputs, because they set how hard the loud phase is.

**Evidence:** Isaac and Gungeon place special rooms using topology (dead ends, intersections). Real banks have silent hold-up alarms at teller stations and offices, monitored all the time (Wikipedia, Panic button). The brief says uncommanded NPCs run for doors or alarms.

**For BankHeist:** Generate 2-4 civilian exits (front door, fire exit, staff door, loading bay) and 3-6 alarm triggers (teller foot rails, manager desk button, CCTV room panel) at controlled distances from crowd spawns. Busy archetypes have crowds near exits (hard loud phase); quiet ones keep crowds away. Barricading an exit in the planning phase is an approach choice. The planning view should show likely civilian flight routes once the layout is known.

## Pitfalls

- Oatmeal variety: randomising furniture and room order while archetype, vault, approaches and security stay the same makes every bank feel identical (Kate Compton).
- Filler rooms with no gameplay role (Heat Signature's mostly irrelevant ship systems). Every parcel type needs a job, or the extra map space just costs the player's attention on a small phone screen.
- Fixed or unreachable required points and hidden vertical routes (Tom Francis's XCOM 2 evac fiasco). Never generate an exit, evac or objective without a visible, validated path.
- Unfair hidden information: secret cameras or unseen guards in places the player was told were clear. Mark unknowns as unknown instead.
- Levels too big for the view: Hitman critics found some levels too big, and at about 20x11 visible tiles a big bank means constant panning and lost track of squad members.
- Arbitrary turn timers felt as 'merciless' (XCOM 2 reviews). Tie time pressure to the world's schedule and heat rather than a bare countdown.
- Trial-and-error memorisation (Monaco's later levels, Teleglitch's punishing difficulty). Randomised layouts with instant failures make players replay rather than plan.
- No public space (Hitman's Colorado). The bank's open lobby is what makes social stealth and casing work, so never generate a bank without it.
- Uniform destructibility: if every wall breaks equally, layout stops mattering. Wall materials must differ visibly and mechanically.
- Compounding constraints that make passing seeds rare. Design parcels so most combinations already work, and relax rules in a fixed order.
- Copying reality too closely: real holdups are mostly 'note jobs', branches hold little cash (average UK haul in 2007 was about US$46,600), and many new branches drop safe deposit boxes. Loot and security need fictional scaling.
- Rote 'If X then Y' play when every room type behaves the same in every bank (Tom Francis on Void Bastards). Vary room behaviour with knobs such as operator absent, record-only cameras or a manager working late.
- Monaco-style fog of war with little advance planning. BankHeist promises planning (sniper nests, getaway placement, traps), so it needs a strong pre-deployment information layer.

## Ideas

- Recipe step 1 - Plot: pick a city-block template (mid-block, corner lot, plaza front, strip-mall end). Main street at the bottom, alley and service road at the top or side, 2-4 neighbour slots, police entry points at the street ends.
- Recipe step 2 - Archetype: pick a cycle type (Two Wing, Atrium Lake, Three Keys Hub, Fortress, Basement Vault, Mezzanine Watch). It fixes the loop between the approaches and the vault.
- Recipe step 3 - Core first: place the vault parcel (class and lock type set by the tier), then the CCTV/security room in another wing, then the alarm/electrical closet, then the approach points that the archetype and neighbours allow.
- Recipe step 4 - Key graph: for each hard lock, attach social, technical and violent keys, and place the key holders (manager, head teller, guard with keycard) with schedules.
- Recipe step 5 - Fill zones T1-T3 with authored parcels (6-12 variants per type) on a 4-tile sub-grid. Mirror or rotate them, and roll probabilistic prop slots for cover.
- Recipe step 6 - Population and schedule seed: guards, cameras in allowed slots, the customer crowd for the time of day, the armed-civilian roll, the dye-pack teller, and events (shift change, armoured car, manager lunch, closing).
- Recipe step 7 - Validate: approach reachability, a stealth route to CCTV/alarm, no deploy point under watch, every camera meaningful, civilian exits and alarm distances within band, getaway candidates connected. Relax rules in order on failure.
- Recipe step 8 - Present: briefing with the headline feature, blueprint layer, casing layer, intel layer, and a key-graph objectives board.
- Variation knobs that change decisions: bank tier; archetype; vault class (M/I/II/III) and lock (combination, dual control, time lock, biometric); CCTV staffing (none, record-only, live operator, operator plus guard); neighbour set; time of day and crowd density; daily event; wall-material profile (old stone bank vs modern glass branch); floor count.
- Headline features list: glass atrium roof, basement vault under the lobby, mezzanine CCTV room, scaffolding next door, armoured car delivery mid-heist, manager working late, an old bank with a round vault door and 1-metre walls, a bank inside a mall (crowds, many exits), a drive-through teller lane (vehicle approach to a teller window).
- Time lock as schedule: the vault opens itself at a known turn for the armoured car, letting patient stealth crews walk in rather than drill. This is a Hitman-style opportunity tied to the world.
- Dual-control vault: two specific staff each hold half the code, which creates hostage objectives and a reason to keep the right NPCs alive and close.
- Dye packs: some teller-drawer cash is trapped. If unchecked it bursts 1 turn after leaving the building and ruins part of the take. An 'inspect' action, or an insider's intel, finds it.
- Staff mantrap with an operator buzzer: a social-stealth chokepoint. A disguised or unarmed character can be buzzed through, while a heavily armed one stuck inside is a disaster.
- The CCTV operator has fewer monitors than there are cameras (e.g. 4 screens cycling 8 cameras), shown to the player as a rotating coverage pattern once the CCTV room is scouted.
- ATM service room and safe deposit boxes as optional side loot. One random box holds intel or a blueprint for the next heist, which ties the campaign together.
- Neighbour affordances: office tower (sniper nest, roof zipline), cafe (shared wall with the lobby, casing from a window seat), parking garage (getaway spot, elevated firing line), construction site (scaffold to the roof, breaching tools), vacant shop (tunnel start), manhole (sewer to a basement vault).
- Floor materials as tier coding: carpet (public), linoleum (staff), bare concrete (secure), steel plate (vault). The 'safe to walk' overlay sits on top and changes per selected character.
- 'Signs of process' set dressing that also hints at routines: worn floor path to the staff door, a smoker's corner by the alley door with cigarette butts, coffee cups in the break room, a cash cart parked by the vault at delivery time.
- Separate layout and population seeds, so a bank can be replayed with new guards and cameras, or revisited later in the campaign at a higher alert tier.
- Civilian flight-route preview in planning: once the layout is known, arrows show where panicked civilians would run, so players can plan barricades and commanders' positions.
- An optional pre-heist casing day as its own short, zero-risk-of-combat visit, or simply treat the open-hours stealth phase as casing and let blueprint and intel fill the gaps.

## Open questions

- How many floors? Ground plus roof keeps the map readable at 320x180. Basements and mezzanines add the best headline features but need a clean layer UI on mobile.
- Is casing a separate pre-mission visit, or is the open-hours stealth phase itself the casing? How much of the layout is known at deployment?
- Fully procedural campaign, or handcrafted landmark banks with procedural branches? How much authoring budget is there for room parcels (at least 100 needed for variety)?
- Can a bank be revisited (higher alert, moved cameras), and should seeds be shareable or replayable? Shareable seeds are fine; a daily seed may drift toward a mobile-game trope.
- How much of the plot (street, neighbours) is playable during the heist, versus used only for planning (sniper nest, getaway placement, vehicle ram)? This roughly doubles the area to generate and validate.
- How granular is destruction: wall segments per 16px tile, or whole wall panels? Does it affect line of sight and cover in ways the generator must check?
- Should vault class map to fixed drill turns (as proposed), or to noise-per-turn with interruptible progress?
- How does disguise interact with tiers? Do staff uniforms from the break room let T2 be crossed, and does that undercut the brief's gear-conspicuousness system?
- How do police reinforcements enter: only from plot street ends (which the player can mine or barricade), or also from roof and helicopter at high heat?
- Should NPC daily schedules be fully simulated from the generator's event list, or scripted per parcel with a few global events?

## Sources

- [Boris the Brave - Dungeon Generation in Unexplored (cyclic generation, 24 cycle types)](https://www.boristhebrave.com/2021/04/10/dungeon-generation-in-unexplored/)
- [Boris the Brave - Dungeon Generation in Enter the Gungeon](https://www.boristhebrave.com/2019/07/28/dungeon-generation-in-enter-the-gungeon/)
- [Boris the Brave - Dungeon Generation in Binding of Isaac](https://www.boristhebrave.com/2020/09/12/dungeon-generation-in-binding-of-isaac/)
- [Boris the Brave - Lock and Key Dungeons](https://www.boristhebrave.com/2021/02/27/lock-and-key-dungeons/)
- [Boris the Brave - Graph Rewriting](https://www.boristhebrave.com/2021/04/02/graph-rewriting/)
- [Darius Kazemi - Spelunky Generator Lessons (part 1: room grid and critical path)](https://tinysubversions.com/spelunkyGen/)
- [Darius Kazemi - Spelunky Generator Lessons (part 2: room templates, probabilistic tiles, obstacles)](https://tinysubversions.com/spelunkyGen2/)
- [Kate Compton - So you want to build a generator (10,000 bowls of oatmeal)](https://galaxykate0.tumblr.com/post/139774965871/so-you-want-to-build-a-generator)
- [Tom Francis - Void Bastards Vs Heat Signature](https://www.pentadact.com/2021-07-30-void-bastards-vs-heat-signature-a-completely-objective-analysis/)
- [Tom Francis - A Leftfield Solution To An XCOM Disaster (fixed evac zone problem)](https://www.pentadact.com/2017-09-14-a-leftfield-solution-to-an-xcom-disaster/)
- [Tom Francis - Solving XCOM's Snowball Problem](https://www.pentadact.com/2016-02-25-solving-xcoms-snowball-problem/)
- [Tom Francis - Rewarding Creative Play Styles In Hitman](https://www.pentadact.com/2016-05-14-rewarding-creative-play-styles-in-hitman/)
- [Wikipedia - XCOM 2 (plot and parcel system, mission timers reception)](https://en.wikipedia.org/wiki/XCOM_2)
- [Wikipedia - Hitman (2016) (Swiss cheese design, public/private spaces, Colorado criticism)](https://en.wikipedia.org/wiki/Hitman_(2016_video_game))
- [Wikipedia - Invisible, Inc.](https://en.wikipedia.org/wiki/Invisible,_Inc.)
- [Wikipedia - Heat Signature](https://en.wikipedia.org/wiki/Heat_Signature_(video_game))
- [Wikipedia - Door Kickers](https://en.wikipedia.org/wiki/Door_Kickers)
- [Wikipedia - Monaco: What's Yours Is Mine](https://en.wikipedia.org/wiki/Monaco:_What%27s_Yours_Is_Mine)
- [Wikipedia - Payday 2](https://en.wikipedia.org/wiki/Payday_2)
- [Wikipedia - Teleglitch](https://en.wikipedia.org/wiki/Teleglitch)
- [Darkest Dungeon Wiki - Scouting](https://darkestdungeon.wiki.gg/wiki/Scouting)
- [Wikipedia - Bank vault (construction, dual control, time locks, UL-608 / EN 1143-1 ratings)](https://en.wikipedia.org/wiki/Bank_vault)
- [Wikipedia - Time lock](https://en.wikipedia.org/wiki/Time_lock)
- [Wikipedia - Mantrap (access control)](https://en.wikipedia.org/wiki/Mantrap_(access_control))
- [Wikipedia - Dye pack](https://en.wikipedia.org/wiki/Dye_pack)
- [Wikipedia - Panic button (hold-up alarms)](https://en.wikipedia.org/wiki/Panic_button)
- [Wikipedia - Bank robbery](https://en.wikipedia.org/wiki/Bank_robbery)
- [Wikipedia - Armored car (valuables)](https://en.wikipedia.org/wiki/Armored_car_(valuables))
- [Wikipedia - Branch (banking)](https://en.wikipedia.org/wiki/Branch_(banking))
- [Wikipedia - Safe deposit box](https://en.wikipedia.org/wiki/Safe_deposit_box)
