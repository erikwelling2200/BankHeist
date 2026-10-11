# Stealth tactics & telegraphing

Across this domain, games keep relearning one rule: stealth is only fun when the player can read the system well enough to plan, and then makes a mistake they can see coming. The strongest evidence comes from Klei, the studio behind both Mark of the Ninja and Invisible, Inc. Mark of the Ninja's design rules come down to this. Show sight and sound on screen. Never let a guard change behaviour without a signal. Don't make the player fight the controls. Keep the cost of failure small, and keep each encounter space to about one screen. Invisible, Inc. moved the same ideas to a turn-based grid. It replaced hit chances with "dependable options you can plan around", made guard intentions readable, and added a 6-level alarm. Each level is split into 5 sub-ticks, and the alarm goes up every turn and whenever a guard is killed or a body is found. Klei's own write-up says the first version (20–30 levels with random consequences) was unreadable. Even the final version stayed controversial, and players called it stressful and "a doom clock" that worked against exploring. Into the Breach and Tactical Breach Wizards push readability as far as it goes: every enemy intent is shown before it happens, actions are deterministic or can be rewound, and "every death felt like your own fault". Shadow Tactics and Desperados III add two things. One is a vision cone split into zones, with crisp edges and patterns instead of gradients. The other is a visible delay before detection (a yellow fill creeping towards the character) that the player can still react to.

What this means for BankHeist: the brief's best ideas are a floor overlay showing where a character can go without raising alarms, sound circles, characters spotted one at a time, and a real alarm as a separate event from local alerts. These are exactly the tools the genre settled on. They only work if the simulation is predictable enough that the overlay tells the truth. In a turn-based game, the safe-tile overlay has to account for what the NPCs will do in their next turn, not just where they stand now. Players say XCOM 2's red concealment tiles are "not 100% reliable" for exactly this reason. So NPCs, civilians included, should commit to their next move and facing and show it, the way Into the Breach does. Randomness that happens out of sight, like a civilian who turns out to be armed, is the biggest threat to that honesty. It needs a warning and a counter-play.

On failure, the genre's lesson is to build a ladder rather than a cliff. Phantom Doctrine was criticised for exactly this. Its stealth was binary and dull: "nobody ever comes to investigate anything… none of the tension of a near-miss". Hitman, Payday 2 and Invisible, Inc. instead build in recoverable steps: trespassers get escorted out before anyone is attacked, Payday 2 caps answered guard pagers at four, and an agent caught in a guard's sight has one action to escape or to have a teammate drop the guard. BankHeist's split between a local alert and the real police alarm is a natural home for this. A spotted character should start a short, visible, interruptible chain (witness → raise the alarm in person → alarm) rather than ending stealth instantly. Moving from stealth to loud should feel like an ambush the player has earned, not a failure state. That is what makes the mixed-team fantasy in the brief pay off.

Time pressure is the hardest open problem. Invisible, Inc. and XCOM 2 show that a global per-turn clock creates tension but punishes exploring. XCOM 2's timers caused enough frustration that "True Concealment" mods, which hold the timer until concealment breaks, became popular. The brief's rule that heat rises the longer a heist goes on should therefore apply mainly after the alarm. Before it, pressure should come from the bank's own schedule (patrol rounds, customer flow, shift changes, closing time). Heat should come in a few large, predictable steps (Invisible, Inc.'s 5-ticks-per-level structure), each showing what it will bring and when.

## Lessons

### 1. Never change an NPC's behaviour without a visible signal, and always show the cause. Every state change gets an icon, and the cause gets drawn (a line from the NPC to the noise source or to the character it saw).

**Evidence:** Nels Anderson's second Mark of the Ninja rule is 'Transparent AI'. Guards have three awareness levels with distinct signals (none, yellow '?', red '!'), and 'if a guard's behavior ever changes, the player will immediately understand what set it off'. A searching guard walks to a 'ghost' of where you were last seen. Invisible, Inc.'s Lantz called 'making sure the guards' intentions were transparent and readable' a key priority carried over from Mark of the Ninja.

**For BankHeist:** Give every NPC (guard, teller, civilian, control-room operator) a small 5-7px state badge: Calm (none), Curious '?', Investigating '?' plus a target marker, Alerted '!', Panicking, Fleeing, Going-for-alarm (bell plus turn count), Hostile (crosshair). When a badge changes during the player's turn, draw a one-frame tether from the NPC to the cause (the sound ring's origin, or the character it saw). Put a ghost of the character on the NPC's last-known tile, as Mark of the Ninja does, so the player knows where the NPC thinks they are.

### 2. Telegraph what every NPC will do next, Into the Breach style. The 'safe floor' overlay is only honest if NPC movement is known before the player commits.

**Evidence:** Subset Games used telegraphed enemy attacks 'as a core mechanic' so that the game 'starts to feel like a puzzle' and 'every death felt like your own fault'. XCOM 2 shows red tiles where concealment would break, but players report the indicator is 'not 100% reliable' because patrols move. Tom Francis designed Tactical Breach Wizards so 'all of the surprise will happen on their turn' and the player's own actions are fully predictable.

