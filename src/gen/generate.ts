import { bankDoors, bankFront, counterGate, defaultWalls, placeBank, railings, shortcuts } from './build';
import { buildFeatures } from './features';
import { Furnisher } from './furnish';
import { layoutBank } from './layout';
import { ARCHETYPES, PLOTS, TIERS, type Archetype, type GeneratedBank, type GenRoom, type Headline, type PlotKind, type Tier } from './model';
import { finishNeighbour, placeNeighbour, type Neighbour } from './neighbours';
import { composePlot, type Plot } from './plot';
import { Rng, seedOf } from './rng';
import type { Site } from './site';
import { rollTier, TIER_SPECS, type TierSpec } from './tiers';
import { placeWays } from './approaches';
import { keyGraph } from './keys';
import { Nav } from './nav';
import { furnishBank } from './parcels';
import { populate } from './population';
import { placeCameras, planGuards, trafficTiles } from './security';
import { RELAX_ORDER, RULES, validate, type Rule } from './validate';
import { TILE } from '../level/level';
import { WALL_HEIGHT } from '../level/space';

export interface GenerateOptions { layout: number; population: number; tier?: Tier; archetype?: Archetype; plot?: PlotKind }

/** The first stages (§17.2 steps 1–3 and 5): plot, archetype, the bank's rooms, walls and doors, the neighbours. */
export interface Shell {
    tier: Tier;
    archetype: Archetype;
    plotKind: PlotKind;
    headlines: Headline[];
    plot: Plot;
    site: Site;
    bank: GenRoom[];
    neighbours: Neighbour[];
    furnish: Furnisher;
    gateX: number;
    frontDoorX: number;
    skylight?: { x: number; y: number };
    /** The inside tile of the drive-through's teller window, its top half. */
    driveWindow?: { x: number; y: number };
}

/** Archetypes a tier can have: Mezzanine Watch needs a CCTV operator to put up on the mezzanine. */
export function archetypesFor(tier: Tier): Archetype[] {
    return ARCHETYPES.filter(a => a !== 'mezzanineWatch' || TIER_SPECS[tier].operator);
}

/** Rolls the plot, tier, archetype and the headlines that shape the building. */
export function rollShape(rng: Rng, opts: GenerateOptions): { tier: Tier; archetype: Archetype; plotKind: PlotKind; headlines: Headline[] } {
    // A pinned archetype narrows the tiers it can be rolled in (Mezzanine Watch needs an operator).
    let tier = opts.tier ?? rollTier(rng.fork('tier'));
    if (!opts.tier && opts.archetype && !archetypesFor(tier).includes(opts.archetype)) tier = rng.fork('tier-fit').pick(TIERS.filter(t => archetypesFor(t).includes(opts.archetype!)));
    if (opts.archetype && !archetypesFor(tier).includes(opts.archetype)) throw new Error(`A ${TIER_SPECS[tier].name.toLowerCase()} can't be a ${opts.archetype} bank`);
    const archetype = opts.archetype ?? rng.fork('archetype').pick(archetypesFor(tier));
    const plotKind = opts.plot ?? rng.fork('plot').pick(PLOTS);
    const pick = rng.fork('headlines');
    const headlines: Headline[] = [];
    // An archetype's own feature is its headline; the others are rolled from those this bank can have.
    if (archetype === 'atrium') headlines.push('atriumSkylight');
    if (archetype === 'mezzanineWatch') headlines.push('mezzanineCctv');
    const possible: Headline[] = ['oldBank', 'managerLate', 'scaffoldingNextDoor'];
    if (tier !== 'small') possible.push('armouredCar');
    if (plotKind === 'cornerLot' || plotKind === 'stripMallEnd') possible.push('driveThrough');
    if (plotKind === 'stripMallEnd') possible.push('mallBank');
    const want = headlines.length ? pick.int(0, 1) : pick.int(1, 2);
    for (const h of pick.shuffle(possible).slice(0, want)) headlines.push(h);
    return { tier, archetype, plotKind, headlines };
}

/** How many layouts of one lot to roll before giving up on it. */
const LAYOUT_ROLLS = 12;

