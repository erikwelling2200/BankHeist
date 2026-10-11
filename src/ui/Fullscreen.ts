/**
 * Browser fullscreen for when the game is played in a normal tab. Installed (home screen) launches are already
 * fullscreen through the manifest, so nothing is shown there. iPhone Safari has no Fullscreen API at all, so the
 * button stays hidden and installing to the home screen is the only way to get rid of the browser bars.
 */
export class Fullscreen {
    private readonly button: HTMLButtonElement;

    constructor() {
        this.button = document.createElement('button');
        this.button.className = 'fullscreen-button';
        this.button.setAttribute('aria-label', 'Toggle fullscreen');
        this.button.textContent = '⛶';
        // The browser may still refuse (e.g. inside an iframe); the game simply keeps running windowed then.
        this.button.addEventListener('click', () => this.toggle().catch(() => undefined));
        // Keep a tap on the button from also starting the touch joystick on the canvas.
        this.button.addEventListener('pointerdown', e => e.stopPropagation());
        document.body.append(this.button);
        this.button.hidden = !Fullscreen.supported() || Fullscreen.installed();
        document.addEventListener('fullscreenchange', () => this.button.classList.toggle('active', !!document.fullscreenElement));
        // Browsers only allow fullscreen from a user gesture, so enter it on the first touch of the game.
        if (!this.button.hidden && matchMedia('(pointer: coarse)').matches) window.addEventListener('pointerup', () => this.enter().catch(() => undefined), { once: true });
    }

    static supported(): boolean {
        return document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === 'function';
    }

    static installed(): boolean {
        return matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
    }

    private async toggle(): Promise<void> {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await this.enter();
    }

    private async enter(): Promise<void> {
        if (document.fullscreenElement) return;
        // The whole document goes fullscreen, not just the canvas, so the HTML HUD stays visible.
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        // Orientation lock only works while fullscreen, and only on some browsers (Android Chrome); elsewhere it rejects.
        const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        await orientation.lock?.('landscape').catch(() => undefined);
    }
}
