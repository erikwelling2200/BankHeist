# NPCs, hostages & police

Scope and method note: I did a broad web search pass at first, but the shared search budget for this run ran out early. After that I could only fetch pages directly. The strongest primary sources I read in full are three Game AI Pro chapters: Splinter Cell Blacklist's perception and awareness model (Ubisoft), Mark of the Ninja's interest and noise system (Klei), and Project Highrise's daily-routine NPCs (SomaSim). I also used The Sims Medieval schedule chapter, a SWAT 4 walkthrough/FAQ with the ROE rules, Payday 2 community and Game Informer material on civilians, zip ties, pagers and assault breaks, Ready or Not forum threads on compliance complaints, Wikipedia gameplay and reception for Payday 2, Hitman (2016), XCOM 2, Invisible Inc. and GTA wanted levels, the XCOM 2 concealment rules on UFOpaedia, and RimWorld's exact raid-point formula. The Payday fandom wiki was paywalled (HTTP 402), so a few Payday and GTA V details come from community posts or general genre knowledge. Those are marked 'genre knowledge' in the evidence fields.

Main finding for BankHeist: everything the brief wants (a bank that runs its day normally, individual spotting, a 'safe floor' overlay, noise circles, commands with a 2-turn duration, zip ties, heat) is only fun if the simulation is legible. The professional consensus is clear. Splinter Cell's lead AI programmer writes that 'it's only important what's plausible from the player's point of view'. Project Highrise removed hidden needs such as hunger and tiredness because hidden state made crowd behaviour unreadable. A player-perception study found players are bad at telling a smart AI from a simple one and bad at spotting randomness. Ready or Not's compliance system is the cautionary example: it is morale-based and hidden, and players call it unpredictable. Turn-based play makes this easier: each NPC can show its awareness level, its intent for next turn and its command timer. Nothing has to be guessed under real-time pressure. The bank should feel like a clockwork puzzle the player can read, plan around and then deliberately break.

Second finding: civilians should be a resource, not just a hazard. Payday 2 makes hostages tradeable and lets them delay police assaults. Players still ignore them because the benefit was applied to the wrong phase and was barely noticeable. SWAT 4's rule that a compliant person stays down is clearer than SWAT 3's, where they got back up. Killing civilians cuts the payout and hardens the police response, in Payday, Ready or Not and GTA alike. BankHeist should turn the brief's 'command / ziptie / release' trio into a visible economy. Every controlled hostage buys negotiation turns, a release lowers heat, a trade gets a captured crew member back, and a civilian death cuts the payout and pushes police towards an assault.

Third finding: escalation works best as discrete tiers you can see coming. Examples are GTA's stars, Invisible Inc.'s per-turn alarm track, Payday's assault/break rhythm, and RimWorld's points scaled by wealth taken plus a bounded adaptation factor. Heat should be a track with clearly shown thresholds and a 'next tier in N turns' readout. Police should act in phases (contain, negotiate, assault, regroup), not as an endless trickle. They should also counter the brief's immersive-sim exploits in plausible, announced ways: answering a sniper nest with their own snipers, gassing barricades, using a helicopter against a roof escape. They should never ignore those exploits or cheat around them.

## Lessons

### 1. Model awareness as a few discrete, visible states reached progressively, not one binary 'spotted' flag. Typical states: Unaware, Curious (investigate), Alarmed (knows a hostile is here), Engaged.

**Evidence:** Splinter Cell Blacklist (Walsh, Game AI Pro 2 ch.28) defines awareness as 'discrete mental states' reached over time. It shows a growing detection HUD element that 'defines his window of opportunity to break LOS or kill the NPC'. It adds an intermediate 'investigate' state partway along the bar. Mark of the Ninja guards likewise have 'multiple levels of alertness'.

**For BankHeist:** Give every NPC a suspicion meter of 3 pips shown above its head: 1 = glance, 2 = investigate/report, 3 = alarm or attack. Each enemy turn in which an NPC sees a player character adds pips equal to that character's Conspicuousness tier minus the observer's tolerance (see the archetypes), scaled down at long range. Pips decay by 1 per turn out of sight. Because it is turn-based, the player always sees the pip state before committing, which removes the 'unfair detection' feel.

### 2. Player perception beats simulation accuracy. Detection by NPCs the player cannot see feels unfair even when it is physically correct, so reduce or telegraph it.

**Evidence:** Walsh: 'it really doesn't matter what the NPC should see or hear; it's what the player thinks the NPC can see and hear… player perception should win.' Blacklist halved the hearing of off-screen NPCs who were far enough away, and 'the game instantly became more fun.'

