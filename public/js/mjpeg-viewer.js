import { State, MessageType, ErrorMessages, InfoMessages } from './config.js';
import { TimerUtils } from './utils.js';
import { FrameManager } from './frame-manager.js';
import { UIController } from './ui-controller.js';

// MJPEG 뷰어 메인 클래스
export class MJPEGViewer {
    constructor() {
        console.log('MJPEGViewer constructor started');

        this.frameManager = new FrameManager();
        this.uiController = new UIController();

        console.log('UI elements:', this.uiController.elements);

        this.state = State.IDLE;
        this.playing = false;
        this.currentDirection = 1;
        this.repeatMode = false;
        this.nativeLibraryAvailable = false;

        this._checkNativeLibrary();
        this._bindEvents();
        this._updateUI();

        console.log('MJPEGViewer constructor completed');
    }

    // 네이티브 라이브러리 상태 확인
    async _checkNativeLibrary() {
        if (window.electronAPI && window.electronAPI.checkNativeLibrary) {
            try {
                const result = await window.electronAPI.checkNativeLibrary();
                this.nativeLibraryAvailable = result.available;

                if (!this.nativeLibraryAvailable) {
                    console.warn('[Native] Library not available');
                    this.uiController.setMessage(InfoMessages.NATIVE_LIBRARY_UNAVAILABLE, MessageType.WARNING, false);
                }
            } catch (error) {
                console.error('[Native] Failed to check library status:', error);
                this.nativeLibraryAvailable = false;
            }
        } else {
            console.log('[Native] Running in browser mode - native library not required');
            this.nativeLibraryAvailable = false;
        }
    }

    // 이벤트 리스너 바인딩
    _bindEvents() {
        console.log('Binding events...');
        const elements = this.uiController.elements;

        console.log('liveBtn:', elements.liveBtn);
        console.log('recordBtn:', elements.recordBtn);

        if (!elements.liveBtn) {
            console.error('liveBtn element not found!');
            return;
        }

        if (!elements.recordBtn) {
            console.error('recordBtn element not found!');
            return;
        }

        elements.liveBtn.addEventListener('click', () => {
            console.log('Live button clicked');
            this._handleLive();
        });
        elements.recordBtn.addEventListener('click', () => {
            console.log('Record button clicked');
            this._handleRecord();
        });

        elements.playBtn.addEventListener('click', () => this._handlePlay());
        elements.reverseBtn.addEventListener('click', () => this._handleReverse());
        elements.pauseBtn.addEventListener('click', () => this._handlePause());

        elements.rewindBtn.addEventListener('click', () => this._handleRewind());
        elements.fastForwardBtn.addEventListener('click', () => this._handleFastForward());
        elements.nextFrameBtn.addEventListener('click', () => this._handleStep(1));
        elements.prevFrameBtn.addEventListener('click', () => this._handleStep(-1));

        elements.repeatBtn.addEventListener('click', () => this._handleRepeat());
        elements.progressBar.addEventListener('click', (evt) => this._handleSeek(evt));

        console.log('Events bound successfully');
    }

    // 라이브 버튼 핸들러
    async _handleLive() {
        if (this.state !== State.LIVE) {
            await this._startLiveMode();
        } else {
            this._stopCurrentMode();
            console.log('Live mode stopped');
        }
    }

    // 녹화 버튼 핸들러
    async _handleRecord() {
        if (this.state === State.IDLE) {
            await this._startRecordMode();
        } else if (this.state === State.RECORD) {
            await this._stopRecordMode();
        } else if (this.state === State.PLAYBACK) {
            await this._restartRecordMode();
        }
    }

    // 재생 버튼 핸들러
    async _handlePlay() {
        if (this.state === State.PLAYBACK) {
            this._handlePlaybackPlay();
        } else {
            await this._startPlaybackMode(1);
        }
    }

    // 역재생 버튼 핸들러
    async _handleReverse() {
        if (this.state === State.PLAYBACK) {
            this._handlePlaybackReverse();
        } else {
            await this._startPlaybackMode(-1);
        }
    }

    _handlePause() {
        this._pause();
    }

    // 되감기 핸들러
    _handleRewind() {
        this._pause();
        this.frameManager.rewind();
        this._updateFrameDisplay();
    }

    // 빨리감기 핸들러
    _handleFastForward() {
        this._pause();
        this.frameManager.fastForward();
        this._updateFrameDisplay();
    }