/** Builds the shell: plot, bank rooms, walls, fronts and doors, neighbours. Undefined when this roll can't be built. */
export function buildShell(rng: Rng, shape: ReturnType<typeof rollShape>): Shell | undefined {
    const { tier, archetype, plotKind, headlines } = shape, spec = TIER_SPECS[tier];
    const W = rng.int(...spec.width), D = rng.int(...spec.depth);
    // A program that doesn't fit is cheap to roll again; the whole attempt is only spent when the lot can't be laid out.
    let layout: ReturnType<typeof layoutBank>;
    for (let k = 0; k < LAYOUT_ROLLS && !layout; k++) layout = layoutBank(rng.fork(k ? `layout-${k}` : 'layout'), tier, archetype, W, D, headlines.includes('oldBank'));
    if (!layout) return undefined;
    const plot = composePlot(rng.fork('plot'), plotKind, tier, W, D, { site: headlines.includes('scaffoldingNextDoor'), across: plotKind !== 'stripMallEnd' || rng.chance(0.5) });
    const site = plot.site;
    const neighbours = plot.slots.map(slot => placeNeighbour(site, slot, rng.fork(`neighbour-${slot.side}`)));
    const bank = placeBank(site, plot, layout);
    const soft = new Set<string>();
    for (const n of neighbours) if (n.party && n.soft) soft.add(n.party.id);
    defaultWalls(site, { rng, oldBank: headlines.includes('oldBank'), softOutside: archetype === 'fortress', softNeighbours: soft });
    const { door } = bankFront(site, plot, bank, rng.fork('front'));
    if (!bankDoors(site, plot, layout, bank, rng.fork('doors'))) return undefined;
    const { gateX } = counterGate(site, bank, rng.fork('gate'));
    shortcuts(site, bank, rng.fork('shortcuts'));
    const furnish = new Furnisher(site);
    const { window: driveWindow } = buildFeatures(site, plot, bank, headlines, rng.fork('features'), door, furnish);
    for (const n of neighbours) finishNeighbour(site, n, furnish, rng.fork(`finish-${n.slot.side}`));
    railings(site);
    const skylight = layout.skylight ? { x: plot.lot.x + layout.skylight.x, y: plot.lot.y + layout.skylight.y } : undefined;
    return { tier, archetype, plotKind, headlines, plot, site, bank, neighbours, furnish, gateX, frontDoorX: door, skylight, ...(driveWindow ? { driveWindow } : {}) };
}

/** A seed as text: `layout-population`. */
export function seedText(seed: { layout: number; population: number }): string {
    return `${seed.layout}-${seed.population}`;
}

/** Reads `layout-population` (or a lone layout seed, with population 0). */
export function parseSeed(text: string): { layout: number; population: number } {
    const [layout, population] = text.split('-');
    return { layout: seedOf(layout ?? '0'), population: seedOf(population ?? '0') };
}

/** How many layouts to roll before giving up on a seed, and after how many failures the next rule is relaxed. */
const ATTEMPTS = 60;
const RELAX_EVERY = 10;

const BANK_NAMES = ['Harbour', 'Union', 'Granite', 'Meridian', 'Northgate', 'Crown', 'Lindenhof', 'Vesper', 'Atlas', 'Beacon'];
const BANK_KINDS = ['Savings', 'Trust', 'Mutual', 'Commercial Bank', 'Bank & Loan'];
const STREETS = ['Mill Street', 'Canal Row', 'Station Road', 'Market Square', 'Elm Avenue', 'Quay Street', 'Church Lane', 'Fifth Street'];

/**
 * Generates a bank (§17.2). The layout seed decides the building and everything fixed in it (rooms, walls, furniture,
 * cameras, guard posts, the ways in); the population seed decides who is in it and when (so a layout can be replayed
 * with new people, and seeds can be shared). Each roll is validated (§17.7); after every `RELAX_EVERY` failures the
 * next rule in `RELAX_ORDER` is relaxed.
 */
export function generateBank(opts: GenerateOptions): GeneratedBank {
    const rng = new Rng(opts.layout);
    const shape = rollShape(rng, opts);
    const spec = TIER_SPECS[shape.tier];
    const relaxed: Rule[] = [];
    let last: GeneratedBank | undefined;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        if (attempt && attempt % RELAX_EVERY === 0 && relaxed.length < RELAX_ORDER.length) relaxed.push(RELAX_ORDER[relaxed.length]!);
        const roll = rng.fork(`attempt-${attempt}`);
        const shell = buildShell(roll, shape);
        if (!shell) continue;
        const bank = finishBank(shell, roll, new Rng(opts.population ^ (attempt * 0x9e3779b1)), spec, opts);
        bank.validation.attempts = attempt + 1;
        // Only the relaxed rules this bank actually breaks: relaxing goes by the attempt count, not by which rule failed.
        bank.validation.relaxed = relaxed.map(r => RULES[r]).filter(rule => bank.validation.results.some(x => x.rule === rule && !x.ok));
        last = bank;
        const failed = bank.validation.results.filter(r => !r.ok && !relaxed.some(x => RULES[x] === r.rule));
        if (!failed.length) return bank;
    }
    if (last) return last;
    throw new Error(`No bank could be built from seed ${opts.layout} (${shape.tier} ${shape.archetype} ${shape.plotKind})`);
}

