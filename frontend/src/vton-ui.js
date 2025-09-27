// frontend/src/vton-ui.js
import { $, show } from './dom.js';

export function createVtonUI() {
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
        // 동적으로 vtonResult 요소 가져오기 (IMG에서 CANVAS로 교체될 수 있음)
        const img = $('#vtonResult');
        if (img) {
            console.log('VTON element type:', img.tagName);
            // vtonResult가 CANVAS인 경우 이미지를 그려야 함
            if (img.tagName === 'CANVAS') {
                const ctx = img.getContext('2d');
                const tempImg = new Image();
                tempImg.onload = () => {
                    // 캔버스 크기에 맞춰 이미지 그리기
                    ctx.clearRect(0, 0, img.width, img.height);

                    // 이미지를 캔버스 크기에 맞춰 그리기 (비율 유지)
                    const sourceAspectRatio = tempImg.width / tempImg.height;
                    const canvasAspectRatio = img.width / img.height;

                    let destX = 0, destY = 0, destWidth = img.width, destHeight = img.height;

                    if (sourceAspectRatio > canvasAspectRatio) {
                        // 이미지가 더 넓은 경우
                        destHeight = img.width / sourceAspectRatio;
                        destY = (img.height - destHeight) / 2;
                    } else {
                        // 이미지가 더 높은 경우
                        destWidth = img.height * sourceAspectRatio;
                        destX = (img.width - destWidth) / 2;
                    }

                    ctx.drawImage(tempImg, destX, destY, destWidth, destHeight);
                };
                tempImg.src = url;
            } else {
                // IMG 요소인 경우 기존 방식
                img.src = url;
            }
        } else {
            console.error('vtonResult element not found!');
        }
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
        const img = $('#vtonResult'); // 동적으로 요소 가져오기
        if (img) {
            img.setAttribute('data-crop-generated', cropMode ? 'true' : 'false');
            console.log('Set VTON result crop mode:', cropMode);
        }

        if (loading) show(loading, false); // VTON 완료 후 숨김

        if (save) {
            const now = new Date();
            const timestamp = now
                .toISOString()
                .replace(/[:\-T]/g, '')
                .slice(0, 14);
            const filename = `result_${timestamp}.png`;

            return window.electronAPI
                .saveVtonImage(url, filename)
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

    return {
        start,
        setPreview,
        setProgress,
        succeed,
        fail,
        el: {
            get img() { return $('#vtonResult'); }, // 동적으로 요소 가져오기
            loading,
            err,
            bar,
            txt
        }
    };
}
