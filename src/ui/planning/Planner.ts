import type { GeneratedBank } from '../../gen/model';
import {
    ASSETS, assetsOf, CREW_SIZE, FAVOUR_CAP, hasLongGun, heistIntel, inArmoury, INTEL_ASSETS, jammerSpot, loadoutProfile, rosterMember, ROSTER, SANDBOX_PURSE, setupProblems,
    SLOT_ITEMS, spent, startView, type AssetId, type CrewPlan, type HeistSetup, type PlanOptions, type Purse, type StartPick
} from '../../game/plan';
import { intelSummary, noIntel } from '../../game/intel';
import { CONTRACT_TARGETS, footprint, VEHICLES, type Intel, type ItemId, type MarkerKind, type Pos, type State, type VehicleType } from '../../sim';
import { h, img } from '../hud/dom';
import { iconUrl, portraitUrl } from '../hud/icons';
import { crewColour, type HudIcon } from '../hud/viewModels';
import { ITEM_NAMES, ROLE_NAMES, TRAIT_NAMES } from '../names';
import '../hud/hud.css';
import './planning.css';

/*
 * The planning screen (GAME_DESIGN §18, UI.md "Map, planning and campaign", M4-07): HTML over the bank's tactical map,
 * as the mockup's Planning board lays it out. The top strip names the contract (target, police in, vault) and what is
 * left to spend (cash, favours); the crew rail on the left shows each crew member's portrait, profile, weapon and start
 * (a tap opens their loadout); the assets on the right with their price and favour pips (a tap buys or sells; a
 * placed one shows where on the map, and a tap on its pin moves it); Start bottom right, dimmed with the first thing
 * in the way said above it. The map's pins follow the camera every frame.
 *
 * What the crew knows (§17.8, M5-03): the map shows the bank at turn 1 as the crew will know it, with the intel of
 * earlier heists in it and the intel assets bought; the Intel chip in the top strip opens what that intel holds. An
 * intel asset is paid as it is bought, since the map shows what it tells at once: it can't be given back (decision 401).
 *
 * In the campaign (M6-03) the plan spends the campaign's money and gear (`PlannerFunds`): the cash chip shows its clean
 * money, the loadouts offer what the armoury holds, and an intel asset is bought from the campaign at once and kept.
 */

/** The campaign's money for the plan: its purse, and buying an intel asset from it (the intel and purse after, or why not). */
export interface PlannerFunds {
    purse: Purse;
    buyIntel(asset: 'blueprints' | 'guardRota'): { intel: Intel; purse: Purse } | string;
}

/** What the planner needs of the bank scene: where tiles show on the page and the reverse, for its pins and taps. */
export interface PlanMap {
    tileOnPage(x: number, y: number): { x: number; y: number };
    tileAtPage(x: number, y: number): Pos;
    /** Draws the heist's start as planned: the NPCs the crew knows (by the bank's people's order) and the vehicles. */
    showPlan(view: { npcs: readonly (MarkerKind | null)[]; vehicles: State['vehicles']; visibility: Uint8Array }): void;
}

/** Each item's picture on the planning screen. */
const ITEM_ICONS: Readonly<Record<string, HudIcon>> = {
    taser: 'pistol', pistol: 'pistol', suppressedPistol: 'pistol', machinePistol: 'pistol', smg: 'smg', suppressedSmg: 'smg', shotgun: 'shotgun',
    assaultRifle: 'smg', dmr: 'dmr', lmg: 'lmg', lightVest: 'vest', mediumArmour: 'vest', heavyArmour: 'vest', flashbang: 'grenade', smoke: 'grenade',
    noisemaker: 'throw', breachCharge: 'charge', shapedCharge: 'charge', thermite: 'charge', drill: 'drill', tripwire: 'charge', jammer: 'radio',
    hackingKit: 'hack', lockpick: 'lockpick', glassCutter: 'kit', medkit: 'medkit', ammoBag: 'reload', reinforcementKit: 'shield', zipTies: 'ziptie'
};

const VEHICLE_ICONS: Readonly<Record<VehicleType, HudIcon>> = { van: 'car', car: 'car', ramTruck: 'truck' };
const ASSET_ICONS: Readonly<Record<AssetId, HudIcon>> = { blueprints: 'map', guardRota: 'watch', ramTruck: 'truck', car: 'car', nest: 'dmr', jammer: 'radio' };

