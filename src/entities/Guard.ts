import Phaser from 'phaser';
import { TEX } from '../art/textures';
import { hasLineOfSight, isInCone, rotateTowards, type Point } from '../logic/vision';

const SPEED = 28;
const TURN_SPEED = 3;
const VIEW_RADIUS = 72;
const VIEW_HALF_ANGLE = 0.45;

/** A guard walking a looped patrol, carrying a flashlight cone that doubles as its field of view. */
export class Guard {
    readonly sprite: Phaser.GameObjects.Image;
    private readonly flashlight: Phaser.GameObjects.Light;
    private facing = 0;
    private target = 1;

    constructor(scene: Phaser.Scene, private readonly patrol: Point[]) {
        if (patrol.length < 2) throw new Error('A guard patrol needs at least two waypoints');
        const start = patrol[0]!;
        this.sprite = scene.add.image(start.x, start.y, TEX.guard).setLighting(true).setOrigin(0.5, 0.8);
        this.flashlight = scene.lights.addConeLight(start.x, start.y, VIEW_RADIUS * 1.3, 0xffe6b0, 2.2, 0, VIEW_HALF_ANGLE * 2, VIEW_HALF_ANGLE * 2.6);
        this.facing = this.angleToTarget();
    }

    update(dtSeconds: number): void {
        const goal = this.patrol[this.target]!;
        const s = this.sprite;
        this.facing = rotateTowards(this.facing, this.angleToTarget(), TURN_SPEED * dtSeconds);
        const dist = Phaser.Math.Distance.Between(s.x, s.y, goal.x, goal.y);
        const step = SPEED * dtSeconds;
        if (dist <= step) {
            s.setPosition(goal.x, goal.y);
            this.target = (this.target + 1) % this.patrol.length;
        } else {
            s.setPosition(s.x + ((goal.x - s.x) / dist) * step, s.y + ((goal.y - s.y) / dist) * step);
        }
        s.setFlipX(Math.cos(this.facing) < 0);
        this.flashlight.setPosition(s.x, s.y - 3);
        this.flashlight.setConeRotation(this.facing);
    }

    canSee(target: Point, isBlocked: (x: number, y: number) => boolean): boolean {
        const eye = { x: this.sprite.x, y: this.sprite.y - 3 };
        return isInCone(eye, this.facing, target, VIEW_RADIUS, VIEW_HALF_ANGLE) && hasLineOfSight(eye, target, isBlocked);
    }

    private angleToTarget(): number {
        const goal = this.patrol[this.target]!;
        return Math.atan2(goal.y - this.sprite.y, goal.x - this.sprite.x);
    }
}
