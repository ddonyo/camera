import { Config } from './config.js';

// 매개변수 검증 유틸리티
export class ValidationUtils {
    static validateRequired(value, name, type = null) {
        if (value === null || value === undefined) {
            throw new Error(`${name} is required`);
        }

        if (type && typeof value !== type) {
            throw new Error(`${name} must be of type ${type}`);
        }

        return value;
    }

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

// DOM 조작 유틸리티
export class DOMUtils {
    static getAllElementsWithId() {
        const allWithId = document.querySelectorAll('[id]');
        return Array.from(allWithId).reduce((obj, el) => {
            obj[el.id] = el;
            return obj;
        }, {});
    }
}

// 수학 계산 유틸리티
export class MathUtils {
    static clamp(value, min, max) {
        ValidationUtils.validateNumber(value, 'value');
        ValidationUtils.validateNumber(min, 'min');
        ValidationUtils.validateNumber(max, 'max');

        return Math.max(min, Math.min(max, value));
    }

    static validateFPS(fps) {
        const val = Number(fps);
        if (isNaN(val) || val <= 0) {
            return Config.FPS.DEFAULT;
        }
        return this.clamp(val, Config.FPS.MIN, Config.FPS.MAX);
    }
}

// 이미지 로딩 유틸리티
export class ImageLoader {
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
    static delay(ms) {
        ValidationUtils.validateNumber(ms, 'Delay time', { min: 0 });
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    static waitForNextFrame(fps, options = {}) {
        const { validateFPS = true } = options;
        const validFPS = validateFPS ? MathUtils.validateFPS(fps) : fps;
        return this.delay(1000 / validFPS);
    }
}

// 캔버스 유틸리티
export class CanvasUtils {
    static #contextCache = new WeakMap();

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

    static clearCanvas(canvas) {
        const ctx = this.#getContext(canvas);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

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