import { Config, MessageType, State } from './config.js';
import { DOMUtils, MathUtils, CanvasUtils } from './utils.js';

// UI 상태 관리 및 업데이트
export class UIController {
    // 상수 정의
    static #CONSTANTS = {
        TAGS: {
            BUTTON: 'BUTTON'
        },
        SELECTORS: {
            LABEL: 'label',
            SPAN: 'span'
        },
        CLASSES: {
            STATUS_TEXT: 'status-text'
        },
        DIRECTION: {
            FORWARD: 1,
            REVERSE: -1
        }
    };

    constructor() {
        this.elements = DOMUtils.getAllElementsWithId();
        this.currentMessage = '';
        this.messageType = '';
        this.messageTimeout = null;

        // FPS 라벨 요소 캐싱 (성능 최적화)
        this._fpsLabel = this.elements.fpsInput?.closest(UIController.#CONSTANTS.SELECTORS.LABEL);
        this._fpsSpan = this._fpsLabel?.querySelector(UIController.#CONSTANTS.SELECTORS.SPAN);
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
        this._applyRepeatMode(repeatMode);
        this._applyProgressBarState(state, hasFrames);
    }

    // 모든 버튼 비활성화
    _disableAllButtons() {
        this._toggleAllButtons(true);
        this._toggleFPSElements(true);
    }

    // 재생 관련 버튼 활성화
    _enablePlaybackButtons() {
        const playbackButtons = [
            'playBtn', 'reverseBtn', 'pauseBtn', 'rewindBtn',
            'fastForwardBtn', 'nextFrameBtn', 'prevFrameBtn', 'repeatBtn'
        ];

        playbackButtons.forEach(btnKey => {
            if (this.elements[btnKey]) {
                this.elements[btnKey].disabled = false;
            }
        });

        this._toggleFPSElements(false);
    }

    // 상태별 버튼 활성화 (switch문으로 개선)
    _applyStateSpecificButtons(state, hasFrames) {
        const { elements } = this;

        switch (state) {
            case State.IDLE:
                this._enableButtons(['liveBtn', 'recordBtn']);
                if (hasFrames) {
                    this._enableButtons(['playbackBtn']);
                    this._enablePlaybackButtons();
                }
                break;

            case State.LIVE:
                this._enableButtons(['liveBtn', 'recordBtn']);
                if (hasFrames) {
                    this._enableButtons(['playbackBtn']);
                }
                this._addActiveClass('liveBtn');
                break;

            case State.RECORD:
                this._enableButtons(['recordBtn']);
                this._addActiveClass('recordBtn');
                break;

            case State.PLAYBACK:
                this._enableButtons(['liveBtn', 'recordBtn', 'playbackBtn']);
                this._addActiveClass('playbackBtn');
                this._enablePlaybackButtons();
                break;
        }
    }

    // 재생 상태에 따른 활성 클래스 적용
    _applyPlaybackActiveStates(state, playing, direction) {
        if (state !== State.PLAYBACK) return;

        if (playing) {
            const activeButton = direction === UIController.#CONSTANTS.DIRECTION.FORWARD
                ? 'playBtn'
                : 'reverseBtn';
            this._addActiveClass(activeButton);
        } else {
            this._addActiveClass('pauseBtn');
        }
    }

    // 반복 모드 적용
    _applyRepeatMode(repeatMode) {
        if (repeatMode && !this.elements.repeatBtn?.disabled) {
            this._addActiveClass('repeatBtn');
        }
    }

    // 프로그레스 바 상태 적용
    _applyProgressBarState(state, hasFrames) {
        const progressBar = this.elements.progressBar;
        if (!progressBar) return;

        const shouldEnable = hasFrames && (state === State.IDLE || state === State.PLAYBACK);
        this._toggleElementClasses(progressBar, Config.CLASSES.ENABLED, Config.CLASSES.DISABLED, shouldEnable);
    }

    updateProgress(percentage, animationType = 'smooth') {
        if (!this.elements.progress) return;

        // 기존 애니메이션 클래스 제거
        this.elements.progress.classList.remove('fast-update', 'smooth-update', 'no-animation');

        // 애니메이션 타입에 따른 클래스 추가
        switch (animationType) {
            case 'fast':
                this.elements.progress.classList.add('fast-update');
                break;
            case 'smooth':
                this.elements.progress.classList.add('smooth-update');
                break;
            case 'none':
                this.elements.progress.classList.add('no-animation');
                break;
            default:
                // 기본값: smooth-update
                this.elements.progress.classList.add('smooth-update');
        }

        // width 업데이트
        this.elements.progress.style.width = `${percentage}%`;
    }

    // 상태 정보 업데이트 (템플릿 리터럴 사용)
    updateStatus(statusInfo) {
        const pathText = this._getPathText(statusInfo);
        const nameText = statusInfo.name ? `File Name: ${statusInfo.name}` : 'File Name: ';
        const frameText = statusInfo.frame ? `Frame: ${statusInfo.frame}` : 'Frame: ';

        if (this.elements.statusText) {
            this.elements.statusText.textContent = `${pathText}\n${nameText}\n${frameText}`;
            this._applyStatusTextColor();
        }
    }

    // 상태 텍스트 색상 적용 (수정된 로직)
    _applyStatusTextColor() {
        const statusText = this.elements.statusText;
        if (!statusText) return;

        // 기존 메시지 타입 클래스들만 제거
        const messageTypeClasses = [
            Config.CLASSES.LOADING,
            Config.CLASSES.ERROR,
            Config.CLASSES.WARNING,
            Config.CLASSES.NORMAL
        ];

        statusText.classList.remove(...messageTypeClasses);
        statusText.classList.add(UIController.#CONSTANTS.CLASSES.STATUS_TEXT);

        const classToAdd = this.currentMessage ? this.messageType : Config.CLASSES.NORMAL;
        statusText.classList.add(classToAdd);
    }

    // 메시지 설정
    setMessage(message, type = MessageType.INFO, isTemporary = true) {
        this._clearMessageTimeout();
        this.currentMessage = message;
        this.messageType = type;

        if (isTemporary) {
            this.messageTimeout = setTimeout(() => {
                this.clearMessage();
            }, Config.UI.MESSAGE_TIMEOUT);
        }
    }

    clearMessage() {
        this._clearMessageTimeout();
        this.currentMessage = '';
        this.messageType = '';
    }

    // 프로그레스 바 클릭 위치 계산
    getProgressBarClickPosition(event) {
        if (!this.elements.progressBar) return 0;

        const rect = this.elements.progressBar.getBoundingClientRect();
        const percentage = (event.clientX - rect.left) / rect.width;
        return Math.max(0, Math.min(1, percentage));
    }

    clearCanvas() {
        if (this.elements.viewer) {
            CanvasUtils.clearCanvas(this.elements.viewer);
        }
    }

    destroy() {
        this._clearMessageTimeout();
        this.clearCanvas();
        console.log('UIController destroyed');
    }

    // === 헬퍼 메서드들 ===

    // 모든 버튼 토글
    _toggleAllButtons(disable) {
        Object.values(this.elements)
            .filter(el => el?.tagName === UIController.#CONSTANTS.TAGS.BUTTON)
            .forEach(el => {
                el.disabled = disable;
                if (disable) {
                    el.classList.remove(Config.CLASSES.ACTIVE);
                }
            });
    }

    // FPS 관련 요소들 토글 (중복 제거)
    _toggleFPSElements(disable) {
        const { fpsInput } = this.elements;
        if (!fpsInput) return;

        fpsInput.disabled = disable;
        this._toggleElementClasses(fpsInput, 'disabled', null, disable);

        if (this._fpsSpan) {
            this._toggleElementClasses(this._fpsSpan, 'disabled', null, disable);
        }
    }

    // 여러 버튼 활성화
    _enableButtons(buttonKeys) {
        buttonKeys.forEach(key => {
            if (this.elements[key]) {
                this.elements[key].disabled = false;
            }
        });
    }

    // 활성 클래스 추가
    _addActiveClass(elementKey) {
        if (this.elements[elementKey]) {
            this.elements[elementKey].classList.add(Config.CLASSES.ACTIVE);
        }
    }

    // 요소 클래스 토글 유틸리티
    _toggleElementClasses(element, addClassName, removeClassName, condition) {
        if (!element) return;

        if (condition) {
            if (removeClassName) element.classList.remove(removeClassName);
            if (addClassName) element.classList.add(addClassName);
        } else {
            if (addClassName) element.classList.remove(addClassName);
            if (removeClassName) element.classList.add(removeClassName);
        }
    }

    // 경로 텍스트 생성
    _getPathText(statusInfo) {
        if (this.currentMessage) {
            return `File Path: [${this.messageType.toUpperCase()}] ${this.currentMessage}`;
        }
        return statusInfo.path ? `File Path: ${statusInfo.path}` : 'File Path: ';
    }

    // 메시지 타임아웃 정리
    _clearMessageTimeout() {
        if (this.messageTimeout) {
            clearTimeout(this.messageTimeout);
            this.messageTimeout = null;
        }
    }
}