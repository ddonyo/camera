// frontend/src/wardrobe-controller.js
import { $, $$ } from './dom.js';
import { createVtonUI } from './vton-ui.js';
import { captureCurrentFrame } from './capture-helper.js';
import { runVTONWithFallback } from './vton-service.js';

let vtonUI = null;

export function initWardrobeController() {
    const grid = $('#wardrobeGrid');
    if (!grid) return;

    const ui = createVtonUI();
    vtonUI = ui; // Store for external access

    // VTON 모드 선택 초기화
    initVtonModeSelector();

    grid.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-garment-id]');
        if (!btn) return;
        const garmentId = btn.dataset.garmentId;

        // 선택 강조
        $$('#wardrobeGrid button[data-garment-id]').forEach((b) =>
            b.classList.remove('ring-2', 'ring-blue-500')
        );
        btn.classList.add('ring-2', 'ring-blue-500');

        grid.style.pointerEvents = 'none';
        ui.start(); // loading 시작
        ui.setProgress(0.05, 'Capturing current frame...');

        // 크롭 모드 확인 (cropBtn의 active 클래스로 판단)
        const cropBtn = document.getElementById('cropBtn');
        const cropMode = cropBtn && cropBtn.classList.contains('active');

        // VTON 모드 가져오기
        const vtonMode = getSelectedVtonMode();
        console.log(`[VTON] Selected mode for API request: ${vtonMode}`);

        // 캡처 (크롭 모드 적용)
        const shot = await captureCurrentFrame({
            maxWidth: 1080,
            maxHeight: 1080,
            mirror: false,
            crop: cropMode,
        });
        if (!shot.ok) {
            ui.fail(shot.error || 'No camera frame');
            grid.style.pointerEvents = '';
            return;
        }
        ui.setPreview(shot.dataUrl); // 미리보기 설정 (loading 유지)

        let finalBlob = shot.blob;
        let finalDataUrl = shot.dataUrl;

        const personRef = {
            type: 'file',
            blob: finalBlob,
            previewUrl: finalDataUrl,
            meta: { w: shot.width, h: shot.height, source: shot.source },
        };
        const options = { face_lock: true, vton_mode: vtonMode };

        try {
            const result = await runVTONWithFallback({
                personRef,
                garmentId,
                options,
                onProgress: (p, stage) => {
                    // VTON 진행률을 0.05~1.0 범위로 매핑
                    const baseProgress = 0.05;
                    const mappedProgress =
                        typeof p === 'number' ? baseProgress + p * (1 - baseProgress) : undefined;
                    ui.setProgress(mappedProgress, stage);
                },
            });

            if (result.status === 'succeeded') {
                if (result.result_url) ui.succeed(result.result_url, true, cropMode);
                else if (result.result_base64)
                    ui.succeed(`data:image/png;base64,${result.result_base64}`, true, cropMode);
                else ui.succeed(personRef.previewUrl, true, cropMode);
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

// VTON 모드 선택 초기화
function initVtonModeSelector() {
    console.log('[VTON] initVtonModeSelector called');

    // 드롭다운 요소 찾기
    setTimeout(() => {
        const dropdown = document.getElementById('vtonModeSelect');
        if (dropdown) {
            console.log('[VTON] Dropdown found, adding change listener');

            dropdown.addEventListener('change', (e) => {
                const selectedMode = e.target.value;
                console.log(`[VTON] Mode changed to: ${selectedMode}`);
            });

            console.log(`[VTON] Initial mode: ${dropdown.value}`);
        } else {
            console.error('[VTON] Dropdown not found!');
        }
    }, 500);
}

// 선택된 VTON 모드 가져오기
function getSelectedVtonMode() {
    const dropdown = document.getElementById('vtonModeSelect');
    if (dropdown) {
        console.log(`[VTON] Dropdown found, current value: ${dropdown.value}`);
        console.log(`[VTON] Dropdown selected index: ${dropdown.selectedIndex}`);
        console.log(
            `[VTON] Dropdown options:`,
            Array.from(dropdown.options).map((opt) => ({
                value: opt.value,
                selected: opt.selected,
                text: opt.text,
            }))
        );
        return dropdown.value;
    } else {
        console.warn('[VTON] Dropdown not found, using default: balanced');
        return 'balanced';
    }
}

// Automatic VTON trigger for V gesture
export async function triggerVTONFromGesture() {
    console.log('[VTON] Triggering VTON from V gesture');

    // Check if UI is already processing
    if (!vtonUI) {
        console.warn('[VTON] UI not initialized');
        return;
    }

    // Get the first available garment (or a default one)
    const firstGarmentBtn = $('#wardrobeGrid button[data-garment-id]');
    if (!firstGarmentBtn) {
        console.warn('[VTON] No garment available');
        return;
    }

    const garmentId = firstGarmentBtn.dataset.garmentId;
    console.log('[VTON] Using garment:', garmentId);

    // Highlight the selected garment
    $$('#wardrobeGrid button[data-garment-id]').forEach((b) =>
        b.classList.remove('ring-2', 'ring-blue-500')
    );
    firstGarmentBtn.classList.add('ring-2', 'ring-blue-500');

    vtonUI.start(); // Start loading
    vtonUI.setProgress(0.05, 'V Gesture triggered - Capturing frame...');

    // Check crop mode
    const cropBtn = document.getElementById('cropBtn');
    const cropMode = cropBtn && cropBtn.classList.contains('active');

    // Get VTON mode
    const vtonMode = getSelectedVtonMode();
    console.log(`[VTON] V Gesture mode: ${vtonMode}`);

    // Capture current frame
    const shot = await captureCurrentFrame({
        maxWidth: 1080,
        maxHeight: 1080,
        mirror: false,
        crop: cropMode,
    });

    if (!shot.ok) {
        vtonUI.fail(shot.error || 'Failed to capture frame');
        return;
    }

    vtonUI.setPreview(shot.dataUrl);

    const personRef = {
        type: 'file',
        blob: shot.blob,
        previewUrl: shot.dataUrl,
        meta: { w: shot.width, h: shot.height, source: shot.source },
    };
    const options = { face_lock: true, vton_mode: vtonMode };

    try {
        const result = await runVTONWithFallback({
            personRef,
            garmentId,
            options,
            onProgress: (p, stage) => {
                const baseProgress = 0.05;
                const mappedProgress =
                    typeof p === 'number' ? baseProgress + p * (1 - baseProgress) : undefined;
                vtonUI.setProgress(mappedProgress, stage);
            },
        });

        if (result.status === 'succeeded') {
            if (result.result_url) vtonUI.succeed(result.result_url, true, cropMode);
            else if (result.result_base64)
                vtonUI.succeed(`data:image/png;base64,${result.result_base64}`, true, cropMode);
            else vtonUI.succeed(personRef.previewUrl, true, cropMode);
        } else {
            vtonUI.fail(result.error || 'Failed');
        }
    } catch (err) {
        vtonUI.fail(err.message);
    }
}
