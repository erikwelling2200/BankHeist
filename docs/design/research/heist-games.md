# Heist games (Payday & co.)

Heist games split into two halves that play very differently. The stealth half (Payday 2/3 stealth, Monaco, Invisible Inc., Hitman, Teardown's prep phase) is about reading a space and working out a plan. The loud half (Payday assaults, Teardown's 60-second run, GTA's "Loud" approach) is about holding out under rising pressure and getting the loot out. The best heist designs make the move from one half to the other a gradual slide rather than a game-over switch. The most common criticism of Payday 2 was its binary stealth: one guard you lost track of could end a 20-minute run, players restarted until they got good spawns, and repeat runs felt tedious. Payday 3 answered this directly with tiered security zones (public, private where you get escorted out, secure where you get a shootout), a "search" state between calm and combat, and a hostage "negotiation" phase where you trade hostages for time. Reviewers called that stealth the game's highlight and "considerably less annoying". The BankHeist brief already points this way: alarms come from specific sources, each character is spotted individually, and heat escalates. The research says to go further. Every alarm source should take time to complete, be shown in advance, and be possible to stop. Security zones should have tiers. Being detected should change the situation, not end the heist.

For a turn-based squad game, the closest models are Invisible Inc. (turn-based stealth heists, an alarm that rises every turn in visible tiers with set effects, one-shot agents), XCOM 2's concealment (red detection tiles, ambushes from concealment that go off when the squad is revealed), Into the Breach and Tactical Breach Wizards (enemy actions shown in advance, little randomness, "every death should feel like your own fault"), and Mark of the Ninja (noise drawn as a ring showing exactly how far it carries). These games show that turn-based stealth only works with near-perfect information. The player must be able to see who will see them next turn, how far a sound carries, how many turns until a teller reaches the alarm button, and what the next heat tier will bring. BankHeist's cone-based shooting and 50% cover-block chance add variance. That is acceptable, because the cone itself is visible information. But the rest of the stealth simulation should be deterministic and shown in advance, or failures will feel arbitrary, which is exactly what Francis and Subset were designing against.

Several features in the brief already have proven counterparts. Payday's preplanning (assets paid with cash plus a capped budget of 8 favours on Bank Heist), its loot-bag weight classes and bag throwing, drills that jam and need tending, hostage trades to bring back captured crew, and assault waves with breaks between them. Teardown has an untimed prep phase, pre-placed escape vehicles, and a fixed countdown after the trigger. GTA has a choice of approach and scouting, plus Cayo Perico, where effort spent on prep sets the difficulty. Each also comes with documented failures to avoid: dominant preplanning picks ("Beast drill and bus are pretty much mandatory"), police that appear out of nowhere, randomised maps that are sometimes unfair (Invisible Inc.'s exit "impossibly far"), unreadable sandboxes (Hitman's Paris tested as "incomprehensible"), patrol stacking that causes chain-reaction alerts, and prep missions that feel like a grind (GTA Online). The lessons below turn each of these into a concrete rule, number or UI requirement for BankHeist. The numbers are proposals for tuning, not established facts.

## Lessons

### 1. Never make detection a binary fail. Use tiered security zones, where getting caught in a low tier costs time or position rather than raising the alarm.

**Evidence:** Payday 3 split maps into public areas (free movement), private areas (a guard asks you to leave and escorts you back to a public area without ending stealth) and secure areas (shootout). Starbreeze said the goal was 'de-escalation during the casing phase' instead of 'calm normalcy vs instant firefight' (VGC preview). Thumbculture called stealth the game's highlight, 'considerably less annoying', because being caught in a restricted area no longer ends the run. Payday 2 players complained that one guard they lost track of could wreck a near-complete heist.

**For BankHeist:** Give the procedural bank three tiers: PUBLIC (lobby, teller line, ATM vestibule), STAFF (offices, staff corridor, break room), SECURE (security room, vault antechamber, vault, cash room). An unarmed character caught in STAFF gets 'You can't be here', is escorted back over 1-2 turns, and that NPC becomes Suspicious of them for the rest of the heist. A second offence, or any offence in SECURE, exposes that character. Only exposure plus a witness who reaches an alarm source calls the police.

### 2. Add a middle awareness state between unaware and alarm, and make every NPC's state visible.

**Evidence:** The Thief postmortem says the team gave AIs more than the usual two states (oblivious and omniscient), and that those states 'only matter if the player can perceive them'. Thief signalled them through barks. Payday 3 added a 'search' stage where guards are suspicious and try to detain instead of shooting (Insider Gaming, dev diary).

**For BankHeist:** Each NPC has one of four states shown as an icon over their head: Calm, Curious (looks toward a noise, may walk 1-3 tiles to investigate), Suspicious (follows or confronts a character, escorts them out), Alarmed (knows there is a threat and heads for an alarm source or exit, or opens fire if armed). States only rise one step per stimulus unless the stimulus is blatant, such as gunfire or a body. Use short speech bubbles as barks so the state also reads at 320x180.

### 3. How conspicuous a character is should be the sum of their gear, and it should change concrete detection numbers, not a hidden roll.

**Evidence:** Payday 2's detection risk is the sum of concealment from primary, secondary, armour and melee, and it shifts the starting point of AI detection. Players noted that even an armour bag raises it. In Hitman (2016), certain NPCs of the same profession see through a disguise and are marked by a UI prompt.

**For BankHeist:** Give each weapon and armour piece a Conspicuousness value (for example concealed pistol 0, SMG 2, rifle 3, LMG or shotgun 4, light vest 1, heavy armour 3, carried loot bag 2, visible drill or thermite 3). The total sets a tier that maps to tiles: tier 0 (unarmed or concealed) is never suspicious in PUBLIC. Tier 1 is suspicious to guards within 3 tiles. Tier 2 is suspicious to anyone within LOS 6 and exposed to guards. Tier 3 or higher is exposed on sight by anyone. Guards and the control-room operator act as 'enforcers' with one tier more sensitivity. Staff uniforms grant STAFF-zone access, but managers see through them.

### 4. The floor overlay for 'where I can go safely' must account for what NPCs will do on their turn, so enemy movement and vision for the next turn has to be shown in advance.

**Evidence:** XCOM 2 shows detection radii as red cells, and stepping into one breaks concealment (Ufopaedia). Shadow Tactics splits view cones into zones: instant detection, a zone that is safe while crouching, and refuge spots. Its players still asked for clearer zone indicators. Into the Breach shows enemy attacks at the start of the turn so that 'every death felt like your own fault' (Game Developer, Road to IGF).

**For BankHeist:** When a character is selected, colour reachable tiles by outcome for that character's current Conspicuousness: green (safe), yellow (would make someone Curious or Suspicious, or STAFF trespass), red (would expose). Calculate this against NPC positions and facing at the END of the enemy turn, using each NPC's announced next move (drawn as a faint path arrow). Patrols are deterministic and only deviate because of stimuli, so the forecast holds unless the player changes something.

### 5. Every alarm source should take time, be shown in advance, and be possible to stop. That gives the player the chance to react.

**Evidence:** In Payday 2 a killed guard's pager beeps after 3 s, the operator raises the alarm if it is ignored for 7 s, and answering takes 10 s. An ECM jammer only blocks a call it was placed before, and a call already in progress still goes through. Panicking civilians run for a panic button, a phone or the map exit (Game Informer strategy guide with the director).

**For BankHeist:** Treat alarm-raising as a multi-turn action with a visible countdown. A teller who becomes Alarmed shows 'reaching for button: 1' and presses it at the end of the next enemy turn unless commanded down, zip-tied, knocked out or blocked. A fleeing civilian shows a path line and 'escapes in N turns' to the nearest exit. A control-room operator who sees a threat on camera shows 'calling: 2'. A missing guard who doesn't check in on the radio shows 'check-in overdue' and triggers a dispatcher query 2 turns later. Doors, barricades, jammers and cut phone lines are all ways to stop these countdowns.

### 6. Allow a limited budget of silenced guards, so that removing guards is a resource and not free.

**Evidence:** Payday 2 allows 4 answered pagers per heist, shared by the whole crew, and a 2014 patch made dominated guards trigger pagers too. In the Murky Station postmortem, players could kill 4 guards before the alarm on every difficulty. Players advise against killing more than 3 because some heists call in replacement guards.

**For BankHeist:** Give each guard a radio check-in every K turns (for example 6). The squad can cover a fixed number of check-ins per heist (for example 3, plus 1 with a 'Smooth Talker' asset or perk). Covering one costs the character's whole action for that turn and requires standing next to the body. If the cap is exceeded or a check-in is missed, the dispatcher gets suspicious: a guard is sent from outside and the control room goes on alert. That makes knock-outs a planned spend rather than the default.

### 7. Make being spotted per character, but define 'guilt by association' so the rule holds up.

**Evidence:** XCOM 2's concealment is squad-wide: missions start concealed and any reveal breaks it for everyone. That works because XCOM has no social stealth. The brief's mixed team (an unarmed insider plus heavies) needs per-character exposure, and Hitman's disguise and enforcer rules show it is readable when the rules are explicit.

**For BankHeist:** Each character has its own Exposed flag. A character becomes exposed if a witness (1) sees them do something illegal (lockpick, carry loot, tie up, shoot, enter SECURE), (2) sees their gear at tier 3 or higher, or (3) sees them cooperating with an exposed character within 2 tiles, such as passing items, reviving, or standing in formation. An unexposed character can still blend into a panicking crowd once the bank is loud: they count as a 'civilian' to police until seen doing something illegal. This pays off the insider fantasy.

### 8. Let players set up a coordinated 'go loud' moment, as in an Ocean's 11-style synchronised strike.

**Evidence:** XCOM 2 lets concealed soldiers set an ambush overwatch that only fires when concealment breaks, without the usual aim penalty. Starbreeze describes successful quiet coordination as the 'synchronised precision' they wanted for Payday 3.

**For BankHeist:** Before anyone is exposed, any character can queue a 'Trigger' order (shoot this camera, command this room, cut this phone line, kick this door) that fires automatically, in initiative order, the moment any squad member is exposed or the player presses 'Go'. Turning the takeover into a single satisfying turn is the core heist-film beat ('Everybody down!').

### 9. Escalation should come in discrete, visible tiers with known effects, rising predictably every turn and jumping on specific events.

**Evidence:** Invisible Inc. raises its alarm every turn. At level 1 more cameras come online, at level 2 turrets activate, at level 3 more guards arrive, and at the top level a kill team sweeps in (Gamereactor, Selectbutton). Reviewers say this forces a choice between risky extra loot and leaving. In Burgle Bros each active alarm adds +1 to the guard's movement and pulls him toward it, and every pass through the patrol deck permanently adds +1 speed. XCOM 2's mission timers were controversial, as Solomon himself discussed with RPS, because they felt like an arbitrary clock.

**For BankHeist:** Heat is a visible track divided into tiers, each with listed effects shown on a tooltip, for example: Heat 1 patrol car, Heat 2 SWAT van every N turns, Heat 3 snipers on rooftops and shields, Heat 4 heavy armour and helicopter, Heat 5 roads blocked. Heat rises by +1 point per turn once the police have been called (not before, so the stealth phase isn't on a clock), with spikes for police-witnessed kills (+5 cop, +3 civilian) and drilling a high-tier vault. Hostage release lowers it (for example -2). Always show 'next tier in X turns at the current rate'.

### 10. Police assaults need a rhythm of attack and breathing room, not a constant stream.

**Evidence:** Payday's police assaults run on a timer with a capped number of active cops during the sustain phase, followed by downtime. Higher difficulties lengthen assaults and shorten the breaks (Overkill 145+ wiki). Holdout runs about 3-minute waves. Payday: The Heist used the breaks between waves for hostage trades to free captured crew (game-wisdom analysis). PC Gamer described Payday 3's late game as a 'relentless assault' that is nearly impossible if you take too long.

**For BankHeist:** Structure loud play as Assault (4-6 enemy turns of pushing in) followed by a Lull (2-4 turns with only stragglers). Lulls are when you move bags, re-tie hostages, reposition, trade hostages and fix drills. Higher heat lengthens assaults and shortens lulls. Show a banner: 'Assault in 2 turns, entering from the north lot and the roof'.

### 11. Reinforcements have to arrive physically, from visible places, a turn after they are announced. This is what makes traps, barricades and sniper nests matter.

**Evidence:** The Payday: The Heist analysis criticised 'gamey police spawns': enemies appearing from nowhere and vans unloading far more officers than plausible, which forced unrealistic exploits like pushing past spawn triggers. Big Bank players avoided the C4 escape because it 'spawns up to 4 snipers' along the route, so spawns shaped route choice.

**For BankHeist:** All police come in by vehicle or on foot from map-edge staging points: street, alley, rooftop helipad, sewer at high heat. Vehicles arrive one enemy turn before their troops disembark, with siren icons on the screen edge. Doors and windows they plan to breach are marked. The brief's immersive-sim tools then work as intended: booby-trap the alley door, barricade the windows facing the lot, put a sniper on the opposite roof overlooking the staging area, or ram a van into the street to block the approach.

### 12. Hostages should be both a resource and a liability, with concrete things you can trade them for.

**Evidence:** In Payday 2, cable ties start at 2 (6 with Forced Friendship). Tied civilians can't alert anyone and only cops can free them. Civilian kills bring a stronger police response and 'cleaner costs'. On higher difficulties, hostage trades are the only way to bring back a captured crew member. Payday 3's negotiation lets you trade hostages before the police push in to buy time, or later for resources such as medkits, ammo, or a manager who opens a locked door (Insider Gaming, Prima).

**For BankHeist:** Zip-ties are a limited consumable: 3 per character baseline, with a perk or asset for more. Releasing a commanded or tied hostage through the front door during a lull gives the player a choice of: -2 heat, +1 lull turn, getting a downed or arrested crew member back, or a requested item delivered to the door. Killing a civilian costs payout (a 'cleaner' fee) and +3 heat if police or civilians witness it. Hostages near windows also discourage police snipers, but police may try to free them during assaults.

### 13. Commanding NPCs to stay down should be cheap and done in groups. A fixed two-turn timer for every NPC risks tedious babysitting.

**Evidence:** Payday makes intimidation a quick shout and saves the limited resource (cable ties) for permanent control. SWAT 4 gives each civilian and suspect a different morale that affects how likely they are to comply, and reviewers note you'll shout dozens of times per mission. Heat Signature and Payday 3 reviews praise reduced annoyance. Monaco 2 and the Murky Station postmortem flag 'frustrating waiting' and repetition as the things to remove.

**For BankHeist:** Keep the brief's two-turn command, but (1) make Command a free or minor action that doesn't end the character's turn, or let a character 'Guard' a room so everyone in their command radius is re-commanded automatically each turn they keep LOS. (2) Make the radius scale with weapon (pistol 2 tiles, SMG 3, rifle 4, LMG or shotgun 5, firing a warning shot +2 but loud). (3) Use per-NPC Nerve: most stay down, but a visible 'twitchy' marker shows who will run or reach for a phone when the timer expires. (4) Give armed civilians (off-duty cop, 1-in-20) a subtle tell found by casing or Inspect. That keeps the 'small chance someone shoots' from being a pure gotcha.

### 14. Drilling should be a multi-turn defend-and-tend objective with jams the player can mitigate.

**Evidence:** Payday 2's First World Bank drill takes 4 minutes plus jam time. Hardware Expert gives 25% faster repair and a 10% auto-restart chance, Kickstarter gives a 20% auto-restart chance or a 50% chance to fix it by hitting it, and Drill Sawgeant cuts drill time by 15-30%. Big Bank and Golden Grin drills never jam but are much slower. The Murky Station postmortem uses about 2-minute sub-goals.

**For BankHeist:** Give vault tiers drill durations in turns (deposit boxes 2, small vault 4, main vault 8, high-security vault 12). Each turn the drill has a jam chance (for example 15%), and a jam is announced. Fixing takes one adjacent character's action. Drilling makes a sound ring (for example 6 tiles) and on high-tier vaults immediately raises heat or triggers a vault-sensor alarm, as the brief says. Preplanning and perks trade speed against reliability: a 'Silent Drill' (smaller ring, slower), 'Beast Drill' (never jams, slowest), or thermite (fast, very loud, burns 3 turns, can't be stopped).

### 15. Loot should be physical and heavy, and weight should force real choices about mobility and greed.

**Evidence:** Payday 2 bags come in weight classes. Jewellery, coke and paintings let you sprint, while money, gold and servers don't. Light and medium bags can be thrown about 6 m (9 m with Transporter). The director's guide says the minimum loot is the payout baseline, and that lingering for extra loot 'raises the heat'. Teardown objects 'must be carried or driven'.

**For BankHeist:** Give loot weight classes: Light (cash bundles, jewels; no move penalty, can stack 2), Heavy (cash bag; -2 movement, no Dash, can throw 2 tiles), Very Heavy (gold, server; -50% movement, needs both hands so only a pistol can be used, throw 1 tile or pass to an adjacent ally). Bags conspicuous in PUBLIC: +2. Mission success = minimum loot secured at the getaway vehicle. Everything above that is optional greed measured against rising heat. Allow bag chains (throw, catch) so a squad can form a relay line, a satisfying cooperative tactic.

### 16. Planning and buying assets beforehand should involve real trade-offs, a hard budget, and options that depend on the generated layout. Otherwise players converge on the same picks.

**Evidence:** Payday 2 preplanning is paid with cash plus favours, with a cap of 8 favours on all variants of Bank Heist ('you can only call so many favors before you raise suspicions'). Players said the Beast drill and bus escape were 'pretty much mandatory', that no one used thermite even after it got cheaper, and that limited favours left 'little room for variation'.

**For BankHeist:** Give the planning screen a Cash budget plus an Exposure (favours) cap of about 8 points, so assets compete with each other. Make assets positional on the generated map (place the getaway car on a specific street tile, plant a supply drop in a specific restroom, hire a tow truck to block a specific road, buy a spycam for a specific corridor, rent a room in a specific adjacent building as a sniper nest). Since the bank layout changes each run, the best pick changes too. Run tuning simulations to make sure no asset appears in more than about 60% of winning plans.

### 17. Scouting before the heist should produce information the player can use, and the procedural bank should follow a consistent layout so it reads at a glance.

**Evidence:** Payday 2's director: 'The best jobs are jobs you prepare for.' Use casing mode to find guards, cameras, the vault and civilians. GTA's Diamond Casino has you photograph 6 access points. Cayo Perico's prep makes the finale easier or harder, and its randomised secondary targets keep replays fresh (Inverse). Hitman's user research found the Paris sandbox 'incomprehensible' until guidance was added (GDC Europe 2016).

**For BankHeist:** Start each heist with an unmasked 'Casing' phase where the whole squad is tier 0 (or one Insider is sent in). The bank always follows the same layout logic (street, then lobby, then teller line, then manager offices, then staff corridor, then security room, then vault), so players learn it once. Each Inspect action reveals specific information that goes into the plan: camera arcs, guard check-in interval, which teller is 'twitchy', who carries the vault keycard, wall material (can it be blown). Unrevealed areas stay greyed blueprint.

### 18. Randomisation must serve gameplay, and the generator needs a fairness check that removes extreme results.

**Evidence:** In the Murky Station postmortem, randomisation 'must affect gameplay meaningfully, not be added for its own sake'. A script pass blocked overpowered or extreme key distributions. Patrol stacking (up to 8 guards in one area) caused chain-reaction alerts and was fixed with smaller loops, capping stacking at about 4. Invisible Inc. reviewers found random maps sometimes unfair, with the elevator easy or 'impossibly far'. Hitman Freelancer players complained that random spawns and targets 'make planning ahead much harder'.

**For BankHeist:** Write fairness rules for the generator: at least 2 distinct routes from PUBLIC to the vault. No more than 3 guards able to see the same tile. The security room is never visible from the vault door. Every alarm button can be reached by at least one non-alarm route. The getaway area is within X tiles of 2 exits. Distance to the objective falls within a set band. Randomise what matters (vault tier, key holder, camera coverage, guard count, which walls are reinforced) and keep the overall structure fixed.

### 19. Show sound as a ring that states exactly how far it reaches, and preview it before the player commits to the action.

**Evidence:** Mark of the Ninja: 'Whenever a noise an enemy will hear is made, there's a visualization, a spreading blue ring that says exactly how far that noise will reach.' Any guard overlapping the ring investigates, and while aiming, the game freezes and shows the rings of targeted sound sources (Gamasutra, GamesBeat). Thief made floor surfaces louder or quieter, and its AI only reacted to what it could actually perceive.

**For BankHeist:** Before confirming any action, draw its noise ring in tiles and highlight every NPC inside it, labelled with the state they will move to. Suggested radii: walk 0, Dash 2, lockpick 1, knockout 2, door breach 4, suppressed shot 3, pistol 8, rifle 12, shaped charge 15 (whole floor), drill 6 per turn. Walls cut the radius by half per wall, doors don't. NPCs in the ring go to Curious (if quiet) or Alarmed (gunshots or explosions). Treat it as perfect information, as Mark of the Ninja does: 'it's not about reaction, it's about anticipation and planning'.

### 20. Hard counters and a prep phase without a timer make destruction and vehicles a planning tool, not just a loud button.

**Evidence:** Teardown has unlimited planning time to knock down walls, build bridges and pre-place or test-drive vehicles, then a 60-second countdown once the first target is taken. Its guides warn that destroying things too early can trip an alarm. Big Bank players compared escape options (bus, elevator, C4 tunnel, chopper, roof) on travel distance and sniper spawns.

**For BankHeist:** Prep work outside the bank (placing the getaway vehicle, setting up the sniper nest, pre-placing breaching charges on outside walls the player has looked at, barricades on the escape route) should cost no heat, as long as it isn't witnessed. Each prep action has a visibility check from the street, and an 'out of hours' night variant could allow more prep. Explosions are always loud and always visible: a breach is a deliberate decision to go loud, and the tooltip shows the heat and alarm cost.

### 21. Have crew roles and a few strong special abilities rather than many small stat bonuses. A mixed team should feel complementary.

**Evidence:** Monaco has 8 classes, for example the Locksmith (opens safes and doors faster), Lookout (sees guards through walls), Cleaner (knocks out unaware enemies) and Pickpocket (a monkey collects loot). Monaco 2 lets solo players switch thieves to use different abilities. Payday 2's skill trees are Mastermind (crowd control and hostages), Enforcer, Technician (drills and turrets) and Ghost. In GTA V, crew cuts trade off against skill (a high-skill gunman 14%, a low-skill one 6%), and cheap crew miss loot or cause complications, while surviving crew level up.

**For BankHeist:** Use about 6 archetypes with one defining verb each: Face (tier 0 always, can talk an NPC from Suspicious back to Calm once per heist, wears staff disguises), Tech (loops a camera for 3 turns, fixes drills in half the time, cuts phone lines), Muscle (bigger command radius, carries Very Heavy at -25%), Marksman (sniper nest, overwatch over large areas), Demolitions (charges, traps), Driver (repositions the getaway once during loud, rams through). Each takes a payout cut and has permanent injuries or arrest. That builds attachment in the XCOM style.

### 22. Being arrested or downed should cost resources, not end the run, and the player should be able to buy a teammate back.

**Evidence:** In Payday, downed crew can be revived, are taken into custody after too many downs, and are freed by trading hostages. A job fails only if everyone is down or in custody. In Payday 3, a teammate or perk can undo an arrest after getting caught in a secure area. A failed Hitman Freelancer contract puts later levels on high alert instead of ending the run. Heat Signature is 'quite forgiving in service of fun and experimentation' (PC Gamer).

**For BankHeist:** Downed: bleeds out in 3 turns unless an ally revives. Arrested: removed into a police van, and can be recovered by a hostage trade during a lull, or permanently lost (with campaign consequences) if the heist ends. A heist fails only if every character is out or the escape becomes impossible. A failed stealth phase should make the remaining job harder, not end it.

### 23. Escalation over time should create a clear decision about cashing out, both within a heist and across a campaign.

**Evidence:** Payday 2's Crime Spree chains heists for increasing rewards and harder modifiers, and you can cash out at any point. A failure ends it unless you pay. The director's guide says to leave once risk outweighs reward. In Invisible Inc., an alarm that rises every turn forces players to weigh risky loot against getting out.

**For BankHeist:** Make the minimum objective clear (for example 4 bags). Then offer optional greed targets (deposit-box room, manager's safe, a second vault tier) with displayed expected value and heat cost. In the campaign, heat from one heist carries over partially into a city-wide 'Notoriety' that affects the next bank (more cameras, armed guards), and laying low cools it. That gives the procedural run structure meaning without mobile timers.

## Pitfalls

- Binary fail-on-detection (Payday 2): one missed guard ending a long run leads to restart-scumming and tedium. Detection must change the situation, not end it.
- An invisible or unexplained detection model. Slant's Payday 2 review felt enemies spotted players 'regardless of how close or illegal your behavior is'. If the safe-tile overlay is ever wrong, trust collapses.
- Hidden-information deaths in a turn-based game (Francis' XCOM complaint, the reason Tactical Breach Wizards and Into the Breach show outcomes in advance). Pair the cone RNG with clear previews and keep NPC behaviour deterministic.
- Dominant preplanning picks (Big Bank: Beast drill plus bus 'pretty much mandatory', thermite never used) make the planning screen a checklist.
- Police spawning out of nowhere (Payday: The Heist critique). It breaks the immersive-sim promise that traps, barricades and sniper nests matter.
- Unfair procedural layouts (Invisible Inc.'s 'impossibly far' exit). Also randomising things that just add busywork (Hitman Freelancer scavenging, randomised targets that undermine planning).
- Guard stacking and chain-reaction alerts (Murky Station: 8 guards in one area). A single discovery cascading into a whole-map alarm feels unfair.
- Hostage babysitting. Re-commanding every NPC every 2 turns with a squad of 4 against 20+ civilians becomes a chore, so make it a group action or an automatic 'guard the room'.
- Stealth that is fun once and tedious on repeat (Payday 2 Steam threads). Avoid long empty waits for patrols. Turn-based play helps, but tune patrol timing so nobody has to press 'end turn' five times in a row.
- A heat clock that feels arbitrary (XCOM 2 timer controversy). Heat should only tick on a clock after the police are called, show its next tier, and respond to player actions.
- Late-game 'relentless assault' with no lulls (Payday 3 critique) means loud play has no rhythm or decisions, just attrition.
- Grindy prep missions (GTA Online Cayo Perico: 'a vast majority of time... simple prep work'). Pre-heist planning should be a satisfying single screen or short casing phase, not a chain of chores.
- An unreadable sandbox (Hitman Paris tested as 'incomprehensible'). A procedural bank needs a consistent layout and reveal-by-scouting guidance.
- Mobile pitfalls in a turn-based design: fussy precision taps on 16px tiles. Cone aiming needs a drag-to-aim with snap-to-target and a confirm step, and must also work without hover.
- Heists that lock out content after going loud (Start Menu on Payday 3) push players into one style. Both styles should have full payouts with different costs.
- Weak or busywork co-op/AI roles (Payday 3 bots useless, Payday: The Heist AI doesn't do objectives). Not an issue for single-player control, but every squad member should always have a useful action available.

## Ideas

- A 'Trigger' order queue: before going loud, each character queues one action that fires simultaneously the moment anyone is exposed or the player presses GO. This is the heist-film 'everybody on the floor' turn.
- Alarm countdown chips over NPC heads ('Button: 1', 'Escapes: 3', 'Calling: 2'), shown in the Into the Breach style so every alarm can be stopped if the player sees it coming.
- Guard radio check-ins every N turns, with a squad-wide cap on covered check-ins (Payday's pager cap translated to turns). A missed check-in sends a dispatcher query, then a guard is sent to look.
- Three security tiers (PUBLIC / STAFF / SECURE), where getting caught in STAFF means being escorted out, as in Payday 3.
- Conspicuousness tiers 0-3 from summed gear, with 'enforcer' NPCs (guards, managers, the control-room operator) one tier more sensitive. Staff uniforms grant STAFF access.
- Blending into a panicking crowd: unexposed characters count as civilians to arriving police until seen doing something illegal. Great for the Face/insider role.
- Physical police arrival: vehicles telegraphed at map-edge staging points one turn ahead, with marked breach points. This is what makes barricades, traps, sniper nests and roadblocks pay off.
- Assault/Lull rhythm in loud play. Lulls are when you trade hostages, re-tie, move bags and fix drills.
- Hostage trades that give the player a choice of: -heat, +lull turn, a crew member back from custody, or an item delivered to the door (Payday 3 negotiation).
- An armed-civilian tell (off-duty cop's holster bulge, revealed by Inspect or casing) instead of a pure random ambush.
- A 'Guard the room' stance: a character keeps everyone in their command radius down as long as they hold LOS, which removes per-NPC re-commanding.
- Weapon-based command radius with a loud 'warning shot' option that extends it but creates a sound ring.
- Drill as a defended objective: duration by vault tier, an announced jam chance each turn, a noise ring, and preplanning picks of Silent / Beast / Thermite with different trade-offs.
- Bag relay chains: throw 2 tiles, catch, pass. A squad forms a human chain to the van, a cooperative tactic that only works on a grid.
- Positional preplanning: assets are placed on specific map tiles (getaway car spot, rented sniper room across the street, supply drop in a restroom, spycam in a corridor, tow truck blocking a road) under a cash budget plus an Exposure cap of about 8.
- Sound-ring preview: show every action's ring and which NPCs it will alert before committing, as in Mark of the Ninja. Walls halve the radius.
- Casing phase with an Inspect verb that reveals concrete facts (camera arcs, check-in interval, key holder, twitchy teller, which walls can be breached), drawn onto a blueprint-style map.
- Heat tiers with listed effects and a 'next tier in X turns' readout (Invisible Inc.-style), plus a carry-over campaign Notoriety that cools while laying low.
- Optional greed objectives with displayed expected value against heat cost, plus a clear 'minimum to succeed' line (Payday's minimum bags plus optional loot).
- Monaco-style crew archetypes with one strong defining verb each (Face, Tech, Muscle, Marksman, Demolitions, Driver) and GTA-style payout cuts against skill, plus XCOM-style injuries and leveling.
- An escape-day option: if heat is extreme at extraction, the planned route gets blocked and the squad must reach a backup getaway (Payday 2 escape levels), tied to where the player placed a second vehicle.
- Generator fairness rules (2+ routes, max 3 guards seeing one tile, the security room not visible from the vault, and so on), following Murky Station's script pass that blocked extreme distributions.

## Open questions

- Should the stealth phase be on any clock before the police are called? Invisible Inc. ticks every turn, and Teardown's prep has no timer at all. Recommendation: no clock, but guard check-ins and civilian traffic create soft pressure. The director needs to confirm.
- How much should the cone RNG be shown in advance? Options: draw the cone only; draw the cone plus the cover-block chance per target; or show an expected-hits number. Each step trades tension for fairness in the Into the Breach sense.
- Can the player rewind within a turn (Tactical Breach Wizards) or quick-save (Shadow Tactics)? This is crucial for a stealth game on mobile, but may undercut the tension of improvising.
- What exactly counts as 'cooperating with an exposed character' for guilt by association, and can an exposed character ever become unexposed (for example by changing clothes out of sight, as in Hitman)?
- Does the two-turn command duration stay fixed, or vary with each NPC's Nerve? And is Command a free action? This determines whether hostage control is tactical or a chore.
- How big is a typical procedural bank, in tiles and NPC count, at 20x11 visible tiles on a phone? How much camera panning is acceptable before readability suffers?
- Is the campaign a sequence of procedurally generated banks with persistent crew and Notoriety (an XCOM-like meta layer), or standalone runs? That decides how much the preplanning economy matters.
- Should killing guards ever be heat-neutral (for example unwitnessed, body hidden), or should lethal force always cost something to keep the 'professional' fantasy?
- Can the player do prep the night before (Teardown-style untimed planning in an empty bank), or does all prep happen during business hours under observation?
- How do police treat hostages during assaults? Do they hold fire near them (a shield tactic) or accept collateral damage at high heat (Prima notes Payday 3 police 'don't mind a casualty or two' on Overkill)?
- The brief mentions The Crew-style co-op boardgames. The Crew is a limited-communication trick-taking game, and its relevance to a single-player squad game is unclear. Burgle Bros was studied instead. Is co-op multiplayer in scope at all?

## Sources

- [VGC – Preview: Payday 3 wants to be Ocean's Eleven: The Game (security tiers, de-escalation)](https://www.videogameschronicle.com/features/preview-payday-3-wants-to-be-oceans-eleven-the-game/)
- [Insider Gaming – Payday 3 features hostage negotiation (stealth / search / negotiation)](https://insider-gaming.com/payday-3-features-hostage-negotiation/)
- [Prima Games – How to trade hostages in Payday 3](https://primagames.com/tips/how-to-trade-hostages-in-payday-3)
- [Thumbculture – Payday 3 PS5 review (stealth improvements, escort instead of fail)](https://www.thumbculture.co.uk/payday-3-ps5-review)
- [PC Gamer – Payday 3 review](https://www.pcgamer.com/payday-3-review/)
- [Start Menu – Payday 3 review in progress](https://www.startmenu.co.uk/home/review-in-progress-payday-3-the-job-has-gone-sideways)
- [Game Informer – Payday 2 strategy guide (director's advice on civilians, casing, minimum loot)](https://gameinformer.com/b/features/archive/2013/08/13/payday-2-strategy-guide.aspx)
- [Wikipedia – Payday 2 (gameplay: custody, hostage trades, escape days, skill trees, Crime Spree)](https://en.wikipedia.org/wiki/Payday_2)
- [Payday Wiki – Legacy Skills (pager timings)](https://payday.fandom.com/wiki/Legacy_Skills)
- [Steam – Payday 2 pager limit discussion](https://steamcommunity.com/app/218620/discussions/8/1698294337780392688)
- [Payday Wiki – Bank Heist (preplanning, 8-favor cap)](https://payday.fandom.com/wiki/Bank_Heist)
- [Steam – Big Bank preplanning/escape discussion (dominant assets)](https://steamcommunity.com/app/218620/discussions/8/540744934374912550/)
- [Payday Wiki – Hardware Expert (drill repair / auto-restart)](https://payday.fandom.com/wiki/Hardware_Expert)
- [Payday Wiki – Kickstarter (drill auto-restart)](https://payday.fandom.com/wiki/Kickstarter)
- [Payday Wiki – Safe (Payday 2) (Drill Sawgeant timings)](https://payday.fandom.com/wiki/Safe_(Payday_2))
- [Payday Wiki – First World Bank (Payday 2)](https://payday.fandom.com/wiki/First_World_Bank_(Payday_2))
- [Payday Wiki – Transporter (bag throw distance / movement penalty)](https://payday.fandom.com/wiki/Transporter)
- [Steam – Payday 2 bag weight and sprinting](https://steamcommunity.com/app/218620/discussions/8/627457521176416338)
- [Steam – Payday 2 police assault timer / spawn pool](https://steamcommunity.com/app/218620/discussions/8/4362280244711439255)
- [Payday Wiki – Overkill 145+ (assault duration/downtime)](https://payday.fandom.com/wiki/Overkill_145%2B)
- [Steam – Payday 2 ECM jammer mechanics](https://steamcommunity.com/app/218620/discussions/8/540744936364206797)
- [Slant Magazine – Payday 2 review (detection criticism)](https://slantmagazine.com/games/payday-2/)
- [Steam – Payday 2 stealth frustration thread](https://steamcommunity.com/app/218620/discussions/8/1644295067080884367)
- [80.lv – Designing highly replayable stealth levels for Payday 2 (Murky Station postmortem)](https://80.lv/articles/designing-highly-replayable-stealth-levels-for-payday-2/)
- [Game-Wisdom – A Big Score: A Payday: The Heist analysis](https://game-wisdom.com/?p=790)
- [Gamereactor – Invisible, Inc. review (alarm tiers)](https://www.gamereactor.eu/invisible-inc-review/)
- [Indie Game Reviewer – Invisible, Inc. review](https://indiegamereviewer.com/review-invisible-inc-from-klei-entertainment/)
- [Selectbutton – Invisible, Inc. preview](https://selectbutton.com/articles/invisible-inc-preview-corporate-espionage)
- [GDC Vault – Designing Procedural Stealth for Invisible Inc. (James Lantz)](https://gdcvault.com/play/1021919/Designing-Procedural-Stealth-for-Invisible)
- [Game Developer – Road to the IGF: Invisible, Inc.](https://gamedeveloper.com/design/road-to-the-igf-klei-entertainment-s-i-invisible-inc-i-)
- [Ufopaedia – XCOM 2 gameplay mechanics (concealment)](https://ufopaedia.org/Gameplay_Mechanics_(XCOM2))
- [CogConnected – XCOM 2 preview & developer interview](https://cogconnected.com/preview/xcom-2-hands-on-preview-developer-interview-strategic-combat-intensified)
- [Matchsticks for my Eyes – Firaxis clippings (RPS Solomon interview on timer)](https://www.matchstickeyes.com/2016/02/29/clippings-firaxis-february/)
- [Game Developer – Reinventing stealth in 2D with Mark of the Ninja](https://gamedeveloper.com/design/reinventing-stealth-in-2d-with-i-mark-of-the-ninja-i-)
- [GamesBeat – Mark of the Ninja preview (sound rings)](https://gamesbeat.com/mark-of-the-ninja-preview/)
- [Game Developer – Postmortem: Thief: The Dark Project](https://www.gamedeveloper.com/design/postmortem-i-thief-the-dark-project-i-)
- [Game Developer – Road to the IGF: Into the Breach](https://gamedeveloper.com/game-platforms/road-to-the-igf-subset-games-i-into-the-breach-i-)
- [Wikipedia – Tactical Breach Wizards](https://en.wikipedia.org/wiki/Tactical_Breach_Wizards)
- [Teardown docs – Heist basics](https://get-teardown.readthedocs.io/en/latest/gameplay/heist-basics.html)
- [Kotaku – Teardown is a heist game where levels are fully destructible](https://kotaku.com/teardown-is-a-heist-game-where-levels-are-fully-destruc-1845574471)
- [Shacknews – Monaco 2 GDC 2024 preview](https://www.shacknews.com/article/139427/monaco-2-gdc-2024-preview)
- [God is a Geek – Monaco review (classes)](https://www.godisageek.com/2013/05/monaco-review)
- [PC Gamer – Heat Signature review](https://www.pcgamer.com/heat-signature-review)
- [Game Informer – Heat Signature review](https://www.gameinformer.com/games/heat_signature/b/pc/archive/2017/09/27/heat-signature-game-informer-review.aspx)
- [Inverse – Cayo Perico heist and open-ended mission design](https://inverse.com/gaming/gta-6-missions-cayo-perico-heist)
- [Kotaku – GTA Online's new island is boring (prep grind)](https://kotaku.com/gta-onlines-new-island-is-boring-1845891241)
- [GTABase – The Diamond Casino Heist (approaches, scoping)](https://gtabase.com/gta-online/jobs/heists/the-diamond-casino-heist)
- [GTA Wiki – Casing the Jewel Store (Smart vs Loud, crew cuts)](https://gta.fandom.com/wiki/Casing_the_Jewel_Store)
- [GTAIntel – GTA V heists complete crew guide](https://gtaintel.com/news/gta-5-heists-complete-crew-guide)
- [GDC Vault – Level Design in HITMAN: Guiding Players in a Non-Linear Sandbox](https://gdcvault.com/play/1023849/Level-Design-in-HITMAN-Guiding)
- [GamesRadar – Hitman review (disguise recognition)](https://www.gamesradar.com/au/hitman-review/)
- [Wccftech – Hitman Freelancer review](https://wccftech.com/review/hitman-world-of-assassination-freelancer-mode-a-flawed-new-endeavor/amp/)
- [Steam – Hitman Freelancer randomization discussion](https://steamcommunity.com/app/1659040/discussions/0/598514132636974233)
- [Theology of Games – Burgle Bros review (alarms speed the guard)](https://theologyofgames.com/blog/2016/1/19/take-the-money-and-run-a-double-take-review-of-burgle-bros)
- [BoardGameArena – Burgle Bros rules](https://fi.boardgamearena.com/doc/Gamehelpburglebros)
- [Commandos/Desperados vision cone recreation (Shadow Tactics cone zones)](https://rich-p.itch.io/commandos)
- [Steam – Shadow Tactics view cone readability discussion](https://steamcommunity.com/app/418240/discussions/0/1290691937705159737)
- [Scientific Gamer – Thoughts: SWAT 4 (compliance & morale)](https://scientificgamer.com/thoughts-swat-4/)
- [No Film School – Heist movie beats template](https://nofilmschool.com/heist-movie-beats-template)
- [The Script Lab – Mission: Impossible formula for heist sequences](https://thescriptlab.com/features/screenwriting-101/13302-mission-impossible-formula-to-writing-thrilling-heist-sequences)
