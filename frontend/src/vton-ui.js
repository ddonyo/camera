// frontend/src/vton-ui.js
import { $, show } from './dom.js';

export function createVtonUI() {
    const img = $('#vtonResult');
    const loading = $('#vtonLoading');
    const err = $('#vtonError');
    const bar = $('#vtonProgressBar');
    const txt = $('#vtonProgressText');

    function start() {
        show(err, false);
        show(loading, true);
        setProgress(0, 'Queued...');
    }
    function setProgress(p, label) {
        if (typeof p === 'number') {
            const clamped = Math.max(0, Math.min(1, p));
            bar.style.width = (clamped * 100).toFixed(0) + '%';
        }
        if (label) txt.textContent = label;
    }
    function succeed(url, save = true) {
        if (url) img.src = url;
        show(loading, false);
    }
    function fail(message) {
        show(loading, false);
        err.textContent = message || 'Failed to generate. Try again.';
        show(err, true);
    }
    return { start, setProgress, succeed, fail, el: { img, loading, err, bar, txt } };
}
