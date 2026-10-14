import type { HudIcon, PortraitName } from './viewModels';

/**
 * The HUD's pictures: 24px icons and 48px portraits drawn by `scripts/ui-mockups/icons.py` for the mockups, in the
 * game's palette and the crew's looks. Placeholders until the final HUD art; keep the names when replacing them.
 */
const files = import.meta.glob<string>('./img/*.png', { eager: true, query: '?url', import: 'default' });
const byName = new Map(Object.entries(files).map(([path, url]) => [path.slice('./img/'.length, -'.png'.length), url]));

export function iconUrl(icon: HudIcon): string {
    return byName.get(`i-${icon}`) ?? '';
}

/** The portrait's picture, or undefined for a name without one (the HUD then draws an initial). */
export function portraitUrl(name: PortraitName): string | undefined {
    return byName.get(`p-${name}`);
}
