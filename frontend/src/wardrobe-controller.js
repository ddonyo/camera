// frontend/src/wardrobe-controller.js
import { $, $$ } from './dom.js';
import { createVtonUI } from './vton-ui.js';
import { captureCurrentFrame } from './capture-helper.js';
import { runVTONWithFallback } from './vton-service.js';

export function initWardrobeController() {
    const grid = $('#wardrobeGrid');
    if (!grid) return;

    const ui = createVtonUI();

    grid.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-garment-id]');
        if (!btn) return;
        const garmentId = btn.dataset.garmentId;

        // 선택 강조
        $$('#wardrobeGrid button[data-garment-id]').forEach(b => b.classList.remove('ring-2', 'ring-blue-500'));
        btn.classList.add('ring-2', 'ring-blue-500');

        grid.style.pointerEvents = 'none';
        ui.start(); // loading 시작
        ui.setProgress(0.05, 'Capturing current frame...');

        // 캡처
        const shot = await captureCurrentFrame({ maxWidth: 1080, maxHeight: 1080, mirror: false });
        if (!shot.ok) {
            ui.fail(shot.error || 'No camera frame');
            grid.style.pointerEvents = '';
            return;
        }
        ui.setPreview(shot.dataUrl); // 미리보기 설정 (loading 유지)

        const personRef = { type: 'file', blob: shot.blob, previewUrl: shot.dataUrl, meta: { w: shot.width, h: shot.height, source: shot.source } };
        const options = { face_lock: true };

        try {
            const result = await runVTONWithFallback({
                personRef, garmentId, options,
                onProgress: (p, stage) => {
                    ui.setProgress(typeof p === 'number' ? p : undefined, stage); // 진행률 업데이트
                },
            });

            if (result.status === 'succeeded') {
                if (result.result_url) ui.succeed(result.result_url);
                else if (result.result_base64) ui.succeed(`data:image/png;base64,${result.result_base64}`);
                else if (result.image_base64) ui.succeed(`data:image/png;base64,${result.image_base64}`);
                else ui.succeed(personRef.previewUrl);
            } else {
                ui.fail(result.error || 'Failed');
            }
        } catch (err) {
            ui.fail(err.message);
        } finally {
            grid.style.pointerEvents = '';
        }
    });
}