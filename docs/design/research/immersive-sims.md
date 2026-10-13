# Immersive sims & sandbox stealth

Immersive sims and sandbox stealth games teach BankHeist one main thing: freedom only feels like freedom when the rules are consistent, few, general and visible. Every designer in this research makes the same point from a different side. Spector's Deus Ex postmortem says "general solutions are better than special casing", "more than one way past an obstacle, always", and "without real, predictable consequences, choice is irrelevant". Harvey Smith says Deus Ex's successes came from flexible sub-systems and its failures from special-case scripting, for example a forced alarm that left players feeling robbed. Looking Glass found Thief's stealth "didn't work" until it showed the player their visibility (the light gem). Mark of the Ninja drew every sound as a ring and stated the rule in one line: if the ring overlaps an enemy, they hear it. Players who don't like stealth enjoyed it because they could plan instead of learning by failure. For BankHeist this means the brief's promise that "the simulation should handle it all" has to be met by a small set of object and NPC properties that every tool works through: wall material, sightline blocking, cover, noise, and NPC stimulus reactions. It cannot be met with per-scenario scripts.

Hitman (2016 onward) is the closest model for the stealth phase. It sorts player behaviour into suspicious and illegal actions. Legality depends on the zone you are in (public, trespassing, hostile) and on what you are wearing. Only marked 'enforcers' can see through a disguise. This fixed Absolution's hated rule that everyone wearing the same outfit saw through you. Crowd reactions are concentric zones driven by events: drawing a gun puts people in the line of fire prone, makes nearby people panic and makes people further out alert. NPCs keep private knowledge, which spreads through shared 'services' with a delay. Payday 2 uses the same zones (public, private, secure) plus a per-player detection risk. These map almost one to one onto the brief's 'conspicuousness', 'off-limits areas' and 'command NPCs to stay down'. The bigger-weapon/bigger-command-radius rule is simply Hitman's prone zone, and a design that also widens the panic zone gets a built-in trade-off for free. Information should travel physically: an alarm is raised by a person who walks to a button, phone, guard or exit, or by an observer watching a camera feed. That gives the player a counter to every alarm, namely intercepting the carrier. It also makes the brief's 'actual alarm only when actually triggered' rule something the player can read.

Turn-based stealth (Invisible Inc, Hitman GO) adds two lessons. First, detection should be deterministic and previewable. Klei's aim was that "when you die, it's your fault", with no random rolls on being seen. Randomness belongs in the aiming cone and the cover-block roll, and NPC intent should be telegraphed a turn ahead. Second, a rising alarm tracker that ticks each turn is the turn-based answer to the timer problem. Teardown's designer says "nobody likes a timer" but still needed one, because generous tools remove scarcity as a source of challenge. He rejected a random pursuing helicopter because randomness "discourages strategic thinking and careful planning". Teardown also shows that the player should choose when to switch from preparation to action, and that its single save slot, locked once the alarm sounds, encourages experimenting. Rainbow Six Siege and Teardown show how to keep destruction readable: a few material tiers that look clearly different (soft, reinforced, hard), very few indestructible surfaces, clean breaching tools versus messy explosives, and barricades that block sight but not bullets. The pitfalls are well documented: opaque simulations (Trespasser, early Thief), trial-and-error determinism (Hitman GO reviews), scripted forced alarms, arbitrary caps (complaints about Payday's pager limit), guidance that overwhelms the sandbox (Hitman 2016's Paris was 'incomprehensible' in user research), and morality systems that feel like punishment (Dishonored 1's chaos).

## Lessons

### 1. Make every interaction run through general object properties, not special-case scripts. A small property vocabulary multiplies into emergent combinations.

**Evidence:** Spector's Deus Ex postmortem says 'General solutions are better than special casing' and calls special-cased mission scripting a costly mistake. Harvey Smith says Deus Ex's successes 'relied on the interaction of flexible sub-systems' and its failures on 'special-case triggering or scripting'. He gives the example of objects carrying ballistic, heat and electric properties that the receiving objects respond to. Mark Brown (GMTK) says immersive sims avoid scripted events in favour of 'a consistent series of rules and systems'.

**For BankHeist:** Define a closed property set before designing any tool. Tiles and objects have Material (Soft / Reinforced / Hard / Glass), BlocksSight, BlocksMove, CoverValue (none/half/full), Flammable, Powered and Noise-damping. NPCs have Role (civilian/staff/guard/security-observer/police), Morale, Knowledge and State. Every tool (C4, ram vehicle, thermite, barricade, trap, power cut, smoke) is defined only by how it changes these properties. When the director asks 'can the sim handle X?', the test is whether X can be expressed in the property set. If it can't, either cut X or add one general property, never a one-off script.

### 2. Sort player behaviour into tiers of legality that depend on where you are and what you look like, so NPC reactions are predictable.

