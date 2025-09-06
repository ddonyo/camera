import { MJPEGViewer } from './mjpeg-viewer.js';
import { FullscreenManager } from './fullscreen-manager.js';
import { bindNumberInputs } from './number-input.js';
import { initWardrobeController, triggerVTONFromGesture } from './wardrobe-controller.js';
import { renderWardrobeGrid } from './wardrobe-data.js';

// 이미지 URL에 타임스탬프 추가 (캐시 방지)
function addTimestampToImages() {
    const timestamp = new Date().getTime();
    document.querySelectorAll('img').forEach((img) => {
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

// VTON 전체화면 기능은 이제 index.html의 인라인 스크립트에서 직접 처리됨

// Mode switching handler
function handleModeChange(mode) {
    const modeResultLabel = document.getElementById('modeResultLabel');
    const bottomSectionTitle = document.getElementById('bottomSectionTitle');
    const wardrobeGrid = document.getElementById('wardrobeGrid');
    const vtonResult = document.getElementById('vtonResult');

    if (mode === 'replay') {
        // Replay mode
        if (modeResultLabel) modeResultLabel.textContent = 'ImageViewer';
        if (bottomSectionTitle) bottomSectionTitle.textContent = 'Thumbnail';
        // Keep grid container but hide wardrobe items inside
        if (wardrobeGrid) {
            wardrobeGrid.style.visibility = 'hidden'; // Hide content but maintain layout space
            wardrobeGrid.style.minHeight = '80px'; // Maintain minimum height for layout
        }
        // Show video placeholder image in replay panel
        if (vtonResult) {
            vtonResult.src = './resources/ui/video-placeholder.jpg';
        }
        // Generate thumbnails only if we have frames from a recording
        // (thumbnails will be regenerated after each new recording completes)
        if (window.mjpegViewer && window.mjpegViewer.frameManager.getFrameCount() > 0) {
            generateThumbnails();
        }
    } else if (mode === 'vton') {
        // VTON mode
        if (modeResultLabel) modeResultLabel.textContent = 'VTON Result';
        if (bottomSectionTitle) bottomSectionTitle.textContent = 'Wardrobe';
        // Show wardrobe items
        if (wardrobeGrid) {
            wardrobeGrid.style.visibility = 'visible';
            wardrobeGrid.style.minHeight = ''; // Reset minimum height
        }
        // Change back to VTON placeholder image
        if (vtonResult) {
            vtonResult.src = './resources/vton/placeholder.jpg';
        }
        // Clear thumbnails
        clearThumbnails();
    }

    console.log(`[App] Mode switched to: ${mode}`);
}

// Generate thumbnails for recorded frames
window.generateThumbnails = function generateThumbnails() {
    const wardrobeGrid = document.getElementById('wardrobeGrid');
    if (!wardrobeGrid || !window.mjpegViewer) return;
    
    const frameManager = window.mjpegViewer.frameManager;
    const frameCount = frameManager.getFrameCount();
    
    console.log(`[generateThumbnails] Generating thumbnails for ${frameCount} frames`);
    
    if (frameCount === 0) {
        console.log('[generateThumbnails] No frames to generate thumbnails from');
        return;
    }
    
    // Clear existing content and create thumbnail container
    wardrobeGrid.innerHTML = '';
    wardrobeGrid.style.visibility = 'visible';
    
    // Calculate how many thumbnails to show (max 10)
    const maxThumbnails = 10;
    const thumbnailCount = Math.min(frameCount, maxThumbnails);
    const interval = frameCount > maxThumbnails ? Math.floor(frameCount / maxThumbnails) : 1;
    
    // Add timestamp for cache busting
    const timestamp = new Date().getTime();
    
    // Create thumbnails at linear intervals
    for (let i = 0; i < thumbnailCount; i++) {
        const frameIndex = Math.min(i * interval, frameCount - 1);
        const frame = frameManager.frames[frameIndex];
        
        if (frame && frame.path) {
            console.log(`[generateThumbnails] Creating thumbnail for frame ${frameIndex}: ${frame.path}`);
            const thumbnail = document.createElement('button');
            thumbnail.className = 'snap-start shrink-0 w-40 rounded-xl bg-zinc-800/50 p-3 ring-1 ring-zinc-700 hover:ring-blue-400 transition-all';
            // Add timestamp and random value to image src to prevent caching
            const imageSrc = `${frame.path}?t=${timestamp}&r=${Math.random()}`;
            thumbnail.innerHTML = `
                <img src="${imageSrc}" 
                     alt="Frame ${frameIndex}" 
                     class="w-full h-36 object-cover rounded-lg mb-2"
                     data-frame-index="${frameIndex}">
                <div class="text-sm text-zinc-200 text-left">Frame ${frameIndex}</div>
            `;
            
            // Add click handler to show this frame in replay panel only
            thumbnail.addEventListener('click', () => {
                // Update the ImageViewer panel image with selected thumbnail (also with timestamp)
                const vtonResult = document.getElementById('vtonResult');
                if (vtonResult) {
                    vtonResult.src = `${frame.path}?t=${timestamp}`;
                    // Remove any inline styles that might override the CSS classes
                    vtonResult.style.removeProperty('width');
                    vtonResult.style.removeProperty('height');
                    vtonResult.style.removeProperty('object-fit');
                    
                    // Check if crop mode was enabled when recording
                    // Since the frames are already cropped when saved, we should fill the panel
                    const isCropMode = window.mjpegViewer?.cropMode;
                    
                    // Set data attribute for crop mode to apply correct CSS
                    if (isCropMode) {
                        vtonResult.setAttribute('data-crop-generated', 'true');
                    } else {
                        vtonResult.removeAttribute('data-crop-generated');
                    }
                }
                // Do not jump to this frame in the main viewer - keep playback running
            });
            
            wardrobeGrid.appendChild(thumbnail);
        }
    }
}

// Clear thumbnails
function clearThumbnails() {
    const wardrobeGrid = document.getElementById('wardrobeGrid');
    if (wardrobeGrid) {
        // Restore wardrobe items
        const grid = wardrobeGrid;
        wardrobeGrid.innerHTML = '';
        renderWardrobeGrid(grid);
    }
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

    // 4) VTON V gesture trigger event listener
    window.addEventListener('vtonTriggered', (event) => {
        console.log('[App] VTON triggered by V gesture:', event.detail);
        triggerVTONFromGesture();
    });

    // 5) Mode selector change event
    const modeSelect = document.getElementById('modeSelect');
    if (modeSelect) {
        // Set initial mode to Replay
        handleModeChange('replay');

        // Handle mode changes
        modeSelect.addEventListener('change', (event) => {
            handleModeChange(event.target.value);
        });
    }
});
// 페이지 언로드 직전 앱 정리
window.addEventListener('beforeunload', cleanupApp);
