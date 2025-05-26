const { contextBridge, ipcRenderer } = require('electron');

// 렌더러 프로세스에 안전한 API 노출
contextBridge.exposeInMainWorld('electronAPI', {
    // 라이브 모드 시작
    startLive: () => ipcRenderer.invoke('start-live'),

    // 녹화 모드 시작
    startRecord: () => ipcRenderer.invoke('start-record'),

    // 카메라 중지
    stopCamera: () => ipcRenderer.invoke('stop-camera'),

    // 네이티브 라이브러리 상태 확인
    checkNativeLibrary: () => ipcRenderer.invoke('check-native-library')
});

console.log('[Preload] Electron API exposed to renderer process');