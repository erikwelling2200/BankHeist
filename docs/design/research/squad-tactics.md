# Squad tactics (XCOM & co.)

Turn-based squad tactics games offer BankHeist three proven models for running a stealth phase and a combat phase in one mission. XCOM 2 uses squad-wide concealment and an ambush opener. Jagged Alliance 3 runs exploration in real time and switches to turn-based play when the player is detected. Phantom Doctrine has open-ended turn-based infiltration, with outfit tiers, restricted zones and an alarm that brings endless reinforcements. Phantom Doctrine is the closest existing match to the brief: undercover agents walk freely in public areas, armour tiers decide where you can be seen, and anyone who spots you in a restricted area starts combat. Critics praised it but said it explained its detection rules poorly and lacked an in-between "suspicious" state. The main lesson for BankHeist is that detection must be rule-based, fully previewed and taught. XCOM 2's critics also hit it for not showing which tiles enemies could see. The brief's idea of marking safe floor tiles is right, but it should go further and show who would notice you, and why, before you commit to a move.

On combat, the brief's cone aiming has close precedents. Phoenix Point's free aim draws two circles (every bullet lands in the outer one, about half in the inner one) and simulates damage per bullet. Gears Tactics lets the player drag out an overwatch cone: a wider cone is less accurate, and the unit fires once per remaining action point. Both were praised for agency. Phoenix Point was criticised when the simulated bullets hit railings or boxes the player expected them to clear. With 16px tiles at 320x180, BankHeist must make the cone and its expected result easy to read, and hit tests must match what the player sees. A key consequence of a 50% per-bullet cover roll: guns that fire many bullets get dependable damage through cover, while 2-shot rifles swing between all and nothing. Stats such as per-bullet armour are needed so the Uzi doesn't become the default answer to every cover position.

On pacing, the genre's best-known failure is turtling (the "overwatch crawl"). XCOM 2 answered it with mission timers, which drew wide backlash; modders' main fix was to start the timer only once concealment broke. Gears Tactics (executions grant the whole squad an extra action point) and Hard West 2 (a kill refunds that character's action points) push players forward by rewarding aggression. Invisible, Inc. uses a visible alarm that rises every turn. BankHeist's heat system is a timer, and it will draw the same complaints unless the stealth phase stays untimed, heat rises in visible steps with each step's effect shown in advance, and players get ways to bring heat down. Handling many NPCs comes down to presentation: move everyone at once, telegraph what civilians intend to do (Into the Breach style), and keep the world turn short (compare XCOM 2's Zip Mode, and Jagged Alliance 3 players complaining about waiting up to a minute). Squad size should stay around 4 (Solomon: losing one of four is a 25% loss, and bigger squads steamroll the enemy). Turns should stay side-based so the sneaker-plus-heavies plan the brief describes can be coordinated. Chimera Squad's interleaved timeline made coordinating attacks harder, according to reviews.

## Lessons

### 1. Make the stealth layer run on rules you can read before you act, not on hidden checks. Show not only where you are safe but also which tiles a given observer would notice you on, and why.

**Evidence:** In XCOM 2, red tiles mark moves that would break concealment, and players value being warned before committing (Steam thread). The Game Developer article 'XCOM 2 and Vision: The Cost of an Illusion' criticises the UI for not showing which tiles are visible, saying this makes careful play feel like guessing. A Long War 2 player found that one enemy type's displayed detection radius didn't match its real behaviour, and argued that predictable rules matter more than perfect AI.

**For BankHeist:** When a character is selected, tint every reachable tile green (safe), yellow (would make someone suspicious) or red (would raise the alarm). Holding or long-pressing a yellow or red tile shows the observer's portrait, their vision line, and the reason, e.g. 'Guard: sees rifle (conspicuousness 3 > tolerance 2)'. The preview must use exactly the same function as the real detection check.

### 2. Gear-based conspicuousness combined with zones (public / staff / restricted) is a proven model. Players need an in-between 'suspicious' state and clear teaching, or the system feels like a wall.

**Evidence:** Phantom Doctrine has full assault armour (draws attention from anyone who sees it), body armour (accepted in unrestricted zones but not restricted ones) and undercover (roams almost freely). Disguised agents carry only sidearms or SMGs, and enemy 'Beholder' agents see through disguises. Bit-tech called infiltration 'very restrictive' and asked for a 'suspicious but not alerted' state. PC Gamer and the Guardian faulted the game for not teaching how detection works. In Long War 2, SMG carriers get a smaller detection radius, and a Shinobi perk gives a 20% smaller detection range.

