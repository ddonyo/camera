import { MJPEGViewer } from './mjpeg-viewer.js';

/**
 * 이미지 캐시 방지를 위한 타임스탬프 추가
 */
function addTimestampToImages() {
    const timestamp = new Date().getTime();
    document.querySelectorAll('img').forEach(img => {
        if (img.src.includes('/resources/')) {
            img.src = `${img.src}?t=${timestamp}`;
        }
    });
}

/**
 * 애플리케이션 초기화
 */
function initializeApp() {
    // 이미지 캐시 방지
    addTimestampToImages();

    // MJPEG 뷰어 인스턴스 생성
    window.mjpegViewer = new MJPEGViewer();

    console.log('MJPEG Viewer Application initialized');
}

/**
 * 애플리케이션 정리
 */
function cleanupApp() {
    if (window.mjpegViewer) {
        window.mjpegViewer.destroy();
        window.mjpegViewer = null;
        console.log('MJPEG Viewer Application cleaned up');
    }
}

// 이벤트 리스너 등록
window.addEventListener('DOMContentLoaded', initializeApp);
window.addEventListener('beforeunload', cleanupApp);