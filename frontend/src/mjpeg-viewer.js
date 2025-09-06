import {
    State,
    MessageType,
    ErrorMessages,
    InfoMessages,
    Direction,
    IPCCommands,
    Config,
} from './config.js';
import { TimerUtils, CanvasUtils, FileUtils } from './utils.js';
import { FrameManager } from './frame-manager.js';
import { UIController } from './ui-controller.js';
import { ROIOverlay } from './roi-overlay.js';
import { getSoundManager } from './sound-manager.js';

// MJPEG 뷰어 메인 로직 클래스
export class MJPEGViewer {
    constructor() {
        console.log('MJPEGViewer constructor started');

        this.frameManager = new FrameManager(); // 프레임 관리자
        this.uiController = new UIController(); // UI 컨트롤러
        this.roiOverlay = null; // ROI 오버레이 (나중에 초기화)
        this.soundManager = getSoundManager(); // 사운드 매니저

        console.log('UI elements:', this.uiController.elements);

        this.state = State.IDLE; // 현재 상태
        this.playing = false; // 재생 상태 (PLAYBACK 모드)
        this.currentDirection = Direction.FORWARD; // 재생 방향
        this.repeatMode = false; // 반복 재생
        this.flipMode = true; // 좌우 반전 (기본값)
        this.cropMode = false; // 중앙 크롭
        this.roiMode = false; // ROI 오버레이 표시 (기본값: 비활성화)
        this.fullMode = false; // 풀스크린 모드
        this.triggerMode = 'hand'; // 트리거 모드: 'hand' 또는 'pose'
        this._uiUpdateScheduled = false; // UI 업데이트 스케줄링 플래그
        this.liveFrameCount = 0; // 라이브 프레임 카운터
        this.originalFPS = null; // 파일에서 읽어온 원본 FPS
        this.frameLogCounter = 0; // 프레임 로그 카운터 (조건부 로깅용)
        this.isLoadingFrames = false; // 프레임 로딩 상태

        this._bindEvents(); // 이벤트 바인딩
        this._setupLiveIpcListeners(); // IPC 리스너 (라이브)
        this._forwardHandRouterEvents(); // HandRouter 이벤트 전달 설정
        this._syncInitialSettingsToBackend(); // 초기 UI 설정을 백엔드로 전송
        setTimeout(() => {
            this._initROIOverlay();
        }, 100);
        this._updateUI(); // UI 업데이트

        console.log('MJPEGViewer constructor completed');

        // ROI dwell progress 리스너
        window.addEventListener('roi-dwell-progress', (event) => {
            if (this.roiOverlay) {
                this.roiOverlay.updateDwellProgress(event.detail);
            }
            // Update RecTrigger progress bar
            this._updateRecTriggerProgress(event.detail);
        });
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
            cropBtn: () => this._handleCrop(),
            roiBtn: () => this._toggleROIOverlay(),
            triggerModeBtn: () => this._handleTriggerMode(),
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

        // 손 감지 결과 수신
        this.#electronAPI.on('hand-detection', (detectionData) => {
            this._handleHandDetectionData(detectionData);
        });

        // 손 제스처 녹화 시작 이벤트
        this.#electronAPI.on('recording-started', (data) => {
            this._startRecording();
        });

        // 손 제스처/포즈 녹화 중지 이벤트
        this.#electronAPI.on('recording-stopped', (data) => {
            console.log('[MJPEGViewer] Recording stopped event received:', data);
            this._stopRecording();
        });
        
        // 포즈 감지 결과 수신
        this.#electronAPI.on('pose-detection', (detectionData) => {
            this._handlePoseDetectionData(detectionData);
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
                    // Transformations are now applied in backend, so just draw as-is
                    CanvasUtils.drawImageToCanvas(canvas, img, {
                        flip: false,  // Already applied in backend
                        crop: false,  // Already applied in backend
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

    // 공용 녹화 시작 메서드 (Live 스트리밍은 유지)
    async _startRecording() {
        try {
            console.log('[Recording] Starting recording');

            // UI 상태를 RECORD로 변경 (Live 스트리밍은 계속 진행)
            this._setState(State.RECORD);
            this.liveFrameCount = 0; // Record 모드 카운터 리셋

            // REC 버튼에 블링킹 효과 추가
            const recordBtn = document.getElementById('recordBtn');
            if (recordBtn) {
                recordBtn.classList.add('is-recording');
            }

            // Update trigger text to STOP Trigger
            const triggerText = document.getElementById('recTriggerText');
            if (triggerText) {
                triggerText.textContent = 'STOP Trigger';
            }

            // UI 업데이트 (상태 변경으로 버튼 활성/비활성화 자동 처리됨)
            this._updateUI();

            // 메시지 표시
            this.uiController.setMessage('🔴 Recording started', MessageType.INFO);
            
            // 녹화 시작 효과음 재생
            if (this.soundManager) {
                this.soundManager.playRecordingStart();
            }

            // 백그라운드에서 녹화 시작 명령 전송
            this._emitToElectron(IPCCommands.START_RECORDING);

            console.log('[Recording] Successfully started recording');
        } catch (error) {
            this._handleError(error, 'Recording start error');
        }
    }

    // 공용 녹화 중지 메서드 (버튼과 제스처 모두 Playback 모드로 전환)
    async _stopRecording() {
        try {
            console.log('[Recording] Stopping recording');

            // REC 버튼 블링킹 효과 제거
            const recordBtn = document.getElementById('recordBtn');
            if (recordBtn) {
                recordBtn.classList.remove('is-recording');
            }

            // Update trigger text to START Trigger
            const triggerText = document.getElementById('recTriggerText');
            if (triggerText) {
                triggerText.textContent = 'START Trigger';
            }

            // 메시지 표시
            this.uiController.setMessage('⏹️ Recording stopped', MessageType.INFO);
            
            // 녹화 중지 효과음 재생
            if (this.soundManager) {
                this.soundManager.playRecordingStop();
            }

            // 녹화 중지 명령 전송
            this._emitToElectron(IPCCommands.STOP_RECORDING);
            this._emitToElectron(IPCCommands.STOP_STREAMING);

            // 프레임 카운터 리셋 (다음 녹화를 위해)
            this.liveFrameCount = 0;

            // Playback 모드로 전환 (버튼과 제스처 모두 동일하게 처리)
            await this._startPlaybackMode(Direction.FORWARD);

            // Generate thumbnails if in replay mode (but don't update replay panel)
            const modeSelect = document.getElementById('modeSelect');
            if (modeSelect && modeSelect.value === 'replay') {
                // Trigger thumbnail generation
                if (typeof window.generateThumbnails === 'function') {
                    window.generateThumbnails();
                }
            }

            console.log('[Recording] Successfully stopped recording and switched to playback');
        } catch (error) {
            this._handleError(error, 'Recording stop error');
        }
    }

    // Live에서 Record로 전환 (무중단) - 버튼 클릭용
    async _switchFromLiveToRecord() {
        await this._startRecording();
    }

    // Record 모드 중지 및 Playback 전환 준비 - 버튼 클릭용
    async _stopRecordMode() {
        await this._stopRecording();
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
        
        // Backend에 flip mode 상태 전달
        this._updateBackendSettings({ flip_mode: this.flipMode });

        if (this.state === State.PLAYBACK && !this.playing) {
            this._updateFrameDisplay();
        }
    }

    // Trigger 모드 버튼 이벤트 핸들러
    _handleTriggerMode() {
        // Toggle between 'hand' and 'pose' modes
        this.triggerMode = this.triggerMode === 'hand' ? 'pose' : 'hand';
        
        // Update button icon and text
        const triggerBtn = this.uiController.elements.triggerModeBtn;
        if (triggerBtn) {
            // Update text
            const spanElement = triggerBtn.querySelector('span');
            if (spanElement) {
                spanElement.textContent = this.triggerMode === 'hand' ? 'Hand' : 'Pose';
            }
            
            // Update icon
            const svgElement = triggerBtn.querySelector('svg');
            if (svgElement) {
                if (this.triggerMode === 'hand') {
                    // Hand icon
                    svgElement.innerHTML = '<path d="M6.58 19H14.58C15.4 19 16.08 18.56 16.58 17.95L19.94 12.83C20.18 12.42 19.59 12 19.12 12H12.87L13.8 8.91C13.96 8.37 13.64 7.83 13.09 7.67C12.73 7.56 12.35 7.68 12.1 7.94L6.8 14.04C6.28 14.59 6 15.29 6 16.04V17.58C6 18.36 6.22 19 6.58 19M7 16L11.42 10.74L10.58 13.43C10.46 13.78 10.5 14.15 10.69 14.47C10.88 14.79 11.19 15 11.53 15H17.91L15.58 18H8V16H7M1 7H5V21H1V7Z" />';
                } else {
                    // Person icon
                    svgElement.innerHTML = '<path d="M12 2C13.1 2 14 2.9 14 4S13.1 6 12 6 10 5.1 10 4 10.9 2 12 2M15.9 8.1C15.5 7.7 14.8 7 13.5 7H10.5C9.2 7 8.5 7.7 8.1 8.1C6.7 9.5 6 11.6 6 14C6 14.3 6 14.5 6.1 14.8C5.4 14.3 5 13.5 5 12.6V8.2C5 7.5 5.5 7 6.2 7H7.3C7.9 6.4 8.7 6 9.6 6H14.4C15.3 6 16.1 6.4 16.7 7H17.8C18.5 7 19 7.5 19 8.2V12.6C19 13.5 18.6 14.3 17.9 14.8C18 14.5 18 14.3 18 14C18 11.6 17.3 9.5 15.9 8.1M8 22V18H7C6.4 18 6 17.6 6 17V14C6 11.3 7.1 10 8 10S10 11.3 10 14H14C14 11.3 15.1 10 16 10S18 11.3 18 14V17C18 17.6 17.6 18 17 18H16V22H14V18H10V22H8Z" />';
                }
            }
            
            // Update data attribute
            triggerBtn.setAttribute('data-mode', this.triggerMode);
        }
        
        // Control ROI button availability - ROI is only for hand mode
        const roiBtn = this.uiController.elements.roiBtn;
        if (roiBtn) {
            if (this.triggerMode === 'pose') {
                // Disable ROI in pose mode
                roiBtn.disabled = true;
                roiBtn.classList.remove('active');
                // Also disable ROI functionality if it was enabled
                if (this.roiMode) {
                    this._handleROI(); // Toggle off ROI
                }
            } else {
                // Enable ROI in hand mode
                roiBtn.disabled = false;
            }
        }
        
        // Notify backend about trigger mode change
        if (this.#electronAPI?.invoke) {
            this.#electronAPI.invoke('set-trigger-mode', this.triggerMode);
        }
        
        console.log('Trigger mode changed to:', this.triggerMode);
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

        // ROI overlay에 crop mode 상태 전달
        if (this.roiOverlay) {
            this.roiOverlay.setCropMode(this.cropMode);
        }

        // Backend에 crop mode 상태 전달
        this._updateBackendSettings({ crop_mode: this.cropMode });

        this._updateUI();

        if (this.state === State.PLAYBACK && !this.playing) {
            this._updateFrameDisplay();
        }
    }


    // Full 버튼 이벤트 핸들러
    _handleFull() {
        // fullscreen-manager가 있고, 이미 처리 중이 아니면 사용
        if (window.fullscreenManager && !this._isHandlingFullscreen) {
            console.log('[Full] Using fullscreen-manager');
            this._isHandlingFullscreen = true;
            window.fullscreenManager.toggleCameraFullscreen();
            // 플래그 리셋
            setTimeout(() => {
                this._isHandlingFullscreen = false;
            }, 100);
            return;
        }

        // fullscreen-manager에서 호출한 경우 또는 fallback
        this.fullMode = !this.fullMode;
        console.log('[Full] Full mode toggled:', this.fullMode);

        const mainContainer = document.getElementById('mainContainer');
        const mainGridSection = document.querySelector('.main-grid-section');
        const cameraColumn = document.querySelector('.col-span-7');
        const vtonPanel = document.getElementById('vton-panel');
        const wardrobe = document.querySelector('.wardrobe-section');
        const controlPanel = document.querySelector('.control-panel');
        const fullBtn = document.getElementById('fullBtn');

        if (this.fullMode) {
            console.log('[Full] Entering Full mode');

            // 버튼 아이콘 변경 (종료 아이콘)
            if (fullBtn) {
                fullBtn.classList.add('active');
                const svg = fullBtn.querySelector('svg path');
                if (svg) {
                    svg.setAttribute(
                        'd',
                        'M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z'
                    );
                }
                fullBtn.setAttribute('title', '전체화면 종료');
            }

            // VTON 패널과 Wardrobe는 숨기지 않음 (카메라가 화면을 덮으므로 불필요)
            // 이렇게 하면 VTON 전체화면 전환시 충돌 방지
            /*
            if (vtonPanel) {
                vtonPanel.style.display = 'none';
                console.log('[Full] Hidden vton-panel');
            }
            */

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

            // 버튼 아이콘 복원
            if (fullBtn) {
                fullBtn.classList.remove('active');
                const svg = fullBtn.querySelector('svg path');
                if (svg) {
                    svg.setAttribute(
                        'd',
                        'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z'
                    );
                }
                fullBtn.setAttribute('title', '전체화면');
            }

            // VTON 패널은 원래 숨기지 않았으므로 복원 불필요
            /*
            if (vtonPanel) {
                vtonPanel.style.display = '';
                console.log('[Full] Shown vton-panel');
            }
            */

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
            this.playing = false; // 진입 시 재생 꺼진 상태로
            this.currentDirection = direction;

            const frameCount = await this._loadFramesWithProgress();

            if (frameCount === 0) {
                this._showNoFramesWarning();
                return;
            }

            this._initializePlaybackPosition(direction);

            // 자동재생: playback 모드 진입 시 자동으로 재생 시작
            this._play(direction);
        } catch (error) {
            this._handleError(error, ErrorMessages.LOAD_RECORDED_FRAMES_FAILED);
        }
    }

    // 녹화 프레임 로드 (UI 진행 표시)
    async _loadFramesWithProgress() {
        try {
            this.isLoadingFrames = true; // 로딩 시작
            this._updateUI(); // UI 상태 업데이트

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
                    flip: false,  // Transformations already applied when saved
                    crop: false,  // Transformations already applied when saved
                    effectiveFPS: this._getEffectiveFPS(),
                    totalFrameCount: totalFrameCount,
                }
            );

            this.playing = false;
            this.isLoadingFrames = false; // 로딩 완료
            this.uiController.clearMessage();
            this._updateUI();

            return frameCount;
        } catch (error) {
            this.playing = false;
            this.isLoadingFrames = false; // 로딩 실패 시에도 false
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
            this.roiMode,
            this.fullMode,
            this.isLoadingFrames // 프레임 로딩 상태 추가
        );
        
        // Control ROI button based on trigger mode - ROI is only for hand mode
        const roiBtn = this.uiController.elements.roiBtn;
        if (roiBtn && this.triggerMode === 'pose') {
            roiBtn.disabled = true;
        }

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
        // Transformations are already applied to saved frames, so just draw as-is
        await this.frameManager.drawCurrentFrame(this.uiController.elements.viewer, {
            flip: false,  // Already applied when frames were saved
            crop: false,  // Already applied when frames were saved
        });
        this._updateUI();
        
        // Removed automatic replay panel update - now only updates when thumbnail is clicked
    }

    // 스트리밍 모드 (Live/Record) 확인
    _isStreamingMode() {
        return this.state === State.LIVE || this.state === State.RECORD;
    }

    // 현재 상태 반환 (외부에서 접근 가능)
    getState() {
        return this.state;
    }

    // 녹화 중인지 확인
    isRecording() {
        return this.state === State.RECORD;
    }

    // Jump to specific frame
    jumpToFrame(frameIndex) {
        if (this.state === State.PLAYBACK && this.frameManager) {
            this.frameManager.setCurrentIndex(frameIndex);
            this._updateFrameDisplay();
        }
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
        
        if (this.roiOverlay) {
            this.roiOverlay.destroy();
            this.roiOverlay = null;
        }
        
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
        const effectiveFPS = this._getEffectiveFPS();
        const targetInterval = 1000 / effectiveFPS;
        let nextFrameTime = performance.now() + targetInterval;
        let frameCount = 0;
        let totalFrames = 0;
        let sessionStartTime = performance.now();
        
        while (this.playing) {
            try {
                const now = performance.now();
                
                // 다음 프레임 시간까지 대기
                const timeToWait = nextFrameTime - now;
                if (timeToWait > 0) {
                    await new Promise(resolve => setTimeout(resolve, timeToWait));
                }
                
                // 프레임 처리
                const frameStartTime = performance.now();
                await this._processFrame(this.currentDirection);
                const processingTime = performance.now() - frameStartTime;
                
                // 다음 프레임 시간 계산 (drift 보정)
                nextFrameTime += targetInterval;
                if (nextFrameTime < performance.now()) {
                    // 너무 뒤처진 경우 재동기화
                    nextFrameTime = performance.now() + targetInterval;
                }
                
                // 통계 업데이트
                frameCount++;
                totalFrames++;
                
                // 디버깅: 10프레임마다 실제 FPS 출력
                if (frameCount >= 10) {
                    const elapsed = (performance.now() - sessionStartTime) / 1000;
                    const actualFPS = totalFrames / elapsed;
                    const totalFrameCount = this.frameManager.getFrameCount();
                    const currentIndex = this.frameManager.getCurrentIndex();
                    console.log(`[Playback] Frame ${currentIndex}/${totalFrameCount}, Average FPS: ${actualFPS.toFixed(1)} (Target: ${effectiveFPS}), Interval: ${targetInterval.toFixed(1)}ms`);
                    frameCount = 0;
                }
                
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

    // ROI 오버레이 초기화
    _initROIOverlay() {
        const viewerCanvas = this.uiController.elements.viewer;
        console.log('[MJPEGViewer] Initializing ROI overlay...', {
            viewerCanvas: !!viewerCanvas,
            viewerId: viewerCanvas?.id,
            canvasRect: viewerCanvas?.getBoundingClientRect(),
            parentElement: viewerCanvas?.parentElement?.tagName,
            parentClass: viewerCanvas?.parentElement?.className,
        });
        if (viewerCanvas) {
            try {
                this.roiOverlay = new ROIOverlay(viewerCanvas);

                // 기본적으로 비활성화 (사용자가 명시적으로 활성화해야 함)
                // this.roiOverlay.enable();  // Disabled by default

                // 윈도우 리사이즈 이벤트 처리
                window.addEventListener('resize', () => {
                    if (this.roiOverlay) {
                        this.roiOverlay.handleResize();
                    }
                });
                console.log('[MJPEGViewer] ROI overlay initialized successfully');
            } catch (error) {
                console.error('[MJPEGViewer] Failed to initialize ROI overlay:', error);
                this.roiOverlay = null;
            }
        } else {
            console.warn('[MJPEGViewer] Viewer canvas not found, ROI overlay not initialized');
        }
    }

    // ROI 오버레이 토글
    _toggleROIOverlay() {
        if (this.roiOverlay) {
            this.roiOverlay.toggle();
            this.roiMode = this.roiOverlay.isEnabled;

            console.log(`[MJPEGViewer] ROI overlay ${this.roiMode ? 'enabled' : 'disabled'}`);
            
            // Backend에 ROI enabled 상태 전달
            this._updateBackendSettings({ enabled: this.roiMode });

            // UI 업데이트 (Crop, Flip과 동일한 방식)
            this._updateUI();
        }
    }


    // Backend UI 설정 업데이트
    async _updateBackendSettings(settings) {
        if (!this.#electronAPI?.invoke) {
            console.warn('[MJPEGViewer] electronAPI.invoke not available');
            return;
        }

        try {
            const result = await this.#electronAPI.invoke('update-ui-settings', settings);
            console.log('[MJPEGViewer] Backend settings updated:', settings, 'Result:', result);
        } catch (error) {
            console.error('[MJPEGViewer] Failed to update backend settings:', error);
        }
    }

    // 초기 UI 설정을 백엔드로 동기화
    _syncInitialSettingsToBackend() {
        const initialSettings = {
            enabled: this.roiMode,
            flip_mode: this.flipMode,
            crop_mode: this.cropMode
        };
        
        console.log('[MJPEGViewer] Syncing initial UI settings to backend:', initialSettings);
        this._updateBackendSettings(initialSettings);
    }


    // 손 감지 결과 업데이트 (백엔드에서 받은 데이터)
    _updateHandDetections(detections) {
        if (this.roiOverlay) {
            this.roiOverlay.updateHandDetections(detections);
        }
    }

    // HandRouter 이벤트를 ROI 오버레이에 전달
    _forwardHandRouterEvents() {
        // HandRouter에서 ROI HIT 이벤트를 받아서 ROI 오버레이에 전달
        this.#electronAPI.on('handDetection', (data) => {
            if (
                this.roiOverlay &&
                data.rightHandInStartROI !== undefined &&
                data.leftHandInStopROI !== undefined
            ) {
                this.roiOverlay.updateROIActivation({
                    start_roi: data.rightHandInStartROI,
                    stop_roi: data.leftHandInStopROI,
                });
            }
        });
    }

    // 손 감지 데이터 처리 (IPC에서 받은 데이터)
    _handleHandDetectionData(detectionData) {
        if (!detectionData || !detectionData.hands) {
            return;
        }

        // 디버그 로그 (가끔씩만)
        if (Math.random() < 0.1) {
            // 10% 확률로 로그 출력
            console.log('[MJPEGViewer] Hand detection data received:', {
                handCount: detectionData.hands.length,
                rightHandInStartROI: detectionData.rightHandInStartROI,
                leftHandInStopROI: detectionData.leftHandInStopROI,
            });
        }

        // ROI 오버레이 업데이트
        this._updateHandDetections(detectionData.hands);

        // ROI 진입 상태에 따른 UI 피드백
        if (detectionData.rightHandInStartROI) {
            this._showROIFeedback('start', true);
        }
        if (detectionData.leftHandInStopROI) {
            this._showROIFeedback('stop', true);
        }
    }

    // ROI 진입 시각적 피드백
    _showROIFeedback(type, isActive) {
        // ROI 버튼에 임시 하이라이트 효과
        const roiBtn = this.uiController.elements.roiBtn;
        if (roiBtn && isActive) {
            roiBtn.classList.add('roi-active');
            setTimeout(() => {
                roiBtn.classList.remove('roi-active');
            }, 500);
        }
    }

    // 포즈 감지 데이터 처리 (IPC에서 받은 데이터)
    _handlePoseDetectionData(detectionData) {
        if (!detectionData) {
            return;
        }

        // Dispatch window event for ROI overlay
        window.dispatchEvent(new CustomEvent('pose-detection', { detail: detectionData }));

        // Update RecTrigger progress bar for pose detection
        // (Pose events should only come when in pose mode anyway)
        if (detectionData.dwellProgress !== undefined) {
            this._updateRecTriggerProgress({ 
                start: detectionData.dwellProgress,
                startActive: detectionData.dwellProgress > 0
            });
        } else if (!detectionData.fullBodyVisible) {
            // Reset progress when full body is lost
            this._updateRecTriggerProgress({ 
                start: 0,
                startActive: false
            });
        }

        // 포즈 감지 시각화
        // 예: 전신 감지 진행률 표시
        if (detectionData.fullBodyVisible && detectionData.dwellProgress > 0) {
            this._showPoseFeedback(detectionData.dwellProgress);
        }
    }

    // 포즈 감지 시각적 피드백
    _showPoseFeedback(progress) {
        const triggerBtn = this.uiController.elements.triggerModeBtn;
        if (triggerBtn && this.triggerMode === 'pose') {
            // Progress bar 효과나 색상 변경 등으로 피드백 제공
            triggerBtn.style.background = `linear-gradient(to right, #4CAF50 ${progress * 100}%, #transparent ${progress * 100}%)`;
            if (progress >= 1) {
                // 녹화 시작되면 원래대로
                setTimeout(() => {
                    triggerBtn.style.background = '';
                }, 500);
            }
        }
    }
    
    // RecTrigger Progress Bar 업데이트
    _updateRecTriggerProgress(progressData) {
        const progressBar = document.getElementById('recTriggerProgressBar');
        const triggerText = document.getElementById('recTriggerText');
        if (!progressBar) return;
        
        // Store previous state to detect interruptions
        if (!this._lastDwellState) {
            this._lastDwellState = { startActive: false, stopActive: false, startProgress: 0, stopProgress: 0 };
        }
        
        let progress = 0;
        let isActive = false;
        
        // Check for recording start progress (hand or pose)
        if (progressData.startActive && progressData.start > 0) {
            progress = progressData.start;
            isActive = true;
            progressBar.classList.remove('bg-red-500');
            progressBar.classList.add('bg-green-500');
            // Update text to START Trigger
            if (triggerText) {
                triggerText.textContent = 'START Trigger';
            }
        }
        // Check for recording stop progress (hand or pose)
        else if (progressData.stopActive && progressData.stop > 0) {
            progress = progressData.stop;
            isActive = true;
            progressBar.classList.remove('bg-green-500');
            progressBar.classList.add('bg-red-500');
            // Update text to STOP Trigger
            if (triggerText) {
                triggerText.textContent = 'STOP Trigger';
            }
        } else {
            // Update trigger text based on recording state
            if (triggerText) {
                triggerText.textContent = this.isRecording() ? 'STOP Trigger' : 'START Trigger';
            }
        }
        
        // Check for interruption - if progress goes backwards or stops before completion
        const wasStartActive = this._lastDwellState.startActive;
        const wasStopActive = this._lastDwellState.stopActive;
        const startInterrupted = wasStartActive && (!progressData.startActive || progressData.start < this._lastDwellState.startProgress);
        const stopInterrupted = wasStopActive && (!progressData.stopActive || progressData.stop < this._lastDwellState.stopProgress);
        
        // Check if trigger completed (reached 100%)
        const startCompleted = wasStartActive && this._lastDwellState.startProgress >= 0.99 && !progressData.startActive;
        const stopCompleted = wasStopActive && this._lastDwellState.stopProgress >= 0.99 && !progressData.stopActive;
        
        if (startInterrupted || stopInterrupted || startCompleted || stopCompleted) {
            // Reset immediately when interrupted or completed
            progressBar.style.width = '0%';
            progressBar.style.transition = 'none'; // Instant reset
            setTimeout(() => {
                progressBar.style.transition = ''; // Re-enable transition
            }, 10);
            
            // Reset color to green when stop completes
            if (stopCompleted) {
                progressBar.classList.remove('bg-red-500');
                progressBar.classList.add('bg-green-500');
            }
        } else if (isActive) {
            // Update progress bar width
            progressBar.style.width = `${progress * 100}%`;
        } else {
            // Reset when not active
            progressBar.style.width = '0%';
        }
        
        // Update last state
        this._lastDwellState = {
            startActive: progressData.startActive || false,
            stopActive: progressData.stopActive || false,
            startProgress: progressData.start || 0,
            stopProgress: progressData.stop || 0
        };
    }
}
