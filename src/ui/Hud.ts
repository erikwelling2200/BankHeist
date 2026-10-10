/**
 * HUD drawn as an HTML overlay rather than in the 320x180 canvas, so text stays crisp at any screen size.
 */
export class Hud {
    private readonly root: HTMLDivElement;
    private readonly gold: HTMLDivElement;
    private readonly message: HTMLDivElement;
    private messageTimer = 0;

    constructor() {
        this.root = document.createElement('div');
        this.root.className = 'hud';
        this.gold = document.createElement('div');
        this.gold.className = 'hud-gold';
        this.message = document.createElement('div');
        this.message.className = 'hud-message';
        this.root.append(this.gold, this.message);
        document.body.append(this.root);
    }

    setGold(collected: number, total: number): void {
        this.gold.textContent = `GOLD ${collected}/${total}`;
    }

    flash(text: string, color = 0xffffff, durationMs = 2200): void {
        this.message.textContent = text;
        this.message.style.color = `#${color.toString(16).padStart(6, '0')}`;
        this.message.classList.add('visible');
        window.clearTimeout(this.messageTimer);
        this.messageTimer = window.setTimeout(() => this.message.classList.remove('visible'), durationMs);
    }

    destroy(): void {
        window.clearTimeout(this.messageTimer);
        this.root.remove();
    }
}
