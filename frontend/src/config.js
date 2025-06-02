// 애플리케이션 상태
export const State = Object.freeze({
    IDLE: Symbol('IDLE'),
    LIVE: Symbol('LIVE'),
    RECORD: Symbol('RECORD'),
    PLAYBACK: Symbol('PLAYBACK')
});

// 재생 방향
export const Direction = Object.freeze({
    FORWARD: 1,
    REVERSE: -1
});

// 메시지 타입 (UI 메시지 및 CSS 클래스와 연동)
export const MessageType = Object.freeze({
    INFO: 'info',
    ERROR: 'error',
    WARNING: 'warning',
    LOADING: 'loading'
});

// IPC 명령어
export const IPCCommands = Object.freeze({
    START_LIVE: 'start-live',
    STOP_LIVE: 'stop-live',
    START_RECORD: 'start-record',
    STOP_RECORD: 'stop-record'
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

    // 타이밍 관련 설정
    TIMING: {
        MODE_SWITCH_DELAY: 200
    },

    // CSS 클래스
    CLASSES: CSSClasses
});

// 상태 이름 매핑
export const StateNames = Object.freeze({
    [State.LIVE]: 'Live',
    [State.RECORD]: 'Record',
    [State.PLAYBACK]: 'Playback',
    [State.IDLE]: 'Idle'
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