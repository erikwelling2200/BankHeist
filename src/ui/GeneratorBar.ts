import { archetypesFor } from '../gen/generate';
import { ARCHETYPES, PLOTS, TIERS, type GeneratedBank, type Tier } from '../gen/model';
import { TIER_SPECS } from '../gen/tiers';
import { ARCHETYPE_NAMES, PLOT_NAMES } from './names';

/**
 * A test bar for the generator, across the top of the page: pick a tier, an archetype and a plot (or leave any of them
 * to chance) and the bank regenerates; Regenerate rolls another bank with the same picks, New people keeps the
 * building and rolls who is in it, Blueprint shows only what the blueprint knows (§17.8). A pick that a tier can't
 * have (Mezzanine Watch needs a CCTV operator, so no small branch) is greyed out.
 */
export class GeneratorBar {
    private readonly root: HTMLDivElement;

    constructor(bank: GeneratedBank, actions: { regenerate: (params: Record<string, string>) => void; knowledge: (full: boolean) => void }) {
        const params = new URLSearchParams(location.search);
        this.root = document.createElement('div');
        this.root.className = 'generator-bar';
        this.root.addEventListener('pointerdown', e => e.stopPropagation());
        this.root.addEventListener('wheel', e => e.stopPropagation());
        const select = (name: string, values: readonly string[], label: (v: string) => string) => {
            const s = document.createElement('select');
            s.setAttribute('aria-label', name[0]!.toUpperCase() + name.slice(1));
            s.append(new Option(`Any ${name}`, ''));
            for (const v of values) s.append(new Option(label(v), v));
            s.value = params.get(name) ?? '';
            this.root.append(s);
            return s;
        };
        const tier = select('tier', TIERS, t => TIER_SPECS[t as Tier].name);
        const archetype = select('archetype', ARCHETYPES, a => ARCHETYPE_NAMES[a as keyof typeof ARCHETYPE_NAMES]);
        const plot = select('plot', PLOTS, p => PLOT_NAMES[p as keyof typeof PLOT_NAMES]);
        // Grey out what the other pick rules out.
        const fit = () => {
            for (const o of [...archetype.options]) o.disabled = !!o.value && !!tier.value && !archetypesFor(tier.value as Tier).includes(o.value as never);
            for (const o of [...tier.options]) o.disabled = !!o.value && !!archetype.value && !archetypesFor(o.value as Tier).includes(archetype.value as never);
        };
        fit();
        const picks = () => Object.fromEntries([['tier', tier.value], ['archetype', archetype.value], ['plot', plot.value]].filter(([, v]) => v));
        const fresh = () => `${Math.floor(Math.random() * 1e6)}-${Math.floor(Math.random() * 1e3)}`;
        for (const s of [tier, archetype, plot]) s.addEventListener('change', () => { fit(); actions.regenerate({ ...picks(), seed: fresh() }); });
        const button = (text: string, title: string, action: () => void) => {
            const b = document.createElement('button');
            b.textContent = text;
            b.title = title;
            b.addEventListener('click', action);
            this.root.append(b);
            return b;
        };
        button('Regenerate', 'Another bank with these picks', () => actions.regenerate({ ...picks(), seed: fresh() }));
        button('New people', 'The same building with other people in it', () => actions.regenerate({ ...picks(), seed: `${bank.seed.layout}-${Math.floor(Math.random() * 1e3)}` }));
        let full = true;
        const blueprint = button('Blueprint', 'Show only what the blueprint shows before casing', () => {
            full = !full;
            blueprint.classList.toggle('active', !full);
            actions.knowledge(full);
        });
        const seed = document.createElement('span');
        seed.className = 'generator-seed';
        seed.textContent = `${TIER_SPECS[bank.tier].name} · ${ARCHETYPE_NAMES[bank.archetype]} · ${PLOT_NAMES[bank.plot]} · seed ${bank.seed.layout}-${bank.seed.population}`;
        this.root.append(seed);
        document.body.append(this.root);
    }

    destroy(): void {
        this.root.remove();
    }
}
