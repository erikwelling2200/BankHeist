/** Textures the bank scene makes. Those under `bank-` and `person-` belong to one bank and go when another is drawn. */
export const KEY = {
    floor: 'bank-floor', walls: 'bank-walls', shade: 'bank-shade', glow: 'bank-glow', clouds: 'bank-clouds', mote: 'bank-mote', shadow: 'person-shadow'
} as const;

/** Draw depths. Walls, props and people standing on the floor are ordered from `standing` up by their base line. */
export const DEPTH = { floor: 0, shade: 2, sunFloor: 3, shadows: 4, standing: 10, haze: 1910, emissive: 1920, clouds: 1930, motes: 1940, knowledge: 1950 } as const;
