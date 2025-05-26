const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const koffi = require('koffi');

const libPath = process.platform === 'win32'
    ? path.join(__dirname, 'native/win/libcamctrl.dll')
    : path.join(__dirname, 'native/linux/libcamctrl.so');

let lib;
let runLive, runRec, runStop;
let nativeLibraryAvailable = false;

// 네이티브 라이브러리 로딩 시도
function loadNativeLibrary() {
    try {
        lib = koffi.load(libPath);
        console.log(`[Koffi] Successfully loaded library from: ${libPath}`);

        // 함수 정의 시도
        try {
            runLive = lib.func('run_live', 'int', []);
            console.log('[Koffi] Successfully defined function: run_live');
            runRec = lib.func('run_rec', 'int', []);
            console.log('[Koffi] Successfully defined function: run_rec');
            runStop = lib.func('run_stop', 'int', []);
            console.log('[Koffi] Successfully defined function: run_stop');

            nativeLibraryAvailable = true;
            console.log('[Koffi] All native functions are ready');
        } catch (funcError) {
            console.error('[Koffi] Failed to define functions:', funcError);
            nativeLibraryAvailable = false;
        }
    } catch (loadError) {
        console.error(`[Koffi] Failed to load library from: ${libPath}`, loadError);
        nativeLibraryAvailable = false;
    }
}

// 네이티브 라이브러리 로딩 시도
loadNativeLibrary();

// 사용자에게 라이브러리 상태 알림
function showLibraryStatusDialog(win) {
    if (!nativeLibraryAvailable) {
        dialog.showMessageBox(win, {
            type: 'warning',
            title: '네이티브 라이브러리 로딩 실패',
            message: '카메라 제어 라이브러리를 로드할 수 없습니다.',
            detail: '일부 기능이 제한될 수 있습니다. 파일 재생 기능은 정상적으로 사용할 수 있습니다.',
            buttons: ['확인']
        });
    }
}

// 안전한 네이티브 함수 호출 래퍼
function safeNativeCall(func, funcName) {
    if (!nativeLibraryAvailable || !func) {
        throw new Error(`Native function '${funcName}' is not available. Library loading failed.`);
    }
    return func();
}

// IPC 이벤트 핸들러 등록
ipcMain.handle('start-live', async () => {
    try {
        console.log('[IPC] Starting live mode...');
        const result = safeNativeCall(runLive, 'run_live');
        console.log(`[IPC] Live mode result: ${result}`);
        return { success: true, result };
    } catch (error) {
        console.error('[IPC] Failed to start live mode:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('start-record', async () => {
    try {
        console.log('[IPC] Starting record mode...');
        const result = safeNativeCall(runRec, 'run_rec');
        console.log(`[IPC] Record mode result: ${result}`);
        return { success: true, result };
    } catch (error) {
        console.error('[IPC] Failed to start record mode:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('stop-camera', async () => {
    try {
        console.log('[IPC] Stopping camera...');
        const result = safeNativeCall(runStop, 'run_stop');
        console.log(`[IPC] Stop result: ${result}`);
        return { success: true, result };
    } catch (error) {
        console.error('[IPC] Failed to stop camera:', error);
        return { success: false, error: error.message };
    }
});

// 네이티브 라이브러리 상태 확인 API
ipcMain.handle('check-native-library', async () => {
    return { available: nativeLibraryAvailable };
});

// Electron 메인 윈도우 생성
function createWindow()
{
    const win = new BrowserWindow({
        width: 1024,
        height: 900,
        frame: true,
        resizable: false,
        fullscreenable: false,
        webPreferences: {
            contextIsolation: true,
            enableRemoteModule: false,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    win.setMenuBarVisibility(false);
    win.loadFile(path.join(__dirname, 'public/index.html'));

    // 윈도우가 준비되면 라이브러리 상태 알림
    win.webContents.once('did-finish-load', () => {
        showLibraryStatusDialog(win);
    });
}

// 앱 시작시 윈도우 생성
app.whenReady().then(() =>
{
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});