**For BankHeist:** Before any noisy action is confirmed, preview its noise area and highlight every NPC inside it, including ones under fog of war (as an ear icon on the minimap or edge of screen). Only NPCs that are currently seen or highlighted in the preview can be alerted by that action. No surprise alarms from unrevealed rooms.

### 3. Sound should travel through open space (doors, corridors, broken walls), not as a straight-line radius through solid walls.

**Evidence:** Mark of the Ninja finds hearing by pathfinding over a 'sound mesh'. A guard inside the radius 'can't hear the sound because there is no path'. Blacklist computed sound distance through room-to-room choke points (TEAS) because straight-line distance meant hearing through walls.

**For BankHeist:** The brief's noise circle should be drawn as the circle clipped to the tiles sound actually reaches by flood fill: a closed door costs +3 tiles, a wall blocks it, a blown-open wall stops blocking. This makes 'explode a wall' and 'close the door first' real decisions. Suggested radii in tiles: walking 0, sprinting 3, melee takedown 2, shouting a command 6, suppressed pistol 4, unsuppressed pistol 10, rifle 14, shotgun 14, breaching charge 20, drill 8 per turn while running.

### 4. Vision shapes can have hard edges as long as they are consistent and visible. A plain cone over-reaches at long range.

**Evidence:** Blacklist replaced cones with 'coffin-shaped' shapes that widen and then narrow with distance. Walsh admits any shape has a threshold where '1 cm outside… the NPC will stand there forever', and argues consistency plus feedback is what matters.

**For BankHeist:** Use tile-based vision fans: wide near the observer, narrowing past about 6 tiles, ending at 10. The brief's 'safe floor' overlay for the selected character is exactly this. Tint tiles green (unnoticed), yellow (will gain pips) or red (instant threat for this loadout). It is recalculated per character, because Conspicuousness differs per character.

### 5. When several NPCs notice the same thing, split them into roles (one investigates, one directs, the rest watch) rather than having everyone converge.

**Evidence:** Mark of the Ninja: everyone running at every noise 'wasn't the kind of gameplay we were looking for'. A 'group leader' sends one or more 'investigators' and the rest become 'bystanders'. This lets players 'separate closely clustered guards and deal with them individually'. Welsh (Game AI Pro 2 ch.27) says limiting a cautious search to one NPC 'gives the player the option to peel targets away'.

**For BankHeist:** A cautious event (a noise, an open restricted door) sends exactly one guard to investigate. A partner stays and radios. Civilians who witness something odd send one 'reporter', usually toward the nearest staff member or guard, and that reporter is a visible, interceptable target. This creates the classic heist move of luring one guard into a back room.

### 6. NPCs should notice absence and changed state. That is cheap and reads as intelligent.

**Evidence:** Blacklist's changed-object events (opened doors, lights switched off) gave 'more bang for our buck than any other system'. Reviewers noticed. Their 'disappearing NPC' fix: if NPC A was in earshot of B for 10 s and B goes silent for 5 s, A investigates.

**For BankHeist:** Track bank 'evidence' objects: a restricted door left open, an empty teller window during opening hours, a camera that has stopped transmitting, a zip-tied person, blood, a body, a hole in a wall, an unattended drill. Pair guards with a 'buddy' and the control room with radio check-ins: a guard who is missing at his scheduled check-in for 2 turns triggers an investigation, not an instant alarm. Each evidence type has a visible 'discovered by' radius.

### 7. Limited, explicit forgiveness valves such as Payday's pagers create great tension, provided the limit is known.

**Evidence:** Payday 2: a killed guard's pager starts beeping and must be answered in a short window. Crews can answer 4 per heist by default, and any pager after the fourth always fails (community and wiki reports). Wikipedia lists 'kill no more than four guards with pagers' as a core stealth rule.

**For BankHeist:** Neutralising a guard starts a 'Radio silence' clock. The control room calls each guard every 4 turns. A crew member adjacent to the downed guard's radio can 'Answer check-in' (1 action) a limited number of times per heist (default 2, more with a Smooth Talker perk). Show the next check-in time on each guard's tag. This also makes the control-room operator a high-value early target, which matches the brief's 'sneak in and shut down the alarm'.

### 8. Make crowds run on authored daily scripts with probabilistic one-off events, not on hidden needs simulation. Detail per NPC should shrink as NPC count grows.

