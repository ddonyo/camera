import {
    State,
    MessageType,
    ErrorMessages,
    InfoMessages,
    Direction,
    IPCCommands,
    StateNames,
    Config,
} from './config.js';
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
        this.flipMode = false; // 좌우 반전
        this.cropMode = false; // 중앙 크롭
        this.rembgMode = false; // 배경 제거
        this.fullMode = false; // 풀스크린 모드
        this._uiUpdateScheduled = false; // UI 업데이트 스케줄링 플래그
        this.liveFrameCount = 0; // 라이브 프레임 카운터
        this.originalFPS = null; // 파일에서 읽어온 원본 FPS
        this.frameLogCounter = 0; // 프레임 로그 카운터 (조건부 로깅용)

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
        const inputHandlers = this._createInputHandlers();
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

        Object.entries(inputHandlers).forEach(([elementKey, handler]) => {
            const element = elements[elementKey];
            if (element) {
                element.addEventListener('change', handler);
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
            flipBtn: () => this._handleFlip(),
            rembgBtn: () => this._handleRembg(),
            cropBtn: () => this._handleCrop(),
            fullBtn: () => this._handleFull(),
            progressBar: (evt) => this._handleSeek(evt),
        };
    }

    // Input 핸들러 맵 생성
    _createInputHandlers() {
        return {
            delayInput: () => this._handleDelay(),
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
            // 100개마다 한 번씩 로그 출력 (조건부 로깅)
            this.frameLogCounter++;
            if (this.frameLogCounter % 100 === 1) {
                console.log(`Received frame path: ${filePath} (frame #${this.frameLogCounter})`);
            }
            this._handleLiveFrame(filePath, 'path');
        });

        // 메인 프로세스에서 오는 프레임 바이너리 데이터 수신
        this.#electronAPI.on('frame-data', (binaryData) => {
            // 프레임 데이터는 덜 자주 발생하므로 10개마다 로그
            if (this.frameLogCounter % 10 === 1) {
                console.log(
                    `Received frame data: ${binaryData.length} bytes (frame #${this.frameLogCounter})`
                );
            }
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
                    CanvasUtils.drawImageToCanvas(canvas, img, {
                        flip: this.flipMode,
                        crop: this.cropMode,
                    });
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

    // Delay 값 변경 이벤트 핸들러
    async _handleDelay() {
        const delay = this.uiController.getDelay();

        if (this.state === State.LIVE) {
            console.log(`[Live] Delay changed to ${delay}, restarting stream...`);

            this._emitToElectron(IPCCommands.STOP_STREAMING);

            await this._delay(100);

            const options = { delay };
            this._emitToElectron(IPCCommands.START_STREAMING, options);

            console.log(`[Live] Stream restarted with new delay: ${delay}`);
        } else {
            this._emitToElectron(IPCCommands.SET_DELAY, delay);
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

    // Flip 버튼 이벤트 핸들러
    _handleFlip() {
        this.flipMode = !this.flipMode;
        this._updateUI();

        if (this.state === State.PLAYBACK && !this.playing) {
            this._updateFrameDisplay();
        }
    }

    // RemBG 버튼 이벤트 핸들러
    _handleRembg() {
        this.rembgMode = !this.rembgMode;

        // Body에 rembg-mode 클래스 추가/제거하여 CSS 스타일 적용
        const body = document.body;
        if (this.rembgMode) {
            body.classList.add('rembg-mode');
        } else {
            body.classList.remove('rembg-mode');
        }

        this._updateUI();

        if (this.state === State.PLAYBACK && !this.playing) {
            this._updateFrameDisplay();
        }
    }

    // Crop 버튼 이벤트 핸들러
    _handleCrop() {
        this.cropMode = !this.cropMode;

        // Body에 crop-mode 클래스 추가/제거하여 CSS 스타일 적용
        const body = document.body;
        if (this.cropMode) {
            body.classList.add('crop-mode');
        } else {
            body.classList.remove('crop-mode');
        }

        this._updateUI();

        if (this.state === State.PLAYBACK && !this.playing) {
            this._updateFrameDisplay();
        }
    }

    // Full 버튼 이벤트 핸들러
    _handleFull() {
        this.fullMode = !this.fullMode;
        console.log('[Full] Full mode toggled:', this.fullMode);

        const mainContainer = document.getElementById('mainContainer');
        const mainGridSection = document.querySelector('.main-grid-section');
        const cameraColumn = document.querySelector('.col-span-7');
        const vtonPanel = document.getElementById('vton-panel');
        const wardrobe = document.querySelector('.wardrobe-section');
        const controlPanel = document.querySelector('.control-panel');

        if (this.fullMode) {
            console.log('[Full] Entering Full mode');

            // VTON 패널과 Wardrobe 숨기기
            if (vtonPanel) {
                vtonPanel.style.display = 'none';
                console.log('[Full] Hidden vton-panel');
            }

            if (wardrobe) {
                wardrobe.style.display = 'none';
                console.log('[Full] Hidden wardrobe-section');
            }

            // 프로그레스 바만 숨기기 (컨트롤 패널은 유지)
            const progressBar = document.querySelector('.progress-bar');
            if (progressBar) {
                progressBar.style.display = 'none';
                console.log('[Full] Hidden progress-bar only');
            }

            // main-grid-section을 flex로 변경하고 카메라 영역을 전체로 확장
            if (mainGridSection) {
                mainGridSection.style.display = 'flex';
                mainGridSection.style.gridTemplateColumns = 'none';
                console.log('[Full] Changed main-grid-section to flex');
            }

            // 카메라 컬럼을 전체 너비로 확장하되 높이는 워드로브 하단까지
            if (cameraColumn) {
                cameraColumn.style.width = '100%';
                cameraColumn.style.flex = 'none'; // flex 제거
                cameraColumn.style.height = 'calc(100vh - 100px)'; // 카메라 높이 더 증가
                console.log('[Full] Expanded camera column with increased height');
            }

            // 카메라 컨테이너 높이를 워드로브 하단까지
            const cameraContainer = document.querySelector('.camera-container');
            if (cameraContainer) {
                cameraContainer.style.height = 'calc(100vh - 140px)'; // 카메라 컨테이너 높이 증가
                cameraContainer.style.flex = 'none';
                cameraContainer.style.display = 'flex';
                cameraContainer.style.alignItems = 'center'; // 수직 중앙 배치
                cameraContainer.style.justifyContent = 'center'; // 수평 중앙 배치
                console.log('[Full] Expanded camera container with center alignment');
            }

            // 카메라 캔버스 비율 유지하며 최대 크기로 확장
            const cameraCanvas = document.querySelector('.camera-container canvas');
            if (cameraCanvas) {
                cameraCanvas.style.position = 'static'; // position 초기화
                cameraCanvas.style.width = '100%'; // 너비를 100%로 설정
                cameraCanvas.style.height = '100%'; // 높이를 100%로 설정
                cameraCanvas.style.objectFit = 'contain'; // 비율 유지하며 맞춤
                cameraCanvas.style.display = 'block'; // block 표시
                console.log(
                    '[Full] Set camera canvas to fill container while maintaining aspect ratio'
                );
            }

            // 컨트롤 패널에 충분한 높이 확보 및 명확한 배경 적용
            if (controlPanel) {
                controlPanel.style.minHeight = '120px'; // 컨트롤 패널 최소 높이 더 증가
                controlPanel.style.paddingBottom = '30px'; // 하단 패딩 더 증가
                controlPanel.style.marginBottom = '30px'; // 하단 마진 더 증가
                controlPanel.style.backgroundColor = '#374151'; // 명확한 회색 배경 (gray-700)
                controlPanel.style.borderRadius = '12px'; // 모서리 둥글게
                controlPanel.style.padding = '16px'; // 전체 패딩 적용
                console.log('[Full] Set control panel with solid background color');
            }

            // Control area 배경 강제 설정
            const controlArea = document.querySelector('.control-area');
            if (controlArea) {
                controlArea.style.minHeight = '80px'; // control-area 최소 높이 설정
                controlArea.style.paddingTop = '10px';
                controlArea.style.paddingBottom = '10px';
                controlArea.style.backgroundColor = '#374151 !important'; // 강제 배경 설정
                controlArea.style.borderRadius = '8px';
                console.log('[Full] Forced control-area background');
            }

            // Status 영역 배경 강제 설정
            const statusElement = document.getElementById('status');
            if (statusElement) {
                statusElement.style.minHeight = '60px'; // status 영역 높이 확보
                statusElement.style.display = 'flex';
                statusElement.style.alignItems = 'flex-start'; // 상단 정렬
                statusElement.style.backgroundColor = '#374151 !important'; // 강제 배경 설정
                statusElement.style.borderRadius = '8px'; // 모서리 둥글게
                statusElement.style.padding = '8px'; // 내부 패딩
                console.log('[Full] Forced status area background');
            }

            // 모든 control-group 요소들 배경 통일
            const controlGroups = document.querySelectorAll('.control-group');
            controlGroups.forEach((group) => {
                group.style.backgroundColor = '#374151 !important';
                group.style.borderRadius = '8px';
                group.style.padding = '8px';
            });

            // 모든 control-btn 요소들 배경 처리
            const controlBtns = document.querySelectorAll('.control-btn');
            controlBtns.forEach((btn) => {
                // 버튼 자체는 원래 스타일 유지, 부모만 통일
            });

            // Footer를 아래로 더 내리기
            const footer = document.querySelector('footer');
            if (footer) {
                footer.style.marginTop = '50px'; // 상단 마진 더 증가
                console.log('[Full] Increased footer margin more');
            }
        } else {
            console.log('[Full] Exiting Full mode');

            // VTON 패널과 Wardrobe 표시
            if (vtonPanel) {
                vtonPanel.style.display = '';
                console.log('[Full] Shown vton-panel');
            }

            if (wardrobe) {
                wardrobe.style.display = '';
                console.log('[Full] Shown wardrobe-section');
            }

            // 프로그레스 바 다시 표시
            const progressBar = document.querySelector('.progress-bar');
            if (progressBar) {
                progressBar.style.display = '';
                console.log('[Full] Shown progress-bar');
            }

            // main-grid-section을 원래 grid로 복원
            if (mainGridSection) {
                mainGridSection.style.display = '';
                mainGridSection.style.gridTemplateColumns = '';
                console.log('[Full] Restored main-grid-section to grid');
            }

            // 카메라 컬럼 크기 복원
            if (cameraColumn) {
                cameraColumn.style.width = '';
                cameraColumn.style.flex = '';
                cameraColumn.style.height = '';
                console.log('[Full] Restored camera column size');
            }

            // 카메라 컨테이너 크기도 복원
            const cameraContainer = document.querySelector('.camera-container');
            if (cameraContainer) {
                cameraContainer.style.height = '';
                cameraContainer.style.flex = '';
                cameraContainer.style.display = '';
                cameraContainer.style.alignItems = '';
                cameraContainer.style.justifyContent = '';
                console.log('[Full] Restored camera container size and alignment');
            }

            // 카메라 캔버스 스타일 복원
            const cameraCanvas = document.querySelector('.camera-container canvas');
            if (cameraCanvas) {
                cameraCanvas.style.position = '';
                cameraCanvas.style.width = '';
                cameraCanvas.style.height = '';
                cameraCanvas.style.objectFit = '';
                cameraCanvas.style.display = '';
                console.log('[Full] Restored camera canvas styling');
            }

            // 컨트롤 패널 스타일 복원
            if (controlPanel) {
                controlPanel.style.minHeight = '';
                controlPanel.style.paddingBottom = '';
                controlPanel.style.marginBottom = '';
                controlPanel.style.backgroundColor = '';
                controlPanel.style.borderRadius = '';
                controlPanel.style.padding = '';
                console.log('[Full] Restored control panel styling');
            }

            // Control area 스타일 복원
            const controlArea = document.querySelector('.control-area');
            if (controlArea) {
                controlArea.style.minHeight = '';
                controlArea.style.paddingTop = '';
                controlArea.style.paddingBottom = '';
                controlArea.style.backgroundColor = '';
                console.log('[Full] Restored control-area styling');
            }

            // Status 영역 스타일 복원
            const statusElement = document.getElementById('status');
            if (statusElement) {
                statusElement.style.minHeight = '';
                statusElement.style.display = '';
                statusElement.style.alignItems = '';
                statusElement.style.backgroundColor = '';
                statusElement.style.borderRadius = '';
                statusElement.style.padding = '';
                console.log('[Full] Restored status area styling');
            }

            // Control groups 스타일 복원
            const controlGroups = document.querySelectorAll('.control-group');
            controlGroups.forEach((group) => {
                group.style.backgroundColor = '';
                group.style.borderRadius = '';
                group.style.padding = '';
            });

            // Footer 마진 복원
            const footer = document.querySelector('footer');
            if (footer) {
                footer.style.marginTop = '';
                console.log('[Full] Restored footer margin');
            }
        }

        this._updateUI();

        if (this.state === State.PLAYBACK && !this.playing) {
            this._updateFrameDisplay();
        }
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

            this._setState(State.PLAYBACK);
            this.playing = true;
            this.currentDirection = direction;

            const frameCount = await this._loadFramesWithProgress();

            if (frameCount === 0) {
                this._showNoFramesWarning();
                return;
            }

            this._initializePlaybackPosition(direction);
        } catch (error) {
            this._handleError(error, ErrorMessages.LOAD_RECORDED_FRAMES_FAILED);
        }
    }

    // 녹화 프레임 로드 (UI 진행 표시)
    async _loadFramesWithProgress() {
        try {
            this.uiController.setMessage('Counting total frames...', MessageType.LOADING, false);
            const totalFrameCount = await FileUtils.getTotalFrameCount();

            if (totalFrameCount === 0) {
                return 0;
            }

            // 순차적 로딩 방식 사용
            const frameCount = await this.frameManager.loadRecordFramesSequentially(
                this.uiController.elements.viewer,
                (frameIndex, loadedFrames, totalFrames) => {
                    // 프레임 로드 UI 업데이트
                    const progress = totalFrames ? (loadedFrames / totalFrames) * 100 : 0;
                    this.uiController.setMessage(
                        `Loading frame ${frameIndex + 1}/${totalFrames || '?'}...`,
                        MessageType.LOADING,
                        false
                    );
                    this.uiController.updateProgress(progress, 'fast');

                    // status 정보 업데이트
                    const statusInfo = {
                        path: 'Loading Frames',
                        name: '',
                        frame: `${loadedFrames}/${totalFrames || '?'}`,
                    };
                    this.uiController.updateStatus(statusInfo);
                },
                {
                    flip: this.flipMode,
                    crop: this.cropMode,
                    effectiveFPS: this._getEffectiveFPS(),
                    totalFrameCount: totalFrameCount,
                }
            );

            this.playing = false;
            this.uiController.clearMessage();
            this._updateUI();

            return frameCount;
        } catch (error) {
            this.playing = false;
            this.uiController.clearMessage();
            this._updateUI();
            throw error;
        }
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
            hasFrames,
            this.flipMode,
            this.cropMode,
            this.rembgMode,
            this.fullMode
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
                frame: `${this.liveFrameCount}`,
            };
        } else {
            statusInfo = this.frameManager.getStatusInfo();
        }

        this.uiController.updateStatus(statusInfo);
    }

    // 현재 프레임 표시 및 UI 업데이트
    async _updateFrameDisplay() {
        await this.frameManager.drawCurrentFrame(this.uiController.elements.viewer, {
            flip: this.flipMode,
            crop: this.cropMode,
        });
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
        this.frameLogCounter = 0; // 프레임 로그 카운터 리셋
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
        return new Promise((resolve) => setTimeout(resolve, ms));
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
