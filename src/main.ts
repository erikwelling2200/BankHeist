import Phaser from 'phaser';
import { registerSW } from 'virtual:pwa-register';
import { BankScene } from './scenes/BankScene';
import { OfficerScene } from './scenes/OfficerScene';
import { PropSheetScene } from './scenes/PropSheetScene';
import { VaultScene } from './scenes/VaultScene';
import { Fullscreen } from './ui/Fullscreen';
import './style.css';

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
    // The example bank opens by default; `?scene=props` shows every prop in its four facings, `?scene=demo` the old
    // stack demo, `?scene=officer` the police officer's animation preview. `?scene=lobby` is an older link to the bank.
    scene: [{ bank: BankScene, lobby: BankScene, props: PropSheetScene, officer: OfficerScene, demo: VaultScene }[new URLSearchParams(location.search).get('scene') ?? 'bank'] ?? BankScene]
});

// Handle for Playwright tests and console debugging.
Object.assign(window, { game, Phaser });

new Fullscreen();
registerSW({ immediate: true });
