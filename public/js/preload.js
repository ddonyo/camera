// Preload script for Electron renderer process
const { contextBridge, ipcRenderer } = require('electron');

// 설정
const CONFIG = Object.freeze({
    USE_SOCKET_IO: false,
    SOCKET_URL: 'http://localhost:3000',
    VALID_CHANNELS: ['frame-path', 'frame-data'],
    LOG_PREFIX: '[Preload]'
});

// Socket.IO 연결 (지연 로딩)
let socket = null;

// Socket.IO 초기화 (필요할 때만)
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

// 채널명 유효성 검사
function isValidChannel(channel) {
    return typeof channel === 'string' && CONFIG.VALID_CHANNELS.includes(channel);
}

// 로그 메시지 전송
function logMessage(message) {
    try {
        ipcRenderer.send('log-message', message);
    } catch (error) {
        console.error(`${CONFIG.LOG_PREFIX} Failed to send log message:`, error);
    }
}

// 이벤트 리스너 등록
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

// 이벤트 전송
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

// 렌더러 프로세스에 안전한 API 노출
contextBridge.exposeInMainWorld('electronAPI', {
    log: logMessage,
    on: registerListener,
    emit: emitEvent,

    // 유틸리티 메서드
    isSocketIOEnabled: () => CONFIG.USE_SOCKET_IO,
    getValidChannels: () => [...CONFIG.VALID_CHANNELS] // 복사본 반환
});

console.log(`${CONFIG.LOG_PREFIX} Electron API exposed to renderer process`);
console.log(`${CONFIG.LOG_PREFIX} Socket.IO enabled: ${CONFIG.USE_SOCKET_IO}`);