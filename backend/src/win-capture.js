const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const EventEmitter = require('events');

// Windows용 웹캠 캡처 클래스 - Linux capture.js와 동일한 인터페이스 제공
class WinDevice extends EventEmitter {
    /**
     * @param {Object} options - 설정 옵션 객체
     * @param {number} [options.debugLevel=0] - 디버그 레벨
     * @param {string} [options.saveDir='./frontend/public/live'] - 저장 디렉토리
     * @param {string} [options.fileFmt='frame%d.jpg'] - 저장 파일 형식
     * @param {number} [options.numFiles=4] - 저장 파일 수 (순환)
     * @param {number} [options.width=640] - 프레임 Width
     * @param {number} [options.height=480] - 프레임 Height
     * @param {number} [options.fps=30] - 초당 프레임 수
     * @param {boolean} [options.useStdout=false] - 표준 출력을 사용할지 여부
     */
    constructor(options) {
        super();
        this.debugLevel = options.debugLevel || 0;
        this.saveDir = options.saveDir || './frontend/public/live';
        this.fileFmt = options.fileFmt || 'frame%d.jpg';
        this.numFiles = options.numFiles || 4;
        this.width = options.width || 640;
        this.height = options.height || 480;
        this.fps = options.fps || 30;
        this.stdout = options.useStdout ? 'inherit' : 'ignore';

        // Windows 특화 속성
        this.isRunning = false;
        this.frameIndex = 0;
        this.captureInterval = null;
        this.mainWindow = null; // Electron 창 참조
        this.frameHandler = null; // FrameHandler 참조 (녹화 제어용)
        this.handRouter = null; // HandRouter 참조 (hand detection 이벤트 전달용)
        this.camInfo = null;
        this.debugMode = process.env.HAND_DEBUG === 'true'; // Debug mode for verbose logging

        // 녹화 관련 속성
        this.isRecording = false;
        this.recordingStartTime = null;

        // 순환 파일 인덱스
        this.currentFileIndex = 0;
    }