**For BankHeist:** At the end of each NPC phase, every NPC commits to its next move: a short path arrow plus facing for guards and patrols, a destination pin for civilians and staff (to the counter, the toilet, the exit), and an intent icon for alerted NPCs ('run to alarm, 2 turns'). Compute the overlay over two horizons: (a) tiles seen right now, and (b) tiles that will be seen during the coming NPC phase along the telegraphed paths. Draw (b) with a hatched pattern. Show unknown areas (unscouted rooms, NPCs not seen) as a neutral 'no data' tint, never as safe.

### 3. Make the safe-movement overlay depend on the path and on the character's profile, and mark exactly where along a path the first detection would happen.

**Evidence:** In XCOM 2, stepping onto a detection tile breaks concealment, so does starting a turn inside one and moving, and so does dashing through doors or windows. The path preview shows a red 'eye' icon on moves that will reveal you. Long War 2 gave SMG-carrying soldiers a smaller enemy detection radius, so equipment changed the overlay. Hitman's disguises change which NPCs count as 'enforcers' and which areas are hostile.

**For BankHeist:** When a character is selected, tint every reachable tile in one of three colours: Safe, Will raise suspicion (shows the pip cost), Will be spotted. Compute this for that character's current profile, not one value for the whole squad. Check detection at every tile along the drawn path, not just the destination. Put an eye icon on the first tile where the path becomes unsafe, so the player can stop one tile short. Changing loadout (holstering, ditching the armour vest, swapping the long gun into a duffel bag) should update the overlay immediately, so conspicuousness is something the player can see and play with.

### 4. Split vision cones into a few zones with crisp, tile-aligned edges. Use patterns as well as colour, and don't draw every cone at once.

**Evidence:** Shadow Tactics' detection deep dive describes four kinds of space: no cone, dark green (stay crouched), bright green (off limits), dotted (hiding spots). Cones have sharp edges with 'no gradients' to allow precise play. A pattern was added because on high ground 'it becomes hard to see which color it actually is'. Only one cone is shown at a time to avoid clutter. Desperados III used dashed and solid zones, and Mimimi later said Desperados III 'started to become too noisy'. Invisible, Inc. used a light-red 'noticed' peripheral zone and a dark-red 'seen' zone.

**For BankHeist:** Each NPC's sight has two zones: Core (about 6 tiles, 90°) and Peripheral (about 8 tiles, 140°). The numbers are starting points for playtesting. What each zone does depends on the character's profile (see the conspicuousness lesson). Day to day, the player sees the combined safe-floor overlay for the selected character, not raw cones. Pressing and holding an NPC shows that NPC's cones on their own (solid for Core, dotted for Peripheral). At 16px tiles and 320x180, draw cones as tile tints, never as smooth polygons, and every state needs a pattern so it reads for colourblind players and on small phone screens.

### 5. Detection should build up in visible, discrete steps the player can react to, not happen in an instant.

**Evidence:** In Shadow Tactics, a yellow fill moves from the guard's eyes towards the character, and detection happens when it arrives. Mimimi chose this over Desperados' cones that turned yellow without moving, because it gave 'cleaner feedback on when detection will happen'. They tried freeze modes and fake rewinds and cut them; slow motion survived. In Hard West, idling in a cone too long made enemies suspicious, and a character's Heat changed detection. Indie turn-based stealth prototypes converge on a per-guard suspicion counter that goes up while the guard can see you and decays when it can't.

**For BankHeist:** Use suspicion pips per NPC per character (0-3). Ending a move step, or performing an action, inside an NPC's zone adds pips according to profile and zone. 3 pips means that NPC has Spotted that character. Out of sight, pips decay by 1 per NPC phase. Pips stay visible as a small meter over the NPC's head, colour-coded to the character who caused them. The move preview says '+2 (teller)', so the player always knows a move is 'one turn from being made'. Some situations skip straight to spotted: an illegal act in Core view, any profile-3 character in Core view, being in a secure area in Core view of a guard.

### 6. Model conspicuousness as a few readable profile tiers that combine with area access rules (public, staff, secure), the way Hitman's trespass/hostile split and Payday's casing mode work.

**Evidence:** Hitman 2016 and later: trespassers caught by guards are first escorted out. A guard tries to arrest before shooting, and only resisting escalates. Hostile areas, and 'enforcers' who see through a disguise, give no such grace, and a partial ring shows attention building. In Payday 3's casing mode, unmasked players can walk public areas freely, but 'illegal interactions' are detected if staff, guards or cameras see them. Payday 2's detection risk is calculated from equipment concealment values.

**For BankHeist:** Define 4 profiles that are calculated from loadout and shown as an icon on the character's portrait. 0 Clean (unarmed or a concealed pocket pistol, no visible armour). 1 Odd (holstered SMG, duffel bag, light vest under a coat). 2 Armed (visible long gun or shotgun). 3 Assault (heavy weapon and/or plate armour, helmet, mask). Combine them with three areas. Public: profile 0 is never noticed; 1 gains pips in Core only; 2 gains pips in Core and Peripheral; 3 is spotted instantly in Core. Staff-only: profile 0 in Core gets a 'trespass warning' (the guard walks over and tells you to leave). A second offence, or 1+, gains pips. Secure (vault, server room, counting room): anyone in a guard's or camera's Core is spotted. Staff uniforms or keycards found in the bank work like Hitman disguises and treat staff-only as public.

