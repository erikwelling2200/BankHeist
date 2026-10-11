# BankHeist design research: key findings

These notes summarise a research pass made before the game design was written (October 2026). Eight researchers each
covered one area, and a ninth reviewed the original concept against what they found. This file keeps the findings
that shaped the design, with the games that show each one, so a later decision can be traced back to its reasoning.
[GAME_DESIGN.md](GAME_DESIGN.md) is the design built on them.

The full notes for each area, each with 20–25 lessons, pitfalls, ideas, open questions and 30–60 sources, are in
[`research/`](research/):

| Area | File |
| --- | --- |
| Squad tactics (XCOM, Phoenix Point, Jagged Alliance 3, Gears Tactics, Phantom Doctrine) | [squad-tactics.md](research/squad-tactics.md) |
| Heist games (Payday 1–3, Monaco, Teardown, GTA heists, Invisible Inc.) | [heist-games.md](research/heist-games.md) |
| Immersive sims and sandbox stealth (Hitman, Deus Ex, Dishonored, Thief, Teardown, Siege) | [immersive-sims.md](research/immersive-sims.md) |
| Stealth tactics and telegraphing (Invisible Inc., Shadow Tactics, Mark of the Ninja, Into the Breach) | [stealth-tactics.md](research/stealth-tactics.md) |
| Aiming and shot resolution (Phoenix Point, Jagged Alliance, Fallout, XCOM odds, Payday weapon stats) | [aiming.md](research/aiming.md) |
| NPCs, hostages and police (SWAT 4, Ready or Not, Splinter Cell Blacklist AI, Project Highrise, GTA) | [npcs-hostages-police.md](research/npcs-hostages-police.md) |
| Procedural banks (Spelunky, Gungeon, Unexplored, XCOM 2 plots, real bank security) | [procedural-banks.md](research/procedural-banks.md) |
| Touch UX and campaign structure (Into the Breach mobile, XCOM iOS, FTL, Hitman Freelancer) | [touch-ux-and-campaign.md](research/touch-ux-and-campaign.md) |
| Critique of the original concept against all of the above | [concept-critique.md](research/concept-critique.md) |

**Limits of the research.** All the researchers shared one web-search budget, and it ran out partway through. Four
of them (aiming, NPCs, procedural banks, touch UX and campaign) had to fall back on fetching pages directly. Several
wikis (Payday, XCOM and Fallout fandom pages, the Jagged Alliance 3 dev diaries) refused those fetches. Exact
numbers those notes attribute to memory or "genre knowledge" are marked there and should be checked before anything
is copied from them. Every number in the design documents is a tuning proposal, not an established fact.

---

## 1. Readability decides everything

The finding that came up in every area: a deep simulation is only fun if the player can read it **before** acting.