    // 프레임 스텝 핸들러
    _handleStep(direction) {
        this._pause();
        this.frameManager.stepFrame(direction, true);
        this._updateFrameDisplay();
    }

    // 반복 모드 토글
    _handleRepeat() {
        this.repeatMode = !this.repeatMode;
        this._updateUI();
    }

    // 프로그레스 바 시크
    _handleSeek(event) {
        if (this.frameManager.getFrameCount() === 0) return;

        const position = this.uiController.getProgressBarClickPosition(event);
        this.frameManager.seekToPosition(position);
        this._updateFrameDisplay();
    }

    // 라이브 모드 시작
    async _startLiveMode() {
        try {
            this._pause();
            this.uiController.clearMessage();
            this.uiController.updateProgress(0);

            // 네이티브 라이브 함수 호출 (Electron 환경에서만)
            if (window.electronAPI) {
                // 네이티브 라이브러리 상태 확인
                if (!this.nativeLibraryAvailable) {
                    this.uiController.setMessage(ErrorMessages.NATIVE_LIBRARY_NOT_AVAILABLE, MessageType.ERROR);
                    return;
                }

                console.log('[Live] Calling native run_live function...');
                const result = await window.electronAPI.startLive();
                if (result.success) {
                    console.log(`[Live] Native function returned: ${result.result}`);
                    const appliedFPS = this.uiController.setFPS(result.result);
                    console.log(`[Live] FPS applied: ${appliedFPS}`);
                } else {
                    console.error(`[Live] Native function failed: ${result.error}`);
                    this.uiController.setMessage(`${ErrorMessages.NATIVE_FUNCTION_FAILED}: ${result.error}`, MessageType.ERROR);
                    return;
                }
            } else {
                // 웹 브라우저 환경: 기본 FPS 사용
                console.log('[Live] Running in browser mode - using default FPS');
                const appliedFPS = this.uiController.setFPS(30);
                console.log(`[Live] Default FPS applied: ${appliedFPS}`);
            }

            this._setState(State.LIVE);
            this._play(1);
        } catch (error) {
            console.error('[Live] Error starting live mode:', error);
            this.uiController.setMessage(`Live mode error: ${error.message}`, MessageType.ERROR);
            this._resetToIdle();
        }
    }

    // 녹화 모드 시작
    async _startRecordMode() {
        try {
            this.uiController.clearMessage();
            this.uiController.updateProgress(0);
            this.frameManager.recordFrameIndex = -1;

            // 네이티브 녹화 함수 호출 (Electron 환경에서만)
            if (window.electronAPI) {
                // 네이티브 라이브러리 상태 확인
                if (!this.nativeLibraryAvailable) {
                    this.uiController.setMessage(ErrorMessages.NATIVE_LIBRARY_NOT_AVAILABLE, MessageType.ERROR);
                    return;
                }

                console.log('[Record] Calling native run_rec function...');
                const result = await window.electronAPI.startRecord();
                if (result.success) {
                    console.log(`[Record] Native function returned: ${result.result}`);
                    const appliedFPS = this.uiController.setFPS(result.result);
                    console.log(`[Record] FPS applied: ${appliedFPS}`);
                } else {
                    console.error(`[Record] Native function failed: ${result.error}`);
                    this.uiController.setMessage(`${ErrorMessages.NATIVE_FUNCTION_FAILED}: ${result.error}`, MessageType.ERROR);
                    return;
                }
            } else {
                // 웹 브라우저 환경: 기본 FPS 사용
                console.log('[Record] Running in browser mode - using default FPS');
                const appliedFPS = this.uiController.setFPS(30);
                console.log(`[Record] Default FPS applied: ${appliedFPS}`);
            }

            this._setState(State.RECORD);
            this._play(1);
        } catch (error) {
            console.error('[Record] Error starting record mode:', error);
            this.uiController.setMessage(`Record mode error: ${error.message}`, MessageType.ERROR);
            this._resetToIdle();
        }
    }

    // 녹화 모드 중지 후 재생 모드로 전환
    async _stopRecordMode() {
        this._pause();
        await this._startPlaybackMode(1);
        this.uiController.clearMessage();
    }