### 7. Spotting happens per character, and information should travel physically. The spotter has to get the word out, and that gap is the player's chance to recover.

**Evidence:** XCOM 2 is the counterexample. One soldier breaking concealment reveals the whole squad, except Rangers with Phantom and Reapers in Shadow, and those exceptions are exactly what made scouting interesting. In Invisible, Inc., an agent caught in a guard's direct sight is trapped: the player can spend an action to pull the agent out, or have a teammate disable the guard, before the guard shoots. Payday 2 lets crews answer a dead guard's pager, capped at four per heist, to stop the operator raising the alarm.

**For BankHeist:** When NPC X spots character A, only X knows A is hostile, and A gets a red 'Burned by X' tag. X then acts in the NPC phase according to their role. A guard confronts A or radios in: the radio call is a telegraphed 1-turn action with a sound ring, and only then do other guards learn about A. A teller heads for the silent alarm, with a visible turn count. A civilian flees or screams (scream = a sound ring that spreads 'Alerted, cause unknown'). Characters who haven't been burned stay unknown even mid-firefight, so a clean infiltrator can still walk around once things go loud unless someone links them to the crew (seen talking to, or standing next to, a burned character). Add a guard radio check-in: a downed guard's radio buzzes 2 NPC phases later. A character can answer it in person (1 action, max 2 per heist), otherwise the operator becomes suspicious.

### 8. Escalation should be a ladder with several interruptible rungs, and the real alarm should require someone to physically do something.

**Evidence:** Vice's review of Phantom Doctrine: once spotted, the whole map is alerted, and 'nobody ever comes to investigate anything, the facility never goes into lockdown… none of the tension of a near-miss'. Mimimi's Shadow Tactics retrospective lists as a future idea to 'extend the period before detection has consequences, such as before an alarm sounds, and use guard behavior to let players stop escalation'. Mark of the Ninja separates hearing (suspicious, investigate) from seeing (aware).

**For BankHeist:** Escalation ladder per NPC: Calm → Curious (heard something, glimpsed someone: turns towards it) → Investigating (walks to the last-known tile, searches nearby tiles for 2 NPC phases, then goes back to routine with 1 pip left over) → Alerted (knows there is danger: acts by role) → Alarm Raised (a global event). The alarm only goes off when an Alerted NPC finishes an alarm action. A teller presses the button under the counter (0-1 turns if already at the counter). A guard radios dispatch (1 turn). The control-room operator verifies a camera feed (1 turn, shown as '?' on the monitor) and then presses the alarm. A civilian reaches the street, or a phone, and calls. Every one of these is telegraphed with a countdown and can be stopped by commanding the NPC down, knocking them out, blocking their route, or cutting the phone line or alarm wiring beforehand.

### 9. Seeing and hearing register immediately, but NPCs react only in the NPC phase. This keeps turn-based play fair and makes coordinated takedowns natural.

**Evidence:** Shadow Tactics' Shadow Mode and Desperados III's Showdown Mode exist so a player can take out several guards in the same instant before any can raise the alarm. Reviewers call this 'crucial for team actions that need to be precisely timed'. Door Kickers uses planned 'go codes', and Frozen Synapse and Tactical Breach Wizards resolve orders simultaneously. In a game where each side takes its whole turn in turn, the player's whole turn is already simultaneous from the NPCs' point of view, unless NPCs get reactions.

**For BankHeist:** Make it an explicit rule: anything an NPC witnesses during the player's turn is recorded straight away (pips, burned tags, 'heard gunshot') and shown, but the NPC acts on it only in the NPC phase. The player can still silence a witness in the same turn. That makes 'two characters drop two guards in one turn' the core stealth move with no extra system. The only exception is an armed, already-Hostile NPC on overwatch, and that should be telegraphed as a visible reaction arc. Add a Ready/Hold action (Door Kickers' go-code idea) only for actions that must happen during the NPC phase, such as 'detonate when the guard steps on this tile'.

### 10. Show sound as a ring before the action is confirmed, and make the ring tell the truth: show exactly which NPCs will hear it.

