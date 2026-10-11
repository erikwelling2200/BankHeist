# Aiming & shot resolution

I couldn't finish the research as planned. The web-search budget shared by all agents in this run ran out after 23 searches, and several key pages blocked fetching: the Jagged Alliance 3 dev diaries (403), the Fallout and XCOM fandom wikis (402), and Gamewatcher (403). The lessons below therefore combine (a) sources I actually reached, (b) well-established genre knowledge, flagged where I could not verify it, and (c) my own cone math. I modelled a 0.5-tile-wide target in a small script. That target covers about 14 deg of arc at 2 tiles, 7 deg at 4, 3.6 deg at 8 and 2.4 deg at 12, which is what lets an angular cone work without range tables.

The spatial-aim lineage is X-COM 1994 > Silent Storm > Phoenix Point > Jagged Alliance 3. In that lineage every bullet is a real projectile, stray rounds hit whatever is in the way (allies and cover included), and cover is geometry rather than a modifier. Phoenix Point's free aim is the closest thing to our brief. It shows two circles: every bullet lands inside the outer one, and about half land inside the inner one. Players and reviewers liked that it reduces "RNG rage". The complaints were about legibility: cover the UI called 'full' while limbs could still be shot, no way to know beforehand whether a weapon would destroy cover, and still missing 90%-looking shots. XCOM shows what happens when the displayed number lies. Jake Solomon admits '85 percent isn't actually 85 percent' on lower difficulties, and players read numbers 'from an emotional sense'. Hidden aim assist and streak breakers had to exist because a percentage invites betrayal. Jagged Alliance 3 went the other way: it dropped visible chance-to-hit entirely and simulates each bullet by calibre and material, so shots can pass through one body into another, graze allies, or destroy scenery. Into the Breach is the far pole: it removed nearly all in-the-moment randomness and telegraphs every enemy action.

For BankHeist the cone already beats a percentage, because the player can see the variance. But it only stays fair if it is legible and the variance is bounded. Bullets should fan across the cone rather than clump. Damage per bullet should be fixed, with no damage ranges. Everyone in the cone, including civilians and crew, must be highlighted with expected hits before you commit. The 50% cover rule is simple enough to show as a half-shield on the preview. Weapon identity comes from five interacting axes. The brief has Aim, Recoil and Bullets; damage, pierce (armour piercing) and bullet count against flat per-bullet armour add a fourth axis. Payday 2 contributes the fifth and most important: Concealment and Threat as weapon stats. In Payday 2, total concealment (primary + secondary + melee + armour) sets your detection risk. Payday 2's Threat stat maps directly onto our command-area mechanic. That turns the gun locker into the stealth-versus-loud decision instead of a pure damage race. I propose a 10-weapon starting roster with concrete numbers, and expected hits per range computed from them.

## Lessons

### 1. A displayed percentage creates an emotional contract that randomness will eventually break. The cone shows the variance as geometry, so a miss reads as the player's call, not the game cheating.

**Evidence:** Solomon (Game Developer): players read hit chances 'not from a mathematical sense, but from an emotional sense'; '85 percent isn't actually 85 percent'. XCOM has hidden aim assist above 50% on non-Legendary difficulties, capped at 95% (game config posted on Steam). A Nexus mod exists just to reveal these hidden bonuses. Enemy Within's 'bad streak breaker' on Easy/Normal (Ananda Gupta, GameBanshee). Phoenix Point player feedback credits free aim with less RNG frustration.

**For BankHeist:** Never show a single hit percentage, and never apply hidden assists. The preview shows the cone plus expected hits per target. Every modifier (moved, braced, suppressed, cover) is drawn as a visible change to the cone or as a shield icon. The same rules apply to enemies, so the player can learn them by watching.

### 2. Angular cones produce range falloff for free. No range-band tables are needed if the weapon's arc stays fixed and targets have a physical width.

