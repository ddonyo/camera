// backend/src/preload.js
const { contextBridge, ipcRenderer } = require('electron');

// Preload 스크립트 설정
const CONFIG = Object.freeze({
    USE_SOCKET_IO: false, // Socket.IO 사용 여부
    SOCKET_URL: 'http://localhost:3000', // Socket.IO 서버 URL
    VALID_CHANNELS: [
        'frame-path', 
        'frame-data',
        'recording-started',
        'recording-stopped',
        'hand-detection'
    ], // 유효한 IPC/Socket 채널 목록
    LOG_PREFIX: '[Preload]', // 로그 접두사
});

// Socket.IO 인스턴스 (지연 초기화)
let socket = null;

// Socket.IO 초기화 함수
function initializeSocket() {
    if (!CONFIG.USE_SOCKET_IO) {
        return null;
    }

    if (socket) {
        return socket;
    }

    try {
        const { io } = require('socket.io-client');
        socket = io(CONFIG.SOCKET_URL);

        socket.on('connect', () => {
            console.log(`${CONFIG.LOG_PREFIX} Socket.IO connected`);
        });

        socket.on('disconnect', () => {
            console.log(`${CONFIG.LOG_PREFIX} Socket.IO disconnected`);
        });

        socket.on('connect_error', (error) => {
            console.error(`${CONFIG.LOG_PREFIX} Socket.IO connection error:`, error);
        });

        return socket;
    } catch (error) {
        console.error(`${CONFIG.LOG_PREFIX} Failed to initialize Socket.IO:`, error);
        return null;
    }
}

// 채널 유효성 검사 함수
function isValidChannel(channel) {
    return typeof channel === 'string' && CONFIG.VALID_CHANNELS.includes(channel);
}

// 메인 프로세스로 로그 메시지 전송
function logMessage(message) {
    try {
        ipcRenderer.send('log-message', message);
    } catch (error) {
        console.error(`${CONFIG.LOG_PREFIX} Failed to send log message:`, error);
    }
}

// 이벤트 리스너 등록 (IPC 또는 Socket.IO)
function registerListener(channel, callback) {
    if (!isValidChannel(channel)) {
        console.error(`${CONFIG.LOG_PREFIX} Invalid channel: ${channel}`);
        return;
    }

    if (typeof callback !== 'function') {
        console.error(`${CONFIG.LOG_PREFIX} Callback must be a function`);
        return;
    }

    try {
        if (CONFIG.USE_SOCKET_IO) {
            const socketInstance = initializeSocket();
            if (socketInstance) {
                socketInstance.on(channel, callback);
            } else {
                console.error(`${CONFIG.LOG_PREFIX} Socket.IO not available, falling back to IPC`);
                ipcRenderer.on(channel, (event, ...args) => callback(...args));
            }
        } else {
            ipcRenderer.on(channel, (event, ...args) => callback(...args));
        }
    } catch (error) {
        console.error(`${CONFIG.LOG_PREFIX} Failed to register listener for ${channel}:`, error);
    }
}

// 이벤트 발생 (IPC 또는 Socket.IO)
function emitEvent(event, data) {
    if (!event || typeof event !== 'string') {
        console.error(`${CONFIG.LOG_PREFIX} Event name must be a valid string`);
        return;
    }

    try {
        if (CONFIG.USE_SOCKET_IO) {
            const socketInstance = initializeSocket();
            if (socketInstance) {
                socketInstance.emit(event, data);
            } else {
                console.error(`${CONFIG.LOG_PREFIX} Socket.IO not available, falling back to IPC`);
                ipcRenderer.send(event, data);
            }
        } else {
            ipcRenderer.send(event, data);
        }
    } catch (error) {
        console.error(`${CONFIG.LOG_PREFIX} Failed to emit event ${event}:`, error);
    }
}

// 녹화 상태 변경 이벤트 리스너
ipcRenderer.on('recording-state-changed', (event, data) => {
    // 프론트엔드로 이벤트 전달
    window.dispatchEvent(new CustomEvent('recording-state-changed', { detail: data }));
});

// ROI dwell progress 이벤트 리스너
ipcRenderer.on('roi-dwell-progress', (event, data) => {
    // 프론트엔드로 이벤트 전달
    window.dispatchEvent(new CustomEvent('roi-dwell-progress', { detail: data }));
});

// VTON trigger 이벤트 리스너
ipcRenderer.on('vtonTriggered', (event, data) => {
    // 프론트엔드로 이벤트 전달
    window.dispatchEvent(new CustomEvent('vtonTriggered', { detail: data }));
});

// `electronAPI`를 렌더러 프로세스의 `window` 객체에 노출
contextBridge.exposeInMainWorld('electronAPI', {
    log: logMessage, // 로그 함수
    on: registerListener, // 이벤트 수신 함수
    emit: emitEvent, // 이벤트 송신 함수
    isSocketIOEnabled: () => CONFIG.USE_SOCKET_IO, // Socket.IO 활성화 상태 확인
    getValidChannels: () => [...CONFIG.VALID_CHANNELS], // 유효 채널 목록 반환 (복사본)
    // 전체화면 관련 IPC
    setFullscreen: (fullscreen) => ipcRenderer.invoke('set-fullscreen', fullscreen),
    getFullscreen: () => ipcRenderer.invoke('get-fullscreen'),
    toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
    // VTON 이미지 저장 IPC
    saveVtonImage: (url, filename) => ipcRenderer.invoke('save-vton-image', { url, filename }),
    // ROI 플립 모드 업데이트 IPC
    updateROIFlipMode: (flipMode) => ipcRenderer.invoke('update-roi-flip-mode', flipMode),

    // Generic invoke method for IPC
    invoke: (channel, data) => ipcRenderer.invoke(channel, data),
});

console.log(`${CONFIG.LOG_PREFIX} Electron API exposed to renderer process`);
console.log(`${CONFIG.LOG_PREFIX} Socket.IO enabled: ${CONFIG.USE_SOCKET_IO}`);
