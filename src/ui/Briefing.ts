import { HEADLINE_NAMES, ARCHETYPES, PLOTS, TIERS, type GeneratedBank } from '../gen/model';
import { TIER_SPECS } from '../gen/tiers';

/**
 * The briefing for a generated bank (§17.2 step 8): the bank, its headline features, the vault and its keys (the
 * objectives board), the ways in, the day's timeline, the intel journal and the checks it passed, plus the controls to
 * roll another bank. HTML, like the HUD, so the text stays crisp. The knowledge toggle switches the map between what
 * the blueprint shows before casing and the full layout (§17.8).
 */
export class Briefing {
    private readonly root: HTMLDivElement;
    private readonly panel: HTMLDivElement;

    constructor(bank: GeneratedBank, actions: { reroll: (params: Record<string, string>) => void; knowledge: (full: boolean) => void }) {
        this.root = el('div', 'briefing') as HTMLDivElement;
        const toggle = el('button', 'briefing-toggle', 'Briefing');
        toggle.setAttribute('aria-label', 'Briefing');
        toggle.addEventListener('pointerdown', e => e.stopPropagation());
        toggle.addEventListener('click', () => this.root.classList.toggle('open'));
        this.panel = el('div', 'briefing-panel') as HTMLDivElement;
        this.panel.addEventListener('pointerdown', e => e.stopPropagation());
        this.panel.addEventListener('wheel', e => e.stopPropagation());
        this.root.append(toggle, this.panel);
        // Open by default where there is room for it beside the map.
        if (window.innerWidth >= 1200) this.root.classList.add('open');
        this.render(bank, actions);
        document.body.append(this.root);
    }