**Evidence:** Project Highrise (Zubek, Game AI Pro 3 ch.34) abandoned a planner for 'daily scripts' made of time blocks plus probabilistic 'oneshots' (e.g. coffee at 15:00 with probability 0.5). They also removed hunger and tiredness because 'internal state acted as hidden information'. Their conclusion: 'the utility of detailed NPC representation is inversely proportional to the number of NPCs'. The Sims Medieval schedules (Graham, GAIP ch.36) work the same way.

**For BankHeist:** Each archetype gets a schedule: blocks (Teller: window duty 09:00-12:00, lunch 12:00-12:30) and oneshots (Teller: 30% chance to carry a cash tray to the vault at 11:00). One turn equals about 1 in-game minute during stealth. Tapping any NPC shows its current activity and next scheduled action ('Manager → vault inspection in 6 turns'). Key bank-wide events give the procedural bank a pulse and opportunities: opening, armored-car delivery, vault time lock opening, shift change, lunch rotation, cleaner sweep.

### 9. A no-risk observation phase where the player learns routines is part of the fun in this genre.

**Evidence:** Payday 2 casing mode: unmasked players are ignored by civilians, and casing reveals 'guards, camera and vault placement, civilian spawns' (Game Informer). Hitman lets you eavesdrop to learn routines, and its public spaces 'teach these rules without penalties' (Wikipedia, Hitman 2016). MGSV lets you fast-forward time to watch patrol changes.

**For BankHeist:** Every heist opens with crew members entering as customers with no visible gear and Conspicuousness 0. They can scout, tag NPCs and cameras, and fill in a timeline strip that shows discovered bank events. The heist does not 'start' until the player masks up or a heavy character enters. The brief's mixed-team idea (one infiltrator first, heavies later) falls out of this naturally.

### 10. Social stealth needs readable norms: public zones, private zones, and special observers who see through cover. Those observers must be clearly marked.

**Evidence:** Hitman (2016): public spaces teach norms, private spaces hold restricted areas, and guards escort trespassers out before using force. 'Enforcers' see through disguises, but critics found Enforcer patterns 'hard to read'. Reviewers called the disguise system the series' 'most elegant implementation', ahead of Blood Money's suspicion meter.

**For BankHeist:** Three zone types: Public (lobby, ATMs), Staff (teller line, offices), Secure (vault, control room, cash room). A low-Conspicuousness crew member found in a Staff zone is first escorted out, with a 1-turn warning bubble. Only repeat offences or Secure zones escalate. Observers have a visible tolerance: civilians react only to Heavy gear; staff react to Medium gear in staff zones; guards react to Light gear; the Security Chief recognises crew faces already seen (shown with a distinct badge).

### 11. Compliance from yelling should be a clear, mostly deterministic contest. Opaque morale rolls frustrate players.

**Evidence:** SWAT 4: you must shout before firing on non-threats; a compliant person 'will NOT get back up' (a deliberate change from SWAT 3); a taser 'nearly always' breaks morale. Ready or Not uses hidden morale; forum players complain it is 'hard to predict', with suspects taking flashbangs and pepperballs without reacting.

**For BankHeist:** 'Command: Down!' is an area action whose radius comes from the weapon's Intimidation stat (as the brief proposes): unarmed 1 tile (adjacent only), pistol 3, SMG 4, shotgun or rifle 5, LMG 6, plus 1 for body armor. Ordinary civilians and staff in range always comply. They kneel with a visible 2-turn ring. Only specific archetypes can resist (guards, the off-duty cop, the 'hero'), and they show a visible resist chance before you commit. Flashbangs or a shot fired nearby make even those archetypes comply. The shout itself makes a 6-tile noise, so commanding is never free during stealth.

### 12. Separate temporary control from permanent control and make restraints a limited resource.

**Evidence:** Payday: each player starts with 2 cable ties (6 with a skill). A tied civilian cannot alert the police or move until police free them. Intimidated civilians stay down only while pressure continues (community reports: noise keeps them down). SWAT 4 requires everyone to be cuffed.

**For BankHeist:** Commanded = down for 2 turns; the ring visibly ticks and any re-command refreshes it. Zip-tied = permanent until freed by police or by another free NPC who spends 2 turns. Each character carries 3 zip ties by default (a backpack upgrade gives 6). Tying takes 1 action while adjacent. Moving tied hostages costs actions, which makes hostage placement (e.g. in front of windows to deter snipers) a real tactical decision.

### 13. Hostages must give a visible, meaningful benefit, or players will ignore or kill them.

