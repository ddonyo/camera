import { MJPEGViewer } from './mjpeg-viewer.js';
import { FullscreenManager } from './fullscreen-manager.js';
import { bindNumberInputs } from './number-input.js';
import { initWardrobeController, triggerVTONFromGesture } from './wardrobe-controller.js';
import { renderWardrobeGrid } from './wardrobe-data.js';
import { CanvasUtils } from './utils.js';

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
            wardrobeGrid.style.visibility = 'visible'; // Keep visible for thumbnails
            wardrobeGrid.style.minHeight = '80px'; // Maintain minimum height for layout
        }
        // Show video placeholder image in replay panel
        if (vtonResult) {
            vtonResult.src = './resources/ui/video-placeholder.jpg';
        }
        // Generate thumbnails if we have frames, otherwise show empty placeholders
        if (window.mjpegViewer && window.mjpegViewer.frameManager.getFrameCount() > 0) {
            generateThumbnails();
        } else {
            // Show empty thumbnail placeholders
            generateEmptyThumbnails();
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
window.generateThumbnails = async function generateThumbnails() {
    const wardrobeGrid = document.getElementById('wardrobeGrid');
    if (!wardrobeGrid || !window.mjpegViewer) return;
    
    const frameManager = window.mjpegViewer.frameManager;
    const frameCount = frameManager.getFrameCount();
    
    console.log(`[generateThumbnails] Generating thumbnails for ${frameCount} frames`);

    if (frameCount === 0) {
        console.log('[generateThumbnails] No frames to generate thumbnails from');
        return;
    }

    // 뒷모습 감지를 위한 변수들
    let backViewFrame = null;
    let backViewConfidence = 0;
    let middleFrameIndex = Math.floor(frameCount / 2);
    let bestFrameToShow = null;

    // Get FPS from recording info for time calculation
    let fps = 30; // default FPS
    try {
        const { FileUtils } = await import('./utils.js');
        fps = await FileUtils.getRecordingFPS();
        console.log('[generateThumbnails] Using MediaPipe for back view detection');
    } catch (error) {
        console.warn('[generateThumbnails] Could not get FPS from recording, using default 30:', error);
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
            // Calculate time in seconds for this frame
            const timeInSeconds = frameIndex / fps;
            const minutes = Math.floor(timeInSeconds / 60);
            const seconds = timeInSeconds % 60;
            const timeString = `${String(minutes).padStart(2, '0')}.${seconds.toFixed(6).padStart(9, '0')}`;
            
            console.log(`[generateThumbnails] Creating thumbnail for frame ${frameIndex} at ${timeString}: ${frame.path}`);
            const thumbnail = document.createElement('button');
            thumbnail.className = 'snap-start shrink-0 w-40 rounded-xl bg-zinc-800/50 p-3 ring-1 ring-zinc-700 hover:ring-blue-400 transition-all';
            
            // Create a canvas for the thumbnail
            const thumbCanvas = document.createElement('canvas');
            thumbCanvas.width = 160;
            thumbCanvas.height = 120;
            thumbCanvas.className = 'w-full h-36 object-cover rounded-lg mb-2';
            
            // Create thumbnail content with time instead of frame number
            const frameLabel = document.createElement('div');
            frameLabel.className = 'text-sm text-zinc-200 text-left';
            frameLabel.textContent = timeString;
            
            thumbnail.appendChild(thumbCanvas);
            thumbnail.appendChild(frameLabel);
            
            // Load and draw the image with transformations
            const img = new Image();
            const imageSrc = `${frame.path}?t=${timestamp}&r=${Math.random()}`;
            
            img.onload = () => {
                console.log(`[generateThumbnails] Image loaded for frame ${frameIndex}: ${imageSrc}, size: ${img.width}x${img.height}`);

                // Apply transformations using CanvasUtils
                // 썸네일에는 fullCrop 사용 (중앙 1/3을 전체에 꽉 채움)
                CanvasUtils.drawImageToCanvas(thumbCanvas, img, {
                    flip: window.mjpegViewer?.flipMode || false,
                    fullCrop: window.mjpegViewer?.cropMode || false
                });

                console.log(`[generateThumbnails] Canvas drawn for frame ${frameIndex}, canvas size: ${thumbCanvas.width}x${thumbCanvas.height}`);

                // MediaPipe를 이용한 뒷모습 감지 실행 (썸네일 캔버스 전달)
                performMediaPipeBackViewDetection(frameIndex, frame, thumbCanvas, i, thumbnailCount);
            };
            
            img.src = imageSrc;
            
            // Add click handler to show this frame in ImageViewer panel
            thumbnail.addEventListener('click', () => {
                const vtonResult = document.getElementById('vtonResult');
                if (!vtonResult) return;
                
                // Check if vtonResult is an img or canvas element
                if (vtonResult.tagName === 'IMG') {
                    // Replace img with canvas for proper transformation
                    const viewerCanvas = document.createElement('canvas');
                    viewerCanvas.id = 'vtonResult';
                    viewerCanvas.className = vtonResult.className;
                    
                    // 패널의 실제 크기에 맞춰 캔버스 크기 설정
                    const panel = vtonResult.parentElement;
                    const rect = panel.getBoundingClientRect();
                    viewerCanvas.width = rect.width || 640;
                    viewerCanvas.height = rect.height || 480;
                    
                    // 캔버스 스타일 설정 - 패널 전체를 채우도록
                    viewerCanvas.style.position = 'absolute';
                    viewerCanvas.style.inset = '0';
                    viewerCanvas.style.width = '100%';
                    viewerCanvas.style.height = '100%';
                    
                    vtonResult.parentNode.replaceChild(viewerCanvas, vtonResult);
                    
                    // Load and draw with transformations
                    const viewerImg = new Image();
                    viewerImg.onload = () => {
                        // ImageViewer 패널에도 fullCrop 사용 (중앙 1/3을 전체에 꽉 채움)
                        CanvasUtils.drawImageToCanvas(viewerCanvas, viewerImg, {
                            flip: window.mjpegViewer?.flipMode || false,
                            fullCrop: window.mjpegViewer?.cropMode || false
                        });
                    };
                    viewerImg.src = `${frame.path}?t=${timestamp}`;
                } else if (vtonResult.tagName === 'CANVAS') {
                    // Already a canvas, just draw with transformations
                    const viewerImg = new Image();
                    viewerImg.onload = () => {
                        // ImageViewer 패널에도 fullCrop 사용 (중앙 1/3을 전체에 꽉 채움)
                        CanvasUtils.drawImageToCanvas(vtonResult, viewerImg, {
                            flip: window.mjpegViewer?.flipMode || false,
                            fullCrop: window.mjpegViewer?.cropMode || false
                        });
                    };
                    viewerImg.src = `${frame.path}?t=${timestamp}`;
                }
            });
            
            wardrobeGrid.appendChild(thumbnail);
        }
    }

    // MediaPipe를 이용한 뒷모습 감지 함수 (썸네일 캔버스 직접 분석)
    async function performMediaPipeBackViewDetection(frameIndex, frame, thumbCanvas, currentIndex, totalCount) {
        console.log(`[performMediaPipeBackViewDetection] Starting MediaPipe detection for frame ${frameIndex}`);

        try {
            // 썸네일 캔버스를 blob으로 변환
            const blob = await new Promise(resolve => {
                thumbCanvas.toBlob(resolve, 'image/jpeg', 0.8);
            });

            // FormData로 이미지 파일 전송
            const formData = new FormData();
            formData.append('image', blob, `thumbnail_${frameIndex}.jpg`);

            // API 호출하여 뒷모습 감지 (이미지 파일 직접 전송)
            const response = await fetch('/api/pose-analysis/back-view-blob', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (result.success && result.backView) {
                const backViewInfo = result.backView;
                console.log(`[performMediaPipeBackViewDetection] Frame ${frameIndex} MediaPipe result (from thumbnail):`, backViewInfo);

                // 가장 높은 신뢰도의 뒷모습 프레임 찾기 (임계값 0.6)
                if (backViewInfo.isBackView && backViewInfo.confidence > backViewConfidence && backViewInfo.confidence > 0.6) {
                    backViewConfidence = backViewInfo.confidence;
                    backViewFrame = { frameIndex, frame, confidence: backViewInfo.confidence, details: backViewInfo };
                    console.log(`[performMediaPipeBackViewDetection] New best back view candidate: frame ${frameIndex} (confidence: ${backViewInfo.confidence.toFixed(2)})`);
                }
            } else {
                console.log(`[performMediaPipeBackViewDetection] Frame ${frameIndex} - no pose detected or API error`);
            }

        } catch (error) {
            console.error(`[performMediaPipeBackViewDetection] API error for frame ${frameIndex}:`, error);
        }

        // 마지막 썸네일 처리가 완료되면 최적의 프레임을 ImageViewer에 표시
        if (currentIndex === totalCount - 1) {
            console.log(`[performMediaPipeBackViewDetection] Last thumbnail processed, scheduling ImageViewer update...`);
            setTimeout(() => {
                displayBestFrameInImageViewer();
            }, 1000); // 모든 MediaPipe 분석이 완료될 시간을 줌
        }
    }

    // 뒷모습 또는 가운데 프레임을 ImageViewer에 표시하는 함수
    function displayBestFrameInImageViewer() {
        console.log(`[displayBestFrameInImageViewer] Starting - backViewFrame:`, backViewFrame);

        let targetFrame = null;
        let reason = '';

        if (backViewFrame && backViewFrame.confidence > 0.6) { // MediaPipe 기반 임계값
            targetFrame = backViewFrame.frame;
            reason = `MediaPipe back view (confidence: ${backViewFrame.confidence.toFixed(2)})`;
        } else {
            // 뒷모습이 없으면 가운데 프레임 사용
            const middleFrame = frameManager.frames[middleFrameIndex];
            if (middleFrame) {
                targetFrame = middleFrame;
                reason = 'middle frame (no reliable back view found)';
            }
        }

        console.log(`[displayBestFrameInImageViewer] Selected frame:`, targetFrame, `Reason: ${reason}`);

        if (targetFrame) {
            console.log(`[generateThumbnails] Displaying ${reason} in ImageViewer`);

            const vtonResult = document.getElementById('vtonResult');
            if (vtonResult) {
                const timestamp = new Date().getTime();

                // CanvasUtils 가져오기
                import('./utils.js').then(({ CanvasUtils }) => {
                    window.CanvasUtils = CanvasUtils;

                    if (vtonResult.tagName === 'IMG') {
                        // IMG 요소인 경우 - CANVAS로 변환하여 변환 효과 적용
                        const canvas = document.createElement('canvas');
                        canvas.id = 'vtonResult';
                        canvas.width = vtonResult.width || 640;
                        canvas.height = vtonResult.height || 480;
                        canvas.className = vtonResult.className;

                        // IMG를 CANVAS로 교체
                        vtonResult.parentNode.replaceChild(canvas, vtonResult);

                        const viewerImg = new Image();
                        viewerImg.onload = () => {
                            CanvasUtils.drawImageToCanvas(canvas, viewerImg, {
                                flip: window.mjpegViewer?.flipMode || false,
                                fullCrop: window.mjpegViewer?.cropMode || false
                            });
                            console.log(`[generateThumbnails] ImageViewer IMG->CANVAS updated with ${reason}`);
                        };
                        viewerImg.src = `${targetFrame.path}?t=${timestamp}`;

                    } else if (vtonResult.tagName === 'CANVAS') {
                        // CANVAS 요소인 경우
                        const viewerImg = new Image();
                        viewerImg.onload = () => {
                            CanvasUtils.drawImageToCanvas(vtonResult, viewerImg, {
                                flip: window.mjpegViewer?.flipMode || false,
                                fullCrop: window.mjpegViewer?.cropMode || false
                            });
                            console.log(`[generateThumbnails] ImageViewer canvas updated with ${reason}`);
                        };
                        viewerImg.onerror = () => {
                            console.error(`[generateThumbnails] Failed to load image: ${targetFrame.path}`);
                        };
                        viewerImg.src = `${targetFrame.path}?t=${timestamp}`;
                    }
                }).catch(error => {
                    console.error('[displayBestFrameInImageViewer] Failed to load CanvasUtils:', error);
                });
            } else {
                console.warn('[displayBestFrameInImageViewer] vtonResult element not found');
            }
        } else {
            console.warn('[generateThumbnails] No suitable frame found for ImageViewer');
        }
    }
}

// Generate empty thumbnail placeholders
function generateEmptyThumbnails() {
    const wardrobeGrid = document.getElementById('wardrobeGrid');
    if (!wardrobeGrid) return;
    
    console.log('[generateEmptyThumbnails] Creating empty thumbnail placeholders');
    
    // Clear existing content
    wardrobeGrid.innerHTML = '';
    wardrobeGrid.style.visibility = 'visible';
    
    // Create 10 empty thumbnail placeholders
    const placeholderCount = 10;
    
    for (let i = 0; i < placeholderCount; i++) {
        const placeholder = document.createElement('div');
        placeholder.className = 'snap-start shrink-0 w-40 rounded-xl bg-zinc-800/30 p-3 ring-1 ring-zinc-700/50';
        
        // Create empty canvas placeholder
        const emptyCanvas = document.createElement('div');
        emptyCanvas.className = 'w-full h-36 bg-zinc-900/50 rounded-lg mb-2 flex items-center justify-center';
        emptyCanvas.innerHTML = `
            <svg class="w-8 h-8 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z">
                </path>
            </svg>
        `;
        
        // Create frame label with time placeholder
        const frameLabel = document.createElement('div');
        frameLabel.className = 'text-sm text-zinc-500 text-left';
        frameLabel.textContent = `00.000000`;
        
        placeholder.appendChild(emptyCanvas);
        placeholder.appendChild(frameLabel);
        
        wardrobeGrid.appendChild(placeholder);
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