**Evidence:** In Phoenix Point the reticle covers more of the scene as distance grows, so spread effectively widens with range (review / guides). My math: a 0.5-tile-wide target covers 14.3 deg at 2 tiles, 7.2 deg at 4, 4.8 deg at 6, 3.6 deg at 8 and 2.4 deg at 12.

**For BankHeist:** Define Aim and Recoil in degrees of full arc. Give every body a hitbox width: standing about 0.5 tile, crouched behind low cover about 0.35, prone civilian about 0.3 when shot from the side. Expected hits for one bullet = min(1, target arc / bullet arc). The engagement scale (about 20x11 visible tiles) then works: SMGs fall off past 5 tiles, rifles hold to 12+, and a 1-deg DMR is near-certain to 14 tiles.

### 3. Bound the variance per attack. Bullets should fan across the cone (stratified or low-discrepancy), not land independently at random, so a 6-bullet burst at a target filling a third of the cone almost always scores about 2.

**Evidence:** Phoenix Point's two-circle reticle tells players a distribution: all bullets inside the outer circle, about 50% in the inner. Even so, players complained that 'you can still miss most of your shots' and CGMagazine still reported 90%+ misses, so independent sampling still produces bad streaks. Into the Breach chose determinism for moment-to-moment play (Davis, PC Gamer; GDC 2019 postmortem).

**For BankHeist:** Player-facing rule: 'bullets spread evenly across their cone'. Each bullet gets its own slice, with jitter only inside that slice. Preview text should read as a range: 'Hits 2-3 (likely 2) > 6-9 dmg > likely KILL'. Damage per bullet is fixed, so there are no damage ranges stacked on top of spread variance.

### 4. Recoil-per-bullet makes the first bullet the precise one. Letting the player choose how many bullets to fire gives a real precision-versus-volume decision in every hostage situation.

**Evidence:** Real recoil logic and our brief: bullet k flies in an arc of Aim + k*Recoil. Fallout bursts spray a cone that hits anyone inside, even neutrals, with no warning (Fallout Wiki Burst Shot), and players hated it. Door Kickers 2 troopers switch automatically between full auto close in, rapid singles at mid range and slow aimed shots far out (dev/player posts).

**For BankHeist:** Automatic weapons have a fire selector from 1 to Bullets: fewer bullets means a tighter overall pattern, less noise and less ammo. The cone preview redraws nested arcs as the player drags a bullet slider or taps 1/burst/full. Shotguns are fixed, since all pellets leave at once (Recoil 0).

### 5. Auto-aim at centre of mass by default, with free aim as an optional precision layer. Spatial aim must not turn into dexterity work on a phone.

**Evidence:** Phoenix Point offers both standard targeting and free aim. Free aim is mostly used for body parts and for nudging around obstacles: 'an obstacle blocking it means you'll hit the obstacle instead' (guides).

**For BankHeist:** Tap a target: the cone snaps to that target's centre. Drag: the cone rotates freely, snapping to 1-deg steps, with a magnified inset at 320x180. The free-aim use cases are steering a burst's edge away from a hostage, putting a shotgun cone over two guards, or aiming at a gas canister. Commit is a separate confirm button so a fat-finger can't fire. Desktop: mouse aim plus a key to confirm.

### 6. Everyone inside the cone is in play: friendlies, civilians, glass, cover. The cone must show this before the shot, or friendly fire feels like a betrayal.

**Evidence:** Fallout's burst cone was invisible and stray rounds hit companions and neutrals; a fan mod had to stop companions turning hostile after accidental hits. Gollop: Phoenix Point stray shots 'can hit their target, and can also hit other targets, including allies' (Gamewatcher). JA3 per-bullet simulation can graze allies or pass through one enemy into another (dev diary).

