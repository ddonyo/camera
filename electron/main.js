// Electron 애플리케이션 메인 프로세스
const { app, BrowserWindow, ipcMain, session } = require('electron'); // [추가] session
const path = require('path');
const fs = require('fs'); // fs 모듈 명시적 임포트
const fsp = require('fs').promises; // 비동기 메서드용
const watcher = require('../backend/src/frame-watcher');
// 플랫폼별 캡처 모듈 동적 로드
const capture =
    process.platform === 'linux'
        ? require('../backend/src/capture')
        : require('../backend/src/win-capture');
const { fork } = require('child_process');
const http = require('http');
const {
    initializeHandRouter,
    getHandRouterInstance,
} = require('../backend/src/routes/hand-detection');

let __backendProc = null;
const BACKEND_PORT = process.env.PORT || 3000;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
const HEALTH_URL = `${BACKEND_URL}/health`;

const debugLevel = 0;
const maxDelay = 10;

const IS_WIN = process.platform === 'win32'; // [추가] 윈도우 감지

// 윈도우 설정
const WINDOW_CONFIG = {
    width: 1920,
    height: 1080,
};

// 경로 설정
const PATHS = {
    LIVE_DIR: path.join(__dirname, '../frontend/public/live'), // 라이브 프레임 저장 경로
    RECORD_DIR: path.join(__dirname, '../frontend/public/record'), // 녹화 프레임 저장 경로
    CONFIG_DIR: path.join(__dirname, '../config'), // 설정 파일 디렉토리
    PRELOAD: path.join(__dirname, '../backend/src/preload.js'), // Preload 스크립트
    INDEX: path.join(__dirname, '../frontend/public/index.html'), // 메인 HTML
    VTON_SAVE_DIR: path.join(__dirname, '../frontend/public/vton'), // vton 이미지 저장 경로 (선택적)
};

// 프레임 처리 및 관리 클래스
class FrameHandler {
    constructor() {
        this.captureDevice = null;
        this.captureInfo = null;
        this.fps = 24;
        this.numDelayedFrames = 0;
        this.delayedFrames = [];
        this.watcher = null; // 프레임 감지기
        this.isStreaming = false; // 스트리밍 상태
        this.isRecording = false; // 녹화 상태
        this.frameCounter = 0; // 녹화 프레임 카운터
        this.currentWindow = null; // 현재 창
        this.handRouterListenersRegistered = false; // HandRouter 이벤트 리스너 등록 여부
    }

    // HandRouter 이벤트 리스너 등록 (한 번만 실행)
    registerHandRouterListeners() {
        if (this.handRouterListenersRegistered) {
            console.log('[FrameHandler] HandRouter listeners already registered');
            return;
        }

        const handRouterInstance = getHandRouterInstance();
        if (!handRouterInstance) {
            console.log('[FrameHandler] HandRouter instance not available yet');
            return;
        }

        console.log('[FrameHandler] Registering HandRouter event listeners');

        // HandRouter 이벤트를 프론트엔드로 전달
        handRouterInstance.on('recordingStarted', (data) => {
            const allWindows = BrowserWindow.getAllWindows();
            for (const window of allWindows) {
                if (window.webContents) {
                    window.webContents.send('recording-started', data);
                }
            }
        });

        handRouterInstance.on('recordingStopped', (data) => {
            const allWindows = BrowserWindow.getAllWindows();
            for (const window of allWindows) {
                if (window.webContents) {
                    window.webContents.send('recording-stopped', data);
                }
            }
        });

        // Dwell progress 이벤트를 프론트엔드로 전달
        handRouterInstance.on('dwellProgress', (data) => {
            if (this.currentWindow && this.currentWindow.webContents) {
                this.currentWindow.webContents.send('roi-dwell-progress', data);
            }
        });

        this.handRouterListenersRegistered = true;
        console.log('[FrameHandler] HandRouter event listeners registered successfully');
    }