    // 녹화 모드 재시작
    async _restartRecordMode() {
        try {
            this._pause();
            this.uiController.clearCanvas();
            this.frameManager.clear();
            this.uiController.updateProgress(0);
            this.frameManager.recordFrameIndex = -1;

            // 네이티브 녹화 함수 호출 (Electron 환경에서만)
            if (window.electronAPI) {
                // 네이티브 라이브러리 상태 확인
                if (!this.nativeLibraryAvailable) {
                    this.uiController.setMessage(ErrorMessages.NATIVE_LIBRARY_NOT_AVAILABLE, MessageType.ERROR);
                    return;
                }

                console.log('[Record Restart] Calling native run_rec function...');
                const result = await window.electronAPI.startRecord();
                if (result.success) {
                    console.log(`[Record Restart] Native function returned: ${result.result}`);
                    const appliedFPS = this.uiController.setFPS(result.result);
                    console.log(`[Record Restart] FPS applied: ${appliedFPS}`);
                } else {
                    console.error(`[Record Restart] Native function failed: ${result.error}`);
                    this.uiController.setMessage(`${ErrorMessages.NATIVE_FUNCTION_FAILED}: ${result.error}`, MessageType.ERROR);
                    return;
                }
            } else {
                // 웹 브라우저 환경: 기본 FPS 사용
                console.log('[Record Restart] Running in browser mode - using default FPS');
                const appliedFPS = this.uiController.setFPS(30);
                console.log(`[Record Restart] Default FPS applied: ${appliedFPS}`);
            }

            this._setState(State.RECORD);
            this._play(1);
        } catch (error) {
            console.error('[Record Restart] Error:', error);
            this.uiController.setMessage(`Record restart error: ${error.message}`, MessageType.ERROR);
            this._resetToIdle();
        }
    }

    // 재생 모드 시작
    async _startPlaybackMode(direction = 1) {
        try {
            const frameCount = await this.frameManager.loadAllRecordFrames(
                (message) => {
                    if (message) {
                        this.uiController.setMessage(message, MessageType.LOADING, false);
                    } else {
                        this.uiController.clearMessage();
                    }
                    this._updateUI();
                }
            );

            if (frameCount === 0) {
                this.uiController.setMessage(ErrorMessages.NO_RECORDED_FRAMES, MessageType.WARNING);
                this._updateUI();
                return;
            }

            if (direction > 0 && this.frameManager.currentIndex >= frameCount - 1) {
                this.frameManager.setCurrentIndex(0);
            } else if (direction < 0 && this.frameManager.currentIndex <= 0) {
                this.frameManager.setCurrentIndex(frameCount - 1);
            }

            this._setState(State.PLAYBACK);
            this._play(direction);
        } catch (error) {
            this.uiController.setMessage(ErrorMessages.LOAD_RECORDED_FRAMES_FAILED, MessageType.ERROR);
            this._updateUI();
            console.error('Playback loading error:', error);
        }
    }

    // 현재 모드 중지
    _stopCurrentMode() {
        this._pause();
        this._resetToIdle();
    }

    // 재생 시작
    async _play(direction = 1) {
        if (this.playing) {
            console.warn(ErrorMessages.ALREADY_PLAYING);
            return;
        }

        this.playing = true;
        this.currentDirection = direction;
        this._updateUI();

        if (this.state === State.LIVE || this.state === State.RECORD) {
            this.uiController.clearMessage();
        }

        try {
            await this._executePlayLoop();
        } catch (error) {
            console.error('Play loop error:', error);
            this.uiController.setMessage(error.message, MessageType.ERROR, false);
            this._updateUI();
            this._pause();
            this._setState(State.IDLE);
        } finally {
            this.uiController.clearMessage();
            this._updateUI();
        }
    }

    // 재생 루프 실행
    async _executePlayLoop() {
        while (this.playing) {
            try {
                await this._processFrame(this.currentDirection);
                await TimerUtils.waitForNextFrame(this.uiController.getFPS());
            } catch (error) {
                this.uiController.setMessage(error.message, MessageType.ERROR, false);
                this._updateUI();
                this._pause();
                this._setState(State.IDLE);
                break;
            }
        }
    }

    // 프레임 처리
    async _processFrame(direction) {
        if (this.state === State.LIVE || this.state === State.RECORD) {
            await this._processLiveOrRecordFrame(direction);
        } else if (this.state === State.PLAYBACK) {
            this._processPlaybackFrame(direction);
        }

        await this._updateFrameDisplay();
    }