    private render(bank: GeneratedBank, actions: { reroll: (params: Record<string, string>) => void; knowledge: (full: boolean) => void }): void {
        const p = this.panel, spec = TIER_SPECS[bank.tier];
        const section = (title: string) => {
            const s = el('section');
            s.append(el('h3', '', title));
            p.append(s);
            return s;
        };
        const list = (parent: HTMLElement, items: string[]) => {
            const ul = el('ul');
            for (const item of items) ul.append(el('li', '', item));
            parent.append(ul);
        };
        p.append(el('h2', '', bank.name));
        p.append(el('p', 'briefing-sub', `${spec.name} · ${ARCHETYPE_NAMES[bank.archetype]} · ${PLOT_NAMES[bank.plot]} · police in ${bank.policeEta} turns`));
        list(section('Headline'), bank.headlines.map(h => HEADLINE_NAMES[h]));

        // Controls: another bank, the same building with new people, pinned choices, the knowledge layer.
        const controls = el('div', 'briefing-controls');
        const pin = (name: string, values: readonly string[], labels: Record<string, string>) => {
            const select = el('select') as HTMLSelectElement;
            select.setAttribute('aria-label', name);
            select.append(new Option(`Any ${name}`, ''));
            for (const v of values) select.append(new Option(labels[v] ?? v, v));
            select.value = new URLSearchParams(location.search).get(name) ?? '';
            controls.append(select);
            return select;
        };
        const tier = pin('tier', TIERS, Object.fromEntries(TIERS.map(t => [t, TIER_SPECS[t].name])));
        const archetype = pin('archetype', ARCHETYPES, ARCHETYPE_NAMES);
        const plot = pin('plot', PLOTS, PLOT_NAMES);
        const pinned = () => Object.fromEntries([['tier', tier.value], ['archetype', archetype.value], ['plot', plot.value]].filter(([, v]) => v));
        const button = (text: string, action: () => void) => {
            const b = el('button', '', text);
            b.addEventListener('click', action);
            controls.append(b);
            return b;
        };
        button('New bank', () => actions.reroll({ ...pinned(), seed: `${Math.floor(Math.random() * 1e6)}-${Math.floor(Math.random() * 1e3)}` }));
        button('Same building, new people', () => actions.reroll({ ...pinned(), seed: `${bank.seed.layout}-${Math.floor(Math.random() * 1e3)}` }));
        let full = true;
        const know = button('Show blueprint only', () => {
            full = !full;
            know.textContent = full ? 'Show blueprint only' : 'Show everything';
            actions.knowledge(full);
        });
        p.append(controls);
        p.append(el('p', 'briefing-seed', `Seed ${bank.seed.layout}-${bank.seed.population}`));

        const vault = section('Vault and keys');
        const guards = bank.people.filter(x => x.role === 'lobbyGuard' || x.role === 'patrolGuard').length;
        const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
        vault.append(el('p', '', `Class ${bank.vaultClass}${bank.timeLock ? ', time lock' : ''}${bank.dualControl ? ', dual control' : ''}. ${plural(guards, 'guard')}${spec.chief ? ' and a security chief' : ''}, ${plural(bank.cameras.length, 'camera')}${spec.operator ? `, an operator with ${spec.monitors} monitors` : ', recording only'}.`));
        for (const lock of bank.locks) {
            const div = el('div', 'briefing-lock');
            div.append(el('strong', '', lock.name));
            const holders = lock.holders.map(id => bank.people.find(p => p.id === id)).filter(Boolean).map(p => `${p!.name} (${ROLE_NAMES[p!.role] ?? p!.role})`);
            list(div, [`Social: ${lock.social}${holders.length ? ` — ${holders.join(', ')}` : ''}`, `Technical: ${lock.technical}`, `Violent: ${lock.violent}`]);
            vault.append(div);
        }
        const ways = section('Ways in');
        for (const cat of ['social', 'covert', 'forced'] as const) {
            const items = bank.approaches.filter(a => a.category === cat).map(a => a.name);
            if (items.length) { ways.append(el('h4', '', cat[0]!.toUpperCase() + cat.slice(1))); list(ways, items); }
        }
        list(ways, [`Getaway: ${bank.getaways.map(g => `${g.name.toLowerCase()} (${g.risk})`).join('; ')}`, `Neighbours: ${bank.neighbours.map(n => NEIGHBOUR_NAMES[n] ?? n).join(', ')}`]);
        list(section('Timeline'), bank.timeline.map(e => `Turn ${e.turn}: ${e.name}${e.duration ? ` (${e.duration} turns)` : ''} — ${e.detail}`));
        const journal = section('Intel journal');
        list(journal, bank.opportunities.map(o => `${o.text} (found by ${o.found})`));
        list(journal, bank.intel.map(i => `Buyable intel: ${i}`));
        const people = section('People');
        const counts = new Map<string, number>();
        for (const person of bank.people.filter(x => !x.hidden)) counts.set(person.role, (counts.get(person.role) ?? 0) + 1);
        list(people, [...counts.entries()].map(([role, n]) => `${n} ${ROLE_NAMES[role] ?? role}${n > 1 ? 's' : ''}`));
        const checks = section('Checks (§17.7)');
        list(checks, bank.validation.results.map(r => `${r.ok ? '✓' : '✗'} ${r.rule}: ${r.detail}`));
        checks.append(el('p', 'briefing-sub', `Built on attempt ${bank.validation.attempts}${bank.validation.relaxed.length ? `; relaxed: ${bank.validation.relaxed.join('; ')}` : ''}.`));
    }

    destroy(): void {
        this.root.remove();
    }
}

function el(tag: string, className = '', text?: string): HTMLElement {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
}

const ARCHETYPE_NAMES: Record<string, string> = { twoWing: 'Two Wing', atrium: 'Atrium', threeKeys: 'Three Keys', fortress: 'Fortress', mezzanineWatch: 'Mezzanine Watch' };
const PLOT_NAMES: Record<string, string> = { midBlock: 'mid-block', cornerLot: 'corner lot', plazaFront: 'plaza front', stripMallEnd: 'strip-mall end' };
const NEIGHBOUR_NAMES: Record<string, string> = { cafe: 'café', vacantShop: 'vacant shop', garage: 'parking garage', buildingSite: 'building site', shop: 'shop', tower: 'office tower (sniper nest)' };
const ROLE_NAMES: Record<string, string> = {
    headTeller: 'head teller', lobbyGuard: 'lobby guard', patrolGuard: 'patrol guard', chief: 'security chief', operator: 'CCTV operator', 'passer-by': 'passer-by'
};