    // HandRouter 이벤트 리스너 정리
    cleanupHandRouterListeners() {
        if (!this.handRouterListenersRegistered) {
            return;
        }

        const handRouterInstance = getHandRouterInstance();
        if (handRouterInstance) {
            console.log('[FrameHandler] Cleaning up HandRouter event listeners');
            handRouterInstance.removeAllListeners('recordingStarted');
            handRouterInstance.removeAllListeners('recordingStopped');
            handRouterInstance.removeAllListeners('dwellProgress');
            this.handRouterListenersRegistered = false;
        }
    }

    // 디렉토리 내 프레임 파일 정리
    async clearDirectory(dirPath, dirName) {
        try {
            const files = await fsp.readdir(dirPath).catch(async (error) => {
                if (error.code === 'ENOENT') {
                    await fsp.mkdir(dirPath, { recursive: true });
                    console.log(`${dirName} directory created`);
                    return [];
                }
                throw error;
            });

            const frameFiles = files.filter(
                (file) => file.startsWith('frame') && file.endsWith('.jpg')
            );

            await Promise.all(
                frameFiles.map(async (file) => {
                    try {
                        await fsp.unlink(path.join(dirPath, file));
                    } catch (error) {
                        // 파일이 이미 없는 경우는 무시
                        if (error.code !== 'ENOENT') {
                            console.error(`Error deleting ${file}:`, error.message);
                        }
                    }
                })
            );

            if (frameFiles.length > 0) {
                console.log(`${dirName} directory cleared (${frameFiles.length} files)`);
            }
        } catch (error) {
            console.error(`Error managing ${dirName} directory:`, error);
            throw error;
        }
    }

    async startCapture(options = {}) {
        if (!this.captureDevice) {
            const { delay = 0 } = options;

            this.numDelayedFrames = this.fps * delay;
            this.delayedFrames = [];

            const numFiles = this.fps * maxDelay + 4;

            console.log(
                `Starting capture with fps: ${this.fps}, delay: ${delay}, numFiles: ${numFiles}`
            );

            const device = new capture.Device({
                saveDir: PATHS.LIVE_DIR,
                fileFmt: 'frame%d.jpg',
                width: 1920,
                height: 1080,
                numFiles: numFiles,
                fps: this.fps,
                //useStdout: true, // 카메라 데몬 로그 출력
                //debugLevel: 1,
            });

            device.on('connected', () => {
                console.log('Device connected');
                //device.send(capture.CAP_MSG_TYPE_REQ_INFO);
            });

            // Windows에서는 메인 윈도우 참조를 캡처 디바이스에 전달
            if (process.platform !== 'linux' && this.currentWindow) {
                device.setMainWindow(this.currentWindow);
                // FrameHandler도 전달하여 직접 녹화 제어 가능하게 함
                device.setFrameHandler(this);
            }

            device.on('data', (msg) => {
                if (msg.type === capture.CAP_MSG_TYPE_CAM_INFO) {
                    const info = msg.payload;
                    console.log(
                        `Cam Info(${info.format}, ${info.width}x${info.height}, ${info.fps}fps)`
                    );
                    this.captureInfo = info;
                } else {
                    console.log(`Received Message : ${msg.type},${msg.payload}`);
                }
            });

            device.on('error', (err) => {
                console.log(`Device error : ${err}`);
            });

            await device.start();

            this.captureDevice = device;

            try {
                console.log('[Main] Initializing hand detection system...');
                console.log('[Main] Device available for HandRouter:', !!device);

                initializeHandRouter(device, this);
                console.log('[Main] initializeHandRouter called with frameHandler');

                // Ensure main window reference is set again after HandRouter initialization
                if (process.platform !== 'linux' && this.currentWindow) {
                    device.setMainWindow(this.currentWindow);
                    device.setFrameHandler(this); // FrameHandler도 재설정
                    console.log(
                        '[Main] Main window and FrameHandler re-assigned to capture device after HandRouter init'
                    );
                }

                // HandRouter 인스턴스를 frame-watcher와 device에 전달
                const handRouterInstance = getHandRouterInstance();
                console.log('[Main] HandRouter instance retrieved:', !!handRouterInstance);

                if (handRouterInstance) {
                    console.log('[Main] HandRouter isEnabled:', handRouterInstance.isEnabled);
                    watcher.setHandRouter(handRouterInstance);
                    console.log('[Main] HandRouter connected to frame-watcher');

                    // Windows에서는 HandRouter를 device에도 설정
                    if (process.platform !== 'linux' && device.setHandRouter) {
                        device.setHandRouter(handRouterInstance);
                        console.log('[Main] HandRouter connected to WinDevice');
                    }

                    // HandRouter 이벤트 리스너 등록 (FrameHandler에서 한 번만 등록)
                    this.registerHandRouterListeners();

                    // HandRouter 시작
                    try {
                        await handRouterInstance.start();
                        console.log('[Main] HandRouter started successfully');
                    } catch (startError) {
                        console.error('[Main] Failed to start HandRouter:', startError);
                    }
                } else {
                    console.error('[Main] HandRouter instance is null - initialization failed');
                }

                console.log('[Main] Hand detection system initialized successfully');
            } catch (handError) {
                console.warn('[Main] Failed to initialize hand detection:', handError.message);
            }
        }
    }

