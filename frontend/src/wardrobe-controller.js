// frontend/src/wardrobe-controller.js
import { $, $$ } from './dom.js';
import { createVtonUI } from './vton-ui.js';
import { captureCurrentFrame } from './capture-helper.js';
import { runVTONWithFallback } from './vton-service.js';
import { removeBackground } from './rembg-service.js';

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

        // 크롭 모드 확인 (cropBtn의 active 클래스로 판단)
        const cropBtn = document.getElementById('cropBtn');
        const cropMode = cropBtn && cropBtn.classList.contains('active');
        
        // RemBG 모드 확인 (rembgBtn의 active 클래스로 판단)
        const rembgBtn = document.getElementById('rembgBtn');
        const rembgMode = rembgBtn && rembgBtn.classList.contains('active');
        
        // 캡처 (크롭 모드 적용)
        const shot = await captureCurrentFrame({ maxWidth: 1080, maxHeight: 1080, mirror: false, crop: cropMode });
        if (!shot.ok) {
            ui.fail(shot.error || 'No camera frame');
            grid.style.pointerEvents = '';
            return;
        }
        ui.setPreview(shot.dataUrl); // 미리보기 설정 (loading 유지)

        let finalBlob = shot.blob;
        let finalDataUrl = shot.dataUrl;
        
        // RemBG 모드가 활성화된 경우 배경 제거 적용
        if (rembgMode) {
            ui.setProgress(0.15, 'Removing background...');
            
            const rembgResult = await removeBackground(shot.blob, (progress, stage) => {
                // 배경 제거 진행률을 0.15~0.4 범위로 매핑
                const mappedProgress = 0.15 + (progress * 0.25);
                ui.setProgress(mappedProgress, stage);
            });
            
            if (rembgResult.success) {
                // 배경이 제거된 이미지를 사용
                finalDataUrl = rembgResult.resultUrl;
                finalBlob = await (await fetch(finalDataUrl)).blob();
                ui.setPreview(finalDataUrl); // 배경이 제거된 이미지로 미리보기 업데이트
                console.log(`[RemBG] Background removal completed in ${rembgResult.elapsedTime} seconds`);
            } else {
                console.warn('[RemBG] Background removal failed, using original image:', rembgResult.error);
            }
        }

        const personRef = { type: 'file', blob: finalBlob, previewUrl: finalDataUrl, meta: { w: shot.width, h: shot.height, source: shot.source } };
        const options = { face_lock: true };

        try {
            const result = await runVTONWithFallback({
                personRef, garmentId, options,
                onProgress: (p, stage) => {
                    // VTON 진행률을 0.4~1.0 범위로 매핑 (rembg가 0.15~0.4 사용)
                    const baseProgress = rembgMode ? 0.4 : 0.05;
                    const mappedProgress = typeof p === 'number' ? baseProgress + (p * (1 - baseProgress)) : undefined;
                    ui.setProgress(mappedProgress, stage);
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