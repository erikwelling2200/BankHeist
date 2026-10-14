import type { ActionVM, CrewVM, HudViewModel, ScheduleVM, ThreatVM } from './viewModels';

/**
 * Sample view models for the dev page `?scene=hud`, one per board of the UI mockups (docs/ui-mockups/), so the HUD can
 * be looked at, and tested, without the game. Not used by the game.
 */

const SCHEDULE: ScheduleVM = {
    end: 45,
    events: [
        { turn: 8, label: 'Lunch', icon: 'fork' },
        { turn: 12, label: 'Cash run', icon: 'cart' },
        { turn: 20, label: 'Armoured car', icon: 'truck' },
        { turn: 30, label: 'Patrol drive-by', icon: 'police' },
        { turn: 45, label: 'Closing', icon: 'moon' }
    ]
};

const CREW: CrewVM[] = [
    { id: 'mara', name: 'Mara', colour: '#60c0ce', actionsLeft: 2, actionsMax: 2, profile: 'clean', exposedTo: [], hp: 8, hpMax: 8, selected: false },
    { id: 'jun', name: 'Jun', colour: '#ce74b8', actionsLeft: 2, actionsMax: 2, profile: 'concealed', exposedTo: [], hp: 8, hpMax: 8, selected: true },
    { id: 'dex', name: 'Dex', colour: '#9684e0', actionsLeft: 2, actionsMax: 2, profile: 'heavy', exposedTo: [], hp: 8, hpMax: 8, selected: false, carrying: 'van' },
    { id: 'sol', name: 'Sol', colour: '#dac8a2', actionsLeft: 2, actionsMax: 2, profile: 'armed', exposedTo: [], hp: 8, hpMax: 8, selected: false }
];

const STEALTH_ACTIONS: ActionVM[] = [
    { id: 'interact', label: 'Interact', icon: 'interact', cost: 1, enabled: true },
    { id: 'knockout', label: 'Knockout', icon: 'knockout', cost: 1, enabled: false, reason: 'Nobody in reach' },
    { id: 'wait', label: 'Wait for', icon: 'wait', cost: 0, enabled: true },
    { id: 'move', label: 'Move', icon: 'move', cost: 1, enabled: true, selected: true }
];

const CARRIERS: ThreatVM[] = [
    { id: 'c1', label: 'Teller: silent alarm', countdown: 2, kind: 'carrier', icon: 'bell', portrait: 'teller', targetId: 'teller' },
    { id: 'c2', label: 'Guard: radio', countdown: 2, kind: 'carrier', icon: 'radio', portrait: 'guard', targetId: 'guard' },
    { id: 'c3', label: 'Customer escaping', countdown: 3, kind: 'escape', icon: 'run', portrait: 'customer', targetId: 'customer' },
    { id: 'k1', label: 'Operator check-in call', countdown: 5, kind: 'checkIn', icon: 'radio', portrait: 'operator', targetId: 'operator' },
    { id: 's1', label: 'Manager back from lunch', countdown: 11, kind: 'schedule', icon: 'fork', portrait: 'manager', targetId: 'manager' }
];

const OVERLAYS = { zones: false, cones: false, cameras: true, cover: false, sound: false, materials: false };

const base = (): HudViewModel => ({
    turn: 9,
    bank: { status: 'quiet', policeEta: null },
    schedule: SCHEDULE,
    crew: CREW.map(c => ({ ...c })),
    actions: STEALTH_ACTIONS.map(a => ({ ...a })),
    confirm: { kind: 'clean', label: 'Move', icon: 'move', cost: 1, enabled: false },
    undoEnabled: false,
    ledger: [CARRIERS[3]!, CARRIERS[4]!],
    overlays: { ...OVERLAYS },
    mapOn: false,
    recap: null
});

export type SamplePanel = 'ledger' | 'drawer' | 'prompt' | null;

export interface SampleState {
    title: string;
    vm: HudViewModel;
    panel?: SamplePanel;
}

const withCrew = (vm: HudViewModel, edit: (c: CrewVM) => void): HudViewModel => { vm.crew.forEach(edit); return vm; };

