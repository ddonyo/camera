import { Config, State, ErrorMessages, InfoMessages } from './config.js';
import { ImageLoader, CanvasUtils } from './utils.js';

// 프레임 데이터 로딩, 관리 및 탐색 클래스
export class FrameManager {
    constructor() {
        this.frames = []; // 로드된 프레임 배열
        this.#currentIndex = 0; // 현재 프레임 인덱스
    }

    // Private 필드
    #currentIndex;

    // 현재 인덱스 getter (읽기 전용)
    get currentIndex() {
        return this.#currentIndex;
    }

    // 프레임 데이터 및 인덱스 초기화
    clear() {
        this.frames = [];
        this.#currentIndex = 0;
    }

    // 현재 프레임 객체 반환
    getCurrentFrame() {
        return this.frames[this.#currentIndex] || null;
    }

    // 총 프레임 수 반환
    getFrameCount() {
        return this.frames.length;
    }

    // 현재 인덱스 설정 (경계 값 자동 조정)
    setCurrentIndex(index) {
        this.#currentIndex = this.#clampIndex(index);
        return this.#currentIndex;
    }

    // 인덱스를 유효 범위 내로 제한 (private)
    #clampIndex(index) {
        if (this.frames.length === 0) return 0;
        return Math.max(0, Math.min(index, this.frames.length - 1));
    }

    // 인덱스를 유효 범위 내로 조정 (순환 옵션 포함, private)
    #wrapIndex(index, circular = false) {
        if (this.frames.length === 0) return 0;

        if (circular) {
            if (index < 0) return this.frames.length - 1;
            if (index >= this.frames.length) return 0;
            return index;
        }

