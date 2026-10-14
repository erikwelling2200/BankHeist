/**
 * Camera buttons for the left thumb (§20.3): zoom in, zoom out and the tactical map. HTML, so they stay crisp at any
 * zoom, and big enough to tap (§20.2 asks for at least 48dp).
 */
export class CameraControls {
    private readonly root: HTMLDivElement;
    readonly map: HTMLButtonElement;

    constructor(actions: { zoomIn: () => void; zoomOut: () => void; toggleMap: () => void }) {
        this.root = document.createElement('div');
        this.root.className = 'camera-controls';
        const button = (label: string, text: string, action: () => void) => {
            const b = document.createElement('button');
            b.setAttribute('aria-label', label);
            b.textContent = text;
            b.addEventListener('click', action);
            // Keep a tap on a button from also panning the camera.
            b.addEventListener('pointerdown', e => e.stopPropagation());
            this.root.append(b);
            return b;
        };
        button('Zoom in', '+', actions.zoomIn);
        button('Zoom out', '−', actions.zoomOut);
        this.map = button('Tactical map', 'Map', actions.toggleMap);
        this.map.classList.add('camera-map');
        document.body.append(this.root);
    }

    showMap(on: boolean): void {
        this.map.classList.toggle('active', on);
    }

    destroy(): void {
        this.root.remove();
    }
}
