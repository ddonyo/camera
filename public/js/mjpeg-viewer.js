import { State, MessageType, ErrorMessages, InfoMessages } from './config.js';
import { TimerUtils, CanvasUtils } from './utils.js';
import { FrameManager } from './frame-manager.js';
import { UIController } from './ui-controller.js';

// MJPEG 뷰어 메인 클래스
export class MJPEGViewer {
    // 상수 정의
    static #CONSTANTS = {
        DELAY_MS: {
            MODE_SWITCH: 200  // 100ms에서 200ms로 증가하여 안정성 향상
        },
        DIRECTION: {
            FORWARD: 1,
            REVERSE: -1
        },
        STATE_NAMES: {
            [State.LIVE]: 'Live',
            [State.RECORD]: 'Record'
        },
        IPC_COMMANDS: {
            START_LIVE: 'start-live',
            STOP_LIVE: 'stop-live',
            START_RECORD: 'start-record',
            STOP_RECORD: 'stop-record'
        }
    };

    constructor() {
        console.log('MJPEGViewer constructor started');

        this.frameManager = new FrameManager();
        this.uiController = new UIController();

        console.log('UI elements:', this.uiController.elements);

        this.state = State.IDLE;
        this.playing = false;
        this.currentDirection = MJPEGViewer.#CONSTANTS.DIRECTION.FORWARD;
        this.repeatMode = false;

        this._bindEvents();
        this._setupLiveIpcListeners();
        this._updateUI();

        console.log('MJPEGViewer constructor completed');
    }

    // ElectronAPI 접근 통일화
    get #electronAPI() {
        return window['electronAPI'];
    }

    // 이벤트 리스너 바인딩
    _bindEvents() {
        console.log('Binding events...');

        const buttonHandlers = this._createButtonHandlers();
        const elements = this.uiController.elements;

        // 필수 요소 검증
        if (!this._validateRequiredElements(elements)) {
            return;
        }

        // 이벤트 바인딩
        Object.entries(buttonHandlers).forEach(([elementKey, handler]) => {
            const element = elements[elementKey];
            if (element) {
                element.addEventListener('click', handler);
            }
        });

        console.log('Events bound successfully');
    }

    // 버튼 핸들러 생성
    _createButtonHandlers() {
        return {
            liveBtn: () => {
                console.log('Live button clicked');
                this._handleLive();
            },
            recordBtn: () => {
                console.log('Record button clicked');
                this._handleRecord();
            },
            playBtn: () => this._handlePlayback(MJPEGViewer.#CONSTANTS.DIRECTION.FORWARD),
            reverseBtn: () => this._handlePlayback(MJPEGViewer.#CONSTANTS.DIRECTION.REVERSE),
            pauseBtn: () => this._handlePause(),
            rewindBtn: () => this._handleFrameControl('rewind'),
            fastForwardBtn: () => this._handleFrameControl('fastForward'),
            nextFrameBtn: () => this._handleStep(MJPEGViewer.#CONSTANTS.DIRECTION.FORWARD),
            prevFrameBtn: () => this._handleStep(MJPEGViewer.#CONSTANTS.DIRECTION.REVERSE),
            repeatBtn: () => this._handleRepeat(),
            progressBar: (evt) => this._handleSeek(evt)
        };
    }

    // 필수 요소 검증
    _validateRequiredElements(elements) {
        const requiredElements = ['liveBtn', 'recordBtn'];

        for (const elementKey of requiredElements) {
            if (!elements[elementKey]) {
                console.error(`${elementKey} element not found!`);
                return false;
            }
        }
        return true;
    }

    // 라이브 모드를 위한 IPC 이벤트 리스너 설정
    _setupLiveIpcListeners() {
        if (!this.#electronAPI) {
            console.warn('electronAPI not available - running in browser mode');
            return;
        }

        // 메인 프로세스에서 오는 프레임 경로 수신
        this.#electronAPI.on('frame-path', (filePath) => {
            console.log('Received frame path:', filePath);
            this._handleLiveFrame(filePath);
        });
    }

    // 라이브 프레임 처리
    async _handleLiveFrame(filePath) {
        if (this.state !== State.LIVE && this.state !== State.RECORD) {
            return; // 라이브나 레코드 모드가 아니면 무시
        }

        try {
            console.log(`Received web path: ${filePath}`);

            // 타임스탬프를 추가해서 캐시 문제 해결
            const timestamp = new Date().getTime();
            const imageUrl = `${filePath}?t=${timestamp}`;

            // 이미지를 캔버스에 렌더링
            await this._renderLiveImageToCanvas(imageUrl);
        } catch (error) {
            console.error('Failed to handle live frame:', error);
        }
    }

    // 라이브 이미지를 캔버스에 렌더링
    async _renderLiveImageToCanvas(imageUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();

            img.onload = () => {
                try {
                    const canvas = this.uiController.elements.viewer;
                    CanvasUtils.drawImageToCanvas(canvas, img);
                    this._updateUI();
                    resolve();
                } catch (error) {
                    reject(error);
                }
            };

            img.onerror = (error) => {
                console.error('Failed to load live image:', imageUrl);
                reject(error);
            };

            img.src = imageUrl;
        });
    }

    // 라이브 버튼 핸들러
    async _handleLive() {
        if (this.state !== State.LIVE) {
            await this._startStreamingMode(State.LIVE);
        } else {
            this._stopCurrentMode();
        }
    }

    // 녹화 버튼 핸들러
    async _handleRecord() {
        const handlers = {
            [State.IDLE]: () => this._startStreamingMode(State.RECORD),
            [State.LIVE]: () => this._switchFromLiveToRecord(),
            [State.RECORD]: () => this._stopRecordMode(),
            [State.PLAYBACK]: () => this._restartRecordMode()
        };

        const handler = handlers[this.state];
        if (handler) {
            await handler();
        }
    }

    // 재생 버튼 핸들러 (통합)
    async _handlePlayback(direction) {
        if (this.state === State.PLAYBACK) {
            this._handlePlaybackDirection(direction);
        } else {
            await this._startPlaybackMode(direction);
        }
    }

    // 재생 모드에서 방향 처리 (통합)
    _handlePlaybackDirection(direction) {
        const isCurrentDirection = this.currentDirection === direction;

        if (this.playing && isCurrentDirection) {
            this._pause();
        } else if (this.playing && !isCurrentDirection) {
            this._changeDirection(direction);
        } else {
            this._initializePlaybackPosition(direction);
            this._play(direction);
        }
    }

    // 재생 위치 초기화
    _initializePlaybackPosition(direction) {
        const frameCount = this.frameManager.getFrameCount();

        if (direction > 0 && this.frameManager.currentIndex >= frameCount - 1) {
            this.frameManager.setCurrentIndex(0);
        } else if (direction < 0 && this.frameManager.currentIndex <= 0) {
            this.frameManager.setCurrentIndex(frameCount - 1);
        }
    }

    _handlePause() {
        this._pause();
    }

    // 프레임 제어 핸들러 (통합)
    _handleFrameControl(action) {
        this._pause();
        this.frameManager[action]();
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

    // 스트리밍 모드 시작 (Live 또는 Record) - 통합
    async _startStreamingMode(targetState) {
        const stateName = MJPEGViewer.#CONSTANTS.STATE_NAMES[targetState] || 'Unknown';
        const ipcCommand = targetState === State.LIVE ?
            MJPEGViewer.#CONSTANTS.IPC_COMMANDS.START_LIVE :
            MJPEGViewer.#CONSTANTS.IPC_COMMANDS.START_RECORD;

        try {
            this._resetUIForStreaming();
            console.log(`[${stateName}] Starting streaming mode`);

            this._emitToElectron(ipcCommand);
            this._setState(targetState);

            console.log(`[${stateName}] Streaming mode started`);
        } catch (error) {
            this._handleError(error, `${stateName} mode error`);
        }
    }

    // 스트리밍을 위한 UI 리셋
    _resetUIForStreaming() {
        this._pause();
        this.uiController.clearMessage();
        this.uiController.updateProgress(0);
    }

    // Live 모드에서 Record 모드로 전환
    async _switchFromLiveToRecord() {
        try {
            console.log('[Live to Record] Switching from Live to Record mode');

            // 현재 상태를 임시로 저장
            const previousState = this.state;

            // 전환 중 상태로 설정하여 프레임 처리 중단
            this._setState(State.IDLE);

            this._emitToElectron(MJPEGViewer.#CONSTANTS.IPC_COMMANDS.STOP_LIVE);

            // 잠시 대기 (Live 모드 종료 완료를 위해)
            await this._delay(MJPEGViewer.#CONSTANTS.DELAY_MS.MODE_SWITCH);

            await this._startStreamingMode(State.RECORD);
            console.log('[Live to Record] Successfully switched to Record mode');
        } catch (error) {
            this._handleError(error, 'Mode switch error');
        }
    }

    // 녹화 모드 중지 후 재생 모드로 전환
    async _stopRecordMode() {
        this._emitToElectron(MJPEGViewer.#CONSTANTS.IPC_COMMANDS.STOP_RECORD);
        await this._startPlaybackMode(MJPEGViewer.#CONSTANTS.DIRECTION.FORWARD);
    }

    // 녹화 모드 재시작
    async _restartRecordMode() {
        try {
            this._resetForRestart();
            await this._startStreamingMode(State.RECORD);
            console.log('[Record Restart] Record mode restarted');
        } catch (error) {
            this._handleError(error, 'Record restart error');
        }
    }

    // 재시작을 위한 리셋
    _resetForRestart() {
        this._pause();
        this.uiController.clearCanvas();
        this.frameManager.clear();
        this.uiController.updateProgress(0);
    }

    // 재생 모드 시작
    async _startPlaybackMode(direction = MJPEGViewer.#CONSTANTS.DIRECTION.FORWARD) {
        try {
            const frameCount = await this._loadFramesWithProgress();

            if (frameCount === 0) {
                this.uiController.setMessage(ErrorMessages.NO_RECORDED_FRAMES, MessageType.WARNING);
                this._updateUI();
                return;
            }

            this._initializePlaybackPosition(direction);
            this._setState(State.PLAYBACK);
            this._play(direction);
        } catch (error) {
            this._handleError(error, ErrorMessages.LOAD_RECORDED_FRAMES_FAILED);
        }
    }

    // 프레임 로딩 및 진행률 표시
    async _loadFramesWithProgress() {
        return await this.frameManager.loadAllRecordFrames(
            (message) => {
                if (message) {
                    this.uiController.setMessage(message, MessageType.LOADING, false);
                } else {
                    this.uiController.clearMessage();
                }
                this._updateUI();
            }
        );
    }

    // 현재 모드 중지
    _stopCurrentMode() {
        this._pause();

        const stopCommands = {
            [State.LIVE]: MJPEGViewer.#CONSTANTS.IPC_COMMANDS.STOP_LIVE,
            [State.RECORD]: MJPEGViewer.#CONSTANTS.IPC_COMMANDS.STOP_RECORD
        };

        const command = stopCommands[this.state];
        if (command) {
            this._emitToElectron(command);
        }

        this._resetToIdle();
    }

    // 재생 시작
    async _play(direction = MJPEGViewer.#CONSTANTS.DIRECTION.FORWARD) {
        if (this.playing) {
            console.warn(ErrorMessages.ALREADY_PLAYING);
            return;
        }

        this.playing = true;
        this.currentDirection = direction;
        this._updateUI();

        try {
            await this._executePlayLoop();
        } catch (error) {
            this._handlePlayError(error);
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
                this._handlePlayError(error);
                break;
            }
        }
    }

    // 재생 에러 처리
    _handlePlayError(error) {
        console.error('Play loop error:', error);
        this.uiController.setMessage(error.message, MessageType.ERROR, false);
        this._updateUI();
        this._pause();
        this._setState(State.IDLE);
    }

    // 프레임 처리
    async _processFrame(direction) {
        if (this.state === State.RECORD) {
            // Record 모드에서는 프레임 처리가 필요 없음 (Live와 동일하게 IPC로 처리)
            return;
        } else if (this.state === State.PLAYBACK) {
            this._processPlaybackFrame(direction);
        }

        await this._updateFrameDisplay();
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

    // 상태 변경 및 UI 업데이트
    _setState(newState) {
        this.state = newState;
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

    // 유틸리티 메서드들
    _emitToElectron(command, data = null) {
        if (this.#electronAPI?.emit) {
            this.#electronAPI.emit(command, data);
        }
    }

    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    _handleError(error, message) {
        console.error(`${message}:`, error);
        this.uiController.setMessage(`${message}: ${error.message}`, MessageType.ERROR);
        this._resetToIdle();
    }

    // 리소스 정리
    destroy() {
        this._pause();
        this.uiController.destroy();
        this.frameManager.clear();
        console.log('MJPEGViewer destroyed');
    }
}