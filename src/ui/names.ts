import type { Archetype, PlotKind } from '../gen/model';

/** How the briefing and the generator bar name the archetypes and plots (§17.2). */
export const ARCHETYPE_NAMES: Record<Archetype, string> = { twoWing: 'Two Wing', atrium: 'Atrium', threeKeys: 'Three Keys', fortress: 'Fortress', mezzanineWatch: 'Mezzanine Watch' };
export const PLOT_NAMES: Record<PlotKind, string> = { midBlock: 'mid-block', cornerLot: 'corner lot', plazaFront: 'plaza front', stripMallEnd: 'strip-mall end' };