export const SAMPLE_STATES: Record<string, () => SampleState> = {
    select: () => ({ title: 'Stealth: Jun selected, nothing previewed', vm: base() }),
    preview: () => {
        const vm = base();
        vm.confirm = { kind: 'costly', label: 'Move', icon: 'move', cost: 1, enabled: true };
        vm.undoEnabled = true;
        vm.crew[0]!.actionsLeft = 1;
        return { title: 'Move previewed: a pip on the cleaner (amber)', vm };
    },
    clean: () => {
        const vm = base();
        vm.actions = vm.actions.map(a => ({ ...a, selected: a.id === 'interact' }));
        vm.confirm = { kind: 'clean', label: 'Kill panel', icon: 'interact', cost: 1, enabled: true };
        vm.undoEnabled = true;
        return { title: 'Panel work previewed: clean (cream)', vm };
    },
    command: () => {
        const vm = base();
        vm.actions = [
            { id: 'move', label: 'Move', icon: 'move', cost: 1, enabled: true },
            { id: 'command', label: 'Command', icon: 'command', cost: 1, enabled: true },
            { id: 'watch', label: 'Watch', icon: 'watch', cost: 1, enabled: true, selected: true },
            { id: 'ziptie', label: 'Tie', icon: 'ziptie', cost: 1, enabled: false, reason: 'Nobody face down' }
        ];
        vm.confirm = { kind: 'command', label: 'Watch', icon: 'watch', cost: 1, enabled: true };
        return { title: 'Watch previewed (steel blue)', vm };
    },
    go: () => {
        const vm = withCrew(base(), c => { c.actionsMax = 3; c.actionsLeft = 3; c.portrait = `${c.id}-m`; });
        vm.actions = [
            { id: 'go', label: 'GO', icon: 'mask', cost: 0, enabled: true, go: true, selected: true },
            { id: 'command', label: 'Command', icon: 'command', cost: 1, enabled: true },
            { id: 'move', label: 'Move', icon: 'move', cost: 1, enabled: true },
            { id: 'wait', label: 'Wait for', icon: 'wait', cost: 0, enabled: true }
        ];
        vm.confirm = { kind: 'command', label: 'GO', icon: 'mask', cost: 0, enabled: true };
        return { title: 'GO previewed: masks on, a third action each', vm };
    },
    carriers: () => {
        const vm = base();
        vm.ledger = CARRIERS.map(t => ({ ...t }));
        vm.crew[1]!.profile = 'armed';
        vm.crew[1]!.exposedTo = ['teller', 'guard', 'customer'];
        vm.confirm = { kind: 'clean', label: '', cost: 0, enabled: false };
        return { title: 'Alarm carriers and the threat ledger', vm, panel: 'ledger' };
    },
    alarm: () => {
        const vm = base();
        vm.turn = 14;
        vm.bank = { status: 'alarm', policeEta: 4 };
        vm.ledger = [{ id: 'p', label: 'Police arrive', countdown: 4, kind: 'reinforcement', icon: 'police', targetId: 'street' }, CARRIERS[3]!];
        vm.crew[2]!.hp = 5;
        vm.crew[0]!.actionsLeft = 0;
        vm.actions = vm.actions.map(a => ({ ...a, selected: false }));
        vm.actions.push({ id: 'loot', label: 'Bag loot', icon: 'bag', cost: 1, enabled: true });
        vm.confirm = { kind: 'clean', label: '', cost: 0, enabled: false };
        return { title: 'After the Alarm: police in 4', vm };
    },
    lethal: () => {
        const vm = base();
        vm.bank = { status: 'loud', policeEta: null };
        vm.actions = [
            { id: 'fire', label: 'Fire', icon: 'pistol', cost: 1, enabled: true, selected: true },
            { id: 'reload', label: 'Reload', icon: 'reload', cost: 1, enabled: false, reason: 'Magazine full' },
            { id: 'move', label: 'Move', icon: 'move', cost: 1, enabled: true },
            { id: 'watch', label: 'Watch', icon: 'watch', cost: 1, enabled: true },
            { id: 'throw', label: 'Throw', icon: 'throw', cost: 1, enabled: true },
            { id: 'medkit', label: 'Medkit', icon: 'medkit', cost: 1, enabled: true }
        ];
        vm.confirm = { kind: 'lethal', label: 'Fire ×6', icon: 'pistol', cost: 1, enabled: true };
        return { title: 'Loud: lethal fire (red)', vm };
    },
    drawer: () => {
        const vm = base();
        vm.overlays = { ...vm.overlays, zones: true, cover: true };
        return { title: 'The overlay drawer', vm, panel: 'drawer' };
    },
    prompt: () => {
        const vm = base();
        vm.crew[1]!.actionsLeft = 0;
        vm.crew[3]!.actionsLeft = 1;
        return { title: 'End turn with actions left', vm, panel: 'prompt' };
    },
    five: () => {
        const vm = base();
        vm.crew.push({ id: 'ike', name: 'Ike', colour: '#b0c870', actionsLeft: 2, actionsMax: 2, profile: 'clean', exposedTo: [], hp: 6, hpMax: 6, selected: false, carrying: 'loot' });
        return { title: 'Five crew: the rail packs tighter', vm };
    },
    recap: () => {
        const vm = base();
        vm.turn = 31;
        vm.bank = { status: 'alarm', policeEta: 0 };
        vm.crew = vm.crew.map(c => ({ ...c, portrait: `${c.id}-m` }));
        vm.crew[1]!.hp = 4;
        vm.ledger = [
            { id: 'b', label: 'SWAT breach', countdown: 1, kind: 'reinforcement', icon: 'charge', targetId: 'rear' },
            { id: 'g', label: 'Grenade', countdown: 1, kind: 'drill', icon: 'grenade', targetId: 'lobby' }
        ];
        vm.recap = {
            heat: 3,
            events: [
                { turn: 30, label: 'SWAT breached the rear door', icon: 'charge', portrait: 'swat' },
                { turn: 30, label: 'Jun was hit', icon: 'attack', portrait: 'jun-m', delta: -4 },
                { turn: 31, label: 'Drill: 3 turns left', icon: 'drill', portrait: 'dex-m', delta: 3 }
            ]
        };
        return { title: 'Resume: the recap card', vm };
    }
};