    async stopCapture() {
        if (this.captureDevice) {
            await this.captureDevice.destroy();
            this.captureDevice = null;
            this.captureInfo = null;
        }
    }

    async sendFrame(win, item) {
        if (item.type === 'frame-data') {
            // 바이너리 데이터 직접 전송
            win.webContents.send('frame-data', item.data);
        } else {
            // fallback: path 방식
            win.webContents.send('frame-path', item.data);
        }
    }

    setDelay(delay) {
        if (delay > maxDelay) delay = maxDelay;
        this.numDelayedFrames = this.fps * delay;
        console.log(`Set Delay=${delay}, Frames=${this.numDelayedFrames}`);
    }

    // 스트리밍 시작
    async startStreaming(win, options = {}) {
        if (this.isStreaming) {
            console.log('Streaming already active');
            return;
        }

        console.log('Starting streaming mode...');
        this.currentWindow = win;

        try {
            // Live 디렉토리 초기화
            await this.clearDirectory(PATHS.LIVE_DIR, 'Live');

            // Frame Watcher 시작 (최초에만)
            if (!this.watcher) {
                let lastWatcherTime = null;
                let numWaitFrames = 0;
                this.watcher = await watcher.start(
                    async (type, data, frameNumber) => {
                        const currentTime = Date.now();
                        if (!lastWatcherTime) lastWatcherTime = currentTime;
                        const interval = currentTime - lastWatcherTime;
                        lastWatcherTime = currentTime;

                        let item = { type: type, number: frameNumber, data: data };

                        if (frameNumber > 0) {
                            // 첫장은 무조건 출력 후 처리
                            if (this.numDelayedFrames > 0) {
                                // Delay 모드인 경우
                                this.delayedFrames.push(item);
                                const numAvailFrames =
                                    this.delayedFrames.length - this.numDelayedFrames;

                                if (numAvailFrames <= 0) {
                                    const waitTime = Math.floor(-numAvailFrames / this.fps);
                                    if (numWaitFrames <= waitTime) {
                                        numWaitFrames++;
                                        console.log(
                                            `Waiting capture frames ${this.delayedFrames.length}/${this.numDelayedFrames}`
                                        );
                                        return;
                                    }
                                    numWaitFrames = 0;
                                    item = this.delayedFrames.shift();
                                } else {
                                    // Delay 값이 작아지면서 큐에 존재하는 프레임이 여러개인 경우 처리
                                    if (numAvailFrames > 1) {
                                        const count = Math.ceil(numAvailFrames / this.fps);
                                        this.delayedFrames.splice(0, count);
                                    }
                                    item = this.delayedFrames.shift();
                                }
                            } else {
                                if (this.delayedFrames.length > 0) {
                                    // Delay에서 Live로 전환된 경우
                                    this.delayedFrames.push(item);

                                    const count = Math.ceil(this.delayedFrames.length / this.fps);
                                    this.delayedFrames.splice(0, count);

                                    item = this.delayedFrames.shift();

                                    if (this.delayedFrames.length === 0) {
                                        console.log('Delay To Live Transition');
                                    }
                                }
                            }
                        }

                        if (debugLevel > 0)
                            console.log(
                                `Streaming mode - Frame: ${item.number}, Interval: ${interval}ms`
                            );

                        await this.sendFrame(win, item);

                        // Recording이 활성화되어 있으면 파일 저장
                        if (this.isRecording) {
                            await this.saveFrameToRecord(item);
                        }
                    },
                    {
                        liveDir: PATHS.LIVE_DIR,
                        dataType: 'path',
                    }
                );
            }

            await this.startCapture(options);

            this.isStreaming = true;
            console.log('Streaming mode started successfully');
        } catch (error) {
            console.error('Error starting streaming mode:', error);
            await this.stopStreaming();
            throw error;
        }
    }

