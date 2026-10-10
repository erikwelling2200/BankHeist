import Phaser from 'phaser';
import { registerSW } from 'virtual:pwa-register';
import { VaultScene } from './scenes/VaultScene';
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
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    physics: { default: 'arcade', arcade: { debug: false } },
    input: { activePointers: 3 },
    scene: [VaultScene]
});

// Handle for Playwright tests and console debugging.
Object.assign(window, { game, Phaser });

registerSW({ immediate: true });
