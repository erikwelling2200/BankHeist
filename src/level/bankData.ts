import { BANK_PEOPLE, BANK_PLAN, BANK_PROPS, BANK_ROOMS } from './bank';
import { parsePlan, type Level, type LevelPerson, type LevelProp, type Room } from './plan';

/** Everything the bank scene draws: the level, its rooms (for the lamps), its props and its people, and where to look first. */
export interface BankData {
    level: Level;
    rooms: Room[];
    props: LevelProp[];
    people: LevelPerson[];
    focus: { tx: number; ty: number };
    /** Rooms the blueprint shows only as outlines before casing (§17.8). */
    outlines?: { x: number; y: number; w: number; h: number; name: string }[];
}

/** The hand-made example bank (`bank.ts`). */
export function exampleBank(): BankData {
    return { level: parsePlan(BANK_PLAN), rooms: BANK_ROOMS, props: BANK_PROPS, people: BANK_PEOPLE, focus: { tx: 30, ty: 21 } };
}