**Evidence:** Payday 2: restraining civilians makes police 'delay their assaults' (Game Informer). Hostages can be traded for crew in custody (Stockholm Syndrome). But community posters say the break extension was 'useless in vanilla' because it was applied to the anticipation phase, not the break, and many players skip civilian hostages in favour of converts.

**For BankHeist:** Each controlled hostage adds +1 turn to the police Negotiation phase, capped at +6, and the HUD shows it ('Negotiation: 5 turns (+3 hostages)'). 'Release' (walk a hostage out the front door, 1 action) lowers heat by 1 and grants 2 turns of no assault. 'Trade' swaps one hostage for a captured crew member during negotiation. That gives the brief's 'release to reduce heat' a concrete exchange rate.

### 14. Killing has to cost something concrete and lasting, scaled by who witnessed it.

**Evidence:** Payday 2: killing a civilian brings 'intensified police response and the attendant cleaner cost' (a payout deduction). Ready or Not scores −1000 per suspect killed and −2000 per civilian. GTA adds stars for killing officers. SWAT 4 penalises 'unauthorized use of deadly force'.

**For BankHeist:** A civilian death costs a flat payout cut (e.g. 10% of the take). If police or a camera witness it: +1 heat, Negotiation ends immediately, and police switch from 'contain' to 'assault' posture. Killing police witnessed by police: +2 heat. A 'Clean job' bonus (no deaths) of +25% payout and better crew reputation gives non-lethal players a reason to stay non-lethal.

### 15. Escalation should come in discrete, telegraphed tiers that can be predicted, not a hidden continuous variable.

**Evidence:** GTA wanted levels: 1 star = a few patrol cars, top stars = military, tanks, helicopters (Wikipedia). Invisible Inc.: 'an alarm level is raised' after every enemy turn, adding new security at each level. Players plan around that track, and the game was an IGF Excellence in Design finalist.

**For BankHeist:** Heat 0-5, shown as a segmented track with 'next tier in N turns'. After the alarm, heat gains 1 segment per turn (5 segments per tier) plus event spikes (kills, a hostage escaping, police witnessing violence). Tier contents: 0 none; 1 two patrol cars, 4 officers, arrive in 6 turns; 2 more patrols plus a negotiator phone call; 3 SWAT breach team (shields, flashbangs) plus perimeter; 4 sniper teams on nearby rooftops plus helicopter; 5 heavy armored SWAT, gas, and roads blocked for the getaway.

### 16. Scale police strength by what the player is doing (wealth taken, crew size) with a bounded adaptation factor, not open-ended rubber-banding.

**Evidence:** RimWorld raid points = (Wealth Points + Pawn Points) × Difficulty × Starting Factor × Adaption Factor, capped at 10,000. Adaptation lowers after colonist deaths and runs roughly 0.4-1.47 (default range on 'Losing is Fun' 0.75-1.19).

**For BankHeist:** Reinforcement size = base by heat tier × (1 + 0.1 per loot bag secured) × crew-count factor, clamped to ±20% adaptation that softens after a crew member goes down. More greed visibly brings more pressure, which creates a natural 'grab one more bag?' push-your-luck decision.

### 17. Police pressure works best as a rhythm of assaults and breaks, not a constant trickle.

**Evidence:** Payday 2 cycles through control (break), anticipation, assault (build/sustain) and fade phases on timers. Community posts explain how hostages and kills interact with each phase and complain when breaks become 'so short… they may as well not exist' at high difficulty.

**For BankHeist:** After police arrive they cycle Contain/Negotiate (no breach; the drill runs, hostages get re-tied) → Assault (N turns of breaching from 2+ entry points) → Regroup (2-3 turns, wounded pulled back). Each phase is announced with its length, so players can schedule loud actions (drilling, blowing a wall) into breaks.

### 18. AI must answer player exploits (unreachable perches, sniper nests, barricades) plausibly and audibly. It should not ignore them, and it should not cheat.

**Evidence:** Blacklist's 'unreachable above' group behaviour has NPCs call for a frag, cover the thrower, and fall back if that fails ('Forget it! Fall back!'). The lines are 'a discussion' that tells the player what the AI is doing.

**For BankHeist:** Each brief exploit gets a scripted counter with barks. Sniper nest in a nearby building: police clear the line of fire, then a sniper team targets that building at heat 4. Barricaded windows: gas or a breaching charge after 2 turns of telegraphing. Vehicle through the front door: police set a roadblock on the getaway route. Booby traps: SWAT 'clears' the next room slower after one triggers. Every counter is announced at least a turn before it lands.

