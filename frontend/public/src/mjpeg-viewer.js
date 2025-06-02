import { State, MessageType, ErrorMessages, InfoMessages, Direction, IPCCommands, StateNames, Config } from './config.js';
import { TimerUtils, CanvasUtils, FileUtils } from './utils.js';
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
        this.currentDirection = Direction.FORWARD;
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
            liveBtn: () => this._handleLive(),
            recordBtn: () => this._handleRecord(),
            playbackBtn: () => this._handlePlayback(),
            playBtn: () => this._handlePlay(Direction.FORWARD),
            reverseBtn: () => this._handlePlay(Direction.REVERSE),
            pauseBtn: () => this._handlePause(),
            rewindBtn: () => this._handleFrameControl('rewind'),
            fastForwardBtn: () => this._handleFrameControl('fastForward'),
            nextFrameBtn: () => this._handleStep(Direction.FORWARD),
            prevFrameBtn: () => this._handleStep(Direction.REVERSE),
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
            this._handleLiveFrame(filePath, 'path');
        });

        // 메인 프로세스에서 오는 프레임 바이너리 데이터 수신
        this.#electronAPI.on('frame-data', (binaryData) => {
            console.log('Received frame data:', binaryData.length, 'bytes');
            this._handleLiveFrame(binaryData, 'binary');
        });
    }

    // 라이브 프레임 처리 (통합)
    async _handleLiveFrame(data, type) {
        if (!this._isStreamingMode()) {
            return; // 라이브나 레코드 모드가 아니면 무시
        }

        try {
            let imageUrl;

            if (type === 'path') {
                // 타임스탬프를 추가해서 캐시 문제 해결
                const timestamp = new Date().getTime();
                imageUrl = `${data}?t=${timestamp}`;
            } else if (type === 'binary') {
                // ArrayBuffer를 Blob으로 변환
                const blob = new Blob([data], { type: 'image/jpeg' });
                imageUrl = URL.createObjectURL(blob);
            } else {
                throw new Error('Invalid frame data type');
            }

            // 이미지를 캔버스에 렌더링
            await this._renderLiveImageToCanvas(imageUrl);

            // binary 타입인 경우 메모리 누수 방지를 위해 Blob URL 해제
            if (type === 'binary') {
                URL.revokeObjectURL(imageUrl);
            }
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
            [State.LIVE]: () => this._switchFromLiveToRecord(),
            [State.RECORD]: () => this._stopRecordMode()
        };

        const handler = handlers[this.state];
        if (handler) {
            await handler();
        }
    }

    // 재생 버튼 핸들러
    async _handlePlayback() {
        if (this.state === State.PLAYBACK) {
            this._stopCurrentMode();
        } else {
            // IDLE 또는 LIVE 상태에서만 실행됨 (RECORD에서는 버튼이 비활성화됨)
            await this._startPlaybackMode();
        }
    }

    // 방향성 재생 핸들러
    async _handlePlay(direction) {
        if (this.state === State.PLAYBACK) {
            this._handlePlaybackDirection(direction);
        } else {
            // IDLE 또는 LIVE 상태에서만 실행됨 (RECORD에서는 재생 버튼들이 비활성화됨)
            const hasFrames = await FileUtils.hasRecordedFrames();
            if (!hasFrames) {
                this._showNoFramesWarning();
                return;
            }
            await this._startPlaybackMode(direction);
        }
    }

    // 재생 모드에서 방향 처리
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

    // 프레임 제어 핸들러
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

        // 시크할 때는 즉시 위치 변경
        this.uiController.updateProgress(this.frameManager.getProgress(), 'none');
        this._updateFrameDisplay();
    }

    // 스트리밍 모드 시작 (Live 또는 Record)
    async _startStreamingMode(targetState) {
        const stateName = StateNames[targetState] || 'Unknown';
        const ipcCommand = this._getIPCCommandForState(targetState, 'start');

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

    // Live 모드에서 Record 모드로 전환
    async _switchFromLiveToRecord() {
        try {
            console.log('[Live to Record] Switching from Live to Record mode');

            // 전환 중 상태로 설정하여 프레임 처리 중단
            this._setState(State.IDLE);

            this._emitToElectron(IPCCommands.STOP_LIVE);

            // 잠시 대기 (Live 모드 종료 완료를 위해)
            await this._delay(Config.TIMING.MODE_SWITCH_DELAY);

            await this._startStreamingMode(State.RECORD);
            console.log('[Live to Record] Successfully switched to Record mode');
        } catch (error) {
            this._handleError(error, 'Mode switch error');
        }
    }

    // 녹화 모드 중지 후 재생 모드로 전환
    async _stopRecordMode() {
        this._emitToElectron(IPCCommands.STOP_RECORD);
        await this._startPlaybackMode(Direction.FORWARD);
    }

    // 재생 모드 시작
    async _startPlaybackMode(direction = Direction.FORWARD) {
        try {
            // rec_info.json에서 FPS 값을 읽어서 설정
            const recordedFPS = await FileUtils.getRecordingFPS();
            this.uiController.setFPS(recordedFPS);
            console.log(`[Playback] Set FPS to ${recordedFPS} from rec_info.json`);

            const frameCount = await this._loadFramesWithProgress();

            if (frameCount === 0) {
                this._showNoFramesWarning();
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

        const command = this._getIPCCommandForState(this.state, 'stop');
        if (command) {
            this._emitToElectron(command);
        }

        this._resetToIdle();
    }

    // 재생 시작
    async _play(direction = Direction.FORWARD) {
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
            // 재생 모드에서는 부드러운 애니메이션 사용
            const animationType = this.state === State.PLAYBACK && this.playing ? 'smooth' : 'fast';
            this.uiController.updateProgress(this.frameManager.getProgress(), animationType);
        }

        const statusInfo = this.frameManager.getStatusInfo();
        this.uiController.updateStatus(statusInfo);
    }

    // 프레임 표시 업데이트
    async _updateFrameDisplay() {
        await this.frameManager.drawCurrentFrame(this.uiController.elements.viewer);
        this._updateUI();
    }

    // === 유틸리티 메서드들 ===

    // 스트리밍 모드 체크
    _isStreamingMode() {
        return this.state === State.LIVE || this.state === State.RECORD;
    }

    // 스트리밍을 위한 UI 리셋 (통합)
    _resetUIForStreaming() {
        this._pause();
        this.uiController.clearMessage();
        this.uiController.updateProgress(0, 'none');
    }

    // 재시작을 위한 리셋
    _resetForRestart() {
        this._resetUIForStreaming();
        this.uiController.clearCanvas();
        this.frameManager.clear();
    }

    // 초기 상태로 리셋
    _resetToIdle() {
        this.uiController.clearCanvas();
        this.frameManager.clear();
        this._setState(State.IDLE);
        this.uiController.clearMessage();
        this.uiController.updateProgress(0, 'none');
    }

    // 프레임이 없을 때 경고 표시
    _showNoFramesWarning() {
        this.uiController.setMessage(ErrorMessages.NO_RECORDED_FRAMES, MessageType.WARNING);
        this._resetToIdle();
    }

    // 상태에 따른 IPC 명령어 반환
    _getIPCCommandForState(state, action) {
        const commandMap = {
            [State.LIVE]: {
                start: IPCCommands.START_LIVE,
                stop: IPCCommands.STOP_LIVE
            },
            [State.RECORD]: {
                start: IPCCommands.START_RECORD,
                stop: IPCCommands.STOP_RECORD
            }
        };

        return commandMap[state]?.[action];
    }

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