        return this.#clampIndex(index);
    }

    // 단일 녹화 프레임 로드
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

    // 모든 녹화 프레임 로드 (진행 콜백 지원)
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
                console.warn(
                    `[FrameManager] Failed to load frame ${frameIndex}, consecutive failures: ${consecutiveFailures}`
                );

                if (consecutiveFailures >= maxConsecutiveFailures) {
                    console.log(
                        `[FrameManager] Stopping frame loading after ${maxConsecutiveFailures} consecutive failures`
                    );
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

    // 순차적 프레임 로드 및 즉시 렌더링
    async loadRecordFramesSequentially(canvas, onFrameLoaded = null, options = {}) {
        this.clear();
        let frameIndex = 0;
        let consecutiveFailures = 0;
        const maxConsecutiveFailures = 5;
        const { effectiveFPS = null, totalFrameCount = null, ...renderOptions } = options;

        console.log('[FrameManager] Starting sequential frame loading...');

        while (consecutiveFailures < maxConsecutiveFailures) {
            try {
                // 파일 존재 확인 및 로드
                const frameInfo = ImageLoader.createFrameInfo(
                    frameIndex,
                    Config.PATHS.RECORD_FRAME
                );
                const img = await ImageLoader.loadImage(frameInfo.path);

                // 프레임 정보를 배열에 추가
                this.frames.push(frameInfo);

                // 즉시 캔버스에 렌더링
                CanvasUtils.drawImageToCanvas(canvas, img, renderOptions);

                // 콜백 호출
                if (onFrameLoaded) {
                    onFrameLoaded(frameIndex, this.frames.length, totalFrameCount);
                }

                frameIndex++;
                consecutiveFailures = 0;

                console.log(`[FrameManager] Loaded and rendered frame ${frameIndex - 1}`);

                // 속도 제한을 위한 지연 (effectiveFPS가 제공된 경우)
                if (effectiveFPS && effectiveFPS > 0) {
                    const delay = 1000 / effectiveFPS;
                    await new Promise((resolve) => setTimeout(resolve, delay));
                }
            } catch (error) {
                consecutiveFailures++;
                console.warn(
                    `[FrameManager] Failed to load frame ${frameIndex}, consecutive failures: ${consecutiveFailures}`
                );

                if (consecutiveFailures >= maxConsecutiveFailures) {
                    console.log(
                        `[FrameManager] Stopping sequential loading after ${maxConsecutiveFailures} consecutive failures`
                    );
                    break;
                }
                frameIndex++;
            }
        }

        console.log(
            `[FrameManager] Sequential loading completed. Total frames: ${this.frames.length}`
        );
        return this.frames.length;
    }

    // 프레임 탐색 (방향, 순환, 스텝 크기 지정)
    navigate(direction, options = {}) {
        const { circular = false, step = 1 } = options;

        if (this.frames.length === 0) {
            return { success: false, reachedEnd: false, newIndex: 0 };
        }

        const targetIndex = this.#currentIndex + direction * step;
        const newIndex = this.#wrapIndex(targetIndex, circular);
        const reachedEnd =
            !circular &&
            ((direction > 0 && targetIndex >= this.frames.length) ||
                (direction < 0 && targetIndex < 0));

        this.#currentIndex = newIndex;

        return {
            success: !reachedEnd,
            reachedEnd,
            newIndex: this.#currentIndex,
        };
    }

    // 특정 위치(비율)로 프레임 이동 (탐색)
    seekToPosition(percentage) {
        if (this.frames.length === 0) return 0;

        const clampedPct = Math.max(0, Math.min(1, percentage));
        const targetIndex = Math.floor(clampedPct * (this.frames.length - 1));
        return this.setCurrentIndex(targetIndex);
    }

    // 첫 프레임으로 이동
    rewind() {
        return this.setCurrentIndex(0);
    }

    // 마지막 프레임으로 이동
    fastForward() {
        return this.setCurrentIndex(this.frames.length - 1);
    }

    // 단일 프레임 이동 (호환성 유지용)
    stepFrame(direction, circular = true) {
        return this.navigate(direction, { circular });
    }

    // 재생 인덱스 업데이트 (호환성 유지용)
    updatePlaybackIndex(direction, repeatMode = false) {
        const result = this.navigate(direction, { circular: repeatMode });
        return {
            shouldStop: !result.success,
            reachedEnd: result.reachedEnd,
        };
    }

    // 현재 프레임을 캔버스에 그리기
    async drawCurrentFrame(canvas, options = {}) {
        const frame = this.getCurrentFrame();
        if (!frame) return false;

        try {
            const img = await ImageLoader.loadImage(frame.data);
            CanvasUtils.drawImageToCanvas(canvas, img, options);
            return true;
        } catch (error) {
            console.error('[FrameManager] Failed to draw frame:', error);
            return false;
        }
    }

    // 현재 진행률(%) 계산
    getProgress() {
        if (this.frames.length <= 1) return 0;
        return (this.#currentIndex / (this.frames.length - 1)) * 100;
    }

    // 현재 프레임 상세 정보 반환
    getCurrentFrameInfo() {
        const frame = this.getCurrentFrame();
        if (!frame) return null;

        return {
            index: this.#currentIndex,
            total: this.frames.length,
            frame: frame,
            progress: this.getProgress(),
        };
    }

    // UI 표시용 상태 정보 반환
    getStatusInfo() {
        const frame = this.getCurrentFrame();
        return {
            path: frame ? frame.path : '',
            name: frame ? frame.name : '',
            frame: frame ? `${this.#currentIndex + 1} / ${this.frames.length}` : '',
        };
    }

    // 유효한 인덱스 여부 확인
    isValidIndex(index) {
        return Number.isInteger(index) && index >= 0 && index < this.frames.length;
    }

    // 로드된 프레임 존재 여부 확인
    hasFrames() {
        return this.frames.length > 0;
    }

    // (사용되지 않음, 필요시 구현) 현재 FrameManager 상태 반환
    getState() {
        return {
            frameCount: this.frames.length,
            currentIndex: this.#currentIndex,
            hasFrames: this.hasFrames(),
            progress: this.getProgress(),
            currentFrame: this.getCurrentFrame(),
        };
    }
}