**For BankHeist:** Give each character a Conspicuousness score from 0 to 4, made up of weapon size, armour, carried loot bag and any visible blood. Give each zone a tolerance: lobby 2, staff corridor 1, back office/vault 0 (any sighting there is a trespass). Add Suspicious as a middle NPC state: the NPC walks over to look, questions the character, or radios a colleague, and the player gets one turn to answer (leave, put the gun away, show a disguise, intimidate). A few roles, such as the bank manager or the guard captain, see through disguises, like Phantom Doctrine's Beholders.

### 3. Going loud should open with a player-controlled ambush turn. Enemies who were truly unaware lose their first reaction, while alert ones get only a short scramble.

**Evidence:** In XCOM 2, Solomon said the first enemy you jump on 'can't scamper anywhere', and surprised enemies may not fully reach cover. Concealment lets the player decide when a fight starts. Jagged Alliance 3 Dev Diary 12 gives the player the first turn and gives alerted enemies a short reposition phase with a much smaller AP budget, while Surprised enemies skip it.

**For BankHeist:** When the alarm goes off or the first shot is fired, the crew always finishes its current turn. On the first world turn, any NPC who was Unaware gets status 'Stunned (1 turn)': civilians drop, guards fumble. NPCs who were Suspicious get a reposition of 2 tiles. Setting this up, by putting the gunner next to the guard and the sneaker at the alarm panel, is the reward for good stealth play.

### 4. Detection status per character is more believable than squad-wide detection, but it needs NPCs who talk to each other. Otherwise you get XCOM's 'See No Evil' illusion, or a mission made of repeated ambushes.

**Evidence:** In XCOM 2 one revealed soldier reveals the whole squad, except a Phantom Ranger. 'The Cost of an Illusion' argues that per-squad concealment would turn missions into strings of ambushes, and that enemies ignoring nearby gunfire or dying allies breaks belief in them.

**For BankHeist:** Keep the brief's rule that each character must be spotted individually, but have alerts spread through the sim: radios (guards share a description of whoever they spotted), the sound circles in the brief, and a 'wanted description' that marks the outfit or weapon. Swapping an outfit or ditching a weapon clears the description. Alerts then spread logically, not all at once, and nobody stays oblivious next to gunfire.

### 5. Use a simple, fixed action economy: two actions per character per turn, with weapon-dependent costs rather than time units.

**Evidence:** Solomon said Time Units 'made it less fun to consider how these abilities were going to combine', and that prototypes with the move/action system were 'far more engaging'. In Phoenix Point, heavier weapons cost more action points, so a heavy gunner has to choose between moving and firing. Mario + Rabbids splits actions into groups (move, weapon, special) that can be used in any order, which reviewers praised as flexible.

**For BankHeist:** Each crew member gets 2 actions per turn. Moving up to 5 tiles costs 1 action (4 with heavy armour). Pistol, SMG and AR attacks cost 1 action and don't end the turn. LMG, shotgun breach and sniper attacks cost 2. Shouting a command, zip-tying, picking a lock and carrying a bag are all costed in the same actions. Two actions are simple enough to read and plan on a phone.

### 6. Cover blocks each bullet separately, so weapons with more bullets get steady damage through cover. Balance that with per-bullet armour and damage so cover doesn't become irrelevant to SMGs.

**Evidence:** Phoenix Point models damage per bullet. Gollop confirmed each bullet of a burst can hit something. Under the brief's rule of a 50% block per bullet, a 2-shot AR whose shots both reach a target in cover lands 0 hits 25% of the time, while an 8-round SMG lands about 4, a steady expected value. Mario + Rabbids' fixed 50% half-cover shot drew the complaint that without a flank 'you have to depend on a flip of the coin'.

**For BankHeist:** Give every gun a per-bullet Damage stat and every armour a flat per-bullet reduction, e.g. Uzi 2 damage vs light armour 1: each hit does 1. AR 5 damage vs light armour 1: each hit does 4. Then the AR beats armour and the SMG beats unarmoured targets in cover. Show expected hits and expected damage in the aim preview so players can see the trade-off.

### 7. Free-aim cones are only fun if the outcome you see matches the simulation. A shot that looks clear but clips scenery reads as a bug.

**Evidence:** Phoenix Point's two-circle reticle (100% outer, about 50% inner) let players thread shots through gaps and was praised. Techxplore reported hitboxes 'extremely wonky', with soldiers shooting into railings and boxes they should shoot past. Players also report the cover system feeling 'unreliable'. Gears Tactics' overwatch cone ('the further out you aim, the wider the cone') was well received because it is simple to read.

**For BankHeist:** Resolve bullets on the 16px tile grid with tile-sized target boxes, not per-pixel sprites. Draw the cone as a wedge that stops at the first full-height obstacle. In the preview, colour each target by the expected number of hits (e.g. '~2.6 of 6 bullets', with a shield icon showing '50% blocked by desk'). Never let a bullet stop on something the preview didn't show it hitting.

### 8. Players read displayed odds emotionally, so show the cone's outcome as a clear number. A single unlucky volley should not wipe out the player's plan.

