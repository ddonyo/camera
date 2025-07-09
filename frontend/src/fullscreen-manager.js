// 전체화면 모드 관리 클래스
export class FullscreenManager {
    constructor() {
        this.isFullscreen = false;
        this.hideControlsTimeout = null;
        this.mouseMoveTimeout = null;
        this.mainContainer = null;
        this.fullscreenBtn = null;

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
        this.fullscreenBtn = document.getElementById('fullscreenBtn');

        if (this.fullscreenBtn) {
            this.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
            console.log('Fullscreen button event listener attached');
        } else {
            console.warn('Fullscreen button not found');
        }


        // 키보드 이벤트 등록 (즉시 등록)
        this._bindKeyboardEvents();

        // 마우스 이벤트 등록 (즉시 등록)
        this._bindMouseEvents();
    }

    // 키보드 이벤트 바인딩
    _bindKeyboardEvents() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'F11') {
                e.preventDefault();
                this.toggleFullscreen();
            } else if (e.key === 'Escape' && this.isFullscreen) {
                e.preventDefault();
                this.exitFullscreen();
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
        document.addEventListener('mouseenter', (e) => {
            if (this.isFullscreen && e.target.closest('.control-area, .progress-bar')) {
                this._cancelHideControls();
            }
        }, true);

        document.addEventListener('mouseleave', (e) => {
            if (this.isFullscreen && e.target.closest('.control-area, .progress-bar')) {
                this._scheduleHideControls();
            }
        }, true);
    }

    // 전체화면 모드 토글
    async toggleFullscreen() {
        if (this.isFullscreen) {
            await this.exitFullscreen();
        } else {
            await this.enterFullscreen();
        }
    }

    // 전체화면 모드 진입
    async enterFullscreen() {
        if (this.isFullscreen || !this.mainContainer) return;

        console.log('Entering fullscreen mode...');

        try {
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
                this.isFullscreen = true;

                // 버튼 상태 업데이트
                if (this.fullscreenBtn) {
                    this.fullscreenBtn.classList.add('active');
                }

                // 컨트롤 자동 숨김 시작
                this._scheduleHideControls();

                console.log('Fullscreen mode activated');
            }, 300);

        } catch (error) {
            console.error('Failed to enter fullscreen:', error);
        }
    }

    // 전체화면 모드 종료
    async exitFullscreen() {
        if (!this.isFullscreen || !this.mainContainer) return;

        console.log('Exiting fullscreen mode...');

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
                this.isFullscreen = false;

                // 버튼 상태 업데이트
                if (this.fullscreenBtn) {
                    this.fullscreenBtn.classList.remove('active');
                }

                console.log('Fullscreen mode deactivated');
            }, 300);

            // Electron 창 전체화면 해제
            if (this.#electronAPI) {
                await this.#electronAPI.setFullscreen(false);
            }

        } catch (error) {
            console.error('Failed to exit fullscreen:', error);
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
