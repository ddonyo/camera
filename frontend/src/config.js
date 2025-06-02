// 애플리케이션 설정 및 상수

// 애플리케이션 상태
export const State = Object.freeze({
    IDLE: Symbol('IDLE'),         // 유휴 상태
    LIVE: Symbol('LIVE'),         // 라이브 스트리밍 상태
    RECORD: Symbol('RECORD'),       // 녹화 상태
    PLAYBACK: Symbol('PLAYBACK')    // 재생 상태
});

// 재생 방향
export const Direction = Object.freeze({
    FORWARD: 1,  // 정방향
    REVERSE: -1  // 역방향
});

// 메시지 유형
export const MessageType = Object.freeze({
    INFO: 'info',        // 정보
    ERROR: 'error',      // 오류
    WARNING: 'warning',  // 경고
    LOADING: 'loading'   // 로딩
});

// IPC 명령어
export const IPCCommands = Object.freeze({
    // 스트리밍
    START_STREAMING: 'start-live',   // 스트리밍 시작
    STOP_STREAMING: 'stop-live',     // 스트리밍 중지

    // 녹화
    START_RECORDING: 'start-record', // 녹화 시작
    STOP_RECORDING: 'stop-record',   // 녹화 중지

    // 로그
    LOG_MESSAGE: 'log-message'       // 로그 메시지
});

// CSS 클래스
export const CSSClasses = Object.freeze({
    // 상태
    ACTIVE: 'active',     // 활성
    DISABLED: 'disabled',  // 비활성
    ENABLED: 'enabled',   // 사용 가능
    NORMAL: 'normal',     // 보통

    // 메시지 유형 (MessageType 값 연동)
    ...MessageType
});

// 애플리케이션 설정 객체
export const Config = Object.freeze({
    // FPS 설정
    FPS: {
        DEFAULT: 30,          // 기본 FPS
        RECORD_DEFAULT: 15,   // 녹화 기본 FPS
        MIN: 1,               // 최소 FPS
        MAX: 60               // 최대 FPS
    },

    // 경로 및 확장자
    PATHS: {
        RECORD_FRAME: './record/frame',          // 녹화 프레임 경로/파일명
        RECORD_FRAME_EXTENSION: '.jpg'       // 녹화 프레임 확장자
    },

    // UI 설정
    UI: {
        MESSAGE_TIMEOUT: 3000 // 메시지 표시 시간 (ms)
    },

    // 타이밍 설정
    TIMING: {
        MODE_SWITCH_DELAY: 200 // 모드 전환 지연 (ms)
    },

    // CSS 클래스 객체
    CLASSES: CSSClasses
});

// 상태 이름
export const StateNames = Object.freeze({
    [State.LIVE]: 'Live',
    [State.RECORD]: 'Record',
    [State.PLAYBACK]: 'Playback',
    [State.IDLE]: 'Idle'
});

// 오류 메시지
export const ErrorMessages = Object.freeze({
    LOAD_RECORD_FRAME_FAILED: 'Failed to load record frame', // 녹화 프레임 로드 실패
    NO_RECORDED_FRAMES: 'No recorded frames found',          // 녹화 프레임 없음
    LOAD_RECORDED_FRAMES_FAILED: 'Failed to load recorded frames', // 전체 녹화 프레임 로드 실패
    ALREADY_PLAYING: 'Already playing, ignoring duplicate play call' // 중복 재생 시도
});

// 정보 메시지
export const InfoMessages = Object.freeze({
    LOADING_FRAMES: 'Loading recorded frames...' // 녹화 프레임 로딩 중
});