/** How the planning screen names how an opportunity was found. */
const HOW_NAMES = { overheard: 'Overheard', read: 'Read', intel: 'Intel' } as const;

/** A start as the select names it, and back. */
const startKey = (s: StartPick): string => (s.at === 'nest' ? 'nest' : `${s.at}:${s.aboard ? 'in' : 'by'}`);
function startOf(key: string): StartPick {
    if (key === 'nest') return { at: 'nest' };
    const [at, how] = key.split(':') as [VehicleType, string];
    return { at, aboard: how === 'in' };
}

const thousands = (n: number): string => `${Math.round(n / 1000)}k`;

/** Where the colour-blind preset is remembered (as play mode's). */
const COLOUR_BLIND_KEY = 'bankheist.colourBlind';
function colourBlind(): boolean {
    if (new URLSearchParams(location.search).has('cb')) return true;
    try {
        return localStorage.getItem(COLOUR_BLIND_KEY) === '1';
    } catch {
        return false;
    }
}

export class Planner {
    readonly root: HTMLDivElement;
    private readonly pins: HTMLDivElement;
    private readonly rail: HTMLDivElement;
    private readonly assets: HTMLDivElement;
    private readonly top: HTMLDivElement;
    private readonly start: HTMLButtonElement;
    private readonly problem: HTMLDivElement;
    private readonly hint: HTMLDivElement;
    private sheet?: HTMLDivElement;
    /** The vehicle or the jammer being placed: its pins or a tap on the map put it. */
    private placing: VehicleType | 'jammer' | null = null;
    /** Crew left out of the plan keep their loadout and start, should they come back. */
    private readonly benched = new Map<string, CrewPlan>();
    private frame = 0;
    /** The heist's start as the plan stands (the last playable plan's), and the one the map shows. */
    private view?: Parameters<PlanMap['showPlan']>[0];
    private shownView?: Parameters<PlanMap['showPlan']>[0];
    /** Start was pressed and the game is being opened (or the player asked about a saved heist). */
    private starting = false;
    private down?: { x: number; y: number };
    /** What the plan may spend: the sandbox's, or the campaign's as it stands. */
    private purse: Purse;

    constructor(
        private readonly bank: GeneratedBank, private readonly options: PlanOptions, private setup: HeistSetup,
        private readonly map: () => PlanMap | undefined, private readonly onStart: (setup: HeistSetup) => void | Promise<void>,
        private readonly funds?: PlannerFunds
    ) {
        this.purse = funds?.purse ?? SANDBOX_PURSE;
        this.root = h('div.sh.pl', { 'data-planner': '' });
        this.root.classList.toggle('cb', colourBlind());
        this.pins = h('div.pl-pins');
        this.top = h('div.sh-top.pl-top');
        this.rail = h('div.pl-rail', { role: 'list', 'aria-label': 'Crew' });
        this.assets = h('div.pl-assets', { role: 'list', 'aria-label': 'Assets' });
        this.problem = h('div.pl-problem.sh-panel', { role: 'status' });
        this.hint = h('div.pl-hint.sh-panel', { role: 'status' });
        this.start = h('button.sh-confirm.pl-start', { 'aria-label': 'Start the heist' }, img(iconUrl('play')), h('span.sh-cname', {}, 'Start'));
        this.start.addEventListener('click', () => {
            if (this.starting || setupProblems(this.setup, this.options, this.purse).length) return;
            this.starting = true;
            void Promise.resolve(this.onStart(structuredClone(this.setup))).finally(() => (this.starting = false));
        });
        this.root.append(this.pins, this.top, this.rail, this.assets, this.hint, this.problem, this.start);
        document.body.append(this.root);
        document.body.classList.add('planning');
        window.addEventListener('pointerdown', this.onDown, true);
        window.addEventListener('pointerup', this.onUp, true);
        window.addEventListener('keydown', this.onKey);
        this.render();
        const tick = () => {
            // The map shows the start as planned once the scene is up, and again after every change.
            const map = this.map();
            if (map && this.view && this.view !== this.shownView) {
                map.showPlan(this.view);
                this.shownView = this.view;
            }
            this.placePins();
            this.frame = requestAnimationFrame(tick);
        };
        this.frame = requestAnimationFrame(tick);
    }

    /** The plan as it stands. */
    get plan(): HeistSetup {
        return structuredClone(this.setup);
    }

