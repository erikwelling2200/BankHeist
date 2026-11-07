import type { Archetype, PlotKind } from '../gen/model';

/** How the briefing and the generator bar name the archetypes and plots (§17.2). */
export const ARCHETYPE_NAMES: Record<Archetype, string> = { twoWing: 'Two Wing', atrium: 'Atrium', threeKeys: 'Three Keys', fortress: 'Fortress', mezzanineWatch: 'Mezzanine Watch' };
export const PLOT_NAMES: Record<PlotKind, string> = { midBlock: 'mid-block', cornerLot: 'corner lot', plazaFront: 'plaza front', stripMallEnd: 'strip-mall end' };

/** How the planning screen names the crew's items (§7.3, §12). */
export const ITEM_NAMES: Readonly<Record<string, string>> = {
    taser: 'Taser', pistol: 'Pistol', suppressedPistol: 'Suppressed pistol', machinePistol: 'Machine pistol', smg: 'SMG', suppressedSmg: 'Suppressed SMG',
    shotgun: 'Shotgun', assaultRifle: 'Assault rifle', dmr: 'DMR', lmg: 'LMG', lightVest: 'Light vest', mediumArmour: 'Medium armour',
    heavyArmour: 'Heavy armour', flashbang: 'Flashbangs', smoke: 'Smoke grenades', noisemaker: 'Noisemakers', breachCharge: 'Breach charges',
    shapedCharge: 'Shaped charge', thermite: 'Thermite', drill: 'Drill', tripwire: 'Tripwires', jammer: 'Jammer', hackingKit: 'Hacking kit',
    lockpick: 'Lockpick set', glassCutter: 'Glass cutter', medkit: 'Medkit', duffel: 'Duffel', ammoBag: 'Ammo bag', reinforcementKit: 'Reinforcement kit',
    zipTies: 'Zip-ties'
};

/** How the planning screen names the traits (§7.2). */
export const TRAIT_NAMES: Readonly<Record<string, string>> = {
    steadyHands: 'Steady Hands', smoothTalker: 'Smooth Talker', intimidating: 'Intimidating', bruiser: 'Bruiser', marksman: 'Marksman',
    sapper: 'Sapper', wheelman: 'Wheelman', medic: 'Medic', forgettable: 'Forgettable', coolHead: 'Cool Head'
};

/** NPC roles as the player reads them. */
export const ROLE_NAMES: Readonly<Record<string, string>> = {
    headTeller: 'head teller', lobbyGuard: 'lobby guard', patrolGuard: 'patrol guard', chief: 'security chief', operator: 'CCTV operator', 'passer-by': 'passer-by',
    clerk: 'clerk', counter: 'cash counter', archivist: 'archivist', technician: 'ATM technician'
};
