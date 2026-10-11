import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Relative asset paths, so the build works under any sub-path (GitHub Pages serves it from /<repo>/) and survives repo renames.
export default defineConfig({
    base: './',
    build: { chunkSizeWarningLimit: 2000 },
    plugins: [
        VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['icons/*.png'],
            manifest: {
                name: 'Bank Heist',
                short_name: 'BankHeist',
                description: 'A pixel-art heist in the dark.',
                theme_color: '#0b0d17',
                background_color: '#0b0d17',
                display: 'fullscreen',
                orientation: 'landscape',
                icons: [
                    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
                    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
                    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
                ]
            },
            workbox: {
                globPatterns: ['**/*.{js,css,html,png,svg,json,ogg,mp3,wav}'],
                maximumFileSizeToCacheInBytes: 8 * 1024 * 1024
            }
        })
    ]
});