1. **Players have to see what the AI perceives, or stealth feels arbitrary.** Thief's stealth "didn't work" until
   the light gem showed players how visible they were. Trespasser failed as an "overly complex simulation" without
   feedback. Invisible Inc.'s stated goal was "when you die, it's your fault".
   → The safe-floor overlay is BankHeist's light gem and has to be a strict promise.
   ([Building Thief's stealth](https://www.gamedeveloper.com/design/building-the-original-i-thief-s-i-revolutionary-stealth-system),
   [Harvey Smith on simulation](https://witchboy.net/?p=22))
2. **Telegraph what the opposition will do next.** Into the Breach shows every enemy attack ahead of time, so the
   game "starts to feel like a puzzle" and "every death felt like your own fault". Slay the Spire's playtesters
   engaged more with exact intent numbers than with vague icons. Players called XCOM 2's red concealment tiles "not
   100% reliable" because patrols moved after the player committed.
   → Every NPC commits to its next move and shows it, and the overlay accounts for those committed moves.
   ([Road to the IGF: Into the Breach](https://gamedeveloper.com/game-platforms/road-to-the-igf-subset-games-i-into-the-breach-i-),
   [XCOM 2 red tiles thread](https://steamcommunity.com/app/268500/discussions/0/3156453942263864020))
3. **Never change an NPC's behaviour without a visible signal and a visible cause.** This is Mark of the Ninja's
   "Transparent AI" rule: if a guard's behaviour changes, the player knows at once what set it off.
   → Every NPC wears a state badge, and a state change draws a line to its cause.
   ([Reinventing stealth in 2D](https://gamedeveloper.com/design/reinventing-stealth-in-2d-with-i-mark-of-the-ninja-i-))
4. **Show sound as a ring and preview it before the player acts.** Mark of the Ninja: "a spreading blue ring that
   says exactly how far that noise will reach." Players who usually dislike stealth enjoyed it because they could
   plan instead of reacting.
   → The brief's sound circle, previewed before the player confirms, with every NPC it reaches highlighted.
5. **What the player believes matters more than what is physically accurate.** Splinter Cell Blacklist halved the
   hearing of distant off-screen NPCs and "the game instantly became more fun". Players are bad at telling a smart
   AI from a simple one, and bad at noticing randomness (Game AI Pro 2 and 3).
   → No alerts from NPCs the player hasn't seen or been warned about. Prefer simple, visible rules over clever
   hidden ones.
6. **Hidden state in a crowd reads as noise.** Project Highrise cut its NPCs' hunger and tiredness because hidden
   needs made crowds unreadable: "the utility of detailed NPC representation is inversely proportional to the
   number of NPCs." Ready or Not's hidden morale is its most common complaint.
   → NPCs run on authored schedules plus visible states, not hidden needs or morale.

## 2. Stealth that bends instead of breaking

7. **Binary fail-on-detection is the genre's most hated stealth design.** Payday 2: one guard you lost track of
   ends a 20-minute run, so players restart until they get good spawns. Payday 3 fixed this with tiered zones:
   public (free), private (you're escorted out) and secure (shootout). Reviewers called its stealth the highlight.
   Phantom Doctrine was criticised because "nobody ever comes to investigate anything… none of the tension of a
   near-miss".
   → Zones are Public, Staff and Secure. Being caught in Staff gets you escorted out. Every escalation has steps.
   ([VGC: Payday 3 preview](https://www.videogameschronicle.com/features/preview-payday-3-wants-to-be-oceans-eleven-the-game/))
8. **The gear you carry should set who notices you.** In Payday 2, the concealment values of all your gear add up to
   your detection risk. Phantom Doctrine ties outfit tiers to restricted zones. Hitman keeps "enforcers" (the few
   NPCs who see through a disguise) a marked minority. Absolution, where everyone in the same outfit saw through
   you, made disguises "essentially useless".
   → A conspicuousness profile computed from the character's gear, crossed with the zone, gives a small published
   reaction matrix. Guards are the enforcers, and they are clearly marked.
9. **Add an in-between state, and make detection build up visibly.** In Shadow Tactics, a yellow fill creeps from
   the guard to you before you're detected. Mimimi chose it because it gave "cleaner feedback on when detection
   will happen". Critics of Phantom Doctrine asked for a "suspicious but not alerted" state.
   → Suspicion pips (0–3) per NPC per character, shown in the move preview ("+2, teller").
10. **Alarms should be carried by people and wires the player can intercept.** In Hitman, cameras feed a monitoring
    room whose staff dispatch guards. In Payday 2, a dead guard's pager must be answered, and panicking civilians
    run for a panic button, phone or exit. Harvey Smith called a scripted, unavoidable alarm in Deus Ex a failure
    that left players feeling "robbed".
    → An alarm happens only when a carrier finishes an action, with a visible countdown and at least two counters.
11. **Spotting per character works, but needs a rule for linking characters.** XCOM 2's squad-wide reveal works
    because XCOM has no social stealth. Payday tracks detection per player, so an unmasked player can keep
    blending in while the rest of the crew fights.
    → Each character is Exposed separately. A witness also exposes anyone they see cooperating with an Exposed
    character, and information spreads through radios and shouts.
12. **The stealth phase needs active goals and ways to mislead the AI.** Phantom Doctrine's infiltration
    "basically amounts to hovering around windows and doorways". Tom Francis's AI rule from Gunpoint: "you must be
    able to knowingly misdirect the AI".
    → The stealth phase is a checklist that pays off once the job goes loud (alarm panel, cameras, phones,
    keycards, doors), plus distraction tools with telegraphed effects.
13. **Silencing guards should be a resource, enforced by fiction rather than a bare number.** Payday's 4-pager cap
    keeps stealth from turning into "kill every guard", but players call the cap arbitrary.
    → Radio check-ins from the control room. The crew can answer only a limited number, and a missed check-in sends
    someone to look.

## 3. Pressure without a doom clock

14. **Timers are hated, and turtling is the alternative.** XCOM 2's mission timers drew wide backlash. The popular
    "True Concealment" mod starts the timer only once concealment breaks. Invisible Inc.'s per-turn alarm works but
    is called a "doom clock" that punishes exploring. With no pressure at all, players "overwatch-crawl".
    → No heat before the alarm; the bank's own schedule is the stealth clock. After the alarm, heat rises in large
    visible steps, each announcing what it brings.
    ([True Concealment discussion](https://steamcommunity.com/workshop/filedetails/discussion/618077830/412446292772464487))
15. **Escalation should change the situation, never end the mission.** Klei's first alarm design had 20–30 levels
    with random consequences and was unreadable. The shipped version uses 6 levels × 5 ticks with fixed effects per
    level.
    → 5 heat levels × 5 ticks, each level's contents published in advance.
16. **Police pressure needs a rhythm.** Payday alternates assaults and breaks, and players complain when the breaks
    "may as well not exist". Police who appear out of nowhere broke Payday: The Heist's immersion and made spawn
    triggers something to exploit.
    → Police arrive physically, from staging points announced a turn ahead, and cycle Contain → Negotiate →
    Assault → Regroup.
17. **Reward moving forward with the actions you want players to take.** Gears Tactics and Hard West 2 reward
    aggression with extra actions. BankHeist punishes killing, so its momentum rewards should go to control
    instead.
    → The takeover turn and crowd control give tempo; kills give heat.

## 4. Shooting you can read

18. **A displayed percentage is an emotional contract that randomness will break.** Jake Solomon: players read odds
    "from an emotional sense"; "that 85 percent isn't actually 85 percent". XCOM needed hidden aim assist and streak
    breakers to feel fair.
    → Show the cone and the expected hits, never a single percentage. No hidden assists.
    ([Solomon on randomness](https://www.gamedeveloper.com/design/jake-solomon-explains-the-careful-use-of-randomness-in-i-xcom-2-i-))
19. **Free aim is loved, but only if the simulation matches the picture.** Phoenix Point's two-circle reticle was
    praised. Bullets clipping railings that the UI showed as clear, and cover labelled "full" that let shots
    through, were its most common complaints.
    → Hit tests use tile-sized boxes, and nothing can stop a bullet that the preview didn't show stopping it.
20. **A per-bullet cover roll favours spray weapons.** With a 50% block per bullet, an 8-bullet SMG gets steady
    damage through cover, while a 2-bullet rifle swings between all and nothing. Phoenix Point's per-projectile
    armour is what makes many small bullets weak against armour.
    → Damage and Pierce per bullet against flat Armour, so every weapon class gets a job.
21. **Bound the variance and stack as few random layers as possible.** Independent random bullets still produce
    whole-burst misses. XCOM's hit roll × damage range × crit stack needed hidden fixes. Into the Breach removed
    nearly all randomness.
    → Bullets fan out evenly across the cone. The only random layers are where each bullet lands within its slice
    and the cover roll. Damage is fixed.
22. **Make concealment and threat weapon stats.** Payday 2 weapons carry Concealment and Threat values. That turns
    the gun locker into the choice between stealth and going loud, not just a damage race.
    → Each item has a Profile (conspicuousness) and Threat (command radius) alongside its combat stats.
23. **Everyone in the cone must be shown before the shot.** Fallout's invisible burst cones hit companions and
    bystanders, and players hated it.
    → Every body in the cone is highlighted (hostile, civilian, crew) with its expected hits.

## 5. Hostages and crowds

24. **A compliant person stays down; a hidden morale roll frustrates.** SWAT 4 deliberately changed SWAT 3's
    behaviour so that a compliant person "will NOT get back up". Players call Ready or Not's hidden morale
    unpredictable.
    → Ordinary civilians always comply with a command. Only marked archetypes can resist, and their chance is shown.
25. **Hostages need a benefit players can feel.** Payday 2 hostages delay assaults, but the benefit was applied to
    the wrong phase and barely noticeable, so players ignored hostages. Payday 3's negotiation trades hostages for
    time and items.
    → Each held hostage adds negotiation turns. Hostages can be released to cut heat or traded for an arrested crew
    member.
26. **Temporary control that needs re-applying turns into chores.** Re-shouting at 20 civilians every 2 turns with 4
    crew is upkeep. In Invisible Inc., an agent standing on a knocked-out guard keeps him down.
    → A Hold stance keeps commands from running out while the crowd stays in the character's sight and radius.
    Zip-ties are the limited, permanent option.
27. **Bigger events should drive bigger, ringed reactions.** In Hitman, drawing a gun makes people in the line of
    fire go prone, nearby people panic and people further out become alert.
    → A command has three rings: Command (gets down), Panic (picks a reaction) and the outer noise ring.
28. **Hidden random threats destroy trust in a game of perfect information.** Disguised insurgents among hostages
    work in Door Kickers 2 as a shock in a game about reacting fast, not in a stealth planner.
    → Armed civilians are rolled when the bank is generated, have tells, are found by frisking, and must spend a
    telegraphed turn drawing before they can shoot.

## 6. Sandbox freedom needs few, general rules

29. **General solutions beat special cases.** Spector's Deus Ex postmortem: "General solutions are better than
    special casing… more than one way past an obstacle, always." Smith: the game's successes came from flexible
    sub-systems, its failures from special-case scripting.
    → A closed vocabulary of object properties. Every tool is defined only by how it changes those properties.
    ([Deus Ex postmortem](https://www.gamedeveloper.com/design/postmortem-ion-storm-s-i-deus-ex-i-))
30. **Destruction needs a few clearly different material tiers.** Rainbow Six Siege: soft walls vs reinforced
    walls, and clean breach charges vs messy explosives. Teardown keeps indestructible objects few "to avoid
    confusion". If every wall breaks equally, layout stops mattering.
    → Four wall materials with distinct art, and a published tool × material table.
31. **Fortifications block sight and movement, not bullets, and each has a counter.** Siege barricades are cheap
    and unlimited; reinforcements are limited and permanent.
    → Barricades are unlimited but cost an action and leave bullets through. Reinforcement is limited and
    bulletproof. Police always breach somewhere else rather than waiting outside.
32. **Toys only matter if the AI has to deal with them.** Police who spawn from nowhere make traps and sniper nests
    pointless. Blacklist's guards answer unreachable perches out loud ("Forget it! Fall back!").
    → Police enter physically, and every exploit has an announced, plausible counter.
33. **Emergence needs elements that affect each other in ways other than killing.** Tom Francis's test: at least
    two non-player elements that interact beyond killing.
    → Police won't fire through hostages, panicking crowds block doorways, a power cut kills cameras and maglocks
    but starts a generator countdown, and so on.

## 7. Procedural banks people can plan

34. **Generate in three layers: an authored structure, authored rooms, random detail.** Spelunky has 8–16
    templates per room type. Enter the Gungeon has about 300 hand-made rooms for stage 1. XCOM 2 moved from
    hand-made maps to authored "plots and parcels" after complaints about repetition.
    → Bank archetypes and site plots, then hand-authored room parcels, then randomised props, staff and schedule.
35. **Use loops, not trees, and treat a key as anything that opens a lock.** Unexplored builds from 24 cycle types,
    and its keys can be items, people, knowledge or system states. Hitman's "Swiss cheese" maps have many ways in
    and out.
    → Every hard lock gets a social, a technical and a violent key. At least two loops run between public and
    secure space.
36. **Aim for variety players notice, and give every room a job.** Kate Compton: 10,000 unique bowls of oatmeal are
    still "a lot of oatmeal". Tom Francis: in Heat Signature only the cockpit mattered, while in Void Bastards
    every room does something.
    → Each bank gets one or two headline features. Every room type controls something the player can use.
    ([Void Bastards vs Heat Signature](https://www.pentadact.com/2021-07-30-void-bastards-vs-heat-signature-a-completely-objective-analysis/))
37. **Validate every seed.** Invisible Inc.'s random exits were sometimes "impossibly far". Payday's Murky Station
    stacked up to 8 guards in one place and set off chain-reaction alerts until it was capped at about 4.
    → Hard rules on reachability, routes and guard overlap. Seeds that fail are rejected.
38. **Real bank security is a ready-made set of locks, keys and timers.** Time locks, dual-control vaults, UL-608
    vault classes (15 to 120 minutes to breach), mantraps, silent foot-rail alarms and dye packs.
    → Vault classes set drill time. The time lock doubles as a schedule opportunity. Dual control turns two staff
    into key holders.
39. **Keep the space small enough to hold in your head.** Mark of the Ninja's rule: an encounter space about one
    screen plus a little more. Critics found some Hitman levels too big.
    → A small branch is about 2×2 screens of interior. The street is always at the bottom and the vault at the top.

## 8. Phones without mobile-game tropes

40. **Premium tactics sells on phones.** XCOM: Enemy Unknown on iOS scored 91 on Metacritic and was a top-grossing
    iPad release; XCOM 2 Collection scored 88, FTL on iPad 88. They share complete information, a small board,
    two-step input with undo, and sessions that can be interrupted.
41. **16px tiles at 320×180 are too small to tap.** A tile is about 6mm (about 35pt) on a 6.1" phone. Apple asks
    for 44pt and Google for 48dp (about 9mm).
    → An auto-zoomed "Act" camera, snapping to valid tiles, a magnifier for aiming, and a separate Confirm button.
42. **Undo removes the fear of experimenting; limited rewinds keep the tension.** Tactical Breach Wizards' free
    rewind removes "the fear of failure and mistakes". Klei added rewinds to Invisible Inc. after many runs were
    "spoiled… because of its low tolerance for even small mistakes".
    → Free undo until new information appears. Turn rewinds by difficulty, replaying the same random seed.
43. **Long enemy turns are the main pacing killer.** Jagged Alliance 3 players waited "up to a minute". XCOM 2: War
    of the Chosen added Zip Mode.
    → Groups move simultaneously, the camera visits only important events, there are speed settings and a skip,
    and a world phase should take 2 seconds when quiet and 5 when loud.
44. **The OS will kill the app, so the game must resume exactly.** Autosave after every committed action, and show
    a recap card on resume.

## 9. Campaign structure

45. **Snowballing is the main failure of squad campaigns.** Tom Francis on XCOM: "If you're finding the game easy,
    it gets easier." He used the same six soldiers on about 80% of missions.
    → Flat HP, contract-set crew sizes, and per-character Notoriety that makes veterans conspicuous and forces
    rotation.
    ([Solving XCOM's snowball problem](https://www.pentadact.com/2016-02-25-solving-xcoms-snowball-problem/))
46. **Reward each playstyle on its own terms instead of scoring everything against a silent run.** Francis on
    Hitman's rating, which pushes "save-scumming murder tourism".
    → Mission reports list Styles (Ghost, Inside Job, Cowboys, Clean Hands…), each paying once.
   ([Rewarding creative play styles in Hitman](https://www.pentadact.com/2016-05-14-rewarding-creative-play-styles-in-hitman/))
47. **Planning screens converge on dominant picks unless budgets and positions intervene.** Payday's Big Bank: the
    "Beast drill and bus are pretty much mandatory"; nobody used thermite.
    → Assets are placed on the generated map and capped by a favour budget, so the best pick changes with the
    layout.
48. **A campaign clock beats grind.** Examples: XCOM 2's Avatar Project, Invisible Inc.'s 72 hours, FTL's rebel
    fleet. Unlocks should add options, not raw power (FTL ships, Hitman starting locations). Payday 2's paid safe
    drills and withheld best gear drew backlash.
    → A federal investigation meter is the campaign clock. No grind gates, no prestige resets, no
    microtransactions.

---

## Where the research disagreed or stayed open

- **Is stratified spread too "gamey"?** It removes whole-burst misses, but some players want rawer simulation.
  Playtest it against independent spread with the same average.
- **Should the first bullet always fly down the aim line?** The critique suggested it, so that a burst at point
  blank never misses entirely. The design rejects it, because it would make Aim meaningless for single-shot weapons,
  and gets the same protection from stratified spread instead.
- **Plain circle or wall-aware sound?** A plain circle is easier to read; a ring that wall-aware flood fill clips
  makes doors and breaching matter. Every source agrees the preview must show exactly the tiles affected. The design
  uses the clipped ring.
- **Disguises.** Hitman shows they add a lot of social-stealth depth, but they add an enforcer layer the brief didn't
  ask for. The design keeps a light version (staff uniforms only) and marks it as cuttable.
- **Run-ending roguelite or persistent campaign?** The design picks a finite campaign with arrests instead of
  instant death and a carry-over veteran, and lists it as an open question for the director.
