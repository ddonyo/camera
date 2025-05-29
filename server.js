const express = require('express');
const path = require('path');

// 상수 정의
const CONFIG = {
    DEFAULT_PORT: 3000,
    LOCALE: 'ko-KR',
    BANNER_WIDTH: 50
};

const MESSAGES = {
    SERVER_STARTED: 'MJPEG Server Started',
    NOT_FOUND: 'Page not found.',
    REQUEST_LOG_HEADER: 'Request Log:',
    SHUTDOWN_NOTICE: 'Press Ctrl+C to stop the server'
};

const app = express();
const port = process.env.PORT || CONFIG.DEFAULT_PORT;

// 유틸리티 함수들
const utils = {
    getTimestamp: () => new Date().toLocaleString(CONFIG.LOCALE),

    isProduction: () => process.env.NODE_ENV === 'production',

    isDevelopment: () => !utils.isProduction(),

    formatMethod: (method) => method.padEnd(6),

    createBanner: (content) => {
        const separator = '='.repeat(CONFIG.BANNER_WIDTH);
        return Array.isArray(content)
            ? [separator, ...content, separator].join('\n')
            : [separator, content, separator].join('\n');
    },

    logRequest: (req, type = 'INFO') => {
        const timestamp = utils.getTimestamp();
        const method = utils.formatMethod(req.method);
        const prefix = type === 'ERROR' ? 'ERROR 404 NOT FOUND: ' : '';
        console.log(`[${timestamp}] ${prefix}${method} ${req.url}`);
    }
};

// 미들웨어 설정
function setupMiddleware() {
    // 요청 로깅 미들웨어
    app.use((req, res, next) => {
        utils.logRequest(req);
        next();
    });

    // 정적 파일 서빙 설정
    const staticOptions = utils.isDevelopment() ? {
        etag: false,
        lastModified: false,
        maxAge: 0
    } : {};

    app.use(express.static(path.join(__dirname, 'public'), staticOptions));
}

// API 라우트 설정
function setupRoutes() {
    // 환경 정보 API
    app.get('/api/env', (req, res) => {
        const isDev = utils.isDevelopment();
        res.json({
            isDev,
            mode: isDev ? 'development' : 'production'
        });
    });

    // 404 핸들러 (마지막에 등록)
    app.use((req, res) => {
        utils.logRequest(req, 'ERROR');
        res.status(404).send(MESSAGES.NOT_FOUND);
    });
}

// 서버 시작 배너 출력
function printStartupBanner() {
    const bannerContent = [
        MESSAGES.SERVER_STARTED,
        `Server URL: http://localhost:${port}`,
        `Mode: ${utils.isProduction() ? 'Production' : 'Development'}`,
        `Start Time: ${utils.getTimestamp()}`,
        '',
        MESSAGES.REQUEST_LOG_HEADER,
        MESSAGES.SHUTDOWN_NOTICE
    ];

    console.log('\n' + utils.createBanner(bannerContent) + '\n');
}

// 서버 시작
function startServer() {
    setupMiddleware();
    setupRoutes();

    app.listen(port, () => {
        printStartupBanner();
    }).on('error', (err) => {
        console.error('Server startup error:', err);
        process.exit(1);
    });
}

// 예상치 못한 종료 처리
function setupGracefulShutdown() {
    const shutdown = (signal) => {
        console.log(`\nReceived ${signal}. Gracefully shutting down...`);
        process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// 애플리케이션 시작
function main() {
    setupGracefulShutdown();
    startServer();
}

// 직접 실행 시에만 서버 시작 (모듈로 사용될 경우 대비)
if (require.main === module) {
    main();
}

// 테스트를 위한 export (필요시)
module.exports = { app, utils };