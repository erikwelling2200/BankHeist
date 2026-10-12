# BankHeist: game design

**Status:** first full design, October 2026. **Audience:** whoever builds the game. This document says what the game
is, how it plays and how the world reacts, not how to implement it. **Basis:** a research pass over squad tactics,
heist games, immersive sims, turn-based stealth, aiming models, NPC/police AI, procedural generation, touch UX and
campaign structure. The findings, with their sources, are in [research.md](research.md). A reference such as [R14]
points to finding 14 there; [R4 in stealth-tactics notes] points to lesson 4 in that area's full notes under
[`research/`](research/).

All numbers are **starting values for playtesting**. The rules around them are the design.

---

## Contents

1. [Vision](#1-vision)
2. [How this design reads the brief](#2-how-this-design-reads-the-brief)
3. [A heist on one page](#3-a-heist-on-one-page)
4. [Vocabulary](#4-vocabulary)
5. [Structure of play](#5-structure-of-play)
6. [The turn](#6-the-turn)
7. [The crew](#7-the-crew)
8. [Stealth](#8-stealth)
9. [The alarm and the takeover](#9-the-alarm-and-the-takeover)
10. [Hostages and crowd control](#10-hostages-and-crowd-control)
11. [Combat](#11-combat)
12. [Weapons and equipment](#12-weapons-and-equipment)
13. [Police and heat](#13-police-and-heat)
14. [The sandbox: materials, tools, vehicles](#14-the-sandbox-materials-tools-vehicles)
15. [Loot, the vault and the escape](#15-loot-the-vault-and-the-escape)
16. [People of the bank](#16-people-of-the-bank)
17. [The procedural bank](#17-the-procedural-bank)
18. [Planning a heist](#18-planning-a-heist)
19. [The campaign: the road to The Big One](#19-the-campaign-the-road-to-the-big-one)
20. [Presentation and controls](#20-presentation-and-controls)
21. [Onboarding](#21-onboarding)
22. [Scope and build order](#22-scope-and-build-order)
23. [Director decisions and open questions](#23-director-decisions-and-open-questions)

---

## 1. Vision

**Pitch.** You run a heist crew. Case a procedurally generated bank while it goes about its day, then take it apart
your way: an unarmed inside man who quietly kills the alarm panel before the heavies walk in, a van through the front
glass, or a sniper on the roof across the street covering the drill. It plays in turns on a grid like XCOM. It is
about *control* like Payday: of people, doors and time. And any plan the rules allow will work, as in an immersive
sim. Every job builds toward one final score, The Big One, which you can attempt whenever you dare. Go too early and
you won't come back; wait too long and it closes in on you.

**The core fantasy is a heist film.** You scout, you plan, the plan runs, and then you improvise once it breaks.
The signature moment is a takeover turn you set up during stealth: four people act at once, and "Everybody down!" is
the plan working, not stealth failing.

**Stealth buys advantage; combat is expected.** Combat is a real and substantial part of the game, not a punishment
for failed stealth. Most heists end loud. What stealth decides is how well placed the crew is when they do: the alarm
panel dead, the operator tied, the guards down, the heavies in position. A heist with no combat at all is possible,
and a skilled crew might pull one off once or twice in a campaign, but it is a feat (the *Ghost* style), not the
expected way to play.

### Pillars

| # | Pillar | What it means in practice |
| --- | --- | --- |
| 1 | **The bank is clockwork you can read.** | Every person runs on a schedule, senses the world by fixed rules and shows what it will do next. You win by reading the bank and breaking it on purpose, not by out-rolling it. Perception is deterministic and always previewed. |
| 2 | **Your gear is your identity.** | One loadout sets how conspicuous you are, how many people you can command, how much noise you make and what you can kill. The gun locker *is* the choice between stealth and going loud. |
| 3 | **Control the bank, fight the police.** | Hostages, crowds, doors and the people who could raise the alarm are the real battlefield inside. Fighting the police is part of the job; harming civilians is the costliest thing the crew can do, and the simulation remembers it. |
| 4 | **One set of rules handles every approach.** | A small, closed set of object and NPC properties. Every tool is defined only through them, so a vent crawl, a breach charge and a rammed van are all valid and all predictable. No scripted special cases. |
| 5 | **Pressure escalates; it never just fails you.** | Getting spotted, the alarm, police waves and heat all change the situation in visible steps. Losing ground means fighting harder or leaving with less, rarely a game-over screen. |

### What it is not

- **Not a mobile game.** No energy, timers to wait out, ads, daily logins, gacha, loot boxes or currencies you buy.
  It is a one-time purchase. It runs on phones because turn-based tactics suits touch, not because the design was
  shrunk to fit a phone [R40].
- **Not a dice game.** Combat shows its spread as geometry and never shows a hit percentage. Stealth has no random
  rolls.
- **Not a puzzle with one answer.** Every hard obstacle has a social, a technical and a violent way past it.

### Tone

**Gritty, with Hotline Miami-style violence.** Pixel-scale but unflinching: bullet hits spatter, bodies and blood
pools stay where they fall, explosions scorch, and wounded people crawl and scream. Violence is fast, ugly and has
consequences that the simulation remembers.

**The arc of a heist** is the emotional design goal. The crew walks in confident and professional: clipped callouts
("Lobby's ours." "Panel's dead."), clean movement, masks on in unison. If the job drags on, it falls apart: wounded
crew limp and leave **blood trails**, barks turn desperate ("I'm hit, I'm hit!" "Don't leave me!"), heat climbs, and
it can end in a scramble back to the van where someone has to be left behind. The mechanics produce that arc on
their own (wounds §11.12, heat §13, arrest and leaving crew behind §15.4); the presentation leans into it with crew
barks and animations that change with wounds and heat level.

A **reduced gore** option exists for players who want it (§19.9). It changes the visuals only, never the rules.

---

## 2. How this design reads the brief

The brief is kept almost entirely. Where the research said a rule would hurt the fun as literally written, this
design sharpens it. Each change below is deliberate and can be reversed by the director.

| Brief | This design | Why |
| --- | --- | --- |
| Heat rises the longer the heist goes on. | Heat is **0 until the Alarm**, then rises by 1 tick per turn plus event spikes, in 5 announced levels. Before the alarm, the time pressure is the bank's own schedule, ending in a closing-time sweep. | Timers that start at mission start punish scouting and planning, which are half the game (XCOM 2's timer backlash, Invisible Inc.'s "doom clock") [R14]. |
| Cone aim with Aim, Recoil and Bullets. | Kept, plus **Damage, Pierce, Range, Threat, Noise, Profile** and a **moving penalty**. Each bullet lands at a **random point within its arc**: this replaces XCOM's hit chance (director's decision). | A 50% per-bullet cover roll otherwise makes spray weapons the answer to everything [R20]. The randomness stays visible as geometry: the player sees the arc the bullet can land in, never a percentage [R18]. |
| Cover gives a 50% block if it is right in front. | Kept for **half cover**, with an exact definition of "in front" (a 90° arc). **Full cover** (walls, pillars) blocks line of sight; attacking from a corner means **leaning out**, which leaves the shooter exposed until their next turn. | Cover has to be readable from one icon, and the icon has to match the hit logic exactly [R19]. |
| Floor shows where a character can go without raising alarms. | Kept as a **strict promise**: calculated per character, along the whole path, against what NPCs *will* do in their next phase, using the same rules as the real check. Three colours: safe, suspicious, spotted. | One wrong tile destroys trust in the whole stealth layer [R1, R2]. |
| Each character is spotted individually. | Kept. NPCs who know something is wrong become **Alerted** and read every crew member as **one profile more suspicious**, with wider vision; knowledge spreads physically (radio, shouts, people running to tell someone). | Without some link between characters, spotting each one separately becomes a string of easy ambushes, or guards ignoring the gunman next to their partner [R11]. An on-edge state is easier to show than a rule about who was seen with whom (director's suggestion). |
| Off-limits areas at the back. | Three zones: **Public, Staff, Secure**. Being caught in Staff gets you **challenged** on a first offence: walk back to Public by the end of your next turn (§8.6). Secure means instant exposure. | Being caught is never a game over, but a single sighting shouldn't instantly flip the whole bank from stealth to loud either. That all-or-nothing switch was Payday 2's most criticised stealth design; Payday 3's tiers fixed it [R7]. |
| Sound is a circle; anyone in it is alerted. | The circle is drawn **clipped by walls**: closed doors and soft walls take reach away, reinforced walls stop it. **Quiet** sounds make people curious; **loud** sounds alert them. | Closing a door and choosing a quiet route become decisions, and the preview stays exact [R4]. |
| A command keeps an NPC down for 2 turns. | Kept, plus a **Hold** stance that pauses the timer, and a **telegraphed lapse**: when the timer runs out, the NPC shows what it will do one turn before doing it. | Re-shouting at 20 people every 2 turns is a chore, and an NPC acting without warning is a gotcha [R26, R2]. |
| Release a commanded NPC to reduce heat. | Kept: −3 heat ticks, **at most once per turn and three times per heist**, and only at an exit the police control. The released hostage tells the police where they saw the crew. | Released hostages leave the map, so this is never infinite. But a busy bank holds 15–25 people, and at −3 ticks each that is 45–75 ticks: enough to hold heat at level 1 for the whole loud phase and remove the pressure. The cap keeps releases a tactical choice rather than a way to switch heat off [R25]. |
| Small chance an NPC is armed. | Armed civilians are **decided when the bank is generated** and look like everyone else. A **frisk** finds them, and they need one **telegraphed turn** to draw before they shoot. | They exist to make crowd control matter: any uncontrolled civilian might be the one who draws, and shooting him escalates the situation. The draw turn keeps it fair without giving him away beforehand (director's decision) [R28]. |
| (not in brief) | Added: **masks**, **disguises** (staff and guard uniforms, confirmed by the director), **Notoriety** per crew member, **radio check-ins**, **wounds and blood trails**, and a **takeover (GO) turn**. | Each one ties an existing system (conspicuousness, the alarm, heat) to the campaign or the core fantasy. |
| Campaign (director's answer) | A known final target, attempted whenever the player chooses. Money buys gear, prep missions give finale advantages, and **the Squeeze** adds accelerating complications as days pass (§19). | The tension between preparation and taking too long is the campaign's core decision. |

---

## 3. A heist on one page

*City branch (Mezzanine Watch archetype), mid-morning. Crew of four: Mara (Smooth Talker), Jun (Steady Hands,
carrying the hacking kit), Dex (Intimidating, Bruiser), Sol (Marksman). Contract target: $150k.*

**Planning.** The blueprint shows the lobby at the bottom, the staff corridor on the right, the CCTV room on a
mezzanine to the left and the vault at the top. The crew rents a room in the office tower across the alley for Sol,
with a DMR and a raised firing position (an upper-floor window) looking into the staff corridor windows. The van, with Dex inside in heavy armour carrying an
LMG, parks at the curb right of the entrance. The favour budget covers a stash duffel (shotgun) in the public
restroom and a cut phone line. The tooltip warns that dispatch will notice the dead line after 15 phases and send a
car to check. That is the crew's clock.

**Stealth (turns 1–13).** Mara walks in *Clean*; Jun, with a pistol under his jacket, walks in *Concealed*. The
floor overlay is green almost everywhere in the lobby for Mara. For Jun, the tiles near the guard are amber: "Guard:
frisk range (Concealed)". Jun keeps three tiles from the guard. Mara queues at a window. The timeline strip, filled
in as they watch, shows "Manager → lunch, turn 8" and "Cash cart to vault, turn 12". On turn 8 the manager leaves
and the staff door swings shut behind him. Jun drags a path to it. The overlay shows a hatched amber tile where the
cleaner's committed path will see him, so he waits one turn, then slips through. In the alarm closet he disables the
alarm panel (2 actions). The teller buttons and the operator's panel are now dead. The
cleaner mopping two tiles away stays calm: panel work is a quiet sound with radius 1, and the preview showed it
wouldn't reach her. On turn 13 Jun creeps up to the CCTV room. The operator has his back to the door: knockout,
zip-tie. With the operator gone, nobody calls the guards any more, but dispatch will notice the silence in 10
phases.

**Takeover (turn 14).** Mara stands next to the restroom. Dex's van door is 4 tiles from the glass entrance. Sol has
the corridor guard in her scope. **GO.** Everyone masks up and gets a third action. Dex moves 4 tiles in and shouts.
His LMG's Threat of 6, ×1.5 on a takeover turn, gives a command radius of 9: the whole lobby.
Eleven people drop with two-pip timers. The lobby guard was Calm when GO was pressed, so he is Surprised. His resist
chance shows 5% (halved, because Dex is Intimidating), and he complies. Mara grabs the shotgun from the duffel and commands the
tellers' row. Sol fires once through the corridor window and the corridor guard goes down. Nobody watched it live,
but the corridor camera recorded it, so Jun will want that recorder.

**The leak (turn 15).** One customer was in the restroom corridor, out of Dex's line of sight but inside the panic
ring. Her intent icon shows *Flee → front door, escapes in 2*. Mara steps into the doorway and the escape is
cancelled. Dex zip-ties the lobby guard. Then the dispatch car rolls past on the street. Nobody closed the blinds, and
its officers see masked figures through the glass: *Radio: 2*. Killing two police officers would bank +4 heat ticks
for the Alarm and start the shootout early, so the crew lets the call go through.

**Loud (turns 16–37).** **ALARM** at the end of turn 16: "Police in 6." Heat starts at level 1. The Class I vault
is dual-control with a time lock, and the codes won't open it until the armoured car at turn 30. That's too long, so
Jun sets the drill: 8 phases, 15% chance of a jam each phase. The crew barricades the front windows and leaves the
side door open as a choke point, with Dex on a Watch wedge covering it. Police arrive on turn 22, by which time heat
has passed level 2, so they bring the level 1 and level 2 units together. They contain for 3 turns, then the
negotiator calls: five hostages buy 7 turns of Negotiate (turns 25–31). The drill jams twice; Jun fixes it, and the
vault opens on turn 27. Heat 4 arrives on turn 31. A police sniper team is announced against the tower, so Sol
relocates. Assault, turns 32–37: SWAT breach the side door (announced a turn ahead) into Dex's wedge, and a
flashbang hits the lobby. A roadblock is announced for the right street end, the side nearest the van.

**Escape (turns 38–41, through Regroup and the next Negotiate).** The vault yields four heavy cash bags and a gold crate. Mara releases a
hostage at the front door (−3 ticks; the police learn Dex's position). Bags are thrown along a chain to the van, and
the gold crawls along on Dex's back. Jun takes the CCTV recorder. Mara drives the van out the long way, to the left.
Payout: $212k dirty. Style earned: *Inside Job*. Nobody was filmed unmasked doing anything illegal, and the recorder
is gone anyway, so nobody gains Notoriety.

---

## 4. Vocabulary

These words mean exactly one thing everywhere: UI, tutorial, code and this document [R19 in stealth-tactics notes].

| Term | Meaning |
| --- | --- |
| **Crew** | The player's characters. |
| **NPC** | Anyone else: civilians, staff, guards, police. |
| **Zone** | Public, Staff or Secure: the legal status of a floor tile. |
| **Profile** | How conspicuous a crew member looks: Clean, Concealed, Armed, Heavy. |
| **Suspicion** | 0–3 pips an NPC holds about one crew member. 3 = Exposed. |
| **Exposed** | That NPC knows that crew member is a criminal. Exposure is per NPC, per crew member. |
| **Alert / Alerted** | An NPC knows something is wrong and acts by role. An Alerted NPC is also **on edge**: it reads every crew member one profile higher and sees further (§8.7). It is local; it never means the police were called. |
| **Alarm** | A single event: the police have been called. Only an alarm carrier can raise it. |
| **Alarm carrier** | An NPC or device in the middle of raising the Alarm, always shown with a countdown. |
| **Loud** | The bank has heard a gunshot, explosion, shout or scream. Ends the chance to take over. |
| **Heat** | The police response level after the Alarm: levels 1–5, 5 ticks each. |
| **Notoriety** | Per crew member, carried between heists: how recognisable they are. |
| **Squeeze** | The campaign clock. It rises every day, faster as time goes on, and with messy jobs; each step adds a complication to the finale. |
| **Hurt** | A crew member at half HP or less: limping, bleeding and leaving a blood trail. |
| **Intent** | What an NPC will do in the next world phase, drawn on the map. |
| **Hostile** | An armed NPC that is fighting the crew: a guard who has confronted someone or been shot at, police on scene, an armed civilian who has drawn. Hostile NPCs can't be knocked out unless they are Surprised or Suppressed. |
| **Surprised** | Loses its next world phase (GO, flashbang). Lasts until the end of that world phase. |

---

## 5. Structure of play

```
Campaign (about 8–15 days, 5–10 h)
 └─ City map, one action per day: contract, prep mission, case, lay low; recruit and shop for free
     · The Big One can be launched on any day: the final, single attempt
     └─ Heist (20–40 min)
         ├─ Planning screen: starts, loadouts, positional assets, getaway spot
         ├─ Execution, one continuous turn-based map:
         │    Stealth ──(GO / accident)──► Loud ──► Escape
         │        └ the Alarm can fire at any point; heat ticks only after it
         └─ Debrief: payout, styles, notoriety, injuries, Squeeze
```

- A heist is one continuous map and one turn loop. "Stealth" and "loud" are states of the bank, not separate modes.
- Natural pause points (planning, GO, Alarm, police arrival, escape) double as chapter breaks for short phone
  sessions. The game saves after every committed action anyway (§20).

---

## 6. The turn

### 6.1 Order

1. **Crew phase.** The player moves crew in any order. Each crew member has **2 actions**. Actions can be
   interleaved between characters (Jun acts, then Mara, then Jun again).
2. **World phase.** NPCs resolve in a fixed order: **civilians → staff → guards → police → devices** (drills,
   generators, timers). Each group moves at the same time.
3. At the end of the world phase, every NPC **commits its next intent** (path, facing, action), and the next crew
   phase begins.

The turns are side-based, not interleaved, because the fantasy is a coordinated multi-person plan [R11 in
squad-tactics notes].

### 6.2 Perception timing (the rule that makes coordinated takedowns work)

> What NPCs witness during the crew phase is **recorded immediately** (suspicion, exposure, heard noises) and shown,
> but NPCs **act on it only in the world phase**.

So if Jun is seen, Mara can still drop the witness in the same crew phase, and the witness never acts. Two crew
taking down two guards in one turn is the basic stealth move, with no extra system needed. The only exceptions are
NPCs already Hostile and on a **Watch** wedge (§11.8), whose reaction arc is drawn.

The same holds in the other direction: **anything an NPC decides during a world phase** (a panic reaction, a new
exposure, a lapsed command's intent) **is shown during the next crew phase and carried out in the next world phase.**
No NPC ever acts on a decision the player hasn't had a crew phase to see. In a firefight this means NPCs announce
*what* they will do (raise the alarm, draw, breach, throw a grenade, hold a Watch angle); moving and shooting in a
firefight is decided when it happens and is not previewed (§13.6).

### 6.3 Actions

| Action | Cost | Notes |
| --- | --- | --- |
| Move | 1 | Up to 5 tiles (4 in heavy armour). Diagonals cost 1.5. Can't cut wall corners. |
| Dash | 2 | Up to 10 tiles. Quiet noise radius 2. Not allowed in heavy armour or carrying Heavy loot. |
| Attack | 1 | Most weapons. LMG and Suppress cost 2. A weapon's moving penalty applies if the character moved this turn. |
| Command ("Get down!") | 1 | Doesn't end the turn. See §10. |
| Hold | 1 | Must be the character's last action. Pauses commanded NPCs' timers (§10.3). |
| Watch | all remaining (min 1) | Drawn overwatch wedge (§11.8). |
| Zip-tie (includes frisk) | 1 | Adjacent. |
| Knockout (melee) | 1 | Adjacent, target not Hostile, or Hostile but Surprised or Suppressed. Quiet noise radius 2. |
| Interact | 1–2 | Doors, panels, consoles, lockpicks, loot. Some need a kit, and traits make some faster (§7.2). |
| Pick up / drop / throw bag | 1 | |
| Reload | 1 | |
| Swap weapon | free (once per turn) | Primary ↔ sidearm. |
| Melee strike | 1 | Adjacent, 3 damage, lethal. Quiet noise radius 2 (§11.11). |
| Pick up weapon / take ammo / hand over magazine | 1 | §11.11. |
| Gear up / stow | 1 | Take a long gun or armour out of a duffel, or put it back. Changes profile. |
| Mask up | 1 (free during GO) | Sets profile to Heavy. Masked crew gain no Notoriety from witnesses (§19.7). |
| Revive | 1 | Adjacent downed ally, back on their feet with 3 HP. |
| Flip table | 1 | Adjacent table or light desk becomes half cover (§11.4). Quiet noise radius 4. |
| Answer radio / phone | 1 | Radio check-ins (§8.11), police negotiator (§13.4). |
| Use throwable | 1 | Flashbang, smoke, noisemaker. |
| Place charge / place trap / detonate | 1 / 2 (Sapper 1) / free | Detonation happens in the crew phase, by whoever holds that charge's detonator (the placer, or the crew member chosen for a pre-placed charge), or by a trap trigger. |
| Brace (DMR or LMG) | 1 | Must be the last action. Counts as braced until the character moves: no moving penalty on the next turn. |

### 6.4 Time scale

One turn is about **10 seconds** of story time, which makes walking 10 tiles plausible. The bank's daily schedule is
**compressed**: "lunch at turn 8, armoured car at turn 20, closing at turn 45" is a game schedule, not a literal
clock. NPC schedules are written in turns.

### 6.5 Keeping quiet turns fast

- **Auto-advance.** While no NPC is Alerted, the player can drag a multi-turn route for each crew member, and the
  game plays turns until something interrupts: a new NPC or room revealed, an NPC's intent changes toward the crew,
  suspicion rises, a schedule event fires, or a unit arrives.
- **Wait for…** End turns until a chosen event: "until the manager leaves", "until the guard passes", "until the
  next schedule event".
- **Target:** no player should press End Turn more than twice in a row with nothing to decide.

### 6.6 Undo

- **Undo** is free for any action that revealed nothing new, triggered no perception check and rolled no dice. A
  move that changed nothing can always be taken back, so a mis-tap never costs a heist [R42].
- Everything else is final. There is **no turn rewind** and no manual save: the game autosaves after every
  committed action (§20.6), so a bad plan or an unlucky burst has to be played out.
- Every action is two-step: **preview, then confirm** (§20.2). Together with the exact previews, that is the
  protection against mistakes.

---

## 7. The crew

### 7.1 Base stats

Every crew member has **8 HP**, **2 actions** and **Move 5**. HP never grows with experience: armour is gear, not a
level. Crew differ by **traits**, **loadout** and **Notoriety** [R45].

### 7.2 Kits and traits

There are no classes. **What a crew member can do comes from what they carry** (pillar 2); **how well they do it
comes from who they are.** Any crew member can carry any kit, so a recognisable veteran can hand theirs to a fresh
face (§19.7).

**Equipment comes in three kinds**, told apart by the slot it uses (§7.3):

| Kind | Slot | What it is | Examples |
| --- | --- | --- | --- |
| **Weapons** | Primary, sidearm | Combat stats (§12.1). Some also have a **weapon action**. | Shotgun: **Breach** doors and locks. LMG: **Suppress** (§11.9). DMR and LMG: **Brace** on a bipod (§6.3). |
| **Kits** | Gadget | Reusable tools that unlock non-combat actions. | Hacking kit, lockpick set, glass cutter, drill. |
| **Consumables** | Gadget | Used up when used. | Breach and shaped charges, thermite, flashbangs, smoke, noisemakers, tripwires, medkits. |

What the kits unlock:

| Kit | Unlocks |
| --- | --- |
| **Hacking kit** | Loop a camera feed for 4 phases (at a junction box or the console). Disable the alarm panel or a vault sensor (4 actions). Pull the code or time-lock schedule from the manager's PC (2 actions). Ring any desk phone remotely. |
| **Lockpick set** | Open mechanical locks and deposit boxes (2 actions). |
| **Glass cutter** | Cut a quiet 1-tile hole in a window (2 actions). |
| **Drill** | Drill a vault door, safe or deposit-box wall (§15.3). |

**Traits** belong to the person. A recruit comes with **one** trait; the player picks another from three offered
for every two jobs that crew member survives. Traits make a crew member better with certain gear or situations; they
never unlock an action that gear doesn't.

| Trait | Effect |
| --- | --- |
| **Steady Hands** | Lockpicking, hacking and panel work take half the actions (at least 1). Fixes a jammed drill for free when adjacent at the start of the crew phase. |
| **Smooth Talker** | Once per heist, talk an NPC from 2 pips down to 0, or talk off a trespass challenge without being Warned. +1 answered radio check-in per heist. Can **bribe** (1 action). |
| **Intimidating** | Resisters roll at half their chance against this crew member's commands. |
| **Bruiser** | Carries Very Heavy loot at −1 move instead of half movement. |
| **Marksman** | Recoil halved while braced. Watch wedges can be 10° narrower. |
| **Sapper** | Placing a charge or trap takes 1 action less (at least 1). Carries +2 charges. |
| **Wheelman** | Drives twice as far per action. Rams and runs police blocks without the vehicle taking damage. One free vehicle move per heist. |
| **Medic** | Revives to 6 HP instead of 3, and a medkit heals 6 instead of 4. |
| **Forgettable** | Notoriety gains are halved (rounded down). |
| **Cool Head** | No aim penalty while Hurt (§11.12). |

A contract sets the crew size: 2 to 5, usually 4 [R45]. Personality and recognisability come from portraits, names,
personal motives and barks rather than from a class.

### 7.3 Loadout

| Slot | Contents |
| --- | --- |
| Primary | Long gun, or nothing. |
| Sidearm | Pistol, machine pistol or taser, or nothing. |
| Armour | None, light vest, medium or heavy. |
| Gadgets ×2 | Kits (hacking kit, lockpick set, glass cutter, drill), consumables (charges, thermite, throwables, tripwires, medkits, ammo bag), the jammer or the duffel. |
| Fixed | Zip-ties ×4, phone, mask, police scanner (§8.15). |

A **duffel** (gadget) holds one long gun and one armour piece, and shows as Concealed. *Gear up* takes them out
(1 action): the stash-in-the-restroom fantasy.

### 7.4 Profile

**A crew member's profile is their most conspicuous visible item**, raised by Notoriety (§19.7).

| Profile | Visible items |
| --- | --- |
| **Clean** | Nothing visible. Unarmed, taser, zip-ties, small tools, phone. A staff uniform counts as Clean. |
| **Concealed** | Pistol or machine pistol under a jacket, light vest, closed duffel, a DMR in a case. |
| **Armed** | Any visible long gun, medium armour, a carried loot bag, a visible drill, carrying a body. |
| **Heavy** | Mask on, LMG, heavy armour. |

The profile icon sits on each crew portrait and updates the moment the loadout changes. So does the safe-floor
overlay: holstering a weapon, stowing armour or dropping a bag is a visible stealth decision [R8].

---

## 8. Stealth

### 8.1 Zones

| Zone | Typical rooms | Floor art |
| --- | --- | --- |
| **Public** | Street, lobby, teller queue, ATM vestibule, restrooms, waiting area | Carpet, tile |
| **Staff** | Behind the counter, offices, staff corridor, break room, cleaner's closet | Linoleum |
| **Secure** | CCTV room, vault antechamber, vault, cash room, server/alarm closet | Bare concrete, steel plate |

Zones are drawn into the floor material, so the art carries the rule, and the zone overlay can be toggled on.

### 8.2 Who notices

| Observer class | Who | Notes |
| --- | --- | --- |
| **Civilians** | Customers, visitors | Care only about Armed and Heavy, and about violence. |
| **Staff** | Tellers, manager, cleaner, IT tech, CCTV operator in person | Care about the Staff zone and about Concealed items in it. |
| **Enforcers** | Guards, security chief, cameras (through the operator), police | The strictest observers. Marked with a small badge, so it's never a guess who matters [R8]. |

### 8.3 Vision

- NPCs see a **Core** arc (6 tiles, 90°) and a **Peripheral** arc (8 tiles, 140°, including Core). **Alerted** NPCs see
  further and treat Peripheral as Core (§8.7). Walls,
  full-height objects and closed doors block sight. Glass doesn't. An observer on a **raised tile** also sees over
  low objects (§14.7).
- **Cameras** have Core only (7 tiles, 70°). They are either fixed or panning; a panning camera alternates between
  two facings each world phase, and its next facing is telegraphed.
- **Darkness** (power cut, unlit rooms) halves all vision ranges. Cameras below Regional HQ tier go blind in the
  dark.
- Day to day, the player sees the combined **safe-floor overlay** for the selected crew member, not raw cones.
  Long-pressing an NPC shows its cones on their own (solid for Core, dotted for Peripheral) [R4 in stealth-tactics
  notes].

### 8.4 The reaction matrix (canonical)

Each cell is what happens when that observer sees a crew member of that profile in that zone, in **Core** view.
**Peripheral** view is one step weaker (! → +2, +2 → +1, +1 → nothing).

`—` nothing · `+1`/`+2` suspicion pips · `!` instantly Exposed · `T` trespass (§8.6)

**Public zone**

| Profile | Civilian | Staff | Enforcer |
| --- | --- | --- | --- |
| Clean | — | — | — |
| Concealed | — | — | +1, only within 2 tiles (frisk range) |
| Armed | +2 | +2 | ! |
| Heavy | ! | ! | ! |

**Staff zone**

| Profile | Civilian | Staff | Enforcer |
| --- | --- | --- | --- |
| Clean, no uniform | — | T | T |
| Clean, staff uniform | — | — | — (Manager and Security Chief: T) |
| Concealed | — | +2 | ! |
| Armed / Heavy | ! | ! | ! |

**Secure zone:** any crew member seen by staff or an enforcer is `!`. A staff uniform doesn't help here.

**Cameras** register only `!` cells (in their Core) and major evidence. They never build suspicion pips.

**Illegal acts** are `!` for any observer who sees them, in any zone, **in Peripheral view too**: lockpicking, hacking, zip-tying, commanding,
attacking, knockouts, dragging a body, breaching, drilling, planting charges, putting on a mask, taking loot from a
drawer or box, picking a pocket.

### 8.5 Suspicion pips

- Each NPC holds 0–3 pips **per crew member**, shown above its head in that crew member's colour.
- **When pips are added:** each time a crew member *ends an action* in an NPC's view (crew phase), and once per world
  phase for each NPC that sees the crew member at any point while moving along its committed path. Each check adds
  the matrix value.
- **Moving through view:** passing through tiles in the middle of a move only matters for `!` cells. You can hurry
  past a curious teller; you can't walk a rifle past a guard.
- **Decay:** −1 pip per world phase in which that NPC did not see that crew member.
- **Effects:**
  - **1 pip, Curious:** the NPC turns to face the crew member next phase (its new facing is telegraphed).
  - **2 pips, Investigating:** the NPC walks toward the crew member or their last known tile (path telegraphed). An
    enforcer reaching an adjacent tile **frisks**: any Concealed item makes the crew member Exposed.
  - **3 pips, Exposed** (§8.7).
- The move preview shows exactly what a move will cost: "+2 (teller)", "! (guard)".

### 8.6 Trespass: the challenge

The player never loses control of a crew member. An "escort" in a turn-based game is a **challenge with a deadline**,
not a forced move. When a Clean crew member is seen in the Staff zone by staff or an enforcer:

1. **Challenge** (the moment they are seen): "Hey, you can't be back here." The crew member gets a **Challenged**
   marker showing the challenger and an arrow to the nearest Public tile. Nothing else happens yet.
2. **Next world phase:** the challenger walks toward the crew member (telegraphed path) and keeps watching them.
3. **Next crew phase, the deadline:** the crew member must **end this crew phase on a Public tile**. They walk out
   themselves, using their normal actions.
   - **They comply:** the challenger follows them to the boundary, watches for one more world phase, then returns to
     its routine. The crew member is **Warned** by that NPC for the rest of the heist (an icon over the NPC; it isn't
     suspicion and doesn't make the NPC follow them).
   - **They don't** (still in Staff, hiding out of sight, or going deeper): they are **Exposed** to the challenger,
     who reacts by role (§16.2).
   - **Another way out:** a Smooth Talker can talk the challenger off once per heist (§7.2). Teammates can also deal with the
     challenger before the deadline (knockout, command), which is an illegal act if anyone else sees it.
4. **Second offence by a Warned crew member,** seen by an NPC who warned them or by any enforcer: Exposed, with no
   challenge.

A mistake costs a turn and position, not the heist [R7]. It can also be used on purpose: a challenged crew member
pulls the challenger toward the lobby, and while it follows them, a teammate slips through the staff door behind its
back.

### 8.7 Exposure and how knowledge spreads

When an NPC reaches 3 pips on a crew member, **only that NPC knows**. The crew member's portrait shows "Exposed to:
teller K." The NPC reacts by role (§16.2) in the next world phase, and most reactions spread the knowledge
physically:

- **Radio** (guards, operator): a telegraphed action that makes all guards and the operator Alerted and Exposes the
  described crew member to them.
- **Shout or scream:** a loud noise; anyone hearing it becomes Alerted with *cause unknown*.
- **Telling someone:** a civilian or staff member walks to a guard (path shown, interceptable).

**On edge: what an Alerted NPC sees.** Instead of a rule about who was seen with whom, every NPC that knows
something is wrong becomes **Alerted**, and an Alerted NPC is **on edge** toward *everyone*:

- it reads every crew member **one profile higher** (Clean as Concealed, Concealed as Armed, Armed as Heavy);
- its **Peripheral view counts as Core**, and both reach 2 tiles further (Core 8, Peripheral 10);
- it stays Alerted for the rest of the heist (guards and staff), or until it is Commanded or tied (civilians).

An NPC becomes Alerted when it Exposes a crew member, sees violence, hears a loud noise, finds major evidence,
hears a shout, or receives a radio call. Exposure itself stays strictly per crew member: being Alerted only makes the
NPC quicker to Expose the *next* one.

What this does in play: once the guard has seen the gunman, the unarmed inside man standing next to him isn't
automatically burned, but he can no longer walk up to that guard. A pistol under his jacket now reads as a drawn
weapon. The player sees it at once: Alerted NPCs wear a red `!` badge, their cones are drawn red and wider, and the
safe-floor overlay of every crew member shrinks around them.

**Eyes down.** Commanded and tied NPCs are face down: they don't build suspicion or Expose anyone while they stay that
way.

**Exposure is permanent.** Once an NPC has Exposed a crew member, it stays that way for the rest of the heist: no
change of clothes or hiding spot undoes it. The only way to contain it is to deal with the witness before they act
or spread it (§6.2). Escalation is meant to happen; stealth decides how much advantage the crew has when it does.

**Once loud,** an unexposed Clean crew member counts as a civilian to staff and police. Since everyone is now
Alerted, that only holds at a distance: within 2 tiles of an enforcer they read as Concealed and get frisked. Police
may even order them to get down. The inside man can stay inside, but has to keep his distance [R11].

### 8.8 The safe-floor overlay (the promise)

When a crew member is selected, every reachable tile is tinted:

| Tint | Meaning |
| --- | --- |
| **Green** | Safe: no NPC's suspicion changes. |
| **Amber** (+ pip count) | Someone gains suspicion, or a trespass warning. |
| **Red** (eye icon) | Someone Exposes this crew member. |
| **Hatched** version of amber or red | The same outcome, but it happens during the coming world phase as NPCs walk their committed paths. |
| **Red with a camera icon** | A camera would see a `!` and start the operator's verify carrier. Cameras whose feed status is unknown (CCTV room not scouted) count as live. |
| **Grey** | No data: unscouted area. **Never drawn as safe.** |
| **Hatched grey** | Unknown risk: the tile can be seen from unscouted space, so an NPC the crew doesn't know about could be watching it (§8.15). |

Rules:

- It is calculated **per crew member** for their current profile, **along the whole drawn path** (the first unsafe
  tile gets an eye icon, so the player can stop one tile short), and **against committed NPC intents**.
- Long-press any amber or red tile to see **who** notices and **why**: the NPC's portrait, a sightline, and
  "Guard: sees Armed".
- When a crew action changes an NPC's intent (a noise draws a guard), that NPC's arrow is redrawn on the spot and
  every overlay updates.
- **It must use exactly the same rules as the real perception check.** The promise covers every NPC the crew knows
  about (§8.15): a tile shown as safe that gets a crew member spotted by a known NPC is a critical bug. Automated tests should replay large numbers of random moves and
  compare the preview against the outcome.

### 8.9 Sound

Every action that makes noise previews its ring before it is confirmed. Every NPC inside gets an ear icon, labelled
with the state it will move to.

**How sound spreads.** Sound spreads outward through open tiles, like water. Each **closed door** or **Soft wall** it
passes through costs 3 tiles of reach. **Reinforced and Vault walls stop it.** Open doors, broken walls and holes
cost nothing. The ring is drawn as exactly the tiles it reaches.

**Two kinds of noise:**

- **Quiet:** NPCs who hear it become Curious. One NPC investigates (walks to the source); the others look.
- **Loud:** NPCs who hear it become **Alerted, cause unknown**. Civilians panic, staff go for alarms or hide, guards
  investigate aggressively and radio in (an alarm carrier). Any loud noise makes the bank **Loud**.

Nobody is ever Exposed by sound alone: sound makes NPCs look, and looking can expose.

| Source | Radius (tiles) | Kind |
| --- | --- | --- |
| Walk | 0 | — |
| Dash | 2 | Quiet |
| Lockpick, zip-tie, glass cutter, panel work | 1 | Quiet |
| Knockout, taser, radio buzz | 2–3 | Quiet |
| Noisemaker (thrown) | 3 at the landing tile | Quiet |
| Suppressed pistol | 3 | Quiet |
| Suppressed SMG | 4 | Quiet |
| Command shout | Command radius + 3 | Loud |
| Scream (panicked NPC) | 6 | Loud |
| Pistol | 8 | Loud |
| Machine pistol, SMG | 9–10 | Loud |
| Shotgun | 12 | Loud |
| Assault rifle | 14 | Loud |
| DMR, LMG, breach charge | 14–18 | Loud |
| Shaped charge | 18 | Loud |
| Vehicle ram | 16 | Loud |
| Drill (each world phase) | 6 | Loud |
| Thermite (each world phase) | 6 | Loud |

### 8.10 Evidence

NPCs react to things that have changed, not just to people [R6 in npcs-hostages-police notes]:

- **Minor evidence:** a Secure door left open, an empty teller window during opening hours, a camera that stopped
  transmitting, lights out, a missing colleague. The NPC becomes Curious and one NPC investigates. If they find
  nothing major, they go back to routine.
- **Major evidence:** a body or knocked-out person, a zip-tied person, a hole in a wall, a drill, an unattended loot
  bag, a weapon on the floor, blood. The NPC becomes **Alerted** and reports: guards radio (an alarm carrier),
  others go to tell a guard.
- Bodies can be **dragged** (Very Heavy carry) and **stashed** in closets and dumpsters (1 action). Stashed bodies
  are not evidence.
- **First-time barks** name the cause ("Was the vault corridor door open before?"); later ones are generic ("Huh?").
  This teaches the evidence system without tutorial pop-ups.

### 8.11 Radio check-ins

The fiction-driven version of Payday's pager limit [R13]:

- The CCTV operator calls each guard every **6 world phases**. Calls are staggered, and each guard's next call shows
  on its tag.
- If the guard is down, the radio **buzzes** (quiet noise, radius 3). A crew member adjacent to the guard can
  **answer** (1 action). Each heist allows **2 answers** (+1 per Smooth Talker in the crew).
- **Unanswered:** the operator sends the nearest guard to the missing guard's post (an investigation). A second
  missed call, 6 phases later, makes the operator **call dispatch**: an alarm carrier with a 2-phase countdown.
- **Operator gone:** the calls stop, but dispatch notices the silence after 10 world phases and sends a **patrol car
  drive-by** (§16.4).
- **Banks without an operator** (small branches): guards check in with dispatch directly every 8 phases, with the
  same rules.

### 8.12 Cameras and the CCTV room

- Cameras report only through a **present, attentive operator**. The operator has fewer monitors than there are
  cameras (for example 4 screens cycling 8 cameras). Which feeds are live this turn is shown once the CCTV room has
  been scouted.
- A live camera that sees a `!` makes the operator **verify** (alarm carrier, countdown 2). A camera that sees major
  evidence makes the operator send a guard.
- **Counters:** stay out of the cones; loop a feed (hacking kit, 4 phases); cut the power; shoot the camera (a dead camera
  is minor evidence, and a guard is sent); neutralise the operator.
- **Footage.** The recorder in the CCTV room stores what live or recording cameras saw. Unmasked crew recorded doing
  illegal acts gain Notoriety at the debrief **unless the recorder is destroyed or taken** (1 action at the
  recorder).

### 8.13 Distractions

Misdirection must be reliable, so the player can deliberately pull a specific NPC to a known tile [R12]:

- **Noisemaker** (coin, phone alarm): a quiet sound at the landing tile. The nearest NPC investigates it for 2
  phases, then goes back.
- **Ring a desk phone** (from any phone, or remotely with a hacking kit): the NPC who owns that desk walks to answer, about 2 phases.
- **Power cut** at the breaker (electrical closet, 1 action): lights out (vision halved), cameras off, staff door
  maglocks release. Minor evidence bank-wide, and a guard goes to the electrical closet (intent shown). The backup
  generator restores power after 3 phases unless it is also disabled (1 action at the generator).
- **(v2) Fire alarm:** the bank evacuates to the street and the fire department arrives in 8 turns (more
  witnesses). It empties the bank but brings eyes.

### 8.14 Disguises

Disguises (confirmed by the director) are clothing. They replace the crew member's look but not their gear, so the
profile rules still apply to anything visible on top. A disguised crew member's portrait shows the uniform.

| Uniform | Source | Effect | Seen through by |
| --- | --- | --- | --- |
| **Staff** | Break room at shift change, the Staff uniforms asset, an insider | The Staff zone counts as Public. | The manager and the security chief (in Core view): trespass. |
| **Guard** | Taken from a knocked-out or tied guard: 2 actions, adjacent, out of everyone's sight | The Staff zone counts as Public. In the Secure zone, staff give +1 instead of `!`, and cameras ignore them. A holstered pistol counts as Clean. | Any guard within 2 tiles in Core view ("You're not Dave."): `!`. The security chief at any range in Core view. |
| **Courier** | The *Hijack an armoured truck* prep mission (finale only) | Enter the loading bay during the transfer as couriers. | As guard. |

- **Changing** into a uniform takes 2 actions and must happen out of every NPC's sight. The stripped guard left
  behind is major evidence (§8.10).
- **Armour above a light vest, long guns, loot bags and masks break the disguise:** profile is computed normally.
- A disguise prevents exposure; it never undoes it (§8.7).

### 8.15 What the crew sees

The player sees the bank through the crew's eyes. This holds in stealth and in a firefight.

- **Crew vision:** each crew member sees all around them up to 10 tiles. Walls, full-height objects and closed doors
  block it, and darkness halves it.
- **Live NPCs:** an NPC is shown live only while at least one crew member can see it.
- **Fading ghosts:** an NPC that leaves view stays on the map as a faded ghost at its last-seen position, labelled
  "seen 1 turn ago", for **2 turns**, then disappears. Ghosts are only for NPCs without a known routine (mostly
  police and Alerted guards). They answer "where did I just see him?", not "where is he now?". *Playtest whether
  they stay (§23).*
- **Known routines:** an NPC watched for long enough during stealth (3 turns in view, or revealed by the Guard rota
  asset) has its schedule tagged. Because routines are deterministic in stealth, the game shows where it should be
  even out of sight, as a dashed **predicted marker** with its route. Tagged NPCs count toward the safe-floor overlay
  like visible ones. If something knocks a tagged NPC off its routine (a noise, evidence, the alarm), its prediction
  stops and it becomes a ghost.
- **Unknown NPCs** are not shown at all. Tiles that could be seen from unscouted space get the hatched "unknown risk"
  pattern in the overlay (§8.8).
- **Cameras:** with the CCTV room under control (operator neutralised and a crew member at the console), the player
  also sees what every live camera sees. Looped feeds show nothing.
- **Sound pings:** loud noises within a crew member's hearing (gunfire, breaching, a scream, police running in) show
  as a ping at their source, even out of sight. Quiet noises don't.
- **Police scanner:** every crew member carries one. It is why police **commitments** (breach markers, grenade and gas
  targets, Watch wedges, sniper lanes) are always shown, even out of sight (§13.6). Police positions are not: out of
  sight, police are only ghosts and sound pings.

---

## 9. The alarm and the takeover

### 9.1 Alarm carriers (canonical)

**The Alarm is raised only when an alarm carrier finishes its action.** Every carrier shows its countdown in world
phases, and the minimum is **2**, so there is always at least one full crew phase to respond. Every carrier has at
least two counters that still work once its countdown is running.

| Carrier | Starts when | Countdown | Counters |
| --- | --- | --- | --- |
| **Teller silent alarm** (foot rail or button) | A teller is Alerted at their station | 2 (away from station: path + 1) | Command, knock out, zip-tie, block the path, **disable the alarm panel**, inside man |
| **Manager's desk button** | Manager Alerted in the office | 2 | As above |
| **Guard radio** | A guard is Alerted (confronting, finding evidence, hearing gunfire) | 2 (draws and takes cover, then calls) | Kill, knock out, command (resist chance), **jammer** |
| **Operator verifies camera** | A live camera sees a `!` | 2 | Neutralise the operator, **disable the alarm panel** |
| **Phone call** (landline or mobile) | A panicked civilian or staff member hides out of crew sight | 2 | Command, find them, **cut the phone line** (landlines), **jammer** (mobiles) |
| **Escapee** | A civilian (or passer-by) flees toward the plot edge | max(2, path length in phases) | Block the route, command, barricade, tackle (adjacent, 1 action), park a vehicle across their lane |
| **Missed check-in** | Second unanswered radio call | 2 | Neutralise the operator, jammer in range of the CCTV room |
| **Vault seismic sensor** (Class II+) | Drilling or thermite starts | Shown before drilling (for example 4) | Disable the sensor at the vault wiring box with a hacking kit (also during the countdown), disable the alarm panel |
| **Vault motion sensor** (Class III) | Movement inside the vault | 2 | Disable at the wiring box, time-lock window |
| **Passing patrol car** | Its officers see a `!`, major evidence, or hear a loud noise from the street | 2 | Jammer in range, take both officers down (they resist like guards; killing them banks heat for when the alarm fires, §13.2). Prevent it beforehand with blinds, barricades, closed doors and timing. |
| **Dispatch: lost contact** | Jammer running, operator silent for 10 phases, or the cut phone line noticed (15 phases) | Sends a patrol drive-by (not the Alarm itself) | Finish first, or hide the evidence from the street |

**The alarm panel** (electrical or alarm closet, Secure zone) is the heart of the inside job. Disabling it (hacking kit, 4
actions; 2 with Steady Hands) kills every **wired** carrier: teller buttons, the manager's button, the operator's panel and the
vault sensors. What is left are people with radios, phones and legs.

### 9.2 What the Alarm does

- **It is silent.** The police are coming, but the people inside who don't already know stay as they are. "Police in
  N" appears in the HUD (N by bank tier: small branch 8, city 6, HQ 4).
- **Heat starts:** Heat 1, tick 0 (§13). Kills witnessed earlier add their ticks now.
- When the first police vehicle arrives, its sirens are a **loud event across the whole bank**.

### 9.3 Going loud: the takeover turn (GO)

- **GO** is a crew action available **once per heist, while the bank is not yet Loud**. It turns the current crew
  phase into the takeover turn:
  - every crew member masks up for free and gets **+1 action this turn**;
  - Command radius ×1.5 this turn;
  - every NPC that was **Calm or Curious when GO was pressed** is **Surprised**: it loses its next world phase, and
    surprised civilians count as Commanded for one phase.
- GO is how "inside man first, heavies later" pays off. The setup in stealth (crew positioned, operator tied, alarm
  panel dead) turns into one decisive turn [R3 in squad-tactics notes].
- The bank can also go Loud by accident: a gunshot, a scream, a breach. Then there is no takeover bonus, but nothing
  else is lost. The carriers still need their countdowns.

---

## 10. Hostages and crowd control

### 10.1 The command: three rings

**Command ("Get down!")** costs 1 action and doesn't end the turn. It is an illegal act.

| Ring | Radius | Effect |
| --- | --- | --- |
| **Command** | The weapon's **Threat** (in line of sight; ×1.5 on GO) | Ordinary NPCs **always comply**: Commanded, 2 pips. Resisters roll their shown chance (§10.4). **Hostile NPCs and NPCs reaching for a weapon ignore commands**: an escalated situation can only be subdued or shot. |
| **Panic** | The shout's noise radius (the final command radius + 3), outside the Command ring or out of line of sight | Civilians **panic** and pick a reaction (shown as intent). Staff and guards become **Alerted**, and the ones who can become carriers do. |
| **Noise** | Same as panic | It is a loud noise: the bank is now Loud. |

A bigger gun controls more people but also scares more people just beyond its reach [R27].

### 10.2 Commanded state

- A Commanded NPC lies down and **doesn't act**. It shows **2 pips**, and loses 1 at the end of each world phase.
- **Re-commanding** refreshes it to 2.
- People lying down are below the line of fire: **stray bullets pass over prone and commanded bodies**. Explosions
  still hurt them. Commanding people also protects them. Someone lying down can still be **shot on purpose** (§11.3).

### 10.3 Hold

A crew member who ends their turn with **Hold** (1 action, their last) pauses the pip loss of every Commanded NPC
within their Threat radius and line of sight. One crew member can hold a room while the others work [R26].

### 10.4 Resisters

Guards, the security chief and the rare *hero* can resist. Their chance is shown before you commit. Armed civilians
comply like any other customer, so a command never gives them away (§10.9).

| Situation | Resist chance |
| --- | --- |
| Alone against one crew member's command | 40% |
| 2+ crew within Threat radius aiming at them, or Surprised, or flashbanged | 10% |
| Commanded by an Intimidating crew member | Half the chance |

A resister who resists acts in the world phase: draws, radios, runs. Zip-tying is the reliable answer.

### 10.5 When a command runs out (telegraphed)

When a Commanded NPC's pips reach 0 at the end of a world phase, it becomes **Twitchy**. Its next intent is rolled
**then** and shown during the crew phase, so the player always gets a turn to answer:

- *Stay down* (cowed)
- *Flee → exit* (escapee carrier, path shown)
- *Go for alarm or phone* (staff only, carrier)
- *Reach for weapon* (armed NPCs only)
- *Tackle* (heroes only, if adjacent to crew)

The odds come from the archetype (§16.2), shifted toward fleeing once police are outside. A lapsed command never
silently resets an NPC to Calm.

### 10.6 Zip-ties and frisking

- **Zip-tie:** 1 action, adjacent, on a Commanded, Surprised, knocked-out or compliant NPC. 4 per crew member (more
  with a perk or asset).
- A tied NPC never acts. **It can be freed** by a free NPC spending 2 phases adjacent, or by police (1 action).
- **Tying includes a frisk.** Hidden weapons are found and removed, and so are keycards, which can be taken.
- **Escort:** a crew member can lead one tied or Commanded hostage, at half movement.

### 10.7 What hostages are for

Hostages are a resource with exchange rates the player can see [R25]:

| Use | Effect |
| --- | --- |
| **Negotiation** | Each living hostage (Commanded or tied, inside) adds +1 turn to the police Negotiate phase, up to +6. The HUD shows it: "Negotiate: 7 turns (+5 hostages)". |
| **Release** | Walk a hostage out an exit the police control: **−3 heat ticks**. At most one release per turn and three per heist. The released hostage tells the police which crew they saw and where. |
| **Trade** | During Negotiate, release a hostage to get back one **arrested** crew member at that exit, at the start of the next crew phase. |
| **Shield** | Police **never fire a shot whose preview would hit a standing non-crew body** (hostages lying down are below the line of fire and don't count). An escorted hostage held in front of a crew member is a real shield; police reposition or use flashbangs and gas. Hostages standing at windows deter snipers. |
| **Keys** | Key-holding staff (manager, head teller) can be **coerced** at the vault console (1 action each, adjacent, Commanded or tied). |
| **Cash drawers** | A Commanded or tied teller can be made to open their drawer (Light loot). |

### 10.8 Panic

- Seeing violence, or hearing a loud noise outside a command ring, makes a civilian **Panicked**. In the next world
  phase, panic spreads to civilians within 3 tiles who can see them. Newly panicked NPCs pick their reaction then and
  carry it out a world phase later (§6.2), so a hero never tackles without warning.
- Each panicked NPC picks a reaction weighted by archetype (§16.2): **Cower** (stays put, easy to command), **Flee**
  (escapee), **Hide** (under a desk or in a restroom; may become a phone carrier), **Go for alarm** (staff),
  **Fight** (armed archetypes), **Tackle** (heroes).
- The reaction is **shown the moment it is chosen**. Panicked crowds jam doorways: police and crew move through a
  tile with a panicked NPC at +1 cost.
- Panic doesn't last forever: a commanded or tied NPC is no longer panicked, so crowd control can always be won
  back.

### 10.9 Armed civilians

Armed civilians are another reason to **keep the crowd under control**. One on his own isn't much of a threat, but if
he draws, the crew probably has to shoot him: a loud noise, a body, panic, and heat if the police are watching. They
turn a slipping crowd into an escalating situation.

- **Decided when the bank is generated:** 0–2 per bank by tier, usually an off-duty cop among the customers.
- **No tells.** He looks, moves and inspects exactly like any other customer, and no intel marks him. The player
  can't know which civilian it is, only that one might be.
- **Found by a frisk:** zip-tying includes a frisk, which finds and removes the weapon.
- **When he acts:** while Commanded or tied, never. When he is **Panicked** or his command **lapses**, his reaction
  is always ***Reach for weapon***. The intent shows for one world phase, and he becomes Hostile only after it. No
  unannounced shots, ever [R28].
- **Once he reaches, shouting is too late.** Commands no longer work on him, and zip-ties need a subdued target. The
  player gets one crew phase to defuse it by **subduing** him (a melee knockout, the taser, or a flashbang followed by
  a knockout or zip-tie) or to **shoot first**. A gunman can't be talked back into the crowd.

---

## 11. Combat

Combat uses the same grid and the same turn as stealth. Shooting has exactly **two random layers**: where each
bullet lands within its arc, and the cover roll. Everything else is fixed and previewed [R21].

### 11.1 Aiming

- **Tap a target:** the cone snaps to the target's centre.
- **Drag** (optional fine aim): the cone rotates in 1° steps, with a magnifier drawn *above* the finger. Use it to
  steer the edge of a burst away from a hostage, put a shotgun cone across two guards, or hit a gas canister.
- **Confirm** with the large Confirm button, or a second tap on the same target. A single tap never fires.
- The **fire selector** lets automatic weapons fire anywhere from 1 bullet up to their Bullets stat. Fewer bullets
  means a tighter pattern and less ammo spent: the precision tool near hostages.

### 11.2 The cone

- Bullet *k* (counting from 1) flies within an arc of **Aim + (k − 1) × Recoil**, centred on the aim line. Bullet 1
  is the most precise; each later bullet spreads wider. The weapon's **moving penalty** multiplies Aim if the shooter
  moved this turn.
- **Each bullet lands at a random point within its own arc**, independently of the others. This is BankHeist's
  replacement for XCOM's hit chance: the dice are still there, but the player sees exactly where a bullet can go, and
  a narrower arc or a closer target is a better bet. Bursts can clump or scatter; a whole burst can miss, and a lucky
  one can land every round.
- **Rolls are made when an attack is confirmed** and saved with it, so quitting and reopening the game can't reroll
  a shot.
- Bullets that miss **keep flying** to the weapon's Range and can hit whatever is behind.

### 11.3 What a bullet hits

- **Hitboxes are per tile, not per pixel:** a standing body is 0.5 tile wide, centred in its tile. A bullet hits the
  first standing body or blocking object its line crosses.
- **Prone, commanded, tied and downed bodies are below the line of fire:** bullets aimed at anyone else pass over
  them, at any range.
- **Shooting someone lying down is a deliberate act.** Tap the person on the floor as the target, and the cone is
  aimed at them from any range, with hits previewed as usual. Other people lying in the line of fire are still passed
  over. In this tone it is possible but brutal: killing a hostage adds heat (§13.2), and police who
  see it end negotiation and storm the building at once (§13.4).
- **Full-height objects and walls** stop bullets unless the weapon's Pierce allows a pass (§11.6).
- **Angles do the rest:** a target covers about 14° of arc at 2 tiles, 7° at 4, 3.6° at 8 and 2.4° at 12. Range
  falloff comes from the geometry, so there are no range tables [R2 in aiming notes].

### 11.4 Cover

- **Half cover** (desk, counter, planter, sofa, low wall, a cash cart): protects a target in an **adjacent tile**
  against bullets arriving within the **90° arc** facing the cover. Each bullet that would hit is **blocked 50% of
  the time**. Blocked bullets damage the cover (desk 6 HP, planter 4, counter 10; marble counters can't be
  destroyed).
- **Full cover** (walls, pillars, vehicles, ATMs, vault door): blocks line of sight. Standing next to a corner
  doesn't expose anyone: a character behind full cover can't be seen or shot from beyond it.
- **Leaning out.** A character next to a full-cover corner can attack (or set a Watch wedge) by **leaning out**. The
  shot is traced from the open tile beside the corner. Leaning puts them in the **Leaning** state until the start of
  their side's next phase: they are visible and can be shot from anything that can see that open tile, with half
  cover from the corner itself. The lean shows on the map (pose plus an icon), and NPCs lean by the same rules, so
  a police officer who leaned out to fire is exposed until his next turn. Moving away ends the lean.
- **Choosing a side.** Where a character has more than one corner to lean from (a pillar, or the end of a short wall),
  the player picks the side: the aim preview offers each lean tile, and the cone and exposure follow the chosen one.
  The other side stays covered.
- **Improvised cover: flip a table.** Any crew member, guard or police officer can flip an adjacent **flippable**
  object (tables, light desks, café tables) with 1 action. It stays on its tile as half cover, with its cover arc
  facing away from whoever flipped it, and keeps its HP (a wooden table has 6). Whatever was on top goes flying. It is
  a quiet noise (radius 4), and anyone who sees it during stealth gains +2 suspicion of that crew member: people
  don't flip furniture in a bank for no reason.
- **Height** (§14.7): a shooter on a raised tile ignores the half cover of a target on the ground. A crew member at
  the railing of a raised tile has half cover against shots from below.
- **Flanked:** outside every cover arc. The preview shows a half-shield on covered targets, greyed out when flanked,
  and cracked if this attack will destroy the cover [R19].
- **Glass partitions** don't block sight and give no cover. A bullet passes and the pane shatters (a loud noise).
  **Teller glass** (bullet-resistant) stops anything below Pierce 3 and shatters after 4 hits.

### 11.5 Damage and armour

> **Damage per hit = max(0, Damage − max(0, Armour − Pierce))**

Damage is fixed per weapon, with no damage ranges and no random crits. A **precision bonus** is deterministic: DMR
shots against Calm, Curious or Surprised targets deal ×1.5. Armour runs from 0 to 3 (§12.3). This gives each weapon class
a job: the Uzi shreds unarmoured crowds and does nothing to heavy SWAT; the AR and DMR deal with armour [R20].

### 11.6 Penetration and materials

| Material | Bullets |
| --- | --- |
| Glass (windows, partitions) | Pass. The pane shatters on the first hit (loud noise). |
| Teller glass | Stops Pierce < 3. Shatters after 4 hits. |
| Soft wall (drywall), wooden door | Pierce ≥ 1 passes with −1 damage. |
| Reinforced wall, Vault | Stops all bullets. |
| Bodies | Weapons with **Pierce 3** pass through the first body with −3 damage (overpenetration). |

Shots through a wall are drawn **dashed** in the preview, with the damage left after each material.

### 11.7 The shot preview

Before Confirm, the preview shows:

- the cone as nested arcs (bright for bullet 1, widening to the last), cut short at the first full-height blocker;
- **every body in the cone**, colour- and shape-coded (hostile ◆ red, civilian ● white with a heat warning, crew ▲
  blue), so nobody is hit by surprise;
- cover shields and their state, through-wall paths, overpenetration's second target;
- the noise ring and everyone who will hear it.

**No numbers.** The preview shows no hit count, no damage estimate and never a hit percentage. Reading the cone
against the target, and knowing your weapon's damage, is the player's skill: a narrow cone on a close target is a
good bet, a wide one at range isn't. There are no hidden assists either [R18].

### 11.8 Watch (overwatch)

- **Watch** costs all remaining actions (at least 1). The player drags a **wedge**; its widest allowed arc depends
  on the weapon (pistol, SMG, shotgun, LMG 60°; AR 45°; DMR 15°).
- The first hostile that moves or acts inside the wedge during the world phase draws a volley: up to half the
  weapon's Bullets (rounded up), with Aim ×1.5. If the wedge is 15° or narrower, Aim is ×1.
- **A civilian who runs through the wedge** inside the holder's Threat radius isn't shot. It is shouted down
  instead (re-commanded for free).
- Police from Heat 2 carry flashbangs and gas that cancel Watch and push characters out of their tile. Watch can't
  be the answer to everything [R15 in squad-tactics notes].

### 11.9 Suppression

- **Suppress** (LMG, 2 actions): the player drags a wedge of up to 60° and all the gun's bullets go into it, with
  spread doubled.
- Hostiles inside are **Suppressed** for one phase: Aim ×1.5, no Watch, and leaving cover triggers a free 1-bullet
  reaction shot.
- Civilians inside are Commanded (2 pips).
- It is very loud and burns a lot of ammo.

### 11.10 Melee and non-lethal options

- **Knockout:** adjacent, 1 action, on any NPC that isn't Hostile (or is Hostile but Surprised or Suppressed). The
  target is **out cold for 4 world phases**, then wakes **Alerted** in the same tile. Quiet noise radius 2.
- **Taser:** ranged knockout (4 tiles), 3 cartridges. Works on Hostile targets and on anyone reaching for a weapon.
  Doesn't work through armour 2+.
- **Flashbang:** everyone within 2 tiles of the landing tile is Surprised for one phase. Civilians are Commanded.
- Lethal and non-lethal choices are tactical, never a morality score. Non-lethal costs actions and supplies; lethal
  can add heat (§13.2). Nothing outside the heist punishes a kill.

### 11.11 Ammo and reloading

Each attack takes its bullets from the magazine. **Reloading costs 1 action.** Crew carry 3 spare magazines per
weapon. Running dry is a real problem in a long fight, part of the desperate end of a heist gone wrong, but there is
always something to do about it:

- **Switch to the sidearm:** swapping between primary and sidearm is free once per turn.
- **Scavenge:** pick up a downed guard's or officer's weapon (1 action), with whatever is left in its magazine, or
  take spare magazines off a downed enemy whose weapon uses the same ammo (1 action). Police carry pistols, shotguns
  and ARs, so a long firefight can feed itself, for crew willing to step into the open to loot a body.
- **Share:** hand a spare magazine to an adjacent teammate with the same weapon (1 action).
- **Ammo bag:** a consumable gadget (§12.2). Drop it on a tile (1 action); anyone adjacent refills their spare
  magazines (1 action) until its 4 uses run out. It can also go in the van or a stash drop.
- **Melee strike:** adjacent, 1 action, 3 damage, quiet noise radius 2. It always works, and unlike the knockout it is
  lethal and works on someone who is fighting.
- **Bluffing:** an empty gun still looks like a gun. Command range comes from the weapon being held (§10.1), and NPCs
  don't know it's empty.

Ammo shows on each crew portrait, with a warning when a crew member is on their last magazine.

### 11.12 Downed, arrested, dead

- **Hurt** (half HP or less): the crew member is visibly wounded. They **limp** (−1 move per move action), aim
  worse (Aim ×1.25), **bleed** (−1 HP every 2 world phases until bandaged with a medkit, 1 action), and leave a
  **blood trail** on every tile they cross. Before the bank is loud, blood is major evidence (§8.10). Afterwards,
  police follow fresh trails to a hidden crew member.
- **Crew at 0 HP are downed** and bleed out over **3 world phases**. **Revive** (adjacent, 1 action) brings them back
  with 3 HP. A downed crew member can be **carried**, with Very Heavy carry rules.
- **Police reaching a downed crew member arrest them:** they are moved to a police van. They can be traded back
  (§10.7). If they're still in custody when the heist ends, they are jailed (§19.6).
- A crew member under "Hands up!" (§16.2) can **surrender**, which is the same as being arrested.
- **NPCs at 0 HP die,** unless the damage was non-lethal (knockout, taser, flashbang). Wounded NPCs (half HP or
  less) crawl toward exits and scream: a loud noise, radius 6, once per world phase.
- **NPCs use the same rules:** their cones, cover and armour work exactly like the crew's. Hostile NPCs don't preview
  where they will move or whom they will shoot; only their commitments are shown (§13.6).
- **How police choose targets and moves** depends on the unit: patrol officers follow a simple routine, SWAT fight as
  a coordinated team (§13.6).

---

## 12. Weapons and equipment

### 12.1 Weapon table (canonical)

Columns: **Aim** = starting cone arc in degrees · **Rec** = arc added per bullet · **Blt** = bullets per attack ·
**Dmg/Prc** = damage and pierce per bullet · **Rng** = range in tiles · **Thr** = Threat, the command radius in
tiles · **Noise** = radius in tiles · **Profile** · **Mvd** = Aim multiplier after moving · **Mag** = magazine size.

| Weapon | Aim | Rec | Blt | Dmg | Prc | Rng | Thr | Noise | Profile | Mvd | Mag | Job |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Unarmed | — | — | — | KO | — | 1 | 1 | 2 | Clean | — | — | Takedowns, the "harmless customer". |
| Taser | 2 | — | 1 | KO | — | 4 | 2 | 2 | Clean | ×1 | 3 | Quiet ranged takedown. |
| Pistol | 5 | 6 | 2 | 3 | 0 | 12 | 3 | 8 | Concealed | ×1 | 12 | Backup and intimidation. |
| Suppressed pistol | 6 | 6 | 2 | 3 | 0 | 10 | 3 | 3 | Concealed | ×1 | 12 | Quiet kills during stealth. |
| Machine pistol | 14 | 3 | 6 | 2 | 0 | 8 | 4 | 10 | Concealed | ×1 | 30 | Concealable crowd spray. Useless against armour. |
| SMG (suppressor optional) | 7 | 2 | 4 | 2 | 0 | 12 | 4 | 9 (4) | Armed | ×1.25 | 30 | Mobile, can be suppressed. |
| Pump shotgun | 20 | 0 | 6 | 2 (+1 within 3 tiles) | 0 | 8 | 5 | 12 | Armed | ×1 | 6 | Breaching, two targets at close range. |
| — slug ammo | 4 | — | 1 | 6 | 2 | 12 | 5 | 12 | Armed | ×1 | 6 | Answer to armour and shields. |
| Assault rifle | 2 | 3 | 3 | 4 | 1 | 20 | 5 | 14 | Armed | ×2 | 30 | Generalist. Kept in check by profile, moving penalty and noise. |
| DMR | 1 | — | 1 | 9 | 3 | 30 | 5 | 18 | Armed (Concealed when cased) | ×6 | 5 | Armour, overpenetration, the sniper nest. |
| LMG (2 actions) | 6 | 2 (1 braced) | 10 | 3 | 1 | 20 | 6 | 18 | Heavy | ×2 (×1 braced) | 100 | Suppression, crowd control, holding a choke point. |

**Weapon actions:** the pump shotgun can **Breach** a door or lock (1 action). The LMG can **Suppress** (§11.9).
The DMR and LMG can **Brace** on their bipod (§6.3).

For tuning only (never shown to the player): expected hits against a standing target with no cover, at 2 / 5 / 9 /
14 tiles (from the aiming research's cone model; halve them against cover): pistol 2.0 / 1.6 / 1.0 / 0.6 · machine pistol 4.2 / 1.7 / 0.9 / 0.6 · SMG 4.0 /
2.4 / 1.3 / 0.9 · shotgun 4.3 / 1.7 / 1.0 / 0.6 · AR (2 rounds) 2.0 / 2.0 / 1.6 / 1.4 · DMR 1.0 throughout · LMG
8.6 / 4.6 / 2.6 / 1.6.

### 12.2 Throwables, charges and gadgets

| Item | Effect | Noise | Profile |
| --- | --- | --- | --- |
| Flashbang ×2 | Radius 2, thrown up to 6 tiles: everyone Surprised for one phase, civilians Commanded. | 14 | Concealed |
| Smoke ×2 | Radius 2: blocks sight for 3 phases. | 4 | Concealed |
| Noisemaker ×3 | Quiet sound (radius 3) at the landing tile: a lure. | 3 | Clean |
| Breach charge ×2 | Glass, Soft walls and doors: opens a 1-tile gap, 4 damage to the 3 tiles on the far side. | 14 | Concealed |
| Shaped charge ×1 | Reinforced walls: 1-tile gap, 6 damage on the far side, debris gives half cover. | 18 | Concealed |
| Thermite ×1 | Vault door or floor: burns 3 phases (5 on Class III), can't be stopped, fire on the tile, scorches loot within 1 tile of the door. Counts as drilling for sensors and heat. | 6 per phase | Armed |
| Drill | Vault door, safe or deposit-box wall: see §15.3. | 6 per phase | Armed |
| Tripwire charge ×2 | Placed on a door or tile; detonates when a non-crew NPC crosses it: 6 damage in radius 1. Police spot it within 3 tiles from Heat 3 and disarm it in 1 action. | 14 | Concealed |
| Jammer | Placed; radius 8, blocks radios and phones. Dispatch notices "lost contact" after 10 phases (§9.1). | 0 | Concealed |
| Hacking kit | Camera loops, alarm panel and sensors, the manager's PC, remote phone calls (§7.2). | 1 | Clean |
| Lockpick set | Mechanical locks: 2 actions (Steady Hands 1). | 1 | Clean |
| Glass cutter | A quiet 1-tile hole in a window: 2 actions. | 1 | Clean |
| Medkit ×2 | Revive or heal 4 HP: 1 action. | 0 | Clean |
| Duffel | Holds one long gun and one armour piece. | 0 | Concealed |
| Ammo bag | Drop on a tile; adjacent crew refill their spare magazines (1 action each), 4 uses (§11.11). | 0 | Concealed |
| Reinforcement kit ×2 | Reinforce a Soft wall or door (§14.3). | 2 | Concealed |

### 12.3 Armour and enemy stats

| Crew armour | Armour | Profile | Movement |
| --- | --- | --- | --- |
| Light vest | +1 | Concealed | — |
| Medium | +2 | Armed | — |
| Heavy | +3 | Heavy | −1 (4 tiles), no dash |

| NPC | HP | Armour | Weapon |
| --- | --- | --- | --- |
| Civilian, staff | 3 | 0 | — |
| Guard | 5 | 0 (1 from City tier) | Pistol |
| Security chief | 6 | 1 | Pistol |
| Off-duty cop | 5 | 0 | Pistol |
| Patrol officer | 6 | 1 | Pistol or shotgun |
| SWAT | 7 | 2 | AR, flashbang |
| Shield SWAT | 7 | 2 | Pistol. Frontal shield (90°) stops bullets with Pierce < 3. |
| Police sniper | 6 | 1 | DMR, from a raised position in a neighbouring building |
| Heavy SWAT | 12 | 3 | LMG |

How the numbers play out: an Uzi does 2 per hit to guards, 1 to officers, 0 to SWAT. An AR does 3 to SWAT and 2 to
heavy SWAT. A DMR does 9 to anything. Slugs (Pierce 2) do 6 to SWAT but are stopped by a shield, so flank shield
SWAT or use the DMR.

---

## 13. Police and heat

### 13.1 The heat track

- **Before the Alarm, there is no heat.**
- At the Alarm, heat becomes **Heat 1, tick 0**. Each level has **5 ticks**: 5 ticks reach Heat 2, 10 reach Heat 3,
  15 reach Heat 4 and 20 reach Heat 5.
- The HUD always shows the next step, when it arrives and where: **"Heat 3 in 2 turns: SWAT van, rear lot"**.
- Heat can fall back a level, but never below Heat 1, tick 0. A release that would go lower shows the capped amount.
  Units already on the map stay; later waves are weaker.
- **Arrival:** the first police arrival brings the units of **every level reached so far**. After that, each new
  level's units reach their staging points one world phase after the level is reached.

### 13.2 Heat events (canonical)

| Event | Ticks |
| --- | --- |
| Each world phase after the Alarm | +1 |
| A guard or staff member killed, **witnessed** by police, a live camera (through the operator) or a civilian who reaches the police | +1 |
| The **first** police officer killed in a heist (the police now know it's a shootout) | +3 |
| Each further police officer killed | +1 |
| A civilian or hostage killed, by any cause including traps and explosions | +5 |
| Each turn drilling or burning a Class II+ vault | +1 |
| A hostage escapes to the police | +1 |
| **Release** a hostage (§10.7) | −3 (once per turn, three times per heist) |

Kills witnessed before the Alarm are added when the Alarm fires.

**Combat isn't punished; the danger of combat is the punishment.** Heat is the only consequence of a kill, and it
stays inside the heist: shooting police and guards adds a little, with one bigger step the first time a police
officer dies, and killing a civilian or hostage adds a lot. Kills never reduce the payout or tighten the campaign's
Squeeze. A fight that goes badly costs what it costs on its own: wounded crew, heat that forces an early exit, and
loot left behind, which is time wasted on the campaign clock.

### 13.3 Escalation by level

Heat sets **how strong the police force on scene is** and what it can do. It is not a one-off delivery: losses are
**replaced between assaults**, so a long loud phase faces fresh waves for as long as it lasts. Winning a fight buys
time until the next assault, not the end of the police.

| Heat | Force on scene | New capabilities |
| --- | --- | --- |
| 1 | 4 patrol officers (2 cars) | Cover the exits, return fire, arrest anyone leaving. They don't breach. |
| 2 | 8 patrol officers, negotiator | Flashbangs. Negotiation starts. |
| 3 | 8 officers + 1 SWAT team (4, one with a shield) | Breach charges, assault waves from 2 entry points. They spot traps. Police cars block the crew vehicle's street lane. |
| 4 | 8 officers + 2 SWAT teams + 2 sniper teams, helicopter | Counter-sniping a known nest (announced). Gas on barricaded rooms. The helicopter's spotlight lights up outdoor areas, and it blocks the roof route (§14.7). |
| 5 | 8 officers + 2 SWAT teams + 1 heavy SWAT team (2 heavy, 2 SWAT) + snipers | Breach any wall type. A **roadblock** closes one street end, announced 2 turns ahead, on the side nearest the getaway. |

- **Reaching a level** brings the new units in at once (their vehicles arrive at staging points, §13.4).
- **Replacements:** in every Regroup phase (§13.4), police bring the force back up to the current level's strength.
  New vehicles arrive at staging points a phase ahead, so the size of the next wave is always known.
- **Who goes in:** during an Assault, the SWAT teams (and at Heat 1–2 the patrol officers) push into the bank; the
  rest hold the perimeter, cover exits and the street.
- **Greed:** the force size is scaled by loot already secured, +10% per bag, capped at +50%
  [R16 in npcs-hostages-police notes].

### 13.4 Police rhythm

Police arrive **physically**. Vehicles appear at **staging points** (street ends, alley mouth, back lot; raised
positions in neighbouring buildings and the helicopter at Heat 4) at the end of one world phase with a siren marker, and officers get out in the next. **Doors,
windows and walls they intend to breach are marked one turn ahead** [R16].

Once on scene, they cycle through four phases, each announced with its length:

```
Contain (3) ──► Negotiate (2 + hostages, max +6) ──► Assault (4, +1 per heat level above 2) ──► Regroup (3; 2 at Heat 4+) ──┐
                     ▲                                                                                                        │
                     └──────────────────────────── (Negotiate again only if hostages are held; otherwise Contain 1) ◄─────────┘
```

- **Contain:** take cover, cover the exits, collect escapees (who tell the police what they saw).
- **Negotiate:** police hold fire unless fired on. The negotiator calls any bank phone. Answering (1 action) offers:
  **Release** (§10.7), **Trade** (§10.7), **Stall** (+2 Negotiate turns, once per heist), or hang up. Shooting
  police, or killing a hostage where police can see, ends Negotiate and starts an **immediate Assault**.
- **Assault:** at Heat 1–2, units push in only through open or unlocked doors and windows (flashbangs from Heat 2).
  From Heat 3, units push in from 2+ announced breach points, flashbang clusters and held positions, cut tied
  hostages free (1 action), arrest downed crew, and target crew by priority (§11.12).
- **Regroup:** pull back the wounded, re-stage, and bring the force back up to strength with fresh units (§13.3).
  Snipers keep watching.

The lulls are when the crew moves bags, re-ties hostages, fixes the drill and repositions. Schedule loud work into
the breaks.

### 13.5 Police rules

Police answer every player tool plausibly and audibly, and announce the answer at least a turn ahead [R32]:

- **They never fire a shot whose preview would hit a standing non-crew body.** They reposition, or use flashbangs and
  gas.
- **Barricades:** break them (barricades have 2 HP against police actions). If every entry is barricaded, they place
  a breach charge on a nearby Soft wall (announced).
- **Traps:** after the first trap triggers, SWAT "clear" unexplored rooms one tile per action. From Heat 3 they spot
  traps within 3 tiles.
- **Sniper nest:** a sniper team targets it at Heat 4 ("Shooter in the office tower! Sierra team, move."). At Heat 5,
  SWAT clear the building.
- **A crew vehicle in the street:** police cars block its lane from Heat 3. A vehicle can ram through once (a Wheelman without damage).
- **Overwatch camping:** flashbangs and gas from Heat 2.
- **Barks** announce each counter in a speech bubble, so the player knows what the AI is doing.

### 13.6 Police tactics

The police get smarter as heat rises. Low-level officers are predictable. SWAT should feel like a trained unit that
cooperates, times its moves and flanks. Two limits apply to every unit:

- **They only know what they have seen or been told:** their own sightlines, radio reports, escapees, released
  hostages (§10.7), noises and fresh blood trails. They act on last known positions, never on hidden information.
- **Only commitments are telegraphed** (see *What the player sees* below). Their movement and target choice are not
  previewed: in a firefight the player reads the police like a real opposing team.

**Patrol officers and guards: a simple routine.** Each one, every phase:

1. If a crew member is visible: move to the nearest cover that can see the **nearest visible crew member** and
   shoot them, leaning from a corner if needed.
2. If none is visible: advance carefully toward the last known crew position, cover to cover, along the way they came
   in. (At Heat 1 they hold the exits instead, §13.3.)
3. If Hurt: fall back out of sight and stay there.

They act alone, bunch up in doorways, and are easy to read and exploit. That is the point.

**SWAT: a coordinated team.** SWAT arrive as a team of four with a leader. Each world phase the team makes one plan
together:

- **Fire and movement:** half the team covers (Watch wedges or suppressive fire) while the other half moves. They
  never all move at once.
- **Locking down angles:** the team sets Watch wedges on the angles its plan depends on: the doorway the crew would
  use to flank them, the corridor to the loot, the crew's route back to the van. Crossing a locked angle draws fire,
  so the wedges shape where the crew can safely go.
- **Flanking:** the team picks the crew position that is easiest to break: isolated, leaning out (§11.4), behind cover
  that can be flanked, or Hurt. A pair works round to an angle outside that position's cover arc while the rest pin it
  from the front.
- **Focus fire:** they concentrate on one target until it is down or out of sight, instead of spreading shots.
- **Target priority:** a crew member exposed (flanked or leaning) → one who is Hurt → one carrying loot → the one with
  the heaviest weapon. They still never fire through a standing hostage (§10.7).
- **Timed breaches:** they stack at two entry points and breach in the same world phase, flashbang first. The stack
  and the "breach next phase" markers show a turn ahead.
- **Using their kit:** flashbangs on clustered crew or a held doorway, the shield officer leading through corridors,
  gas on barricaded rooms from Heat 4.
- **Casualties:** when a member goes down, the team pulls back one step, covers the casualty and drags them out, then
  re-plans.
- **Barks** narrate the plan: "Moving!", "Covering!", "Flanking left!", "Flashbang out!"

**What the player sees.** Full previews belong to the stealth phase (§8.8). There, perception is deterministic and
most crew actions don't change what an NPC will do, so keeping the preview exact stays simple. In a firefight nearly
every action changes what the police will do, and their shots involve dice, so they show only their **commitments**:

| Commitment | Shown as |
| --- | --- |
| Watch wedges | The wedge on the floor. Anyone moving or acting inside it draws fire. |
| Breach points and timing | A marker on the door, window or wall: "breach next phase". |
| Grenade and gas targets | The target area, marked a phase ahead. |
| Sniper lanes | The sniper's line of fire. |

Commitments are fixed at the end of the world phase and happen exactly as shown. Everything else (where each officer
moves, who they shoot, which way a flank goes) is **decided when they act**, from what they know at that moment, and
is **not previewed**. Shots are rolled then, like the crew's. The player reads the police from their positions,
their wedges and their barks, and anticipates them the way they would a real opposing team. Changing the situation
(killing the flanker, closing a door, moving the target) makes them adapt rather than walk into a trap.

Commitments are always shown, thanks to the crew's police scanner; police positions are only shown in sight, as
fading ghosts or as sound pings (§8.15).

**Heavy SWAT (Heat 5)** advance slowly and pin with LMG suppression (§11.9) while a regular SWAT team flanks.

**Police snipers** hold angles on windows and doors from raised positions (§14.7), take crew who lean out or stand
in view of a window, and counter-snipe a known nest.

---

## 14. The sandbox: materials, tools, vehicles

### 14.1 The property vocabulary (canonical)

Every tile and object is described by a **closed set of properties**. Every tool is defined only by how it changes
them. A new idea that can't be expressed in these properties is either cut or adds **one general property**, never
a one-off script [R29].

| Thing | Properties |
| --- | --- |
| Tile or object | Zone · Raised · Material (Glass, Teller glass, Soft, Reinforced, Vault, Boundary) · BlocksSight · BlocksMove · Cover (none, half, full) · HP (or indestructible) · Powered · Lit · Lock (none, mechanical, keycard, maglock, vault) · Open/Closed · Flippable · NoiseDamping · Flammable · Evidence |
| NPC | Role · Observer class · Schedule · State · Suspicion (per crew) · Knowledge (who is Exposed to them, what they saw) · Intent · Command pips · Traits (armed, hero, key holder, bribable) |
| Crew | Traits · HP · Actions · Profile · Loadout · Carry · Exposed-to list · Notoriety |

### 14.2 Tool × material (canonical)

| Tool | Glass | Soft (drywall, wood) | Reinforced (brick, concrete) | Vault | Boundary |
| --- | --- | --- | --- | --- | --- |
| Bullets | Pass, pane breaks | Pierce ≥ 1 passes (−1 damage) | Stop | Stop | Stop |
| Glass cutter (quiet) | 1-tile hole | — | — | — | — |
| Shotgun breach | Door or window | Doors and locks | — | — | — |
| Breach charge | Gap | 1-tile gap | — | — | — |
| Shaped charge | Gap | Gap | 1-tile gap | — | — |
| Thermite | — | — | — | Door or floor, 3 phases | — |
| Drill | — | — | — | Door, by vault class | — |
| Vehicle ram | 3-wide gap | 3-wide gap (doors and rolling shutters) | — | — | — |
| Reinforce (crew) | — | Becomes Reinforced | — | — | — |

- **Explosions** deal damage on the far side of the wall, leave debris (half cover) and **destroy loot** within 1
  tile. The preview shows which loot would be lost [R18 in squad-tactics notes].
- **Each material has its own art**: seams and cracks on Soft, brick courses on Reinforced, rivets on Vault.
  Long-press any wall to see its material and which of the squad's tools can open it [R30].

### 14.3 Fortifying

- **Barricade** a door or window: 1 action, unlimited (furniture is everywhere). It blocks movement and sight, but
  bullets pass, as through half cover. Police need actions to break it (§13.5).
- **Reinforce** a Soft wall or door: 2 actions, needs a reinforcement kit (2 uses). It becomes Reinforced: bulletproof, and only shaped
  charges or heavy SWAT can open it.
- **Blinds** on windows: 1 action, quiet. They block sight from the street, so they work during stealth too (against
  the patrol car drive-by).

### 14.4 Vehicles

Vehicles move along **street lanes** on the plot (main street, alley, service road). **Anyone** can drive: **Drive**
(1 action) moves a vehicle up to 8 lane tiles (a Wheelman 16) with everyone aboard. Anyone can **Ram**; the vehicle
takes 10 damage unless a Wheelman is driving.

| Vehicle | Source | Use |
| --- | --- | --- |
| **Crew van** | Always. Parked at the van spot chosen in planning. | Holds the crew who start in the van. It is the default getaway. Full cover. |
| **Ram truck** | Planning asset, parked at a chosen lane spot | **Ram** a Glass or Soft frontage facing its lane: a 3-wide gap, 6 damage across the 3×2 impact area (civilians included), loud noise radius 16. The truck stays as full cover in the breach. |
| **Backup car** | Planning asset, at a second spot | A second getaway. |

Vehicles can be shot: the van has 30 HP and armour 2. At 0 HP it is disabled. The crew falls back on the backup car
or an on-foot escape.

### 14.5 The sniper nest

- A rented upper-floor room in a **neighbouring building** on the plot: a **raised tile** (§14.7), chosen in planning
  from candidate tiles with sightlines into the bank (windows, the lot).
- The crew member assigned to the nest starts there. The first shot through a window breaks the pane (loud).
- The nest is on the grid: police respond to it at Heat 4 and 5 (§13.5). They can leave by the building's
  stairs.

### 14.6 The power grid

**Powered** objects (cameras, maglocks, the vault console, lights) follow the breaker and the generator (§8.13). The
alarm panel has its own battery, so cutting the power doesn't silence it. Some links:

- Cutting power opens fail-safe maglocks on staff doors, but the vault console goes dark: no code entry during an
  outage.
- Darkness halves vision for everyone, police included, and gives the crew an edge in the loud phase too.

### 14.7 Height and off-map routes

Each map is **one playable level**: the street, the bank interior and the neighbouring parcels all share one grid.
Height is a tile property, not a separate floor (director's decision).

- **Raised tiles:** mezzanines, the loading dock, scaffolding, and upper-floor windows or roof spots in neighbouring
  buildings. They are reached by stair or ladder tiles and drawn with a raised edge and railing.
- **Seeing from height:** an observer on a raised tile sees over low objects (desks, counters, cars, low walls). Walls
  and full-height objects still block. Observers on the ground see raised tiles normally.
- **Shooting from height:** a shooter on a raised tile ignores the half cover of a target on the ground. The railing
  gives a crew member at the edge half cover against shots from below (§11.4). This is what makes a sniper nest worth
  renting.
- **Sound** ignores height.

**Off-map routes** replace roofs and basements as floors. A route is a pair of access points on the map:

| Route | Outside end | Inside end | Transit |
| --- | --- | --- | --- |
| **Roof** | A ladder in the alley, or scaffolding next door | A roof hatch or skylight inside the bank | 2 turns |
| **Sewer** | A manhole in the street or back lot | A floor grate in a utility room | 3 turns |

A crew member who steps onto an access point is **in transit**. They are shown on a transit track at the screen
edge, can't act and can't be targeted, and appear at the other end when the transit ends. Loot heavier than Light
can't travel by either route. The helicopter (Heat 4) blocks the roof route; anyone still on the roof when it arrives
is forced back to the end they started from. The sewer can also be used as an escape exit (§15.4).

---

## 15. Loot, the vault and the escape

### 15.1 Loot

| Weight | Examples | Carrying | Throw | Profile |
| --- | --- | --- | --- | --- |
| **Light** | Cash bundles from drawers ($5k), jewels from deposit boxes | Pocketed, up to 2 stacks, no penalty | — | No change |
| **Heavy** | Cash bag ($40k), a deposit-box haul | −2 movement per move action, no dash | 2 tiles (1 action); an ally can catch it | Armed |
| **Very heavy** | Gold crate ($120k), server drive rack, a body, a downed ally | Half movement (Bruiser −1), pistol only | No; pass to an adjacent ally (1 action) | Armed |

- Bags can be **chained**: throw, catch, throw. A crew relay to the van works only on a grid, and it is satisfying.
- **Dye packs:** some teller drawers hide one. Unless the cash is inspected (1 action) or flagged by intel, the pack
  bursts once the cash leaves the building and ruins that stack.
- **The contract sets a target.** Success needs **target value in the getaway**. Anything above it is greed, priced
  against rising heat [R23 in heist-games notes].

### 15.2 Vault access (the key graph)

Every hard lock in a bank gets a **social**, a **technical** and a **violent** key, so stealthy, mixed and loud crews
can all plan [R35].

| Key | How it works |
| --- | --- |
| **Social: codes** | Dual control: the manager and the head teller each enter half the code at the console (coerced: 1 action each, adjacent, Commanded or tied). Single-code vaults: the code comes from the manager's PC (hacking kit, 2 actions in the office) or from a bribed or inside staff member. |
| **Social: time lock** | The vault opens itself during its scheduled window (usually the armoured-car delivery). Patient stealth crews walk in. |
| **Technical: drill** | §15.3. |
| **Violent: thermite** | Vault door or floor: 3 phases (5 on Class III), can't be stopped, loud, scorches loot near the door. It counts as drilling for sensors and heat. |

The **time lock** blocks codes outside its window. Drills and thermite still work. A **power cut** makes the console
dark, so no codes either.

### 15.3 Drilling

| Vault class | Bank tier | Drill time (phases) | Sensors |
| --- | --- | --- | --- |
| M | Small branch | 3 | — |
| I | City branch | 5 | — |
| II | City, HQ | 8 | Seismic: an alarm carrier when drilling starts (§9.1) |
| III | HQ, finale | 12 | Seismic + motion inside the vault |

- The drill makes a loud noise (radius 6) every world phase.
- **Jams:** 15% per phase, announced at the start of the crew phase. Fixing it takes 1 action adjacent (free for an
  adjacent crew member with Steady Hands).
- **Drill choices** (planning assets): **Silent** (noise 3, +50% time), **Beast** (never jams, +50% time).
- Drilling or burning a Class II+ vault adds +1 heat tick per phase once the Alarm is up.
- **Deposit boxes:** lockpick each box (2 actions, Steady Hands 1; Light loot) or drill the whole wall (4 phases). One random box per
  campaign bank holds **intel**, such as documents a prep mission needs (§19.5).

### 15.4 The getaway

- **Vehicles wait at their spots from the start:** the van, and the backup car if bought. Where they park is the
  decision: a curb spot is close to the door but in police view; the back garage is farther but safer.
- **Boarding:** adjacent, 1 action. Loot can be thrown in.
- **Leaving:** anyone aboard drives the vehicle off along the street lanes to a plot edge (§14.4). Roadblocks (Heat
  5) and police cars in the lane must be avoided, or rammed through once. **Crew left behind are
  arrested.**
- **Other exits** (when the plot has them): a sewer manhole (crowbar, Light loot only), a neighbour's garage with the
  backup car, or the roof route out (blocked by the helicopter at Heat 4+) (§14.7).
- **Escape is always possible.** Leaving with less loot is a partial success, never a failure screen.

### 15.5 Outcome

| Result | Condition |
| --- | --- |
| **Success** | Loot at or above the target leaves the map in a vehicle or through an exit, and at least one crew member escapes. |
| **Partial** | Crew escape below the target. Payout scales; there is no contract bonus. |
| **Failure** | Every crew member is out (dead, arrested or bleeding out) or none can still escape. |

The **payout** is the loot that left the map, minus dye-pack losses and the crew's shares (§19.4), plus **style**
bonuses (§19.8).

---

## 16. People of the bank

### 16.1 How NPCs work

- NPCs run on **authored schedules**, not hidden needs: time blocks plus **probabilistic one-off events** rolled when
  the bank is generated ("30% chance this teller carries a cash tray to the vault at turn 11"). Once the bank is
  generated, everything is known and deterministic [R6].
- Every NPC shows a **state badge**, its **suspicion pips** in each crew member's colour, its **intent** for next phase
  (path arrow or destination pin, plus an icon and countdown for carriers), **command pips** and a **tied** icon.
  Tapping an NPC shows its current activity and next scheduled action ("Manager → vault inspection in 6").
- **One investigates, the others watch.** A cautious event sends exactly one NPC, the nearest of the right role, so
  the player can peel guards away one at a time [R5 in npcs-hostages-police notes].
- **Searches:** a guard who loses sight of a known threat tracks it for one more phase, then walks to the last known
  tile (a "ghost" of the crew member is drawn there, as in Mark of the Ninja). Cautious searches end after 2 phases.
  Searches after gunfire never return to Calm, only to an alert patrol.

### 16.2 Archetypes (canonical)

**Panic** gives the reaction weights when panicked or when a command lapses.

| Archetype | Schedule | Observer class | Panic: cower / flee / hide / special | When it Exposes a crew member |
| --- | --- | --- | --- | --- |
| **Customer** | Queue → teller window → leave (8–15 turns), or ATM, or waiting area | Civilian | 50 / 35 / 15 / — | Panics (reaction shown) or screams |
| **Teller** | Window duty, scheduled cash runs to the vault, lunch rotation | Staff | 40 / 10 / 10 / **alarm 40** | Silent-alarm carrier (2) |
| **Head teller** | As teller. Holds half the vault code (dual control). | Staff | As teller | Silent-alarm carrier (2) |
| **Bank manager** | Office, scheduled vault inspection, lunch. Holds a keycard and half the code. | Staff (enforcer for uniforms) | 30 / 20 / 10 / **phone 40** | Desk button or phone (2) |
| **Cleaner** | Sweep route through Staff areas; keys to the back door | Staff | 50 / 30 / 20 / — | Goes to tell a guard (path) |
| **IT technician** (event) | Visits the server or alarm closet at a scheduled turn | Staff | 40 / 40 / 20 / — | Phone (2). Can be ambushed for an access card. |
| **Lobby guard** | Fixed post plus short patrol loop; radio check-ins | Enforcer | Resists (§10.4) | **Confront**: "Hands up!", then radio (2) |
| **Patrol guard** | Patrol route through Staff and Secure areas | Enforcer | Resists | As lobby guard |
| **Security chief** (HQ) | Roams. Remembers crew faces: crew seen once count one profile higher to him. Sees through uniforms. | Enforcer | Resists | Radio (2) |
| **CCTV operator** | Console; check-in calls; lunch or smoke break on some banks | Staff in person; Enforcer through cameras | 30 / 20 / 10 / **panel 40** | Verify → alarm (2) |
| **Off-duty cop** (hidden, 0–2) | Identical to a customer, in look and on Inspect | Civilian | Always **reach for weapon** (telegraphed for one phase) | Same as when panicked |
| **Hero** (rare trait) | Any customer or staff member, tagged "Bold" on Inspect within 3 tiles | — | Flees while others cower, or **tackles** an adjacent crew member | Tackle: an adjacent crew member loses their next action |
| **Armoured-car couriers** (event) | 2–3 armed; bay → vault → bay while the time lock is open | Enforcer | Resist; armed | Radio (2) |

**"Hands up!" (confront).** A guard who Exposes a crew member draws, shouts (loud noise radius 6) and orders them to
surrender. The crew gets one crew phase to respond: run out of sight, take the guard down, have someone else act, or
surrender. In the next world phase the guard radios (carrier) and fires if he can.

### 16.3 The schedule

Each bank has a **timeline** of events that the player discovers by watching (casing), buying intel, or simply
waiting. It is shown as a strip in the HUD:

- **Opening** (if the heist starts early): staff arrive, the vault day gate opens.
- **Lunch rotation:** two tellers or the manager leave their posts. The keycard leaves with the manager.
- **Shift change:** staff gather in the break room. Uniforms are left unattended.
- **Cash run:** a teller wheels a cash cart through the staff corridor to the vault (loot on wheels).
- **Armoured car:** couriers arrive and the vault **time lock opens** for N turns. A big opportunity and a big risk.
- **Patrol drive-by:** a police car passes on the street at set turns. Its officers can see through windows.
- **Closing time:** the front doors lock, customers leave, and the guards do a **closing sweep** through every room,
  checking closets. After the sweep, the vault time lock re-engages until morning.

The closing sweep is the stealth clock's soft deadline. Stealth is never timed, but a crew still hiding in the
building at closing faces the most thorough search of the day [R14].

### 16.4 Outside the bank

- **Passers-by** walk the street. They are Public civilians, and a panicked one becomes an escapee heading for the
  nearest plot edge, with the same max(2, path) countdown. Commanding, tackling or parking a vehicle across their lane
  stops them.
- **The patrol drive-by** (§16.3) and **dispatch's lost-contact check** (§9.1) are the outside world's eyes before
  the Alarm.
- After the Alarm, the street belongs to the police (§13).

### 16.5 Readability

- Each archetype has a **distinct silhouette and colour accent** that reads at 16px. Enforcers carry a badge.
- **State icons:** none (Calm), `?` (Curious), `?` with a target (Investigating), `!` (Alerted), sweat drops
  (Panicked), down arrow plus pips (Commanded), knot (Tied), bell plus number (alarm carrier), crosshair (Hostile).
- **Barks** come in tiers: specific lines the first time a cause appears, generic ones afterwards.

---

## 17. The procedural bank

### 17.1 Principles

1. **Three layers:** hand-designed **site plots** and **bank archetypes**, then hand-authored **room parcels** (6–12
   variants per room type), then **random detail** only: props in prop slots, staffing, schedule, traits,
   opportunities and wall materials within rules [R34].
2. **Loops, not trees:** at least 2 loops connect Public and Secure space, and every zone has at least 2 connections
   [R35].
3. **Every room has a job** (§17.4). There are no filler rooms [R36].
4. **Variety players notice:** each bank gets 1–2 **headline features**, and difficulty adds **new kinds** of
   security, not just bigger numbers.
5. **Fixed orientation:** the main street is always along the **bottom**, public space at the front, the secure core
   at the **top**. Players learn "the vault is up and back" and still have to find the route [R39].
6. **Every seed is validated**, and failures are rejected (§17.7).

### 17.2 Generation recipe (in design terms)

1. **Plot:** a city-block template (mid-block, corner lot, plaza front, strip-mall end). Main street at the bottom,
   alley and/or service road at the top or side, 2–4 **neighbour slots**, police staging at the street ends.
2. **Archetype**, which sets the loop structure:
   - **Two Wing:** public and service routes both reach the vault corridor.
   - **Atrium:** the lobby is a central space ringed by offices and a mezzanine.
   - **Three Keys:** the social key needs three parts (the manager's card, the CCTV room disabled, the time-lock
     window), each in a different wing. The drill and thermite still work, slower and louder.
   - **Fortress:** one hardened core with many breachable outer walls.
   - **Mezzanine Watch:** the CCTV room overlooks the floor.
3. **Core first:** place the vault (class by tier), then the CCTV room in **another wing**, then the alarm or
   electrical closet, then the approach points the archetype and neighbours allow.
4. **Key graph:** attach social, technical and violent keys to every hard lock (vault, CCTV door, mantrap, alarm
   panel), and assign key holders and their schedules.
5. **Fill** the zones with parcels on a 4-tile sub-grid, mirrored or rotated, then roll the prop slots (cover).
6. **Population and schedule:** guards, cameras in allowed slots, the customer crowd for the time of day, armed
   civilians, the dye-pack teller, heroes, bribable staff, and events.
7. **Validate** (§17.7). Relax rules in a fixed order if too many seeds fail.
8. **Present:** a briefing naming the headline feature, the knowledge layers (§17.8) and the key-graph objectives
   board.

The **layout seed** and the **population seed** are separate, so a layout can be replayed with new people. Seeds can
be shared.

### 17.3 Bank tiers

| Tier | Interior | Security | Vault | Extras | Police ETA |
| --- | --- | --- | --- | --- | --- |
| **Small branch** | ~32×22 | 1 guard, 2–4 record-only cameras, no operator (check-ins go to dispatch) | M, time lock | — | 8 |
| **City branch** | ~40×28 (+ mezzanine in the Mezzanine Watch archetype) | 2 guards, 6–8 cameras, operator with 4 monitors | I–II, dual control, time lock on some | Staff mantrap, dye packs, armoured-car event on some | 6 |
| **Regional HQ** | ~48×32 + mezzanine | 3–4 guards + security chief, 10–12 cameras, operator + guard in CCTV room | II–III, dual control + time lock | Armoured-car event, motion sensors, **metal detector** at the entrance (frisks Concealed items) | 4 |
| **Reserve depot** (finale) | Hand-authored | On-site response team | III, seismic, biometric | Unique | 3 |

The whole plot, including street and neighbours, is about **60×40 tiles**. Keep the lobby within about 16 tiles
corner to corner, so most firefights fit on one screen. Corridors are 2 tiles wide where crews must pass each other.
Every map is one level; height is a tile property and roofs and sewers are off-map routes (§14.7).

### 17.4 Rooms and their jobs

| Room | Zone | Job |
| --- | --- | --- |
| Lobby, teller line | Public | Crowd, cash drawers, silent alarms, the takeover stage |
| Restrooms | Public | Hiding spot, stash drop, uniform change |
| ATM service room | Staff | Cash cassettes (secondary loot) |
| Manager's office | Staff | Keycard, PC (code, time-lock schedule), desk alarm, phone |
| Break room | Staff | Shift-change crowd, staff uniforms |
| Cleaner's closet | Staff | Tools, back-door keys, hiding spot, body stash |
| Staff corridor | Staff | Connects things; the cash-run route |
| Mantrap | Staff/Secure | The operator buzzes people through: a social-stealth choke point |
| CCTV room | Secure | Operator, monitors, recorder, check-in calls |
| Alarm / electrical closet | Secure | Alarm panel, breaker |
| Server room | Secure | Remote camera loop (hacking kit), vent route on some parcels |
| Vault antechamber, vault | Secure | Console, sensors' wiring box, loot |
| Deposit-box room | Secure | Optional loot, intel box |
| Loading bay | Staff | Vehicle access, armoured-car event, rolling shutter (rammable) |
| Generator | Back lot | Backup power |

### 17.5 Neighbours and approaches

**Neighbour parcels**, 2–4 per plot:

- **Office tower:** raised sniper positions in its upper windows.
- **Café:** shares a wall with the lobby; window seat for casing.
- **Parking garage:** getaway spot, raised firing line.
- **Construction site:** scaffolding (a raised position and the outside end of the roof route), tools.
- **Vacant shop:** shares a wall with the bank (wall breach).
- **Utility manhole:** sewer exit.

**Guaranteed approaches:** at least **4 approach points from at least 3 categories**:

- **Social:** front door during opening hours, staff door with a keycard or the mantrap.
- **Covert:** the roof route (hatch or skylight), the sewer route (§14.7), an air duct.
- **Forced:** wall breach, the loading-bay shutter, a vehicle ram through the glass front.

At least one covert approach reaches the CCTV room or the alarm closet, which the inside-man plan needs.

### 17.6 Headline features and opportunities

**Headline features** (1–2 per bank): a glass atrium roof (skylight entry), a mezzanine CCTV room,
scaffolding next door, an armoured-car delivery mid-heist, a manager working late, an old bank with a round vault door
and metre-thick walls, a bank inside a mall (crowds, many exits), a drive-through teller lane.

**Opportunities** (3–5 per bank, from a library). They are found by eavesdropping (standing within 2 tiles of a
conversation for 1 turn), reading documents, or intel, and are listed in a per-bank **Intel journal** with guidance
set to Full, Minimal or Off [R16 in immersive-sims notes]:

- The manager takes lunch at turn N and leaves the keycard in the desk drawer.
- The operator smokes at the alley door at turn N and props the fire door open.
- A teller is in debt and can be **bribed** (Smooth Talker) to stay off the alarm.
- An IT tech visits the server room at turn N; ambush them for their access card.
- The cash cart runs through the staff corridor at turn N.
- Renovation scaffolding gives roof access.
- The server-room vent connects to the vault antechamber.
- The café shares a Soft wall with the deposit-box room.

### 17.7 Validation (reject the seed if any rule fails)

- Every guaranteed approach reaches the vault.
- A **Clean-profile stealth route** exists from the lobby to the CCTV room or the alarm closet.
- At least 2 loops between Public and Secure space.
- No deploy or start tile is in view of a guard or camera.
- No more than **3 guards** can see the same tile [R37].
- Every camera covers a tile someone has to cross (no pointless cameras).
- Every silent-alarm station can be reached from the lobby; civilian exits are within a set distance band of crowd
  areas.
- Getaway candidate spots connect to at least 2 plot exits.
- The vault is at least 2 doors from any Public tile. The CCTV room isn't on the vault corridor.

### 17.8 Knowledge layers

1. **Blueprint:** the exterior and the public floor plan are always known. Staff and Secure rooms show only as
   outlines unless the Blueprints asset is bought.
2. **Casing:** anything a crew member has seen is known (rooms, cameras, NPCs tagged with schedules).
3. **Intel:** bought or earned: guard rota, vault class, the operator's schedule, shared walls.

**Unknown is drawn as unknown** (`?` rooms, unscanned walls, grey overlay), never as empty. Nothing the player sees
is ever wrong [R11 in procedural-banks notes].

---

## 18. Planning a heist

### 18.1 The planning screen

One screen (not a chain of prep missions [R47]) showing the plot at whatever knowledge layer the crew has. The player:

1. picks the **crew** (up to the contract's size) and their **loadouts**;
2. picks each crew member's **start**:
   - **Inside** (walks in as a customer; Clean or Concealed only; an HQ metal detector flags Concealed items);
   - **Van** (any loadout; starts in the van);
   - **Nest** (any crew member with a long gun; needs the rental);
3. places the **van**, and optionally a backup car and ram truck, on candidate spots;
4. buys **assets** with **cash**, under a **favour cap of 8 points** ("you can only call in so many favours before
   someone notices").

### 18.2 Assets (canonical starting list)

| Asset | Cost | Favours | Effect |
| --- | --- | --- | --- |
| Blueprints | $2k | 1 | Reveals the full layout: rooms, doors, wall materials. |
| Guard rota | $3k | 1 | Reveals patrol routes and check-in times. |
| Inside man | $10k | 3 | One named employee won't raise the alarm and unlocks the staff door at a set turn. |
| Stash drop | $4k | 2 | A duffel (one long gun and one armour piece) and an ammo bag hidden in the public restroom. |
| Cut phone line | $3k | 1 | Landlines are dead. Dispatch notices after 15 phases (a drive-by). |
| Jammer pre-placed | $5k | 2 | A jammer in a chosen spot next to the building (§12.2). |
| Sniper nest rental | $6k | 2 | One crew member starts in a chosen neighbour room. |
| Tow truck | $5k | 2 | Blocks one street end: police arriving from that side take +3 turns. |
| Ram truck | $8k | 2 | Parked at a chosen lane spot (§14.4). |
| Backup car | $6k | 1 | A second getaway at another spot. |
| Pre-placed charge | $4k each | 1 | A breach or shaped charge on a chosen *exterior* wall, planted the night before. Assign who holds its detonator. |
| Staff uniforms (×2) | $3k | 1 | Needs an insider or a casing find. |
| Silent drill / Beast drill | $5k | 1 | §15.3. |
| Medic bag | $2k | 0 | +2 medkits shared. |

Assets are **positional** on the generated map, so the best pick changes with each bank. Tuning goal: no asset in
more than about 60% of winning plans [R47].

---

## 19. The campaign: the road to The Big One

The campaign is a race. The player knows the final target from day one and can attack it **whenever they choose**.
Every other job is preparation: money for better gear, and prep missions that give **tangible advantages** in the
finale. Waiting costs more and more: a campaign clock, **the Squeeze**, adds complications to the finale, each step
arriving sooner than the last. The game is the balance between being ready and being too late [R48].

```
Day 1 ──► [contract | prep mission | case | recruit | lay low] ──► … ──► THE BIG ONE (any day you choose)
            money → gear     advantages     intel                         win or lose: the campaign ends
                    ▲                                                     unprepared crews don't come back
                    └── every day and every messy job tightens the Squeeze → complications on the finale
```

### 19.1 The Big One

- On day 1, the player gets the **dossier** for the final target, for example the Halvorsen Federal Depository
  during its quarterly cash transfer. It lists every known **Defence** (guards, response team, vault class and
  sensors, police ETA, cameras, mantraps, metal detectors, helicopter, roadblocks) and the **target value** (for
  example $2M, mostly Very Heavy gold).
- **The finale can be launched from the city map on any day.** It is a single attempt. Win or lose, the campaign
  ends.
- The finale is a **hand-authored site** with population and schedule variation (§17.3, Reserve depot). Each Defence
  is a real, tuned obstacle. **An unprepared crew should not get out alive**: a crew with starter gear and no prep
  advantages faces a Class III vault with seismic and motion sensors, an on-site armed response team, police in 3
  turns and a helicopter from Heat 3.
- The dossier shows, next to each Defence, which prep mission or gear counters it. "Ready" is something the player
  can read, not a guess.

**Endings:**

| Ending | Condition |
| --- | --- |
| **Retired rich** | Out with the target value. The epilogue lists who made it. |
| **Got away** | Out with less than the target. A lesser epilogue. |
| **Lost** | Nobody escapes. Campaign over. |

### 19.2 The Squeeze (the campaign clock)

The Squeeze is a points track. Every **threshold** (every 5 points) adds a **complication** to the finale or the
city. The next complication and its threshold are always shown on the city map, so the player can see exactly what
waiting will cost.

**Squeeze gained:**

| Source | Points |
| --- | --- |
| Each day that passes, days 1–5 | +1 |
| Each day that passes, days 6–10 | +2 |
| Each day that passes, days 11–15 | +3 |
| Each day that passes, day 16 on | +4 |
| Each crew member who gained Notoriety | +1 |
| A failed job | +2 |
| An arrested crew member talks | +4 |
| "Leak a false tip" side job (once per campaign) | −5 |

Because daily gain accelerates, complications come faster and faster: with clean play, about days 5, 8, 10, 12, 14,
15 and 17, with the Raid around day 18. Messy jobs bring every step forward.

**Complications** are drawn from a pool when the campaign starts, so their order is fixed and visible:

- The depot adds 2 guard posts.
- The police response contract is renegotiated: finale police ETA −1.
- The vault is upgraded: drill time +4, or a second sensor.
- A security chief transfers in and recognises any crew member with Notoriety 1+.
- The camera network is upgraded: every feed is live, and a second operator is added.
- The task force tails the crew: Notoriety +2 for the crew member with the most.
- The fence gets nervous: fence cut +15%.
- A city checkpoint closes one finale getaway route.
- A snitch burns one prep advantage, chosen at random from those not yet used.
- The armed response team doubles.

**The final threshold (40 points) is "The Raid."** The task force raids the safehouse: a forced escape mission. A
crew that survives must attempt the finale **the next day**, with every complication drawn so far. The clock is
therefore a hard deadline as well as a growing cost.

### 19.3 Contracts and stakes

Contracts appear on the city map. Each takes **1 day**. Higher stakes earn money faster but risk coming back with
nothing, or without crew members.

| Stakes | Typical target | Crew | Payout | Risk |
| --- | --- | --- | --- | --- |
| **Low** | Small branch, ATM service run | 2–3 | $40–90k | Police ETA 8, 1 guard, Class M vault |
| **Medium** | City branch | 3–4 | $120–250k | ETA 6, operator, Class I–II, dye packs |
| **High** | Regional HQ, armoured-car interception | 4–5 | $300–600k | ETA 4, security chief, Class II–III, response time scaled up |

- **Failure loses the gear brought in**, and any crew left behind (§19.6). A failed high-stakes job can cost the
  best rifles, the heavy armour and two crew members in one afternoon.
- **Chain escalation:** after a heist on one branch, the chain's other branches add a security step.
- Contracts refresh as days pass. Some expire, which forces choices between them.
- **Other day actions:** **case a bank** (1 day: one Clean crew member's no-combat visit fills in casing knowledge
  for that contract), **lay low** (1 day: injured crew heal and Notoriety decays). **Recruiting** and **shopping** take
  no time.

### 19.4 Money and gear

- **Loot comes out as dirty money.** The safehouse launders a fixed amount per day (raised by buying fronts: a
  laundromat, a car wash). A **fence** launders instantly for a 50% cut.
- **The crew take a share** of each job (8–20% each, set at recruitment). A bigger crew means smaller shares.
- **The black market** sells everything in §12: weapons, armour, gadgets, charges, drills, vehicles. Its higher
  tiers (thermal lance, heavy armour, DMR, LMG) open as the crew makes **contacts**, from high-stakes jobs and some
  prep missions. Gear is kept between jobs unless it is lost.
- **Better gear changes options, not HP:** slugs that answer shields, a suppressed SMG for quiet loud phases, heavy
  armour for the drill defence, a jammer, extra charges.

### 19.5 Prep missions

**Prep missions** are 1-day jobs on smaller sites built with the same systems and parcels (§17): an office, a yard,
a street ambush, a records room. Each grants one **finale advantage** that counters a specific Defence on the
dossier. A failed prep mission adds Squeeze and may be lost for good.

| Prep mission | Site | Finale advantage |
| --- | --- | --- |
| **Steal the blueprints** | Architect's office, after hours | Full layout and wall materials known from the start. |
| **Case the depot** | The depot's public visitor hall; one Clean crew member, no combat | Guard rota, camera feeds and the transfer schedule known. |
| **Turn an insider** | Follow and blackmail a depot employee (social mission in a bar or home) | One employee unlocks a staff door and won't raise the alarm. |
| **Steal a thermal lance** | Construction company yard | Vault door opens in 4 phases, without triggering the seismic sensor. |
| **Hijack an armoured truck** | Street ambush on the transfer route | Drive into the loading bay as the transfer, with 2 guard uniforms. |
| **Raid the dispatch office** | Police substation records room | Finale police ETA +3, and the first assault delayed by 2 turns. |
| **Map the sewers** | Utility depot | A sewer approach and an escape exit at the depot. |
| **Take the high ground** | Office tower opposite the depot | A raised sniper position over the depot yard. |
| **Plant the charges** | Night break-in next door | Shaped charges pre-placed on the depot's outer wall. |
| **Discredit the security chief** | Documents from a deposit box at a specific bank (a regular heist with a side objective) | The security chief is absent on the day. |
| **Get half the code** | The manager's home safe | One half of the dual-control code. |
| **Stash a second getaway** | Garage job | A backup getaway car, and one finale roadblock doesn't happen. |

Not every prep mission is offered in every campaign. 6–8 are drawn, enough for several valid finale plans but not
all of them.

### 19.6 Crew: hiring, injury, arrest, death

- **Recruits** come with one trait (§7.2) and a **personal motive** ("pay off my $80k debt", "never kill
  anyone", "get even with the bank that foreclosed on me"). Meeting it before the finale gives a one-time bonus (a
  perk or a contact).
- **Traits:** a crew member picks a new trait from three offered for every two jobs survived. No HP growth.
- **Downed during a job** (even if revived) → injured, out for a number of days. Time is the cost.
- **Arrested** → jailed. Options: a lawyer (money and days), a **jailbreak contract**, or leave them, in which case
  they may **talk** (+4 Squeeze, +Notoriety for the crew they name).
- **Killed** → gone, with their gear unless the body was carried out.
- The default is **arrest-first** for crew left behind (confirmed by the director). Permadeath-heavy play is an
  option (§19.9).

### 19.7 Notoriety (per crew member, 0–5)

| Gain | Amount |
| --- | --- |
| Seen **unmasked** committing an illegal act by a witness who reached the police (escapee, released hostage, survivor at the debrief) | +1 per job |
| Filmed unmasked doing something illegal, with the recorder not destroyed or taken | +1 per job |
| Arrested | +2 |

| Level | Effect |
| --- | --- |
| 0–1 | Unknown |
| 2–3 **Known** | Enforcers and cameras treat them **one profile higher** (Clean counts as Concealed: frisk range). |
| 4–5 **Wanted** | Everyone treats them one profile higher. |

**Decay:** −1 for every 2 days the crew member isn't deployed. Notoriety is the anti-snowball rule: veterans become
loud specialists, and fresh faces become the best infiltrators [R45]. It is also why the finale crew can't simply be
whoever did every job.

### 19.8 Styles

The debrief lists every **style** the crew earned. Each pays a one-time bonus (a payout percentage, or a contact for
the black market) per contract tier, so every way of playing is rewarded on its own terms [R46]:

| Style | Condition |
| --- | --- |
| **Ghost** | The Alarm was never raised. |
| **Inside Job** | The alarm panel was disabled before any Heavy crew member entered. |
| **Clean Hands** | Nobody died. |
| **Cowboys** | The way in was a vehicle ram or wall breach. |
| **Fortress** | Held through two full police assaults. |
| **Overwatch** | Every kill was made from the sniper nest. |
| **Smooth Operator** | Every check-in answered, no escapees. |
| **Greedy** | Took at least twice the target. |

Payouts must never make stealth strictly best. Loud play reaches deeper vaults and more bags; stealth keeps heat and
Notoriety low.

### 19.9 Between campaigns, difficulty and options

- After the finale, the player unlocks **options** for the next campaign: new traits and kits, other final
  targets (a casino cage, a gold-reserve train), starting perks (a fence, a bent cop, a garage) and gadgets. **One
  surviving crew member can carry over** as a veteran.
- No prestige resets, no XP gates, nothing bought with real money.

| Setting | Casual | Normal | Hard | Ironman |
| --- | --- | --- | --- | --- |
| Restart a heist from its planning screen | Yes | Yes | No | No |
| Armed civilians | Off | On | On | On |
| Squeeze per day | ×0.75 | ×1 | ×1 | ×1.25 |
| Crew left behind | Arrested | Arrested | Arrested; executed at Heat 5 | Arrested; executed at Heat 5 |

There is no turn rewind on any difficulty (§6.6).

**Toggles:** permadeath versus arrest-only, armed-civilian frequency, world-phase speed, guidance level (Full,
Minimal, Off), reduced gore.

---

## 20. Presentation and controls

The view is 320×180 with 16px tiles, so the view is about 20×11 tiles and grows wider on wide screens. A 16px tile is
about 6mm on a phone, below touch minimums, so **precise input never depends on tapping a tile at 1× zoom** [R41].

### 20.1 Camera

- **Overview:** the native view, for reading the situation. Pinch or drag to pan; one tap zooms out to a tactical
  map of the whole plot.
- **Act:** about 1.6–2× zoom, so a tile is roughly 10mm. The camera enters it automatically when a crew member is
  selected.
- The camera **never moves on its own during the crew phase**, except to centre the newly selected crew member.

### 20.2 Input flow

1. **Select** a crew member: tap the unit or its portrait, or cycle with a button.
2. **Choose:** tap a tile (snaps to the nearest valid tile) or drag a path, or pick an action from the contextual
   action bar.
3. **Preview:** the path, the eye icon at the first unsafe tile, suspicion costs, the noise ring with ear icons, the
   shot cone and who is in it, and the alarm carriers this action would start.
4. **Confirm:** a large button in the bottom-right corner (at least 48dp), or a second tap on the same tile. **Undo**
   sits beside it.
5. **End turn:** hold to confirm, and an extra prompt if crew still have actions left.

Previews draw **away from the finger**: the aim cone extends from the drag point, and the loupe sits above it.
Tooltips open on long-press, not hover [R16 in touch-ux notes].

### 20.3 Screen layout (landscape)

| Area | Contents |
| --- | --- |
| **Top strip** | Bank state ("Quiet" / "ALARM: police in 4" / "Heat 2 ▮▮▮▯▯ — Heat 3 in 2: SWAT, rear lot"), the schedule timeline (before the Alarm) or the police phase (after it), turn number. |
| **Left edge** | Crew portraits: action pips, profile icon, Exposed marker, HP, ammo (warning on the last magazine), carried loot. The left thumb also gets camera and overlay controls. |
| **Right edge** | Contextual action bar, Confirm, Undo, End Turn. |
| **Threat ledger** (pull-out) | Every live alarm carrier, reinforcement ETA, check-in, drill jam and lapsing command, sorted by urgency. Tap an entry to jump the camera. On phones this is the main planning surface [R21 in immersive-sims notes]. |
| **Overlay drawer** | Toggles: zones, all vision cones, cameras, cover, sound map, wall materials. |

### 20.4 Overlay budget

- **Always on:** the selected crew member's safe-floor tint, intent arrows of non-hostile NPCs (staff, civilians,
  guards on routine), predicted markers and fading ghosts (§8.15), police commitments (§13.6), sound pings, countdown
  and command pips, state badges.
- **In context:** the noise ring and the cone while previewing an action, and the cover shields of targets in the
  cone.
- **On demand:** long-press for a single NPC's cones, a tile's cover, or a wall's material and the tools that open
  it.
- **Everything else:** the overlay drawer.
- Every state uses **shape plus colour**, with patterns for vision states so colourblind players can read them, and
  a fixed icon set that reads at 16px [R4 in stealth-tactics notes].

### 20.5 The world phase on screen

- Groups move together (civilians, staff, guards, police, in that order), each in one simultaneous motion.
- The camera **visits only important events:** new suspicion on crew, a carrier starting or advancing, an arrival, a
  shot at the crew, an escape, a Twitchy NPC's intent. Everything else goes to the event log and edge-of-screen
  arrows.
- **Budget:** 2 seconds or less when quiet, 5 seconds or less when loud. Speed setting 1×, 2× or instant; tap to
  skip [R43].

### 20.6 Save and resume

- **Autosave after every committed action**, restoring exactly (camera, selection, previews). The OS may kill the
  app at any time.
- On resume, a **recap card** shows the last 3 events, bank state and heat, police phase, and each crew member's
  status.
- A heist runs 20–40 minutes, with natural chapter breaks: planning, GO, Alarm, police arrival, escape.

### 20.7 Desktop

The same flow with a mouse: hover replaces long-press, right-click cancels, and hotkeys: `1`–`5` select crew, `Space`
ends the turn, `Z` undoes, `Tab` opens the threat ledger, `O` the overlay drawer.

### 20.8 Accessibility

No timing or dexterity requirements anywhere. Shape plus colour for every state, scalable text in the HTML HUD, a
world-phase speed setting, guidance levels, and full rebinding on desktop.

### 20.9 Destruction and aftermath

The bank starts the day tidy, and a shootout should wreck it: wood, glass, paper and blood flying everywhere, and a
room that looks afterwards like a fight happened there. This is the visual half of the tone in §1.

**Decoration never changes the rules.** Breakable dressing is purely visual: it never stops or slows a bullet, never
gives cover and never blocks sight, so the shot preview stays exact. Anything that does affect play (windows, teller
glass, desks, flipped tables, lights) is a real object with properties (§14.1), and it shows its damage the same way.

**Breakable dressing**, placed in prop slots by the generator (§17.2) so every room has some:

| Object | When hit |
| --- | --- |
| Glass bottles, coffee cups, water glasses | Shatter, with a splash of liquid. |
| Vases and potted plants | Burst into shards and soil, and the plant drops. |
| Pictures and certificates on the wall | Frame cracks, glass falls, the picture hangs crooked or drops. |
| Computer monitors, desk lamps | Screen cracks and sparks, the lamp topples. |
| Paper stacks, brochures, deposit slips | A burst of paper that drifts down over a few turns. |
| Water cooler | Bottle bursts and leaks a spreading puddle. |
| Fish tank (some banks) | Cracks, then empties across the floor. |
| Clocks, signs, pens on chains | Chip, swing and fall. |

**Hits on everything else:**

- **Bullets** leave holes in walls, chips in counters and splinters from wooden cover. Blocked shots throw splinters or
  stone dust from the cover that took them. A bullet passing through a tile breaks whatever dressing is there.
- **Blood** sprays in the direction of the shot, onto the floor and nearby walls. Bodies leave pools that spread, and
  the wounded leave trails (§11.12). Blood stays for the rest of the heist.
- **Explosions** blacken the floor and walls in a scorch mark around the blast, destroy all dressing within their
  radius, throw debris outward, knock over furniture and leave a slow haze that drifts and fades over a few turns. The
  haze is visual only; smoke that blocks sight is a smoke grenade (§12.2).
- **Spent casings** pile up around anyone who fires a lot.

**Everything persists.** Holes, scorch marks, shards, paper and blood stay until the heist ends. After the job the
lobby should tell the story of what happened in it, and a long, desperate fight should look like one.

The **reduced gore** option (§1) swaps blood for dust and darker stains; everything else stays.

---

## 21. Onboarding

**Three hand-authored jobs come before procedural banks.** Each teaches one layer, and the rules stay identical
afterwards [R16 in immersive-sims notes]:

1. **The Walk-in** (one Clean crew member, small branch): zones, the safe-floor overlay, suspicion and the trespass challenge,
   evidence, knockout plus the radio check-in, disabling the alarm panel, walking out with a drawer's cash. No combat.
2. **Everybody Down** (three crew, city branch): masks, GO, the three command rings, Hold, lapsing commands, zip-ties
   and frisking, alarm carriers and their counters, loot weights, a bag relay, the getaway.
3. **The Hard Way** (four crew, loud from the start): the cone and fire selector, cover, armour and pierce, Watch, the
   police rhythm, heat, a drill with jams, hostage release and trade, escaping under fire.

After that, the first two procedural contracts are small branches with the Intel journal on Full guidance.

---

## 22. Scope and build order

A playable greybox comes first and procedural content last. Systemic games are hard to debug, and rules designed in
isolation drift apart [R23 in immersive-sims notes]. Each milestone is fully playable on a hand-made bank before the
next starts.

| Milestone | Contents | Proves |
| --- | --- | --- |
| **M1 Stealth core** | Turn loop, movement, undo, zones, profiles, vision, suspicion, the reaction matrix, the **safe-floor overlay** (with its preview = outcome test), sound, NPC schedules and intents, evidence, knockout, alarm carriers, check-ins, cameras and operator, auto-advance. One small hand-made bank. | The bank is readable clockwork. |
| **M2 Takeover and control** | GO, the three command rings, Hold, lapse and intent, resisters, zip-ties and frisking, panic, armed civilians, loot weights and throwing, vault access (codes, time lock, drill). | "Everybody down!" is the best moment in the game. |
| **M3 Loud** | Cones, random spread within the arc, cover, armour and pierce, penetration, the shot preview, Watch, Suppress, downed and arrested, police staging, rhythm, heat, negotiation, release and trade, getaway and escape, the outcome screen. | Loud is a tactical game, not a losing state. |
| **M4 Sandbox v1** | Breach and shaped charges, barricade, reinforce, blinds, tripwire, the ram truck, the sniper nest, power and generator, the planning screen with assets and starts. | Plans made on the planning screen pay off in play. |
| **M5 Procedural banks** | Plots, archetypes, parcels, key graph, population and schedule, opportunities, validation, knowledge layers, seeds. | Generated banks are plannable and varied. |
| **M6 Campaign** | City map and day actions, contracts by stakes, money and laundering, the black market, crew, Notoriety, styles, chain escalation, **the Squeeze and its complications**, prep missions on small sites. | The preparation-versus-time decision is tense every day. |
| **M7 The Big One** | The hand-authored depot with its Defences, the dossier, prep advantages wired into the finale, endings, the Raid mission, carry-over and unlocks. | An unprepared crew dies there; a prepared crew has several plans that work. |

**Deliberately v2 or later:** fire alarm and firefighters, crew pairs, a nemesis SWAT commander, real
multiple floors (basements, a vault under the lobby, upper storeys), armoured-truck and casino contracts, a daily or shared-seed challenge (only if it is a
challenge, never a login reward), and any multiplayer.

**Cut first if needed:** the security chief's face memory, dye packs, the hero trait, crew personal motives.

---

## 23. Director decisions and open questions

**Decided (October 2026):**

1. **Heat before the Alarm:** none. The bank's schedule and the closing sweep are the pressure before it (§2, §13).
2. **Losing crew:** arrest-first by default; permadeath is an option (§19.6, §19.9).
3. **Campaign:** a known final target the player can attack at any time. Money buys gear, prep missions give finale
   advantages, and the accelerating Squeeze punishes waiting; higher stakes earn faster but risk more (§19).
4. **Disguises:** in. Staff, guard and courier uniforms (§8.14).
5. **Tone:** gritty, Hotline Miami-style violence. Visible wounds, blood trails, and the arc from a confident,
   professional crew to a desperate scramble back to the van (§1, §11.12).
6. **Multiplayer:** single-player only.
7. **No classes:** kits decide what a crew member can do, traits decide how well (§7.2). Turn rewind is removed
   (§6.6).
8. **One level per map:** height is a tile property, and roofs and sewers are off-map routes (§14.7). Exposure is
   permanent, and combat is an expected part of most heists (§1, §8.7).
9. **Random spread:** each bullet lands at a random point within its arc, replacing XCOM's hit chance (§11.2).

**Still open:**

10. **Hostage release cap.** Keep the hard cap (one per turn, three per heist), or switch to diminishing returns (−3,
   then −2, then −1 per release, uncapped)? Decide in playtesting (M3).
11. **Fading ghosts.** Keep the 2-turn ghosts of NPCs who left view, or drop them and rely on predicted routines and
   sound pings? Decide in playtesting (M1).