**Evidence:** Mark of the Ninja: 'a spreading blue ring that says exactly how far that noise will reach'. If any part of the ring overlaps a guard, the guard investigates, and the ring is shown 'before you even make the noise' while aiming. Desperados III shows a blue noise circle around the character while aiming a gun (a revolver's radius is quoted at 18.0 versus 17.0 for a throwing knife). A Door Kickers 2 dev post: suppressors 'don't make guns magically silent' unless subsonic ammo is fitted. Data-mined radii are about 20m for an SMG and 4m for a suppressed .45.

**For BankHeist:** Every action has a noise radius in tiles, previewed as a ring of tinted tiles before committing, with an ear icon on each NPC that will hear it. Work out who hears it by flood fill, so walls and closed doors reduce the radius by a fixed amount (e.g. -3 per wall, -2 per closed door). The preview then matches what actually happens, rather than the brief's plain circle. Starting values: walk 0, run 2, lockpick or ziptie 1, shout 'stay down' 4/6/8 by weapon class (matching command radius), suppressed pistol 3, pistol 8, SMG 10, AR or shotgun 12, breaching charge 14, a drill running on a high-tier vault 5 per turn (a sound ring that keeps repeating). Hearing a soft noise makes an NPC Curious and walk to the source. Hearing a gunshot or explosion makes them Alerted with the cause unknown, so they go to cover or flee and raise the alarm. Nobody gets spotted from sound alone.

### 11. Keep the cost of failure small through recovery inside the mission (undo, rewind tokens, the escalation ladder) rather than full restarts. This matters even more on touch screens.

**Evidence:** Anderson's fourth rule is 'limited consequences for failure': a checkpoint between nearly every meaningful encounter, and fast reloads. Klei added rewind to Invisible, Inc. because 'many matches have been spoiled… because of its low tolerance for even small mistakes'. It started at one rewind per mission, later scaled by difficulty with an Ironman option, and Slant complained that limited rewinds 'penalize players far more for their creativity'. Tom Francis said Tactical Breach Wizards' free rewind removes 'the fear of failure and mistakes, and the risk that discourages people from trying interesting things'.

**For BankHeist:** Three layers of protection. (1) Every action is two taps: tap to preview, tap again to confirm. (2) Moves can be undone for free until new information appears (a new tile or NPC revealed, or a random roll). (3) Turn rewinds by difficulty: e.g. Casual unlimited, Normal 3 per heist, Hard 1, Ironman 0. Cone-of-fire rolls are already committed once seen, so a rewind restarts the turn but replays the same random seed. Rewinding can then fix bad planning, but you can't reroll your way to lucky shots. Procedural heists are long (likely 30-60 turns), so a full restart should be the last resort.

### 12. Before the alarm, time pressure should come from the bank's routine, not a doom clock. After the alarm, heat should rise in a few large steps, each showing what it brings and when.

**Evidence:** Klei's alarm deep dive: the first 20-30-level version was unreadable, and random consequences 'clashed with careful planning'. The fix was 6 levels × 5 sub-ticks with predictable effects (level 2 raises firewalls, level 3 adds a patrol). It was still 'one of the more controversial mechanics', and a commenter called it a 'doom clock' that conflicted with exploration. XCOM 2's fixed 8/12-turn timers were widely disliked, and mods that delay the timer until concealment breaks are popular. Vice criticised Phantom Doctrine for having no escalating pressure at all.

**For BankHeist:** Pre-alarm pressure comes from the world. Guards do rounds on a schedule, customers come and go, tellers move cash to the vault at set times, the armoured car arrives on turn N, the bank closes on turn M and locks down. Show these as a timeline strip the player can scout ahead of time. After the alarm, Heat runs from 1 to 5, and each level is a bar of 5 ticks. +1 tick per turn, +3 ticks per kill witnessed by police or caught on camera, -2 per hostage released in view of police. The HUD always shows the next step, with turns until it arrives and where ('Heat 3 in 2 turns: SWAT van arrives at the rear lot'). Before the alarm, add a tick only for discovered evidence (a body found, a camera seeing a weapon). Don't add one per turn.

### 13. A stealth phase needs active goals and NPCs who actively respond. Waiting at doorways is the failure mode.

**Evidence:** Vice on Phantom Doctrine: 'This stealth phase is kind of boring… Penetrating them basically amounts to hovering around windows and doorways'. PC Gamer found it 'painfully slow'. Invisible, Inc.'s loop is 'gathering information, observing the situation and executing your plans quickly and quietly', and 'so much of the game is built on spending your resources to gather information'. Tom Francis's AI rule for Gunpoint: 'you must be able to knowingly misdirect the AI'.

**For BankHeist:** Fill the stealth phase with things to do that each pay off in the loud phase: find the manager's keycard, read the vault timer, photograph the camera layout, cut the phone line, disable the control-room monitors, plant breaching charges, unlock the back door for the heavy team, switch off the silent-alarm wiring under the counters. Give the player levers to misdirect NPCs (a dropped wallet, a ringing desk phone, a jammed printer, a pulled fire alarm with a big sound ring and a crowd moving outside) that are telegraphed and reliably pull specific NPCs to known tiles.

### 14. Going loud should feel like an ambush the player set up and earned, not like stealth failing.

**Evidence:** In XCOM 2, attacking from concealment works as an ambush: overwatch from hidden soldiers has no aim penalty and can crit, because ambushed enemies are usually out of cover, and Shadowstrike and Kill Zone are built around it. This is one of XCOM 2's most praised opening patterns. Payday 2's identity rests on stealth failing over into a playable loud heist.

**For BankHeist:** Make the switch to loud a clean, chosen moment as well as an accident. Add a 'Go Loud' squad action that starts an Ambush turn: every unburned character gets a free Ready shot or command, NPCs who are Calm are caught out of cover, and a 'Get down!' shout reaches 1.5x its normal radius. Unburned infiltrators start the loud phase already in position. This rewards the brief's mixed-team plan (scout disables the alarm, heavies breach) far more than a simple 'detected' flag would.

### 15. Hidden random threats destroy trust in a perfect-information stealth system. Armed civilians need a warning sign and a counter.

**Evidence:** Into the Breach's goal was that every death 'felt like your own fault' and that 'it's very clear how or why you failed'. Invisible, Inc. replaced random combat features with 'dependable options that you could plan around'. Player reviews of Invisible, Inc. still list 'unfair RNG and harshly punished mistakes' as complaints. Door Kickers 2's disguised insurgents among hostages are known as a deliberate shock mechanic in a game about reacting fast, not a stealth game.

**For BankHeist:** The brief's 'small chance an NPC carries a weapon' should be rolled when the bank is generated, never at the moment the NPC acts, and it should be discoverable. Use visible tells on close inspection (an off-duty cop's badge, a bulge under a jacket, a security-company jacket) and checks that cost an action: frisking while zip-tying reveals and removes the weapon. An armed civilian must telegraph for one turn before shooting ('reaching for a weapon', shown as an intent icon) so the player can command, tackle or shoot first. Surprise, then, comes from the player's own oversight and never from a hidden roll.

