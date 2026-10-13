# Touch UX & campaign structure

Research note: the shared web-search budget for this turn was already used up when this agent started, so every WebSearch call failed. Everything below comes from pages fetched directly with WebFetch (mostly Wikipedia, plus pages from pentadact.com, Shacknews, W3C, Google, UXmatters and gameaccessibilityguidelines.com) and from established genre knowledge. Fandom wikis, Rock Paper Shotgun, Eurogamer, TouchArcade and GameSpot all refused the fetches. Most of the exact-number wiki data is therefore missing, especially Invisible Inc's alarm ticks and rewind counts, Payday 2's preplanning costs and Battle Brothers' wages. Where I give those from memory I mark them as approximate.

(A) Touch tactics. Deep turn-based tactics clearly sells and works on phones as a premium product with no mobile tropes. XCOM: EU on iOS scored 91 on Metacritic and was one of the top-grossing iPad releases in its launch week; XCOM 2 Collection on iOS scored 88, Slay the Spire 83 and FTL on iPad 88. The games that port well share four traits.
1. Information is complete and readable at a glance. Into the Breach shows exactly what the enemy will do, and Slay the Spire found that showing exact numbers beat vague icons.
2. The battlefield is small. Into the Breach fits on one screen on purpose.
3. Inputs take two steps (choose, preview, commit), and there is some form of undo.
4. Sessions are short and can be interrupted.

BankHeist has one hard problem here. The 320x180 internal resolution with 16px tiles makes a tile about 5.8-6.2mm (roughly 35pt) tall on a typical 6.1in phone in landscape. That is below Apple's 44pt, WCAG's 44px and Google's 48dp/9mm minimums. So precise commands need a zoomed 'act' camera or input aids such as snap-to-valid-tile, an offset reticle and a confirm button. Tapping raw tiles at native scale will not work. The FTL team dropped a Vita version because the screen was too small, which is a warning about information density. A bank larger than one screen, with vision cones, sound circles, off-limits zones, cover and NPC intents all drawn at once, will be unreadable unless overlays are layered and can be toggled.

(B) Campaign and meta structure. The meta structures that hold up long-term avoid grind with three tools.
1. A campaign-level clock: XCOM 2's Avatar Project, Invisible Inc's 72 hours, FTL's rebel fleet.
2. Unlocks that add options rather than raw power: FTL ships, Hitman's mastery starting points and pickup points, Heat Signature's liberations doubling as a tech tree.
3. Persistent crew who carry attachment and loss: XCOM permadeath, XCOM 2 War of the Chosen bonds, Darkest Dungeon stress, Heat Signature's personal missions.