    destroy(): void {
        cancelAnimationFrame(this.frame);
        window.removeEventListener('pointerdown', this.onDown, true);
        window.removeEventListener('pointerup', this.onUp, true);
        window.removeEventListener('keydown', this.onKey);
        document.body.classList.remove('planning');
        this.root.remove();
    }

    // ------------------------------------------------------------------------------------------------------ Changes

    private change(edit: (s: HeistSetup) => void): void {
        edit(this.setup);
        this.render();
    }

    private toggleAsset(id: AssetId): void {
        const owned = assetsOf(this.setup).includes(id);
        if (id === 'blueprints' || id === 'guardRota') {
            // Paid as bought, and known for good (decision 401): never given back, never bought twice or beyond the cash.
            if (owned || this.setup.intel[id] || !this.affords(id)) return;
            if (this.funds) {
                // The campaign's: paid from its money and saved now, then known as intel from before (M6-03).
                const bought = this.funds.buyIntel(id);
                if (typeof bought === 'string') {
                    this.hint.textContent = bought;
                    this.hint.hidden = false;
                    return;
                }
                this.purse = bought.purse;
                this.change(s => { s.intel = bought.intel; });
            } else this.change(s => { s[id] = true; });
        } else if (id === 'jammer') {
            if (owned || this.placing === 'jammer') this.change(s => { s.jammer = null; });
            this.placing = owned || this.placing === 'jammer' ? null : 'jammer';
        } else if (id === 'nest') {
            this.change(s => {
                s.nest = !owned;
                // Nobody stays in a nest given back: they wait in the van.
                if (owned) for (const c of s.crew) if (c.start.at === 'nest') c.start = { at: 'van', aboard: true };
            });
        } else {
            const type: VehicleType = id;
            if (owned) {
                this.placing = null;
                this.change(s => {
                    delete s.vehicles[type];
                    for (const c of s.crew) if (c.start.at === type) c.start = { at: 'van', aboard: c.start.aboard };
                });
            } else {
                const free = this.freeSpots(type)[0];
                if (!free) return;
                this.placing = type;
                this.change(s => { s.vehicles[type] = free; });
            }
        }
        this.render();
    }

    /** Whether the cash and favours left pay for an asset. */
    private affords(id: AssetId): boolean {
        const { cash, favours } = spent(this.setup);
        return cash + ASSETS[id].cost <= this.purse.cash && favours + ASSETS[id].favours <= this.purse.favours;
    }

    /** The spots a vehicle could move to: its own and those no other vehicle of the plan takes. */
    private freeSpots(type: VehicleType): string[] {
        const taken = new Set(Object.entries(this.setup.vehicles).filter(([t]) => t !== type).map(([, spot]) => spot));
        return this.options.spots[type].filter(s => !taken.has(s.id)).map(s => s.id);
    }

    private toggleCrew(id: string): void {
        this.change(s => {
            const i = s.crew.findIndex(c => c.id === id);
            if (i >= 0) {
                this.benched.set(id, s.crew[i]!);
                s.crew.splice(i, 1);
            } else if (s.crew.length < CREW_SIZE) {
                const back = this.benched.get(id) ?? { id, loadout: structuredClone(rosterMember(id)!.loadout), start: { at: 'van', aboard: false } };
                // A start that went with an asset sold since is by the van.
                const { start } = back;
                if (start.at === 'nest' ? !s.nest || !hasLongGun(back.loadout) : s.vehicles[start.at] === undefined) back.start = { at: 'van', aboard: false };
                s.crew.push(back);
                s.crew.sort((a, b) => ROSTER.findIndex(m => m.id === a.id) - ROSTER.findIndex(m => m.id === b.id));
            }
        });
    }

    // ------------------------------------------------------------------------------------------------------ Taps

    /** Escape closes the loadout, or stops placing. */
    private readonly onKey = (e: KeyboardEvent): void => {
        if (e.key !== 'Escape') return;
        if (this.sheet) this.closeSheet();
        else if (this.placing) {
            this.placing = null;
            this.render();
        }
    };

    private readonly onDown = (e: PointerEvent): void => {
        this.down = { x: e.clientX, y: e.clientY };
    };

    /** A tap (not a drag) on the map while the jammer is being placed puts it there, if it may stand there. */
    private readonly onUp = (e: PointerEvent): void => {
        const from = this.down;
        this.down = undefined;
        if (this.placing !== 'jammer' || !from || Math.hypot(e.clientX - from.x, e.clientY - from.y) > 10) return;
        if (!(e.target instanceof HTMLCanvasElement)) return;
        const map = this.map();
        if (!map) return;
        const tile = map.tileAtPage(e.clientX, e.clientY);
        if (!jammerSpot(this.options, tile)) {
            this.hint.textContent = 'Not there: outside, next to the building';
            return;
        }
        this.placing = null;
        this.change(s => { s.jammer = tile; });
    };

