import { CREW_COLOURS, type ActionVM, type BankStatusVM, type CrewVM, type HudViewModel, type ScheduleVM, type ThreatVM } from './viewModels';

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

const hp = (now: number, max = 8) => ({ now, max });

const CREW: CrewVM[] = [
    { id: 'mara', name: 'Mara', actionsLeft: 2, actionsMax: 2, profile: 'clean', exposedTo: [], hp: hp(8), selected: false },
    { id: 'jun', name: 'Jun', actionsLeft: 2, actionsMax: 2, profile: 'concealed', exposedTo: [], hp: hp(8), selected: true },
    { id: 'dex', name: 'Dex', actionsLeft: 2, actionsMax: 2, profile: 'heavy', exposedTo: [], hp: hp(8), selected: false, carrying: 'van' },
    { id: 'sol', name: 'Sol', actionsLeft: 2, actionsMax: 2, profile: 'armed', exposedTo: [], hp: hp(8), selected: false, ammo: { mag: 12, spare: 2, lastMag: false } }
].map((c, i) => ({ ...c, colour: CREW_COLOURS[i]!, portrait: c.id }) as CrewVM);

const STEALTH_ACTIONS: ActionVM[] = [
    { id: 'interact', label: 'Interact', icon: 'interact', cost: 1, enabled: true },
    { id: 'knockout', label: 'Knockout', icon: 'knockout', cost: 1, enabled: false, reason: 'Nobody in reach' },
    { id: 'wait', label: 'Wait for', icon: 'wait', cost: 0, enabled: true },
    { id: 'move', label: 'Move', icon: 'move', cost: 1, enabled: true, selected: true }
];

const threat = (id: string, kind: ThreatVM['kind'], label: string, countdown: number, portrait?: string, halted: ThreatVM['halted'] = null): ThreatVM =>
    ({ id, kind, source: portrait ?? id, label, countdown, halted, pos: { x: countdown * 3, y: 4 }, targetId: portrait, portrait });

/** In the Session's order: running before paused, then by countdown. */
const CARRIERS: ThreatVM[] = [
    threat('c1', 'tellerButton', 'Teller button', 2, 'teller'),
    threat('c2', 'guardRadio', 'Guard radio', 2, 'guard'),
    threat('c3', 'escapee', 'Customer escaping', 3, 'customer'),
    threat('k1', 'missedCheckIn', 'Operator check-in', 5, 'operator'),
    threat('s1', 'schedule', 'Manager back from lunch', 11, 'manager'),
    threat('c4', 'phoneCall', 'Clerk on the phone', 2, undefined, 'paused')
];

const QUIET: BankStatusVM = { status: 'quiet', label: 'QUIET', nextAlarmIn: null };
const OVERLAYS = { zones: false, cones: false, cameras: true, cover: false, sound: false, materials: false };