### 19. Searches should follow a readable pattern: briefly 'know' the target's last position, check it, then sweep or give up depending on how hostile the stimulus was.

**Evidence:** Welsh (GAIP2 ch.27): let the NPC 'know' the target's position for 2-3 s after losing sight (Halo, Crysis, Crackdown). Cautious searches (from distractions) end after checking the stimulus. Aggressive searches (gunfire) sweep all locations. Both are announced with barks and animation.

**For BankHeist:** In turns: a guard who loses sight of a known threat tracks it for 1 more turn, then moves to the last known tile. A distraction (thrown coin, phone ringing) causes a 1-guard cautious check that ends after 2 turns. Gunfire causes an aggressive multi-guard sweep that never resets to Unaware, only to 'Alert patrol'. This gives a clean reason to use distractions in place of violence.

### 20. Players are bad at inferring AI strategy and can't detect randomness, so show intent outright and keep dice visible and rare.

**Evidence:** Wetzel & Anderson (GAIP3 ch.4): 'players are bad at determining AI's strategies and detecting randomness and cheating'. Complex AI 'seemed no more difficult, realistic, or fun' than simpler ones.

**For BankHeist:** Every non-commanded NPC shows an intent icon for its next turn: run to an exit, run to the alarm button, draw a weapon, hide, call on phone. That gives the player one turn to answer, Into-the-Breach style (genre knowledge). Random rolls (resist chance, hidden-weapon chance) are shown as percentages on hover/tap, and a secretly armed NPC has a visible tell (bulge, nervous animation) once a crew member is within 3 tiles.

### 21. Tiered barks: specific lines the first few times something happens, generic ones later. This teaches the rules without HUD clutter or repetition.

