import { h } from './dom';
import { mountHud } from './mountHud';
import { SAMPLE_STATES } from './sample';
import type { HudCallbacks, HudViewModel } from './viewModels';

/**
 * The dev page `?scene=hud`: the stealth HUD over a blank page with a sample view model, without the game. `&state=`
 * picks a sample (see `sample.ts`), `&text=1.3` scales the text, `&bare` hides the picker. The callbacks play the
 * samples along (select crew, pick an action, toggle overlays) and log what they were called with in `window.hudLog`.
 */
export function showHudPreview(): void {
    const params = new URLSearchParams(location.search);
    document.body.classList.add('hud-preview');
    const log: string[] = [];
    let name = params.get('state') ?? 'select';
    if (!SAMPLE_STATES[name]) name = 'select';
    let vm: HudViewModel;

    const record = (entry: string) => { log.push(entry); };
    const callbacks: HudCallbacks = {
        selectCrew: id => { record(`selectCrew:${id}`); vm.crew = vm.crew.map(c => ({ ...c, selected: c.id === id })); hud.update(vm); },
        action: id => {
            record(`action:${id}`);
            const a = vm.actions.find(x => x.id === id);
            vm.actions = vm.actions.map(x => ({ ...x, selected: x.id === id }));
            if (a) vm.confirm = { ...vm.confirm, label: a.label, icon: a.icon, cost: a.cost, enabled: true };
            hud.update(vm);
        },
        confirm: () => record('confirm'),
        undo: () => record('undo'),
        endTurn: () => { record('endTurn'); vm.turn += 1; hud.update(vm); },
        toggleOverlay: (id, on) => { record(`toggleOverlay:${id}:${on}`); vm.overlays = { ...vm.overlays, [id]: on }; hud.update(vm); },
        ledgerJump: id => record(`ledgerJump:${id}`),
        toggleMap: () => { record('toggleMap'); vm.mapOn = !vm.mapOn; hud.update(vm); },
        resume: () => { record('resume'); vm.recap = null; hud.update(vm); }
    };
    const hud = mountHud(document.body, callbacks);
    hud.setTextScale(Number(params.get('text') ?? 1) || 1);

    const show = (state: string) => {
        const sample = SAMPLE_STATES[state]!();
        vm = sample.vm;
        hud.update(vm);
        hud.showPanel(sample.panel ?? null);
    };

    if (!params.has('bare')) {
        const picker = h('select.hud-preview-picker', { 'aria-label': 'Sample state' });
        for (const [key, make] of Object.entries(SAMPLE_STATES)) picker.append(new Option(make().title, key));
        picker.value = name;
        picker.addEventListener('change', () => {
            params.set('state', picker.value);
            history.replaceState(null, '', `${location.pathname}?${params}`);
            picker.blur();
            show(picker.value);
        });
        document.body.append(picker);
    }
    show(name);
    Object.assign(window, { hud, hudLog: log, hudSamples: Object.keys(SAMPLE_STATES) });
}
