/** Textures the bank scene makes. Those under `bank-` and `person-` belong to one bank and go when another is drawn. */
export const KEY = {
    floor: 'bank-floor', walls: 'bank-walls', raised: 'bank-raised', shade: 'bank-shade', glow: 'bank-glow', clouds: 'bank-clouds', mote: 'bank-mote', shadow: 'person-shadow',
    lyingShadow: 'person-shadow-lying'
} as const;

/** Draw depths. Walls, props and people standing on the floor are ordered from `standing` up by their base line. */
/**
 * How far after the things whose base line is a raised tile's north edge that tile is drawn (raised.ts), so the floor
 * behind it hides behind it; what stands on it, its people's shadows included, comes after it.
 */
export const RAISED_DEPTH = 0.01;

export const DEPTH = { floor: 0, shade: 2, sunFloor: 3, shadows: 4, standing: 10, haze: 1910, emissive: 1920, clouds: 1930, motes: 1940, knowledge: 1950 } as const;
