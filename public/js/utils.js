import { Config, ElementIds } from './config.js';

// DOM 조작 유틸리티
export class DOMUtils {
    static getAllElementsWithId() {
        const allWithId = document.querySelectorAll('[id]');
        return Array.from(allWithId).reduce((obj, el) => {
            obj[el.id] = el;
            return obj;
        }, {});
    }

    static toggleClass(element, className, add) {
        if (add) {
            element.classList.add(className);
        } else {
            element.classList.remove(className);
        }
    }

    static removeClassFromElements(elements, className) {
        elements.forEach(el => el.classList.remove(className));
    }
}

// 수학 계산 유틸리티
export class MathUtils {
    static clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    static validateFPS(fps) {
        const val = parseInt(fps, 10);
        return isNaN(val) ? Config.DEFAULT_FPS : this.clamp(val, Config.MIN_FPS, Config.MAX_FPS);
    }

    static calculatePercentage(current, total) {
        return total > 1 ? (current / (total - 1)) * 100 : 0;
    }
}

// 이미지 로딩 유틸리티
export class ImageLoader {
    static async loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    }

    static createFrameInfo(index, basePath, extension = Config.RECORD_FRAME_EXTENSION) {
        const name = `frame${index}${extension}`;
        const path = `${basePath}${index}${extension}`;
        return { name, path, data: path };
    }

    static createLiveFrameInfo() {
        return {
            name: 'frame.jpg',
            path: Config.LIVE_FRAME_PATH,
            data: Config.LIVE_FRAME_PATH
        };
    }
}

// 타이머 유틸리티
export class TimerUtils {
    static delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    static waitForNextFrame(fps) {
        return this.delay(1000 / fps);
    }
}

// 캔버스 유틸리티
export class CanvasUtils {
    static clearCanvas(canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    static drawImageToCanvas(canvas, image) {
        const ctx = canvas.getContext('2d');
        this.clearCanvas(canvas);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    }
}

// 배열 조작 유틸리티
export class ArrayUtils {
    static getNextIndex(currentIndex, direction, arrayLength, wrap = false) {
        const nextIndex = currentIndex + direction;

        if (wrap) {
            if (nextIndex >= arrayLength) return 0;
            if (nextIndex < 0) return arrayLength - 1;
        } else {
            if (nextIndex >= arrayLength) return arrayLength - 1;
            if (nextIndex < 0) return 0;
        }

        return nextIndex;
    }

    static isIndexOutOfBounds(index, arrayLength) {
        return index < 0 || index >= arrayLength;
    }
}