export interface Point { x: number; y: number }

/** Whether `target` lies inside a vision cone at `origin` facing `facing` radians, `halfAngle` either side, up to `radius` away. */
export function isInCone(origin: Point, facing: number, target: Point, radius: number, halfAngle: number): boolean {
    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    if (dx * dx + dy * dy > radius * radius) return false;
    return Math.abs(angleDifference(Math.atan2(dy, dx), facing)) <= halfAngle;
}

/** Signed smallest difference `a - b`, wrapped to [-PI, PI]. */
export function angleDifference(a: number, b: number): number {
    let d = (a - b) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
}

/** Rotates `current` towards `target` by at most `maxStep` radians. */
export function rotateTowards(current: number, target: number, maxStep: number): number {
    const d = angleDifference(target, current);
    if (Math.abs(d) <= maxStep) return target;
    return current + Math.sign(d) * maxStep;
}

/** Marches from `a` to `b` in `step`-pixel increments and reports whether no sample hits a blocking point. */
export function hasLineOfSight(a: Point, b: Point, isBlocked: (x: number, y: number) => boolean, step = 4): boolean {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.ceil(dist / step);
    for (let i = 1; i < steps; i++) {
        const t = i / steps;
        if (isBlocked(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
    }
    return true;
}