**Evidence:** Blacklist used 3 bark tiers ('I think I heard footsteps' → 'I think I heard someone over there' → 'I think someone's over there') so players learn what triggered a reaction and never hear the same memorable line twice.

**For BankHeist:** Speech bubbles in the HTML HUD: on first occurrence, name the cause ('Was that door to the vault corridor open before?'); afterwards use short generic bubbles ('Huh?'). This teaches the evidence system on a small screen without tutorial pop-ups.

### 22. Concealment works better per character than squad-wide, and soft time pressure (heat) beats hard turn timers.

**Evidence:** XCOM 2: concealment breaks squad-wide when one soldier is revealed. Only a Phantom Ranger stays hidden (UFOpaedia). Enemy pods show a reveal radius 'roughly the movement range'. Timed missions were praised for tension but called 'merciless' (Destructoid).

**For BankHeist:** Matches the brief: each crew member has their own 'Spotted' state. Being spotted doesn't reveal the rest unless they are seen together or named over the radio. Avoid hard turn limits. Pressure comes from bank schedule events (the armored car leaves at 11:30, a teller cash count at noon) and from the heat track after the alarm.

### 23. The alarm is a chain with intermediaries, not an instant global flag. Each link is a person or device the player can break.

**Evidence:** Payday 2 alarms come from cameras (via the operator), guards (via pagers) and civilian witnesses calling police (Wikipedia). Watch Dogs drivers 'summon the police' after a theft unless reputation makes them back down. In Mark of the Ninja and Blacklist, witnesses report to others with barks.

**For BankHeist:** Alarm sources, each with a visible step and a 1-2 turn window: a camera sees → the operator needs 1 turn to confirm → presses the alarm. A teller reaches for the silent alarm (intent icon) → presses it next turn. A civilian flees → becomes an escapee once off-map (2-3 tiles past the door). A phone call takes 2 turns. The drill on a level-3 vault triggers a seismic sensor. Cutting phone lines, looping cameras, or killing the panel power each sever one link.

### 24. Panic spreads by sight and sound, and frightened people pick different reactions. That turns crowds into an obstacle and a resource.

**Evidence:** Hitman (2016) levels hold about 300 NPCs with their own routines and reactions. Critics praised the 'playground' feel but some said the AI 'did not react enough to the player'. Payday civilians drop to the ground at gunfire (community reports). Ready or Not civilians flee, hide or get used as shields.

**For BankHeist:** Panic is a status that spreads: an NPC who sees violence or hears a gunshot noise area becomes Panicked, and Panicked NPCs spread it to others within 3 tiles in their line of sight next turn. Each Panicked NPC picks a reaction weighted by archetype: Cower (stays put, easy to command), Flee to nearest exit, Run to alarm or phone (staff only), Hide (under a desk; becomes a surprise later), or Fight (armed archetypes). Shooting into the ceiling commands a big area but sets off panic in everyone outside your command radius.

## Pitfalls

- Opaque morale rolls for compliance: Ready or Not players call surrender behaviour unpredictable and ROE penalties inconsistent. Never let a commanded civilian ignore you without a shown chance.
- Hidden internal NPC state (needs, moods) across dozens of NPCs makes crowd behaviour unreadable. Project Highrise removed it for that reason.
- Being detected by NPCs the player cannot see. Blacklist's creative director kept complaining until off-screen hearing was halved.
- Everyone converging on every noise: it removes the 'peel one guard away' play and turns stealth into a brawl (Mark of the Ninja).
- Hostage benefits that exist in the code but cannot be felt (Payday's break extension applied to the wrong phase), so players ignore hostages or kill them.
- Enforcer-style special observers who aren't visually distinct; Hitman critics found them hard to read.
- Squad-wide reveal (XCOM 2) contradicts the brief's individual spotting and punishes the mixed-team plan.
- Hard turn timers that feel 'merciless'. Use schedule events and heat as soft pressure instead.
- Repetitive specific barks that break immersion. Use bark tiers.
- Wave pacing with no real breaks (Payday high difficulties) wears players down and removes moments for planning, which are the point of a tactics game.
- Ignoring or 'cheating' answers to exploits (e.g. police seeing through walls to find a sniper nest), or having no answer at all (the free sniper perch). Both kill the immersive-sim promise.
- Pure Euclidean noise circles through walls make closing a door or choosing a quiet route meaningless, and players will spot the inconsistency.
- Monotonic heat with no way back except finishing. The brief's 'release to reduce heat' and break phases need to give real relief or players will just rush.
- Moral whiplash: rewarding mass violence with no lasting cost makes stealth and hostage play pointless. Make the costs concrete (payout cuts, police posture), not just a lower score.

## Ideas

- NPC archetype - Customer: schedule = queue → teller window → leave (8-15 turns) or ATM. Notices only Heavy gear. Panic reactions: 50% cower, 35% flee, 15% hide. Each customer arriving during the heist is a new variable unless the front door is locked or barricaded (which itself becomes evidence for people outside).
- NPC archetype - Teller: works a window, cash-tray run to the vault at a scheduled time. Has a silent-alarm button under the counter. If not commanded, their intent icon on the next turn is 'reach for alarm' (70%). Commanded or tied tellers can be forced to open their cash drawer (small loot).
- NPC archetype - Bank Manager: office plus a scheduled vault inspection. Holds half of the dual-control vault code or keycard. Can be coerced while commanded (takes 2 actions and keeps him in sight), which offers a quiet alternative to drilling. Has a phone, so a 2-turn 'call police' intent if left alone.
- NPC archetype - Lobby Guard: armed (pistol), radio check-in every 4 turns, buddy-linked to a second guard. Reacts to Light gear. If commanded he has a shown resist chance (e.g. 40% with a pistol pointed at him, 10% with 2+ crew covering him or after a flashbang). Escorts trespassers out first.
- NPC archetype - Security Control Room Operator: sits in the Secure zone watching camera feeds (each camera = a vision fan he 'owns'). Confirms suspicious feeds in 1 turn, then triggers the main alarm. Runs the radio check-ins. Disabling or zip-tying him, or looping cameras with a hacker gadget, is the infiltrator's key objective.
- NPC archetype - Security Chief / Enforcer: roams with a memory of crew faces seen (any crew member he has seen once now counts 1 tier more conspicuous to him). Shown with a distinct badge, Hitman-style but readable.
- NPC archetype - Cleaner/Janitor: follows a sweep route through Staff areas with keys to back doors. Staff ignore him. Taking his uniform drops a crew member's Conspicuousness in Staff zones, a disguise path that suits low-gear infiltrators.
- NPC archetype - Off-duty Cop customer: looks like a customer but carries a concealed pistol. Shows a tell (badge glint, holster outline) within 3 tiles. Resists commands unless outnumbered. The brief's 'small chance an NPC is armed' made legible and scoutable during casing.
- NPC archetype - 'Hero' civilian: rare, tagged after a casing look. Will try to tackle an adjacent crew member who turns their back, or run for the door while others cower. Adds drama without random unfairness.
- NPC archetype - Armored Car Crew (scheduled event): 2-3 armed couriers arrive at a set time, the vault/cash room opens for N turns, and they leave with cargo. A big opportunity window (vault open, no drilling) and also a big risk (more guns in the building).
- NPC archetype - IT Contractor / Maintenance tech: brief visit to the server or alarm panel at a scheduled time. A crew member could impersonate one or ambush them for an access card.
- Police archetypes by heat tier: Patrol officers (2 per car, pistol/shotgun, set up a perimeter and cover doors, don't breach) → Negotiator (phone call into the bank; demands = hostage releases for turns) → SWAT breach team (shield, flashbang, breaching charges, enter from 2 points) → Sniper team (takes rooftops facing windows; hostages placed in windows stop them firing) → Helicopter (spotlight reveals the roof and courtyard, blocks roof escape, tracks the getaway) → Heavy armored SWAT and gas at heat 5.
- Pre-alarm police: a passing patrol car on a scheduled route outside the bank that can witness through windows or the front doors. Barricading and closing blinds become stealth tools, not just loud-phase tools.
- Visual vocabulary for NPC state on a 16px sprite: suspicion pips above the head (white/yellow/red), intent icon for next turn (door arrow, bell, phone, gun), command ring timer around the feet (2 segments), zip-tie icon, panic sweat drops. All from the HTML HUD layer or tiny overlays, so they stay crisp on mobile.
- 'Escort out' soft failure for trespassing: a staff member walks a low-gear crew member back to the lobby over 2 turns instead of raising the alarm. Mistakes cost time, not the whole heist.
- Radio check-in answering as a limited, skill-gated action ('Answer check-in', 2 per heist by default), Payday's pager mechanic adapted to turns.
- Hostage economy readout on the HUD during the loud phase: 'Hostages 4 → Negotiation +4 turns | Release: −1 heat, +2 turns quiet | Trade: 1 crew back'.
- Shooting into the ceiling as an intimidation action: big command radius (weapon's radius + 3), but a gunshot-level noise area that sets off panic and alerts the control room. A deliberate trade-off between controlling the crowd and keeping quiet.
- Evidence system with 'discovered by' radii: open restricted door, empty teller window, missing guard at check-in, body, blood, hole in a wall, disabled camera, unattended drill. Each produces a specific first-time bark, then generic ones.
- Distractions that drive cautious searches: ring a desk phone, set off a car alarm outside, spill coffee. One guard investigates for 2 turns and then returns, so a guard can be pulled into a dark back room.
- A casing timeline strip at the top of the HUD that fills in as the player observes: 09:00 doors open, 10:30 armored car, 12:00 lunch rotation (2 tellers away), 14:00 manager vault inspection. Learning the bank's pulse is the reward of casing.
- Payout modifiers that tie consequences to rewards: Clean job (no deaths) +25%, each civilian death −10%, hostages released alive +heat relief, escapee witness count affects next-heist notoriety (a campaign-level heat).
- Blacklist-style exploit counters announced a turn ahead in barks: 'Shooter in the office building across the street! Get Sierra team on it!' The sniper nest still works, but now has a known clock.

## Open questions

- Time scale: how many in-game minutes is one turn in stealth versus loud? Schedule events (armored car, lunch) need a fixed mapping, and loud-phase turns may need to be 'shorter' so police don't arrive too fast relative to drilling.
- Does the stealth phase use strict alternating turns for the whole bank (dozens of NPCs moving each enemy turn), or a lighter 'ambient tick'? Readability on a 320x180 screen with 20+ NPCs is a real UI risk.
- Should the 2-turn command duration scale with anything (weapon size, number of crew in view, previous commands), or stay flat for clarity? A flat rule is easier to read; a scaled one gives the brief's big guns more value.
- How should a 'civilian escape' be defined spatially: leaving the map edge, reaching the street, or reaching any exterior door? This decides how much barricading and door control matter.
- Is there campaign-level persistence (notoriety across heists, crew injuries, money), and should a high-casualty heist make later banks more guarded (more guards, armed customers)?
- How much randomness in NPC reactions is acceptable? This research argues for low, visible randomness (shown percentages, tells), but some unpredictability makes repeat runs fresh.
- Should police negotiation be an active minigame (demands and concessions) or a passive timer that hostages extend? An active version adds depth but also UI weight on mobile.
- Does the player see all NPC intents globally, or only for NPCs a crew member can currently see? This trades the fog-of-war tension of the immersive sim against tactical readability.
- How do conspicuousness tiers map to gear exactly (e.g. pistol concealed = 0, SMG = 1, rifle = 2, LMG or armor = 3), and can gear be carried in a duffel bag (Payday-style) to switch from 'customer' to 'loud' mid-heist?
- Moral framing: how dark should civilian killing be allowed to look? Ready or Not drew criticism for its tone, and a clear 'professional robbers' tone might suit the hostage/release economy better.

## Sources

- [Modeling Perception and Awareness in Tom Clancy's Splinter Cell Blacklist (Martin Walsh, Game AI Pro 2 ch.28)](http://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter28_Modeling_Perception_and_Awareness_in_Tom_Clancy's_Splinter_Cell_Blacklist.pdf)
- [GDC Vault: Modeling AI Perception and Awareness in Splinter Cell: Blacklist (GDC 2014)](https://www.gdcvault.com/play/1020195/Modeling-AI-Perception-and-Awareness)
- [How to Catch a Ninja: NPC Awareness in a 2D Stealth Platformer (Brook Miles, Game AI Pro ch.32)](http://www.gameaipro.com/GameAIPro/GameAIPro_Chapter32_How_to_Catch_a_Ninja_NPC_Awareness_in_a_2D_Stealth_Platformer.pdf)
- [1000 NPCs at 60 FPS - Project Highrise daily scripts (Robert Zubek, Game AI Pro 3 ch.34)](http://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter34_1000_NPCs_at_60_FPS.pdf)
- [Breathing Life into Your Background Characters - Sims Medieval schedules (David Graham, Game AI Pro ch.36)](http://www.gameaipro.com/GameAIPro/GameAIPro_Chapter36_Breathing_Life_into_Your_Background_Characters.pdf)
- [Looking for Trouble: Making NPCs Search Realistically (Rich Welsh, Game AI Pro 2 ch.27)](http://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter27_Looking_for_Trouble_Making_NPCs_Search_Realistically.pdf)
- [What You See Is Not What You Get: Player Perception of AI Opponents (Wetzel & Anderson, Game AI Pro 3 ch.4)](http://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter04_Player_Perception_of_AI_Opponents.pdf)
- [Game AI Pro chapter index](http://www.gameaipro.com/)
- [SWAT 4 FAQ / walkthrough (compliance, ROE, taser morale, restraints)](https://www.cheathappens.com/../text/swat4faq.zip.txt)
- [SWAT 4 - Wikipedia](https://en.wikipedia.org/wiki/SWAT_4)
- [Ready or Not - Wikipedia](https://en.wikipedia.org/wiki/Ready_or_Not_(video_game))
- [Ready or Not Steam discussion on compliance and ROE](https://steamcommunity.com/app/1144200/discussions/0/4036978698791870878)
- [Ready or Not: Thank You, Come Again S Rank Guide (scoring penalties)](https://www.ofzenandcomputing.com/ready-or-not-thank-you-come-again-s-rank-guide/)
- [Payday 2 - Wikipedia](https://en.wikipedia.org/wiki/Payday_2)
- [Game Informer - Payday 2 strategy guide (civilians, cable ties, cleaner cost)](https://gameinformer.com/b/features/archive/2013/08/13/payday-2-strategy-guide)
- [Payday 2 Steam discussion - hostages, converts, assault break extension](https://steamcommunity.com/app/218620/discussions/8/3805029641863895988)
- [Payday 2 Steam discussion - pagers](https://steamcommunity.com/app/218620/discussions/8/1698294337780392688)
- [Payday Wiki - Hostage Taker](https://payday.fandom.com/wiki/Hostage_Taker)
- [Payday 2 assault break mod notes (hostages extend anticipation)](https://modworkshop.net/mod/35011)
- [Hitman (2016) - Wikipedia](https://en.wikipedia.org/wiki/Hitman_(2016_video_game))
- [XCOM 2 - Wikipedia](https://en.wikipedia.org/wiki/XCOM_2)
- [UFOpaedia - Concealment (XCOM 2)](https://www.ufopaedia.org/index.php/Concealment_(XCOM2))
- [Invisible, Inc. - Wikipedia](https://en.wikipedia.org/wiki/Invisible,_Inc.)
- [Wanted level - Wikipedia](https://en.wikipedia.org/wiki/Wanted_level)
- [Watch Dogs - Wikipedia](https://en.wikipedia.org/wiki/Watch_Dogs_(video_game))
- [RimWorld Wiki - Raid points](https://rimworldwiki.com/wiki/Raid_points)
- [Metal Gear Solid V: The Phantom Pain - Wikipedia](https://en.wikipedia.org/wiki/Metal_Gear_Solid_V:_The_Phantom_Pain)
- [Door Kickers 2 - Steam store page](https://store.steampowered.com/app/1239080/Door_Kickers_2_Task_Force_North/)
