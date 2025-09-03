import { Config } from './config.js';

// 유틸리티 함수 클래스

// DOM 유틸리티
export class DOMUtils {
    // ID를 가진 모든 DOM 요소 반환
    static getAllElementsWithId() {
        const allWithId = document.querySelectorAll('[id]');
        return Array.from(allWithId).reduce((obj, el) => {
            obj[el.id] = el;
            return obj;
        }, {});
    }
}

// 수학 유틸리티
export class MathUtils {
    // 값 범위 제한 (clamp)
    static clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    // FPS 값 검증 및 조정
    static validateFPS(fps) {
        const val = Number(fps);
        if (isNaN(val) || val <= 0) {
            return Config.FPS.DEFAULT;
        }
        return this.clamp(val, Config.FPS.MIN, Config.FPS.MAX);
    }

    // Speed 값 검증 및 조정
    static validateSpeed(speed) {
        const val = Number(speed);
        if (isNaN(val) || val <= 0) {
            return Config.SPEED.DEFAULT;
        }
        return this.clamp(val, Config.SPEED.MIN, Config.SPEED.MAX);
    }
}

// 이미지 로딩 유틸리티
export class ImageLoader {
    // 이미지 비동기 로드 (타임아웃 포함)
    static async loadImage(src, options = {}) {
        const { timeout = 5000 } = options;

        return new Promise((resolve, reject) => {
            const img = new Image();
            let timeoutId;

            const cleanup = () => {
                if (timeoutId) clearTimeout(timeoutId);
            };

            img.onload = () => {
                cleanup();
                // 이미지가 완전히 로드되었는지 확인
                if (!img.complete || img.naturalWidth === 0) {
                    reject(new Error('Image failed to load properly'));
                    return;
                }
                resolve(img);
            };

            img.onerror = () => {
                cleanup();
                reject(new Error(`Failed to load image: ${src}`));
            };

            if (timeout > 0) {
                timeoutId = setTimeout(() => {
                    reject(new Error(`Image load timeout: ${src}`));
                }, timeout);
            }

            img.src = src;
        });
    }

    // 프레임 정보 객체 생성
    static createFrameInfo(index, basePath, extension = Config.PATHS.RECORD_FRAME_EXTENSION) {
        const name = `frame${index}${extension}`;
        const path = `${basePath}${index}${extension}`;

        return Object.freeze({
            name,
            path,
            data: path,
            index,
        });
    }
}