    // 디렉토리 생성
    async #ensureDirectory() {
        try {
            await fsp.access(this.saveDir);
        } catch (error) {
            if (error.code === 'ENOENT') {
                await fsp.mkdir(this.saveDir, { recursive: true });
                console.log(`[WinCapture] Directory created: ${this.saveDir}`);
            } else {
                throw error;
            }
        }
    }

    // Electron 메인 윈도우 설정 (웹캠 캡처를 위해 필요)
    setMainWindow(window) {
        this.mainWindow = window;
        console.log(`[WinCapture] Main window ${window ? 'set' : 'cleared'}:`, !!window);
    }

    // FrameHandler 참조 설정 (녹화 제어용)
    setFrameHandler(frameHandler) {
        this.frameHandler = frameHandler;
        console.log(
            `[WinCapture] FrameHandler ${frameHandler ? 'set' : 'cleared'}:`,
            !!frameHandler
        );
    }

    // HandRouter 설정
    setHandRouter(handRouter) {
        this.handRouter = handRouter;
        console.log('[WinCapture] HandRouter set');

        // HandRouter 이벤트를 IPC로 전달
        if (this.handRouter) {
            this.handRouter.on('handDetection', (data) => {
                if (
                    this.mainWindow &&
                    !this.mainWindow.isDestroyed() &&
                    this.mainWindow.webContents &&
                    !this.mainWindow.webContents.isDestroyed()
                ) {
                    this.mainWindow.webContents.send('handDetection', data);
                    if (this.debugMode) {
                        console.log('[WinCapture] Forwarded handDetection event to renderer:', {
                            rightHandInStartROI: data.rightHandInStartROI,
                            leftHandInStopROI: data.leftHandInStopROI,
                        });
                    }
                }
            });

            // Forward VTON trigger event to frontend
            this.handRouter.on('vtonTriggered', (data) => {
                if (
                    this.mainWindow &&
                    !this.mainWindow.isDestroyed() &&
                    this.mainWindow.webContents &&
                    !this.mainWindow.webContents.isDestroyed()
                ) {
                    console.log('[WinCapture] Forwarding VTON trigger to frontend:', data);
                    this.mainWindow.webContents.send('vtonTriggered', data);
                }
            });

            // Forward dwell progress event to frontend
            this.handRouter.on('dwellProgress', (data) => {
                if (
                    this.mainWindow &&
                    !this.mainWindow.isDestroyed() &&
                    this.mainWindow.webContents &&
                    !this.mainWindow.webContents.isDestroyed()
                ) {
                    this.mainWindow.webContents.send('roi-dwell-progress', data);
                }
            });
        }
    }

    // 웹캠으로부터 프레임 캡처 및 저장
    async #captureFrame() {
        if (!this.mainWindow || !this.isRunning) {
            return;
        }

        try {
            // 현재 순환 파일 인덱스
            const fileIndex = this.currentFileIndex % this.numFiles;
            const fileName = this.fileFmt.replace('%d', fileIndex);
            const filePath = path.join(this.saveDir, fileName);

            // Renderer 프로세스에서 웹캠 캡처 요청 (독립적인 웹캠 접근)
            const result = await this.mainWindow.webContents.executeJavaScript(`
                (async () => {
                    try {
                        // 웹캠 스트림이 없으면 새로 생성
                        if (!window.__winCaptureStream) {
                            // 하드웨어 카메라 선택
                            const devices = await navigator.mediaDevices.enumerateDevices();
                            const videoDevices = devices.filter(device => device.kind === "videoinput");
                            const hardwareCameras = videoDevices.filter(device => 
                                !device.label.toLowerCase().includes("virtual"));
                            
                            const selectedDevice = hardwareCameras.length > 0 ? hardwareCameras[0] : videoDevices[0];

                            if (selectedDevice) {
                                const resolutions = [
                                    { width: ${this.width}, height: ${this.height} },
                                    { width: 1280, height: 720 },
                                    { width: 640, height: 480 }
                                ];

                                let stream = null;
                                for (const resolution of resolutions) {
                                    try {
                                        stream = await navigator.mediaDevices.getUserMedia({
                                            video: {
                                                deviceId: { exact: selectedDevice.deviceId },
                                                width: { ideal: resolution.width },
                                                height: { ideal: resolution.height },
                                                frameRate: { ideal: ${this.fps}, max: ${this.fps} }
                                            },
                                            audio: false
                                        });
                                        console.log('Camera stream created with resolution:', resolution);
                                        break;
                                    } catch (resError) {
                                        console.warn('Failed resolution:', resolution, resError.message);
                                    }
                                }

                                if (!stream) {
                                    throw new Error('Failed to create camera stream with any resolution');
                                }

                                window.__winCaptureStream = stream;
                            } else {
                                throw new Error('No camera found');
                            }
                        }

                        // 캡처용 캔버스 생성/재사용
                        if (!window.__captureCanvas) {
                            window.__captureCanvas = document.createElement('canvas');
                            window.__captureVideo = document.createElement('video');
                            window.__captureVideo.srcObject = window.__winCaptureStream;
                            window.__captureVideo.autoplay = true;
                            window.__captureVideo.muted = true;
                            window.__captureVideo.playsInline = true;

                            // 비디오 메타데이터 로딩을 기다리되, 타임아웃 시간을 늘리고 더 상세한 에러 처리
                            try {
                                await Promise.race([
                                    new Promise((resolve) => {
                                        window.__captureVideo.addEventListener('loadedmetadata', resolve, { once: true });
                                    }),
                                    new Promise((resolve) => {
                                        window.__captureVideo.addEventListener('canplay', resolve, { once: true });
                                    }),
                                    new Promise((_, reject) => {
                                        setTimeout(() => reject(new Error('Video load timeout - camera may be disconnected')), 10000);
                                    })
                                ]);
                                console.log('[WinCapture] Video metadata loaded successfully');
                            } catch (loadError) {
                                console.error('[WinCapture] Video loading failed:', loadError.message);
                                throw new Error('Camera connection failed: ' + loadError.message);
                            }

                            const track = window.__winCaptureStream.getVideoTracks()[0];
                            const settings = track.getSettings();
                            window.__captureCanvas.width = settings.width || ${this.width};
                            window.__captureCanvas.height = settings.height || ${this.height};
                            console.log('Canvas size set to:', window.__captureCanvas.width, 'x', window.__captureCanvas.height);
                        }

                        const video = window.__captureVideo;
                        const canvas = window.__captureCanvas;

                        if (video.readyState < 2) {
                            // 비디오가 준비되지 않았으면 잠시 기다렸다가 다시 시도
                            console.warn('[WinCapture] Video not ready, skipping frame');
                            return { success: false, error: 'Video not ready - camera may be disconnected' };
                        }

                        const ctx = canvas.getContext('2d', { willReadFrequently: false });
                        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

                        return {
                            success: true,
                            dataUrl: dataUrl,
                            width: canvas.width,
                            height: canvas.height
                        };
                    } catch (error) {
                        console.error('Capture error:', error);
                        return { success: false, error: error.message };
                    }
                })()
            `);

            if (result.success && result.dataUrl) {
                // base64 데이터를 파일로 저장
                const base64Data = result.dataUrl.replace(/^data:image\/jpeg;base64,/, '');
                const buffer = Buffer.from(base64Data, 'base64');

                await fsp.writeFile(filePath, buffer);

                if (this.debugLevel > 0) {
                    console.log(
                        `[WinCapture] Frame captured: ${fileName} (${buffer.length} bytes)`
                    );
                }

                // 프레임 카운터 증가
                this.frameIndex++;
                this.currentFileIndex++;

                // 저장된 파일 경로 반환 (프레임 감지기에서 처리)
                return filePath;
            } else {
                console.error(`[WinCapture] Capture failed:`, result.error);
                return null;
            }
        } catch (error) {
            console.error(`[WinCapture] Error capturing frame:`, error);
            return null;
        }
    }

    // 캡처 시작 (Linux capture와 동일한 인터페이스)
    async start() {
        if (this.isRunning) {
            console.warn('[WinCapture] Already running');
            return;
        }

        try {
            // 저장 디렉토리 생성
            await this.#ensureDirectory();

            // 카메라 정보 설정 (고정값)
            this.camInfo = {
                format: 'MJPG',
                width: this.width,
                height: this.height,
                fps: this.fps,
            };

            console.log(
                `[WinCapture] Starting capture: ${this.width}x${this.height}@${this.fps}fps`
            );

            this.isRunning = true;

            // 연결됨 이벤트 발생
            this.emit('connected', this);

            // 카메라 정보 이벤트 발생 (Linux와 호환)
            setTimeout(() => {
                this.emit('data', {
                    type: 0x200, // CAP_MSG_TYPE_CAM_INFO
                    payload: this.camInfo,
                });
            }, 100);

            // 프레임 캡처 루프 시작 (안정성을 위해 최소 간격 제한)
            const minInterval = 33; // 최소 33ms 간격 (최대 30fps)
            const targetInterval = 1000 / this.fps;
            const intervalMs = Math.max(minInterval, targetInterval);

            console.log(
                `[WinCapture] Using capture interval: ${intervalMs}ms (${(1000 / intervalMs).toFixed(1)}fps)`
            );

            this.captureInterval = setInterval(async () => {
                try {
                    await this.#captureFrame();
                } catch (error) {
                    console.error('[WinCapture] Frame capture error:', error);
                }
            }, intervalMs);

            console.log('[WinCapture] Windows webcam capture started successfully');
        } catch (error) {
            console.error('[WinCapture] Failed to start capture:', error);
            this.emit('error', error);
            throw error;
        }
    }

    // 캡처 중지 (Linux capture와 동일한 인터페이스)
    async stop() {
        if (!this.isRunning) {
            return;
        }

        console.log('[WinCapture] Stopping capture...');

        this.isRunning = false;

        if (this.captureInterval) {
            clearInterval(this.captureInterval);
            this.captureInterval = null;
        }

        // 웹캠 스트림 중지 요청
        if (
            this.mainWindow &&
            !this.mainWindow.isDestroyed() &&
            this.mainWindow.webContents &&
            !this.mainWindow.webContents.isDestroyed()
        ) {
            try {
                await this.mainWindow.webContents.executeJavaScript(`
                    if (window.__winCaptureStream) {
                        window.__winCaptureStream.getTracks().forEach(track => track.stop());
                        window.__winCaptureStream = null;
                    }
                    if (window.__captureVideo) {
                        window.__captureVideo = null;
                    }
                    if (window.__captureCanvas) {
                        window.__captureCanvas = null;
                    }
                `);
            } catch (error) {
                console.error('[WinCapture] Error stopping webcam:', error);
            }
        } else {
            console.log(
                '[WinCapture] Skipping webcam cleanup - window/webContents already destroyed'
            );
        }

        console.log('[WinCapture] Capture stopped');
    }

    // 녹화 시작 (HandRouter 호환성을 위한 구현)
    async startRecording() {
        // frameHandler의 녹화 상태도 확인 (버튼으로 이미 녹화 중일 수 있음)
        const isFrameHandlerRecording = this.frameHandler && this.frameHandler.isRecording;

        if (this.isRecording || isFrameHandlerRecording) {
            console.log('[WinCapture] Already recording, ignoring start request');
            // frameHandler가 녹화 중이면 내부 상태도 동기화
            if (isFrameHandlerRecording && !this.isRecording) {
                this.isRecording = true;
                this.recordingStartTime = Date.now();
            }
            return true;
        }

        try {
            // FrameHandler를 직접 호출하여 실제 녹화 시작
            if (this.frameHandler) {
                console.log('[WinCapture] Triggering actual recording via FrameHandler');
                await this.frameHandler.enableRecording();
                console.log('[WinCapture] FrameHandler.enableRecording() called');
            } else {
                console.error('[WinCapture] Cannot start recording - FrameHandler not available');
            }

            this.isRecording = true;
            this.recordingStartTime = Date.now();
            console.log('[WinCapture] Recording started');
            this.emit('recordingStarted', {
                startTime: this.recordingStartTime,
                saveDir: this.saveDir,
            });
            return true;
        } catch (error) {
            this.isRecording = false;
            this.recordingStartTime = null;
            console.error('[WinCapture] Failed to start recording:', error);
            this.emit('recordingError', error);
            return false;
        }
    }

    // 녹화 중지 (HandRouter 호환성을 위한 구현)
    async stopRecording() {
        // frameHandler의 녹화 상태도 확인 (버튼으로 시작한 녹화도 제스처로 중지 가능)
        const isFrameHandlerRecording = this.frameHandler && this.frameHandler.isRecording;

        if (!this.isRecording && !isFrameHandlerRecording) {
            console.log('[WinCapture] Not recording, ignoring stop request');
            return false;
        }

        try {
            // FrameHandler를 직접 호출하여 실제 녹화 중지
            if (this.frameHandler && this.frameHandler.isRecording) {
                console.log('[WinCapture] Stopping actual recording via FrameHandler');
                await this.frameHandler.disableRecording();
                console.log('[WinCapture] FrameHandler.disableRecording() called');
            } else if (!this.frameHandler) {
                console.error('[WinCapture] Cannot stop recording - FrameHandler not available');
            }

            const duration = this.recordingStartTime ? Date.now() - this.recordingStartTime : 0;
            this.isRecording = false;
            console.log(`[WinCapture] Recording stopped after ${duration}ms`);
            this.emit('recordingStopped', {
                startTime: this.recordingStartTime,
                duration: duration,
                saveDir: this.saveDir,
            });
            this.recordingStartTime = null;
            return true;
        } catch (error) {
            console.error('[WinCapture] Failed to stop recording:', error);
            this.emit('recordingError', error);
            return false;
        }
    }

    // 녹화 상태 조회 (HandRouter 호환성을 위한 구현)
    getRecordingStatus() {
        return {
            isRecording: this.isRecording,
            startTime: this.recordingStartTime,
            duration: this.isRecording ? Date.now() - this.recordingStartTime : 0,
        };
    }

    // 메시지 전송 (Linux 호환성을 위한 더미 구현)
    send(type, payload = null) {
        if (this.debugLevel > 0) {
            console.log(`[WinCapture] Send message: type=${type}, payload=${payload}`);
        }
        // Windows에서는 실제 구현 불필요 (V4L2 소켓 통신 대체)
    }

    // 소멸자 (Linux capture와 동일한 인터페이스)
    async destroy() {
        try {
            if (
                this.mainWindow &&
                !this.mainWindow.isDestroyed() &&
                this.mainWindow.webContents &&
                !this.mainWindow.webContents.isDestroyed()
            ) {
                await this.stop();
            } else {
                // 윈도우가 이미 파괴된 경우 캡쳐 인터벌만 정리
                if (this.captureInterval) {
                    clearInterval(this.captureInterval);
                    this.captureInterval = null;
                    console.log('[WinCapture] Cleaned up capture interval only');
                }
            }
        } catch (error) {
            console.error('[WinCapture] Error during destroy:', error);
        } finally {
            this.mainWindow = null;
            console.log('[WinCapture] Device destroyed');
        }
    }
}

// Linux capture.js와 동일한 메시지 타입 상수
const CAP_MSG_TYPE_REQ_INFO = 0x100;
const CAP_MSG_TYPE_CAM_INFO = 0x200;

module.exports = {
    Device: WinDevice,
    CAP_MSG_TYPE_REQ_INFO,
    CAP_MSG_TYPE_CAM_INFO,
};