**For BankHeist:** While aiming, colour every body in the cone: red for hostiles, white for civilians/hostages (heat warning), blue for crew. Each gets its own expected-hits pips. Bullets that miss travel on to the end of the weapon's range and can hit what is behind. A civilian hit seen by police raises heat. A civilian killed adds a large heat spike and panics everyone who hears it.

### 7. Cover must be legible and binary at the UI level. Phoenix Point's most repeated complaint was cover the UI called full that still let shots through.

**Evidence:** Phoenix Point Steam threads: a sniper at a corner shot from a steep angle while the UI showed full cover. 'PP cover isn't XCOM cover. If they are visible they are shootable.' CGMagazine: 'You cannot tell whether a weapon can destroy a piece of cover before you fire at it.'

**For BankHeist:** Keep the brief's rule but define it exactly. Cover counts if it sits in the tile adjacent to the target and the bullet's path crosses that tile edge. It then blocks 50% of bullets that would otherwise hit. Show a half-shield on each covered target in the preview, and grey it out when flanked. Blocked bullets damage the cover. Show cover HP pips and whether this weapon can destroy it (e.g. a wooden desk with 6 HP; marble pillars and vault walls indestructible to guns). High cover (walls, pillars) blocks line of sight; leaning out is a stance.

### 8. Flat per-bullet armour reduction plus a Pierce stat is the cleanest way to separate many small bullets from few big ones. It gives SMGs, shotguns and rifles different jobs without hit-chance math.

**Evidence:** Phoenix Point armour subtracts from each projectile, so multi-projectile weapons fall off against armour (genre knowledge, consistent with its ballistics). Tarkov: pen roughly equal to 10x armour class; a round should be no more than about 5 pen below the armour value; overkill pen adds nothing (GGRecon). Battle Brothers separates armour damage from health damage and has armour-ignoring weapons such as crossbows (wiki/players).

**For BankHeist:** Damage per bullet = max(0, Dmg - max(0, Armor - Pierce)). Armour values 0-3: guard 0, cop 1, SWAT 1, heavy SWAT 3. Result: an Uzi (Dmg 2, Pierce 0) does nothing to heavy SWAT, an AR (Dmg 4, Pierce 1) does 2 per hit, and a DMR (Dmg 9, Pierce 3) does full damage. Optional shred: every 3 bullets stopped by armour remove 1 armour point. That gives SMGs a 'strip, then rifle kills' team role.

### 9. Make concealment a weapon stat. The weapon you bring to fight is the weapon that gets you spotted, and that ties the combat model to the stealth model.

**Evidence:** Payday 2 weapons and armour have Concealment values. Their sum (primary + secondary + melee + armour) sets your detection risk (Steam community; Payday wiki pages show mods trading accuracy/stability for concealment, e.g. Mosconi 12G at 27 concealment but accuracy 28 and stability 4). Pistols like the Contractor sit at concealment 29.

**For BankHeist:** Each item has Conspicuousness 0-10 and the character's total sets the stealth reaction. 0-2 reads as a civilian. 3-5 is suspicious: staff inspect after loitering, guards challenge in restricted areas. 6+ means immediate threat on line of sight. Bagged or cased weapons count 1-2 but take an action to draw. The 'safe floor' overlay is computed from this total.

### 10. Map Payday 2's 'Threat' (suppression) stat to the brief's command radius. Bigger guns should intimidate further, scare cops more and make more noise.

**Evidence:** Payday 2 weapon stats include Threat alongside concealment, accuracy and stability (genre knowledge; not verified this session because the search budget ran out). Our brief: bigger weapons command larger areas.

**For BankHeist:** Each weapon has Threat = command radius in tiles (line of sight required): unarmed 1, pistol 3, SMG 4, shotgun/AR 5-6, LMG 7. The same stat sets suppression strength. Noise radius is a separate stat, so a suppressed SMG can be low-noise yet still threatening.

### 11. Suppression should be a cone-shaped area effect that changes behaviour, not just a debuff on one target.