// 타이머 유틸리티
export class TimerUtils {
    // 다음 프레임 대기 (FPS 기반)
    static waitForNextFrame(fps, options = {}) {
        const { validateFPS = true } = options;
        const validFPS = validateFPS ? MathUtils.validateFPS(fps) : fps;
        const ms = 1000 / validFPS;
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

// 캔버스 유틸리티
export class CanvasUtils {
    static #contextCache = new WeakMap(); // 컨텍스트 캐시

    // 캔버스 2D 컨텍스트 반환 (캐싱)
    static #getContext(canvas) {
        if (!canvas || !(canvas instanceof HTMLCanvasElement)) {
            throw new Error('Canvas must be a valid HTMLCanvasElement');
        }

        if (this.#contextCache.has(canvas)) {
            return this.#contextCache.get(canvas);
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('Failed to get 2D context from canvas');
        }

        this.#contextCache.set(canvas, ctx);
        return ctx;
    }

    // 캔버스 클리어
    static clearCanvas(canvas) {
        const ctx = this.#getContext(canvas);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    // 이미지 캔버스에 그리기
    static drawImageToCanvas(canvas, image, options = {}) {
        const { clearFirst = true, flip = false, crop = false } = options;

        if (!(image instanceof HTMLImageElement)) {
            throw new Error('Image must be a valid HTMLImageElement');
        }

        if (!image.complete || image.naturalWidth === 0) {
            throw new Error('Image is not fully loaded');
        }

        const ctx = this.#getContext(canvas);

        if (clearFirst) {
            this.clearCanvas(canvas);
        }

        ctx.save(); // 현재 상태 저장

        if (flip) {
            // 좌우 플립 적용
            ctx.scale(-1, 1); // X축 반전
        }

        if (crop) {
            // 중앙 크롭 적용 - 좌/우는 검정으로 마스킹, 중앙 1/3만 표시
            const sourceWidth = image.naturalWidth;
            const sourceHeight = image.naturalHeight;
            const cropX = sourceWidth / 3; // 시작 X: 1/3 지점
            const cropWidth = sourceWidth / 3; // 너비: 1/3

            // 먼저 검정색으로 전체 캔버스 채우기
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // 중앙 영역에만 이미지 그리기 (원본 비율 유지)
            const canvasCenterX = canvas.width / 3; // 캔버스의 중앙 1/3 시작점
            const canvasCenterWidth = canvas.width / 3; // 캔버스의 중앙 1/3 너비

            if (flip) {
                // 플립된 상태에서는 중앙 영역의 위치를 조정
                ctx.drawImage(
                    image,
                    cropX,
                    0,
                    cropWidth,
                    sourceHeight, // 소스 영역 (원본 중앙 1/3)
                    -(canvasCenterX + canvasCenterWidth),
                    0,
                    canvasCenterWidth,
                    canvas.height // 플립된 중앙 영역
                );
            } else {
                ctx.drawImage(
                    image,
                    cropX,
                    0,
                    cropWidth,
                    sourceHeight, // 소스 영역 (원본 중앙 1/3)
                    canvasCenterX,
                    0,
                    canvasCenterWidth,
                    canvas.height // 캔버스 중앙 영역
                );
            }
        } else {
            // 일반 그리기
            if (flip) {
                ctx.drawImage(image, -canvas.width, 0, canvas.width, canvas.height);
            } else {
                ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            }
        }

        ctx.restore(); // 상태 복원
    }
}

// 파일 유틸리티
export class FileUtils {
    // JSON 파일 읽기 및 파싱
    static async readJSONFile(filePath) {
        try {
            const response = await fetch(filePath);

            if (!response.ok) {
                throw new Error(`Failed to load file: ${response.status} ${response.statusText}`);
            }

            const jsonData = await response.json();
            return jsonData;
        } catch (error) {
            console.error(`Error reading JSON file ${filePath}:`, error);
            throw error;
        }
    }

    // 녹화 FPS 정보 읽기 (rec_info.json)
    static async getRecordingFPS() {
        try {
            const recInfo = await this.readJSONFile('./record/rec_info.json');

            if (recInfo && typeof recInfo.fps === 'number' && recInfo.fps > 0) {
                return recInfo.fps;
            } else {
                console.warn('Invalid FPS value in rec_info.json, using default FPS (15)');
                return Config.FPS.RECORD_DEFAULT;
            }
        } catch (error) {
            console.warn('Failed to read rec_info.json, using default FPS (15):', error);
            return Config.FPS.RECORD_DEFAULT;
        }
    }

    // 녹화된 프레임 존재 여부 확인
    static async hasRecordedFrames() {
        try {
            // frame0.jpg 파일이 존재하는지 확인 (첫 번째 프레임 파일)
            const response = await fetch('./record/frame0.jpg', {
                method: 'HEAD', // HEAD 요청으로 파일 존재만 확인
            });

            if (response.ok) {
                console.log('[FileUtils] Found recorded frames in record folder');
                return true;
            } else {
                console.log('[FileUtils] No recorded frames found in record folder');
                return false;
            }
        } catch (error) {
            console.log('[FileUtils] Error checking recorded frames:', error);
            return false;
        }
    }

    // 특정 프레임 파일 존재 여부 확인
    static async frameExists(index) {
        try {
            const frameInfo = ImageLoader.createFrameInfo(index, Config.PATHS.RECORD_FRAME);
            const response = await fetch(frameInfo.path, {
                method: 'HEAD', // HEAD 요청으로 파일 존재만 확인
            });
            return response.ok;
        } catch (error) {
            return false;
        }
    }

    // 전체 프레임 파일 개수 계산
    static async getTotalFrameCount() {
        try {
            // 먼저 첫 번째 프레임이 존재하는지 확인
            const hasFirstFrame = await this.frameExists(0);
            if (!hasFirstFrame) {
                console.log('[FileUtils] No frames found');
                return 0;
            }

            let left = 0;
            let right = 131072; // 충분히 큰 수로 시작 (24fps 약 91분 | 120fps 약 18분)
            let lastExistingIndex = 0;

            console.log('[FileUtils] Starting binary search for total frame count...');

            while (left <= right) {
                const mid = Math.floor((left + right) / 2);
                const exists = await this.frameExists(mid);

                if (exists) {
                    lastExistingIndex = mid;
                    left = mid + 1;
                } else {
                    right = mid - 1;
                }
            }

            const totalCount = lastExistingIndex + 1;
            console.log(
                `[FileUtils] Found ${totalCount} total frames (frame0 to frame${lastExistingIndex})`
            );
            return totalCount;
        } catch (error) {
            console.error('[FileUtils] Error counting total frames:', error);
            return 0;
        }
    }
}