    // ------------------------------------------------------------------------------------------------------ Drawing

    private render(): void {
        this.renderTop();
        this.renderRail();
        this.renderAssets();
        this.renderPins();
        const problems = setupProblems(this.setup, this.options, this.purse);
        if (!problems.length) {
            const start = startView(this.bank, this.setup, this.options);
            this.view = { npcs: this.bank.people.map(p => (Object.hasOwn(start.npcs, p.id) ? start.npcs[p.id]! : null)), vehicles: start.vehicles, visibility: start.visibility };
        }
        this.start.classList.toggle('off', problems.length > 0);
        this.start.setAttribute('aria-disabled', String(problems.length > 0));
        this.problem.textContent = problems[0] ?? '';
        this.problem.hidden = !problems.length;
        const placing = this.placing;
        this.hint.hidden = placing === null;
        this.hint.textContent = placing === 'jammer' ? `Tap the street by the bank: it jams from turn 1, and dispatch notices after ${this.options.world.rules.dispatchSilence} phases`
            : placing ? `Tap a spot for the ${VEHICLES[placing].name.toLowerCase()}` : '';
        if (this.sheet?.dataset.crew) this.openSheet(this.sheet.dataset.crew);
        else if (this.sheet) this.openIntel();
    }

    private renderTop(): void {
        const { cash, favours } = spent(this.setup);
        const target = this.bank.tier in CONTRACT_TARGETS ? CONTRACT_TARGETS[this.bank.tier]! : 0;
        // Favours called in for this bank today (the campaign's intel bought) count against the cap too.
        const called = favours + FAVOUR_CAP - this.purse.favours;
        const pips = Array.from({ length: FAVOUR_CAP }, (_, i) => h(`i.pl-pip${i < called ? '.on' : ''}`));
        const left = this.purse.cash - cash;
        this.top.replaceChildren(
            h('div.sh-panel.pl-chip', { 'aria-label': `Target $${thousands(target)}` }, img(iconUrl('loot')), h('span.sh-num', {}, thousands(target))),
            h('div.sh-panel.pl-chip', { 'aria-label': `Police in ${this.bank.policeEta} turns, vault class ${this.bank.vaultClass}` },
                img(iconUrl('police')), h('span.sh-num', {}, String(this.bank.policeEta)), h('span.pl-bar'), img(iconUrl('lock')), h('span.sh-num', {}, this.bank.vaultClass)),
            this.intelChip(),
            h('div.sh-grow'),
            h(`div.sh-panel.pl-chip.pl-cash${left < 0 ? '.over' : ''}`, { 'aria-label': `$${thousands(left)} left`, 'data-cash': String(left) },
                h('span.sh-num.pl-dollar', {}, '$'), h('span.sh-num', {}, thousands(left))),
            h(`div.sh-panel.pl-chip.pl-favours${called > FAVOUR_CAP ? '.over' : ''}`, { 'aria-label': `${called} of ${FAVOUR_CAP} favours`, 'data-favours': String(called) },
                h('span.sh-num.pl-star', {}, '★'), h('span.pl-pips', {}, ...pips))
        );
    }

    /** The Intel chip: what the crew knows going in (the intel's finds counted); a tap lists it. */
    private intelChip(): HTMLElement {
        const intel = heistIntel(this.setup), sum = intelSummary(this.options.world, intel), none = noIntel(intel);
        const parts = [sum.blueprints ? 'blueprints' : '', sum.guardRota ? 'guard rota' : '', sum.rooms ? `${sum.rooms} room${sum.rooms === 1 ? '' : 's'} cased` : '',
            sum.routines.length ? `${sum.routines.length} routine${sum.routines.length === 1 ? '' : 's'}` : '',
            sum.finds.length ? `${sum.finds.length} find${sum.finds.length === 1 ? '' : 's'}` : ''].filter(Boolean);
        const chip = h(`button.sh-panel.pl-chip.pl-intel${none ? '' : '.on'}`, {
            'aria-label': `Intel: ${none ? 'nothing yet' : parts.join(', ')}`, 'data-finds': String(sum.finds.length), 'data-rooms': String(sum.rooms),
            'data-routines': String(sum.routines.length)
        }, img(iconUrl('layers')), h('span.pl-intel-name', {}, 'Intel'), sum.finds.length ? h('span.sh-num', {}, String(sum.finds.length)) : null);
        chip.addEventListener('click', () => this.openIntel());
        return chip;
    }