**Evidence:** Solomon said: 'If you see an 85 percent chance to hit, you're not looking at that as a 15 percent chance of missing.' He added that 'That 85 percent isn't actually 85 percent' on lower difficulties, and that Firaxis avoids streaks of missed high-probability shots. Into the Breach rolls Grid Defense (15% base) ahead of time, so its one Reset Turn per battle cannot be used to fish for a better result.

**For BankHeist:** Fix the random spread when the turn starts (seeded per shot), so undoing and retrying gives the same spread. Show 'expected hits', and give each cone a guaranteed centre line: the first bullet always travels down the aim line, and recoil only spreads the bullets after it. That makes the AR's first round dependable while the Uzi's later rounds scatter, as the brief describes, and spares players a 0-of-2 miss at point-blank range.

### 9. Undo movement freely within a turn, but lock in anything that revealed new information. This removes touch misclicks and fear of experimenting without making the game trivial.

**Evidence:** Tactical Breach Wizards lets you rewind anything within the current turn. Francis says rewinds 'remove the fear of failure and mistakes, and the risk that discourages people from trying interesting things'. It won the IGF Excellence in Design award, with 98% positive user reviews. Into the Breach gives one Reset Turn per battle, and its mobile port praised tap-unit then tap-tile movement.

**For BankHeist:** Make all crew moves this turn undoable until the player taps 'End Turn' or an action reveals something new: a room opening, a roll, an NPC reacting. Undoing a move that changed nothing is free, so tapping the wrong tile on a phone never costs a heist.

### 10. Telegraph what NPCs intend to do on their next turn. That turns the crowd from random noise into a puzzle and gives the 2-turn command mechanic counterplay.

**Evidence:** Into the Breach makes every enemy attack visible in advance so that 'every death felt like your own fault'. Subset said that with telegraphed enemies and no random attack outcomes, the game 'starts to feel like a puzzle'. Tactical Breach Wizards keeps surprise for the enemy turn, so the planning phase has no hidden enemy behaviour to guess at. Chimera Squad's timeline shows when enemies act but not what they will do.

**For BankHeist:** Above each commanded hostage, show a countdown of 2 pips. When it reaches 0, show the NPC's intent icon and path arrow: run to a door, go for the alarm button, reach for a hidden pistol, or stay put if cowed. Hidden-gun carriers should show a subtle tell such as a twitchy hand rather than nothing at all. Show guard patrol paths during stealth, and show reinforcement arrival turns and entry points once loud.

### 11. Keep turns side-based (crew phase, then world phase) rather than interleaved, because BankHeist's core fantasy is coordinated multi-character plans.

**Evidence:** Chimera Squad's interleaved timeline drew a review complaint that it makes coordinating your units' attacks harder. PC World argued it only works because Chimera Squad was built entirely around it. XCOM's side turns let the player sequence a whole squad, e.g. a flashbang and then a flank.

**For BankHeist:** Crew acts in any order. The world phase then resolves in a fixed, documented order: civilians, then bank staff, then guards, then police. Within each group all NPCs move at once. A single 'Team-up' style perk can allow an out-of-phase action, but the base model stays side-based so 'sneaker disables the alarm, then heavies enter the same turn' just works.

### 12. With many NPCs, the world phase is a presentation problem. Move everyone at once, skip what doesn't matter, and cap how long the phase takes.

**Evidence:** XCOM 2: War of the Chosen added Zip Mode, which cut pauses from about 3 seconds to about 0.6 seconds per a mod changelog. Jagged Alliance 3 players complained about waiting 'up to a minute or longer' for enemy turns. Owlcat reportedly grouped large mobs in the initiative order after alpha testers found big groups too slow. Indie developers commonly add an enemy-turn speed-up.

**For BankHeist:** Target 2 seconds or less for a quiet world phase and 5 seconds or less for a loud one. Animate all civilian and staff movement in one simultaneous tween. Pan the camera only to events that matter to the player: a new suspicion, an alarm press, a shot at the crew, an NPC escaping. Gather everything else in a turn log. Offer speed options of 1x, 2x and instant, and let a tap skip ahead.

### 13. Time pressure is necessary but timers are hated. Pressure should start only after detection, be visible and stepped, and get worse by degrees instead of ending the mission.

**Evidence:** XCOM 2's timers were called contrary to careful tactical play, and a Steam poster saw them as the answer to the 'Overwatch Crawl' meta. The True Concealment mod made timers start only when concealment breaks. Phantom Doctrine's infiltration has no turn limit. Invisible, Inc. raises a visible alarm level after each turn and adds threats at each level, which reviewers say pushes against slow creeping. Keith Burgun proposes reinforcements over time as the fix for players having no reason to advance.

