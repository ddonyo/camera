import { State, MessageType, ErrorMessages, InfoMessages, Direction, IPCCommands, StateNames, Config } from './config.js';
import { TimerUtils, CanvasUtils, FileUtils } from './utils.js';
import { FrameManager } from './frame-manager.js';
import { UIController } from './ui-controller.js';

// MJPEG 뷰어 메인 로직 클래스
export class MJPEGViewer {
    constructor() {
        console.log('MJPEGViewer constructor started');

        this.frameManager = new FrameManager(); // 프레임 관리자
        this.uiController = new UIController(); // UI 컨트롤러

        console.log('UI elements:', this.uiController.elements);

        this.state = State.IDLE; // 현재 상태
        this.playing = false; // 재생 상태 (PLAYBACK 모드)
        this.currentDirection = Direction.FORWARD; // 재생 방향
        this.repeatMode = false; // 반복 재생
        this._uiUpdateScheduled = false; // UI 업데이트 스케줄링 플래그
        this.liveFrameCount = 0; // 라이브 프레임 카운터
        this.originalFPS = null; // 파일에서 읽어온 원본 FPS

        this._bindEvents(); // 이벤트 바인딩
        this._setupLiveIpcListeners(); // IPC 리스너 (라이브)
        this._updateUI(); // UI 업데이트

        console.log('MJPEGViewer constructor completed');
    }

