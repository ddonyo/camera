import { Config, State, ErrorMessages, InfoMessages } from './config.js';
import { ImageLoader, CanvasUtils } from './utils.js';

// 프레임 로딩 및 관리
export class FrameManager {
    constructor() {
        this.frames = [];
        this.#currentIndex = 0;
    }

    // private 필드 선언
    #currentIndex;

    // getter로 currentIndex 접근 제공 (읽기 전용)
    get currentIndex() {
        return this.#currentIndex;
    }

    clear() {
        this.frames = [];
        this.#currentIndex = 0;
    }

    getCurrentFrame() {
        return this.frames[this.#currentIndex] || null;
    }

    getFrameCount() {
        return this.frames.length;
    }

    // 인덱스 설정 (경계 검사 포함)
    setCurrentIndex(index) {
        this.#currentIndex = this.#clampIndex(index);
        return this.#currentIndex;
    }

    // 인덱스 경계 처리 (private 메서드)
    #clampIndex(index) {
        if (this.frames.length === 0) return 0;
        return Math.max(0, Math.min(index, this.frames.length - 1));
    }

    // 순환 인덱스 처리 (private 메서드)
    #wrapIndex(index, circular = false) {
        if (this.frames.length === 0) return 0;

        if (circular) {
            if (index < 0) return this.frames.length - 1;
            if (index >= this.frames.length) return 0;
            return index;
        }

        return this.#clampIndex(index);
    }

    // 녹화 프레임 로드
    async loadRecordFrame(index) {
        try {
            const frameInfo = ImageLoader.createFrameInfo(index, Config.PATHS.RECORD_FRAME);
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
        const maxConsecutiveFailures = 5;

        if (onProgress) {
            onProgress(InfoMessages.LOADING_FRAMES);
        }

        while (consecutiveFailures < maxConsecutiveFailures) {
            try {
                const frame = await this.loadRecordFrame(frameIndex);
                this.frames.push(frame);
                frameIndex++;
                consecutiveFailures = 0;
            } catch (error) {
                consecutiveFailures++;
                console.warn(`[FrameManager] Failed to load frame ${frameIndex}, consecutive failures: ${consecutiveFailures}`);

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

    // 통합된 재생 인덱스 업데이트
    navigate(direction, options = {}) {
        const { circular = false, step = 1 } = options;

        if (this.frames.length === 0) {
            return { success: false, reachedEnd: false, newIndex: 0 };
        }

        const targetIndex = this.#currentIndex + (direction * step);
        const newIndex = this.#wrapIndex(targetIndex, circular);
        const reachedEnd = !circular && (
            (direction > 0 && targetIndex >= this.frames.length) ||
            (direction < 0 && targetIndex < 0)
        );

        this.#currentIndex = newIndex;

        return {
            success: !reachedEnd,
            reachedEnd,
            newIndex: this.#currentIndex
        };
    }

    // 특정 위치로 시크
    seekToPosition(percentage) {
        if (this.frames.length === 0) return 0;

        const clampedPct = Math.max(0, Math.min(1, percentage));
        const targetIndex = Math.floor(clampedPct * (this.frames.length - 1));
        return this.setCurrentIndex(targetIndex);
    }

    // 처음으로 이동
    rewind() {
        return this.setCurrentIndex(0);
    }

    // 마지막으로 이동
    fastForward() {
        return this.setCurrentIndex(this.frames.length - 1);
    }

    // 스텝 이동 (하위 호환성)
    stepFrame(direction, circular = true) {
        return this.navigate(direction, { circular });
    }

    // 재생 인덱스 업데이트 (하위 호환성)
    updatePlaybackIndex(direction, repeatMode = false) {
        const result = this.navigate(direction, { circular: repeatMode });
        return {
            shouldStop: !result.success,
            reachedEnd: result.reachedEnd
        };
    }

    // 캔버스에 현재 프레임 그리기
    async drawCurrentFrame(canvas) {
        const frame = this.getCurrentFrame();
        if (!frame) return false;

        try {
            const img = await ImageLoader.loadImage(frame.data);
            CanvasUtils.drawImageToCanvas(canvas, img);
            return true;
        } catch (error) {
            console.error('[FrameManager] Failed to draw frame:', error);
            return false;
        }
    }

    // 진행률 계산
    getProgress() {
        if (this.frames.length <= 1) return 0;
        return (this.#currentIndex / (this.frames.length - 1)) * 100;
    }

    // 현재 프레임 정보
    getCurrentFrameInfo() {
        const frame = this.getCurrentFrame();
        if (!frame) return null;

        return {
            index: this.#currentIndex,
            total: this.frames.length,
            frame: frame,
            progress: this.getProgress()
        };
    }

    // 상태 정보 반환 (UI용)
    getStatusInfo() {
        const frame = this.getCurrentFrame();
        return {
            path: frame ? frame.path : '',
            name: frame ? frame.name : '',
            frame: frame ? `${this.#currentIndex + 1} / ${this.frames.length}` : ''
        };
    }

    // 유효성 검사
    isValidIndex(index) {
        return Number.isInteger(index) && index >= 0 && index < this.frames.length;
    }

    // 프레임 존재 여부 확인
    hasFrames() {
        return this.frames.length > 0;
    }

    // 현재 상태 요약
    getState() {
        return {
            frameCount: this.frames.length,
            currentIndex: this.#currentIndex,
            hasFrames: this.hasFrames(),
            progress: this.getProgress(),
            currentFrame: this.getCurrentFrame()
        };
    }
}