    /** The intel sheet: the intel bought, what earlier heists cased, the opportunities found. Only what the intel holds. */
    private openIntel(): void {
        const intel = heistIntel(this.setup), sum = intelSummary(this.options.world, intel);
        const asset = (id: 'blueprints' | 'guardRota', what: string) => {
            const state = this.setup.intel[id] ? 'known from before' : this.setup[id] ? 'bought' : `not bought ($${thousands(ASSETS[id].cost)})`;
            return h(`li.pl-intel-row${sum[id] ? '.on' : ''}`, { 'data-intel': id }, img(iconUrl(ASSET_ICONS[id]), 'sh-ic'), h('span', {}, `${ASSETS[id].name}: ${what}`), h('span.pl-intel-state', {}, state));
        };
        const cased = sum.rooms || sum.routines.length
            ? `${sum.rooms} room${sum.rooms === 1 ? '' : 's'} seen into; ${sum.routines.length ? `the routine${sum.routines.length === 1 ? '' : 's'} of ${sum.routines.map(r => `${r.name} (${ROLE_NAMES[r.role] ?? r.role})`).join(', ')}` : 'no routines'}`
            : 'Nothing: what a heist sees, the routines it learns and what it finds are kept for the next one here.';
        const sheet = h('div.pl-sheet.sh-panel.pl-intel-sheet', { role: 'dialog', 'aria-label': 'Intel', 'data-intel-sheet': '' },
            h('div.pl-head', {}, img(iconUrl('layers'), 'sh-ic'), h('div.pl-who', {}, h('span.pl-title', {}, 'Intel'), h('span.sh-tiny', {}, `What the crew knows of ${this.bank.name}`))),
            h('ul.pl-intel-list', {},
                asset('blueprints', 'the full layout'),
                asset('guardRota', "every guard's routine"),
                h('li.pl-intel-row', { 'data-intel': 'cased' }, img(iconUrl('eye'), 'sh-ic'), h('span', {}, `Cased before: ${cased}`))),
            sum.finds.length ? h('ul.pl-intel-list.pl-finds', {}, ...sum.finds.map(f =>
                h('li.pl-intel-row', { 'data-find': f.id }, img(iconUrl(f.how === 'overheard' ? 'ear' : f.how === 'read' ? 'eye' : 'layers'), 'sh-ic'),
                    h('span', {}, f.text), h('span.pl-intel-state', {}, HOW_NAMES[f.how])))) : null,
            h('div.pl-buttons', {}, h('button.pl-button.pl-done', { 'aria-label': 'Done' }, 'Done')));
        sheet.querySelector('.pl-done')!.addEventListener('click', () => this.closeSheet());
        if (this.sheet) this.sheet.replaceWith(sheet);
        else this.root.append(sheet);
        this.sheet = sheet;
    }

    private renderRail(): void {
        const cards = ROSTER.map((m, i) => {
            const plan = this.setup.crew.find(c => c.id === m.id);
            const shown = plan ?? this.benched.get(m.id) ?? { id: m.id, loadout: m.loadout, start: { at: 'van', aboard: false } as StartPick };
            const { loadout } = shown, weapon = loadout.primary ?? loadout.sidearm;
            const start = plan ? (plan.start.at === 'nest' ? 'in the nest' : `${plan.start.aboard ? 'in' : 'by'} the ${VEHICLES[plan.start.at].name.toLowerCase()}`) : 'not coming';
            const portrait = portraitUrl(m.id);
            const card = h(`button.sh-panel.pl-card${plan ? '' : '.out'}`, {
                role: 'listitem', 'data-crew': m.id, style: `--c: ${crewColour(m.id, i)}`,
                'aria-label': `${m.name}, ${loadoutProfile(loadout)}, ${start}`
            },
            portrait ? img(portrait, 'pl-portrait') : h('span.pl-portrait', {}, m.name[0]!),
            img(iconUrl(loadoutProfile(loadout)), 'sh-ic pl-gear'),
            weapon ? img(iconUrl(ITEM_ICONS[weapon] ?? 'kit'), 'sh-ic pl-gear') : h('span.pl-gear'),
            plan ? h('span.pl-from', {}, img(iconUrl(plan.start.at === 'nest' ? 'dmr' : VEHICLE_ICONS[plan.start.at]), 'sh-ic'), plan.start.at !== 'nest' && !plan.start.aboard ? h('span.pl-by', {}, 'by') : null) : null);
            card.addEventListener('click', () => this.openSheet(m.id));
            return card;
        });
        const starts = this.setup.crew.reduce((n, c) => n + (c.start.at === 'nest' ? 0 : 1), 0);
        const nest = this.setup.crew.length - starts;
        this.rail.replaceChildren(...cards, h('div.sh-panel.pl-starts', { 'aria-label': `${starts} start by the vehicles, ${nest} in the nest` },
            img(iconUrl('car')), h('span.sh-num', {}, String(starts)), h('span.pl-bar'), img(iconUrl('dmr')), h('span.sh-num', {}, String(nest))));
    }