**Evidence:** Hitman's alert system separates suspicious actions (climbing, being seen by an enforcer), which cause a brief look or follow, from illegal actions (weapon in view, picking up illegal items), which instantly create witnesses. Payday 2's social stealth has Public areas (not suspicious), Private areas (civilians ignore you but guards and cameras don't) and Secure areas (everyone detects you). In Hitman, a guard who catches you trespassing first orders you back to the public area and only fights if you refuse.

**For BankHeist:** Give the bank three zone types, colour-coded on the floor when a character is selected. PUBLIC (lobby, ATM area): only Heavy or visibly armed characters cause alarm. STAFF (behind the counters, offices): staff and guards challenge an intruder, a guard spends 1 turn walking up and orders the character out, and refusing makes that character Made. This is a warning, not an alarm. SECURE (vault corridor, security room, server room): any guard or camera that sees a crew member makes them Made at once. Combine this with a conspicuousness tier per character (see the next lesson) to get a small lookup matrix of zone × tier → reaction. Show that matrix in the manual and the tutorial.

### 3. Conspicuousness should change which NPCs care and at what range, not only whether you are noticed. Keep 'enforcers' a minority.

**Evidence:** Hitman Absolution was heavily criticised because every NPC wearing the same outfit saw through your disguise, which made disguises 'essentially useless'. The World of Assassination games fixed this with a small set of 'enforcers' marked as white dots, while 'crowd NPCs won't directly react to 47 behaving illegally' and only cower at violence. In Payday 2, armour and weapon bulk raise detection risk, and the Chameleon skill page notes that unmasked players can still be detected by walking too close to a guard or lingering near a camera.

**For BankHeist:** Use four conspicuousness tiers, computed from gear. CLEAN (no visible gear): ignored everywhere except STAFF/SECURE zones. CONCEALED (pistol, SMG, light vest under a jacket): noticed only within 2 tiles of a guard, which is 'frisk range', or anywhere in SECURE. ARMED (visible rifle or shotgun): noticed anywhere in a guard's or staff member's vision cone. HEAVY (LMG, heavy armour, drill bag, mask on): noticed by anyone in line of sight, civilians included, and they panic. Mark the NPCs who enforce for the selected character's tier with a small floor marker, so the player can see who can blow their cover. Most civilians should only react to violence and HEAVY.

### 4. Players must be able to read what the AI perceives, or stealth feels arbitrary.

**Evidence:** Paul Neurath on Thief's development: players 'didn't necessarily know what the guard was thinking, or how well you were hiding', and 'a lot of [the system] just doesn't work' until visibility was fed back to them through the light gem. Harvey Smith cites Trespasser as an 'overly complex simulation' that lacked 'the requisite control and feedback'. Klei's Invisible Inc. UI aimed for 'when you die, it's your fault'.

**For BankHeist:** The safe-move overlay in the brief is the light gem of BankHeist and must be a strict promise. A tile marked safe for the selected character's tier, and for this turn, must never get them Made by perception alone. Use three floor states: safe (no change), will be noticed (amber, shows which NPC with a sightline tether), and will be Made (red). Detection should be deterministic. Show the reason in one word on long-press or hover, for example 'Guard sees ARMED' or 'Camera: SECURE zone'.

### 5. Show noise as literal circles that follow one stated rule, and preview them before the player commits.

**Evidence:** Nels Anderson on Mark of the Ninja: every noise enemies can hear is 'a ring that spreads outward and if that ring overlaps an enemy, they hear it'. He says 'clarity was the point', and players who normally dislike stealth enjoyed it. The design was meant for anticipation, not reaction. Harvey Smith praises Deus Ex 2's sound model because players could predict hearing: 'guards will not hear sounds that are blocked by multiple thick walls.'

**For BankHeist:** Every action that makes noise shows its ring during targeting, before confirmation, with each NPC it would alert highlighted. Use a fixed radius scale in tiles: e.g. footsteps 0, running 2, a suppressed pistol 3, lockpicking 1, a shouted command equal to the command radius, an unsuppressed rifle 10, breaching drywall 8, C4 on reinforced wall 14, a drill 6 per turn, a vehicle ram 16. Pick one wall rule and draw it: Soft walls cut the radius by 2 tiles and Hard walls block it entirely, with the drawn ring clipped to match. Don't add hidden falloff. If the ring touches an NPC, they are alerted.

### 6. Event intensity should drive concentric NPC reaction zones. The weapon-scaled command radius in the brief should come with a matching panic radius.

**Evidence:** In the AI of Hitman write-up, drawing a gun near bystanders creates three zones: prone for those in the line of fire, panic for those nearby, and heightened alertness further out. Overlapping zones resolve to the strongest mood. Crowds flee along precomputed flow fields to exits and reroute when exits are blocked. In Hitman crowd agents 'never calm down once triggered'.

**For BankHeist:** Turn 'Command' into a three-ring event. The inner COMMAND ring is set by weapon (pistol 3, SMG 4, shotgun 4, rifle 5, LMG 6 tiles, plus a bonus when several crew members shout in the same turn): NPCs in it get down for 2 turns. The middle PANIC ring is the command ring plus 3: NPCs in it are scared and roll to flee, hide or reach an alarm. The outer ALERT ring is the noise ring: NPCs there investigate or call it in. A bigger weapon controls more people but also scares more people just outside its reach. Fleeing NPCs head for the nearest open exit or alarm point, so barricading doors and positioning the crew changes where they run.

### 7. Alarms should be carried by people and wires the player can intercept, not raised instantly by a global state.

**Evidence:** Hitman NPCs hold private knowledge from sight and hearing. Shared 'services', such as compromise status and last-seen location, update periodically 'so information can go stale', and civilians report to guards instead of fighting. In Hitman 2, camera footage goes to a monitoring room whose staff dispatch the nearest guards, and recordings can be destroyed at the recorder. Harvey Smith calls a forced, unavoidable alarm in Deus Ex a failure that left players 'robbed'.

**For BankHeist:** An Alarm happens only when an alarm carrier completes its job. Carriers include a teller who reaches a silent-alarm button (shown as an intent icon with path and a turn count), a civilian who gets out through an exit, a guard who radios in (takes 1 full turn standing still and can be interrupted), the security-room observer seeing a crew member on a feed, a pressure plate or seismic sensor tripping, or a vault drill alarm after N turns. Each one shows a countdown on the enemy turn. Each has at least two counters (subdue, block the path, cut the power or line, distract the observer, destroy the recorder). Never trigger an alarm by script.

### 8. Make detection deterministic and confine randomness to combat resolution and telegraphed NPC choices, so that planning is rewarded and not luck.

**Evidence:** Invisible Inc. uses no random hit rolls. Guards are lethal but predictable, a one-tile reaction move is allowed when you enter vision, and the UI warns about dangerous tiles outside your view. Hitman GO's guards 'follow the same pattern unless they're interrupted, making infiltration a matter of skill rather than luck'. Teardown's designer removed a random pursuing helicopter because randomness would 'discourage the strategic thinking and careful planning'.

**For BankHeist:** Stealth outcomes (who sees whom, who hears what) are 100% deterministic and previewed. Randomness goes into the cone shot, the 50% cover block, and NPC decisions under panic, such as whether a scared civilian runs, hides or reaches for an alarm. Those decisions are rolled at the end of the player turn and shown as intent icons before the player acts again, as in Into the Breach. The hidden-weapon civilian is the one surprise. Give a tell for it, for example a 'nervous' tag visible within 3 tiles or found by a frisk action.

### 9. A ticking escalation track is the honest way to add pressure to a generous sandbox. Make it visible and deterministic.

**Evidence:** Teardown's designer admits 'nobody likes a timer', but with generous tools the only alternative was resource limits, which clash with a sandbox. So the alarm gives 60 seconds after the first theft. In Invisible Inc., the alarm tracker fills a segment each turn and also from hacking or guards being alerted, and each full bar adds cameras and guards. Reviewers say this stops players searching every room and keeps tension high.

**For BankHeist:** Heat is a segmented track (e.g. 5 segments per level, levels 1-5). Once the alarm is raised it gains 1 segment per turn, and events add more: police see a kill +3 segments, a civilian killed anywhere +5, a cop killed +5, drilling a level-3 vault +1 per turn. Each heat level unlocks a known reinforcement tier (patrol cars → SWAT van → snipers on rooftops → armoured breach team → helicopter), shown as an 'arrives in N turns' pip on the HUD. Before the alarm, the time pressure comes from the bank's daily schedule (shift change, armoured truck, vault time-lock window, closing time) rather than heat, so stealth still has a clock without a timer.

### 10. Let the player decide when preparation ends and the loud phase starts, and support trying a plan and going back to planning.

**Evidence:** Teardown settled on a two-phase heist after about a year of prototypes: free preparation, then an action phase the player starts, and 'it's important that this is the players decision.' It has one quicksave slot, available during prep and disabled once the alarm sounds, to encourage experiments without removing tension. Critics note that around 98% of Teardown play is prep for a 60-second run, which got repetitive.

**For BankHeist:** Structure each heist as three phases: CASING (optional, one character walks in clean to scout, reveals the layout and opportunities, and can plant small things), SETUP (an off-map planning screen where you place the getaway vehicle, pick the sniper-nest building, choose entry points and pre-place assets from a budget), and EXECUTION. The player chooses to 'go loud' by any loud act. Offer free undo or one save slot while the alarm hasn't been raised, locked once it sounds, with an ironman option. Keep prep short (minutes, not most of the session) by making most setup happen inside the turn-based execution, not in a separate building toy.

### 11. Treat obstacles as problems with several solutions, and generate levels with loops and multiple entrances.

**Evidence:** Spector's rules are 'Problems not puzzles. It's an obstacle course, not a jigsaw puzzle', 'more than one way to get past a game obstacle. Always', and maps with 'massive interconnectivity' where straight tunnels from A to B are bad and loops and multiple entrances are good. He admits the team often had to brute-force this by planning separate skill, action and social paths. Thief and Dishonored design guidance says that if a guard can't be bypassed, another path must exist.

**For BankHeist:** Give the procedural bank generator hard constraints. The vault and security room each need at least 3 distinct approaches, such as a keycard door (social/steal), a breachable wall (Soft or Reinforced on at least one side), and a vent, roof hatch or adjacent-building route. The room graph must contain at least 2 loops between public and secure space. Every locked door needs at least 2 bypasses (key holder NPC, lockpick, breach, power cut for electronic locks). Run these checks as validation on every generated bank and reject banks that fail.

### 12. Use a few destruction tiers that look clearly different, with very few indestructible surfaces and a clear tool-to-material table.

**Evidence:** In Rainbow Six Siege, wood and plaster are destructible and concrete and stone are not. Reinforcement turns a soft wall into one only 'hard breachers' can open. Breach charges make controlled, clean holes while nitro cells are messy. Teardown's developers deliberately kept indestructible objects few 'to avoid confusion', using water, rock and ground as boundaries. Teardown's notes say full destruction makes level design much harder and needs deliberate limits and clear visual language. Game signage guides list cracks as the standard affordance for breakable surfaces.

**For BankHeist:** Use four wall materials, each with its own pixel-art palette and edge treatment: SOFT drywall/glass (any breach charge, shotgun 2 shots, vehicle ram, axe over 2 turns), REINFORCED brick/rebar (shaped charge or thermite only), VAULT steel/concrete (thermal lance or drill over many turns, which feeds heat), and BOUNDARY (lot edge only). Breaching makes a clean 1-tile gap and a predictable noise ring. Explosives make an irregular hole, debris that gives half cover, and can injure people on the other side. Cracks or seams on Soft walls are the affordance. Long-pressing any wall shows its tier and which tools in the squad can open it.

### 13. Barricades and fortifications should block sight and movement, not bullets, and each should have a counter.

**Evidence:** Ubisoft's Siege design notes say barricades are wood planks in a rope net meant to block sightlines and add a step to attacker entry, 'not really as a shield'. They are unlimited but take about 2.5 seconds, leaving the defender exposed. Reinforcements are limited (2 per defender) and permanent. PC Gamer's hands-on adds that defences 'placed without a purpose' leave gaps. Every defender tool has a listed counter (shoot the barricade, shoot the nitro cell, shoot the cameras).

**For BankHeist:** BARRICADE window or door costs 1 action and is unlimited: it blocks entry and sight but bullets still pass, at reduced cover. Police must spend an action breaking it, which buys the crew a turn. REINFORCE costs 2 actions and is limited, say 2 per kit: it turns a Soft wall Reinforced and makes it bullet-proof. Traps (tripwire charge, glue, alarm sensor of your own) are visible to police on Hard difficulty or at high heat. Police AI must breach somewhere else when fortifications block them: Soft walls, the roof, or vehicle rams. They must not wait outside.

### 14. The 2-turn stay-down timer and zipties work well. Add morale and 'covering' so the player isn't stuck with timer chores.

**Evidence:** In Invisible Inc., a knockout lasts 2 turns, or as long as an agent stands on the guard, and the guard wakes confused. In SWAT 4 each NPC has morale: low morale means surrender, a complied person 'will NOT get back up', and everyone must be zip-cuffed. Developers had to patch out an exploit where wounding a suspect sharply dropped morale before demanding surrender.

**For BankHeist:** COMMAND puts NPCs down for 2 turns. Any crew member keeping a downed NPC within their weapon's command radius and line of sight at the start of the enemy turn stops that NPC's timer from ticking, like Invisible Inc's pinning. A free 'cover' stance prevents chores. Morale shifts the flee chance when the timer expires: witnessing violence lowers morale, a nearby guard or the sound of police sirens raises it. ZIPTIE is permanent but costs an action and a limited supply (e.g. 6 per kit), and a tied NPC can be untied by another NPC. Cap the morale loss from violence so the SWAT 4 'shoot then shout' exploit can't become the best strategy.

### 15. Weight consequences by who was harmed and who saw it. Make lethality a trade-off, not a moral penalty.

**Evidence:** Harvey Smith says Dishonored 1's chaos 'too often trapped the player in binaries', so Dishonored 2 weighted each NPC (sympathetic, guilty, murderous) with different chaos values. PC Gamer notes chaos felt like 'punishment for playing violently'. Hitman Freelancer patched in penalties for killing non-target suspects and a small civilian-kill penalty to stop indiscriminate killing.

**For BankHeist:** Heat events are weighted by victim and witness, as in the brief's 'police see it' rule. A guard killed with no police witness gives +1 segment, with a police witness +3. A civilian killed gives +5 regardless, since word gets out. Releasing a hostage gives -1, capped at -1 per turn and -5 per heist. A released hostage must also leave through an exit the police control, which costs the crew a hostage. Lethal force should offer real advantages (removes a threat permanently, no wake-up), and non-lethal tools (taser, beanbag, KO melee, ziptie) should cost actions or supplies. That makes it a tactical choice, not an alignment score.

### 16. Guide players into a sandbox with optional, discoverable 'opportunities' and adjustable hints. A procedural map makes this more important.

**Evidence:** User research for Hitman 2016, in the GDC Europe 2016 talk by Mikkelsen and Andersen, found players had fun but 'the learning curve was way too steep and the scale of the first level (Paris) was incomprehensible'. IOI added a tutorial and linear guidance without touching the sandbox. Opportunities, later called Mission Stories, are found by overhearing conversations and are fully optional. Hitman 2 lets guidance, picture-in-picture and low-visibility indicators be set to Full, Minimal or Off. Critics said later guidance 'practically shoves them in your face'.

**For BankHeist:** Each generated bank seeds 3-5 Opportunities from a library. Examples: 'the branch manager carries the vault keycard and takes lunch on turn 12', 'an armoured truck delivers at turn 20 through the loading dock', 'the security observer leaves to smoke when the fire door is propped', 'the server room AC vent connects to the vault antechamber', 'a teller is in debt and can be bribed'. The casing character finds them by eavesdropping (standing within 2 tiles for 1 turn) or reading documents. Show them in an Intel list with Full, Minimal or Off guidance. The first two heists should be small, hand-authored banks that teach the zone × tier matrix before procedural banks begin.

### 17. Replay value comes from mastering learnable systems, so procedural generation must keep things learnable while varying them.

**Evidence:** Hitman's design is built on replaying the same sandbox. Elverdam talks about 'finding that mastery, learning where everyone and everything goes'. Freelancer adds roguelike variety to handcrafted maps by randomising targets from a curated pool of NPCs 'with interesting routes', with an algorithm that keeps targets from being grouped together. Teardown places optional targets to 'break up the most efficient route' and admits that too many early overwhelm players.

**For BankHeist:** Build banks from handcrafted room modules (lobby variants, teller lines, office wings, vault classes, security rooms, loading docks) with fixed internal rules, so mastery carries between banks. 'I know how a Class-B vault antechamber works.' Randomise layout, staff roster, the schedule and Opportunities. Seeds can be shared. Optional loot (safe-deposit boxes, the manager's office safe, a jewellery display) should sit off the main route so greed and route choice compete. Don't use a daily login or energy system. A seeded weekly 'contract' is fine if it is only a challenge.

### 18. Emergence needs non-player elements that affect each other in ways other than killing.

**Evidence:** Tom Francis's essay on emergence proposes a test: at least 'two non-player elements that interact in ways that go beyond simply killing', plus consistent rules, non-lethal interactions and desperation. Harvey Smith's examples are a System Shock 2 player pulling a barrel into a turret's arc, and Deus Ex players leading an exploding MJ12 soldier next to a locked container. Prey's developers were surprised by emergent combinations of mimic and other powers.

**For BankHeist:** Design NPC-to-NPC and object-to-NPC interactions on purpose. Police won't fire through or next to a hostage, so hostages work as soft cover and a shield. Panicked civilians block police movement through doorways. A car alarm or fire alarm moves crowds along flow fields. Sprinklers set off by fire short out powered objects. A power cut disables cameras and maglocks but makes the backup generator start a 3-turn countdown and sends a guard to investigate. A guard's 'radio check-in' can be answered by a crew member. Each tool should touch at least two systems.

### 19. A follow-up obligation is better than a hard cap for stopping 'just kill every guard' stealth.

**Evidence:** In Payday 2, killing a guard triggers a pager that must be answered. The limit is 4 per heist, shared by the team. Players complain the cap is too low and arbitrary, and defenders reply that without it there is 'exactly zero challenge in stealth if you could just kill all the guards'.

**For BankHeist:** A subdued or killed guard's radio is checked by the security room on a schedule, every 4 turns per guard on duty. A crew member adjacent to the body can answer it for 1 action. Each answer raises a hidden-but-shown 'dispatcher suspicion' meter, and the third answer in a short span prompts a guard to come and check physically. This is a carrier, not an alarm. Taking out the security room observer stops checks, but an observer who misses a check-in prompts a police drive-by. The cap then comes from simulated logic the player can work around, not a number.

### 20. Make cameras an element of the security network the player can attack, not an instant failure.

**Evidence:** In Hitman 2, camera footage goes to monitoring staff who dispatch guards, and evidence can be removed by shooting cameras or destroying the recorder in a security room. A mod author notes that the original 2016 game linked each camera to a specific recorder, which later games simplified so that destroying any recorder disabled all cameras. Payday 2 notes that lingering near a camera detects even unmasked players.

**For BankHeist:** Cameras have a cone like a guard but only report what the security observer sees. If the observer is away, distracted or subdued, or the power is cut, cameras record but don't report. Footage stored in the security room affects post-heist identification (crew heat that carries over between heists) unless the recorder is destroyed. Use one security hub per bank to keep it readable. CONCEALED and below don't trigger cameras in PUBLIC zones. ARMED and HEAVY trigger them anywhere.

### 21. Show enemy-turn consequences that happen off-screen, given the small 20x11-tile view.

**Evidence:** Hitman 2 added picture-in-picture feedback that shows off-screen consequences such as a body found or an opportunity triggered, with a setting for how much is shown. Invisible Inc. marks dangerous tiles outside your agents' view. Mark of the Ninja's designers credit the 2D distant camera with leaving room for systemic feedback.

**For BankHeist:** At 320x180, most of the bank is off-screen. In the enemy turn, the camera visits only important events: an alarm carrier progressing, a reinforcement arrival, a crew member being Made. Lesser events become edge-of-screen arrows with icons. Include a tappable 'threat ledger' list ('Teller K. → silent alarm in 2', 'Patrol car arrives in 3', 'Guard radio check in 1'). On phones this list replaces hover tooltips and is the main planning surface.

### 22. Being 'Made' should be per character and tied to a look the player can change. Teammates are still unknown until spotted themselves.

**Evidence:** Payday 2 tracks detection per player, and an unmasked player can blend in while masked teammates fight. Hitman's compromise status is tied to a specific disguise, so changing outfit out of sight can restore anonymity unless enforcers have seen 47's face.

**For BankHeist:** Track a per-character status: Unknown → Suspicious (seen doing something minor, shown as '?' and remembered by that NPC only) → Made (all police and guards share it after one radio turn). A Made character in a different outfit (only possible for CLEAN or CONCEALED tiers; armour can't be hidden) who breaks line of sight for 2 turns returns to Unknown for everyone except NPCs who saw the change. This makes the 'inside man disables the alarm while the heavies wait' plan in the brief a deliberate, supported strategy.

### 23. Prototype the core system interactions early and keep the rule count small, because systemic games are hard to debug and AI designed separately becomes inconsistent.

**Evidence:** Spector says Deus Ex's AI was 'designed in a vacuum' and changed until the end, 'delivered inconsistently'. He also says to build a playable proto-mission 'as early as possible' and to cut early: the 500-page design document became about 270 pages. Prey's producer says 'it's hard to debug stuff like this because it's systemic'. Thief's systems came together only 3 months before shipping and needed heavy tuning. A Hitman 3 bug report shows checkpoints treating legal disguises as trespassing, and inconsistencies like that erode player trust.

**For BankHeist:** The design document should include a single NPC reaction table (Role × Stimulus × Zone → Response) and a tool × material table as canonical artifacts. Every feature request is checked against them. Build a paper or greybox 'one-room bank' covering stealth, going loud, command, ziptie and breach before building any procedural content. Any rule the player can't predict from the tables is a bug, even if it is emergent.

## Pitfalls

- Absolution's disguise problem: if every NPC of a given role sees through you, social stealth collapses. Keep enforcers a visible minority for each conspicuousness tier.
- Opaque simulation (Trespasser, early Thief): a deep sim the player can't read feels random. Every perception and noise rule must be previewable before the player commits.
- Trial-and-error determinism (critics of Hitman GO): deterministic but unannounced patterns turn planning into memorisation. Telegraph NPC intent and show routines during casing.
- Scripted, unavoidable alarms (Smith on Deus Ex): players feel robbed. Every alarm source in BankHeist, vault drilling included, needs an avoidable or delayable counter.
- Timer-driven sameness (Teardown reviews: around 98% prep for a 60-second run, 'boring pretty quickly'): don't make every heist 'prep forever, then sprint'. Mix stealth, loud and holdout phases, and vary objectives (hostage holdout, data theft, safe-deposit box, armoured truck).
- Arbitrary hard caps (Payday's 4-pager limit called gamey): express limits through simulated logic like radio check-ins, not unexplained numbers.
- Morality as punishment (Dishonored 1's chaos): heat for kills must read as tactical cost with a fictional reason (police see it, word gets out), not as the designer scolding the player.
- Overbearing guidance (Hitman 2 critics: opportunities 'practically shoved in your face'), and the opposite problem, an incomprehensible first sandbox (Paris user research). Ship toggleable guidance and small first banks.
- Sandbox scale beyond comprehension on a small screen: a bank much larger than about 3x3 screens of 20x11 tiles will be hard to hold in your head on a phone. Keep bank footprints compact and dense ('an inch wide and a mile deep').
- Exploitable compliance loops (SWAT 4's wound-then-shout morale exploit; potentially BankHeist's release-hostage heat reduction): cap per-turn and per-heist effects and give each loop a real cost.
- Timer chores: a 2-turn stay-down on 15 civilians could turn every turn into re-shouting. Use cover/pin stances and AoE re-command so crowd control stays a choice, not upkeep.
- Inconsistent zone rules (Hitman 3 checkpoint bugs): one inconsistency teaches players not to trust the safe overlay, which is the core promise. Zones must be data-driven and visible.
- Full destruction without limits makes level design and AI pathing much harder (Teardown notes). Restrict destruction to a few material tiers and keep a small set of non-destructible structural elements (load-bearing columns, the lot boundary).
- Hitman crowds 'never calm down once triggered'. In a long turn-based heist with hostages, permanent panic would remove crowd control as a skill, so morale needs a way to recover and be re-suppressed.
- Systemic bugs are hard to find (Prey). Every extra interacting system multiplies QA and player-learning cost, so add systems only when they interact with at least two existing ones.

## Ideas

- Zone × conspicuousness reaction matrix (PUBLIC/STAFF/SECURE × CLEAN/CONCEALED/ARMED/HEAVY), drawn as floor tint when a character is selected and printed in the in-game manual.
- Three-ring Command event: weapon-scaled COMMAND ring (gets down 2 turns), PANIC ring (+3 tiles: flee, hide or go for an alarm), ALERT ring (the noise radius). Bigger guns control more people and scare more people.
- Cover/pin stance: a crew member keeping a downed NPC in command radius and line of sight freezes their 2-turn timer (after Invisible Inc's pinning).
- Alarm carriers with intent icons and countdowns: teller → button (path + turns), civilian → exit, guard → radio (1 still turn), observer → camera feed. Each can be intercepted.
- Threat ledger: a tappable list of every pending alarm carrier, reinforcement ETA and radio check-in. It is the main planning interface on mobile.
- Radio check-ins instead of Payday's pager cap: the security room calls each guard every N turns, crew can answer, and repeated answers raise dispatcher suspicion until someone comes to look.
- Camera network through one security hub: cameras report only what a present, attentive observer sees, and footage left in the recorder raises carry-over 'identification' heat between heists.
- Bank daily schedule as the stealth clock: shift change, lunch breaks, armoured truck arrival, vault time-lock window, closing time. Opportunities and routines are tied to it, with no abstract timer before the alarm.
- Opportunities found during casing: overheard conversations (stand within 2 tiles for 1 turn), documents, keycard holders, bribable or indebted staff, maintenance vents, a propped fire door.
- Material tiers with distinct pixel-art treatment (Soft with visible seams and cracks, Reinforced, Vault, Boundary) and a long-press 'what opens this' readout listing the squad's applicable tools.
- Breach charge (clean 1-tile hole, predictable ring) versus improvised explosive (irregular hole, debris half-cover, injures through the wall) as a precision-versus-chaos choice, as in Siege's breach charge versus nitro cell.
- Barricades that are unlimited but cost an action, and block sight and entry but not bullets. Reinforcements are limited (2 per kit) and bullet-proof. Police AI then reroutes through Soft walls, roofs or vehicle rams.
- Planning phase with a placement budget: getaway vehicle spot, sniper nest in an adjacent building (with its own sightlines and noise), a pre-cut fence, a parked ram vehicle, a drop bag hidden in a public toilet by the casing character.
- Undo or a save slot available until the first alarm, then locked (Teardown's quicksave rule). Ironman toggle for veterans.
- Per-character Made state with an outfit-swap reset for CLEAN or CONCEALED characters who break line of sight for 2 turns. Witnesses of the swap still remember.
- Hostages as a systemic shield: police won't fire through a tile with a hostage in the cone and slow their breach when hostages are near the entrance. Releasing hostages through police lines lowers heat at a capped rate.
- Hidden-weapon civilian with a tell ('nervous' tag within 3 tiles, or a frisk action) so the surprise is fair.
- Weighted heat events: a guard killed unseen +1, a guard killed seen by police +3, a civilian killed +5, a cop killed +5, a high-tier vault drill +1 per turn, a hostage released -1 (capped). Reinforcement tier ETAs shown as HUD pips.
- Generator validation rules: at least 3 approaches to the vault and the security room, at least 2 loops between public and secure space, at least 2 bypasses per locked door. Reject seeds that fail.
- Hand-authored tutorial banks (2-3) that teach the matrix, the noise rule and alarm carriers before procedural banks start. Mastery of room modules (vault classes, security-room types) carries over between banks.
- Off-route optional loot (safe-deposit boxes, the manager's safe, a jewellery display) that breaks up the most efficient route and tempts greed, after Teardown's optional targets.
- Enemy-turn camera that visits only important events, with edge arrows for the rest (after Hitman 2's picture-in-picture).

## Open questions

- Is the stealth phase fully turn-based with every NPC routine stepping per turn, or is there a free-movement 'casing' mode until any crew member enters an NPC's awareness (like XCOM's concealment)? This decides how the bank 'goes about its day' and how long prep takes.
- Should the crew have disguises (staff or guard uniforms), or only conspicuousness tiers? Hitman shows disguises are a large source of social-stealth depth, but they add a whole enforcer layer the brief doesn't mention.
- How is a teammate who is 'not yet spotted' treated once the bank is loud? Do civilians and police attack anyone who looks like a robber, or does Made status really stay per character after the alarm?
- What exactly happens when a commanded NPC's 2 turns end? A roll per NPC or a morale threshold? How visible should the result be (intent shown one turn ahead or not)?
- Does heat build during stealth (before any alarm), or only after? The brief says 'the longer a heist goes on', which could undermine slow stealth play if it applies before the alarm.
- How do the 'releasing hostages reduces heat' and 'take more hostages' loops avoid exploitation? Does release also give police intel or positions?
- How large should a procedurally generated bank be, given a 20x11-tile view and phone-sized play? About 40x30 tiles (2x3 screens) or bigger?
- What is the win and loss structure: escape with any loot, a quota, crew permadeath, carry-over heat or notoriety between heists? Is there a campaign layer (crew recruitment, gear) like XCOM's?
- How do police AI handle fortified positions without stalling: always breach a Soft wall, use gas, snipers, negotiators? Is there a negotiation phase (hostages for time)?
- Do sound rings pass through walls with tier-based damping, or are they pure circles (Mark of the Ninja-style simplicity)? The choice trades realism against readability.
- Should the sniper nest and the getaway vehicle be placed in a separate planning screen or as in-mission actions with turn costs?
- What is the undo or save policy before the alarm: free undo, one save slot, or none? This decides whether experimental immersive-sim play is encouraged or punished.

## Sources

- [The AI of Hitman (2016) - Game Developer (AI and Games)](https://www.gamedeveloper.com/design/the-ai-of-hitman-2016-)
- [Level Design in HITMAN: Guiding Players in a Non-Linear Sandbox (GDC Europe 2016)](https://gdcvault.com/play/1023849/Level-Design-in-HITMAN-Guiding)
- [Hitman Wiki - Alert Levels (suspicious vs illegal actions)](https://hitman.fandom.com/wiki/Alert_Levels)
- [Hitman Wiki - NPC (civilians, crowd, guards)](https://hitman.fandom.com/wiki/NPC)
- [Hitman (2016 video game) - Wikipedia (frisking, restricted areas)](https://en.wikipedia.org/wiki/Hitman_(2016_video_game))
- [Hitman 2 Developer Interview - Eskil Mohl (Green Man Gaming)](https://www.greenmangaming.com/ja/intel-feature/hitman-2/developer-question-and-answer/)
- [Hitman Forum - [Research] NPC Reactions](https://www.hitmanforum.com/t/research-npc-reactions/16088)
- [Steam discussion - Hitman 2 cameras and recorder](https://steamcommunity.com/app/863550/discussions/0/1741138420015199860)
- [Nexus Mods - Hitman 3 per-camera recorder mod description](https://www.nexusmods.com/hitman3/mods/860)
- [Hitman Freelancer interview (TheGamer)](https://www.thegamer.com/hitman-freelancer-developer-interview/)
- [IO Interactive reveals Freelancer changes after technical test (Wccftech)](https://wccftech.com/io-interactive-reveals-changes-to-hitman-3-freelancer-based-on-feedback-from-closed-technical-test/amp/)
- [Hitman is a living sandbox, not an episodic game (GamesBeat)](https://gamesbeat.com/hitman-is-a-living-sandbox-not-an-episodic-game/)
- [Hitman Absolution user review - disguise criticism (GameSpot)](https://www.gamespot.com/hitman-absolution/user-reviews/2200-151256/)
- [Hitman Go review (Game Informer)](https://gameinformer.com/games/hitman_go/b/ios/archive/2016/02/23/hitman-go-review-game-informer)
- [Being smart, being stupid with Hitman GO's design (Game Developer)](https://gamedeveloper.com/design/being-smart-being-stupid-with-i-hitman-go-i-s-design)
- [Hitman Go: Definitive Edition review (CGMagazine)](https://www.cgmagonline.com/review/hitman-go-definitive-edition-ps4-review/)
- [Postmortem: Ion Storm's Deus Ex (Warren Spector)](https://www.gamedeveloper.com/design/postmortem-ion-storm-s-i-deus-ex-i-)
- [Harvey Smith essay on simulation and emergence (witchboy.net)](https://witchboy.net/?p=22)
- [Empowering the Player in a Story-Rich World: Co-Directing Dishonored (GDC 2013)](https://gdcvault.com/play/1018062/Empowering-the-Player-in-a)
- [Dishonored 2's chaos system explained by Harvey Smith (Wccftech)](https://wccftech.com/dishonored-2s-chaos-system-implications-explained-game-director/amp/)
- [Dishonored 2: creative killing in Karnaca (PC Gamer)](https://pcgamer.com/dishonored-2-creative-killing-in-karnaca/2)
- [Seven ways Prey has shocked its own developers (Game Informer)](https://www.gameinformer.com/b/features/archive/2016/12/23/seven-ways-prey-has-shocked-its-own-developers.aspx)
- [Building the original Thief's revolutionary stealth system (Game Developer)](https://www.gamedeveloper.com/design/building-the-original-i-thief-s-i-revolutionary-stealth-system)
- [Postmortem: Thief: The Dark Project (Game Developer)](https://www.gamedeveloper.com/design/postmortem-i-thief-the-dark-project-i-)
- [Teardown design notes (Dennis Gustafsson, voxagon blog)](https://blog.voxagon.se/2020/11/05/teardown-design-notes.html)
- [Teardown Heist Basics (community docs)](https://get-teardown.readthedocs.io/en/latest/gameplay/heist-basics.html)
- [Teardown review: restricted genius (GamingTrend)](https://gamingtrend.com/reviews/teardown-review-restricted-genius/)
- [Teardown technical test - few indestructible objects (PCGH, German)](https://www.pcgameshardware.de/Teardown-Spiel-73677/Specials/PC-Game-Test-Benchmark-Voxel-Dynamic-Destruction-1394545/2/)
- [Rainbow Six Siege - Behind the Wall: Tools of Defense (Ubisoft)](https://www.ubisoft.com/en-us/game/rainbow-six/siege/news-updates/2RyPUypY9DdzDH2433hqTs/behind-the-wall-series-tools-of-defense)
- [Rainbow Six Wiki - Reinforcement](https://rainbowsix.fandom.com/wiki/Reinforcement)
- [Rainbow Six Wiki - Destruction](https://rainbowsix.fandom.com/wiki/Destruction)
- [Rainbow Six Siege E3 hands-on (PC Gamer)](https://pcgamer.com/rainbow-six-siege-e3-hands-on)
- [Reinventing stealth in 2D with Mark of the Ninja (Game Developer)](https://gamedeveloper.com/design/reinventing-stealth-in-2d-with-i-mark-of-the-ninja-i-)
- [Mark of the Ninja interview (Gaming Nexus)](https://gamingnexus.com/Article/3565/Mark-of-the-Ninja-Interview)
- [To dye for: Invisible Inc. is my kind of strategy-stealth game (Destructoid)](https://www.destructoid.com/to-dye-for-invisible-inc-is-my-kind-of-strategy-stealth-game/)
- [Invisible, Inc. - Wikipedia](https://en.wikipedia.org/wiki/Invisible,_Inc.)
- [Invisible, Inc. Wiki - Daemons](https://invisibleinc.fandom.com/wiki/Daemons?oldid=5566)
- [Payday Wiki - Social Stealth](https://payday.fandom.com/wiki/Social_Stealth)
- [Payday Wiki - Chameleon](https://payday.fandom.com/wiki/Chameleon)
- [Steam discussion - Payday 2 pager limit](https://steamcommunity.com/app/218620/discussions/8/540744474916516492)
- [SWAT 4 Updated Impressions - morale and compliance (GameSpot)](https://www.gamespot.com/articles/swat-4-updated-impressions/1100-6120098/)
- [Desperados III - Wikipedia](https://en.wikipedia.org/wiki/Desperados_III)
- [Five pillars of immersive sims (80.lv)](https://80.lv/articles/five-pillars-of-immersive-sims)
- [Immersive sim - Wikipedia (Mark Brown on consistent rules)](https://en.wikipedia.org/wiki/Immersive_sim)
- [Tom Francis on emergent gameplay (pentadact)](https://www.pentadact.com/?p=9052)
- [Weird West - how it accounts for emergent gameplay (GameBanshee)](http://www.gamebanshee.com/xqwc3)
- [Warren Spector on immersive sims and the player as author (Game Developer)](https://gamasutra.com/design/warren-spector-says-the-next-logical-step-for-immersive-sims-is-multiplayer)
- [Hitman 2 (2018) - Mission Stories review (God is a Geek)](https://godisageek.com/reviews/hitman-2-review/)
