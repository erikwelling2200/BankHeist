import type { LevelProp } from '../level/plan';
import { connect } from './build';
import type { Furnisher } from './furnish';
import type { GenRoom, Rect } from './model';
import type { Slot } from './plot';
import type { Rng } from './rng';
import type { Site } from './site';

/*
 * The neighbours (§17.5): each kind fills its slot with its rooms, and once the walls are up gets its front, its doors
 * and its furniture. What they are for: the café's window seat for casing, the vacant shop's soft wall to breach, the
 * garage's hidden getaway spot, the building site's scaffolding up to the roofs, the office tower's rented room for a
 * sniper.
 */

export interface Neighbour {
    slot: Slot;
    rooms: GenRoom[];
    /** The room that shares a wall with the bank, if any, and whether that wall is soft enough to breach. */
    party?: GenRoom;
    soft: boolean;
    /** Raised tiles reached from the ground next to the bank's wall: the scaffold's top. */
    scaffoldTop?: { x: number; y: number };
    /** A spot inside where a getaway car can wait unseen. */
    hiddenSpot?: { x: number; y: number };
    /** The sniper nest's window tiles, looking at the bank. */
    nest?: GenRoom;
}

/** Places a neighbour's rooms in its slot. Walls come from the site's wall pass; `finishNeighbour` adds the rest. */
export function placeNeighbour(site: Site, slot: Slot, rng: Rng): Neighbour {
    const { rect: r, kind } = slot, wing = slot.side === 'across' ? 'outside' : slot.side;
    const add = (type: Parameters<Site['addRoom']>[0], rect: Rect) => site.addRoom(type, rect, { wing });
    const back = Math.min(6, Math.max(4, Math.floor(r.h / 4)));
    switch (kind) {
        case 'cafe': {
            const rooms = [add('cafeKitchen', { ...r, h: back }), add('cafe', { ...r, y: r.y + back, h: r.h - back })];
            return { slot, rooms, party: rooms[1], soft: rng.chance(0.5) };
        }
        case 'vacantShop': {
            const rooms = [add('vacantBackRoom', { ...r, h: back }), add('vacantShop', { ...r, y: r.y + back, h: r.h - back })];
            return { slot, rooms, party: rooms[1], soft: true };
        }
        case 'shop':
            return { slot, rooms: [add('shop', r)], soft: false };
        case 'garage':
            return { slot, rooms: [add('garage', r)], soft: false, hiddenSpot: { x: r.x + Math.floor(r.w / 2) - 1, y: r.y + Math.floor(r.h / 2) } };
        case 'buildingSite': {
            const room = add('buildingSite', r);
            // Scaffolding along the bank's wall: two boards wide, a stair tower at its street end.
            const bankSide = slot.side === 'west' ? r.x + r.w - 2 : r.x;
            site.paint({ x: bankSide, y: r.y + 1, w: 2, h: r.h - 5 }, 'k');
            site.paint({ x: bankSide, y: r.y + r.h - 4, w: 2, h: 3 }, 'z');
            return { slot, rooms: [room], soft: false, scaffoldTop: { x: slot.side === 'west' ? bankSide + 1 : bankSide, y: r.y + 2 } };
        }
        case 'tower':
            return placeTower(site, slot);
    }
}

/** The office tower across the street: its lobby, the stairwell, and upstairs the rented room and an office to let. */
function placeTower(site: Site, slot: Slot): Neighbour {
    const r = slot.rect, T = 32, x0 = r.x + Math.floor((r.w - T) / 2);
    const rooms: GenRoom[] = [];
    if (x0 > r.x) rooms.push(site.addRoom('plaza', { x: r.x, y: r.y, w: x0 - r.x, h: r.h }, { name: 'West plaza' }));
    rooms.push(site.addRoom('towerLobby', { x: x0, y: r.y, w: 14, h: r.h }, { wing: 'outside' }));
    const stairs = site.addRoom('towerStairs', { x: x0 + 14, y: r.y, w: 4, h: r.h }, { wing: 'outside' });
    site.paint({ x: x0 + 14, y: r.y, w: 4, h: 1 }, 'h');
    site.paint({ x: x0 + 16, y: r.y + 1, w: 2, h: r.h - 1 }, 'z');
    const nest = site.addRoom('nest', { x: x0 + 18, y: r.y, w: 7, h: r.h }, { wing: 'outside' });
    const toLet = site.addRoom('officeToLet', { x: x0 + 25, y: r.y, w: 7, h: r.h }, { wing: 'outside' });
    rooms.push(stairs, nest, toLet);
    if (x0 + T < r.x + r.w) rooms.push(site.addRoom('plaza', { x: x0 + T, y: r.y, w: r.x + r.w - x0 - T, h: r.h }, { name: 'East plaza' }));
    return { slot, rooms, soft: false, nest };
}