    // 라이브/녹화 모드 프레임 처리
    async _processLiveOrRecordFrame(direction) {
        if (this.state === State.LIVE) {
            await this.frameManager.loadNextFrame(State.LIVE);
        } else if (this.state === State.RECORD) {
            const nextFrameIndex = (this.frameManager.recordFrameIndex ?? -1) + direction;

            if (nextFrameIndex < 0) {
                this.playing = false;
                return;
            }

            try {
                await this.frameManager.loadNextFrame(State.RECORD, nextFrameIndex);
            } catch (error) {
                // 녹화 모드에서 더 이상 로드할 프레임이 없으면 자동으로 플레이백 모드로 전환
                console.log('[Record] No more frames to load, switching to playback mode');
                this.playing = false;

                // 녹화 모드 중지 후 재생 모드로 전환 (녹화 버튼을 다시 누른 것과 동일한 동작)
                await this._stopRecordMode();
                return;
            }
        }
    }

    // 재생 모드 프레임 처리
    _processPlaybackFrame(direction) {
        const result = this.frameManager.updatePlaybackIndex(direction, this.repeatMode);

        if (result.shouldStop) {
            this.playing = false;
            this._updateUI();
        }
    }

    // 재생 일시정지
    _pause() {
        this.playing = false;
        if (this.state === State.PLAYBACK) {
            this._updateUI();
        }
    }

    // 재생 방향 변경
    _changeDirection(newDirection) {
        if (this.playing) {
            this.currentDirection = newDirection;
            if (this.state === State.PLAYBACK) {
                this._updateUI();
            }
        }
    }

    // 재생 모드에서 재생 버튼 처리
    _handlePlaybackPlay() {
        if (this.playing && this.currentDirection === 1) {
            this._pause();
        } else if (this.playing && this.currentDirection === -1) {
            this._changeDirection(1);
        } else {
            if (this.frameManager.currentIndex >= this.frameManager.getFrameCount() - 1) {
                this.frameManager.setCurrentIndex(0);
            }
            this._play(1);
        }
    }

    // 재생 모드에서 역재생 버튼 처리
    _handlePlaybackReverse() {
        if (this.playing && this.currentDirection === -1) {
            this._pause();
        } else if (this.playing && this.currentDirection === 1) {
            this._changeDirection(-1);
        } else {
            if (this.frameManager.currentIndex <= 0) {
                this.frameManager.setCurrentIndex(this.frameManager.getFrameCount() - 1);
            }
            this._play(-1);
        }
    }

    // 상태 변경 및 UI 업데이트
    _setState(newState) {
        const previousState = this.state;
        this.state = newState;

        // 카메라 중지가 필요한 상태 변경 감지
        const shouldStopCamera =
            (previousState === State.LIVE && newState === State.IDLE) ||
            (previousState === State.RECORD && newState !== State.RECORD);

        if (shouldStopCamera && window.electronAPI) {
            window.electronAPI.stopCamera().then(result => {
                if (result.success) {
                    console.log(`[Camera] Stopped successfully on ${previousState.toString()} → ${newState.toString()}`);
                } else {
                    console.error('[Camera] Stop failed on state change:', result.error);
                }
            }).catch(error => {
                console.error('[Camera] Stop error on state change:', error);
            });
        }

        this._updateUI();
    }

    // UI 상태 업데이트
    _updateUI() {
        const hasFrames = this.frameManager.getFrameCount() > 0;

        this.uiController.applyState(
            this.state,
            this.playing,
            this.currentDirection,
            this.repeatMode,
            hasFrames
        );

        if (this.state === State.PLAYBACK || this.state === State.IDLE) {
            this.uiController.updateProgress(this.frameManager.getProgress());
        }

        const statusInfo = this.frameManager.getStatusInfo();
        this.uiController.updateStatus(statusInfo);
    }

    // 프레임 표시 업데이트
    async _updateFrameDisplay() {
        await this.frameManager.drawCurrentFrame(this.uiController.elements.viewer);
        this._updateUI();
    }

    // 초기 상태로 리셋
    _resetToIdle() {
        this.uiController.clearCanvas();
        this.frameManager.clear();
        this._setState(State.IDLE);
        this.uiController.clearMessage();
        this.uiController.updateProgress(0);
    }

    // 리소스 정리
    destroy() {
        this._pause();
        this.uiController.destroy();
        this.frameManager.clear();
        console.log('MJPEGViewer destroyed');
    }
}