**For BankHeist:** Heat does not tick in the stealth phase, which is untimed, because the bank's own schedule is the clock: shift changes, an armoured-van delivery, closing time. Once the alarm is raised, heat climbs on a visible bar in steps of about 5 turns at base. Each step is announced a turn ahead ('Heat 3 in 2 turns: SWAT van, breach charges'). Kills seen by police add a full step right away. Releasing a hostage removes part of a step. Running out of time means escalating force (snipers, then SWAT, then gas), never a 'mission failed' screen.

### 14. Reward forward momentum through actions the player is meant to do, not through kills. Otherwise overwatch-camping wins.

**Evidence:** Gears Tactics: executions give every squad member a bonus action point, and Bielman described the goal as rewarding offense in a genre that usually asks players to be patient. Hard West 2: a kill refunds that character's AP (Bravado), and the designer said 'Turtling won't get you far'. Reviewers note that without such incentives fights turn into both sides waiting each other out.

**For BankHeist:** BankHeist penalises killing through heat, so its momentum rewards should go to control: dominating 3 or more NPCs with one command, zip-tying, or completing a heist objective (drill placed, alarm cut, vault opened) gives the squad +1 action or a free 'Reposition' move. Then the efficient way to play is to move fast through the bank and lock it down, not to sit in a corridor.

### 15. Overwatch should be a cone the player draws, using the same aim model as normal shots, with clear counters. That stops it becoming the only answer.

**Evidence:** Gears Tactics: you drag out the overwatch cone (wider means less accurate), you get one shot per remaining AP, and grenades or disabling shots break enemy overwatch. A Film Stories reviewer said its cones can build chokepoints rather than serving only as defence. XCOM players and analysts describe 'overwatch creep' as the default, dull answer to pod activation.

**For BankHeist:** Overwatch costs the rest of a character's actions: 1 remaining action buys 1 volley. The player draws the arc, and narrower arcs give tighter spread. Police at Heat 2 and above carry flashbangs and teargas that cancel overwatch and push characters out of a tile. Overwatch should also control hostages: an NPC who runs through an overwatch cone triggers a warning shout instead of a shot, re-commanding them for free.

### 16. No dormant enemy pods. NPCs should run on schedules and senses, while reinforcement waves set the pace of loud combat.

**Evidence:** Analyses say XCOM pods (groups of 3-5 that sit until they see you, then scamper to cover) punish scouting and leave a single overwatch-trap opening. Activating several at once can leave you outnumbered 2-3 to 1. The Game Developer deep dive says the original X-COM's per-enemy sight and hearing ranges were more believable.

**For BankHeist:** Guards, staff and civilians each follow schedules: patrol loops, teller stations, coffee breaks, cash runs. They react to sight and sound radius individually, as the brief already implies. Once the alarm is raised, police arrive as scheduled waves from telegraphed entry points, scaled by heat. Encounter size is set by the wave tables, not by hand-placed pods, which fits a procedurally generated bank.

### 17. Keep the squad small, 3 to 5 crew, starting at 4, so every character matters and the crew can't wipe the map in one turn.

**Evidence:** Solomon: small squads keep turn-based combat interesting, large squads let players overwhelm enemies before they can respond, and losing one soldier is a 25% loss in strength. He said they 'kept iterating on squad size'. Tactical Breach Wizards caps the team at 5, each member with a unique kit.

**For BankHeist:** Base heist crew of 4, maximum 5. With a 20x11-tile view and touch input, 4 portraits fit along one screen edge. Each crew member should have a distinct role, such as Face (low conspicuousness, talks), Tech (alarms, cameras), Muscle (heavy weapons, command radius) and Driver/Sniper (off-site), so the brief's mixed-team plan comes naturally.

### 18. Give destruction and explosives a real cost in the loot economy, so blowing walls is an interesting choice and not the default.

**Evidence:** In XCOM 2, enemies killed by explosives drop no loot ('Loot Destroyed!'), which players read as balancing grenades that would otherwise one-shot anything. Frag grenades destroy most cover in one blast. In Mario + Rabbids, missed shots damage and eventually break cover. Into the Breach gives every move a collateral risk, e.g. a dodged hit landing on a building that matters more than the mech.

**For BankHeist:** Breaching charges and grenades destroy cover and walls, but they also burn some cash or deposit boxes within 2 tiles, make a huge sound circle, and can wound hostages, which adds heat if police see it. Missed bullets wear down cover: desks have 2 HP and glass partitions 1. Walls in the vault area can be blown, but loot lost to the blast must be visible in the preview.

### 19. Mid-mission extraction should be a planned, telegraphed vehicle arrival, and the pressure of reinforcements should make the exit the climax.

**Evidence:** Phantom Doctrine: you call a getaway van that takes a few turns to arrive. Guides say to call it early, pick the evac point ahead of time and overwatch the alleys. Reinforcements keep coming until you escape. Reviewers found the alerts fair but very punishing.

