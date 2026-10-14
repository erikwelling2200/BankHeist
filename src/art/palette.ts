/**
 * The bank's locked palette. Every material is a ramp from dark to light; darks drift cool (towards blue-violet),
 * lights drift warm and the lightest steps desaturate. Index 0 is always the darkest step, used for sel-out edges.
 */
export const PAL = {
    ink: 0x17141f,
    void: 0x0d0c14,

    marbleCream: [0x6f6a66, 0x8f887d, 0xaba290, 0xc3b9a2, 0xd8cfb6],
    marbleGreen: [0x1b2b2a, 0x253a35, 0x31493f, 0x3e5a4b, 0x52705a],
    carpet: [0x2e1424, 0x4a1c29, 0x66262e, 0x823637, 0x9b4c41],
    linoleum: [0x4c4e4f, 0x666860, 0x7e7f71, 0x969480, 0xaba78e],
    walnut: [0x22161c, 0x3a2422, 0x55362b, 0x704a35, 0x8c6141, 0xa97c52],
    brass: [0x3a2b1f, 0x6a5026, 0x96752f, 0xbf9b44, 0xe2c473, 0xf3e3ac],
    glass: [0x1e3340, 0x2f5160, 0x4b7684, 0x76a1a8, 0xa9cdcb, 0xdcefe6],
    plaster: [0x3b3540, 0x554c52, 0x6e6462, 0x887c74, 0xa19483],
    limestone: [0x3c3a48, 0x575462, 0x726d78, 0x8e888e, 0xaba3a2, 0xc6bdb4],
    concrete: [0x34343e, 0x4a4a52, 0x605f64, 0x777574, 0x8e8b86, 0xa29e96],
    asphalt: [0x1d1e27, 0x262832, 0x30323c, 0x3a3c46, 0x464853],
    paintLine: [0x8f8562, 0xc4b67e, 0xddd0a0],
    steel: [0x23252e, 0x363a45, 0x4d525d, 0x686e77, 0x878c91, 0xaab0b0],
    leaf: [0x14231e, 0x1d3626, 0x2a4c2e, 0x3b6537, 0x568044, 0x77a05a],
    terracotta: [0x3a2026, 0x5a2f2c, 0x7a4334, 0x985c42],
    paper: [0x8a8478, 0xb8b1a0, 0xddd6c2, 0xf0ead8],
    /** Old red brick, sooty in its darks. */
    brick: [0x2a1a1e, 0x45252a, 0x63332f, 0x7e4434, 0x985a40, 0xae7452],
    /** Raw plywood and cardboard. */
    plywood: [0x4a3a2c, 0x6e573e, 0x8f7550, 0xac9264, 0xc4ad7e],
    /** Pale oak floorboards and café furniture. */
    oak: [0x3e2c22, 0x5e4430, 0x7c5d3e, 0x9a7a52, 0xb59668],
    /** Polished dark granite: an office tower's lobby. */
    granite: [0x24232b, 0x312f38, 0x403e47, 0x524f57, 0x67636a],
    /** Blue-grey carpet tiles: offices. */
    officeCarpet: [0x2c3245, 0x3a4257, 0x4a546a, 0x5c677c, 0x707b8e],
    /** A work van's off-white paint, a little grimy: cool in the shade, warm where the light catches it. */
    vanBody: [0x31323d, 0x50525c, 0x72737a, 0x8f8e8c, 0xa7a49c, 0xbcb7aa],
    tyre: [0x141319, 0x1f1d25, 0x2c2a33],

    skin: {
        pale: [0x6a4447, 0x9c6a5f, 0xc89a80, 0xe2bc9c],
        tan: [0x553538, 0x86564a, 0xb07e60, 0xcc9d78],
        brown: [0x3a2228, 0x5e3a33, 0x84553f, 0xa2704f],
        dark: [0x24161d, 0x3c2425, 0x583630, 0x744a3c]
    },
    hair: {
        black: [0x121018, 0x1e1a22, 0x2c2630],
        brown: [0x241820, 0x3e2a26, 0x5c3e30],
        auburn: [0x2c1820, 0x5a2a24, 0x80402e],
        blond: [0x5a4630, 0x8e7248, 0xbca06a],
        grey: [0x4a4850, 0x77747a, 0xa3a0a2]
    },
    cloth: {
        navy: [0x141826, 0x1d2338, 0x29324c, 0x384463],
        charcoal: [0x16151c, 0x232129, 0x302e37, 0x403e48],
        beige: [0x4a3a30, 0x7a6249, 0x9c8160, 0xb89d78],
        burgundy: [0x2a1220, 0x441a29, 0x5e2533, 0x7a3440],
        olive: [0x1c2420, 0x2b3a2c, 0x3d4e36, 0x536440],
        denim: [0x1a2232, 0x283a54, 0x385072, 0x4d6a8c],
        white: [0x6e6e78, 0x9c9ca0, 0xc4c2be, 0xe0dcd2],
        skyShirt: [0x3e4c62, 0x5f7690, 0x86a0b6, 0xaac0cc],
        guard: [0x151a28, 0x202a40, 0x2d3a56, 0x3e4e6c],
        teal: [0x14282c, 0x1e3c40, 0x2a5254, 0x3a6a68],
        mustard: [0x4a3818, 0x7a5c22, 0x9c7a32, 0xbc9a4a],
        black: [0x0f0e14, 0x18161e, 0x221f28, 0x2e2a34]
    },

    emissive: {
        screen: [0x2a6a7e, 0x56b6c8, 0x9ee6e8],
        ledRed: 0xff4a3a,
        ledGreen: 0x52ff9a,
        exitGreen: [0x1a6a3a, 0x52e08a, 0xc8ffd8],
        lampWarm: [0xffd89a, 0xfff2d0],
        sky: [0x9fbccc, 0xd6e6e6]
    }
} as const;

export type Ramp = readonly number[];

export function mix(a: number, b: number, t: number): number {
    const c = (shift: number) => Math.round(((a >> shift) & 0xff) * (1 - t) + ((b >> shift) & 0xff) * t);
    return (c(16) << 16) | (c(8) << 8) | c(0);
}

export function shade(color: number, amount: number): number {
    const c = (shift: number) => Math.max(0, Math.min(255, Math.round(((color >> shift) & 0xff) * amount)));
    return (c(16) << 16) | (c(8) << 8) | c(0);
}

/** Darkens towards the palette's cool ink rather than towards black, as sel-out edges do. */
export function deepen(color: number, t: number): number {
    return mix(color, PAL.ink, t);
}

/** Picks a ramp step, clamped to the ramp's ends. */
export function step(ramp: Ramp, index: number): number {
    return ramp[Math.max(0, Math.min(ramp.length - 1, Math.round(index)))]!;
}
