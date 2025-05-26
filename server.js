const express = require('express');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// 요청 로깅
app.use((req, res, next) => {
    const timestamp = new Date().toLocaleString('ko-KR');
    const method = req.method.padEnd(6);
    console.log(`[${timestamp}] ${method} ${req.url}`);
    next();
});

// 정적 파일 서빙 (개발모드에서 캐시 비활성화)
const staticOptions = process.env.NODE_ENV !== 'production' ? {
    etag: false,
    lastModified: false,
    maxAge: 0
} : {};

app.use(express.static(path.join(__dirname, 'public'), staticOptions));

// 환경 정보 API 엔드포인트
app.get('/api/env', (req, res) => {
    const isDev = process.env.NODE_ENV !== 'production';
    res.json({
        isDev: isDev,
        mode: isDev ? 'development' : 'production'
    });
});

app.use((req, res) => {
    const timestamp = new Date().toLocaleString('ko-KR');
    console.log(`[${timestamp}] ERROR 404 NOT FOUND: ${req.method} ${req.url}`);
    res.status(404).send('Page not found.');
});

// 서버 시작
app.listen(port, () => {
    console.log('\n' + '='.repeat(50));
    console.log('MJPEG Server Started');
    console.log('='.repeat(50));
    console.log(`Server URL: http://localhost:${port}`);
    console.log(`Mode: ${process.env.NODE_ENV === 'production' ? 'Production' : 'Development'}`);
    console.log(`Start Time: ${new Date().toLocaleString('ko-KR')}`);
    console.log('='.repeat(50));
    console.log('Request Log:');
    console.log('Press Ctrl+C to stop the server\n');
}).on('error', (err) => {
    console.error('Server startup error:', err);
    process.exit(1);
});