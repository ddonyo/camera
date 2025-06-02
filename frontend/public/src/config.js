// 애플리케이션 상태
export const State = Object.freeze({
    IDLE: Symbol('IDLE'),
    LIVE: Symbol('LIVE'),
    RECORD: Symbol('RECORD'),
    PLAYBACK: Symbol('PLAYBACK')
});

// 메시지 타입 (UI 메시지 및 CSS 클래스와 연동)
export const MessageType = Object.freeze({
    INFO: 'info',
    ERROR: 'error',
    WARNING: 'warning',
    LOADING: 'loading'
});

// CSS 클래스 상수
export const CSSClasses = Object.freeze({
    // 상태 관련
    ACTIVE: 'active',
    DISABLED: 'disabled',
    ENABLED: 'enabled',
    NORMAL: 'normal',

    // 메시지 타입 (MessageType과 동일한 값)
    ...MessageType
});

// 애플리케이션 설정
export const Config = Object.freeze({
    // FPS 관련 설정
    FPS: {
        DEFAULT: 30,
        RECORD_DEFAULT: 15,
        MIN: 1,
        MAX: 60
    },

    // 파일 경로 및 확장자
    PATHS: {
        RECORD_FRAME: './record/frame',
        RECORD_FRAME_EXTENSION: '.jpg'
    },

    // UI 관련 설정
    UI: {
        MESSAGE_TIMEOUT: 3000
    },

    // CSS 클래스
    CLASSES: CSSClasses
});

// 에러 메시지
export const ErrorMessages = Object.freeze({
    LOAD_RECORD_FRAME_FAILED: 'Failed to load record frame',
    NO_RECORDED_FRAMES: 'No recorded frames found',
    LOAD_RECORDED_FRAMES_FAILED: 'Failed to load recorded frames',
    ALREADY_PLAYING: 'Already playing, ignoring duplicate play call'
});

// 정보 메시지
export const InfoMessages = Object.freeze({
    LOADING_FRAMES: 'Loading recorded frames...'
});