### 16. Temporary control should cost something to make permanent. Knockouts and holds expire, and 'pinning' ties up a character or a resource.

**Evidence:** In Invisible, Inc., knocked-out guards wake after a number of turns set by difficulty and augments (2 or 4 turns are cited). Pinning keeps them down but ties up an agent, and a guard who wakes hunts for you more deliberately. Payday 2 limits how many civilians you can tie up and gives the crew a pager budget (4 per heist) rather than unlimited silencing.

**For BankHeist:** The brief's mechanics already fit this pattern. Keep 'commanded: down for 2 NPC phases' and show it as 2 pips draining over the NPC. Give zip-ties a limited supply (e.g. 4 per character, more with a perk or a larger bag) and a cost (1 action while adjacent, with a noise of 1). Let a character 'hold' a group to refresh their command each turn at the cost of that character's action, like Invisible, Inc.'s pinning. NPCs whose command runs out don't snap back to Calm: they come back Alerted with a remembered grudge (+1 chance to flee or run for the alarm), so letting a command lapse is a real choice.

### 17. Keep the space to a size players can hold in their heads. Encounter areas should be about one screen plus a little.

**Evidence:** Anderson's fifth rule, 'less-open world design': in 2D, players struggle to map space in their heads, and the ideal encounter area is about one screen plus 0.5-0.75 of a screen in each direction. Invisible, Inc. reviewers said random layouts sometimes created 'overlapping detection fields with no clean way through', or trivial levels.

**For BankHeist:** At about 20x11 visible tiles on a phone, the procedural bank should be made of rooms each roughly one screen in size (a lobby of about 20x12 tiles, a back office, the vault wing), joined by doors and corridors. The total floor should be about 40x30 tiles plus the street. The generator must check that every bank has at least one stealth route for a profile-0 character to the staff area, and at least two breach approaches. Unsolvable or overlapping detection fields are a known failure of procedural stealth. Include a one-tap zoom-out to a tactical overview, so the player never has to pan around to reconstruct where the guards are.

### 18. Collecting intel should be its own phase and a resource. Planning before execution is a genre strength that works well on touch.

**Evidence:** Lantz: 'so much of the game is built on spending your resources to gather information about what you're up against'. Phantom Doctrine opens with a free-roaming infiltration phase for scouting. Door Kickers' iPad port was built around touch: drag to place squad members and draw routes, a plan-then-execute pattern. Invisible, Inc. shipped on iPad with touch controls, and turn-based stealth is widely seen as suiting touch better than real time.

**For BankHeist:** Before the heist, the player gets a casing phase: a profile-0 character walks the public areas for free to scout NPC routines, cameras, staff doors and the alarm buttons the tellers can reach. Optionally they buy intel (blueprints show the layout, an inside man marks armed civilians). Anything scouted feeds the overlays, and anything not scouted stays 'no data'. Use drag-to-draw paths with a snap-to-grid preview as the main movement input on touch. It already works on desktop with click-drag, and it shows the path-sensitive detection check naturally.

### 19. Use clear, separate names for the separate pressure systems. How a mechanic is framed changes whether players think it is fair.

**Evidence:** Klei renamed 'ALARM' to 'SECURITY LEVEL' and added in-world fiction and tutorials to make the alarm feel less unfair. They admit 'some players were lost along the way' and wish they had framed it better. Players of Invisible, Inc. mainly perceived it as stress until it was understood.

**For BankHeist:** Use fixed terms throughout the UI and tutorial. Suspicion: per NPC, per character, pips. Alert: one NPC knows there is danger. Alarm: a single event, police are called. Heat: the response level, 1-5, after the alarm. Never use 'alarm' for a local alert. Show the alarm as a city-wide news or police-scanner moment, so the player understands everything before it was still recoverable.

### 20. Cameras and the control room are where the 'mainframe' layer lives: a separate observer with its own rules for seeing, verifying and responding.

