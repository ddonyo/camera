// frontend/src/capture-helper.js
import { removeBackground } from './rembg-service.js';

export async function captureCurrentFrame({ maxWidth = 1080, maxHeight = 1080, mirror = false, crop = false } = {}) {
    // 1) Windows 웹캠
    if (window.WIN_CAM?.capture) {
        try {
            await window.WIN_CAM.ready;
            const snap = await window.WIN_CAM.capture({ maxWidth, maxHeight, mirror, crop });
            return { ok: true, blob: snap.blob, dataUrl: snap.dataUrl, width: snap.width, height: snap.height, source: 'webcam' };
        } catch (e) {
            console.warn('WIN_CAM capture failed, fallback to canvas:', e);
        }
    }
    // 2) Linux MJPEG (viewer 캔버스)
    const canvas = document.getElementById('viewer');
    if (canvas && canvas.width && canvas.height) {
        let finalCanvas = canvas;
        
        if (crop) {
            // 크롭된 캔버스 생성
            finalCanvas = applyCropToCanvas(canvas);
        }
        
        const dataUrl = finalCanvas.toDataURL('image/jpeg', 0.92);
        const blob = await (await fetch(dataUrl)).blob();
        
        // 임시로 생성한 캔버스는 정리
        if (finalCanvas !== canvas) {
            finalCanvas.remove();
        }
        
        return { ok: true, blob, dataUrl, width: finalCanvas.width, height: finalCanvas.height, source: 'canvas' };
    }
    return { ok: false, error: 'No camera source available' };
}

// 캔버스에서 중앙 크롭 적용 (좌/우는 검정으로 마스킹)
function applyCropToCanvas(sourceCanvas) {
    const cropCanvas = document.createElement('canvas');
    const ctx = cropCanvas.getContext('2d');
    
    // 원본과 동일한 크기로 캔버스 설정
    const sourceWidth = sourceCanvas.width;
    const sourceHeight = sourceCanvas.height;
    cropCanvas.width = sourceWidth;
    cropCanvas.height = sourceHeight;
    
    // 먼저 검정색으로 전체 캔버스 채우기
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, sourceWidth, sourceHeight);
    
    // 중앙 영역 계산
    const cropX = sourceWidth / 3;
    const cropWidth = sourceWidth / 3;
    const canvasCenterX = sourceWidth / 3;
    const canvasCenterWidth = sourceWidth / 3;
    
    // 원본 캔버스의 중앙 영역을 새 캔버스의 중앙에 복사
    ctx.drawImage(
        sourceCanvas,
        cropX, 0, cropWidth, sourceHeight,           // 소스 영역 (원본 중앙 1/3)
        canvasCenterX, 0, canvasCenterWidth, sourceHeight // 대상 영역 (캔버스 중앙 1/3)
    );
    
    return cropCanvas;
}
