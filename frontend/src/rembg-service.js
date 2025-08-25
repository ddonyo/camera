// frontend/src/rembg-service.js
const API_BASE = location.origin.startsWith('file') ? 'http://localhost:3000' : '';
export const REMBG_ENDPOINT = `${API_BASE}/api/v1/rembg/remove`;

// 이미지 배경 제거 함수
export async function removeBackground(imageBlob, onProgress) {
    try {
        onProgress?.(0.1, 'Preparing image...');
        
        const formData = new FormData();
        formData.append('image', imageBlob, 'image.jpg');
        
        onProgress?.(0.3, 'Removing background...');
        
        const response = await fetch(REMBG_ENDPOINT, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Server error: ${response.status}`);
        }
        
        onProgress?.(0.9, 'Processing result...');
        
        const result = await response.json();
        
        if (!result.success || !result.result_base64) {
            throw new Error('Invalid response from background removal service');
        }
        
        onProgress?.(1.0, 'Completed');
        
        const resultUrl = `data:image/png;base64,${result.result_base64}`;
        
        return {
            success: true,
            resultUrl: resultUrl,
            resultBase64: result.result_base64,
            elapsedTime: result.elapsed_time
        };
        
    } catch (error) {
        console.error('Background removal failed:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// 캔버스에서 이미지를 가져와서 배경 제거 적용
export async function applyRembgToCanvas(canvas, onProgress) {
    try {
        // 캔버스를 blob으로 변환
        const blob = await new Promise((resolve) => {
            canvas.toBlob(resolve, 'image/jpeg', 0.9);
        });
        
        if (!blob) {
            throw new Error('Failed to convert canvas to blob');
        }
        
        // 배경 제거 실행
        const result = await removeBackground(blob, onProgress);
        
        if (!result.success) {
            throw new Error(result.error);
        }
        
        return result;
        
    } catch (error) {
        console.error('Canvas rembg application failed:', error);
        return {
            success: false,
            error: error.message
        };
    }
}