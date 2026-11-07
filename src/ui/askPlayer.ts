/*
 * The game's yes-or-no question (a saved heist about to be overwritten, a heist abandoned): a small dialog in the HUD's
 * style rather than the browser's, which a phone shows out of place and tests can't read.
 */

/** A small dialog in the HUD's style; resolves true for `yes`. */
export function askPlayer(title: string, text: string, yes: string, no: string): Promise<boolean> {
    return new Promise(resolve => {
        const back = document.createElement('div');
        back.className = 'play-dialog-back';
        const box = document.createElement('div');
        box.className = 'play-dialog';
        box.setAttribute('role', 'alertdialog');
        box.setAttribute('aria-modal', 'true');
        const h = document.createElement('p');
        h.className = 'play-dialog-title';
        h.textContent = title;
        const p = document.createElement('p');
        p.textContent = text;
        const row = document.createElement('div');
        row.className = 'play-dialog-buttons';
        const button = (label: string, answer: boolean, cls: string) => {
            const b = document.createElement('button');
            b.className = cls;
            b.textContent = label;
            b.addEventListener('click', () => { back.remove(); resolve(answer); });
            row.append(b);
            return b;
        };
        const keep = button(no, false, 'play-dialog-keep');
        button(yes, true, 'play-dialog-new');
        box.append(h, p, row);
        back.append(box);
        document.body.append(back);
        keep.focus();
    });
}
