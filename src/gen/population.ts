import type { PersonFacing } from '../level/plan';
import type { Furnisher } from './furnish';
import type { GenPerson, GenRoom, Headline, Opportunity, ScheduleBlock, Tier, TimelineEvent } from './model';
import type { Neighbour } from './neighbours';
import type { Nav, P } from './nav';
import type { Furnished } from './parcels';
import type { Rng } from './rng';
import { corners, type GuardPlan } from './security';
import { TIER_SPECS } from './tiers';

/*
 * The people of the bank and their day (§16, §17.2 step 6), from the population seed: staff at their stations, guards
 * on the posts and routes security planned, the crowd for the time of day, and the traits nobody can see at a glance
 * (an off-duty cop, a hero, a teller in debt). Their schedules come from the bank's timeline (§16.3), rolled here
 * too: "30% chance this teller carries a cash tray to the vault at turn 11". Once rolled, everything is known.
 */

const FIRST = ['Ana', 'Ben', 'Carla', 'Dev', 'Elif', 'Femi', 'Greta', 'Hugo', 'Ines', 'Jonas', 'Kofi', 'Lena', 'Marco', 'Nadia', 'Omar', 'Petra', 'Quinn', 'Rosa', 'Sami', 'Tess', 'Umar', 'Vera', 'Wim', 'Yara', 'Zeno'];
const LAST = ['Adler', 'Bakker', 'Costa', 'Dijk', 'Engel', 'Fischer', 'Garcia', 'Haas', 'Ivanov', 'Jansen', 'Kowal', 'Lund', 'Meyer', 'Novak', 'Okafor', 'Peeters', 'Reyes', 'Smit', 'Tanaka', 'Visser', 'Wouters'];
/** The desks people work at, by the station's role: what share of them is staffed on a day, and who is drawn there. */
const DESKS: Record<string, { share: [number, number]; looks: string[] }> = {
    clerk: { share: [0.45, 0.85], looks: ['officeWorker', 'tellerB', 'teller'] },
    counter: { share: [0.5, 1], looks: ['headTeller', 'tellerB'] },
    archivist: { share: [0.3, 0.8], looks: ['officeWorker', 'headTeller'] },
    technician: { share: [0.2, 0.6], looks: ['itTech'] }
};
const CUSTOMERS = ['customerSuit', 'customerCoat', 'customerDress', 'customerCasual', 'customerOld', 'customerHoodie', 'passerby', 'officeWorker'];

export interface Population {
    people: GenPerson[];
    timeline: TimelineEvent[];
    opportunities: Opportunity[];
    intel: string[];
    timeOfDay: 'morning' | 'midday' | 'afternoon';
}

interface Ctx {
    rng: Rng;
    tier: Tier;
    headlines: Headline[];
    bank: GenRoom[];
    neighbours: Neighbour[];
    furnished: Furnished;
    guards: GuardPlan[];
    nav: Nav;
    furnish: Furnisher;
    timeLock: boolean;
    /** How the vault opens socially (`keys.ts`): its code, the code split between two people, or the Three Keys parts. */
    vaultOpens: 'code' | 'dualControl' | 'threeKeys';
    /** Whether the air duct from the roof is one of the ways in (a vent fitted and the roof has a ladder). */
    ductIn: boolean;
    softDepositWall: boolean;
    sidewalkY: number;
    width: number;
}

