import Phaser from 'phaser';
import { registerSW } from 'virtual:pwa-register';
import { usePersonStyle } from './art/bank/people';
import { PERSON_STYLES } from './art/bank/peopleStyles';
import { bankFromAddress } from './bankSource';
import { roomGallery } from './gen/gallery';
import type { GeneratedBank } from './gen/model';
import { Briefing } from './ui/Briefing';
import { GeneratorBar } from './ui/GeneratorBar';
import { BankScene } from './scenes/BankScene';
import { OfficerScene } from './scenes/OfficerScene';
import { PropSheetScene } from './scenes/PropSheetScene';
import { VaultScene } from './scenes/VaultScene';
import { Fullscreen } from './ui/Fullscreen';
import './style.css';

const params = new URLSearchParams(location.search), scene = params.get('scene') ?? 'bank';
// `?people=lean`, `chunky`, `noir` or `hibit` draws the cast in another style, to compare (peopleStyles.ts).
const peopleStyle = params.get('people');
if (peopleStyle) {
    if (!PERSON_STYLES[peopleStyle]) throw new Error(`No people style '${peopleStyle}': try ${Object.keys(PERSON_STYLES).join(', ')}`);
    usePersonStyle(PERSON_STYLES[peopleStyle]);
}
// `?scene=rooms` is the room gallery: every room type furnished in a few sizes (`?seed=` picks other parcels).
const gallery = scene === 'rooms' ? roomGallery(Number(params.get('seed') ?? 1)) : undefined;
const bank = gallery ? { data: gallery.data, generated: undefined } : ['props', 'officer', 'demo'].includes(scene) ? undefined : generateAddressed();

const game = new Phaser.Game({
    type: Phaser.WEBGL,
    parent: 'game',
    width: 320,
    height: 180,
    backgroundColor: '#0b0d17',
    pixelArt: true,
    // Each light costs a little per pixel, but at 320x180 even 32 lights are cheap on phones.
    render: { maxLights: 32 },
    // EXPAND keeps 180px of height and widens the view to the screen's aspect ratio, so there are no black bars on phones.
    scale: { mode: Phaser.Scale.EXPAND, autoCenter: Phaser.Scale.CENTER_BOTH },
    physics: { default: 'arcade', arcade: { debug: false } },
    input: { activePointers: 3 },
    // A generated bank opens by default (`?bank=example` for the hand-made one); `?scene=props` shows every prop in its
    // four facings, `?scene=demo` the old stack demo, `?scene=officer` the police officer's animation preview.
    // `?scene=lobby` is an older link to the bank.
    scene: [{ bank: BankScene, lobby: BankScene, rooms: BankScene, props: PropSheetScene, officer: OfficerScene, demo: VaultScene }[scene] ?? BankScene],
    // `?still` stops what moves by itself (drifting clouds, patrols, dust), so screenshots of a view match pixel for pixel.
    callbacks: { preBoot: g => g.registry.set('bankData', bank?.data).set('still', params.has('still')) }
});

let panels: { briefing: Briefing; bar: GeneratorBar } | undefined;

/** The briefing and the generator bar for a generated bank, replacing those of the bank before it. */
function showPanels(generated: GeneratedBank | undefined): void {
    const open = panels?.briefing.open;
    panels?.briefing.destroy();
    panels?.bar.destroy();
    panels = generated && {
        briefing: new Briefing(generated, open),
        bar: new GeneratorBar(generated, { regenerate, knowledge: full => (game.scene.getScene('bank') as BankScene).showKnowledge(full) })
    };
    // Handles for Playwright tests and console debugging.
    Object.assign(window, { generated });
}

/**
 * Regenerates in the page: the new picks and seed go into the address (so Back returns to the bank before), and the bank
 * scene restarts on the new bank. Generating takes a moment, so the page shows it is busy first.
 */
function regenerate(params: Record<string, string>): void {
    history.pushState(null, '', `${location.pathname}?${new URLSearchParams(params)}`);
    showAddressedBank();
}

function showAddressedBank(): void {
    document.body.classList.add('generating');
    // Two frames, so the busy state is painted before generating blocks the page.
    requestAnimationFrame(() => requestAnimationFrame(() => {
        const next = generateAddressed();
        game.registry.set('bankData', next.data);
        game.scene.getScene('bank')!.scene.restart();
        showPanels(next.generated);
        document.body.classList.remove('generating');
    }));
}

/** The addressed bank, its generating timed into the browser's performance timeline (`bank: generate`) for profiling. */
function generateAddressed(): ReturnType<typeof bankFromAddress> {
    const start = performance.now(), next = bankFromAddress();
    performance.measure('bank: generate', { start });
    return next;
}

if (bank?.generated) {
    showPanels(bank.generated);
    window.addEventListener('popstate', showAddressedBank);
}

Object.assign(window, { game, Phaser, gallery: gallery?.cells });

new Fullscreen();
registerSW({ immediate: true });
