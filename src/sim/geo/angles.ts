/*
 * Angles for the shot geometry (§11.2), the same to the last bit in every engine. `Math.sin`, `Math.cos` and
 * `Math.atan2` are only approximated by the language, so engines may differ in the last bit (implementation plan §2.3);
 * these use only + − × ÷ and `Math.sqrt`, which IEEE 754 rounds exactly. Degrees throughout; accurate to about 1e-15.
 */

const PI = 3.141592653589793;
const DEG = PI / 180;

/** sin and cos of x radians for |x| ≤ π/4, by their Taylor series (the next term is below 1e-18). */
function sinCosSmall(x: number): [number, number] {
    const x2 = x * x;
    let s = 0, c = 0, term = x, k = 1;
    for (let n = 0; n < 10; n++) {
        s += term;
        term *= -x2 / ((k + 1) * (k + 2));
        k += 2;
    }
    term = 1;
    k = 0;
    for (let n = 0; n < 10; n++) {
        c += term;
        term *= -x2 / ((k + 1) * (k + 2));
        k += 2;
    }
    return [s, c];
}

/** [sin, cos] of an angle in degrees. */
export function sinCosDeg(deg: number): [number, number] {
    const quarter = Math.round(deg / 90), rest = (deg - quarter * 90) * DEG;
    const [s, c] = sinCosSmall(rest);
    switch (((quarter % 4) + 4) % 4) {
        case 0: return [s, c];
        case 1: return [c, -s];
        case 2: return [-s, -c];
        default: return [-c, s];
    }
}

/** atan of z in [0, 1], in radians: halved twice (to z ≤ 0.2) and then its series. */
function atanUnit(z: number): number {
    let t = z / (1 + Math.sqrt(1 + z * z));
    t = t / (1 + Math.sqrt(1 + t * t));
    const t2 = t * t;
    let sum = 0, power = t;
    for (let n = 0; n < 14; n++) {
        sum += (n % 2 ? -power : power) / (2 * n + 1);
        power *= t2;
    }
    return 4 * sum;
}

/** The angle of the vector (x, y) in degrees, in (−180, 180]; 0 for the zero vector. */
export function atan2Deg(y: number, x: number): number {
    if (x === 0 && y === 0) return 0;
    const ax = Math.abs(x), ay = Math.abs(y);
    let a = ax >= ay ? atanUnit(ay / ax) / DEG : 90 - atanUnit(ax / ay) / DEG;
    if (x < 0) a = 180 - a;
    return y < 0 ? -a : a;
}

/** A vector turned by `deg` degrees (clockwise on the map, where y grows south). */
export function rotate(x: number, y: number, deg: number): [number, number] {
    const [s, c] = sinCosDeg(deg);
    return [x * c - y * s, x * s + y * c];
}