**Evidence:** Invisible, Inc.'s mainframe and Incognita layer makes cameras, turrets and daemons hackable systems with their own resources. Gunpoint makes cameras wired to alarms something you can read and rewire ('if it sees you, the alarm will bring a guard running'). Phantom Doctrine marks restricted areas in red, and cameras there warn guards.

**For BankHeist:** Cameras have cones like NPCs but report to the control-room operator. A camera that sees a profile-2+ character or an illegal act puts a '?' on the operator, who spends 1 turn verifying and then raises the alarm. A camera that sees a body or a ziptied NPC sends a guard to investigate first. The player can loop or freeze the feed (a hacker action), cut power to a camera bank (a big sound ring and an investigating guard), take the operator hostage, or simply avoid the cones. Control-room camera cones appear in the safe-floor overlay like NPC cones, with a camera icon.

## Pitfalls

- A safe-floor overlay that lies. If it only reflects where NPCs stand now and ignores their telegraphed moves, players will be spotted on tiles marked safe (XCOM 2's red tiles were called 'not 100% reliable'). One such betrayal destroys trust in the whole system.
- Random hidden threats in a stealth game built on planning. An armed civilian who shoots without warning, or a randomised patrol change, makes failure feel arbitrary instead of earned (Into the Breach, and Invisible, Inc. removing hit chances).
- Binary stealth. One sighting alerting the whole map and ending stealth (Phantom Doctrine) removes near-miss tension and makes players reload instead of adapting.
- A global doom clock during the stealth phase. Per-turn alarm ticks (Invisible, Inc.) or fixed turn timers (XCOM 2) punish exploring and planning, which are exactly what the stealth phase is for. Players will call it unfair, as they did with both games.
- Many small, unreadable escalation steps with random consequences. Klei's first alarm had 20-30 levels and was abandoned because players couldn't predict when danger would arrive.
- Too much on screen at 320x180. Drawing every cone, every sound ring and every intent at once makes the screen unreadable (Mimimi: Desperados III 'started to become too noisy'). Cones need sharp edges and patterns, not gradients.
- Stealth phases with nothing to do: waiting at doorways for guards to wander off (Phantom Doctrine), or NPCs who never investigate. Stealth must have active goals and AI that responds.
- Unsolvable procedural layouts. Overlapping detection fields with no clean route, or trivial ones (Invisible, Inc. early-access critique). The generator must check every bank for a stealth route and several breach options.
- Steep onboarding of planning tools. Shadow Mode was powerful but reviewers struggled to learn it, and Invisible, Inc.'s tutorial left out key tactics like hiding beside doors. Teach every detection rule explicitly with a scripted first bank.
- Punishing touch misinputs. Without tap-to-preview, tap-to-confirm and undo, mobile players lose heists to fat fingers, which Klei saw on PC even with a mouse.
- Unclear vocabulary. Using 'alarm' for both a local alert and the police call will confuse players about what is still recoverable (Invisible, Inc. renamed ALARM to SECURITY LEVEL).
- Revealing the whole squad when one character is seen (XCOM 2's default) would contradict the brief's individual-spotting idea and kill the mixed-team plan. But spotting with no link at all is also implausible, so define when characters get linked to each other.
- Sound rings that ignore walls when the fiction implies they shouldn't, or the reverse. Whatever rule is chosen, the preview must show exactly the tiles and NPCs affected.

## Ideas

- Suspicion pips per NPC, colour-coded to the character who caused them (0-3, 3 = spotted that character), with the move preview showing '+2 (teller)'. A turn-based version of Shadow Tactics' creeping yellow fill.
- A two-horizon safe-floor overlay: a solid tint for tiles seen now, hatching for tiles that will be seen during the coming NPC phase along telegraphed paths, grey for unknown or unscouted areas.
- An eye icon at the first unsafe tile on a drawn path (adapted from XCOM 2's red eye), so the player can stop one tile short.
- Profile tiers 0-3 calculated from loadout, plus area tiers (public / staff / secure) that work like Hitman's trespass and hostile zones. Staff uniforms and keycards act as disguises.
- Trespass warning: a profile-0 character caught in a staff area gets walked back to public by the guard instead of triggering an alert. The second offence escalates (adapted from Hitman's escort-out).
- Alarm as a physical action: tellers' buttons under the counter, guards' radios, the operator's verify-then-press, a civilian reaching a phone or the street. Each has a visible countdown and a route that can be blocked.
- Pre-heist sabotage that removes rungs from the ladder: cut the phone line (radios still work), disconnect the counter alarms, loop the cameras. Each can be discovered by maintenance or a check-in.
- Guard radio check-ins: a downed guard's radio buzzes 2 NPC phases later and can be answered in person (1 action, max 2 per heist), otherwise the operator becomes suspicious (adapted from Payday 2's pager).
- A 'Burned by X' tag: only the spotting NPC knows the character is hostile until they radio or shout. Kill, KO or command the witness before the NPC phase to contain it.
- A Go Loud action that starts an Ambush turn: every unburned character gets a Ready action, Calm NPCs are caught out of cover, commands get a radius bonus (adapted from XCOM 2's concealment ambush).
- Show sound rings as a pre-confirm preview, flood-filled so walls reduce them, with an ear icon on each NPC that will hear. A running drill emits a repeating ring each turn.
- Telegraphed misdirection tools: a ringing desk phone, a dropped wallet, a pulled fire alarm (a mass evacuation that moves the crowd but also brings the fire service and police nearby).
- A bank routine timeline (patrol rounds, cash transfer, armoured car, closing time) that the player scouts and plans around. Pressure comes from the world, not a doom clock.
- Post-alarm Heat as 5 levels × 5 ticks, always showing the next step and where it lands ('Heat 3 in 2 turns: SWAT van at the rear lot').
- Commanded NPCs come back from an expired command Alerted, not Calm. Zip-ties are limited per character. 'Holding' a group refreshes their command at the cost of the character's action (adapted from Invisible, Inc.'s pinning).
- Armed civilians rolled when the bank is generated, with visible tells on inspection, removed by frisking during a zip-tie, and a one-turn 'reaching for a weapon' telegraph before they can shoot.
- Turn rewind tokens by difficulty, replaying the same random seed so rewinds fix plans but not unlucky shots. Free undo until new information appears.
- Pressing and holding an NPC shows their individual cone and full intent (path, destination, current state and its cause). By default only the combined overlay for the selected character is drawn.
- A casing phase with a free profile-0 scout before the squad commits. Anything scouted feeds the overlays, and intel can be bought (blueprints, an inside man marking armed civilians).
- A ghost of the character on each NPC's last-known tile, so the player sees where an investigating NPC is heading and can use it as a lure.

## Open questions

- Should detection be checked at every tile along a move (honest, and XCOM 2-like) or only at the destination? Checking along the path adds tactical depth, but needs clear path-preview UI on a small screen.
- Do sound rings go through walls (simpler, matches the brief's 'circle') or flood-fill around walls (more believable, better for breaching play)? Whichever is chosen, the preview must show the result exactly.
- How far should information spread between NPCs? Does one burned character link teammates they were seen standing next to, or should spotting stay strictly individual?
- Should conspicuousness be fixed by loadout or partly behavioural (running, standing in a staff area, carrying a bag, crouching)? How many profile tiers can players hold in their heads?
- Should civilians telegraph exact paths or only destinations? Exact paths make the overlay fully honest but make the bank feel mechanical.
- Does Heat rise at all before the alarm (e.g. evidence ticks), or only after? How do the brief's 'police see a kill' rules work when no police are present yet: do witnesses or cameras count?
- How generous should rewinds be on the default difficulty, given procedural heists may run 40+ turns and mobile sessions get interrupted? Is a mid-heist save on suspend mandatory? It almost certainly is for a PWA on a phone.
- Do player characters get a reactive overwatch? If they do, it breaks the clean rule that reactions wait for the NPC phase.
- How is releasing a commanded NPC to reduce heat shown, and does the released NPC become a witness who tells police where the crew is (a trade-off between information and heat)?
- Should the casing phase be a separate pre-heist mode, or the first part of the same mission (scout walks in, rest of the crew waits in the van)?
- At 320x180, can suspicion pips, command timers, intent icons and burned tags all fit above NPC sprites, or does some of it need to move to a press-and-hold inspector?

## Sources

- [Game Design Deep Dive: Alarm systems in Klei's Invisible, Inc. (James Lantz)](https://www.gamedeveloper.com/design/game-design-deep-dive-alarm-systems-in-klei-s-i-invisible-inc-i-)
- [Invisible, Inc. programmer discusses design, stealth, and procedurally-generated stages (Shacknews)](https://www.shacknews.com/article/89531/invisible-inc-programmer-discusses-design-stealth-and-procedurally-generated-stages)
- [Road to the IGF: Klei Entertainment's Invisible, Inc.](https://www.gamedeveloper.com/design/road-to-the-igf-klei-entertainment-s-i-invisible-inc-i-)
- [Invisible Inc: Spy Games (Game Wisdom)](https://game-wisdom.com/spotlight/invisible-inc)
- [Invisible, Inc. Early Access Update 6 patch notes (rewind rationale)](https://forums.kleientertainment.com/topic/43601-early-access-update-6-archive-ghosts-patch-notes/)
- [Invisible, Inc. review (Slant Magazine)](https://www.slantmagazine.com/games/invisible-inc/)
- [Invisible, Inc. - The Kotaku Review](https://kotaku.com/invisible-inc-the-kotaku-review-1703519658)
- [Early Access: Invisible, Inc. (CGMagazine)](https://www.cgmagonline.com/articles/previews/early-access-invisible-inc/)
- [Mark of the Ninja's five stealth design rules (Game Developer)](https://www.gamedeveloper.com/design/-i-mark-of-the-ninja-i-s-five-stealth-design-rules)
- [Reinventing stealth in 2D with Mark of the Ninja (Game Developer)](https://www.gamedeveloper.com/design/reinventing-stealth-in-2d-with-i-mark-of-the-ninja-i-)
- [The five rules of stealth game design, according to Nels Anderson (PC Gamer)](https://pcgamer.com/stealth-game-design-mark-of-the-ninja)
- [Of Choice and Breaking New Ground (GDC 2013, Nels Anderson)](https://gdcvault.com/play/1017791/Of-Choice-and-Breaking-New)
- [The Dynamics of Mark of the Ninja (Designing Sound)](https://designingsound.org/2013/06/the-dynamics-of-mark-of-the-ninja)
- [Game Design Deep Dive: Dynamic detection in Shadow Tactics (Moritz Wagner)](https://www.gamedeveloper.com/design/game-design-deep-dive-dynamic-detection-in-i-shadow-tactics-i-)
- [Postmortem: Mimimi's Shadow Tactics: Blades of the Shogun](https://www.gamedeveloper.com/business/postmortem-mimimi-s-i-shadow-tactics-blades-of-the-shogun-i-)
- [Why Shadow Gambit looks so different from Desperados 3 (Dev Diary 3)](https://www.shadowgambit.com/why-shadow-gambit-the-cursed-crew-looks-so-different-from-desperados-iii-dev-diary-3/)
- [Review: Shadow Tactics (Destructoid) - Shadow Mode](https://www.destructoid.com/review-shadow-tactics-blades-of-the-shogun/)
- [10 Desperados III tips (noise circle when aiming)](https://godisageek.com/2020/06/10-desperados-iii-tips-to-help-you-out-in-the-wild-west/)
- [Desperados III (Wikipedia) - view cone zones, Showdown Mode](https://en.wikipedia.org/wiki/Desperados_III)
- [Road to the IGF: Subset Games' Into the Breach](https://www.gamedeveloper.com/game-platforms/road-to-the-igf-subset-games-i-into-the-breach-i-)
- [The creators of Into the Breach came very close to giving up (Kotaku)](https://kotaku.com/the-creators-of-into-the-breach-came-very-close-to-givi-1833498295)
- ['Into the Breach' Design Postmortem (GDC Vault)](https://gdcvault.com/play/1025772/-Into-the-Breach-Design)
- [Tactical Breach Wizards pitch post (Tom Francis)](https://www.pentadact.com/?p=9042)
- [Tactical Breach Wizards and XCOM (PCGamesN interview)](https://www.pcgamesn.com/tactical-breach-wizards/xcom)
- [Concealment (XCOM 2) - UFOpaedia](https://ufopaedia.org/Concealment_(XCOM2))
- [XCOM 2 concealment red tiles discussion (Steam)](https://steamcommunity.com/app/268500/discussions/0/1738841319801127822)
- [Simple True Concealment mod (XCOM 2)](https://catalogue.smods.ru/archives/33086)
- [The spy games of Phantom Doctrine offer more style than substance (Vice)](https://vice.com/en/article/the-spy-games-of-phantom-doctrine-offer-more-style-than-substance)
- [Phantom Doctrine (Wikipedia) - infiltration vs combat mode](https://en.wikipedia.org/wiki/Phantom_Doctrine)
- [Hitman (2016 video game) (Wikipedia) - trespassing, compromise, arrest](https://en.wikipedia.org/wiki/Hitman_(2016_video_game))
- [IO Interactive wants you to hide in plain sight (Game Informer)](https://gameinformer.com/games/hitman/b/xboxone/archive/2016/03/01/io-interactive-wants-you-to-hide-in-plain-sight.aspx)
- [Social Stealth (Payday Wiki) - casing mode, illegal interactions](https://payday.fandom.com/wiki/Social_Stealth)
- [Chameleon (Payday Wiki) - detection in casing mode](https://payday.fandom.com/wiki/Chameleon)
- [Legacy Skills (Payday Wiki) - pager limits](https://payday.fandom.com/wiki/Legacy_Skills)
- [Door Kickers 2 suppressors and sound discussion (Steam)](https://steamcommunity.com/app/1239080/discussions/2/3083250789421271324)
- [Door Kickers iPad touch controls (Android Police)](https://www.androidpolice.com/2015/09/03/door-kickers-brings-innovative-controls-to-the-squad-based-tactical-strategy-game-but-only-on-tablets/)
- [Frozen Synapse postmortem (Game Developer)](https://www.gamedeveloper.com/audio/postmortem-mode-7-games-i-frozen-synapse-i-)
- [Video: The Hitman GO design postmortem (Game Developer)](https://gamedeveloper.com/design/video-the-i-hitman-go-i-design-postmortem)
- [Hitman GO review (GamesBeat)](https://gamesbeat.com/hitman-go-review/)
- [Lara Croft Go (Wikipedia)](https://en.wikipedia.org/wiki/Lara_Croft_Go)
- [Gunpoint (Hardcore Gaming 101)](https://www.hardcoregaming101.net/gunpoint/)
- [Mechanical Breakdown: Enemy Behavior (stealth prototype devlog)](https://n2h-games.itch.io/stealth-game-prototype/devlog/849809/mechanical-breakdown-enemy-behavior)
- [AI omniscience and my changing definition of bug (XCOM substack)](https://xcom.substack.com/p/ai-omniscience-and-my-changing-definition)
