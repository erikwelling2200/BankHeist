/** A pixel-art sprite as rows of palette characters; `.` is transparent. Each palette entry carries a colour and a height used for its normal map. */
export interface SpriteDef {
    rows: string[];
    palette: Record<string, { color: number; height: number }>;
}

const skin = { color: 0xd8a27a, height: 0.7 };
const eye = { color: 0x101010, height: 0.5 };
const shoe = { color: 0x1a1a1a, height: 0.3 };

export const ROBBER: SpriteDef = {
    rows: [
        '...kkkk...',
        '..kkkkkk..',
        '..kKKKKk..',
        '..ksesek..',
        '..kkkkkk..',
        '...wbwb...',
        '..bwbwbw..',
        '.sbwbwbws.',
        '.sbwbwbws.',
        '..bbbbbb..',
        '..jjjjjj..',
        '..jj..jj..',
        '..jj..jj..',
        '..ff..ff..'
    ],
    palette: {
        k: { color: 0x2a2a35, height: 0.9 },
        K: { color: 0x3c3c4a, height: 1 },
        s: skin,
        e: eye,
        w: { color: 0xe8e8e8, height: 0.8 },
        b: { color: 0x22222c, height: 0.8 },
        j: { color: 0x2b3550, height: 0.6 },
        f: shoe
    }
};

export const GUARD: SpriteDef = {
    rows: [
        '..cccccc..',
        '.cCCCCCCc.',
        '..ssssss..',
        '..sesess..',
        '..ssssss..',
        '..uuyuuu..',
        '.uuuyuuuu.',
        'suuuuuuuus',
        'suuuuuuuus',
        '..aaaaaa..',
        '..pppppp..',
        '..pp..pp..',
        '..pp..pp..',
        '..ff..ff..'
    ],
    palette: {
        c: { color: 0x1d2a4d, height: 0.9 },
        C: { color: 0x101830, height: 1 },
        s: skin,
        e: eye,
        u: { color: 0x34508f, height: 0.8 },
        y: { color: 0xe0c050, height: 1 },
        a: { color: 0x15151a, height: 0.7 },
        p: { color: 0x1e2c55, height: 0.6 },
        f: shoe
    }
};

export const GOLD: SpriteDef = {
    rows: [
        '..hhhhhh..',
        '.hHHHHHHh.',
        'hyyyyyyyyh',
        'hyyyyyyyyh',
        'oooooooooo'
    ],
    palette: {
        h: { color: 0xf2c94c, height: 0.8 },
        H: { color: 0xfff2a8, height: 1 },
        y: { color: 0xd9a628, height: 0.7 },
        o: { color: 0x8a5a14, height: 0.3 }
    }
};

export const LAMP: SpriteDef = {
    rows: [
        '..mmmm..',
        '.mWWWWm.',
        'mWWWWWWm',
        '.mWWWWm.',
        '..mmmm..'
    ],
    palette: {
        m: { color: 0x6b5a3a, height: 0.6 },
        W: { color: 0xfff1c0, height: 1 }
    }
};

export const EXIT: SpriteDef = {
    rows: [
        'gggggggggggggggg',
        'ggggGGgggggggggg',
        'gggGGggggggggggg',
        'ggGGGGGGGGGGGGgg',
        'gggGGggggggggggg',
        'ggggGGgggggggggg',
        'gggggggggggggggg'
    ],
    palette: {
        g: { color: 0x0f3a1e, height: 0.4 },
        G: { color: 0x3cff7a, height: 1 }
    }
};