**For BankHeist:** The player places the getaway vehicle during planning. The vehicle's position sets how many turns it takes to arrive once called (e.g. 2 at a side street, 4 at the rear garage, which is safer). Carrying a loot bag halves movement, so the exit is a moving tactical puzzle. Extraction is always possible: escaping with less loot is a partial success, not a failure.

### 20. Preparation should trade off against conspicuousness and time, so the planning screen holds real decisions.

**Evidence:** In Long War 2, larger squads and heavier gear take longer to infiltrate, and going in under-infiltrated raises enemy strength (one player saw opposition rise from 'Extremely Light' to 'Moderate' at 57%). Phantom Doctrine lets disguised agents start inside the area but limits them to sidearms and SMGs. IGN called its preparation the satisfying part.

**For BankHeist:** In pre-heist planning, choose who enters 'casual' (pistol hidden, conspicuousness 0-1, starts inside the lobby) and who waits in the van with heavy kit (enters when called). Optional scouting days reveal camera positions, guard counts and vault tier, but each one raises the bank's vigilance by a small amount. Gear stashes such as a duffel in a restroom let a casual crew member arm up inside, a classic heist beat.

### 21. Stealth and combat both need to be turn-based, or at least pausable. Real-time stealth without pause frustrates squad set-ups, which is the core of BankHeist.

**Evidence:** Jagged Alliance 3 runs exploration in real time, and a Siliconera review said that without a pause button 'it was difficult to set up takedowns or other more fiddly techniques before being spotted'. TurnBasedLovers found stealth unclear in a playtest. Phantom Doctrine and XCOM 2 run infiltration turn-based, which suits careful paired actions such as one agent doing the takedown while another disposes of the body.

**For BankHeist:** Run the whole heist turn-based, including stealth, where turns are cheap: no limit, an instant world phase when nothing notable happens, and a 'wait until something changes' button that fast-forwards the bank's schedule until an NPC enters view or a patrol passes. This keeps stealth precise on touch without dull stepping.

### 22. On a phone, show less information at any moment, reveal detail when asked, and keep the one-board-screenshot clarity.

**Evidence:** Subset said the Into the Breach mobile port meant 'revisit[ing] every single UI window', and they had to give up showing all information at once, using collapsible UI or cutting non-essential information. Reviewers praised tap-unit then tap-tile controls on a crowded board. Hitman GO's postmortem credits its mobile success to distilling Hitman to its core inside firm constraints, with a readable diorama board.

**For BankHeist:** Default view: tiles, units, sound circles, intent arrows and the safety tint for the selected character. Long-press any NPC for their awareness state, what they can see and their timer. Long-press any tile for cover and visibility. Every number lives in a pull-up panel. Each icon must read at 16px, so use a fixed small icon set with shape plus colour, not colour alone.

### 23. Some missions are meant to be lost, and a long campaign needs partial success, or players will reload or restart early.

**Evidence:** The Game Developer deep dive notes that expert XCOM players restart after early losses. It also notes that original X-COM and Long War expect you to lose battles but win the war, some missions are built to be retreated from, and falling behind in XCOM can trigger a negative feedback loop.

**For BankHeist:** Score each heist in tiers: crew escaped, plus how much loot and how much heat remains. A captured crew member becomes a rescue or bail objective rather than permadeath by default. Heat that carries into the campaign raises later banks' vigilance, so a messy heist has consequences, but the campaign never hits a dead end.

## Pitfalls