    // Electron API 접근
    get #electronAPI() {
        return window['electronAPI'];
    }

    // UI 이벤트 리스너 바인딩
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

    // 버튼 핸들러 맵 생성
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

    // 필수 UI 요소 검증
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

    // 라이브 스트리밍 IPC 리스너 설정
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

    // 라이브 프레임 처리 (경로 또는 바이너리)
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

    // 라이브 이미지 캔버스 렌더링
    async _renderLiveImageToCanvas(imageUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();

            img.onload = () => {
                try {
                    const canvas = this.uiController.elements.viewer;
                    CanvasUtils.drawImageToCanvas(canvas, img);
                    this.liveFrameCount++; // 프레임 카운터 증가
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

    // Live 버튼 이벤트 핸들러
    async _handleLive() {
        if (this.state === State.LIVE) {
            // Live 모드에서 Live 버튼 재클릭 = 스트리밍 완전 중지
            this._stopCurrentMode();
        } else {
            // IDLE 상태에서 Live 버튼 클릭 = 스트리밍 시작
            await this._startLiveMode();
        }
    }

    // Record 버튼 이벤트 핸들러
    async _handleRecord() {
        if (this.state === State.LIVE) {
            // Live 모드에서 Record 버튼 클릭 = 녹화 시작 (무중단 전환)
            await this._switchFromLiveToRecord();
        } else if (this.state === State.RECORD) {
            // Record 모드에서 Record 버튼 재클릭 = 녹화 중지 후 재생 모드로 전환
            await this._stopRecordMode();
        }
        // IDLE 상태에서는 Record 버튼이 비활성화되어 있으므로 처리하지 않음
    }

    // Live 모드 시작 (스트리밍)
    async _startLiveMode() {
        try {
            console.log('[Live] Starting live mode');
            this._resetUIForStreaming();

            // UI에서 Delay 가져와서 전송
            const delay = this.uiController.getDelay();
            const options = { delay };

            console.log(`[Live] Starting with options: delay=${delay}`);
            this._emitToElectron(IPCCommands.START_STREAMING, options);
            this._setState(State.LIVE);

            console.log('[Live] Live mode started successfully');
        } catch (error) {
            this._handleError(error, 'Live mode error');
        }
    }

    // Live에서 Record로 전환 (무중단)
    async _switchFromLiveToRecord() {
        try {
            console.log('[Live to Record] Enabling recording without interruption');

            // UI 상태를 즉시 업데이트하여 반응성 향상
            this._setState(State.RECORD);
            this.liveFrameCount = 0; // Record 모드 카운터 리셋

            // 백그라운드에서 녹화 시작 명령 전송
            this._emitToElectron(IPCCommands.START_RECORDING);

            console.log('[Live to Record] Successfully enabled recording');
        } catch (error) {
            this._handleError(error, 'Mode switch error');
        }
    }

    // Record 모드 중지 및 Playback 전환 준비
    async _stopRecordMode() {
        try {
            console.log('[Record] Stopping record mode and switching to playback');

            this._emitToElectron(IPCCommands.STOP_RECORDING);
            this._emitToElectron(IPCCommands.STOP_STREAMING);

            await this._startPlaybackMode(Direction.FORWARD);
        } catch (error) {
            this._handleError(error, 'Record stop error');
        }
    }

    // Playback 버튼 이벤트 핸들러
    async _handlePlayback() {
        if (this.state === State.PLAYBACK) {
            this._stopCurrentMode();
        } else {
            // IDLE 또는 LIVE 상태에서만 실행됨 (RECORD에서는 버튼이 비활성화됨)
            await this._startPlaybackMode();
        }
    }

    // Play/Reverse 버튼 이벤트 핸들러
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

    // Playback 모드 재생 방향 처리
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

    // Playback 모드 재생 위치 초기화
    _initializePlaybackPosition(direction) {
        const frameCount = this.frameManager.getFrameCount();

        if (direction > 0 && this.frameManager.currentIndex >= frameCount - 1) {
            this.frameManager.setCurrentIndex(0);
        } else if (direction < 0 && this.frameManager.currentIndex <= 0) {
            this.frameManager.setCurrentIndex(frameCount - 1);
        }
    }

    // Pause 버튼 이벤트 핸들러
    _handlePause() {
        this._pause();
    }

    // 프레임 제어(Rewind/FastForward) 버튼 이벤트 핸들러
    _handleFrameControl(action) {
        this._pause();
        this.frameManager[action]();
        this._updateFrameDisplay();
    }

    // 프레임 이동(Next/Prev) 버튼 이벤트 핸들러
    _handleStep(direction) {
        this._pause();
        this.frameManager.stepFrame(direction, true);
        this._updateFrameDisplay();
    }

    // Repeat 버튼 이벤트 핸들러
    _handleRepeat() {
        this.repeatMode = !this.repeatMode;
        this._updateUI();
    }

    // 프로그레스 바 탐색(Seek) 이벤트 핸들러
    _handleSeek(event) {
        if (this.frameManager.getFrameCount() === 0) return;

        const position = this.uiController.getProgressBarClickPosition(event);
        this.frameManager.seekToPosition(position);

        // 시크할 때는 즉시 위치 변경
        this.uiController.updateProgress(this.frameManager.getProgress(), 'none');
        this._updateFrameDisplay();
    }

    // Playback 모드 시작 및 프레임 재생 준비
    async _startPlaybackMode(direction = Direction.FORWARD) {
        try {
            // rec_info.json에서 FPS 값을 읽어서 설정
            const recordedFPS = await FileUtils.getRecordingFPS();
            this.originalFPS = recordedFPS;

            // Speed 기본값으로 설정
            this.uiController.setSpeed(Config.SPEED.DEFAULT);
            console.log(`[Playback] Set original FPS to ${recordedFPS} from rec_info.json`);

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

    // 녹화 프레임 로드 (UI 진행 표시)
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

    // 현재 프레임 처리 (방향 기반)
    async _processFrame(direction) {
        if (this.state === State.RECORD) {
            // Record 모드에서는 프레임 처리가 필요 없음 (Live와 동일하게 IPC로 처리)
            return;
        } else if (this.state === State.PLAYBACK) {
            this._processPlaybackFrame(direction);
        }

        await this._updateFrameDisplay();
    }

    // Playback 모드 프레임 처리
    _processPlaybackFrame(direction) {
        const result = this.frameManager.updatePlaybackIndex(direction, this.repeatMode);

        if (result.shouldStop) {
            this.playing = false;
            this._updateUI();
        }
    }

    // 재생 일시 중지
    _pause() {
        this.playing = false;
        if (this.state === State.PLAYBACK) {
            this._updateUI();
        }
    }

    // Playback 모드 재생 방향 변경
    _changeDirection(newDirection) {
        if (this.playing) {
            this.currentDirection = newDirection;
            if (this.state === State.PLAYBACK) {
                this._updateUI();
            }
        }
    }

    // 애플리케이션 상태 변경 및 UI 업데이트
    _setState(newState) {
        this.state = newState;
        this._updateUI();
    }

    // UI 업데이트 (상태 기반)
    _updateUI() {
        // requestAnimationFrame을 사용하여 UI 업데이트 최적화
        if (this._uiUpdateScheduled) return;

        this._uiUpdateScheduled = true;
        requestAnimationFrame(() => {
            this._uiUpdateScheduled = false;
            this._performUIUpdate();
        });
    }

    // 실제 UI 업데이트 수행
    _performUIUpdate() {
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

        let statusInfo;
        if (this.state === State.LIVE || this.state === State.RECORD) {
            statusInfo = {
                path: `${this.state === State.LIVE ? 'Live Streaming' : 'Recording'}`,
                name: '',
                frame: `${this.liveFrameCount}`
            };
        } else {
            statusInfo = this.frameManager.getStatusInfo();
        }

        this.uiController.updateStatus(statusInfo);
    }

    // 현재 프레임 표시 및 UI 업데이트
    async _updateFrameDisplay() {
        await this.frameManager.drawCurrentFrame(this.uiController.elements.viewer);
        this._updateUI();
    }

    // 스트리밍 모드 (Live/Record) 확인
    _isStreamingMode() {
        return this.state === State.LIVE || this.state === State.RECORD;
    }

    // 스트리밍 UI 초기화
    _resetUIForStreaming() {
        this._pause();
        this.uiController.clearMessage();
        this.uiController.updateProgress(0, 'none');
        this.liveFrameCount = 0;
    }

    // 재시작을 위한 내부 상태 초기화
    _resetForRestart() {
        this._resetUIForStreaming();
        this.uiController.clearCanvas();
        this.frameManager.clear();
    }

    // IDLE 상태로 초기화 및 UI 정리
    _resetToIdle() {
        this.uiController.clearCanvas();
        this.frameManager.clear();
        this._setState(State.IDLE);
        this.uiController.clearMessage();
        this.uiController.updateProgress(0, 'none');
    }

    // 녹화 프레임 없음 경고 표시
    _showNoFramesWarning() {
        this.uiController.setMessage(ErrorMessages.NO_RECORDED_FRAMES, MessageType.WARNING);
        this._resetToIdle();
    }

    // Electron 메인 프로세스 IPC 메시지 전송
    _emitToElectron(command, data = null) {
        if (this.#electronAPI?.emit) {
            this.#electronAPI.emit(command, data);
        }
    }

    // 시간 지연 유틸리티
    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // 오류 처리 및 메시지 표시
    _handleError(error, message) {
        console.error(`${message}:`, error);
        this.uiController.setMessage(`${message}: ${error.message}`, MessageType.ERROR);
        this._resetToIdle();
    }

    // MJPEGViewer 인스턴스 소멸 시 정리
    destroy() {
        this._pause();
        this.uiController.destroy();
        this.frameManager.clear();
        console.log('MJPEGViewer destroyed');
    }

    // 현재 모드 중지 및 IDLE 전환
    _stopCurrentMode() {
        this._pause();

        if (this._isStreamingMode()) {
            this._emitToElectron(IPCCommands.STOP_STREAMING);
        }

        this._resetToIdle();
    }

    // Playback 모드 재생 시작/재개
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

    // 원본 FPS에 Speed를 곱한 실제 FPS 계산
    _getEffectiveFPS() {
        if (!this.originalFPS) {
            return Config.FPS.DEFAULT;
        }
        const speed = this.uiController.getSpeed();
        return this.originalFPS * speed;
    }

    // Playback 모드 프레임 재생 루프
    async _executePlayLoop() {
        while (this.playing) {
            try {
                await this._processFrame(this.currentDirection);
                await TimerUtils.waitForNextFrame(this._getEffectiveFPS());
            } catch (error) {
                this._handlePlayError(error);
                break;
            }
        }
    }

    // Playback 모드 재생 오류 처리
    _handlePlayError(error) {
        console.error('Play loop error:', error);
        this.uiController.setMessage(error.message, MessageType.ERROR, false);
        this._updateUI();
        this._pause();
        this._setState(State.IDLE);
    }
}