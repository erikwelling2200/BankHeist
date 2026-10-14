import type { Room } from '../level/plan';
import type { RoomType } from './model';

/*
 * What every room type is (§17.4, §8.1): its zone, how it is lit, the floor it is drawn with, which rooms it may open
 * onto and how big it should be. Archetypes only place rooms; the connector gives each one its doors from these rules.
 */

export interface RoomRule {
    name: string;
    zone: Room['zone'];
    light: Room['light'];
    floor: string;
    /** Rooms it opens onto, best first; it gets a door to the first of them it touches. */
    opensOnto: RoomType[];
    /** How its door to them locks. */
    lock: 'none' | 'mechanical' | 'keycard' | 'vault';
    /**
     * The floor area (in tiles) a wing's program gives the room, and the most it may ever have: space a program can't
     * use becomes another room with a job rather than a bigger one. Rooms that read well big (the lobby, the loading
     * bay, corridors) and the fixed core have none.
     */
    area?: { target: number; max: number };
}

export const ROOM_RULES: Record<RoomType, RoomRule> = {
    lobby: { name: 'Lobby', zone: 'public', light: 'warm', floor: '.', opensOnto: [], lock: 'none' },
    tellerLine: { name: 'Teller line', zone: 'staff', light: 'bright', floor: ',', opensOnto: ['staffCorridor'], lock: 'keycard' },
    restroom: { name: 'Restrooms', zone: 'public', light: 'cool', floor: 't', opensOnto: ['lobby'], lock: 'none', area: { target: 28, max: 60 } },
    atmRoom: { name: 'ATM service room', zone: 'staff', light: 'dim', floor: ',', opensOnto: ['staffCorridor', 'tellerLine', 'lobby'], lock: 'keycard', area: { target: 18, max: 48 } },
    managerOffice: {
        name: "Manager's office", zone: 'staff', light: 'warm', floor: ',', opensOnto: ['staffCorridor', 'tellerLine', 'mezzanine', 'lobby', 'staffOffice'], lock: 'mechanical',
        area: { target: 30, max: 48 }
    },
    breakRoom: {
        name: 'Break room', zone: 'staff', light: 'warm', floor: ',', opensOnto: ['staffCorridor', 'lobby', 'tellerLine', 'staffOffice', 'conferenceRoom'], lock: 'keycard',
        area: { target: 32, max: 56 }
    },
    cleanersCloset: {
        name: "Cleaner's closet", zone: 'staff', light: 'dim', floor: ',', opensOnto: ['staffCorridor', 'breakRoom', 'loadingBay', 'mezzanine', 'lobby', 'staffOffice', 'recordsRoom'],
        lock: 'mechanical', area: { target: 10, max: 24 }
    },
    staffCorridor: { name: 'Staff corridor', zone: 'staff', light: 'cool', floor: ',', opensOnto: [], lock: 'none' },
    mantrap: { name: 'Mantrap', zone: 'secure', light: 'cool', floor: 'q', opensOnto: ['staffCorridor'], lock: 'keycard' },
    cctvRoom: {
        name: 'CCTV room', zone: 'secure', light: 'dim', floor: 'q', opensOnto: ['staffCorridor', 'stairwell', 'mezzanine', 'breakRoom', 'staffOffice'], lock: 'keycard',
        area: { target: 28, max: 56 }
    },
    alarmCloset: {
        name: 'Alarm and electrical closet', zone: 'secure', light: 'dim', floor: 'q', opensOnto: ['staffCorridor', 'loadingBay'], lock: 'keycard', area: { target: 24, max: 48 }
    },
    serverRoom: { name: 'Server room', zone: 'secure', light: 'cool', floor: 'q', opensOnto: ['staffCorridor', 'alarmCloset'], lock: 'keycard', area: { target: 36, max: 56 } },
    antechamber: { name: 'Vault antechamber', zone: 'secure', light: 'cool', floor: 'q', opensOnto: ['mantrap', 'staffCorridor'], lock: 'keycard' },
    vault: { name: 'Vault', zone: 'secure', light: 'cool', floor: 'v', opensOnto: ['antechamber'], lock: 'vault' },
    depositBoxes: { name: 'Deposit-box room', zone: 'secure', light: 'cool', floor: 'q', opensOnto: ['antechamber', 'staffCorridor'], lock: 'keycard', area: { target: 40, max: 64 } },
    loadingBay: { name: 'Loading bay', zone: 'staff', light: 'dim', floor: 'q', opensOnto: ['staffCorridor'], lock: 'keycard' },
    mezzanine: { name: 'Mezzanine', zone: 'staff', light: 'warm', floor: 'j', opensOnto: [], lock: 'none' },
    stairwell: { name: 'Stairs', zone: 'staff', light: 'dim', floor: ',', opensOnto: [], lock: 'none' },
    // Rooms a wing's program adds where it has space to spare, each with a job (§17.4).
    countingRoom: { name: 'Counting room', zone: 'secure', light: 'bright', floor: 'q', opensOnto: ['staffCorridor', 'tellerLine', 'antechamber'], lock: 'keycard', area: { target: 28, max: 48 } },
    recordsRoom: {
        name: 'Records room', zone: 'staff', light: 'dim', floor: ',', opensOnto: ['staffCorridor', 'mezzanine', 'staffOffice', 'managerOffice', 'conferenceRoom', 'breakRoom'],
        lock: 'mechanical', area: { target: 28, max: 48 }
    },
    staffOffice: {
        name: 'Staff office', zone: 'staff', light: 'bright', floor: ',',
        opensOnto: ['staffCorridor', 'lobby', 'mezzanine', 'tellerLine', 'breakRoom', 'managerOffice', 'conferenceRoom', 'staffOffice'], lock: 'keycard', area: { target: 48, max: 64 }
    },
    conferenceRoom: {
        name: 'Conference room', zone: 'staff', light: 'warm', floor: ',', opensOnto: ['staffCorridor', 'mezzanine', 'staffOffice', 'managerOffice', 'breakRoom', 'recordsRoom', 'lobby'],
        lock: 'mechanical', area: { target: 36, max: 56 }
    },
    cafe: { name: 'Café', zone: 'neighbour', light: 'warm', floor: 'f', opensOnto: [], lock: 'none' },
    cafeKitchen: { name: 'Café kitchen', zone: 'neighbour', light: 'cool', floor: 't', opensOnto: ['cafe'], lock: 'none' },
    vacantShop: { name: 'Vacant shop', zone: 'neighbour', light: 'none', floor: 'u', opensOnto: [], lock: 'none' },
    vacantBackRoom: { name: 'Vacant back room', zone: 'neighbour', light: 'none', floor: 'u', opensOnto: ['vacantShop'], lock: 'none' },
    shop: { name: 'Shop', zone: 'neighbour', light: 'bright', floor: 'm', opensOnto: [], lock: 'none' },
    garage: { name: 'Parking garage', zone: 'neighbour', light: 'dim', floor: 'p', opensOnto: [], lock: 'none' },
    buildingSite: { name: 'Building site', zone: 'outdoors', light: 'none', floor: 'e', opensOnto: [], lock: 'none' },
    towerLobby: { name: 'Office tower lobby', zone: 'neighbour', light: 'bright', floor: 'm', opensOnto: [], lock: 'none' },
    towerStairs: { name: 'Tower stairwell', zone: 'neighbour', light: 'dim', floor: 'q', opensOnto: ['towerLobby'], lock: 'none' },
    nest: { name: 'Sniper nest (rented)', zone: 'neighbour', light: 'dim', floor: 'n', opensOnto: [], lock: 'none' },
    officeToLet: { name: 'Office to let', zone: 'neighbour', light: 'dim', floor: 'n', opensOnto: ['nest'], lock: 'none' },
    alley: { name: 'Alley', zone: 'outdoors', light: 'none', floor: 'a', opensOnto: [], lock: 'none' },
    street: { name: 'Street', zone: 'outdoors', light: 'none', floor: 's', opensOnto: [], lock: 'none' },
    sideRoad: { name: 'Side road', zone: 'outdoors', light: 'none', floor: 'r', opensOnto: [], lock: 'none' },
    plaza: { name: 'Plaza', zone: 'outdoors', light: 'none', floor: 'y', opensOnto: [], lock: 'none' },
    parkingLot: { name: 'Parking lot', zone: 'outdoors', light: 'none', floor: 'a', opensOnto: [], lock: 'none' },
    farSidewalk: { name: 'Far sidewalk', zone: 'outdoors', light: 'none', floor: 's', opensOnto: [], lock: 'none' },
    backLot: { name: 'Back lot', zone: 'outdoors', light: 'none', floor: 'a', opensOnto: [], lock: 'none' }
};

/** Rooms people move through, so other rooms open onto them and two of them side by side join without a wall. */
export const CIRCULATION: readonly RoomType[] = ['staffCorridor'];

/** Pairs of bank rooms that meet without a wall: the counter, the stairs and the mezzanine stand open to the floor. */
const OPEN: [RoomType, RoomType][] = [['lobby', 'tellerLine'], ['lobby', 'stairwell'], ['lobby', 'mezzanine'], ['stairwell', 'mezzanine'], ['stairwell', 'tellerLine'], ['lobby', 'lobby'], ['staffCorridor', 'staffCorridor']];

export const isOpenPair = (a: RoomType, b: RoomType): boolean => OPEN.some(([p, q]) => (p === a && q === b) || (p === b && q === a));

/** Whether a room of type `a` may have its door into a room of type `b` (its rules), or the two meet without a wall. */
export const opensOnto = (a: RoomType, b: RoomType): boolean => ROOM_RULES[a].opensOnto.includes(b) || isOpenPair(a, b);
