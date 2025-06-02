import { MJPEGViewer } from './mjpeg-viewer.js';

// 이미지 URL에 타임스탬프 추가 (캐시 방지)
function addTimestampToImages() {
    const timestamp = new Date().getTime();
    document.querySelectorAll('img').forEach(img => {
        if (img.src.includes('/resources/')) {
            img.src = `${img.src}?t=${timestamp}`;
        }
    });
}

// 애플리케이션 초기화 함수
function initializeApp() {
    // 이미지 캐시 방지 함수 호출
    addTimestampToImages();

    // MJPEG 뷰어 인스턴스 생성 및 전역 할당
    window.mjpegViewer = new MJPEGViewer();

    console.log('MJPEG Viewer Application initialized');
}

// 애플리케이션 종료 전 정리 함수
function cleanupApp() {
    if (window.mjpegViewer) {
        window.mjpegViewer.destroy();
        window.mjpegViewer = null;
        console.log('MJPEG Viewer Application cleaned up');
    }
}

// DOM 로드 완료 시 앱 초기화
window.addEventListener('DOMContentLoaded', initializeApp);
// 페이지 언로드 직전 앱 정리
window.addEventListener('beforeunload', cleanupApp);