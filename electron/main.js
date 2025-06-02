// Electron 애플리케이션 메인 프로세스
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fsp = require('fs').promises;
const watcher = require('../backend/src/frame-watcher');

// 윈도우 설정
const WINDOW_CONFIG = {
    width: 1024,
    height: 920
};

// 경로 설정
const PATHS = {
    LIVE_DIR: path.join(__dirname, '../frontend/public/live'), // 라이브 프레임 저장 경로
    RECORD_DIR: path.join(__dirname, '../frontend/public/record'), // 녹화 프레임 저장 경로
    PRELOAD: path.join(__dirname, '../backend/src/preload.js'), // Preload 스크립트
    INDEX: path.join(__dirname, '../frontend/public/index.html') // 메인 HTML
};

// 프레임 처리 및 관리 클래스
class FrameHandler {
    constructor() {
        this.watcher = null; // 프레임 감지기
        this.isStreaming = false; // 스트리밍 상태
        this.isRecording = false; // 녹화 상태
        this.frameCounter = 0; // 녹화 프레임 카운터
        this.currentWindow = null; // 현재 창
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

            const frameFiles = files.filter(file =>
                file.startsWith('frame') && file.endsWith('.jpg')
            );

            await Promise.all(
                frameFiles.map(file => fsp.unlink(path.join(dirPath, file)))
            );

            if (frameFiles.length > 0) {
                console.log(`${dirName} directory cleared (${frameFiles.length} files)`);
            }
        } catch (error) {
            console.error(`Error managing ${dirName} directory:`, error);
            throw error;
        }
    }

    // 스트리밍 시작
    async startStreaming(win) {
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
                this.watcher = await watcher.start(async (type, data, frameNumber) => {
                    console.log(`Streaming mode - Send frame: ${frameNumber}`);

                    if (type === 'frame-data') {
                        // 바이너리 데이터 직접 전송
                        win.webContents.send('frame-data', data);
                    } else {
                        // fallback: path 방식
                        win.webContents.send('frame-path', data);
                    }

                    // Recording이 활성화되어 있으면 파일 저장
                    if (this.isRecording && type === 'frame-data') {
                        await this.saveFrameToRecord(data);
                    }
                }, {
                    liveDir: PATHS.LIVE_DIR,
                    dataType: 'bin'  // 바이너리 데이터 모드 사용
                });
            }

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
            // Record 디렉토리 초기화
            await this.clearDirectory(PATHS.RECORD_DIR, 'Record');

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
    async saveFrameToRecord(data) {
        if (!this.isRecording) return;

        const fileName = `frame${this.frameCounter}.jpg`;
        const destPath = path.join(PATHS.RECORD_DIR, fileName);

        try {
            await fsp.writeFile(destPath, data);
            this.frameCounter++;
            console.log(`Saved frame ${this.frameCounter - 1} to record directory`);
        } catch (error) {
            console.error('Error saving frame:', error);
            throw error;
        }
    }

    // 스트리밍 중지
    async stopStreaming() {
        console.log('Stopping streaming mode...');

        // Recording이 활성화되어 있으면 먼저 비활성화
        if (this.isRecording) {
            await this.disableRecording();
        }

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
        this.currentWindow = null;
    }

    // 현재 상태 반환
    getStatus() {
        return {
            isStreaming: this.isStreaming,
            isRecording: this.isRecording,
            frameCounter: this.frameCounter
        };
    }
}

// 전역 FrameHandler 인스턴스
const frameHandler = new FrameHandler();

// IPC 이벤트 핸들러
function setupIpcHandlers(win) {
    const handlers = {
        'start-live': () => frameHandler.startStreaming(win),
        'stop-live': () => frameHandler.stopStreaming(),
        'start-record': () => frameHandler.enableRecording(),
        'stop-record': () => frameHandler.disableRecording(),
        'log-message': (event, message) => console.log('APP: ' + message)
    };

    Object.entries(handlers).forEach(([event, handler]) => {
        ipcMain.on(event, handler);
    });
}

// 메인 창 생성 및 설정
function createWindow() {
    const win = new BrowserWindow({
        width: WINDOW_CONFIG.width,
        height: WINDOW_CONFIG.height,
        frame: true,
        resizable: true,
        fullscreenable: false,
        webPreferences: {
            contextIsolation: true,
            enableRemoteModule: false,
            preload: PATHS.PRELOAD,
            webSecurity: false
        }
    });

    // 캐시 비활성화
    win.webContents.session.clearCache();
    win.webContents.session.clearStorageData({
        storages: [
            'appcache', 'filesystem', 'indexdb', 'localstorage',
            'shadercache', 'websql', 'serviceworkers', 'cachestorage'
        ],
    });

    win.setMenuBarVisibility(false);
    win.loadFile(PATHS.INDEX);

    // 개발 모드일 때 개발자 도구 열기
    if (process.env.NODE_ENV === 'development') {
        win.webContents.openDevTools();
    }

    setupIpcHandlers(win);
    return win;
}

// 앱 종료 시 리소스 정리
function cleanupApp() {
    console.log('Cleaning up application...');
    frameHandler.stopStreaming();
}

// 앱 준비 완료 시 창 생성
app.whenReady().then(createWindow);

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