    // 녹화 활성화 (스트리밍 중)
    async enableRecording() {
        if (!this.isStreaming) {
            throw new Error('Cannot enable recording: streaming not active');
        }

        if (this.isRecording) {
            console.log('Recording already enabled');
            return;
        }

        console.log('Enabling recording...');

        try {
            // Record 디렉토리 초기화를 백그라운드에서 비동기적으로 처리
            await this.clearDirectory(PATHS.RECORD_DIR, 'Record');

            // rec_info.json 파일 쓰기를 비동기적으로 처리
            if (this.captureInfo) {
                const filePath = path.join(PATHS.RECORD_DIR, 'rec_info.json');
                const jsonData = JSON.stringify(this.captureInfo, null, 2);

                fsp.writeFile(filePath, jsonData)
                    .then(() => {
                        console.log(`Saved ${filePath}`);
                    })
                    .catch((error) => {
                        console.error('Error saving rec_info.json:', error);
                    });
            }

            this.isRecording = true;
            this.frameCounter = 0;

            console.log('Recording enabled successfully');
        } catch (error) {
            console.error('Error enabling recording:', error);
            this.isRecording = false;
            throw error;
        }
    }

    // 녹화 비활성화
    async disableRecording() {
        if (!this.isRecording) {
            console.log('Recording already disabled');
            return;
        }

        console.log('Disabling recording...');
        const totalFrames = this.frameCounter;
        this.isRecording = false;
        console.log(`Recording disabled. Total frames recorded: ${totalFrames}`);
        return totalFrames;
    }

    // 프레임 데이터 저장 (녹화 중)
    async saveFrameToRecord(item) {
        if (!this.isRecording) return;

        const count = this.frameCounter++;

        const fileName = `frame${count}.jpg`;
        const destPath = path.join(PATHS.RECORD_DIR, fileName);

        try {
            // 파일 쓰기를 비동기적으로 처리하여 UI 블로킹 방지
            if (item.type === 'frame-data') {
                await fsp.writeFile(destPath, item.data);
            } else {
                await fsp.copyFile(item.data, destPath);
            }

            if (debugLevel > 0) console.log(`Saved frame ${count} to record directory ${destPath}`);
        } catch (error) {
            console.error('Error preparing frame save:', error);
        }
    }

    // 스트리밍 중지
    async stopStreaming() {
        console.log('Stopping streaming mode...');

        // Recording이 활성화되어 있으면 먼저 비활성화
        if (this.isRecording) {
            await this.disableRecording();
        }

        await this.stopCapture();

        this.isStreaming = false;
        await this.cleanup();
    }

