import { Config } from './config.js';

// 유틸리티 함수 클래스

// 유효성 검증 유틸리티
export class ValidationUtils {
    // 필수 값 및 타입 검증
    static validateRequired(value, name, type = null) {
        if (value === null || value === undefined) {
            throw new Error(`${name} is required`);
        }

        if (type && typeof value !== type) {
            throw new Error(`${name} must be of type ${type}`);
        }

        return value;
    }

    // 숫자 및 범위 검증
    static validateNumber(value, name, options = {}) {
        const { min = -Infinity, max = Infinity, allowNaN = false } = options;

        if (typeof value !== 'number' || (!allowNaN && isNaN(value))) {
            throw new Error(`${name} must be a valid number`);
        }

        if (value < min || value > max) {
            throw new Error(`${name} must be between ${min} and ${max}`);
        }

        return value;
    }

    // 문자열, 빈 값, 최대 길이 검증
    static validateString(value, name, options = {}) {
        const { allowEmpty = false, maxLength = Infinity } = options;

        if (typeof value !== 'string') {
            throw new Error(`${name} must be a string`);
        }

        if (!allowEmpty && value.length === 0) {
            throw new Error(`${name} cannot be empty`);
        }

        if (value.length > maxLength) {
            throw new Error(`${name} cannot exceed ${maxLength} characters`);
        }

        return value;
    }
}

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
        ValidationUtils.validateNumber(value, 'value');
        ValidationUtils.validateNumber(min, 'min');
        ValidationUtils.validateNumber(max, 'max');

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

        ValidationUtils.validateString(src, 'Image source', { allowEmpty: false });

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
        ValidationUtils.validateNumber(index, 'Frame index', { min: 0 });
        ValidationUtils.validateString(basePath, 'Base path', { allowEmpty: false });

        const name = `frame${index}${extension}`;
        const path = `${basePath}${index}${extension}`;

        return Object.freeze({
            name,
            path,
            data: path,
            index
        });
    }
}

// 타이머 유틸리티
export class TimerUtils {
    // 시간 지연 (ms)
    static delay(ms) {
        ValidationUtils.validateNumber(ms, 'Delay time', { min: 0 });
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // 다음 프레임 대기 (FPS 기반)
    static waitForNextFrame(fps, options = {}) {
        const { validateFPS = true } = options;
        const validFPS = validateFPS ? MathUtils.validateFPS(fps) : fps;
        return this.delay(1000 / validFPS);
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
        const { clearFirst = true } = options;

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

        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
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
                method: 'HEAD' // HEAD 요청으로 파일 존재만 확인
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
}