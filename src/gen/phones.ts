/*
 * Desk phones and their owners (§8.13; implementation plan M5-04, decision 360): one owner per phone, one phone per
 * owner. An owner is someone with a `post` beside the phone (within a tile, in its room), staff or a guard, never a
 * customer; the pairs are made nearest first (then by phone, then by person), so a desk pair's two phones go to the two
 * people facing each other across it. `worldFromBank` makes rules objects only of the phones that get an owner (the
 * props stay: the building doesn't change with the population). The CCTV operator's console and visitors (the IT tech)
 * have no desk phone.
 */

export interface PhonePost { person: string; at: { x: number; y: number } }

/** For each phone (in order), its owner and where they answer it, or null. */
export function phoneOwners(
    phones: readonly { x: number; y: number }[], posts: readonly PhonePost[], roomAt: (x: number, y: number) => string | undefined
): ({ owner: string; at: { x: number; y: number } } | null)[] {
    const pairs: { phone: number; post: PhonePost; d: number }[] = [];
    phones.forEach((p, phone) => {
        const room = roomAt(p.x, p.y);
        for (const post of posts) {
            const dx = post.at.x - p.x, dy = post.at.y - p.y;
            if (Math.max(Math.abs(dx), Math.abs(dy)) > 1 || roomAt(post.at.x, post.at.y) !== room) continue;
            pairs.push({ phone, post, d: dx * dx + dy * dy });
        }
    });
    pairs.sort((a, b) => a.d - b.d || a.phone - b.phone || (a.post.person < b.post.person ? -1 : a.post.person > b.post.person ? 1 : 0));
    const out: ({ owner: string; at: { x: number; y: number } } | null)[] = phones.map(() => null);
    const taken = new Set<string>();
    for (const { phone, post } of pairs) {
        if (out[phone] || taken.has(post.person)) continue;
        out[phone] = { owner: post.person, at: { x: post.at.x, y: post.at.y } };
        taken.add(post.person);
    }
    return out;
}