const base = (): HudViewModel => ({
    turn: 9,
    bank: { ...QUIET },
    schedule: SCHEDULE,
    crew: CREW.map(c => ({ ...c })),
    selected: 'jun',
    actions: STEALTH_ACTIONS.map(a => ({ ...a })),
    confirm: { kind: 'clean', label: 'Move', icon: 'move', cost: 1, enabled: false },
    undoEnabled: false,
    ledger: [threat('s1', 'schedule', 'Manager back from lunch', 11, 'manager')],
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
        vm.bank = { ...QUIET, go: true };
        vm.actions = [
            { id: 'go', label: 'GO', icon: 'mask', cost: 0, enabled: true, go: true, wide: true, selected: true },
            { id: 'command', label: 'Command', icon: 'command', cost: 1, enabled: true },
            { id: 'move', label: 'Move', icon: 'move', cost: 1, enabled: true },
            { id: 'wait', label: 'Wait for', icon: 'wait', cost: 0, enabled: true }
        ];
        vm.confirm = { kind: 'go', label: 'GO', icon: 'star', cost: 0, enabled: true };
        vm.goRail = 'preview';
        return { title: 'GO previewed: the rail turns gold, masks on, a third action each', vm };
    },
    shout: () => {
        const vm = withCrew(base(), c => { c.actionsMax = 3; c.actionsLeft = c.id === 'dex' ? 2 : 3; c.portrait = `${c.id}-m`; c.selected = c.id === 'dex'; });
        vm.turn = 14;
        vm.selected = 'dex';
        vm.bank = { ...QUIET, go: true };
        vm.goRail = 'on';
        vm.actions = [
            { id: 'move', label: 'Move', icon: 'move', cost: 1, enabled: true },
            { id: 'command', label: 'Command', icon: 'command', cost: 1, enabled: true, selected: true },
            { id: 'hold', label: 'Hold', icon: 'hold', cost: 2, enabled: true },
            { id: 'wait', label: 'Wait', icon: 'wait', cost: 0, enabled: true }
        ];
        vm.confirm = { kind: 'command', label: 'Command', icon: 'command', cost: 1, enabled: true };
        vm.rings = { kind: 'command', down: 11, panics: 3, alerted: 1, ignores: 0, unsure: 0, resisters: [{ id: 'guard', name: 'Lobby guard', portrait: 'guard', chance: 0.05 }] };
        return { title: 'The takeover turn: Dex\'s shout previewed, its rings counted and the guard\'s resist chance', vm };
    },
    loot: () => {
        const vm = base();
        vm.turn = 22;
        vm.bank = { status: 'loud', label: 'LOUD', nextAlarmIn: null };
        vm.crew[1]!.carrying = 'loot';
        vm.crew[1]!.mayBeDyed = true;
        vm.crew[2]!.carrying = 'loot';
        vm.loot = { carried: 48500, ruined: 3000, mayBeDyed: true };
        vm.ledger = [
            { id: 'device:drill-1', kind: 'drill', source: 'drill-1', label: 'Drill jammed: fix it (3/8)', countdown: 5, halted: 'paused', urgent: true, pos: { x: 4, y: 2 } },
            { id: 'lapse:dex', kind: 'lapse', source: 'dex', label: 'Lapses: 9 face down (Dex)', countdown: 1, halted: null, pos: { x: 8, y: 6 } },
            { id: 'lapse:mara', kind: 'lapse', source: 'mara', label: 'Held: 3 face down (Mara)', countdown: 2, halted: 'paused', pos: { x: 3, y: 6 } }
        ];
        vm.confirm = { kind: 'costly', label: 'Move', icon: 'move', cost: 1, enabled: true, warns: ['the cash may be dyed'] };
        return { title: 'Loot carried, some may be dyed; a jammed drill and lapsing commands in the ledger', vm, panel: 'ledger' };
    },
    carriers: () => {
        const vm = base();
        vm.bank = { status: 'quiet', label: 'QUIET: alarm in 2', nextAlarmIn: 2 };
        vm.ledger = CARRIERS.map(t => ({ ...t }));
        vm.crew[1]!.profile = 'armed';
        vm.crew[1]!.exposedTo = ['teller', 'guard', 'customer'];
        vm.confirm = { kind: 'clean', label: '', cost: 0, enabled: false };
        return { title: 'Alarm carriers and the threat ledger', vm, panel: 'ledger' };
    },
    alarm: () => {
        const vm = base();
        vm.turn = 14;
        vm.bank = { status: 'alarm', label: 'ALARM', nextAlarmIn: null, policeEta: 4 };
        vm.ledger = [threat('p', 'reinforcement', 'Police arrive', 4, 'police'), threat('k1', 'missedCheckIn', 'Operator check-in', 5, 'operator')];
        vm.crew[2]!.hp = hp(5);
        vm.crew[3]!.ammo = { mag: 3, spare: 0, lastMag: true };
        vm.crew[0]!.actionsLeft = 0;
        vm.actions = vm.actions.map(a => ({ ...a, selected: false }));
        vm.actions.push({ id: 'loot', label: 'Bag loot', icon: 'bag', cost: 1, enabled: true });
        vm.confirm = { kind: 'clean', label: '', cost: 0, enabled: false };
        return { title: 'After the Alarm: police in 4', vm };
    },
    lethal: () => {
        const vm = base();
        vm.bank = { status: 'loud', label: 'LOUD', nextAlarmIn: null };
        vm.actions = [
            { id: 'fire', label: 'Fire', icon: 'pistol', cost: 1, enabled: true, selected: true },
            { id: 'reload', label: 'Reload', icon: 'reload', cost: 1, enabled: false, reason: 'Magazine full' },
            { id: 'move', label: 'Move', icon: 'move', cost: 1, enabled: true },
            { id: 'watch', label: 'Watch', icon: 'watch', cost: 1, enabled: true },
            { id: 'throw', label: 'Throw', icon: 'throw', cost: 1, enabled: true },
            { id: 'medkit', label: 'Medkit', icon: 'medkit', cost: 1, enabled: true },
            { id: 'swap', label: 'Swap weapon', icon: 'swap', cost: 0, enabled: true },
            { id: 'suppress', label: 'Suppress', icon: 'suppress', cost: 2, enabled: true },
            { id: 'dash', label: 'Dash', icon: 'dash', cost: 2, enabled: true },
            { id: 'kit', label: 'Kit', icon: 'kit', cost: 1, enabled: true }
        ];
        vm.confirm = { kind: 'lethal', label: 'Fire ×6', icon: 'pistol', cost: 1, enabled: true };
        return { title: 'Loud: lethal fire (red), more actions than the grid holds', vm };
    },
    heat: () => {
        const vm = base();
        vm.turn = 24;
        vm.bank = { status: 'alarm', label: 'ALARM', nextAlarmIn: null, policeEta: 0, heat: { level: 2, ticks: 3, next: { label: 'SWAT, rear lot', inTurns: 2 } } };
        vm.ledger = [threat('b', 'reinforcement', 'SWAT breach', 2, 'swat')];
        return { title: 'Police on site: heat 2, SWAT next', vm };
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
        vm.crew.push({ id: 'ike', name: 'Ike', colour: CREW_COLOURS[4]!, actionsLeft: 2, actionsMax: 2, profile: 'unknown', exposedTo: ['guard'], hp: null, selected: false, carrying: 'loot' });
        return { title: 'Five crew: a placeholder portrait, unknown profile and HP', vm };
    },
    recap: () => {
        const vm = base();
        vm.turn = 31;
        vm.bank = { status: 'alarm', label: 'ALARM', nextAlarmIn: null, policeEta: 0, heat: { level: 3, ticks: 4, next: { label: 'Regroup', inTurns: 4 } } };
        vm.crew = vm.crew.map(c => ({ ...c, portrait: `${c.id}-m` }));
        vm.crew[1]!.hp = hp(4);
        vm.ledger = [threat('b', 'reinforcement', 'SWAT breach', 1, 'swat'), threat('g', 'drill', 'Drill jams', 1)];
        vm.recap = {
            turn: 31,
            bank: vm.bank,
            events: [
                { turn: 30, text: 'SWAT breached the rear door', icon: 'charge', portrait: 'swat' },
                { turn: 30, text: 'Jun was hit', icon: 'attack', portrait: 'jun-m', delta: -4 },
                { turn: 31, text: 'Drill: 3 turns left', icon: 'drill', portrait: 'dex-m', delta: 3 }
            ],
            crew: vm.crew.map(c => ({ id: c.id, name: c.name, colour: c.colour, portrait: c.portrait, status: c.actionsLeft ? 'ready' : 'done', actionsLeft: c.actionsLeft, exposed: c.id === 'jun', hp: c.hp })),
            threats: vm.ledger
        };
        return { title: 'Resume: the recap card', vm };
    }
};
