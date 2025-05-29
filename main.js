const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fsp = require('fs').promises;
const watcher = require('./public/js/frame-watcher');

// 상수 정의
const WINDOW_CONFIG = {
    width: 1024,
    height: 920
};

const PATHS = {
    LIVE_DIR: './public/live',
    RECORD_DIR: './public/record',
    PRELOAD: 'public/js/preload.js',
    INDEX: 'public/index.html'
};

// 프레임 관리 클래스
class FrameHandler {
    constructor() {
        this.watcher = null;
        this.recordState = {
            isRecording: false,
            frameCounter: 0
        };
    }

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

    async copyFrameToRecord(sourcePath) {
        if (!this.recordState.isRecording) return;

        const fileName = `frame${this.recordState.frameCounter}.jpg`;
        const destPath = path.join(PATHS.RECORD_DIR, fileName);

        try {
            await fsp.copyFile(sourcePath, destPath);
            this.recordState.frameCounter++;
            console.log(`Copied frame ${this.recordState.frameCounter - 1} to record directory`);
        } catch (error) {
            console.error('Error copying frame:', error);
            throw error;
        }
    }

    async startMode(mode, win) {
        console.log(`Starting ${mode} mode...`);

        // 기존 watcher 정리
        this.cleanup();

        try {
            // 모드별 초기화
            if (mode === 'record') {
                this.recordState = { isRecording: true, frameCounter: 0 };
                await this.clearDirectory(PATHS.RECORD_DIR, 'Record');
            } else {
                await this.clearDirectory(PATHS.LIVE_DIR, 'Live');
            }

            // 프레임 감시 시작
            this.watcher = watcher.start(async (type, webPath, frameNumber) => {
                console.log(`${mode} mode - Send frame: ${frameNumber} - ${webPath}`);
                win.webContents.send('frame-path', webPath);

                // Record 모드일 때만 파일 복사
                if (mode === 'record' && this.recordState.isRecording) {
                    const actualPath = webPath.replace('./', './public/');
                    await this.copyFrameToRecord(actualPath);
                }
            }, { liveDir: PATHS.LIVE_DIR });

            console.log(`${mode} mode started successfully`);
        } catch (error) {
            console.error(`Error starting ${mode} mode:`, error);
            this.cleanup();
            throw error;
        }
    }

    stopMode(mode) {
        console.log(`Stopping ${mode} mode...`);

        if (mode === 'record') {
            const totalFrames = this.recordState.frameCounter;
            this.recordState.isRecording = false;
            console.log(`Record stopped. Total frames recorded: ${totalFrames}`);
        }

        this.cleanup();
    }

    cleanup() {
        if (this.watcher) {
            watcher.stop(this.watcher);
            this.watcher = null;
        }
    }
}

// 전역 프레임 핸들러 인스턴스
const frameHandler = new FrameHandler();

// IPC 이벤트 핸들러 설정
function setupIpcHandlers(win) {
    const handlers = {
        'start-live': () => frameHandler.startMode('live', win),
        'stop-live': () => frameHandler.stopMode('live'),
        'start-record': () => frameHandler.startMode('record', win),
        'stop-record': () => frameHandler.stopMode('record'),
        'log-message': (event, message) => console.log('APP: ' + message)
    };

    Object.entries(handlers).forEach(([event, handler]) => {
        ipcMain.on(event, handler);
    });
}

// 윈도우 생성
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
            preload: path.join(__dirname, PATHS.PRELOAD),
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
    win.loadFile(path.join(__dirname, PATHS.INDEX));

    // 개발 모드일 때 개발자 도구 열기
    if (process.env.NODE_ENV === 'development') {
        win.webContents.openDevTools();
    }

    setupIpcHandlers(win);
    return win;
}

// 앱 정리 함수
function cleanupApp() {
    console.log('Cleaning up application...');
    frameHandler.stopMode('live');
    frameHandler.stopMode('record');
}

// 앱 시작
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    cleanupApp();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// 예상치 못한 종료 시 정리
process.on('SIGINT', () => {
    cleanupApp();
    process.exit(0);
});

process.on('SIGTERM', () => {
    cleanupApp();
    process.exit(0);
});