export function populate(ctx: Ctx): Population {
    const { rng, tier, bank, furnished, nav, furnish } = ctx, spec = TIER_SPECS[tier];
    const people: GenPerson[] = [];
    const names = rng.fork('names'), used = new Set<string>();
    const name = () => {
        for (;;) {
            const n = `${names.pick(FIRST)} ${names.pick(LAST)}`;
            if (!used.has(n)) { used.add(n); return n; }
        }
    };
    const add = (p: Omit<GenPerson, 'id' | 'name' | 'schedule' | 'traits'> & Partial<Pick<GenPerson, 'traits' | 'schedule'>>): GenPerson => {
        const person: GenPerson = { id: `${p.role}-${people.length}`, name: name(), schedule: [], traits: [], ...p };
        people.push(person);
        return person;
    };
    const stationsOf = (role: string) => furnished.stations.filter(s => s.role === role);
    const freeIn = (room: GenRoom | undefined, near?: P): P | undefined => {
        if (!room) return undefined;
        const tiles = nav.tilesOf(room).filter(t => furnish.canStand(t.x, t.y));
        if (near) tiles.sort((a, b) => Math.hypot(a.x - near.x, a.y - near.y) - Math.hypot(b.x - near.x, b.y - near.y));
        return near ? tiles[0] : rng.pick(tiles.length ? tiles : [undefined as never]);
    };
    const standAt = (p: P | undefined) => p && furnish.stand(p.x, p.y) ? p : undefined;

    // Staff at their stations.
    const tellerStations = stationsOf('teller');
    const tellerCount = Math.min(tellerStations.length, rng.int(...spec.tellers));
    tellerStations.slice(0, tellerCount).forEach((s, i) => {
        const head = i === 0 && spec.dualControl;
        add({ role: head ? 'headTeller' : 'teller', look: head ? 'headTeller' : rng.pick(['teller', 'tellerB']), observer: 'staff', tx: s.tx, ty: s.ty, facing: s.facing });
    });
    for (const s of stationsOf('driveTeller')) add({ role: 'teller', look: rng.pick(['teller', 'tellerB']), observer: 'staff', tx: s.tx, ty: s.ty, facing: s.facing, traits: ['drive-through window'] });
    const manager = stationsOf('manager')[0];
    if (manager) add({ role: 'manager', look: 'manager', observer: 'staff', tx: manager.tx, ty: manager.ty, facing: manager.facing });
    const operator = stationsOf('operator')[0];
    if (spec.operator && operator) add({ role: 'operator', look: 'operator', observer: 'staff', tx: operator.tx, ty: operator.ty, facing: operator.facing });
    const breakStation = stationsOf('staff')[0];
    if (breakStation && rng.chance(0.6)) add({ role: 'teller', look: rng.pick(['teller', 'tellerB']), observer: 'staff', tx: breakStation.tx, ty: breakStation.ty, facing: breakStation.facing, traits: ['on break'] });
    // The desks the building has, staffed for today: a seeded share of each kind, so some desks stand empty (out on a
    // call, on holiday) and which ones changes with the people, not the building.
    for (const [role, { share, looks }] of Object.entries(DESKS)) {
        const filled = share[0] + rng.next() * (share[1] - share[0]);
        for (const s of stationsOf(role)) if (rng.chance(filled)) add({ role, look: rng.pick(looks), observer: 'staff', tx: s.tx, ty: s.ty, facing: s.facing });
    }
    // The cleaner starts where their trolley is (the story pass put it somewhere), or anywhere in the staff corridors,
    // and sweeps the corridors.
    const corridors = bank.filter(r => r.type === 'staffCorridor');
    // A trolley the roof hatch's ladder (placed after it) closed in leaves the cleaner nowhere to sweep: they start in a
    // corridor instead.
    const to = freeIn(rng.pick(corridors));
    const trolley = stationsOf('cleaner').find(s => to && nav.path({ x: s.tx, y: s.ty }, to));
    const sweepFrom = trolley ? { x: trolley.tx, y: trolley.ty } : standAt(freeIn(rng.pick(corridors)));
    if (sweepFrom) {
        const path = to && nav.path(sweepFrom, to);
        const route = path && path.length > 2 ? { route: toTiles(corners(path).slice(1)) } : {};
        add({ role: 'cleaner', look: 'cleaner', observer: 'staff', tx: sweepFrom.x, ty: sweepFrom.y, facing: trolley?.facing ?? 'front', ...route });
    }
    // Guards on the posts and routes security planned.
    ctx.guards.forEach(g => {
        add({ role: g.role, look: g.role === 'chief' ? 'securityChief' : 'guard', observer: 'enforcer', tx: g.tx, ty: g.ty, facing: g.facing, ...(g.route.length ? { route: toTiles(g.route) } : {}), traits: ['radio check-ins'] });
    });

    // The crowd for the time of day: more at midday, more in a mall.
    const timeOfDay = rng.pick(['morning', 'midday', 'afternoon'] as const);
    const crowd = { small: 3, city: 5, hq: 8 }[tier] + (timeOfDay === 'midday' ? 3 : 0) + (ctx.headlines.includes('mallBank') ? 4 : 0);
    const customerSpots = [...stationsOf('queue'), ...stationsOf('customer')];
    const lobbies = bank.filter(r => r.type === 'lobby');
    for (let i = 0; i < crowd; i++) {
        const spot = customerSpots[i] ? { x: customerSpots[i]!.tx, y: customerSpots[i]!.ty, facing: customerSpots[i]!.facing } : (() => {
            const p = standAt(freeIn(rng.pick(lobbies)));
            return p && { ...p, facing: 'back' as PersonFacing };
        })();
        if (!spot) continue;
        add({ role: 'customer', look: rng.pick(CUSTOMERS), observer: 'civilian', tx: spot.x, ty: spot.y, facing: spot.facing });
    }
    // Hidden among them: off-duty cops (0–2), who look like any customer (§16.2).
    const customers = people.filter(p => p.role === 'customer');
    for (const cop of rng.shuffle(customers).slice(0, rng.int(0, Math.min(2, customers.length)))) {
        cop.traits.push('off-duty cop (armed)');
        cop.hidden = true;
    }
    // A rare hero, a teller in debt (bribable), the dye-pack teller.
    const civvies = people.filter(p => (p.role === 'customer' || p.role === 'teller') && !p.hidden);
    if (civvies.length && rng.chance(0.3)) rng.pick(civvies).traits.push('Bold (hero)');
    const tellers = people.filter(p => p.role === 'teller' || p.role === 'headTeller');
    if (tellers.length) rng.pick(tellers).traits.push('in debt (bribable)');
    if (spec.dyePacks && tellers.length) tellers[0]!.traits.push('dye pack in the drawer');

    // Neighbours and the street.
    for (const n of ctx.neighbours) {
        const cafe = n.rooms.find(r => r.type === 'cafe');
        if (cafe) {
            const barista = standAt(freeIn(cafe, { x: cafe.x + 2, y: cafe.y + 1 }));
            if (barista) add({ role: 'barista', look: 'barista', observer: 'civilian', tx: barista.x, ty: barista.y, facing: 'front' });
            for (let i = 0; i < 2; i++) {
                const guest = standAt(freeIn(cafe));
                if (guest) add({ role: 'cafe customer', look: rng.pick(CUSTOMERS), observer: 'civilian', tx: guest.x, ty: guest.y, facing: rng.pick(['front', 'back'] as const) });
            }
        }
        const lobby = n.rooms.find(r => r.type === 'towerLobby');
        if (lobby) {
            const desk = standAt(freeIn(lobby, { x: lobby.x + 8, y: lobby.y + 3 }));
            if (desk) add({ role: 'receptionist', look: 'officeWorker', observer: 'civilian', tx: desk.x, ty: desk.y, facing: 'back' });
        }
        const shop = n.rooms.find(r => r.type === 'shop');
        if (shop) {
            const clerk = standAt(freeIn(shop));
            if (clerk) add({ role: 'shop clerk', look: 'officeWorker', observer: 'civilian', tx: clerk.x, ty: clerk.y, facing: 'front' });
        }
    }
    for (let i = 0; i < 2; i++) {
        const y = ctx.sidewalkY + (i % 2), from = i % 2 ? ctx.width - 2 : 1, to = i % 2 ? 1 : ctx.width - 2;
        if (furnish.canStand(from, y) && nav.path({ x: from, y }, { x: to, y })?.every(p => p.y === y) && furnish.stand(from, y)) {
            add({ role: 'passer-by', look: rng.pick(['passerby', 'customerCasual', 'officeWorker']), observer: 'civilian', tx: from, ty: y, facing: 'front', patrol: { tx: to, ty: y } });
        }
    }

    const { timeline, opportunities, intel } = scheduleDay(ctx, people);
    return { people, timeline, opportunities, intel, timeOfDay };
}

