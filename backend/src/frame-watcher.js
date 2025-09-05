const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const HandRouter = require('./hand-router');

const debugLevel = 0;

// 활성 watcher Set
let activeWatchers = new Set();

// 핸드 라우터 인스턴스
let handRouter = null;
// 포즈 라우터 인스턴스
let poseRouter = null;

// 핸드 라우터 프레임 전송 상태 추적
let handRouterState = {
    lastSentTime: 0,
    isFirstSend: true,
    hasLoggedStart: false
};

// HandRouter 인스턴스 설정 함수
function setHandRouter(handRouterInstance) {
    handRouter = handRouterInstance;
    console.log('[FrameWatcher] HandRouter instance set:', !!handRouter);
    if (handRouter) {
        console.log('[FrameWatcher] HandRouter isEnabled:', handRouter.isEnabled);
    }
    // HandRouter가 재설정되면 상태 초기화
    handRouterState.isFirstSend = true;
    handRouterState.hasLoggedStart = false;
}

// PoseRouter 인스턴스 설정 함수
function setPoseRouter(poseRouterInstance) {
    poseRouter = poseRouterInstance;
    console.log('[FrameWatcher] PoseRouter instance set:', !!poseRouter);
    if (poseRouter) {
        console.log('[FrameWatcher] PoseRouter isEnabled:', poseRouter.isEnabled);
    }
}

// HandRouter 프레임 전송 로그 관리 함수
function logHandRouterFrame(type) {
    const now = Date.now();
    const timeSinceLastSend = now - handRouterState.lastSentTime;
    
    // 첫 번째 전송이거나 5초 이상 중단되었다가 재시작하는 경우에만 로그
    if (handRouterState.isFirstSend || timeSinceLastSend > 5000) {
        if (handRouterState.isFirstSend) {
            console.log(`[FrameWatcher] Starting HandRouter frame processing (${type})`);
            handRouterState.isFirstSend = false;
        } else {
            console.log(`[FrameWatcher] Resuming HandRouter frame processing after ${Math.round(timeSinceLastSend/1000)}s (${type})`);
        }
        handRouterState.hasLoggedStart = true;
    }
    
    handRouterState.lastSentTime = now;
}

// 주기적으로 HandRouter 중단 상태 확인
setInterval(() => {
    if (handRouter && handRouter.isEnabled && handRouterState.hasLoggedStart) {
        const now = Date.now();
        const timeSinceLastSend = now - handRouterState.lastSentTime;
        
        // 10초 이상 프레임이 안 들어오면 중단으로 간주
        if (timeSinceLastSend > 10000) {
            console.log(`[FrameWatcher] HandRouter frame processing stopped`);
            handRouterState.hasLoggedStart = false; // 중단 로그를 한 번만 찍기 위해
        }
    }
}, 5000); // 5초마다 체크