/** The stages after the shell (§17.2 steps 4–8): furnish, secure, open the ways in, populate, check. */
function finishBank(shell: Shell, rng: Rng, people: Rng, spec: TierSpec, opts: GenerateOptions): GeneratedBank {
    const { site, plot, bank, furnish, tier, archetype, headlines } = shell;
    const vaultClass = rng.fork('vault').pick(spec.vaultClasses);
    const timeLock = archetype === 'threeKeys' || headlines.includes('armouredCar') || rng.fork('timelock').chance(spec.timeLock);
    const parcelCtx = { gateX: shell.gateX, tellers: spec.tellers[1], frontDoorX: shell.frontDoorX, metalDetector: spec.metalDetector, motionSensors: spec.motionSensors, dyePacks: spec.dyePacks, vaultClass, ...(shell.driveWindow ? { driveWindow: shell.driveWindow } : {}) };
    const furnished = furnishBank(site, bank, furnish, rng.fork('parcels'), parcelCtx);
    // Full-height furniture blocks sight (§8.3); low furniture doesn't. A grid, read for every line of sight.
    const tallGrid = new Uint8Array(site.width * site.height);
    const markTall = () => {
        for (const { box } of furnish.boxes) if (box.h >= WALL_HEIGHT - 4 && box.z === 0) {
            for (let y = Math.floor(box.y / TILE); y <= Math.floor((box.y + box.d - 1) / TILE); y++) for (let x = Math.floor(box.x / TILE); x <= Math.floor((box.x + box.w - 1) / TILE); x++) tallGrid[y * site.width + x] = 1;
        }
    };
    markTall();
    const tall = (x: number, y: number) => tallGrid[y * site.width + x] === 1;
    const ways = placeWays({ site, plot, bank, neighbours: shell.neighbours, furnished, furnish, nav: new Nav(site, furnish), rng: rng.fork('ways'), tier, frontDoorX: shell.frontDoorX, skylight: shell.skylight, softOutside: archetype === 'fortress' });
    const nav = new Nav(site, furnish);
    markTall();
    const traffic = trafficTiles(site, nav, bank);
    const cameras = placeCameras(site, furnish, nav, furnished.cameraSlots, traffic, rng.fork('cameras').int(...spec.cameras), rng.fork('camera-pick'), tall);
    const guards = planGuards(nav, bank, furnish, rng.fork('guards'), rng.fork('guard-count').int(...spec.guards), spec.chief, { x: shell.frontDoorX, y: plot.lot.y + plot.lot.h - 1 });
    const softDepositWall = shell.neighbours.some(n => n.party && n.soft && n.slot.kind === 'cafe' && bank.some(r => r.type === 'depositBoxes' && site.sharedEdges(n.party!, r).length));
    const pop = populate({ rng: people, tier, headlines, bank, neighbours: shell.neighbours, furnished, guards, nav, furnish, timeLock, softDepositWall, sidewalkY: plot.sidewalkY, width: site.width });
    const locks = keyGraph({ archetype, vaultClass, timeLock, dualControl: spec.dualControl, rooms: bank, doors: site.doors, people: pop.people });
    const results = validate({ site, nav, bank, doors: site.doors, approaches: ways.approaches, cameras, guards, furnished, getaways: ways.getaways, exits: ways.exits, traffic, tall });
    const named = rng.fork('name');
    return {
        seed: { layout: opts.layout, population: opts.population },
        name: `${named.pick(BANK_NAMES)} ${named.pick(BANK_KINDS)}, ${named.pick(STREETS)}`,
        tier, archetype, plot: shell.plotKind, headlines, vaultClass, timeLock, dualControl: spec.dualControl, policeEta: spec.policeEta,
        level: site.level(), rooms: site.rooms, doors: site.doors, props: site.props, people: pop.people, cameras, locks,
        approaches: ways.approaches, routes: ways.routes, getaways: ways.getaways, exits: ways.exits, staging: ways.staging,
        neighbours: shell.neighbours.map(n => n.slot.kind), timeline: pop.timeline, opportunities: pop.opportunities, intel: pop.intel,
        validation: { results, relaxed: [], attempts: 0 }
    };
}
