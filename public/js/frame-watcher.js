const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');

// 프레임 감시 설정
const FRAME_WATCHER_CONFIG = Object.freeze({
    // 감시할 프레임 패턴 (frame0.jpg ~ frame3.jpg)
    FRAME_PATTERN: /^frame[0-3]\.jpg$/i,

    // chokidar 옵션
    WATCH_OPTIONS: {
        persistent: true,
        ignoreInitial: true,
        usePolling: true,
        interval: 100,
        awaitWriteFinish: {
            stabilityThreshold: 100,
            pollInterval: 50
        }
    },

    // 기본 디렉토리
    DEFAULT_LIVE_DIR: './public/live',

    // 재시도 설정
    RETRY: {
        MAX_ATTEMPTS: 3,
        DELAY_MS: 1000
    }
});

// 파일 경로를 웹 경로로 변환
function convertToWebPath(filePath) {
    return filePath
        .replace(/\\/g, '/') // Windows 경로를 웹 경로로 변환
        .replace(/^\.\/public\//, './') // ./public/ 제거
        .replace(/^public\//, './') // public/ 제거
        .replace(/^(?!\.\/)/, './'); // ./로 시작하지 않으면 추가
}

// 파일이 감시 대상 프레임 파일인지 확인
function isTargetFrameFile(filePath) {
    const fileName = path.basename(filePath).toLowerCase();
    return FRAME_WATCHER_CONFIG.FRAME_PATTERN.test(fileName);
}

// 디렉토리 존재 확인 및 생성
async function ensureDirectoryExists(dirPath) {
    try {
        await fs.promises.access(dirPath);
    } catch (error) {
        if (error.code === 'ENOENT') {
            await fs.promises.mkdir(dirPath, { recursive: true });
            console.log(`[FrameWatcher] Directory created: ${dirPath}`);
        } else {
            throw error;
        }
    }
}

// 프레임 변경 이벤트 처리
function handleFrameEvent(callback, eventType, filePath, state) {
    if (!isTargetFrameFile(filePath)) {
        return;
    }

    const webPath = convertToWebPath(filePath);
    const frameNumber = state.frameCount++;

    console.log(`[FrameWatcher] Frame ${eventType}: ${filePath} (${frameNumber})`);

    try {
        callback('frame-path', webPath, frameNumber);
    } catch (error) {
        console.error(`[FrameWatcher] Callback error for ${eventType} event:`, error);
    }
}

// 파일 감시 시작
async function start(onChangeCallback, options = {}) {
    if (typeof onChangeCallback !== 'function') {
        throw new Error('[FrameWatcher] onChangeCallback must be a function');
    }

    const liveDir = options.liveDir || FRAME_WATCHER_CONFIG.DEFAULT_LIVE_DIR;
    const state = { frameCount: 0 };

    // 디렉토리 존재 확인 및 생성
    await ensureDirectoryExists(liveDir);

    console.log(`[FrameWatcher] Starting to watch directory: ${liveDir}`);

    // chokidar로 디렉토리 감시 시작
    const watcher = chokidar.watch(liveDir, FRAME_WATCHER_CONFIG.WATCH_OPTIONS);

    // 에러 발생 시 재시작 시도 카운터
    let restartAttempts = 0;

    // 이벤트 핸들러 등록
    watcher
        .on('add', (filePath) => {
            handleFrameEvent(onChangeCallback, 'add', filePath, state);
        })
        .on('change', (filePath) => {
            handleFrameEvent(onChangeCallback, 'change', filePath, state);
        })
        .on('unlink', (filePath) => {
            if (isTargetFrameFile(filePath)) {
                console.log(`[FrameWatcher] Frame file removed: ${filePath}`);
            }
        })
        .on('ready', () => {
            console.log('[FrameWatcher] Initial scan complete. Ready for changes.');
            restartAttempts = 0; // 성공적으로 시작되면 재시작 카운터 리셋
        })
        .on('error', async (error) => {
            console.error('[FrameWatcher] Watcher error:', error);

            // 재시작 시도
            if (restartAttempts < FRAME_WATCHER_CONFIG.RETRY.MAX_ATTEMPTS) {
                restartAttempts++;
                console.log(`[FrameWatcher] Attempting restart (${restartAttempts}/${FRAME_WATCHER_CONFIG.RETRY.MAX_ATTEMPTS})...`);

                try {
                    await stop(watcher);
                    await new Promise(resolve => setTimeout(resolve, FRAME_WATCHER_CONFIG.RETRY.DELAY_MS));

                    // 재귀적으로 다시 시작 (새로운 watcher 인스턴스 반환)
                    return start(onChangeCallback, options);
                } catch (restartError) {
                    console.error('[FrameWatcher] Restart failed:', restartError);
                }
            }

            // 최대 재시도 횟수 초과 시 에러 전파
            throw error;
        });

    return watcher;
}

// 파일 감시 중지
async function stop(watcher) {
    if (!watcher) {
        console.warn('[FrameWatcher] No watcher to stop');
        return;
    }

    try {
        await watcher.close();
        console.log('[FrameWatcher] File watching stopped');
    } catch (error) {
        console.error('[FrameWatcher] Error stopping watcher:', error);
        // close 에러는 무시 (이미 종료된 경우일 수 있음)
    }
}

// CommonJS 모듈 export
module.exports = {
    start,
    stop,
    // 테스트를 위한 유틸리티 함수들 export
    convertToWebPath,
    isTargetFrameFile,
    ensureDirectoryExists,
    FRAME_WATCHER_CONFIG
};