    // 리소스 정리 (Watcher 중지 등)
    async cleanup() {
        if (this.watcher) {
            console.log('[FrameHandler] Cleaning up watcher...');
            await watcher.stop(this.watcher);
            this.watcher = null;
            console.log('[FrameHandler] Watcher cleanup completed');
        }
        
        // HandRouter 이벤트 리스너 정리
        this.cleanupHandRouterListeners();
        
        this.currentWindow = null;
    }

    // 현재 상태 반환
    getStatus() {
        return {
            isStreaming: this.isStreaming,
            isRecording: this.isRecording,
            frameCounter: this.frameCounter,
        };
    }
}

// 전역 FrameHandler 인스턴스
const frameHandler = new FrameHandler();

// IPC 이벤트 핸들러
function setupIpcHandlers(win) {
    const handlers = {
        'start-live': (event, options = {}) => frameHandler.startStreaming(win, options),
        'stop-live': () => frameHandler.stopStreaming(),
        'set-delay': (event, delay) => frameHandler.setDelay(delay),
        'start-record': () => {
            console.log('[Main] Received start-record command');
            return frameHandler.enableRecording();
        },
        'stop-record': () => {
            console.log('[Main] Received stop-record command');
            return frameHandler.disableRecording();
        },
        'update-ui-settings': (event, settings) => {
            console.log('[Main] Updating UI settings:', settings);
            const roiConfig = require('../backend/src/roi-config').getInstance();
            return roiConfig.updateUISettings(settings);
        },
        'get-ui-settings': () => {
            const roiConfig = require('../backend/src/roi-config').getInstance();
            return roiConfig.getUISettings();
        },
        'log-message': (event, message) => console.log('APP: ' + message),
    };

    Object.entries(handlers).forEach(([event, handler]) => {
        ipcMain.on(event, handler);
        console.log(`[Main] IPC handler registered for: ${event}`);
    });

    // 전체화면 관련 IPC 핸들러들 (handle 방식으로 추가)
    ipcMain.handle('set-fullscreen', async (event, fullscreen) => {
        console.log('IPC: set-fullscreen called with:', fullscreen);
        win.setFullScreen(fullscreen);
        return true;
    });

    ipcMain.handle('get-fullscreen', async () => {
        return win.isFullScreen();
    });

    ipcMain.handle('toggle-fullscreen', async () => {
        const isFullscreen = win.isFullScreen();
        win.setFullScreen(!isFullscreen);
        return !isFullscreen;
    });

    // vton 이미지 저장 IPC 핸들러
    ipcMain.handle('save-vton-image', async (event, { url, filename }) => {
        return new Promise((resolve, reject) => {
            const base64Data = url.split(',')[1];
            const buffer = Buffer.from(base64Data, 'base64');
            const savePath = path.join(PATHS.VTON_SAVE_DIR, filename);
            const dir = path.dirname(savePath);

            // 동기 메서드 사용 (fs.existsSync)
            if (!fs.existsSync(dir)) {
                fsp.mkdir(dir, { recursive: true }).catch((err) => reject(err));
            }
            fsp.writeFile(savePath, buffer)
                .then(() => {
                    console.log(`result saved as ${filename}`);
                    resolve(savePath);
                })
                .catch((err) => reject(err));
        });
    });

    // ROI 플립 모드 업데이트 IPC 핸들러
    ipcMain.handle('update-roi-flip-mode', async (event, flipMode) => {
        console.log(`[Main] ROI flip mode update requested: ${flipMode}`);
        try {
            const roiConfigPath = path.join(PATHS.CONFIG_DIR, 'roi.json');
            const config = JSON.parse(fs.readFileSync(roiConfigPath, 'utf8'));
            config.flip_mode = flipMode;
            fs.writeFileSync(roiConfigPath, JSON.stringify(config, null, 2));
            console.log(`[Main] ROI flip mode updated to: ${flipMode}`);
            return true;
        } catch (error) {
            console.error('[Main] Failed to update ROI flip mode:', error);
            return false;
        }
    });

    // ROI 설정 업데이트 IPC 핸들러 (crop_mode 등)
    ipcMain.handle('update-roi-config', async (event, updates) => {
        console.log(`[Main] ROI config update requested:`, updates);
        try {
            const roiConfigPath = path.join(PATHS.CONFIG_DIR, 'roi.json');
            const config = JSON.parse(fs.readFileSync(roiConfigPath, 'utf8'));

            // 업데이트 적용
            Object.assign(config, updates);

            fs.writeFileSync(roiConfigPath, JSON.stringify(config, null, 2));
            console.log(`[Main] ROI config updated:`, updates);
            return true;
        } catch (error) {
            console.error('[Main] Failed to update ROI config:', error);
            return false;
        }
    });
}