**Evidence:** XCOM EU Heavy suppression gives -30 Aim and reaction fire if the target moves; Rifle Suppression is near-identical, and XCOM 2 mods use -20 (xcom wiki, Nexus). Door Kickers 2's 'Suppress Area' paints a cone where anyone inside can be hit and the cone can be resized (Steam forum).

**For BankHeist:** Fire mode 'Suppress': spend all bullets into a wedge the player drags, with each bullet's spread doubled. Every hostile the cone passes through is Suppressed for 1 turn: Aim x1.5 and no overwatch. Moving out of cover triggers a free 1-bullet reaction shot. Civilians in the cone drop prone for 2 turns, which also counts as a command. Costs a lot of ammo and is very loud.

### 12. A weapon's moving penalty separates run-and-gun weapons from planted weapons. Being stationary should be a meaningful advantage.

**Evidence:** Frozen Synapse resolves fights by priority: cover > stance > stillness > aiming. A moving unit is less likely to win against a stationary one (GiantBomb / PlayStation Blog). Jagged Alliance 3 has setup machine guns (dev diaries; not fetchable).

**For BankHeist:** Handling multiplier on Aim if the character moved this turn: pistols/Uzi/shotgun x1, SMG x1.25, AR x2, LMG x2 unless braced, DMR x6 (in practice cannot snipe after moving). Bracing on cover or a bipod is an action that halves LMG recoil and keeps the sniper nest stationary across turns.

### 13. Penetration should depend on materials, and the bank's real materials are a gift: drywall offices, wooden desks, bullet-resistant teller glass, concrete vault walls.

**Evidence:** Silent Storm projectile physics consider 'trajectory, speed, and piercing performance'; you can shoot holes through walls and bring a wall down with enough fire (GiantBomb). JA3 resolves bullets by calibre and the materials along the path, so bullets pass through bodies or destroy environment on the bullet path (dev diary). Gollop: Phoenix Point cover is destructible and dynamic in height.

**For BankHeist:** Material table (pierce needed / damage lost on passing): drywall 1 / -1; wooden door or desk 2 / -2; teller glass 3, stops pistols, SMGs and buckshot, an AR cracks it after 3 hits; brick/concrete impassable to bullets, breachable by explosives; vault walls only by thermal lance or charge. The preview draws the line through walls in a dashed style, showing remaining damage.

### 14. Overpenetration and human shields create interesting hostage dilemmas. High-pierce rounds continue through the first body.

**Evidence:** JA3: bullets can penetrate an enemy body to hit another enemy. Tarkov pen modelling: excess pen is wasted on the first target but matters for what is behind (genre).

**For BankHeist:** A DMR or slug that hits keeps going with Dmg - 3 if its Pierce >= 2. The preview shows the second target in the line. Police (and armed civilians) can grab a hostage as a shield. A shield-holder gets the hostage's hitbox as 'cover' that blocks 50% of hits, but blocked bullets hit the hostage, not furniture. This rewards the precise DMR and punishes spraying.

### 15. Shotguns, SMGs, rifles, LMGs and snipers each need a niche that the others cannot cover. Otherwise the best expected damage wins and the rest are just picks for flavour.

**Evidence:** Wasteland 3: SMGs are 'devastating' on a clear shot but poor against cover or heavy armour; shotguns are cheap (3 AP) cone weapons with high base hit chance; snipers are rated down 'due to high variance' (wikis/tier list). My cone math: an AR with 2 bullets is the generalist (about 2 hits at 2-5 tiles, 1.4 at 14 tiles) and would dominate on numbers alone.

**For BankHeist:** Niches: Uzi = concealable crowd spray, hits multiple bodies in a wide cone. SMG = concealable, suppressible, mobile. Shotgun = breaching locks and doors, close-range two-target cone, +1 damage per pellet within 3 tiles. AR = generalist, expensive conspicuousness. DMR = armour, overpenetration and the sniper nest. LMG = suppression and crowd control. The AR is balanced by its Consp 6 and its x2 moved penalty, not by its numbers.