    private renderAssets(): void {
        const owned = assetsOf(this.setup);
        this.assets.replaceChildren(...(Object.keys(ASSETS) as AssetId[]).filter(id => id !== 'nest' || this.options.nestRoom).map(id => {
            const intel = INTEL_ASSETS.includes(id), known = intel && !!this.setup.intel[id as 'blueprints' | 'guardRota'];
            const a = ASSETS[id], on = known || owned.includes(id) || this.placing === id;
            // A vehicle with no spot left to wait at can't be bought; intel can't be given back once bought, nor bought
            // beyond the cash, nor again when the crew has it from before.
            const full = !on && (id === 'car' || id === 'ramTruck') && !this.freeSpots(id).length;
            const fixed = intel && (on || !this.affords(id));
            const label = known ? `${a.name}, known from before` : intel && on ? `${a.name}, bought` : `${a.name}, $${thousands(a.cost)}, ${a.favours} favour${a.favours === 1 ? '' : 's'}`;
            const b = h(`button.sh-panel.pl-asset${on ? '.on' : ''}${known ? '.known' : ''}${intel && on ? '.paid' : ''}`, {
                ...(full || fixed ? { disabled: true } : {}),
                role: 'listitem', 'data-asset': id, 'aria-pressed': String(on), 'aria-label': label
            }, img(iconUrl(ASSET_ICONS[id])), h('span.sh-num', {}, known ? '✓' : thousands(a.cost)), h('span.pl-name', {}, a.name), h('span.pl-short', {}, a.short),
            h('span.pl-fv', {}, ...Array.from({ length: known ? 0 : a.favours }, () => h('i'))));
            b.addEventListener('click', () => this.toggleAsset(id));
            // A jammer running from turn 1 starts dispatch's lost-contact count then (decision 324).
            if (id === 'jammer' && owned.includes('jammer')) return h('div.pl-with-note', {}, b, h('span.pl-note', {}, `Dispatch notices in ${this.options.world.rules.dispatchSilence}`));
            return b;
        }));
    }

