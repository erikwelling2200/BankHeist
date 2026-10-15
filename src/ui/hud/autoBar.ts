import { h } from './dom';
import './autoBar.css';

/*
 * Auto-advance and "Wait for…" (GAME_DESIGN §6.5) in the HUD: Go plays the crew's multi-turn routes turn by turn, Wait
 * for… opens a menu of what the crew knows is coming (the next schedule event, a known NPC leaving, coming back or
 * passing), and the line above them says what is running or why it stopped ("Stopped: the cleaner turned toward Jun").
 * Bottom centre, between the left thumb's camera tools and the right thumb's Confirm. Like the rest of the HUD it draws
 * a view model and reports taps; it changes nothing itself.
 */

export interface AutoBarVM {
    /** Go: plays the routes. Disabled with a reason when there is no route or auto-advance isn't allowed now. */
    go: { enabled: boolean; reason?: string };
    /** Wait for…: the menu's entries, by id. Disabled with a reason when there is nothing to wait for. */
    wait: { enabled: boolean; reason?: string; options: { id: string; label: string }[] };
    /** Auto-advance is playing: Go reads Stop. */
    running: boolean;
    /** What is running ("Waiting: the manager leaves") or why it stopped; null shows nothing. */
    status: string | null;
    /** The status is a stop that wants attention (amber) rather than a target reached or a route walked. */
    alert?: boolean;
}

export interface AutoBarCallbacks {
    go(): void;
    stop(): void;
    wait(id: string): void;
}

export interface AutoBarHandle {
    update(vm: AutoBarVM): void;
    destroy(): void;
}

export function mountAutoBar(root: HTMLElement, callbacks: AutoBarCallbacks): AutoBarHandle {
    const el = h('div.sh.sh-autoroot', { role: 'region', 'aria-label': 'Auto-advance' });
    const status = h('div.sh-autostatus', { role: 'status', 'aria-live': 'polite', hidden: true });
    const go = h('button.sh-panel.sh-go', { type: 'button', 'aria-label': 'Go: play the routes' });
    const wait = h('button.sh-panel.sh-waitfor', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, 'WAIT FOR…');
    const menu = h('div.sh-panel.sh-waitmenu', { role: 'menu', 'aria-label': 'Wait for…', hidden: true });
    const bar = h('div.sh-auto', {}, go, wait);
    el.append(menu, status, bar);
    root.append(el);
    let vm: AutoBarVM | undefined;
    let open = false;
    let drawn = '';

    // Taps here never reach the map (no pan, and the scene doesn't take them as "any tap stops it").
    el.addEventListener('pointerdown', e => { if ((e.target as HTMLElement).closest('button, .sh-waitmenu')) e.stopPropagation(); });
    el.addEventListener('mousedown', e => { if ((e.target as HTMLElement).closest('button')) e.preventDefault(); });
    go.addEventListener('click', () => {
        if (!vm) return;
        setOpen(false);
        if (vm.running) callbacks.stop();
        else if (vm.go.enabled) callbacks.go();
    });
    wait.addEventListener('click', () => {
        if (!vm) return;
        if (vm.running) { callbacks.stop(); return; }
        if (vm.wait.enabled) setOpen(!open);
    });
    menu.addEventListener('click', e => {
        const item = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-id]');
        if (!item) return;
        setOpen(false);
        callbacks.wait(item.dataset.id!);
    });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) setOpen(false); };
    window.addEventListener('keydown', onKey);

    function setOpen(on: boolean): void {
        open = on && !!vm?.wait.enabled && !vm.running;
        menu.hidden = !open;
        wait.setAttribute('aria-expanded', String(open));
    }

    function draw(): void {
        if (!vm) return;
        const sig = JSON.stringify(vm);
        if (sig === drawn) return;
        drawn = sig;
        go.textContent = vm.running ? '■ STOP' : '▶ GO';
        go.disabled = !vm.running && !vm.go.enabled;
        go.title = vm.running ? 'Stop auto-advance' : vm.go.enabled ? 'Play the routes turn by turn' : vm.go.reason ?? '';
        go.classList.toggle('on', vm.running);
        wait.disabled = !vm.running && !vm.wait.enabled;
        wait.title = vm.wait.enabled ? 'End turns until…' : vm.wait.reason ?? '';
        status.hidden = !vm.status;
        status.textContent = vm.status ?? '';
        status.classList.toggle('alert', !!vm.alert);
        menu.replaceChildren(
            h('div.sh-waittitle', {}, 'WAIT FOR…'),
            ...vm.wait.options.map(o => h('button.sh-waititem', { type: 'button', role: 'menuitem', 'data-id': o.id }, o.label))
        );
        if (vm.running || !vm.wait.enabled) setOpen(false);
    }

    return {
        update(next) {
            vm = next;
            draw();
        },
        destroy() {
            window.removeEventListener('keydown', onKey);
            el.remove();
        }
    };
}