### 16. Telegraph the enemy's threat in the same visual language as the player's: wedges and cones on the floor.

**Evidence:** Into the Breach telegraphs every enemy attack, so losses feel like your bad call (reviews; Davis GDC 2019). Door Kickers lets you hover enemies to see their vision cones.

**For BankHeist:** Enemies on overwatch show their overwatch wedge. Cops show 'will fire next turn' cones with expected hits on your crew during your planning phase (approximate, since they can move). The floor overlay for stealth uses the same colours as the danger overlay for combat, so one visual grammar covers both.

### 17. Overwatch in a cone game should be a wedge the player paints, not a fire-at-anything toggle.

**Evidence:** JA3's overwatch is an area cone (dev diary topics; not fetchable). Door Kickers 2 suppress cones can be dragged and resized in real time. XCOM's overwatch is binary and has hidden penalties (reaction shots carry an aim penalty; genre knowledge).

**For BankHeist:** Action 'Watch': drag a wedge, arc limited by the weapon (DMR 15 deg, AR 45 deg, shotgun 60 deg). The first hostile entering it triggers one attack with Aim x1.5 and a fire selector of up to half the Bullets. Narrower wedge = better aim (Aim x1 if the wedge is 15 deg or less). Mobile: one drag gesture.

### 18. Hiding the hit number is not the same as making it understandable. Hiding numbers splits players.

**Evidence:** JA3 showed chance-to-hit in early development, then removed it because 'visible chance to hit is not the kind of core experience we had in mind', and it showed contributing factors instead. THQ framed this as distinguishing it from XCOM clones (dev diary / community).

**For BankHeist:** Neither hide nor show a raw percentage. Show the physical cause (cone over the hitbox, cover shield, pierce through wall) plus an outcome band in plain words or pips. A long-press reveals the arithmetic, Battle Brothers-style tooltip: 'Cone 14 deg, target 4.8 deg, 6 bullets, cover halves > 1.0 expected'.

### 19. Don't stack independent random rolls: spread x cover x damage range x crit quickly turns into noise.

**Evidence:** XCOM layers hit roll + damage range + crit + graze and needs hidden assists to feel fair (Solomon: 'shaving off the lows' also shaves the highs). Into the Breach has almost none.

**For BankHeist:** Only two random layers: the stratified per-bullet position inside its cone slice, and the 50% cover roll. Damage, pierce and penetration are fixed. Instead of random crits, give a deterministic headshot or weak-spot bonus to precise weapons (DMR x1.5 damage against unaware targets).

### 20. Ammo and noise are the economy that limits big bursts, not cooldowns.

**Evidence:** Payday 2 weapons trade magazine and total ammo against damage and rate of fire (stat pages). Wasteland 3 SMGs list capacity and AP cost per shot (Fextralife). Our brief: every action has a noise circle.

**For BankHeist:** Each attack consumes Bullets from the magazine; reloading costs an action. Spare magazines are carried items, 2-3 per character. Noise radius per attack (suppressed pistol 3 tiles up to DMR 22) is drawn as a circle when the shot is previewed, so the player always sees who will hear it before firing.

## Pitfalls

