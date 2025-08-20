// frontend/src/capture-helper.js
export async function captureCurrentFrame({ maxWidth = 1080, maxHeight = 1080, mirror = false } = {}) {
    // 1) Windows 웹캠
    if (window.WIN_CAM?.capture) {
        try {
            await window.WIN_CAM.ready;
            const snap = await window.WIN_CAM.capture({ maxWidth, maxHeight, mirror });
            return { ok: true, blob: snap.blob, dataUrl: snap.dataUrl, width: snap.width, height: snap.height, source: 'webcam' };
        } catch (e) {
            console.warn('WIN_CAM capture failed, fallback to canvas:', e);
        }
    }
    // 2) Linux MJPEG (viewer 캔버스)
    const canvas = document.getElementById('viewer');
    if (canvas && canvas.width && canvas.height) {
        const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
        const blob = await (await fetch(dataUrl)).blob();
        return { ok: true, blob, dataUrl, width: canvas.width, height: canvas.height, source: 'canvas' };
    }
    return { ok: false, error: 'No camera source available' };
}
