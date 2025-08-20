// frontend/src/dom.js
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function on(el, ev, handler, opts) {
    el.addEventListener(ev, handler, opts);
    return () => el.removeEventListener(ev, handler, opts);
}

export const show = (el, yes) => el.classList.toggle('hidden', !yes);
export const wait = (ms) => new Promise(r => setTimeout(r, ms));

export async function safeText(res) {
    try { return await res.text(); } catch { return ''; }
}