/** A front of `kinds` along the north edge of `y` (the street side is north for the far side, south otherwise). */
function front(site: Site, x0: number, x1: number, y: number, kindAt: (x: number) => Parameters<Site['setWall']>[1] | undefined): void {
    for (let x = x0; x < x1; x++) {
        const kind = kindAt(x), e = { run: 'eastWest' as const, tx: x, ty: y };
        if (kind) site.setWall(e, kind);
        else site.clearWall(e);
    }
}

/**
 * Gives a neighbour its front, its doors and its furniture, once the walls are up. `street` is the room in front of
 * it, `alley` the one behind.
 */
export function finishNeighbour(site: Site, n: Neighbour, furnish: Furnisher, rng: Rng): void {
    const r = n.slot.rect, frontY = r.y + r.h, x1 = r.x + r.w;
    const street = site.roomAt(r.x, frontY), alley = site.roomAt(r.x, r.y - 1);
    const doorX = r.x + Math.floor(r.w / 2);
    const add = (p: LevelProp, room?: GenRoom) => furnish.try(p, room);
    const edgeEnd = (x: number) => x === r.x || x === x1 - 1;
    switch (n.slot.kind) {
        case 'cafe': {
            const [kitchen, cafe] = n.rooms as [GenRoom, GenRoom];
            front(site, r.x, x1, frontY, x => (edgeEnd(x) ? 'brickPier' : x === doorX ? 'doorTower' : 'window'));
            site.addDoor(cafe, street!, { run: 'eastWest', tx: doorX, ty: frontY }, 'none', 'doorTower');
            connect(site, kitchen, cafe, 'none', rng);
            backDoor(site, kitchen, alley!, rng);
            add({ kind: 'kitchenCounter', tx: r.x, ty: r.y, alignX: 'west', alignY: 'north' }, kitchen);
            add({ kind: 'fridge', tx: x1 - 1, ty: r.y, alignY: 'north' }, kitchen);
            add({ kind: 'cafeCounter', tx: r.x + 1, ty: kitchen.y + kitchen.h, alignY: 'north' }, cafe) || add({ kind: 'cafeCounter', tx: x1 - 3, ty: kitchen.y + kitchen.h, alignY: 'north' }, cafe);
            add({ kind: 'menuBoard', tx: x1 - 2, ty: kitchen.y + kitchen.h }, cafe);
            for (let y = kitchen.y + kitchen.h + 3; y < frontY - 1; y += 3) for (let x = r.x + 1; x < x1 - 1; x += 3) {
                if (add({ kind: 'cafeTable', tx: x, ty: y }, cafe)) {
                    add({ kind: 'chair', tx: x - 1, ty: y }, cafe);
                    add({ kind: 'chair', tx: x + 1, ty: y }, cafe);
                }
            }
            add({ kind: 'plant', tx: r.x, ty: frontY - 1 }, cafe);
            // Two tables out on the pavement.
            add({ kind: 'cafeTable', tx: r.x + 1, ty: frontY + 1 }) && add({ kind: 'chair', tx: r.x + 2, ty: frontY + 1 });
            break;
        }
        case 'vacantShop': {
            const [backRoom, shop] = n.rooms as [GenRoom, GenRoom];
            front(site, r.x, x1, frontY, x => (edgeEnd(x) ? 'brickPier' : x === doorX || x === doorX + 1 ? 'shutter' : 'boarded'));
            site.addDoor(shop, street!, { run: 'eastWest', tx: doorX, ty: frontY }, 'mechanical', 'shutter');
            connect(site, backRoom, shop, 'none', rng);
            backDoor(site, backRoom, alley!, rng);
            add({ kind: 'boxes', tx: r.x, ty: r.y, alignX: 'west', alignY: 'north' }, backRoom);
            add({ kind: 'boxes', tx: x1 - 1, ty: backRoom.y + backRoom.h - 1, alignX: 'east', alignY: 'south' }, backRoom);
            add({ kind: 'shelving', tx: r.x + 1, ty: shop.y, alignY: 'north' }, shop);
            add({ kind: 'chair', tx: x1 - 2, ty: shop.y + 3 }, shop);
            add({ kind: 'boxes', tx: r.x, ty: frontY - 1, alignX: 'west', alignY: 'south' }, shop);
            break;
        }
        case 'shop': {
            const [shop] = n.rooms as [GenRoom];
            front(site, r.x, x1, frontY, x => (edgeEnd(x) ? 'brickPier' : x === doorX ? 'doorTower' : 'window'));
            site.addDoor(shop, street!, { run: 'eastWest', tx: doorX, ty: frontY }, 'none', 'doorTower');
            backDoor(site, shop, alley!, rng);
            for (let x = r.x + 1; x < x1 - 1; x += 3) for (let y = r.y + 1; y < frontY - 4; y += 2) add({ kind: 'shelving', tx: x, ty: y }, shop);
            add({ kind: 'kitchenCounter', tx: r.x, ty: frontY - 2, alignX: 'west' }, shop);
            add({ kind: 'fridge', tx: x1 - 1, ty: r.y, alignY: 'north' }, shop);
            break;
        }
        case 'garage': {
            const [garage] = n.rooms as [GenRoom];
            // Open for cars at the front and at the back; brick piers between the bays.
            const gate = [doorX - 1, doorX, doorX + 1];
            front(site, r.x, x1, frontY, x => (gate.includes(x) ? undefined : 'brickPier'));
            site.addDoor(garage, street!, { run: 'eastWest', tx: doorX, ty: frontY }, 'none', undefined);
            for (const x of gate) site.clearWall({ run: 'eastWest', tx: x, ty: r.y });
            site.addDoor(garage, alley!, { run: 'eastWest', tx: doorX, ty: r.y }, 'none', undefined);
            for (let y = r.y + 3; y < frontY - 2; y += 4) for (const x of [r.x + 1, x1 - 2]) add({ kind: 'pillar', tx: x, ty: y }, garage);
            break;
        }
        case 'buildingSite': {
            const [siteRoom] = n.rooms as [GenRoom];
            // A chain-link fence along the street and the alley, a gate in each.
            front(site, r.x, x1, frontY, x => (x === doorX || x === doorX + 1 ? undefined : 'fence'));
            front(site, r.x, x1, r.y, x => (x === doorX ? undefined : 'fence'));
            const outer = n.slot.side === 'west' ? r.x : x1;
            for (let y = r.y; y < frontY; y++) if (site.inside(outer, y) || outer === site.width || outer === 0) site.setWall({ run: 'northSouth', tx: outer, ty: y }, 'fence');
            site.addDoor(siteRoom, street!, { run: 'eastWest', tx: doorX, ty: frontY }, 'none', undefined);
            site.addDoor(siteRoom, alley!, { run: 'eastWest', tx: doorX, ty: r.y }, 'none', undefined);
            const mid = n.slot.side === 'west' ? r.x + 1 : x1 - 3;
            add({ kind: 'boxes', tx: mid, ty: r.y + 2 }, siteRoom);
            add({ kind: 'boxes', tx: mid, ty: r.y + 4 }, siteRoom);
            add({ kind: 'dumpster', tx: n.slot.side === 'west' ? r.x : x1 - 4, ty: frontY - 3 }, siteRoom);
            add({ kind: 'generator', tx: mid, ty: r.y + 7 }, siteRoom);
            break;
        }
        case 'tower':
            finishTower(site, n, furnish, rng);
            break;
    }
}