Known failure modes:
- Snowballing. Tom Francis's analysis of XCOM: 'if you're finding the game easy, it gets easier'.
- Ratings that reward one ideal playstyle. Francis's Hitman critique: a single score judges every approach against silent assassin.
- Withholding the best toys behind grind, and paid drills for safes (Payday 2).
- Hard turn timers that feel merciless (XCOM 2's split reception).
- Punishing features players never chose. Darkest Dungeon made corpses and heart attacks optional after Early Access backlash.

For BankHeist the strongest direction combines several of these. Use Payday 2's preplanning and asset purchases with Hitman-style knowledge of a location. Use Hitman 3 Freelancer's roguelite contract chain, which loses gear and half the money on failure, and Invisible Inc's or XCOM's campaign clock. Then tie them together with per-crew-member notoriety: being recognised makes a character conspicuous in later heists. That one stat links the stealth rules to the meta game, forces B-team rotation and works against snowballing.

Procedural banks also undercut Hitman-style mastery of a hand-made map. Francis's comparison of Heat Signature and Void Bastards shows the fix: procedural spaces only stay interesting if every room has a system purpose. In Heat Signature only the cockpit mattered; in Void Bastards nearly every room matters. Each generated bank room should therefore control something the player can exploit: cameras, time locks, vault codes, alarms, power.

## Lessons

### 1. Telegraph enemy and NPC intentions exactly, before the player commits (perfect information about what the opposition will do, with randomness kept to the outcome of the player's own actions).

**Evidence:** Into the Breach: Justin Ma, 'At the beginning of every turn, you know exactly what the enemy's going to do' (Shacknews preview). Slay the Spire moved from hidden actions to a 'Next Turn' system and then to 'Intents'; testers found exact numbers more engaging than range icons (Wikipedia). Both are highly rated on mobile, where players read rather than react.

**For BankHeist:** Every NPC that will act next turn shows an intent marker. Examples: a teller with an arrow to the silent-alarm button and the label 'presses alarm next turn'; a civilian with a path arrow to the door ('escapes in 2'); a guard heading for a body; the camera operator's monitor wall showing which camera feeds are being watched. Commanded NPCs show a '2' or '1' countdown pip over their head. The player's turn is spent reacting to known threats. Uncertainty comes from where bullets land in the cone and the 50% cover block, and from hidden NPCs (the armed civilian is revealed only when spotted or frisked), never from an NPC acting without warning.

### 2. Native 16px tiles are physically too small for reliable touch targeting, so input must not depend on precise tile taps at 1x zoom.

**Evidence:** Apple HIG and WCAG 2.5.5 call for at least 44pt/44 CSS px. Google asks for at least 48dp, about 9mm, with a 7-10mm range. With 180 internal px of height on a roughly 65-70mm landscape phone screen, one tile is about 5.8-6.2mm, around 35pt. WCAG specifically recommends larger targets for actions that are frequent, hard to undo, or near screen edges, and notes that the finger hides the exact spot being touched.

**For BankHeist:** Use two camera states. 'Overview' is the native 20x11-tile view for reading the situation. 'Act' is about 1.6-2x zoom, so a tile is roughly 9-12mm, and the camera enters it automatically when a unit is selected. Movement taps snap to the nearest valid tile, and the chosen tile is shown enlarged with its path. Targeting by drag uses an offset reticle or loupe drawn above the finger. Commit always goes through a large Confirm button in a bottom corner, at least 48dp and in thumb reach, or through a second tap on the same tile. Never put irreversible actions under a single small tap.

### 3. Use choose, preview, commit for every action, and offer free undo up to the moment new information or randomness appears.

**Evidence:** Into the Breach lets you undo a mech's move before it acts and gives one Reset Turn per battle (from memory of the game; not confirmed by a fetched source). Invisible Inc gives a difficulty-dependent number of rewinds. Tom Francis argues for reloading 'to test rules' but not to undo bad luck ('A Leftfield Solution To An XCOM Disaster'). XCOM: EU's Ironman mode is praised because every decision counts.

**For BankHeist:** Rule: a movement can be undone freely if it revealed no new tiles or NPCs, triggered no perception check and rolled no dice. Shots, noise and any reveal are permanent. Separately, give a limited 'Rewind turn' resource set by difficulty (for example 3 on Normal, 1 on Hard, 0 on Ironman) that returns to the start of the player turn. Show a full preview before commit: path, the spots where the unit becomes conspicuous, the noise circle and who is inside it, the shot cone with an expected-hits readout, and which cover blocks which rays.

### 4. Keep a mission readable at a glance: a small play space, or strict overlays that can be toggled, because a phone screen does not fit dense UI.

**Evidence:** Ma: 'We appreciate when you can have everything so clean as to fit on a single screen'. Into the Breach uses an 8x8 grid. The FTL team dropped a planned Vita touch version because the screen was too small. Hitman GO chose colour-coded enemy types with learnable patterns and cut dialogue and cutscenes for mobile.

**For BankHeist:** Budget overlays. The selected unit's 'safe floor' tint and its intent arrows are always on. Vision cones, camera coverage, off-limits zones and cover markers each sit on a toggle in a small overlay drawer, or appear in context while the player drags a path. Each NPC archetype (guard, teller, manager, camera operator, civilian, cop, SWAT) needs a distinct silhouette and colour accent that reads at 16px. Never rely on colour alone; add shape or icon cues so colour-blind players can read them. Keep banks to about 2-4 screens of area, with a minimap and quick-jump buttons per crew member.

### 5. A soft, escalating time pressure works better than a hard turn limit, and the campaign also needs a clock.

**Evidence:** XCOM 2 mission timers split critics: Destructoid called them 'merciless', while Eurogamer said they encourage risk-taking. Invisible Inc's alarm level rises after each player turn and brings new security. Its campaign gives three days (72 hours) of travel and missions before the finale. XCOM 2's Avatar Project doom clock made reviewers 'question every decision'. FTL's rebel fleet advances with each jump.

**For BankHeist:** Inside a heist, pressure comes from Heat and from a visible police ETA bar once an alarm sounds, not from a 'fail at turn 12' rule. During stealth, a slow 'suspicion of the day' clock is enough: shift changes, armoured-truck arrival, closing time. Across the campaign, use a federal task force investigation meter that advances with each heist, faster with kills and loud jobs. It can be pushed back by laying low (which costs days and money) or by special jobs (destroying evidence, bribing a detective). The meter replaces grinding: there is never unlimited time to farm easy banks.

### 6. Snowballing is the central failure of squad-progression campaigns. Counter it with per-mission squad limits, flat health and missions that force the B-team.

**Evidence:** Tom Francis, 'Solving XCOM's Snowball Problem': 'If you're finding the game easy, it gets easier.' He used the same six soldiers on about 80% of missions. He proposes varying squad size by mission, flat health that does not scale with level, and 'low-profile' missions where wanted veterans cannot deploy.

**For BankHeist:** Give each crew member a Notoriety value that rises when they are seen on camera, witnessed in a loud action, identified by an escaped civilian, or arrested. Notoriety adds to their conspicuousness in later heists: a famous face is recognised by guards as if carrying a weapon. This stealth rule naturally forces rotation. Fresh recruits are the best infiltrators, veterans are loud specialists. Each contract sets the crew size (for example a quick 2-person casing job, a 4-person standard job, a 6-person vault job). Keep HP flat (armour is gear, not levels). Progress comes from skills and options rather than survivability.

### 7. Reward many playstyles separately instead of scoring against one ideal (silent) run.

**Evidence:** Francis on Hitman (2016): ratings judge every approach against 'no noticed kills, no bodies, never spotted', which pushes 'save-scumming murder tourism'. He proposes Styles, sets of rules that a mission report lists, each worth XP the first time only. Payday 2 gives an XP bonus for stealth. Shadow Tactics gives optional badges for speed, Hardcore difficulty and pacifism.

**For BankHeist:** After each heist, the report lists every Style the crew fulfilled, for example 'Ghost' (no alarm ever), 'Inside Job' (the infiltrator disabled the alarm before the crew entered), 'Cowboys' (vehicle breach), 'Clean Hands' (no deaths), 'Fortress' (held for 10 turns of assault), 'Overwatch' (sniper nest kills only). Each pays a one-time reputation or unlock bonus per contract tier. Payouts must not make stealth strictly better: loud play reaches deeper vaults and more loot bags, stealth keeps Heat and Notoriety low.

### 8. Pre-heist planning and asset purchases are where heist fantasy and player creativity show up, so make them a real, costed decision layer.

**Evidence:** Payday 2: Crime.net contracts on a map, multi-day heists, purchasable pre-planning assets, a stealth-or-loud choice per job. Hitman mastery unlocks new starting locations and agency pickup points. Door Kickers has an explicit deployment and planning phase that works on touch, since paths are drawn with a finger. Hitman 3 Freelancer randomises contract and starting location.

**For BankHeist:** Every job starts with a Planning screen that shows a partly revealed bank. Intel and assets are bought with clean money or favours, for example: blueprint (reveals the layout), guard rota (reveals patrols), inside man (one employee will not press the alarm), stash drop (smuggle a weapon bag into a toilet before the heist), cut the phone line (silent alarm delays police by X turns), getaway vehicle position, sniper nest rental in the adjacent building, uniform disguise. A 'casing visit' can be run as an optional pre-mission with an unarmed crew member to reveal more for free, at the risk of raising Notoriety.

### 9. Procedural levels only stay interesting if every room has a system purpose the player can exploit; procedural generation alone does not create immersive-sim depth.

**Evidence:** Francis compares Heat Signature and Void Bastards. In Heat Signature 'only the cockpit is consistently relevant'. In Void Bastards every area matters (Helm gives a map, Atmo gives air, Gen gives power), which he calls 'significantly better'. Hitman's levels are hand-made 'Swiss cheese' layouts with about 300 NPCs on routines, plus mission stories added because testers found early levels lifeless.

**For BankHeist:** The bank generator places rooms with systems first, then fills in decoration. Examples: the security room (camera operator and monitor wall, so killing the power blinds cameras); manager's office (vault code or keycard, PC with the time-lock schedule); server room (alarm panel, so disabling it delays police); electrical room (lights, which affects vision); staff room (shift-change timing, uniforms); loading dock (armoured-truck arrival as an opportunity); vault tier (time lock, drill noise, seismic alarm). Generate 2-3 'opportunities' per bank, Hitman-style: a teller who takes a smoke break, an unguarded rear door at 12:00, a renovation scaffold on the east wall.

### 10. Permadeath works best when loss has more forms than death and recovery has a cost: injury, arrest and rescue.

**Evidence:** XCOM 2: wounded soldiers recover slowly; dead or wounded can be carried out to keep their gear; customisation makes deaths hurt more. Invisible Inc: agents can be revived with a medkit or dragged to the exit, and some agents can be rescued in missions. In Francis's XCOM 2 anecdote, soldiers left behind are captured. Door Kickers campaigns carry injuries and replace dead troopers with generated recruits.

**For BankHeist:** A downed crew member can be stabilised and carried. Left behind, they are arrested rather than killed, unless executed by SWAT at high Heat. Arrested crew raise Notoriety (they may talk) and open a jailbreak or transfer-ambush contract. Injuries cost weeks of campaign time. Killed crew are gone, and their gear is lost unless the body is recovered. Ironman, one save per campaign, is an option rather than the only mode.

### 11. Give crew members personal goals and a reason to leave, so the roster turns over and produces stories instead of a static elite squad.

**Evidence:** Heat Signature: each character has a personal mission, and liberations unlock gear, tying progress to the main goal. Francis notes this as its advantage over Void Bastards, where unlocks competed with the main quest. XCOM 2 War of the Chosen bonds: paired soldiers unlock abilities, and the partner may panic or go berserk if one dies. Darkest Dungeon deliberately reduces player control through stress.

**For BankHeist:** Each recruit has one personal motive, for example 'pay off my debt of $80k', 'get my brother out of county jail', 'never kill anyone', 'hit the bank that foreclosed my house'. When it is met, the recruit can retire with a cut and leave behind a permanent perk (a contact, safehouse, fence or vehicle). Two crew who complete 3 heists together become a Crew Pair with a small joint action (for example a covering-fire swap). A pair member killed in front of the other breaks that partner's nerve for a turn.

### 12. Unlocks should widen options, not inflate power. Don't withhold the best toys or tie progression to grind or money.

**Evidence:** FTL unlocks are alternative ships and layouts. Into the Breach unlocks pilots and mech squads. A PC Gamer review faulted Payday 2's 'dogged insistence on withholding the best toys'. Payday 2's paid safe drills caused a backlash, with refunds and apology masks. Infamy resets money and levels.

**For BankHeist:** Meta unlocks between campaigns are new crew archetypes (safecracker, driver, hacker, face), new contract types (armoured truck, gold reserve, casino cage), new starting perks (a fence, a bent cop, a garage) and new gadgets. Within a campaign, power comes from money and gear bought with it. No prestige resets, no XP grind gates. Everything visible in a shop is purchasable within the run.

### 13. Money laundering and the split between dirty and clean money is a ready-made, thematic economy lever.

**Evidence:** Payday 2 sends about 80% of earnings to an offshore account and 20% to spendable cash. The offshore money buys contracts and Infamy, or can be burned. Hitman 3 Freelancer uses its own currency, Merces, and failing a mission costs all gear brought along plus half the Merces reserve.

**For BankHeist:** Loot comes out as Dirty Money, which is useless for gear until laundered. Laundering capacity per week comes from fronts the crew buys or unlocks (laundromat, car wash, nightclub). Using a fence or a crooked accountant is faster but takes a large cut. Spending dirty money directly raises the investigation meter. Crew are paid a percentage of the take, not wages, so a bigger crew means smaller shares and possible disloyalty. A failed heist loses the gear brought in, Freelancer-style, which makes deciding what to bring a real risk.

### 14. Campaign runs should be finite (hours, not weeks), with a climax and an easy restart. Expect players to lose.

**Evidence:** FTL targeted a 'suicide mission' feel, roughly a 10% win rate, and copied Super Meat Boy's instant restart; it has 8 sectors per run. Into the Breach keeps battles short with a turn counter and lets one pilot carry over through time travel when a run fails. Hitman 3 Freelancer chains contracts that draw out a Syndicate leader for a Showdown. Payday 2 Crime Spree chains heists with escalating modifiers.

**For BankHeist:** A campaign is about 8-12 heists building to The Big One (for example a Federal Reserve depot or a casino vault), roughly 6-12 hours total. Early jobs (small branches, trucks) unlock intel, contacts and access for the finale. Losing the campaign (crew wiped, or the investigation meter full and the task force raids the safehouse) ends the run. Each finished or failed run grants meta unlocks, and one surviving crew member can be carried into the next campaign as a veteran, Into the Breach style.

### 15. Mobile session length must shape mission structure: suspend and resume anywhere, plus heists split into phases.

**Evidence:** Hitman GO cut cutscenes and narrative because mobile play happens in short sessions. A Pocket Gamer review praised Into the Breach because 'with just three units ... and short matches ... it's easy to pick up and play wherever you are'. XCOM missions are long, but the mobile ports succeeded because play is turn-based and can be paused. Gameaccessibilityguidelines.com recommends both manual save and autosave.

**For BankHeist:** Autosave after every committed action and restore the exact state, including camera and selection, on reopening. The game must also survive being killed by the OS, because it is a PWA. Aim for 20-40 minutes per heist, split into natural chapters: casing and setup, the stealth phase, going loud, escape. A 'heist recap' card on resume shows the last 3 events, current Heat, police ETA and each crew member's status, so the player re-orients within seconds.

### 16. Design for two-handed landscape play. Keep frequent controls in the bottom corners and make sure the finger never hides the information being previewed.

**Evidence:** In Hoober's UXmatters study, 49% of users held phones one-handed, 36% cradled them and 15% used two hands. The author later withdrew his thumb-reach charts and found that people favour the screen centre. He also warns that fingers hide content and that rarely used or dangerous actions should not go top-left. WCAG says to enlarge targets near screen edges.

**For BankHeist:** Landscape only. The left thumb gets crew portraits or a unit cycle plus camera tools; the right thumb gets the action bar plus Confirm and End Turn. End Turn needs a hold-to-confirm or a confirmation when units still have actions. Text-heavy info goes in a top strip (Heat, alarm state, police ETA). Show previews above the finger, never under it: the aim cone extends away from the drag point, and tooltips open on long-press, not hover. On desktop, map the same actions to mouse, hover tooltips and hotkeys.

### 17. A stealth phase before combat with a clear 'spotted' boundary is proven, and it gets better when breaking it on purpose (an ambush) pays off.

**Evidence:** In XCOM 2 the squad starts concealed until it attacks or moves too close, and an ambush grants bonuses; Polygon and Eurogamer praised this. Shadow Tactics shows visible enemy vision cones, civilians who alert guards and environmental noise (birds, water), which earned an 85 on Metacritic. Hitman (2016) uses social stealth with enforcers who see through disguises, but some critics found it hard to tell who the enforcers were.

**For BankHeist:** Show per-crew concealment as a clear state icon: Blending / Conspicuous / Spotted. Make detection fully readable. The selected unit's safe-floor tint must include exactly which NPC would notice them on which tile and why ('Guard: sees your rifle'). Enforcer-like NPCs (guards, the camera operator, the manager) carry an icon so nobody has to guess who matters, avoiding Hitman's enforcer confusion. Going loud on purpose from concealment, with several crew acting in the same turn, gives a first-volley bonus such as +1 bullet or reduced Aim spread, which rewards a coordinated breach.

### 18. Escalating, persistent strategic consequences make each heist matter beyond its own map.

**Evidence:** In XCOM: EU, panic in ignored regions makes nations leave for good (the game ends if 8 of 16 leave). In XCOM 2 War of the Chosen, the Chosen return with new abilities until their stronghold falls. Invisible Inc corporations get harder over the campaign. In Hitman 3 Freelancer, later locations are more heavily guarded.

**For BankHeist:** The city map tracks security per bank chain. Hit two branches of the same chain and its other branches upgrade: more cameras, an armed guard, a faster police contract, a dye pack in cash bags. Repeated high-Heat jobs in a district attract a named SWAT commander, a nemesis lieutenant who can appear in assault waves with a signature tactic. This turns 'which bank next?' into a strategic choice.

### 19. Make the most punishing or fiddly simulation features optional, or let players decide when they hit, so the game stays punishing without feeling unfair.

**Evidence:** Darkest Dungeon's corpses and heart-attack deaths drew Early Access backlash, and the developers made them optional. Battle Brothers optionally blocks save-scumming. Hitman's Elusive Targets (no saves, one chance) are deliberately the exception, not the rule. Gameaccessibilityguidelines.com: 'Include an option to adjust the game speed', and do not make precise timing essential.

**For BankHeist:** Expose a few campaign toggles: Ironman, rewinds per turn, armed-civilian frequency, permadeath vs arrest-only, enemy-turn animation speed (with a skip button). Keep the tactical game timing-free. Animation speed and skip settings matter a lot on mobile, where watching 20 NPCs move each enemy turn is the main pacing killer.

### 20. Plan-then-execute input (drawing paths) works on touch for the real-time-feeling parts, and a pause-and-plan layer turns real-time chaos into deliberate tactics.

**Evidence:** Door Kickers has players drag a line from each trooper to plan a path, and shipped on iOS and Android. In Heat Signature, indefinite pausing turned real-time play into 'prediction and somewhat turn-based strategy'. Watching testers also led Francis to add a speed-matching button because 'some people can't mentally factor in relative velocities'.

**For BankHeist:** During the stealth phase, when nothing is alert, let the player queue a multi-turn route by dragging a path for each crew member. The game fast-forwards turns until something interrupts: an NPC notices, an intent changes, or a unit arrives. This avoids 30 dull turns of walking to a toilet. Add helper buttons wherever testers struggle, for example 'auto-face the nearest threat', 'end turn when all queued'.

### 21. Premium, trope-free depth sells on mobile, but ports cut content for size and performance. Keep the simulation's per-turn cost bounded.

**Evidence:** XCOM: EU on iOS scored 91 on Metacritic, was sold as premium and was among the highest-grossing iPad releases in its first week; the port cut maps and texture resolution to save size. The Banner Saga moved from an iOS-first plan to PC because the early iPad ran it poorly. XCOM 2 iOS scored 88. Mini Metro was designed for mobile first and praised for simple touch controls.

**For BankHeist:** Commit to a one-time-purchase premium model and say so: no energy, ads or loot boxes. Design the simulation so an enemy turn with about 40 NPCs and a police wave resolves quickly and reads as a summary. Show batch-resolved movement with only the important events animated (spotted, alarm pressed, shots fired, NPC fled), and give an 'events this turn' log the player can tap to jump the camera.

### 22. Give players a 'see what would happen' tool for learning the simulation's rules without save-scumming.

**Evidence:** Francis reloaded saves to test rules in XCOM 2 and found an unknown evacuation-zone mechanic that way. He separates that from reloading to undo bad luck. Hitman's mission stories and eavesdropping teach the systems in context, and the guidance stops once the player knows enough.

**For BankHeist:** Before committing, long-press any action to see an explicit consequence breakdown. Examples: 'Breach charge: noise radius 8 (red circle); alerts 6 NPCs including camera operator, who presses the alarm next turn; wall section destroyed; 30% shrapnel hit on the teller'. Also add an 'Intel' journal per bank that fills with discovered opportunities, eavesdropped hints and NPC routines, Hitman style, so scouting has lasting value within the campaign.

## Pitfalls

- Raw tile taps at native 320x180 scale. A 16px tile is about 6mm (about 35pt) on a phone, well under the 44pt / 48dp / 9mm touch minimums, so mis-moves into a guard's view will feel like the game's fault.
- Overlay soup: drawing vision cones, sound circles, off-limits zones, cover, safe floor and intents all at once on a 6in screen. FTL's developers dropped the Vita version because the screen was too small.
- Hard turn timers on missions. XCOM 2's timers were called 'merciless' and split players. Use escalating Heat and a visible police ETA instead.
- The snowball problem: an unchanging elite squad of 4-6 veterans who make every later heist trivial while early failure spirals (Francis on XCOM). Counter it with per-contract crew sizes, flat HP and Notoriety-based rotation.
- A single rating that scores every approach against silent stealth (Hitman 2016). Loud, vehicle-breach and sniper approaches need their own rewards, or players will save-scum toward one 'correct' play.
- Challenges that gate core progression, which pushes repetitive 'murder tourism' and reloads (Francis on Hitman).
- Withholding the best gear behind grind, prestige resets (Payday 2 Infamy) or real money (the Payday 2 safe-drill backlash).
- Procedurally generated rooms with no system purpose, so only the vault matters. This is Heat Signature's weakness, where only the cockpit is relevant; give every generated room an exploitable function.
- Enforcer ambiguity: players can't tell who will see through their cover (a criticism of Hitman 2016). Detection rules must be shown per NPC.
- Hidden NPC intentions that punish the player out of nowhere, for example a teller pressing an alarm with no warning. That breaks the plan-and-react loop that makes Into the Breach and Slay the Spire work on touch.
- Long, unskippable enemy turns with dozens of NPCs animating. This is the main pacing killer for mobile turn-based play; offer speed settings, skip and batched resolution.
- No suspend and resume. A 45-90 minute heist that can't be interrupted and restored exactly after the OS kills the PWA will not be played on a phone.
- Punishing features forced on everyone (Darkest Dungeon's corpses and heart attacks had to be made optional). Ironman, armed-civilian frequency and permadeath should be options.
- Unlocks that compete with the main goal (Void Bastards) instead of advancing it (Heat Signature liberations). Meta progress should come from doing the heist campaign, not a parallel grind.
- Mobile-game monetisation or retention tropes (energy, daily login, gacha crew). Even Hitman GO's hint purchases were criticised as overpriced.
- Banking on Hitman-style mastery of a map when banks are procedural. Repeat knowledge must come from bank archetypes, chain-wide security patterns and within-campaign scouting instead.

## Ideas

- Per-crew-member Notoriety that adds to conspicuousness in later heists. A recognised face is treated like a visible weapon, so a fresh recruit with no record becomes the ideal unarmed infiltrator. This ties the stealth rules to roster rotation.
- An 'Act' zoom (about 1.6-2x) that the camera enters automatically when a unit is selected, plus an 'Overview' zoom at the native 20x11 tiles. Snap-to-valid-tile movement and a big bottom-corner Confirm button.
- An aim-cone drag with an offset loupe, rendered away from the finger, plus fine-rotate nudge buttons and a live readout: expected hits, cover-block chances per target and friendly-fire warning.
- Free undo for any move that revealed nothing and rolled nothing, and a small difficulty-scaled stock of 'Rewind turn' charges (for example 3 on Normal, 1 on Hard, 0 on Ironman).
- NPC intent markers in the style of Into the Breach and Slay the Spire: alarm-press arrows with turn counts, escape paths to doors, a 'reaching for weapon' tell on an armed civilian once spotted, and commanded-down countdown pips.
- Multi-turn queued routes during the calm stealth phase. Drag a path, and the game fast-forwards turns until an interrupt (a notice, an intent change or arrival).
- A pre-heist Planning screen in the style of Payday 2 preplanning. Buy blueprints, guard rota, an inside man, a stash drop, a cut phone line, sniper nest rental, getaway placement and uniforms; an optional unarmed casing visit reveals intel for free at a Notoriety risk.
- Dirty vs clean money with weekly laundering capacity from fronts (laundromat, car wash, nightclub). Fences are faster but take a big cut, and spending dirty money directly raises the investigation meter.
- Crew paid as a share of the take rather than wages. A bigger crew means smaller shares, and an underpaid crew can become disloyal or talk if arrested.
- Freelancer-style risk on failure: gear brought into a failed heist is lost, so the loadout decision matters.
- A campaign investigation meter (the federal task force) as the doom clock. It is pushed back by laying low (costs days), destroying evidence or bribing a detective, and when full the safehouse is raided for a final defence or escape mission.
- Bank-chain security escalation: hitting one chain makes its other branches add cameras, armed guards, dye packs or faster police contracts. A named SWAT commander nemesis appears in high-Heat districts.
- Personal motives per recruit (debt, jailed brother, pacifist vow, revenge on a specific bank). Fulfilling one lets them retire and leave a permanent perk (a contact, fence, garage or safehouse).
- Crew Pairs after 3 heists together, with a small joint action. Seeing a partner killed breaks the survivor's nerve for a turn.
- Arrest instead of death for crew left behind, which opens jailbreak or prison-transfer ambush contracts and raises the risk the arrested crew member talks (Notoriety).
- A post-heist report that lists every Style achieved (Ghost, Inside Job, Cowboys, Clean Hands, Fortress, Overwatch). Each pays once per contract tier, Francis-style, rather than as a single score.
- Campaign arc of 8-12 heists building to The Big One. Early jobs unlock intel, access or contacts for the finale; one veteran carries over to the next campaign, as in Into the Breach.
- A system-first bank generator: security room, server or alarm panel, electrical room, manager's office with the time-lock schedule, staff room with shift change, loading dock with armoured-truck timing. Each bank also gets 2-3 Hitman-style opportunities.
- A per-bank Intel journal that fills with discovered routines, eavesdropped hints and opportunities, so scouting pays off.
- Long-press consequence previews for any action: noise radius, who is alerted, what they will do next turn, structural damage and collateral risk.
- An enemy-turn summary log with tap-to-jump camera, adjustable animation speed and skip; only key events (spotted, alarm, shots, escape) animate at full length.
- A resume recap card after the app is suspended: the last 3 events, Heat, police ETA and crew status.
- A loud-breach first-volley bonus when several concealed crew open fire in the same turn, which rewards the 'infiltrator first, heavies later' mixed-team plan.

## Open questions

- What is the real tile size on target devices once browser chrome is counted (Safari tab vs installed PWA)? Is the Act zoom enough, or do we need a 24px-tile alternative layout for small phones?
- How big can a generated bank be while staying readable? Is a 2-4 screen budget compatible with sniper nests in neighbouring buildings and choosing a getaway vehicle location, which imply a larger outdoor map?
- Should undo be allowed after a hidden perception roll that passed? Revealing that a move was safe leaks information, so where exactly is the commit boundary?
- With cone-based shooting, how should hit expectation be shown without turning into a hidden hit percentage? Show ray paths only, or an expected-hits number as well?
- How does the 2-turn 'stay down' command interact with fast-forwarded stealth turns and queued routes? Do commands pause auto-advance?
- Is per-crew Notoriety stacked with weapon or armour conspicuousness as one combined 'threat level' number per tile, or kept as separate detection rules (recognition vs threat)?
- What is the right campaign length for mobile players versus desktop players, and should there be a short 'single job' mode (Crime.net-style quick contract) outside the campaign?
- Should failure be a run-ending roguelite (FTL, Hitman Freelancer) or a persistent campaign where the crew rebuilds (XCOM, Darkest Dungeon)? Which suits procedural banks and permadeath better?
- How should Heat from 'killed and seen by police' be told apart from investigation-meter growth between heists, so players understand which consequence lands where?
- Exact numbers for Invisible Inc's alarm ticks and rewinds, Payday 2's preplanning costs and Battle Brothers' wages could not be confirmed because wiki access was blocked and the search budget was spent. Verify them in a follow-up if the team wants to copy specific values.

## Sources

- [Into the Breach - Wikipedia](https://en.wikipedia.org/wiki/Into_the_Breach)
- [Into the Breach preview: FTL's creators pit mechs against aliens (Shacknews, developer quotes)](https://www.shacknews.com/article/99108/into-the-breach-preview-ftls-creators-pit-mechs-against-aliens-in-post-apocalyptic-warfare)
- ['Into the Breach' Design Postmortem - GDC Vault (Matthew Davis, GDC 2019)](https://www.gdcvault.com/play/1025772/-Into-the-Breach-Design)
- [Into the Breach Switch review - Pocket Gamer](https://www.pocketgamer.com/into-the-breach/review/)
- [Invisible, Inc. - Wikipedia](https://en.wikipedia.org/wiki/Invisible,_Inc.)
- [Invisible, Inc. on Steam](https://store.steampowered.com/app/243970/Invisible_Inc/)
- [XCOM 2 - Wikipedia](https://en.wikipedia.org/wiki/XCOM_2)
- [XCOM 2: War of the Chosen - Wikipedia](https://en.wikipedia.org/wiki/XCOM_2:_War_of_the_Chosen)
- [XCOM: Enemy Unknown - Wikipedia](https://en.wikipedia.org/wiki/XCOM:_Enemy_Unknown)
- [Payday 2 - Wikipedia](https://en.wikipedia.org/wiki/Payday_2)
- [Hitman (2016 video game) - Wikipedia](https://en.wikipedia.org/wiki/Hitman_(2016_video_game))
- [Hitman 3 (Freelancer mode) - Wikipedia](https://en.wikipedia.org/wiki/Hitman_3)
- [Hitman Go - Wikipedia](https://en.wikipedia.org/wiki/Hitman_Go)
- [Heat Signature - Wikipedia](https://en.wikipedia.org/wiki/Heat_Signature_(video_game))
- [Tom Francis - Solving XCOM's Snowball Problem](https://www.pentadact.com/2016-02-25-solving-xcoms-snowball-problem/)
- [Tom Francis - A Leftfield Solution To An XCOM Disaster](https://www.pentadact.com/2017-09-14-a-leftfield-solution-to-an-xcom-disaster/)
- [Tom Francis - Rewarding Creative Play Styles In Hitman](https://www.pentadact.com/2016-05-14-rewarding-creative-play-styles-in-hitman/)
- [Tom Francis - Void Bastards Vs Heat Signature](https://www.pentadact.com/2021-07-30-void-bastards-vs-heat-signature-a-completely-objective-analysis/)
- [Tom Francis - 15 Years of Indie Dev In 4 Bits of Advice](https://www.pentadact.com/2026-01-08-15-years-of-indie-dev-in-4-bits-of-advice/)
- [FTL: Faster Than Light - Wikipedia](https://en.wikipedia.org/wiki/FTL:_Faster_Than_Light)
- [Slay the Spire - Wikipedia](https://en.wikipedia.org/wiki/Slay_the_Spire)
- [Darkest Dungeon - Wikipedia](https://en.wikipedia.org/wiki/Darkest_Dungeon)
- [Stress - Darkest Dungeon Wiki](https://darkestdungeon.wiki.gg/wiki/Stress)
- [Battle Brothers - Wikipedia](https://en.wikipedia.org/wiki/Battle_Brothers)
- [Door Kickers - Wikipedia](https://en.wikipedia.org/wiki/Door_Kickers)
- [Shadow Tactics: Blades of the Shogun - Wikipedia](https://en.wikipedia.org/wiki/Shadow_Tactics:_Blades_of_the_Shogun)
- [The Banner Saga - Wikipedia](https://en.wikipedia.org/wiki/The_Banner_Saga)
- [Mini Metro - Wikipedia](https://en.wikipedia.org/wiki/Mini_Metro_(video_game))
- [WCAG 2.1 Understanding SC 2.5.5 Target Size](https://www.w3.org/WAI/WCAG21/Understanding/target-size.html)
- [Google Android Accessibility Help - Touch target size (48dp)](https://support.google.com/accessibility/android/answer/7101858)
- [How Do Users Really Hold Mobile Devices? (Steven Hoober, UXmatters)](https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php)
- [Game Accessibility Guidelines - full list](https://gameaccessibilityguidelines.com/full-list/)
