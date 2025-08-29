// 전체화면 모드 관리 클래스 (카메라/VTON 공용)
export class FullscreenManager {
    constructor() {
        this.isFullscreen = false;
        this.hideControlsTimeout = null;
        this.mouseMoveTimeout = null;
        this.mainContainer = null;
        this.fullscreenBtn = null;

        // 전체화면 모드 타입 (camera, vton, electron)
        this.fullscreenMode = null;
        this.cameraFullBtn = null;
        this.vtonFullBtn = null;

        this._bindEvents();
    }

    // Electron API 접근
    get #electronAPI() {
        return window['electronAPI'];
    }

    // 이벤트 바인딩
    _bindEvents() {
        // DOM 로드 후 요소 찾기
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this._initializeElements();
            });
        } else {
            // DOM이 이미 로드된 경우 즉시 실행
            this._initializeElements();
        }
    }

    // DOM 요소 초기화
    _initializeElements() {
        this.mainContainer = document.getElementById('mainContainer');

        // Electron 전체화면 버튼
        this.fullscreenBtn = document.getElementById('electronFullscreenBtn');
        if (this.fullscreenBtn) {
            this.fullscreenBtn.addEventListener('click', () => this.toggleElectronFullscreen());
            console.log('[FullscreenManager] Electron fullscreen button event listener attached');
        }

        // 카메라 전체화면 버튼은 mjpeg-viewer.js에서 처리하므로 여기서는 참조만 저장
        this.cameraFullBtn = document.getElementById('fullBtn');
        if (this.cameraFullBtn) {
            console.log(
                '[FullscreenManager] Camera fullscreen button found (handled by mjpeg-viewer)'
            );
        }

        // VTON 전체화면 버튼 - 이벤트 리스너 직접 등록
        this.vtonFullBtn = document.getElementById('vtonFullBtn');
        if (this.vtonFullBtn) {
            // 기존 리스너 제거를 위해 새 함수 생성
            if (!this.vtonFullBtn.hasAttribute('data-fs-initialized')) {
                this.vtonFullBtn.setAttribute('data-fs-initialized', 'true');

                // 버튼 활성화
                this.vtonFullBtn.disabled = false;
                this.vtonFullBtn.removeAttribute('disabled');

                // 클릭 이벤트 등록
                this.vtonFullBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    console.log('[FullscreenManager] VTON button clicked');
                    this.toggleVtonFullscreen();
                });
                console.log('[FullscreenManager] VTON fullscreen button event listener attached');
            }
        } else {
            console.log('[FullscreenManager] VTON button not found, retrying...');
            // 버튼이 나중에 생성될 수 있으므로 재시도
            setTimeout(() => this._retryVtonButton(), 500);
        }

        // 키보드 이벤트 등록 (즉시 등록)
        this._bindKeyboardEvents();

        // 마우스 이벤트 등록 (즉시 등록)
        this._bindMouseEvents();
    }

    // VTON 버튼 재시도
    _retryVtonButton() {
        if (!this.vtonFullBtn) {
            this.vtonFullBtn = document.getElementById('vtonFullBtn');
            if (this.vtonFullBtn && !this.vtonFullBtn.hasAttribute('data-fs-initialized')) {
                this.vtonFullBtn.setAttribute('data-fs-initialized', 'true');

                // 버튼 활성화
                this.vtonFullBtn.disabled = false;
                this.vtonFullBtn.removeAttribute('disabled');

                // 클릭 이벤트 등록
                this.vtonFullBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    console.log('[FullscreenManager] VTON button clicked (retry)');
                    this.toggleVtonFullscreen();
                });
                console.log('[FullscreenManager] VTON button event listener attached (retry)');
            }
        }
    }

    // 키보드 이벤트 바인딩
    _bindKeyboardEvents() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'F11') {
                e.preventDefault();
                this.toggleElectronFullscreen();
            } else if (e.key === 'Escape' && this.isFullscreen) {
                e.preventDefault();
                this.exitCurrentFullscreen();
            }
        });
    }

    // 마우스 이벤트 바인딩
    _bindMouseEvents() {
        // 마우스 움직임 감지 (전체화면에서 컨트롤 표시/숨김)
        document.addEventListener('mousemove', (e) => {
            if (this.isFullscreen) {
                // 마우스가 화면 하단 100px 이내에 있으면 즉시 컨트롤 표시
                const screenHeight = window.innerHeight;
                const mouseY = e.clientY;

                if (mouseY > screenHeight - 100) {
                    this._showControls();
                    this._cancelHideControls();
                } else {
                    this._showControls();
                    this._scheduleHideControls();
                }
            }
        });

        // 마우스가 컨트롤 영역에 있을 때는 숨기지 않음
        document.addEventListener(
            'mouseenter',
            (e) => {
                if (this.isFullscreen && e.target.closest('.control-area, .progress-bar')) {
                    this._cancelHideControls();
                }
            },
            true
        );

        document.addEventListener(
            'mouseleave',
            (e) => {
                if (this.isFullscreen && e.target.closest('.control-area, .progress-bar')) {
                    this._scheduleHideControls();
                }
            },
            true
        );
    }

    // 카메라 전체화면 토글
    toggleCameraFullscreen() {
        console.log('[FullscreenManager] Toggle camera fullscreen');

        // 다른 전체화면 모드가 켜져있으면 먼저 종료
        if (this.fullscreenMode && this.fullscreenMode !== 'camera') {
            this.exitCurrentFullscreen();
        }

        if (this.fullscreenMode === 'camera') {
            this.exitCameraFullscreen();
        } else {
            this.enterCameraFullscreen();
        }
    }

    // VTON 전체화면 토글
    toggleVtonFullscreen() {
        console.log('[FullscreenManager] Toggle VTON fullscreen');

        // 다른 전체화면 모드가 켜져있으면 먼저 종료
        if (this.fullscreenMode && this.fullscreenMode !== 'vton') {
            this.exitCurrentFullscreen();
            // 약간의 지연 후 VTON 전체화면 진입
            setTimeout(() => {
                this.enterVtonFullscreen();
            }, 50);
        } else if (this.fullscreenMode === 'vton') {
            this.exitVtonFullscreen();
        } else {
            this.enterVtonFullscreen();
        }
    }

    // Electron 전체화면 토글
    async toggleElectronFullscreen() {
        if (this.fullscreenMode === 'electron') {
            await this.exitElectronFullscreen();
        } else {
            await this.enterElectronFullscreen();
        }
    }

    // 카메라 전체화면 진입
    enterCameraFullscreen() {
        if (this.fullscreenMode || !this.mainContainer) return;

        console.log('[FullscreenManager] Entering camera fullscreen');

        // mjpegViewer의 fullMode를 직접 설정하고 _handleFull을 bypass
        if (window.mjpegViewer) {
            // fullMode 플래그만 설정
            window.mjpegViewer.fullMode = true;

            // 카메라 전체화면 DOM 조작 직접 실행
            this._applyCameraFullscreenStyles();
        }

        this.fullscreenMode = 'camera';
        this.updateButtonStates();
    }

    // 카메라 전체화면 종료
    exitCameraFullscreen() {
        if (this.fullscreenMode !== 'camera') return;

        console.log('[FullscreenManager] Exiting camera fullscreen');

        // mjpegViewer의 fullMode를 직접 설정하고 _handleFull을 bypass
        if (window.mjpegViewer) {
            // fullMode 플래그만 설정
            window.mjpegViewer.fullMode = false;

            // 카메라 전체화면 DOM 복원 직접 실행
            this._removeCameraFullscreenStyles();
        }

        this.fullscreenMode = null;
        this.updateButtonStates();
    }

    // 카메라 전체화면 스타일 적용
    _applyCameraFullscreenStyles() {
        const mainGridSection = document.querySelector('.main-grid-section');
        const cameraColumn = document.querySelector('.col-span-7');
        const wardrobe = document.querySelector('.wardrobe-section');
        const controlPanel = document.querySelector('.control-panel');
        const progressBar = document.querySelector('.progress-bar');
        const cameraContainer = document.querySelector('.camera-container');
        const cameraCanvas = document.querySelector('.camera-container canvas');

        // 워드로브 숨기기 (VTON 패널은 숨기지 않음)
        if (wardrobe) {
            wardrobe.style.display = 'none';
        }

        // 프로그레스 바 숨기기
        if (progressBar) {
            progressBar.style.display = 'none';
        }

        // main-grid-section을 flex로 변경
        if (mainGridSection) {
            mainGridSection.style.display = 'flex';
            mainGridSection.style.gridTemplateColumns = 'none';
        }

        // 카메라 컬럼 확장
        if (cameraColumn) {
            cameraColumn.style.width = '100%';
            cameraColumn.style.flex = 'none';
            cameraColumn.style.height = 'calc(100vh - 100px)';
        }

        // 카메라 컨테이너 확장
        if (cameraContainer) {
            cameraContainer.style.height = 'calc(100vh - 140px)';
            cameraContainer.style.flex = 'none';
            cameraContainer.style.display = 'flex';
            cameraContainer.style.alignItems = 'center';
            cameraContainer.style.justifyContent = 'center';
        }

        // 카메라 캔버스 설정
        if (cameraCanvas) {
            cameraCanvas.style.position = 'static';
            cameraCanvas.style.width = '100%';
            cameraCanvas.style.height = '100%';
            cameraCanvas.style.objectFit = 'contain';
            cameraCanvas.style.display = 'block';
        }

        // 컨트롤 패널 스타일
        if (controlPanel) {
            controlPanel.style.minHeight = '120px';
            controlPanel.style.paddingBottom = '30px';
            controlPanel.style.marginBottom = '30px';
            controlPanel.style.backgroundColor = '#374151';
            controlPanel.style.borderRadius = '12px';
            controlPanel.style.padding = '16px';
        }

        // mjpegViewer UI 업데이트 호출
        if (window.mjpegViewer && window.mjpegViewer._updateUI) {
            window.mjpegViewer._updateUI();
        }
    }

    // 카메라 전체화면 스타일 제거
    _removeCameraFullscreenStyles() {
        const mainGridSection = document.querySelector('.main-grid-section');
        const cameraColumn = document.querySelector('.col-span-7');
        const wardrobe = document.querySelector('.wardrobe-section');
        const controlPanel = document.querySelector('.control-panel');
        const progressBar = document.querySelector('.progress-bar');
        const cameraContainer = document.querySelector('.camera-container');
        const cameraCanvas = document.querySelector('.camera-container canvas');

        // 워드로브 복원
        if (wardrobe) {
            wardrobe.style.display = '';
        }

        // 프로그레스 바 복원
        if (progressBar) {
            progressBar.style.display = '';
        }

        // main-grid-section 복원
        if (mainGridSection) {
            mainGridSection.style.display = '';
            mainGridSection.style.gridTemplateColumns = '';
        }

        // 카메라 컬럼 복원
        if (cameraColumn) {
            cameraColumn.style.width = '';
            cameraColumn.style.flex = '';
            cameraColumn.style.height = '';
        }

        // 카메라 컨테이너 복원
        if (cameraContainer) {
            cameraContainer.style.height = '';
            cameraContainer.style.flex = '';
            cameraContainer.style.display = '';
            cameraContainer.style.alignItems = '';
            cameraContainer.style.justifyContent = '';
        }

        // 카메라 캔버스 복원
        if (cameraCanvas) {
            cameraCanvas.style.position = '';
            cameraCanvas.style.width = '';
            cameraCanvas.style.height = '';
            cameraCanvas.style.objectFit = '';
            cameraCanvas.style.display = '';
        }

        // 컨트롤 패널 복원
        if (controlPanel) {
            controlPanel.style.minHeight = '';
            controlPanel.style.paddingBottom = '';
            controlPanel.style.marginBottom = '';
            controlPanel.style.backgroundColor = '';
            controlPanel.style.borderRadius = '';
            controlPanel.style.padding = '';
        }

        // VTON 전체화면 버튼이 비활성화되지 않도록 확실히 활성화
        if (this.vtonFullBtn) {
            this.vtonFullBtn.disabled = false;
            this.vtonFullBtn.removeAttribute('disabled');
            this.vtonFullBtn.style.pointerEvents = 'auto';
            this.vtonFullBtn.style.cursor = 'pointer';
            console.log(
                '[FullscreenManager] Ensured VTON button is enabled after camera fullscreen exit'
            );
        }

        // mjpegViewer UI 업데이트 호출
        if (window.mjpegViewer && window.mjpegViewer._updateUI) {
            window.mjpegViewer._updateUI();
        }
    }

    // VTON 전체화면 진입
    enterVtonFullscreen() {
        if (this.fullscreenMode || !this.mainContainer) return;

        console.log('[FullscreenManager] Entering VTON fullscreen');

        // CSS 클래스 적용
        this.mainContainer.classList.add('vton-fullscreen');

        // VTON 전체화면 스타일 적용 (카메라와 유사하게)
        this._applyVtonFullscreenStyles();

        this.fullscreenMode = 'vton';
        this.updateButtonStates();
    }

    // VTON 전체화면 종료
    exitVtonFullscreen() {
        if (this.fullscreenMode !== 'vton') return;

        console.log('[FullscreenManager] Exiting VTON fullscreen');

        // CSS 클래스 제거
        this.mainContainer.classList.remove('vton-fullscreen');

        // VTON 전체화면 스타일 제거
        this._removeVtonFullscreenStyles();

        this.fullscreenMode = null;
        this.updateButtonStates();
    }

    // VTON 전체화면 스타일 적용
    _applyVtonFullscreenStyles() {
        const mainGridSection = document.querySelector('.main-grid-section');
        const vtonPanel = document.getElementById('vton-panel');
        const vtonColumn = document.querySelector('.col-span-3'); // VTON 컬럼 선택 (col-span-3이 맞음)
        const cameraColumn = document.querySelector('.col-span-7');
        const wardrobe = document.querySelector('.wardrobe-section');
        const controlPanel = document.querySelector('.control-panel');
        const progressBar = document.querySelector('.progress-bar');

        // 워드로브 숨기기
        if (wardrobe) {
            wardrobe.style.display = 'none';
            console.log('[FullscreenManager] Hidden wardrobe in VTON fullscreen');
        }

        // 카메라 컬럼 숨기기
        if (cameraColumn) {
            cameraColumn.style.display = 'none';
            console.log('[FullscreenManager] Hidden camera column in VTON fullscreen');
        }

        // 프로그레스 바 숨기기
        if (progressBar) {
            progressBar.style.display = 'none';
        }

        // main-grid-section을 flex로 변경
        if (mainGridSection) {
            mainGridSection.style.display = 'flex';
            mainGridSection.style.gridTemplateColumns = 'none';
        }

        // VTON 컬럼을 전체 너비로 확장 (카메라와 동일한 방식)
        if (vtonColumn) {
            vtonColumn.style.width = '100%';
            vtonColumn.style.flex = 'none';
            vtonColumn.style.height = 'calc(100vh - 100px)';
            console.log('[FullscreenManager] Expanded VTON column to full width');
        }

        // VTON 패널을 전체 화면으로 확장 (카메라와 동일한 높이)
        if (vtonPanel) {
            vtonPanel.style.width = '100%';
            vtonPanel.style.height = 'calc(100vh - 140px)'; // 카메라와 동일한 높이
            vtonPanel.style.flex = 'none';
            vtonPanel.style.display = 'flex';
            vtonPanel.style.alignItems = 'center';
            vtonPanel.style.justifyContent = 'center';
            vtonPanel.style.maxHeight = 'none';
            vtonPanel.style.aspectRatio = 'unset';
            vtonPanel.style.borderRadius = '0'; // 전체화면에서는 둥근 모서리 제거
            console.log(
                '[FullscreenManager] Expanded VTON panel to full width including wardrobe area'
            );
        }

        // VTON 이미지 설정
        const vtonResult = document.getElementById('vtonResult');
        if (vtonResult) {
            vtonResult.style.width = '100%';
            vtonResult.style.height = '100%';
            vtonResult.style.objectFit = 'contain';
        }

        // 컨트롤 패널 스타일 (카메라와 동일)
        if (controlPanel) {
            controlPanel.style.minHeight = '120px';
            controlPanel.style.paddingBottom = '30px';
            controlPanel.style.marginBottom = '30px';
            controlPanel.style.backgroundColor = '#374151';
            controlPanel.style.borderRadius = '12px';
            controlPanel.style.padding = '16px';
        }
    }

    // VTON 전체화면 스타일 제거
    _removeVtonFullscreenStyles() {
        const mainGridSection = document.querySelector('.main-grid-section');
        const vtonPanel = document.getElementById('vton-panel');
        const vtonColumn = document.querySelector('.col-span-3'); // VTON 컬럼 (col-span-3)
        const cameraColumn = document.querySelector('.col-span-7');
        const wardrobe = document.querySelector('.wardrobe-section');
        const controlPanel = document.querySelector('.control-panel');
        const progressBar = document.querySelector('.progress-bar');

        // 워드로브 복원
        if (wardrobe) {
            wardrobe.style.display = '';
            console.log('[FullscreenManager] Restored wardrobe after VTON fullscreen');
        }

        // 카메라 컬럼 복원
        if (cameraColumn) {
            cameraColumn.style.display = '';
            console.log('[FullscreenManager] Restored camera column after VTON fullscreen');
        }

        // 프로그레스 바 복원
        if (progressBar) {
            progressBar.style.display = '';
        }

        // main-grid-section 복원
        if (mainGridSection) {
            mainGridSection.style.display = '';
            mainGridSection.style.gridTemplateColumns = '';
        }

        // VTON 컬럼 복원
        if (vtonColumn) {
            vtonColumn.style.width = '';
            vtonColumn.style.flex = '';
            vtonColumn.style.height = '';
        }

        // VTON 패널 스타일 복원
        if (vtonPanel) {
            vtonPanel.style.width = '';
            vtonPanel.style.height = '';
            vtonPanel.style.flex = '';
            vtonPanel.style.display = '';
            vtonPanel.style.alignItems = '';
            vtonPanel.style.justifyContent = '';
            vtonPanel.style.maxHeight = '';
            vtonPanel.style.aspectRatio = '';
            vtonPanel.style.borderRadius = ''; // borderRadius 복원
        }

        // VTON 이미지 스타일 복원
        const vtonResult = document.getElementById('vtonResult');
        if (vtonResult) {
            vtonResult.style.width = '';
            vtonResult.style.height = '';
            vtonResult.style.objectFit = '';
        }

        // 컨트롤 패널 스타일 복원
        if (controlPanel) {
            controlPanel.style.minHeight = '';
            controlPanel.style.paddingBottom = '';
            controlPanel.style.marginBottom = '';
            controlPanel.style.backgroundColor = '';
            controlPanel.style.borderRadius = '';
            controlPanel.style.padding = '';
        }
    }

    // Electron 전체화면 진입
    async enterElectronFullscreen() {
        if (this.fullscreenMode === 'electron' || !this.mainContainer) return;

        console.log('[FullscreenManager] Entering Electron fullscreen');

        try {
            // 다른 전체화면 모드 종료
            if (this.fullscreenMode) {
                this.exitCurrentFullscreen();
            }

            // Electron 창 전체화면 설정
            if (this.#electronAPI) {
                await this.#electronAPI.setFullscreen(true);
            }

            // CSS 클래스 적용
            this.mainContainer.classList.add('fullscreen-entering');

            // 애니메이션 완료 후 전체화면 클래스 적용
            setTimeout(() => {
                this.mainContainer.classList.remove('fullscreen-entering');
                this.mainContainer.classList.add('fullscreen-mode');
                this.fullscreenMode = 'electron';
                this.isFullscreen = true;

                // 컨트롤 자동 숨김 시작
                this._scheduleHideControls();
                this.updateButtonStates();

                console.log('[FullscreenManager] Electron fullscreen activated');
            }, 300);
        } catch (error) {
            console.error('Failed to enter Electron fullscreen:', error);
        }
    }

    // Electron 전체화면 종료
    async exitElectronFullscreen() {
        if (this.fullscreenMode !== 'electron' || !this.mainContainer) return;

        console.log('[FullscreenManager] Exiting Electron fullscreen');

        try {
            // 컨트롤 표시 및 자동 숨김 취소
            this._showControls();
            this._cancelHideControls();

            // CSS 클래스 제거
            this.mainContainer.classList.remove('fullscreen-mode');
            this.mainContainer.classList.remove('hide-controls');
            this.mainContainer.classList.add('fullscreen-exiting');

            // 애니메이션 완료 후 정리
            setTimeout(() => {
                this.mainContainer.classList.remove('fullscreen-exiting');
                this.fullscreenMode = null;
                this.isFullscreen = false;
                this.updateButtonStates();

                console.log('[FullscreenManager] Electron fullscreen deactivated');
            }, 300);

            // Electron 창 전체화면 해제
            if (this.#electronAPI) {
                await this.#electronAPI.setFullscreen(false);
            }
        } catch (error) {
            console.error('Failed to exit Electron fullscreen:', error);
        }
    }

    // 현재 전체화면 모드 종료
    exitCurrentFullscreen() {
        switch (this.fullscreenMode) {
            case 'camera':
                this.exitCameraFullscreen();
                break;
            case 'vton':
                this.exitVtonFullscreen();
                break;
            case 'electron':
                this.exitElectronFullscreen();
                break;
        }
    }

    // 버튼 상태 업데이트
    updateButtonStates() {
        // 카메라 버튼
        if (this.cameraFullBtn) {
            const isActive = this.fullscreenMode === 'camera';
            this.cameraFullBtn.classList.toggle('active', isActive);

            const svg = this.cameraFullBtn.querySelector('svg path');
            if (svg) {
                if (isActive) {
                    svg.setAttribute(
                        'd',
                        'M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z'
                    );
                    this.cameraFullBtn.setAttribute('title', '전체화면 종료');
                } else {
                    svg.setAttribute(
                        'd',
                        'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z'
                    );
                    this.cameraFullBtn.setAttribute('title', '전체화면');
                }
            }
        }

        // VTON 버튼
        if (this.vtonFullBtn) {
            const isActive = this.fullscreenMode === 'vton';
            this.vtonFullBtn.classList.toggle('active', isActive);

            const svg = this.vtonFullBtn.querySelector('svg path');
            if (svg) {
                if (isActive) {
                    svg.setAttribute(
                        'd',
                        'M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z'
                    );
                    this.vtonFullBtn.setAttribute('title', '전체화면 종료');
                } else {
                    svg.setAttribute(
                        'd',
                        'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z'
                    );
                    this.vtonFullBtn.setAttribute('title', '전체화면');
                }
            }
        }

        // Electron 버튼
        if (this.fullscreenBtn) {
            this.fullscreenBtn.classList.toggle('active', this.fullscreenMode === 'electron');
        }
    }

    // 컨트롤 표시
    _showControls() {
        if (!this.isFullscreen) return;

        this.mainContainer.classList.remove('hide-controls');
    }

    // 컨트롤 숨김 예약
    _scheduleHideControls() {
        this._cancelHideControls();

        this.hideControlsTimeout = setTimeout(() => {
            this._hideControls();
        }, 1500); // 몇초후 숨기는지
    }

    // 컨트롤 숨김
    _hideControls() {
        if (!this.isFullscreen) return;

        this.mainContainer.classList.add('hide-controls');
    }

    // 컨트롤 숨김 취소
    _cancelHideControls() {
        if (this.hideControlsTimeout) {
            clearTimeout(this.hideControlsTimeout);
            this.hideControlsTimeout = null;
        }
    }

    // 현재 전체화면 상태 반환
    getFullscreenState() {
        return this.isFullscreen;
    }

    // 정리
    destroy() {
        this._cancelHideControls();

        if (this.isFullscreen) {
            this.exitFullscreen();
        }
    }
}
