import { Config, State, ErrorMessages, InfoMessages } from './config.js';
import { ImageLoader, CanvasUtils } from './utils.js';

// 프레임 로딩 및 관리
export class FrameManager {
    constructor() {
        this.frames = [];
        this.currentIndex = 0;
        this.recordFrameIndex = -1;
    }

    clear() {
        this.frames = [];
        this.currentIndex = 0;
        this.recordFrameIndex = -1;
    }

    getCurrentFrame() {
        return this.frames[this.currentIndex] || null;
    }

    getFrameCount() {
        return this.frames.length;
    }

    setCurrentIndex(index) {
        if (index >= 0 && index < this.frames.length) {
            this.currentIndex = index;
        }
    }

    // 라이브 프레임 로드
    async loadLiveFrame() {
        try {
            const frameInfo = ImageLoader.createLiveFrameInfo();
            await ImageLoader.loadImage(frameInfo.path);
            return frameInfo;
        } catch (error) {
            console.error('[FrameManager] Live frame loading failed:', error);
            throw new Error(`${ErrorMessages.LOAD_LIVE_FRAME_FAILED}: ${error.message}`);
        }
    }

    // 녹화 프레임 로드
    async loadRecordFrame(index) {
        try {
            const frameInfo = ImageLoader.createFrameInfo(index, Config.RECORD_FRAME_PATH);
            await ImageLoader.loadImage(frameInfo.path);
            return frameInfo;
        } catch (error) {
            console.error(`[FrameManager] Record frame ${index} loading failed:`, error);
            throw new Error(`${ErrorMessages.LOAD_RECORD_FRAME_FAILED} ${index}: ${error.message}`);
        }
    }

    // 모든 녹화 프레임 로드
    async loadAllRecordFrames(onProgress = null) {
        this.clear();
        let frameIndex = 0;
        let consecutiveFailures = 0;
        const maxConsecutiveFailures = 5; // 연속 실패 허용 횟수

        if (onProgress) {
            onProgress(InfoMessages.LOADING_FRAMES);
        }

        while (consecutiveFailures < maxConsecutiveFailures) {
            try {
                const frame = await this.loadRecordFrame(frameIndex);
                this.frames.push(frame);
                frameIndex++;
                consecutiveFailures = 0; // 성공하면 연속 실패 카운터 리셋
            } catch (error) {
                consecutiveFailures++;
                console.warn(`[FrameManager] Failed to load frame ${frameIndex}, consecutive failures: ${consecutiveFailures}`);

                // 연속 실패가 임계값에 도달하면 중단
                if (consecutiveFailures >= maxConsecutiveFailures) {
                    console.log(`[FrameManager] Stopping frame loading after ${maxConsecutiveFailures} consecutive failures`);
                    break;
                }
                frameIndex++;
            }
        }

        if (onProgress) {
            onProgress(null);
        }

        console.log(`[FrameManager] Loaded ${this.frames.length} recorded frames`);
        return this.frames.length;
    }

    // 다음 프레임 로드 (라이브/녹화 모드)
    async loadNextFrame(state, index = 0) {
        try {
            if (state === State.LIVE) {
                const frame = await this.loadLiveFrame();
                this.frames = [frame];
                this.currentIndex = 0;
                return frame;
            } else if (state === State.RECORD) {
                const frame = await this.loadRecordFrame(index);
                this.frames = [frame];
                this.currentIndex = 0;
                this.recordFrameIndex = index;
                return frame;
            } else {
                throw new Error(ErrorMessages.INVALID_STATE);
            }
        } catch (error) {
            console.error('[FrameManager] loadNextFrame failed:', error);
            throw error; // 에러를 상위로 전파하되 로그 남기기
        }
    }

    // 재생 인덱스 업데이트
    updatePlaybackIndex(direction, repeatMode = false) {
        this.currentIndex += direction;

        if (direction > 0 && this.currentIndex >= this.frames.length) {
            if (repeatMode) {
                this.currentIndex = 0;
                return { shouldStop: false, reachedEnd: false };
            } else {
                this.currentIndex = this.frames.length - 1;
                return { shouldStop: true, reachedEnd: true };
            }
        } else if (direction < 0 && this.currentIndex < 0) {
            if (repeatMode) {
                this.currentIndex = this.frames.length - 1;
                return { shouldStop: false, reachedEnd: false };
            } else {
                this.currentIndex = 0;
                return { shouldStop: true, reachedEnd: true };
            }
        }

        return { shouldStop: false, reachedEnd: false };
    }

    // 캔버스에 현재 프레임 그리기
    async drawCurrentFrame(canvas) {
        const frame = this.getCurrentFrame();
        if (!frame) return;

        try {
            const img = await ImageLoader.loadImage(frame.data);
            CanvasUtils.drawImageToCanvas(canvas, img);
        } catch (error) {
            console.error('Failed to draw frame:', error);
        }
    }

    // 프레임 단위 이동
    stepFrame(direction, circular = true) {
        if (this.frames.length === 0) return;

        const nextIndex = this.currentIndex + direction;

        if (circular) {
            if (direction > 0 && nextIndex >= this.frames.length) {
                this.currentIndex = 0;
            } else if (direction < 0 && nextIndex < 0) {
                this.currentIndex = this.frames.length - 1;
            } else {
                this.currentIndex = nextIndex;
            }
        } else {
            this.currentIndex = Math.max(0, Math.min(nextIndex, this.frames.length - 1));
        }
    }

    // 특정 위치로 시크
    seekToPosition(percentage) {
        if (this.frames.length === 0) return;

        const clampedPct = Math.max(0, Math.min(1, percentage));
        this.currentIndex = Math.max(0, Math.min(
            Math.floor(clampedPct * this.frames.length),
            this.frames.length - 1
        ));
    }

    rewind() {
        this.currentIndex = 0;
    }

    fastForward() {
        if (this.frames.length > 0) {
            this.currentIndex = this.frames.length - 1;
        }
    }

    // 진행률 계산
    getProgress() {
        return this.frames.length > 1
            ? (this.currentIndex / (this.frames.length - 1)) * 100
            : 0;
    }

    // 상태 정보 반환
    getStatusInfo() {
        const frame = this.getCurrentFrame();
        return {
            path: frame ? frame.path : '',
            name: frame ? frame.name : '',
            frame: frame ? `${this.currentIndex + 1} / ${this.frames.length}` : ''
        };
    }
}