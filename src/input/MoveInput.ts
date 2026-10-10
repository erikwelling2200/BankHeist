import Phaser from 'phaser';

const STICK_RADIUS = 18;

/** Merges keyboard (WASD / arrows) and a floating touch joystick into one normalised movement vector. */
export class MoveInput {
    private readonly keys: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd', Phaser.Input.Keyboard.Key>;
    private readonly base: Phaser.GameObjects.Arc;
    private readonly knob: Phaser.GameObjects.Arc;
    private stickPointer: Phaser.Input.Pointer | null = null;
    private readonly stickOrigin = new Phaser.Math.Vector2();
    private readonly stickVector = new Phaser.Math.Vector2();

    constructor(scene: Phaser.Scene) {
        const kb = scene.input.keyboard!;
        const K = Phaser.Input.Keyboard.KeyCodes;
        this.keys = {
            up: kb.addKey(K.UP), down: kb.addKey(K.DOWN), left: kb.addKey(K.LEFT), right: kb.addKey(K.RIGHT),
            w: kb.addKey(K.W), a: kb.addKey(K.A), s: kb.addKey(K.S), d: kb.addKey(K.D)
        };
        this.base = scene.add.circle(0, 0, STICK_RADIUS, 0xffffff, 0.08).setStrokeStyle(1, 0xffffff, 0.35).setScrollFactor(0).setDepth(1000).setVisible(false);
        this.knob = scene.add.circle(0, 0, 7, 0xffffff, 0.35).setScrollFactor(0).setDepth(1001).setVisible(false);
        scene.input.addPointer(2);
        scene.input.on('pointerdown', this.onDown, this);
        scene.input.on('pointermove', this.onMove, this);
        scene.input.on('pointerup', this.onUp, this);
    }

    /** Movement direction with length in [0, 1]. */
    read(out: Phaser.Math.Vector2): Phaser.Math.Vector2 {
        if (this.stickPointer) return out.copy(this.stickVector);
        const k = this.keys;
        out.set(Number(k.right.isDown || k.d.isDown) - Number(k.left.isDown || k.a.isDown), Number(k.down.isDown || k.s.isDown) - Number(k.up.isDown || k.w.isDown));
        return out.lengthSq() > 0 ? out.normalize() : out;
    }

    private onDown(pointer: Phaser.Input.Pointer): void {
        if (this.stickPointer) return;
        this.stickPointer = pointer;
        this.stickOrigin.set(pointer.x, pointer.y);
        this.stickVector.reset();
        this.base.setPosition(pointer.x, pointer.y).setVisible(true);
        this.knob.setPosition(pointer.x, pointer.y).setVisible(true);
    }

    private onMove(pointer: Phaser.Input.Pointer): void {
        if (pointer !== this.stickPointer) return;
        this.stickVector.set(pointer.x - this.stickOrigin.x, pointer.y - this.stickOrigin.y);
        const len = Math.min(this.stickVector.length(), STICK_RADIUS);
        if (len > 0) this.stickVector.normalize().scale(len);
        this.knob.setPosition(this.stickOrigin.x + this.stickVector.x, this.stickOrigin.y + this.stickVector.y);
        this.stickVector.scale(1 / STICK_RADIUS);
    }

    private onUp(pointer: Phaser.Input.Pointer): void {
        if (pointer !== this.stickPointer) return;
        this.stickPointer = null;
        this.stickVector.reset();
        this.base.setVisible(false);
        this.knob.setVisible(false);
    }
}