// 프레임 감시 설정 객체
const FRAME_WATCHER_CONFIG = Object.freeze({
    FRAME_PATTERN: /^frame\d+\.jpg$/i, // 감시 대상 프레임 파일명 패턴
    WATCH_OPTIONS: {
        // Chokidar 감시 옵션
        persistent: true,
        ignoreInitial: true,
        usePolling: false,
        depth: 0,
        awaitWriteFinish: {
            stabilityThreshold: 100,
            pollInterval: 50
        }
    },
    DEFAULT_LIVE_DIR: '../../frontend/public/live', // 기본 감시 디렉토리
    RETRY: {
        // 오류 시 재시도 설정
        MAX_ATTEMPTS: 3,
        DELAY_MS: 1000,
    },
});

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
function handleFrameEvent(callback, eventType, filePath, state, dataType) {
    if (!isTargetFrameFile(filePath)) {
        return;
    }

    const frameNumber = state.frameCount++;

    if (debugLevel > 0)
        console.log(`[FrameWatcher] Frame ${eventType}: ${filePath} (${frameNumber})`);

    try {
        if (dataType === 'bin') {
            // 바이너리 데이터로 파일 읽기
            try {
                const data = fs.readFileSync(filePath);
                callback('frame-data', data, frameNumber);
                // 핸드 라우터에서 프레임 처리
                if (handRouter && handRouter.isEnabled) {
                    logHandRouterFrame('binary');
                    handRouter.processFrame(data);
                }
                // 포즈 라우터에서 프레임 처리
                if (poseRouter && poseRouter.isEnabled) {
                    poseRouter.processFrame(data);
                }
            } catch (error) {
                console.error(`[FrameWatcher] Error reading file as binary:`, error);
                // 에러 발생시 path 방식으로 fallback
                callback('frame-path', filePath, frameNumber);
                // path 방식으로 핸드 라우터 처리
                if (handRouter && handRouter.isEnabled) {
                    logHandRouterFrame('path fallback');
                    handRouter.processImagePath(filePath);
                }
                // path 방식으로 포즈 라우터 처리
                if (poseRouter && poseRouter.isEnabled) {
                    poseRouter.processImagePath(filePath);
                }
            }
        } else {
            // 기존 path 방식
            callback('frame-path', filePath, frameNumber);
            // path 방식으로 핸드 라우터 처리
            if (handRouter && handRouter.isEnabled) {
                logHandRouterFrame('path');
                handRouter.processImagePath(filePath);
            }
            // path 방식으로 포즈 라우터 처리
            if (poseRouter && poseRouter.isEnabled) {
                poseRouter.processImagePath(filePath);
            }
        }
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
    const dataType = options.dataType || 'path'; // 'bin' 또는 'path' (기본값: 'path')
    const state = { frameCount: 0 };
    const captureDevice = options.captureDevice || null;
    // HandRouter는 main.js에서 초기화되므로 여기서는 초기화하지 않음

    // 디렉토리 존재 확인 및 생성
    await ensureDirectoryExists(liveDir);

    console.log(`[FrameWatcher] Starting to watch directory: ${liveDir} (dataType: ${dataType})`);

    // chokidar로 디렉토리 감시 시작
    const watcher = chokidar.watch(liveDir, FRAME_WATCHER_CONFIG.WATCH_OPTIONS);

    // 활성 watcher 추가
    activeWatchers.add(watcher);
    console.log(`[FrameWatcher] Active watchers count: ${activeWatchers.size}`);

    // 에러 발생 시 재시작 시도 카운터
    let restartAttempts = 0;

    // 이벤트 핸들러 등록
    watcher
        .on('add', (filePath) => {
            handleFrameEvent(onChangeCallback, 'add', filePath, state, dataType);
        })
        .on('change', (filePath) => {
            handleFrameEvent(onChangeCallback, 'change', filePath, state, dataType);
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
                console.log(
                    `[FrameWatcher] Attempting restart (${restartAttempts}/${FRAME_WATCHER_CONFIG.RETRY.MAX_ATTEMPTS})...`
                );

                try {
                    await stop(watcher);
                    await new Promise((resolve) =>
                        setTimeout(resolve, FRAME_WATCHER_CONFIG.RETRY.DELAY_MS)
                    );

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
        // watcher가 close 메서드를 가지고 있는지 확인
        if (typeof watcher.close === 'function') {
            await watcher.close();
            console.log('[FrameWatcher] File watching stopped');
        } else {
            console.warn('[FrameWatcher] Watcher does not have close method');
        }

        // 활성 watcher에서 제거
        activeWatchers.delete(watcher);
        console.log(
            `[FrameWatcher] Watcher removed. Active watchers count: ${activeWatchers.size}`
        );
    } catch (error) {
        console.error('[FrameWatcher] Error stopping watcher:', error);
        // close 에러가 발생해도 Set에서는 제거
        activeWatchers.delete(watcher);
    }
}

// 모든 활성 watcher 정리
async function stopAll() {
    console.log(`[FrameWatcher] Stopping all active watchers (${activeWatchers.size})`);

    const stopPromises = Array.from(activeWatchers).map((watcher) => stop(watcher));
    await Promise.all(stopPromises);

    // 핸드 라우터 정리
    if (handRouter) {
        handRouter.stop();
        handRouter = null;
        console.log('[FrameWatcher] Hand router stopped');
    }

    activeWatchers.clear();
    console.log('[FrameWatcher] All watchers stopped');
}

// 핸드 라우터 상태 및 통계 조회
function getHandRouterStatus() {
    return handRouter ? handRouter.getStatus() : null;
}

// CommonJS 모듈 export
module.exports = {
    start,
    stop,
    stopAll,
    setHandRouter,
    setPoseRouter,
    getHandRouterStatus,
    // 테스트를 위한 유틸리티 함수들 export
    isTargetFrameFile,
    ensureDirectoryExists,
    FRAME_WATCHER_CONFIG,
};
