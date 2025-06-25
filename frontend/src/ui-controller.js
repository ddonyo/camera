import { Config, MessageType, State, Direction } from './config.js';
import { DOMUtils, MathUtils, CanvasUtils } from './utils.js';

// UI 상태 관리 및 업데이트 클래스
export class UIController {
    // 내부 상수
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
        }
    };

    constructor() {
        this.elements = DOMUtils.getAllElementsWithId(); // DOM 요소 맵
        this.currentMessage = ''; // 현재 메시지
        this.messageType = ''; // 메시지 유형
        this.messageTimeout = null; // 메시지 타임아웃 ID

        // FPS 관련 요소 캐싱
        this._fpsLabel = this.elements.fpsInput?.closest(UIController.#CONSTANTS.SELECTORS.LABEL);
        this._fpsSpan = this._fpsLabel?.querySelector(UIController.#CONSTANTS.SELECTORS.SPAN);
    }

    // 현재 설정된 FPS 값 반환 (검증 후)
    getFPS() {
        return MathUtils.validateFPS(this.elements.fpsInput.value);
    }

    // FPS 값 설정 및 UI 업데이트 (검증 후)
    setFPS(fps) {
        const validatedFPS = MathUtils.validateFPS(fps);
        this.elements.fpsInput.value = validatedFPS;
        return validatedFPS;
    }

    // 현재 설정된 Delay 값 반환 (검증 후)
    getDelay() {
        const delayValue = parseInt(this.elements.delayInput?.value) || 0;
        return Math.max(0, Math.min(10, delayValue)); // 0-10 범위로 제한
    }

    // 애플리케이션 상태에 따른 UI 적용 (버튼, 프로그레스 바 등)
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

    // 특정 상태에 따른 버튼 활성화/비활성화 및 활성 클래스 적용
    _applyStateSpecificButtons(state, hasFrames) {
        const { elements } = this;

        switch (state) {
            case State.IDLE:
                this._enableButtons(['liveBtn', 'playbackBtn']);
                if (hasFrames) {
                    this._enablePlaybackButtons();
                }
                this._toggleDelayElements(false);
                break;

            case State.LIVE:
                this._enableButtons(['liveBtn', 'recordBtn', 'playbackBtn']);
                if (hasFrames) {
                    this._enablePlaybackButtons();
                }
                this._addActiveClass('liveBtn');
                this._toggleDelayElements(true);
                break;

            case State.RECORD:
                this._enableButtons(['recordBtn']);
                this._addActiveClass('recordBtn');
                this._toggleDelayElements(true);
                break;

            case State.PLAYBACK:
                this._enableButtons(['liveBtn', 'playbackBtn']);
                this._addActiveClass('playbackBtn');
                this._enablePlaybackButtons();
                this._toggleDelayElements(false);
                break;
        }
    }

    // 재생 상태(재생 중, 방향)에 따른 활성 클래스 적용
    _applyPlaybackActiveStates(state, playing, direction) {
        if (state !== State.PLAYBACK) return;

        if (playing) {
            const activeButton = direction === Direction.FORWARD
                ? 'playBtn'
                : 'reverseBtn';
            this._addActiveClass(activeButton);
        } else {
            this._addActiveClass('pauseBtn');
        }
    }

    // 반복 모드 활성화 시 repeatBtn에 활성 클래스 적용
    _applyRepeatMode(repeatMode) {
        if (repeatMode && !this.elements.repeatBtn?.disabled) {
            this._addActiveClass('repeatBtn');
        }
    }

    // 프로그레스 바 활성화/비활성화 상태 적용
    _applyProgressBarState(state, hasFrames) {
        const progressBar = this.elements.progressBar;
        if (!progressBar) return;

        const shouldEnable = hasFrames && (state === State.IDLE || state === State.PLAYBACK);
        this._toggleElementClasses(progressBar, Config.CLASSES.ENABLED, Config.CLASSES.DISABLED, shouldEnable);
    }

    // 프로그레스 바 진행률 업데이트 (애니메이션 타입 지정 가능)
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

    // 상태 정보(경로, 프레임 번호) UI 업데이트
    updateStatus(statusInfo) {
        const pathText = this._getPathText(statusInfo);
        const frameText = statusInfo.frame ? `Frame: ${statusInfo.frame}` : 'Frame: ';

        if (this.elements.statusText) {
            this.elements.statusText.textContent = `${pathText}\n${frameText}`;
            this._applyStatusTextColor();
        }
    }

    // 상태 텍스트 색상 적용 (메시지 유형 기반)
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

    // 메시지 설정 및 표시 (일시적 또는 영구적)
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

    // 현재 표시된 메시지 제거
    clearMessage() {
        this._clearMessageTimeout();
        this.currentMessage = '';
        this.messageType = '';
    }

    // 프로그레스 바 클릭 위치(비율) 계산
    getProgressBarClickPosition(event) {
        if (!this.elements.progressBar) return 0;

        const rect = this.elements.progressBar.getBoundingClientRect();
        const percentage = (event.clientX - rect.left) / rect.width;
        return Math.max(0, Math.min(1, percentage));
    }

    // 뷰어 캔버스 클리어
    clearCanvas() {
        if (this.elements.viewer) {
            CanvasUtils.clearCanvas(this.elements.viewer);
        }
    }

    // UIController 인스턴스 소멸 시 정리 (메시지 타임아웃 제거)
    destroy() {
        this._clearMessageTimeout();
        this.clearCanvas();
        console.log('UIController destroyed');
    }

    // 모든 버튼 토글 (활성화/비활성화)
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

    // FPS 관련 요소(input, label) 토글 (활성화/비활성화)
    _toggleFPSElements(disable) {
        const { fpsInput } = this.elements;
        if (!fpsInput) return;

        fpsInput.disabled = disable;
    }

    // Delay 관련 요소(input, wrapper) 토글 (활성화/비활성화)
    _toggleDelayElements(disable) {
        const { delayInput } = this.elements;
        if (!delayInput) return;

        delayInput.disabled = disable;
    }

    // 지정된 버튼들 활성화
    _enableButtons(buttonKeys) {
        buttonKeys.forEach(key => {
            if (this.elements[key]) {
                this.elements[key].disabled = false;
            }
        });
    }

    // 지정된 요소에 활성 클래스(active) 추가
    _addActiveClass(elementKey) {
        if (this.elements[elementKey]) {
            this.elements[elementKey].classList.add(Config.CLASSES.ACTIVE);
        }
    }

    // 조건에 따라 요소의 클래스 토글
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

    // 상태 정보로부터 경로 텍스트 생성
    _getPathText(statusInfo) {
        if (this.currentMessage) {
            return `Status: [${this.messageType.toUpperCase()}] ${this.currentMessage}`;
        }
        return statusInfo.path ? `Status: ${statusInfo.path}` : 'Status: ';
    }

    // 메시지 타임아웃 클리어
    _clearMessageTimeout() {
        if (this.messageTimeout) {
            clearTimeout(this.messageTimeout);
            this.messageTimeout = null;
        }
    }
}