    /** The map's pins: each crew vehicle's spot (and, while one is placed, the spots it could go), the nest, the jammer. */
    private renderPins(): void {
        const pins: HTMLElement[] = [];
        const vehicles = Object.entries(this.setup.vehicles) as [VehicleType, string][];
        const placing = this.placing;
        if (placing && placing !== 'jammer') {
            for (const id of this.freeSpots(placing)) {
                if (this.setup.vehicles[placing] === id) continue;
                const spot = this.options.spots[placing].find(s => s.id === id)!;
                const pin = h('button.pl-spot', { 'data-spot': id, 'data-vehicle': placing, 'aria-label': `${VEHICLES[placing].name}: ${spot.name}` });
                pin.addEventListener('click', () => {
                    this.placing = null;
                    this.change(s => { s.vehicles[placing] = id; });
                });
                pins.push(pin);
            }
        }
        for (const [type, id] of vehicles) {
            const spot = this.options.spots[type].find(s => s.id === id);
            if (!spot) continue;
            const aboard = this.setup.crew.filter(c => c.start.at === type);
            const pin = h(`button.pl-spot.on${placing === type ? '.moving' : ''}`, { 'data-spot': id, 'data-vehicle': type, 'aria-label': `${VEHICLES[type].name}: ${spot.name.toLowerCase()}${spot.risk === 'police view' ? ', in police view' : ''}` },
                h('span.pl-mark', {}, img(iconUrl(VEHICLE_ICONS[type])), ...aboard.map(c => {
                    const p = portraitUrl(c.id);
                    return p ? img(p, 'pl-face') : h('span.pl-face', {}, c.id[0]!.toUpperCase());
                }), spot.risk === 'police view' ? img(iconUrl('eye'), 'sh-ic pl-risk') : null));
            pin.addEventListener('click', () => {
                this.placing = this.placing === type ? null : type;
                this.render();
            });
            pins.push(pin);
        }
        if (this.setup.nest && this.options.nestRoom) {
            const inNest = this.setup.crew.filter(c => c.start.at === 'nest');
            pins.push(h('div.pl-pin.pl-nest', { 'data-pin': 'nest', 'aria-label': 'Sniper nest' }, img(iconUrl('dmr')), ...inNest.map(c => {
                const p = portraitUrl(c.id);
                return p ? img(p, 'pl-face') : h('span.pl-face', {}, c.id[0]!.toUpperCase());
            })));
        }
        if (this.setup.jammer) {
            pins.push(h('div.pl-ring', { 'data-pin': 'jammerRing' }));
            const pin = h('button.pl-pin.pl-jammer', { 'data-pin': 'jammer', 'aria-label': `Jammer, running from turn 1 (dispatch notices after ${this.options.world.rules.dispatchSilence} phases): tap to move it` }, img(iconUrl('radio')));
            pin.addEventListener('click', () => {
                this.placing = 'jammer';
                this.render();
            });
            pins.push(pin);
        }
        this.pins.replaceChildren(...pins);
        this.placePins();
    }