// 메인 창 생성 및 설정
function createWindow() {
    const win = new BrowserWindow({
        width: WINDOW_CONFIG.width,
        height: WINDOW_CONFIG.height,
        frame: IS_WIN,
        fullscreen: !IS_WIN,
        resizable: true,
        fullscreenable: true,
        webPreferences: {
            nodeIntegration: true, // contextIsolation 제거 반영
            enableRemoteModule: false,
            preload: PATHS.PRELOAD,
            webSecurity: false,
        },
    });

    // 캐시 비활성화
    win.webContents.session.clearCache();
    win.webContents.session.clearStorageData({
        storages: [
            'appcache',
            'filesystem',
            'indexdb',
            'localstorage',
            'shadercache',
            'websql',
            'serviceworkers',
            'cachestorage',
        ],
    });

    win.setMenuBarVisibility(false);
    win.loadFile(PATHS.INDEX);

    setupIpcHandlers(win);
    return win;
}

// 앱 종료 시 리소스 정리
async function cleanupApp() {
    console.log('Cleaning up application...');
    await frameHandler.stopStreaming();
    await frameHandler.cleanup();
}

function startBackendOnce() {
    if (__backendProc) return;
    const entry = path.join(__dirname, '../backend/src/server.js');

    __backendProc = fork(entry, [], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(BACKEND_PORT) },
        stdio: 'inherit',
    });

    __backendProc.on('exit', (code, signal) => {
        console.log(`[backend] exit code=${code}, signal=${signal}`);
        __backendProc = null;
    });

    __backendProc.on('message', (message) => {
        if (!message || !message.type) return;

        console.log(`[Main] Received backend message:`, message.type);

        const allWindows = BrowserWindow.getAllWindows();
        for (const window of allWindows) {
            if (window.webContents) {
                window.webContents.send(message.type, message.data);
            }
        }
    });
}

function waitForBackend(timeoutMs = 15000, intervalMs = 300) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
        const tick = () => {
            const req = http.get(HEALTH_URL, (res) => {
                if (res.statusCode === 200) {
                    res.resume();
                    return resolve(true);
                }
                res.resume();
                if (Date.now() > deadline) return reject(new Error('Backend health timeout'));
                setTimeout(tick, intervalMs);
            });
            req.on('error', () => {
                if (Date.now() > deadline) return reject(new Error('Backend health timeout'));
                setTimeout(tick, intervalMs);
            });
        };
        tick();
    });
}

// [추가] 카메라 권한 허용(Windows 환경에서 getUserMedia 원활)
app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        console.log(`Permission requested: ${permission}`);
        if (permission === 'media') return callback(true);
        callback(false);
    });
    startBackendOnce();
    try {
        await waitForBackend();
    } catch (e) {
        console.error('[electron] backend not ready:', e);
    }
    createWindow();
});

// 모든 창 종료 시 앱 종료 (macOS 예외)
app.on('window-all-closed', () => {
    cleanupApp();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// 예기치 않은 종료 시 정리 (SIGINT, SIGTERM)
process.on('SIGINT', () => {
    cleanupApp();
    process.exit(0);
});

process.on('SIGTERM', () => {
    cleanupApp();
    process.exit(0);
});

app.on('before-quit', () => {
    if (__backendProc && !__backendProc.killed) {
        try {
            __backendProc.kill('SIGINT');
        } catch (_) {}
    }
});
