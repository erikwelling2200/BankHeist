import { describe, expect, it } from 'vitest';
import { angleDifference, hasLineOfSight, isInCone, rotateTowards } from '../src/logic/vision';

describe('isInCone', () => {
    const origin = { x: 0, y: 0 };
    it('sees a target straight ahead within range', () => expect(isInCone(origin, 0, { x: 50, y: 0 }, 60, 0.4)).toBe(true));
    it('misses a target beyond the radius', () => expect(isInCone(origin, 0, { x: 70, y: 0 }, 60, 0.4)).toBe(false));
    it('misses a target outside the angle', () => expect(isInCone(origin, 0, { x: 10, y: 30 }, 60, 0.4)).toBe(false));
    it('handles facing across the -PI/PI seam', () => expect(isInCone(origin, Math.PI, { x: -50, y: -1 }, 60, 0.4)).toBe(true));
});

describe('angleDifference', () => {
    it('wraps to the short way round', () => expect(angleDifference(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(-0.2));
});

describe('rotateTowards', () => {
    it('steps by at most maxStep', () => expect(rotateTowards(0, 1, 0.25)).toBeCloseTo(0.25));
    it('snaps when within maxStep', () => expect(rotateTowards(0, 0.1, 0.25)).toBe(0.1));
});

describe('hasLineOfSight', () => {
    const wallAtX20 = (x: number) => x >= 20 && x < 24;
    it('is blocked by a wall in between', () => expect(hasLineOfSight({ x: 0, y: 0 }, { x: 40, y: 0 }, wallAtX20)).toBe(false));
    it('is clear without walls', () => expect(hasLineOfSight({ x: 0, y: 0 }, { x: 16, y: 0 }, wallAtX20)).toBe(true));
});