function backDoor(site: Site, room: GenRoom, alley: GenRoom, rng: Rng): void {
    const edges = site.sharedEdges(room, alley);
    if (!edges.length) return;
    const e = edges[rng.int(1, Math.max(1, edges.length - 2))] ?? edges[0]!;
    site.addDoor(room, alley, e, 'mechanical', 'doorBack');
}

/** The tower's glass front, its doors and stairs, the nest's furniture; trees and benches on the plazas. */
function finishTower(site: Site, n: Neighbour, furnish: Furnisher, rng: Rng): void {
    const r = n.slot.rect, y = r.y;
    const lobby = n.rooms.find(x => x.type === 'towerLobby')!, stairs = n.rooms.find(x => x.type === 'towerStairs')!;
    const nest = n.rooms.find(x => x.type === 'nest')!, toLet = n.rooms.find(x => x.type === 'officeToLet')!;
    const walk = site.roomAt(lobby.x, y - 1)!;
    const doorX = lobby.x + 6;
    front(site, lobby.x, toLet.x + toLet.w, y, x => (x >= stairs.x && x < stairs.x + stairs.w ? 'concrete' : x === doorX || x === doorX + 1 ? 'doorTower' : 'curtain'));
    site.addDoor(lobby, walk, { run: 'eastWest', tx: doorX, ty: y }, 'none', 'doorTower');
    // The tower's sides and back are concrete; the stairwell opens off the lobby at its foot, the nest off its landing.
    site.addDoor(lobby, stairs, { run: 'northSouth', tx: stairs.x, ty: y + 3 }, 'none', 'doorWood');
    site.addDoor(stairs, nest, { run: 'northSouth', tx: nest.x, ty: y }, 'mechanical', 'doorWood');
    site.addDoor(nest, toLet, { run: 'northSouth', tx: toLet.x, ty: y + 2 }, 'mechanical', 'doorWood');
    const add = (p: LevelProp, room?: GenRoom) => furnish.try(p, room);
    add({ kind: 'mat', tx: doorX, ty: y }, lobby);
    add({ kind: 'desk', tx: lobby.x + 8, ty: y + 2, facing: 'north' }, lobby);
    add({ kind: 'sofa', tx: lobby.x + 1, ty: y + 4, facing: 'north', alignY: 'south' }, lobby);
    add({ kind: 'coffeeTable', tx: lobby.x + 1, ty: y + 3 }, lobby);
    add({ kind: 'plant', tx: lobby.x, ty: y }, lobby);
    add({ kind: 'plant', tx: lobby.x + 13, ty: y + 4 }, lobby);
    add({ kind: 'desk', tx: nest.x + 2, ty: y, alignY: 'north' }, nest);
    add({ kind: 'rifleCase', tx: nest.x + 5, ty: y + 2 }, nest);
    add({ kind: 'officeChair', tx: nest.x + 1, ty: y + 2 }, nest);
    add({ kind: 'boxes', tx: nest.x, ty: y + 4, alignX: 'west', alignY: 'south' }, nest);
    add({ kind: 'desk', tx: toLet.x + 3, ty: y + 2 }, toLet);
    add({ kind: 'boxes', tx: toLet.x + 1, ty: y, alignY: 'north' }, toLet);
    add({ kind: 'chair', tx: toLet.x + 5, ty: y, alignY: 'north' }, toLet);
    for (const plaza of n.rooms.filter(x => x.type === 'plaza')) {
        for (let x = plaza.x + 1; x + 2 <= plaza.x + plaza.w; x += 7) {
            add({ kind: 'tree', tx: x, ty: y + 1 }, plaza);
            add({ kind: 'bench', tx: x + 3, ty: y + 1, facing: 'south' }, plaza) || add({ kind: 'bench', tx: x + 3, ty: y + 3, facing: 'north' }, plaza);
        }
        add({ kind: 'bin', tx: plaza.x + plaza.w - 2, ty: y + 4 }, plaza);
    }
    void rng;
}
