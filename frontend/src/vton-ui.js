// frontend/src/vton-ui.js
import { $, show } from './dom.js';

export function createVtonUI() {
    const img = $('#vtonResult');
    const loading = $('#vtonLoading');
    console.log('Loading element:', loading);
    const err = $('#vtonError');
    const bar = $('#vtonProgressBar');
    const txt = $('#vtonProgressText');

    if (!loading) console.error('vtonLoading element not found!');

    function start() {
        console.log('VTON loading started');
        if (loading) show(loading, true);
        else console.error('Cannot show loading: element not found');
        setProgress(0, 'Queued...');
    }

    function setPreview(url) {
        console.log('Setting preview:', url);
        if (img) img.src = url;
    }

    function setProgress(p, label) {
        console.log('Setting progress:', p, label);
        if (typeof p === 'number') {
            const clamped = Math.max(0, Math.min(1, p));
            bar.style.width = (clamped * 100).toFixed(0) + '%';
        }
        if (label) txt.textContent = label;
    }

    function succeed(url, save = true, cropMode = false) {
        console.log('VTON succeed with url:', url, 'save:', save, 'cropMode:', cropMode);
        setPreview(url); // 미리보기 업데이트
        
        // VTON 결과 이미지에 생성 모드 정보 저장
        if (img) {
            img.setAttribute('data-crop-generated', cropMode ? 'true' : 'false');
            console.log('Set VTON result crop mode:', cropMode);
        }
        
        if (loading) show(loading, false); // VTON 완료 후 숨김

        if (save) {
            const now = new Date();
            const timestamp = now.toISOString().replace(/[:\-T]/g, '').slice(0, 14);
            const filename = `result_${timestamp}.png`;

            return window.electronAPI.saveVtonImage(url, filename)
                .then((savePath) => {
                    console.log(`Image saved as: ${savePath}`);
                })
                .catch((err) => {
                    console.error('Failed to save image:', err);
                    fail('Failed to save image.');
                });
        }
        return Promise.resolve();
    }

    function fail(message) {
        console.log('VTON failed:', message);
        if (loading) show(loading, false);
        if (err) {
            err.textContent = message || 'Failed to generate. Try again.';
            show(err, true);
        }
    }

    return { start, setPreview, setProgress, succeed, fail, el: { img, loading, err, bar, txt } };
}