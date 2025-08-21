import { MJPEGViewer } from './mjpeg-viewer.js';
import { FullscreenManager } from './fullscreen-manager.js';
import { bindNumberInputs } from './number-input.js';
import { initWardrobeController } from './wardrobe-controller.js';
import { renderWardrobeGrid } from './wardrobe-data.js';

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

    // 전체화면 관리자 인스턴스 생성 및 전역 할당
    window.fullscreenManager = new FullscreenManager();

    console.log('MJPEG Viewer Application initialized');
}

// 애플리케이션 종료 전 정리 함수
function cleanupApp() {
    if (window.fullscreenManager) {
        window.fullscreenManager.destroy();
        window.fullscreenManager = null;
    }

    if (window.mjpegViewer) {
        window.mjpegViewer.destroy();
        window.mjpegViewer = null;
    }

    console.log('MJPEG Viewer Application cleaned up');
}

// DOM 로드 완료 시 앱 초기화
window.addEventListener('DOMContentLoaded', () => {
    // 1) 숫자 입력 / 워드로브 / VTON 컨트롤러
    bindNumberInputs();
    const grid = document.getElementById('wardrobeGrid');
    renderWardrobeGrid(grid);
    initWardrobeController();

    // 2) 카메라 / MJPEG 뷰어 초기화
    try {
        initializeApp();
    } catch (e) {
        console.error('[init] initializeApp failed: ', e);
    }

    // 3) 윈도우 웹캠 UI 토글 (WIN_CAM 브릿지 노출 시)
    if (window.WIN_CAM) {
        document.body.classList.add('win-webcam');
    }
});
// 페이지 언로드 직전 앱 정리
window.addEventListener('beforeunload', cleanupApp);
