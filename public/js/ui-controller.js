import { Config, ElementIds, MessageType, State } from './config.js';
import { DOMUtils, MathUtils } from './utils.js';

// UI 상태 관리 및 업데이트
export class UIController {
    constructor() {
        this.elements = DOMUtils.getAllElementsWithId();
        this.currentMessage = '';
        this.messageType = '';
        this.messageTimeout = null;
    }

    getFPS() {
        return MathUtils.validateFPS(this.elements.fpsInput.value);
    }

    setFPS(fps) {
        const validatedFPS = MathUtils.validateFPS(fps);
        this.elements.fpsInput.value = validatedFPS;
        return validatedFPS;
    }

    // 상태에 따른 버튼 활성화/비활성화
    applyState(state, playing = false, direction = 1, repeatMode = false, hasFrames = false) {
        this._disableAllButtons();
        this._applyStateSpecificButtons(state, hasFrames);
        this._applyPlaybackActiveStates(state, playing, direction);

        if (repeatMode && !this.elements.repeatBtn.disabled) {
            this.elements.repeatBtn.classList.add(Config.CLASSES.ACTIVE);
        }

        this._applyProgressBarState(state, hasFrames);
    }

    // 모든 버튼 비활성화
    _disableAllButtons() {
        Object.values(this.elements)
            .filter(el => el.tagName === 'BUTTON')
            .forEach(el => {
                el.disabled = true;
                el.classList.remove(Config.CLASSES.ACTIVE);
            });

        // FPS 관련 요소들 비활성화
        this.elements.fpsInput.disabled = true;
        this.elements.fpsInput.classList.add('disabled');

        // FPS 라벨의 span 요소 비활성화
        const fpsLabel = this.elements.fpsInput.closest('label');
        if (fpsLabel) {
            const fpsSpan = fpsLabel.querySelector('span');
            if (fpsSpan) {
                fpsSpan.classList.add('disabled');
            }
        }
    }

    // 상태별 버튼 활성화
    _applyStateSpecificButtons(state, hasFrames) {
        const btns = this.elements;

        if (state === State.IDLE) {
            btns.liveBtn.disabled = false;
            btns.recordBtn.disabled = false;

            if (hasFrames) {
                this._enablePlaybackButtons();
            }
        } else if (state === State.LIVE) {
            btns.liveBtn.disabled = false;
            btns.liveBtn.classList.add(Config.CLASSES.ACTIVE);
        } else if (state === State.RECORD) {
            btns.recordBtn.disabled = false;
            btns.recordBtn.classList.add(Config.CLASSES.ACTIVE);
        } else if (state === State.PLAYBACK) {
            btns.liveBtn.disabled = false;
            btns.recordBtn.disabled = false;
            this._enablePlaybackButtons();
        }
    }

    // 재생 관련 버튼 활성화
    _enablePlaybackButtons() {
        const btns = this.elements;
        btns.playBtn.disabled = false;
        btns.reverseBtn.disabled = false;
        btns.pauseBtn.disabled = false;
        btns.rewindBtn.disabled = false;
        btns.fastForwardBtn.disabled = false;
        btns.nextFrameBtn.disabled = false;
        btns.prevFrameBtn.disabled = false;
        btns.repeatBtn.disabled = false;

        // FPS 관련 요소들 활성화
        btns.fpsInput.disabled = false;
        btns.fpsInput.classList.remove('disabled');

        // FPS 라벨의 span 요소 활성화
        const fpsLabel = btns.fpsInput.closest('label');
        if (fpsLabel) {
            const fpsSpan = fpsLabel.querySelector('span');
            if (fpsSpan) {
                fpsSpan.classList.remove('disabled');
            }
        }
    }

    // 재생 상태에 따른 활성 클래스 적용
    _applyPlaybackActiveStates(state, playing, direction) {
        const btns = this.elements;

        if (state === State.PLAYBACK) {
            if (playing) {
                if (direction === 1) {
                    btns.playBtn.classList.add(Config.CLASSES.ACTIVE);
                } else {
                    btns.reverseBtn.classList.add(Config.CLASSES.ACTIVE);
                }
            } else {
                btns.pauseBtn.classList.add(Config.CLASSES.ACTIVE);
            }
        }
    }

    // 프로그레스 바 상태 적용
    _applyProgressBarState(state, hasFrames) {
        const progressBar = this.elements.progressBar;

        if (hasFrames && (state === State.IDLE || state === State.PLAYBACK)) {
            progressBar.classList.remove(Config.CLASSES.DISABLED);
            progressBar.classList.add(Config.CLASSES.ENABLED);
        } else {
            progressBar.classList.add(Config.CLASSES.DISABLED);
            progressBar.classList.remove(Config.CLASSES.ENABLED);
        }
    }

    updateProgress(percentage) {
        this.elements.progress.style.width = `${percentage}%`;
    }

    // 상태 정보 업데이트
    updateStatus(statusInfo) {
        let pathText = 'File Path: ';

        if (this.currentMessage) {
            pathText += `[${this.messageType.toUpperCase()}] ${this.currentMessage}`;
        } else if (statusInfo.path) {
            pathText += statusInfo.path;
        }

        const nameText = statusInfo.name ? `File Name: ${statusInfo.name}` : 'File Name: ';
        const frameText = statusInfo.frame ? `Frame: ${statusInfo.frame}` : 'Frame: ';

        this.elements.statusText.textContent = `${pathText}\n${nameText}\n${frameText}`;
        this._applyStatusTextColor();
    }

    // 상태 텍스트 색상 적용
    _applyStatusTextColor() {
        const statusText = this.elements.statusText;

        statusText.classList.remove(
            'status-text',
            Config.CLASSES.LOADING,
            Config.CLASSES.ERROR,
            Config.CLASSES.WARNING,
            Config.CLASSES.NORMAL
        );

        statusText.classList.add('status-text');

        if (this.currentMessage) {
            statusText.classList.add(this.messageType);
        } else {
            statusText.classList.add(Config.CLASSES.NORMAL);
        }
    }

    // 메시지 설정
    setMessage(message, type = MessageType.INFO, isTemporary = true) {
        this._clearMessageTimeout();

        this.currentMessage = message;
        this.messageType = type;

        if (isTemporary) {
            this.messageTimeout = setTimeout(() => {
                this.clearMessage();
            }, Config.MESSAGE_TIMEOUT);
        }
    }

    clearMessage() {
        this._clearMessageTimeout();
        this.currentMessage = '';
        this.messageType = '';
    }

    _clearMessageTimeout() {
        if (this.messageTimeout) {
            clearTimeout(this.messageTimeout);
            this.messageTimeout = null;
        }
    }

    // 프로그레스 바 클릭 위치 계산
    getProgressBarClickPosition(event) {
        const rect = this.elements.progressBar.getBoundingClientRect();
        const percentage = (event.clientX - rect.left) / rect.width;
        return Math.max(0, Math.min(1, percentage));
    }

    clearCanvas() {
        const canvas = this.elements.viewer;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    destroy() {
        this._clearMessageTimeout();
        this.clearCanvas();
        console.log('UIController destroyed');
    }
}