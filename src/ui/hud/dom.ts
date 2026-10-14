/** A tiny element builder for the HUD: `h('button.sh-act.sel', { 'aria-label': 'Move' }, child, 'text')`. */
export function h<K extends keyof HTMLElementTagNameMap>(
    spec: K | `${K}.${string}`,
    attrs: Record<string, string | number | boolean | undefined | null> = {},
    ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
    const [tag, ...classes] = spec.split('.') as [K, ...string[]];
    const e = document.createElement(tag);
    if (classes.length) e.className = classes.join(' ');
    for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'style') e.setAttribute('style', String(v));
        else e.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of children) if (c !== null && c !== undefined && c !== false) e.append(c);
    return e;
}

/** An `<img>` for a pixel-art picture (no alt text: the button around it carries the name). */
export function img(src: string, className = 'sh-ic'): HTMLImageElement {
    const i = h('img', { src, alt: '', draggable: 'false' });
    i.className = className;
    return i;
}