const toTiles = (route: P[]) => route.map(p => ({ tx: p.x, ty: p.y }));

/**
 * The bank's day (§16.3): the events on its timeline, each person's schedule from them, and the opportunities they
 * open (§17.6), with how each is found.
 */
function scheduleDay(ctx: Ctx, people: GenPerson[]): { timeline: TimelineEvent[]; opportunities: Opportunity[]; intel: string[] } {
    const { rng, headlines, tier, bank } = ctx, spec = TIER_SPECS[tier];
    const t = rng.fork('timeline'), timeline: TimelineEvent[] = [], opportunities: Opportunity[] = [];
    const roomId = (type: string) => bank.find(r => r.type === type)?.id ?? '';
    const of = (role: string) => people.filter(p => p.role === role);
    const block = (p: GenPerson, from: number, activity: string, room: string) => p.schedule.push({ from, activity, room });
    const roomAt = (p: GenPerson) => ctx.nav.site.roomAt(p.tx, p.ty);
    const roomName = (id: string) => ctx.nav.site.room(id).name.toLowerCase();
    for (const p of people) block(p, 1, p.route ? 'patrol' : p.role === 'customer' ? 'queue, then the teller window, then leave' : 'at post', p.route ? 'route' : bank.find(r => r === roomAt(p))?.id ?? 'outside');

    if (t.chance(0.25)) timeline.push({ turn: 1, name: 'Opening', detail: 'Staff arrive; the vault day gate opens.' });
    const close = t.int(36, 44) + (headlines.includes('managerLate') ? 8 : 0);
    // Lunch: the manager takes the keycard along, or two tellers go.
    const lunch = t.int(12, 16), managerLunch = t.chance(0.5);
    const manager = of('manager')[0];
    timeline.push({ turn: lunch, name: 'Lunch rotation', detail: managerLunch ? 'The manager goes to lunch; the keycard goes too.' : 'Two tellers leave their windows.', duration: 6 });
    if (managerLunch && manager) {
        block(manager, lunch, 'lunch (out of the building)', 'outside');
        block(manager, lunch + 6, 'back in the office', roomId('managerOffice'));
        if (t.chance(0.6)) opportunities.push({ id: 'keycard-drawer', text: `The manager takes lunch at turn ${lunch} and leaves the keycard in the desk drawer.`, found: 'eavesdropping', turn: lunch });
    } else for (const p of of('teller').slice(0, 2)) { block(p, lunch, 'lunch', roomId('breakRoom')); block(p, lunch + 6, 'back at the window', roomId('tellerLine')); }
    const shift = t.int(20, 26);
    timeline.push({ turn: shift, name: 'Shift change', detail: 'Staff gather in the break room; uniforms are left unattended.', duration: 3 });
    for (const p of [...of('teller'), ...of('cleaner')]) { block(p, shift, 'shift change', roomId('breakRoom')); block(p, shift + 3, 'back to work', p.schedule[0]!.room); }
    if (t.chance(0.6)) {
        const run = t.int(8, 30), teller = of('teller')[0];
        timeline.push({ turn: run, name: 'Cash run', detail: 'A teller wheels a cash cart through the staff corridor to the vault.', duration: 3 });
        if (teller) { block(teller, run, 'cash run to the vault', roomId('vault')); block(teller, run + 3, 'back at the window', roomId('tellerLine')); }
        opportunities.push({ id: 'cash-cart', text: `The cash cart runs through the staff corridor at turn ${run}.`, found: 'documents', turn: run });
    }
    if (manager) {
        const inspection = t.int(6, 30);
        timeline.push({ turn: inspection, name: 'Vault inspection', detail: 'The manager inspects the vault.', duration: 2 });
        block(manager, inspection, 'vault inspection', roomId('vault'));
        block(manager, inspection + 2, 'back in the office', roomId('managerOffice'));
    }
    let timeLockOpen: number | undefined;
    if (headlines.includes('armouredCar') || (spec.armouredCar && t.chance(spec.armouredCar * 0.5))) {
        timeLockOpen = t.int(14, 30);
        timeline.push({ turn: timeLockOpen, name: 'Armoured car', detail: `Couriers arrive at the ${roomId('loadingBay') ? 'loading bay' : 'back door'}; the vault time lock opens for 5 turns.`, duration: 5 });
    } else if (ctx.timeLock) {
        timeLockOpen = t.int(10, 28);
        timeline.push({ turn: timeLockOpen, name: 'Time-lock window', detail: 'The vault time lock opens for its scheduled window.', duration: 4 });
    }
    // Police drive past every 8 to 12 turns; their officers see through windows.
    for (let turn = t.int(4, 10); turn < close; turn += t.int(8, 12)) timeline.push({ turn, name: 'Patrol drive-by', detail: 'A police car passes on the street.' });
    if (t.chance(0.4) && (roomId('serverRoom') || roomId('alarmCloset'))) {
        const visit = t.int(10, 30), room = roomId('serverRoom') ? 'server room' : 'alarm closet';
        timeline.push({ turn: visit, name: 'IT technician', detail: `An IT technician visits the ${room}.`, duration: 3 });
        opportunities.push({ id: 'it-tech', text: `An IT tech visits the ${room} at turn ${visit}; ambush them for their access card.`, found: 'intel', turn: visit });
    }
    const op = of('operator')[0];
    if (op && t.chance(0.5)) {
        const smoke = t.int(10, 30);
        timeline.push({ turn: smoke, name: 'Smoke break', detail: 'The CCTV operator smokes at the alley door.', duration: 2 });
        block(op, smoke, 'smoke break at the alley door', 'outside');
        block(op, smoke + 2, 'back at the console', roomId('cctvRoom'));
        opportunities.push({ id: 'smoke-break', text: `The operator smokes at the alley door at turn ${smoke} and props the fire door open.`, found: 'eavesdropping', turn: smoke });
    }
    timeline.push({ turn: close, name: 'Closing time', detail: 'The doors lock, customers leave, and the guards sweep every room. Then the time lock re-engages.' });
    for (const p of people.filter(p => p.observer === 'enforcer')) block(p, close, 'closing sweep', 'all rooms');

    // Opportunities that follow from the building (§17.6); a note left on a desk (the story pass) comes first.
    const note = ctx.furnished.stories.find(s => s.id === 'sticky-note');
    // What the note gives has to be part of how this vault opens (§15.2): the code, half of it, or the time-lock window.
    const noted = { code: 'the vault code', dualControl: "the head teller's half of the vault code", threeKeys: 'the time-lock window, written out' }[ctx.vaultOpens];
    if (note) opportunities.unshift({ id: 'sticky-note', text: `A note by a monitor in the ${roomName(note.room)} has ${noted} on it.`, found: 'documents' });
    const bribable = people.find(p => p.traits.includes('in debt (bribable)'));
    if (bribable) opportunities.push({ id: 'bribe', text: `${bribable.name}, a teller, is in debt and can be bribed (Smooth Talker) to stay off the alarm.`, found: 'eavesdropping' });
    if (ctx.neighbours.some(n => n.scaffoldTop)) opportunities.push({ id: 'scaffolding', text: 'Renovation scaffolding next door gives roof access.', found: 'intel' });
    if (ctx.softDepositWall) opportunities.push({ id: 'cafe-wall', text: 'The café shares a Soft wall with the deposit-box room.', found: 'documents' });
    if (ctx.ductIn) opportunities.push({ id: 'vent', text: 'The server-room vent connects to the roof: a way in for someone small.', found: 'documents' });
    if (roomId('recordsRoom')) opportunities.push({ id: 'records', text: "The records room files the guard rota and the alarm company's service visits.", found: 'documents' });
    // Every bank has these to fall back on, so there are always three to find.
    const guard = people.find(p => p.role === 'lobbyGuard');
    const fallback: Opportunity[] = [
        { id: 'cleaner-keys', text: `The cleaner keeps the back-door keys ${roomId('cleanersCloset') ? "on a hook in the cleaner's closet" : 'on their belt'}.`, found: 'eavesdropping' },
        { id: 'manager-pc', text: "The manager's PC holds the vault code and the time-lock schedule.", found: 'documents' },
        ...(guard ? [{ id: 'check-in', text: `${guard.name}, the lobby guard, radios in on the hour; dispatch only notices a missed call.`, found: 'eavesdropping' as const }] : [])
    ];
    // Keep three to five, the more specific first.
    const kept = [...opportunities, ...fallback].slice(0, Math.max(3, Math.min(5, opportunities.length)));
    timeline.sort((a, b) => a.turn - b.turn);
    const intel = ['Guard rota: patrol routes and check-in times', `Vault: ${spec.vaultClasses.join(' or ')} class, ${ctx.timeLock ? 'time lock' : 'no time lock'}`, op ? "The operator's schedule" : 'Cameras record only; no operator', 'Shared walls with the neighbours'];
    if (timeLockOpen !== undefined) intel.push(`Time-lock window from turn ${timeLockOpen}`);
    return { timeline, opportunities: kept, intel };
}

export type { ScheduleBlock };
