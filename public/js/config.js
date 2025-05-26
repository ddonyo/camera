// 애플리케이션 상태
export const State = Object.freeze({
    IDLE: Symbol('IDLE'),
    LIVE: Symbol('LIVE'),
    RECORD: Symbol('RECORD'),
    PLAYBACK: Symbol('PLAYBACK')
});

// 메시지 타입
export const MessageType = Object.freeze({
    INFO: 'info',
    ERROR: 'error',
    WARNING: 'warning',
    LOADING: 'loading'
});

// 애플리케이션 설정
export const Config = Object.freeze({
    CANVAS_WIDTH: 1280,
    CANVAS_HEIGHT: 720,

    DEFAULT_FPS: 30,
    MIN_FPS: 1,
    MAX_FPS: 60,

    LIVE_FRAME_PATH: './live/frame.jpg',
    RECORD_FRAME_PATH: './record/frame',
    RECORD_FRAME_EXTENSION: '.jpg',

    MESSAGE_TIMEOUT: 3000,

    CLASSES: {
        ACTIVE: 'active',
        DISABLED: 'disabled',
        ENABLED: 'enabled',
        LOADING: 'loading',
        ERROR: 'error',
        WARNING: 'warning',
        NORMAL: 'normal'
    }
});

// UI 요소 ID
export const ElementIds = Object.freeze({
    VIEWER: 'viewer',

    PROGRESS_BAR: 'progressBar',
    PROGRESS: 'progress',

    LIVE_BTN: 'liveBtn',
    RECORD_BTN: 'recordBtn',
    PLAY_BTN: 'playBtn',
    REVERSE_BTN: 'reverseBtn',
    PAUSE_BTN: 'pauseBtn',
    REWIND_BTN: 'rewindBtn',
    FAST_FORWARD_BTN: 'fastForwardBtn',
    NEXT_FRAME_BTN: 'nextFrameBtn',
    PREV_FRAME_BTN: 'prevFrameBtn',
    REPEAT_BTN: 'repeatBtn',

    STATUS: 'status',
    STATUS_TEXT: 'statusText',

    FPS_INPUT: 'fpsInput'
});

// 에러 메시지
export const ErrorMessages = Object.freeze({
    LOAD_LIVE_FRAME_FAILED: 'Failed to load live frame',
    LOAD_RECORD_FRAME_FAILED: 'Failed to load record frame',
    NO_RECORDED_FRAMES: 'No recorded frames found',
    LOAD_RECORDED_FRAMES_FAILED: 'Failed to load recorded frames',
    ALREADY_PLAYING: 'Already playing, ignoring duplicate play call',
    INVALID_STATE: 'Invalid state for frame loading attempt',
    NATIVE_LIBRARY_NOT_AVAILABLE: 'Native camera library is not available',
    NATIVE_FUNCTION_FAILED: 'Native function call failed'
});

// 정보 메시지
export const InfoMessages = Object.freeze({
    LOADING_FRAMES: 'Loading recorded frames...',
    NATIVE_LIBRARY_UNAVAILABLE: 'Camera control features are limited. File playback is available.'
});