- Invisible or unexplained cones (Fallout bursts) that hit companions and neutrals without warning. Every body in the cone must be highlighted before you commit.
- Cover the UI calls 'full' while geometry lets shots through (Phoenix Point). Cover status must match the actual hit logic exactly: half-shield shown means 50%, no shield means 0%.
- Not knowing whether a weapon destroys cover until after firing (Phoenix Point). Show cover HP and per-weapon damage to cover in the preview.
- Hidden aim assists or streak breakers (XCOM). Once found they undermine trust in every number. Use bounded, honest variance instead.
- Independent per-bullet randomness that still allows 'whole burst misses a target filling half the cone'. Stratify bullet positions.
- Stacking random layers (hit, damage range, crit, graze). Keep damage fixed.
- One generalist weapon (the AR) dominating on expected damage. Balance through conspicuousness, moving penalties, noise and ammo, not only spread.
- Free aim that needs pixel-precise dragging on a 320x180 phone screen. Default to snapping on the target's centre of mass, keep free aim optional with an inset and a confirm button.
- Flat armour subtraction that leaves multi-pellet weapons useless against armoured units with no answer. Give shotguns slugs and give the team pierce or shred options.
- Hiding the hit number entirely (JA3 approach). That alienates players who want to plan. Show physical causes plus an outcome band.
- Overpenetration and wall-piercing shown only after the fact. Players must see the second target and the through-wall path before shooting.
- Suppression that is just a stat debuff with no visible area. Make it a painted cone with clear behavioural consequences.

## Ideas

- STARTING ROSTER. Format is Aim deg / Recoil deg / Bullets / Dmg / Pierce / Threat tiles / Noise tiles / Consp 0-10 / Moved-x / Ammo. Suppressed pistol 5/5/2/3/0/3/3/1/x1/12. Revolver 3/-/1/5/1/4/12/2/x1/6. Machine pistol (Uzi) 14/3/6/2/0/4/10/2/x1/30. SMG 7/2/4/2/0/4/9 (4 suppressed)/3/x1.25/30. Pump shotgun 20/0/6 pellets/2 (+1 within 3 tiles)/0/6/14/5/x1/6 shells, with slug 3/-/1/6/2. Assault rifle 2/3/2/4/1/5/15/6/x2/30. DMR 1/-/1/9/3, overpenetrates at -3 dmg/5/22/8 (2 when cased)/x6/5. LMG 6/2 (1 braced)/10/3/1/7/20/9/x2 unless braced/100. Taser 2/-/1/stun 2 turns/0/3/2/1/x1/range 4 tiles/3 cartridges.
- Expected hits on a standing 0.5-tile target, no cover, at 2 / 5 / 9 / 14 tiles. Suppressed pistol 2.0/1.6/1.0/0.6. Uzi 4.2/1.7/0.9/0.6. SMG 4.0/2.4/1.3/0.9. Shotgun 4.3/1.7/1.0/0.6. AR 2.0/2.0/1.6/1.4. DMR 1.0 throughout. LMG 8.6/4.6/2.6/1.6, braced 10/5.9/3.3/2.1. Halve all of these when the target has cover.
- Target HP / armour: civilian 3/0, guard 5/0, crew 7/0 (plus worn armour), patrol cop 6/1, SWAT 7/1, heavy SWAT 12/3, shield SWAT 7/1 with a frontal shield that blocks bullets with pierce < 3. Crew armour: light vest +1 armour, +1 Consp; medium +2 armour, +3 Consp, -1 move; heavy +3 armour, +5 Consp, -2 move.
- Per-bullet damage formula: max(0, Dmg - max(0, Armor - Pierce)). Optional shred: every 3 bullets fully stopped by armour remove 1 armour point (gives the Uzi and SMG a 'strip' role).
- Fire selector: automatic weapons can fire 1..Bullets. Fewer bullets means a tighter pattern, less noise (noise radius x bullets/max, minimum 50%) and less ammo. That is the precision tool near hostages.
- Stratified spread rule: bullet k lands at a random point inside its own slice of its (Aim + k*Recoil) arc, so bursts always fan out evenly. Preview shows 'Hits 2-3 (likely 2)'.
- Cone preview as nested arcs: an inner bright arc for bullet 1, widening to the outer arc for the last bullet. It doubles as a free visual explanation of recoil, the pixel-art equivalent of Phoenix Point's two circles.
- Colour-coded bodies in the cone (red hostile, white civilian, blue crew), each with expected-hit pips. Civilians in the cone show a heat warning icon.
- Half-shield icon on covered targets; a cracked shield where the weapon will destroy the cover this attack.
- Through-wall shots drawn dashed, showing the damage that remains after each material.
- Bank material table: drywall needs pierce 1 (-1 dmg); wooden desk/door pierce 2 (-2 dmg, cover HP 6); teller glass stops pierce < 3, cracks after 3 AR hits, broken by DMR or explosives; marble pillar indestructible high cover; brick/concrete impassable to bullets, breachable with charges; vault walls need a thermal lance or shaped charge.
- Suppress fire mode: a dragged wedge, all bullets, spread doubled. Hostiles inside are Suppressed (Aim x1.5, no overwatch, provoke a 1-bullet reaction shot if they leave cover). Civilians inside drop prone for 2 turns, which counts as a command.
- Watch (overwatch) as a painted wedge capped by weapon (DMR 15 deg, AR 45 deg, shotgun 60 deg). A narrower wedge gives better aim, and it fires a limited burst at the first hostile entering.
- Human-shield mechanic: police or armed civilians can grab a hostage. The hostage acts as cover blocking 50% of hits, but the blocked bullets hit the hostage, which is a heat disaster. The DMR's precision and the fire selector are the answer.
- Brace action: deploy an LMG or DMR on cover or a bipod (halves recoil, removes the moved penalty next turn). Natural fit for the sniper nest in a neighbouring building.
- Less-lethal branch (taser, beanbag slugs) with low noise, low Consp and no heat from kills, at the cost of range and armour performance. Gives a non-violent route in the immersive-sim spirit.
- Gas canisters and fire extinguishers as cone-hittable props: a stray bullet sets them off, creating smoke that blocks line of sight or a hazard. The cone preview flags them in yellow.
- Long-press tooltip that shows the full arithmetic (cone deg, target deg, bullets, cover, armour) for players who want it, Battle Brothers-style.

