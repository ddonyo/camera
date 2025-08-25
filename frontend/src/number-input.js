// frontend/src/number-input.js
import { $$ } from './dom.js';

export function bindNumberInputs() {
    $$('.number-input-wrapper[data-number-input]').forEach((wrap) => {
        const id = wrap.dataset.numberInput;
        const step = parseFloat(wrap.dataset.step || '1');
        const min = parseFloat(wrap.dataset.min ?? Number.NEGATIVE_INFINITY);
        const max = parseFloat(wrap.dataset.max ?? Number.POSITIVE_INFINITY);
        const input = wrap.querySelector('input[type="number"]');
        if (!input) return;

        const inc = () => {
            if (input.disabled) return;
            const v = parseFloat(input.value || '0');
            const nv = Math.min(max, v + step);
            input.value = step % 1 ? nv.toFixed(1) : String(Math.round(nv));
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const dec = () => {
            if (input.disabled) return;
            const v = parseFloat(input.value || '0');
            const nv = Math.max(min, v - step);
            input.value = step % 1 ? nv.toFixed(1) : String(Math.round(nv));
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        };

        const upBtn = wrap.querySelector('.number-input-btn.up');
        const dnBtn = wrap.querySelector('.number-input-btn.down');
        upBtn?.addEventListener('click', inc);
        dnBtn?.addEventListener('click', dec);
    });
}