    /** Puts every pin over its tiles where the camera shows them now. */
    private placePins(): void {
        const map = this.map();
        if (!map) return;
        const o = map.tileOnPage(0, 0), one = map.tileOnPage(1, 0).x - o.x;
        const box = (el: HTMLElement, x0: number, y0: number, w: number, hgt: number) => {
            const a = map.tileOnPage(x0, y0);
            el.style.left = `${a.x - one / 2}px`;
            el.style.top = `${a.y - one / 2}px`;
            el.style.width = `${w * one}px`;
            el.style.height = `${hgt * one}px`;
        };
        for (const el of this.pins.children as HTMLCollectionOf<HTMLElement>) {
            const spot = el.dataset.spot, type = el.dataset.vehicle as VehicleType | undefined;
            if (spot && type) {
                const pose = this.options.spots[type].find(s => s.id === spot)!.pose, tiles = footprint(VEHICLES[type], pose);
                const xs = tiles.map(t => t.x), ys = tiles.map(t => t.y);
                box(el, Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs) + 1, Math.max(...ys) - Math.min(...ys) + 1);
            } else if (el.dataset.pin === 'nest' && this.options.nestRoom) {
                const r = this.options.nestRoom, at = map.tileOnPage(r.x + r.w / 2 - 0.5, r.y + r.h / 2 - 0.5);
                el.style.left = `${at.x}px`;
                el.style.top = `${at.y}px`;
            } else if (el.dataset.pin === 'jammer' && this.setup.jammer) {
                const at = map.tileOnPage(this.setup.jammer.x, this.setup.jammer.y);
                el.style.left = `${at.x}px`;
                el.style.top = `${at.y}px`;
            } else if (el.dataset.pin === 'jammerRing' && this.setup.jammer) {
                const at = map.tileOnPage(this.setup.jammer.x, this.setup.jammer.y), r = this.options.world.rules.jammerRadius * one;
                el.style.left = `${at.x - r}px`;
                el.style.top = `${at.y - r}px`;
                el.style.width = el.style.height = `${2 * r}px`;
            }
        }
    }

    // ------------------------------------------------------------------------------------------------------ Loadout

    /** The loadout sheet of a crew member: in or out of the crew, each slot, their start. */
    private openSheet(id: string): void {
        const m = rosterMember(id)!, i = ROSTER.indexOf(m);
        const plan = this.setup.crew.find(c => c.id === id);
        const shown = plan ?? this.benched.get(id) ?? { id, loadout: structuredClone(m.loadout), start: { at: 'van', aboard: false } as StartPick };
        const edit = (fn: (c: CrewPlan) => void) => {
            if (plan) this.change(() => fn(plan));
            else {
                fn(shown);
                this.benched.set(id, shown);
                this.render();
            }
        };
        const select = (label: string, value: string, choices: [string, string][], set: (v: string) => void, name: string) => {
            const s = h('select.pl-select', { 'aria-label': `${m.name}: ${label}`, 'data-slot': name });
            for (const [v, text] of choices) s.append(h('option', { value: v, ...(v === value ? { selected: true } : {}) }, text));
            s.addEventListener('change', () => set(s.value));
            return h('label.pl-field', {}, h('span.pl-label', {}, label), s);
        };
        // In the campaign, what the armoury holds (and what is picked already, so the field shows it).
        const items = (list: readonly ItemId[], picked: ItemId | null): [string, string][] =>
            [['', 'None'], ...list.filter(id => id === picked || inArmoury(this.purse, id) > 0).map(id => [id, ITEM_NAMES[id] ?? id] as [string, string])];
        const { loadout } = shown;
        const starts: [string, string][] = [];
        for (const type of Object.keys(VEHICLES) as VehicleType[]) {
            if (this.setup.vehicles[type] === undefined) continue;
            const name = VEHICLES[type].name.toLowerCase();
            starts.push([`${type}:by`, `By the ${name}`], [`${type}:in`, `In the ${name}`]);
        }
        if (this.setup.nest && hasLongGun(loadout)) starts.push(['nest', 'In the sniper nest']);
        const full = !plan && this.setup.crew.length >= CREW_SIZE;
        const portrait = portraitUrl(id);
        const sheet = h('div.pl-sheet.sh-panel', { role: 'dialog', 'aria-label': `${m.name}'s loadout`, 'data-crew': id, style: `--c: ${crewColour(id, i)}` },
            h('div.pl-head', {},
                portrait ? img(portrait, 'pl-portrait') : null,
                h('div.pl-who', {}, h('span.pl-title', {}, m.name), h('span.sh-tiny', {}, m.traits.map(t => TRAIT_NAMES[t] ?? t).join(', '))),
                img(iconUrl(loadoutProfile(loadout)), 'sh-ic')),
            h('div.pl-fields', {},
                select('Primary', loadout.primary ?? '', items(SLOT_ITEMS.primary, loadout.primary), v => edit(c => {
                    c.loadout.primary = (v || null) as ItemId | null;
                    if (c.start.at === 'nest' && !hasLongGun(c.loadout)) c.start = { at: 'van', aboard: true };
                }), 'primary'),
                select('Sidearm', loadout.sidearm ?? '', items(SLOT_ITEMS.sidearm, loadout.sidearm), v => edit(c => { c.loadout.sidearm = (v || null) as ItemId | null; }), 'sidearm'),
                select('Armour', loadout.armour ?? '', items(SLOT_ITEMS.armour, loadout.armour), v => edit(c => { c.loadout.armour = (v || null) as ItemId | null; }), 'armour'),
                select('Gadget', loadout.gadgets[0] ?? '', items(SLOT_ITEMS.gadget, loadout.gadgets[0]), v => edit(c => { c.loadout.gadgets[0] = (v || null) as ItemId | null; }), 'gadget1'),
                select('Gadget', loadout.gadgets[1] ?? '', items(SLOT_ITEMS.gadget, loadout.gadgets[1]), v => edit(c => { c.loadout.gadgets[1] = (v || null) as ItemId | null; }), 'gadget2'),
                plan ? select('Start', startKey(plan.start), starts, v => edit(c => { c.start = startOf(v); }), 'start') : null),
            h('div.pl-buttons', {},
                h('button.pl-button.pl-toggle', { 'aria-label': plan ? `Leave ${m.name} out` : `Bring ${m.name}`, ...(full ? { disabled: true } : {}) }, plan ? 'Leave out' : full ? 'Crew full' : 'Bring'),
                h('button.pl-button.pl-done', { 'aria-label': 'Done' }, 'Done')));
        sheet.querySelector('.pl-toggle')!.addEventListener('click', () => this.toggleCrew(id));
        sheet.querySelector('.pl-done')!.addEventListener('click', () => this.closeSheet());
        // Redrawn after every change: the field that had the focus keeps it.
        const focused = this.sheet?.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.slot : undefined;
        if (this.sheet) this.sheet.replaceWith(sheet);
        else this.root.append(sheet);
        this.sheet = sheet;
        if (focused) sheet.querySelector<HTMLElement>(`[data-slot="${focused}"]`)?.focus();
    }

    private closeSheet(): void {
        this.sheet?.remove();
        this.sheet = undefined;
    }
}