- Hidden detection rules: XCOM 2 and Phantom Doctrine were both criticised for not showing or teaching what enemies can see. If the safe-tile tint is ever wrong, players stop trusting the stealth layer completely.
- A heat timer that ticks from mission start would repeat XCOM 2's timer backlash. Stealth must be untimed (pressure comes from the bank's schedule), and loud pressure should escalate, not fail the mission.
- Overwatch creep and turtling: if holding a corridor with overwatch beats pushing forward, players will do it every time. Police need tools that break overwatch, and progress or control actions need rewards.
- Spray-weapon dominance: with 50% cover per bullet and no armour or damage trade-off, high-bullet weapons become the universal answer to cover, and the AR-vs-Uzi distinction falls apart.
- Wonky ballistics: Phoenix Point's shots hitting railings and boxes the player expected to clear. On a 16px grid, sub-tile sprite hitboxes would cause this constantly.
- Tedious world phases: animating 30 civilians one after another (Jagged Alliance 3 players reported waiting up to a minute for enemy turns). Movement must be simultaneous, with a speed control and skip.
- Combat that stops making sense: enemies ignoring gunfire next door (XCOM's 'See No Evil') would ruin an immersive sim. Sound and radio spread must be consistent.
- A per-character spotting system that turns into a string of easy ambushes if alerts don't spread (the Game Developer argument against per-squad concealment).
- Dormant XCOM-style pods that punish scouting and force overwatch traps. They would contradict a living bank.
- Phantom Doctrine's late-campaign sameness: procedural infiltrations that 'feel like the last one'. Banks need varied layouts, security tiers and complications, not just reshuffled rooms.
- Phantom Doctrine-style 'detected means doomed': if going loud always means an unwinnable endless wave, players will reload instead of improvising, which kills the XCOM-meets-Payday half of the brief.
- Interleaved initiative (Chimera Squad) would break the multi-character combos the brief relies on.
- Large squads or too many abilities: Solomon found big squads sweep the map in one turn and leave units idle. On a 20x11-tile phone view, more than 5 crew becomes unmanageable.
- Luck streaks that read as unfair: two 2-shot misses at point-blank range will feel like a bug. Volleys need a guaranteed first-bullet line or seeded spread.
- Kill-refund momentum (Hard West 2 Bravado) copied directly would clash with the heat-on-kill rule and push players toward slaughter.

## Ideas

- Safe-move tint in three colours (green safe, yellow suspicious, red alarm), with long-press to show which NPC would notice and why, e.g. 'sees rifle'.
- Suspicious NPC state that gives the player one turn to answer: leave, put the weapon away, intimidate, or use a disguise.
- Wanted description: an alert carries the spotted character's outfit and weapon over radio, and changing outfit or ditching the weapon clears it.
- Ambush opener: when going loud, NPCs who were Unaware are stunned or dropped for one world turn, and Suspicious ones get only a 2-tile scramble (Jagged Alliance 3 reposition, XCOM 2 no-scamper).
- Gears-style drawn overwatch cone using the same Aim/Recoil cone. Narrower arc means tighter spread, and hostages who run through it get a free shout that re-commands them instead of a shot.
- Momentum for control instead of kills: dominating 3 or more NPCs at once, or finishing an objective, gives the squad +1 action.
- Countdown pips over commanded hostages, plus an intent arrow when they hit 0: going for the door, the alarm button, a hidden gun, or staying cowed.
- Hidden-gun civilians carry a subtle visual tell rather than being a pure surprise, keeping Into the Breach's 'your own fault' feel.
- Spread seeded per turn so undo/retry can't reroll shots, with a guaranteed first bullet down the aim line and recoil spreading only the later bullets.
- Per-bullet damage minus per-bullet armour so ARs beat armour and SMGs beat cover. The preview shows expected hits and expected damage per target.
- Heat in visible steps announced a turn ahead ('Heat 3 in 2 turns: SWAT, breach charges'). Seen kills add a full step, releasing hostages lowers it.
- The bank's schedule as the stealth clock: shift change, armoured-van delivery, closing time (when the vault time lock engages or the crowd thins).
- A 'wait until something changes' button that fast-forwards untimed stealth until an NPC enters view or a patrol passes.
- Getaway vehicle placed during planning, with arrival time depending on location (2 turns street, 4 turns rear garage). Loot bags slow movement, so the exit becomes the climax.
- Pre-heist choice of who enters casual and who waits in the van with heavy gear. Gear stashes (a duffel in a restroom) let a casual crew member arm up inside.
- Optional scouting days that reveal intel but raise the bank's vigilance (inspired by Long War 2 infiltration trade-offs).
- Explosives that burn nearby cash or deposit boxes and wound hostages, with the expected loot loss shown in the preview (XCOM 2's 'Loot Destroyed').
- Cover with HP: missed bullets wear it down (desk 2 HP, glass partition 1), as in Mario + Rabbids.
- A small set of manager or guard-captain roles who see through disguises (Phantom Doctrine Beholders) as a priority target or obstacle.
- Free undo of crew moves within a turn until new information is revealed (Tactical Breach Wizards rewind, adapted).
- World phase capped at 2 seconds quiet and 5 seconds loud, with all movement simultaneous, the camera panning only to important events, and the rest in a turn log.
- Tiered heist results (escaped, loot amount, remaining heat) and a captured crew member as a rescue objective instead of a hard fail.

## Open questions

- Should cover be two-tier (low = 50% per bullet, high = blocks line of sight unless the character leans out), or single-tier as in the brief? Full-height bank features such as pillars and counters seem to need a full-block rule.
- How exactly is 'right in front of a character' defined: cover on the tile edge between target and shooter within a 90-degree arc, as XCOM flanking works? It needs a crisp rule players can read from a shield icon.
- Do player characters get only 2 actions? Is 5 tiles per move action right for a roughly 20x11 visible area, given that banks will span several screens?
- Should commanding NPCs to stay down cost an action, and does it work only within line of sight, only within a radius, or both? How does command radius scale with weapon size without making the LMG mandatory?
- When a command expires after 2 turns, does the NPC act right away on that world turn, or show intent first and act a turn later (which gives counterplay)?
- Do police ever use cones and cover with the same rules as the crew? Should SWAT have perks such as overwatch-breaking flashbangs, shields that block cones, or sniper squadsight?
- How far should procedural generation go: fully procedural floorplans, or handmade room modules placed on a procedural layout (as Invisible, Inc. reshuffles hallways, security and objectives)? Readable, fair stealth may need module-level authoring.
- Is there permadeath? Solomon ties permadeath to turn-based design and attachment, but a mobile-friendly, non-punishing design might prefer injury or capture states.
- How large should the off-site layer get (sniper nest in a nearby building, vehicle ramming)? Does the map include the street and adjacent buildings, and how is that shown in a 180px-tall view?
- Should the bank's schedule (shift change, closing) put any soft time pressure on stealth, or is untimed stealth plus a 'wait' button the better player experience?

## Sources

- [Jake Solomon explains the careful use of randomness in XCOM 2 (Game Developer)](https://www.gamedeveloper.com/design/jake-solomon-explains-the-careful-use-of-randomness-in-i-xcom-2-i-)
- [A Deep Dive Into XCOM and XCOM 2 (Game Developer)](https://www.gamedeveloper.com/design/a-deep-dive-into-xcom-and-xcom-2)
- [XCOM 2 and Vision: The Cost of an Illusion (Game Developer)](https://gamedeveloper.com/design/xcom-2-and-vision-the-cost-of-an-illusion)
- [Concealment (XCOM2) - UFOpaedia](https://ufopaedia.org/Concealment_(XCOM2))
- [Cover (EU2012) - UFOpaedia](https://ufopaedia.org/index.php/Cover_(EU2012))
- [XCOM: Enemy Unknown Game Mechanics (TrueAchievements)](https://www.trueachievements.com/game/XCOM-Enemy-Unknown/walkthrough/6)
- [XCOM: Enemy Unknown Lead Designer Responds to Fans' Concerns (GameBanshee)](http://www.gamebanshee.com/ddq)
- [XCOM lead designer: We kept iterating on squad size and combat dynamics (GamingBolt)](https://gamingbolt.com/xcom-lead-designer-we-kept-iterating-on-squad-size-and-combat-dynamics)
- [XCOM 2 Hands-On Preview & Developer Interview (COGconnected)](https://cogconnected.com/preview/xcom-2-hands-on-preview-developer-interview-strategic-combat-intensified)
- [The four essential ingredients of XCOM, according to Jake Solomon (PCGamesN)](https://www.pcgamesn.com/xcom-2/xcom-jake-solomon-interview)
- [Clippings: Firaxis February (RPS interview recap on timers)](https://www.matchstickeyes.com/2016/02/29/clippings-firaxis-february/)
- [XCOM 2 Steam discussion: red tiles while concealed](https://steamcommunity.com/app/268500/discussions/0/3156453942263864020)
- [XCOM 2 Steam discussion: timed missions vs overwatch crawl](https://steamcommunity.com/app/268500/discussions/0/1698293255129519888)
- [True Concealment mod discussion (timer starts on concealment break)](https://steamcommunity.com/workshop/filedetails/discussion/618077830/412446292772464487)
- [Stop Wasting My Time WotC changelog (Zip Mode)](https://steamcommunity.com/sharedfiles/filedetails/changelog/620600092)
- [Loot (XCOM 2) - XCOM Wiki](https://xcom.fandom.com/wiki/Loot_(XCOM_2))
- [Pavonis Interactive Q&A on Long War 2 (xcom.com)](https://xcom.com/news/xcom-2-pavonis-interactive-q-a-on-long-war-2/amp)
- [AI omniscience and my changing definition (XCOM Commander's Journal)](https://xcom.substack.com/p/ai-omniscience-and-my-changing-definition)
- [How to build a great Shinobi soldier in Long War 2 (PC Gamer)](https://www.pcgamer.com/shinobi-build-long-war-2/)
- [Gears Tactics preview interview (VICE)](https://www.vice.com/en/article/gears-tactics-preview-interview)
- [Gears Tactics is a shockingly good strategy game (PC Gamer)](https://www.pcgamer.com/gears-tactics-is-a-shockingly-good-strategy-game)
- [7 things I wish I knew before playing Gears Tactics (PC Gamer)](https://pcgamer.com/gears-tactics-tips)
- [Gears Tactics review - stop and think (Film Stories)](https://filmstories.co.uk/reviews/gears-tactics-review-stop-and-think-and-then-chainsaw/)
- [Gears Tactics Review (bit-tech)](https://bit-tech.net/reviews/gears-tactics-review/1)
- [Julian Gollop Facebook Live Q&A (Phoenix Point)](https://phoenixpoint.info/blog/2018/1/22/julians-live-question-and-answer-session-on-facebook-live)
- [Phoenix Point review (God is a Geek)](https://godisageek.com/reviews/phoenix-point-review)
- [Game review: Phoenix Point is chaotic and delightful (Techxplore)](https://techxplore.com/news/2019-12-game-phoenix-chaotic.amp)
- [Phoenix Point helpful hints for XCOM players (reticle rules)](https://steamah.com/phoenix-point-year-one-edition-helpful-hints-for-xcom-players/)
- [Jagged Alliance 3 DevDiary 12 - Combat Part 2](https://community.jaggedalliance.com/index/dev-diaries/devdiary-12-combat-part-2-r17/)
- [Jagged Alliance 3 review (Siliconera)](https://siliconera.com/review-jagged-alliance-3-is-a-solid-game-held-back-by-its-humor)
- [Jagged Alliance 3 first impressions (TurnBasedLovers)](https://turnbasedlovers.com/review/jagged-alliance-3-did-they-screw-it-up-first-impressions)
- [Jagged Alliance 3 review summary (Vaporlens)](https://vaporlens.app/app/1084160/jagged_alliance_3)
- [Road to the IGF: Subset Games' Into the Breach (Game Developer)](https://gamedeveloper.com/game-platforms/road-to-the-igf-subset-games-i-into-the-breach-i-)
- [Into the Breach Design Postmortem (GDC Vault)](https://gdcvault.com/play/1025772/-Into-the-Breach-Design)
- [23 tips to help you dominate Into the Breach (Game Informer)](https://www.gameinformer.com/b/features/archive/2018/02/27/23-tips-to-help-you-dominate-into-the-breach.aspx?amp)
- [Into the Breach mobile interview (TouchArcade)](https://toucharcade.com/2022/08/08/into-the-breach-mobile-interview-subset-games-ftl-nintendo-switch-netflix-games-ipad-iphone/)
- [Tom Francis blog on Tactical Breach Wizards design](https://www.pentadact.com/?p=9042)
- [Tactical Breach Wizards (Wikipedia)](https://en.wikipedia.org/wiki/Tactical_Breach_Wizards)
- [Tactical Breach Wizards vs XCOM (PCGamesN)](https://www.pcgamesn.com/tactical-breach-wizards/xcom)
- [Mario + Rabbids Kingdom Battle: The Kotaku Review](https://kotaku.com/mario-rabbids-kingdom-battle-the-kotaku-review-1798496493)
- [Mario + Rabbids Kingdom Battle Review (God is a Geek)](https://godisageek.com/reviews/mario-rabbids-kingdom-battle-review/)
- [XCOM: Chimera Squad Interview (GameBanshee)](https://www.gamebanshee.com/38w4y)
- [XCOM: Chimera Squad review (Game Informer)](https://www.gameinformer.com/index.php/review/xcom-chimera-squad/xcom-chimera-squad-review-a-new-kind-of-goon-squad)
- [XCOM meets SWAT: Chimera Squad (PCWorld)](https://www.pcworld.com/article/399070/xcom-meets-swat-chimera-squads-radical-tweaks-make-for-a-refreshing-spinoff.html)
- [Invisible, Inc. (Wikipedia)](https://en.wikipedia.org/wiki/Invisible,_Inc.)
- [Invisible, Inc. review (PC Gamer)](https://www.pcgamer.com/uk/invisible-inc-review/)
- [Hard West 2 developers interview (NME)](https://www.nme.com/features/hard-west-2-developers-on-making-a-spooky-western-with-extra-spaghetti-3283532)
- [Hard West 2 review (Prima Games)](https://primagames.com/featured/hard-west-2-review-pc)
- [Phantom Doctrine infiltration tips (Gameranx)](https://gameranx.com/features/id/159152/article/phantom-doctrine-7-infiltration-tips-to-help-you-stealth-missions-how-sneaking-works/)
- [22 tips for surviving in Phantom Doctrine (Game Informer)](https://gameinformer.com/2018/08/18/for-your-eyes-only-22-tips-for-surviving-in-phantom-doctrine)
- [Phantom Doctrine review (bit-tech)](https://bit-tech.net/reviews/gaming/pc/phantom-doctrine-review/1/)
- [Phantom Doctrine review (PC Gamer)](https://pcgamer.com/phantom-doctrine-review)
- [Phantom Doctrine review (The Sixth Axis)](https://thesixthaxis.com/2018/08/14/phantom-doctrine-review)
- [The Hitman GO design postmortem (Game Developer)](https://gamedeveloper.com/design/video-the-i-hitman-go-i-design-postmortem)
- [Solving some major problems in turn-based tactical wargames (Keith Burgun)](https://keithburgun.net/solving-some-major-problems-in-turn-based-tactical-wargames)