## Open questions

- Should bullets that miss travel to full weapon range and hit things far behind (very simulationist, more collateral)? Or stop at a max effective range per weapon, e.g. SMG 10 tiles, so long-range strays aren't absurd?
- Is stratified spread too 'gamey' for this audience, or exactly right? A playtest could compare it against pure independent spread with the same mean.
- Should enemies' planned attacks be fully telegraphed (Into the Breach) or only approximately (overwatch wedges and facing)? Full telegraphing changes how tense the loud phase feels.
- Should armour shred exist? It adds team synergy but also bookkeeping, and every extra armour state needs a pip on a tiny screen.
- How big should hitboxes be for prone, kneeling and behind-low-cover bodies on a 16px grid, and should prone civilians be nearly unhittable by flat cones (so commanding them down also protects them)?
- Should crew members also have an accuracy stat that scales Aim (x0.8 for an elite marksman), or should all differentiation stay in the gear to keep it readable?
- Should the 50% cover block roll be per bullet (as the brief says) or stratified too, e.g. exactly half of the would-be hits blocked with the odd one rolled?
- Is the AR's 2-bullet burst too dominant once crew are past the stealth phase? It may need a reload every 15 attacks or extra noise to stay in check.
- Should the fire selector reduce noise, or should noise depend only on the weapon? Simpler to learn vs. a richer stealth/loud gradient.
- Is the remaining research worth a follow-up? The Phoenix Point accuracy/armour wiki numbers, the JA3 dev diaries (blocked), the Payday 2 Threat/suppression formulas and Shadowrun/Battle Brothers hit-chance UIs were not reached because the search budget ran out. The user can send a follow-up to continue.

## Sources

- [Jake Solomon explains the careful use of randomness in XCOM 2 (Game Developer)](https://www.gamedeveloper.com/design/jake-solomon-explains-the-careful-use-of-randomness-in-i-xcom-2-i-)
- [XCOM 2 Steam discussion: hidden aim assist config values](https://steamcommunity.com/app/268500/discussions/0/2944746708998250511)
- [XCOM 2 Steam discussion: miss-streak bonus per difficulty](https://steamcommunity.com/app/268500/discussions/0/412447331645399260)
- [XCOM 2 Nexus mod that displays hidden aim bonuses](https://www.nexusmods.com/xcom2/mods/212)
- [XCOM: Enemy Within adds 'Save Scum' option / bad streak breaker (GameBanshee)](https://www.gamebanshee.com/news/112504-xcom-enemy-within-adds-qsave-scumq-option.html)
- [XCOM wiki: Rifle Suppression](https://xcom.fandom.com/wiki/Rifle_Suppression)
- [Phoenix Point Year One Edition: helpful hints for XCOM players (free aim circles)](https://steamah.com/phoenix-point-year-one-edition-helpful-hints-for-xcom-players/)
- [Phoenix Point Year One review (Turn Based Lovers)](https://turnbasedlovers.com/review/phoenix-point-year-one-review)
- [Phoenix Point review (CGMagazine)](https://www.cgmagonline.com/reviews/phoenix-point-review/)
- [Phoenix Point Steam discussion: cover and flanking complaints](https://steamcommunity.com/app/839770/discussions/0/5051317596403847969)
- [Julian Gollop's Phoenix Point realistic ballistics (Gamewatcher)](https://www.gamewatcher.com/news/2017-01-09-julian-gollop-s-xcom-successor-phoenix-point-shows-off-its-geoscape-map-4x-style-exploration-and-realistic-ballistics)
- [Jagged Alliance 3 DevDiary 6 - Combat, Part One](https://community.jaggedalliance.com/index/dev-diaries/devdiary-6-combat-part-one-r10)
- [Jagged Alliance 3 DevDiary 12 - Combat, Part 2](https://community.jaggedalliance.com/index/dev-diaries/devdiary-12-combat-part-2-r17/)
- [S2: Silent Storm (GiantBomb)](https://www.giantbomb.com/games/3030-10967/)
- [Into the Breach Design Postmortem (GDC Vault)](https://gdcvault.com/play/1025772/-Into-the-Breach-Design)
- [Into the Breach preview / interview (PC Gamer)](https://pcgamer.com/into-the-breach-preview)
- [Door Kickers 2 Steam discussion: accuracy, fire modes, suppression](https://steamcommunity.com/app/1239080/discussions/0/3204869541730134048)
- [Frozen Synapse (GiantBomb)](https://giantbomb.com/wiki/Games/Frozen_Synapse)
- [Frozen Synapse Prime: Combat Basics (PlayStation Blog)](https://blog.playstation.com/?p=139817)
- [Fallout Wiki: Burst Shot](https://fallout.fandom.com/wiki/Burst_Shot)
- [Fallout 2 Mechanics Mini Rework (friendly fire fix)](https://www.nexusmods.com/fallout2/mods/50)
- [Wasteland 3 automatic weapons (Wasteland Wiki)](https://wasteland.fandom.com/wiki/Wasteland_3_automatic_weapons)
- [Wasteland 3 Tactical Shotgun (Fextralife)](https://wasteland3.wiki.fextralife.com/Tactical+Shotgun)
- [Payday 2 wiki: Mosconi 12G (concealment vs accuracy/stability)](https://payday.fandom.com/wiki/Mosconi_12G)
- [Payday 2 wiki: Contractor pistol](https://payday.fandom.com/wiki/Contractor)
- [Payday 2 Steam discussion: concealment and detection risk formula](https://steamcommunity.com/app/218620/discussions/8/135514151381032235)
- [Escape From Tarkov penetration explained (GGRecon)](https://www.ggrecon.com/guides/escape-from-tarkov-penetration/)
- [Battle Brothers wiki: loading screen tips (armour tradeoffs)](https://battlebrothers.fandom.com/wiki/Loading_Screen_Tips)
