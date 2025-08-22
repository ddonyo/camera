// routes/vton.js (CommonJS)
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Node 18+ 전역 fetch, 이하 버전은 동적 임포트
async function ensureFetch() {
    if (global.fetch) return global.fetch;
    const mod = await import('node-fetch');
    return mod.default;
}

// [신규] 네트워크 타임아웃 도우미
function fetchWithTimeout(fetch, url, options = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    const final = { ...options, signal: controller.signal };
    return fetch(url, final).finally(() => clearTimeout(id));
}

// [선택] 프록시 환경 지원 (회사망일 경우)
// 1) npm i proxy-agent
// 2) HTTPS_PROXY=http://proxy.company:3128  (또는 환경 변수 세팅)
// 3) 주석 해제
// const ProxyAgent = require('proxy-agent');
// const proxyAgent = process.env.HTTPS_PROXY ? new ProxyAgent(process.env.HTTPS_PROXY) : undefined;

function getFashnKey() {
    if (process.env.FASHN_API_KEY) return process.env.FASHN_API_KEY.trim();
    const p = path.resolve(__dirname, '../../config/fashn.key');
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
    throw new Error('FASHN API key not configured (.env or config/fashn.key)');
}

const ROOT_DIR = path.resolve(__dirname, '../../..'); // => 프로젝트 루트
const WARDROBE_DIR = process.env.GARMENT_DIR
    || path.join(ROOT_DIR, 'frontend/public/resources/wardrobe');

function assertFile(rel) {
    const p = path.join(WARDROBE_DIR, rel);
    if (!fs.existsSync(p)) {
        console.error('[VTON] Missing garment asset:', p);
    }
    return p;
}

const GARMENT_MAP = {
    'denim-jacket': assertFile('denim_jacket.webp'),
    'blue-suit': assertFile('blue_suit.jpg'),
    'navy-suit': assertFile('navy_suit.jpg'),
    'party-suit': assertFile('party_suit.jpg'),
    'yellow-shirt': assertFile('yellow_polo_shirt.png'),
    'green-shirt': assertFile('green_polo_shirt.webp'),
    'white-shirt': assertFile('white_shirt.webp'),
    'blue-shirt': assertFile('blue_shirt.jpg'),
    'beige-knit': assertFile('beige_knit.webp'),
    'beige-pants': assertFile('beige_pants.webp'),
    'denim-pants': assertFile('denim_pants.jpg'),
};

function fileToDataURL(absPath) {
    const buf = fs.readFileSync(absPath);
    const ext = path.extname(absPath).toLowerCase();
    const mime =
        ext === '.png' ? 'image/png' :
            ext === '.jpg' ? 'image/jpeg' :
                ext === '.jpeg' ? 'image/jpeg' :
                    ext === '.webp' ? 'image/webp' :
                        'application/octet-stream';
    return `data:${mime};base64,${buf.toString('base64')}`;
}

// POST /vton/jobs
router.post('/jobs', upload.single('person_image'), async (req, res) => {
    const startedAt = Date.now();
    try {
        const fetch = await ensureFetch();
        const apiKey = getFashnKey();

        const garmentId = req.body.garment_id;
        const mode = req.body.mode || 'balanced';

        console.log('[VTON] /jobs inbound',
            { garmentId, hasFile: !!req.file, mime: req.file?.mimetype, size: req.file?.size });

        if (!req.file) return res.status(400).json({ error: 'person_image file is required' });
        if (!garmentId || !GARMENT_MAP[garmentId]) return res.status(400).json({ error: 'invalid garment_id' });

        const personDataURL = `data:${(req.file.mimetype || 'image/jpeg').toLowerCase()};base64,${req.file.buffer.toString('base64')}`;
        const garmentAbs = path.resolve(__dirname, '../../', GARMENT_MAP[garmentId]);
        if (!fs.existsSync(garmentAbs)) {
            return res.status(400).json({ error: `garment file not found: ${garmentAbs}` });
        }
        const garmentDataURL = fileToDataURL(garmentAbs);

        // [중요] 일부 환경에서 CDN가 차단될 수 있으니 base64 직접 반환으로 테스트
        const payload = {
            model_name: 'tryon-v1.6',
            inputs: {
                model_image: personDataURL,
                garment_image: garmentDataURL,
                mode,
                moderation_level: 'conservative',
                return_base64: true, // ← 먼저 base64로 받아서 네트워크 문제 분리
            },
        };

        console.log('[VTON] → FASHN /v1/run (sending)', {
            url: 'https://api.fashn.ai/v1/run',
            mode,
            bodyBytes: JSON.stringify(payload).length
        });

        const runResp = await fetchWithTimeout(
            fetch,
            'https://api.fashn.ai/v1/run',
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'camera/vton-proxy',
                },
                // agent: proxyAgent, // 회사 프록시 필요시 활성화
                body: JSON.stringify(payload),
            },
            45000 // 45s
        ).catch(err => {
            console.error('[VTON] fetch to FASHN failed (network-level):', err);
            throw err;
        });

        console.log('[VTON] ← FASHN /v1/run response', runResp.status, runResp.statusText);

        const text = await runResp.text();
        let runJson = {};
        try { runJson = JSON.parse(text); } catch { /* non json */ }

        if (!runResp.ok) {
            console.error('[VTON] FASHN run error body:', text);
            return res.status(runResp.status).json({ error: `run error: ${text}` });
        }

        // FASHN: 보통 { id }를 주지만, return_base64=true면 completed 즉시 반환일 수도 있음
        if (runJson?.status && (runJson.status === 'completed' || runJson.output)) {
            // 즉시 결과 케이스 (일부 환경에서)
            const out = Array.isArray(runJson.output) ? runJson.output[0] : runJson.output;
            const isDataUrl = typeof out === 'string' && out.startsWith('data:image/');
            console.log('[VTON] FASHN immediate completed', { isDataUrl: !!isDataUrl });
            return res.json({
                status: 'succeeded',
                result_url: isDataUrl ? undefined : out,
                result_base64: isDataUrl ? out.split(',')[1] : undefined,
                raw: runJson,
            });
        }

        if (!runJson?.id) {
            console.error('[VTON] FASHN unexpected body (no id):', text);
            return res.status(502).json({ error: 'No prediction id from FASHN', body: text });
        }

        console.log('[VTON] FASHN accepted id=', runJson.id, 'in', (Date.now() - startedAt) + 'ms');
        return res.json({ job_id: runJson.id, status: 'submitted' });

    } catch (err) {
        console.error('[VTON POST /jobs][fatal]', err);
        return res.status(500).json({ error: String(err?.message || err) });
    }
});

// GET /vton/jobs/:id
router.get('/jobs/:id', async (req, res) => {
    try {
        const fetch = await ensureFetch();
        const apiKey = getFashnKey();
        const id = req.params.id;

        console.log('[VTON] → FASHN /v1/status', id);

        const st = await fetchWithTimeout(fetch, `https://api.fashn.ai/v1/status/${encodeURIComponent(id)}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'User-Agent': 'camera/vton-proxy',
            },
            // agent: proxyAgent, // 회사 프록시 필요시 활성화
        }, 30000).catch(err => {
            console.error('[VTON] status fetch failed (network-level):', err);
            throw err;
        });

        console.log('[VTON] ← FASHN /v1/status', st.status, st.statusText);
        const text = await st.text();
        let j = {};
        try { j = JSON.parse(text); } catch { }

        if (!st.ok) {
            console.error('[VTON] status error body:', text);
            return res.status(st.status).json({ error: `status error: ${text}` });
        }

        if (j.status === 'completed') {
            const out = Array.isArray(j.output) ? j.output[0] : j.output;
            const isDataUrl = typeof out === 'string' && out.startsWith('data:image/');
            return res.json({
                status: 'succeeded',
                result_url: isDataUrl ? undefined : out,
                result_base64: isDataUrl ? out.split(',')[1] : undefined,
                raw: j
            });
        } else if (j.status === 'failed') {
            return res.json({ status: 'failed', error: j.error?.message || 'failed', raw: j });
        } else {
            return res.json({ status: 'running', stage: j.status, raw: j });
        }
    } catch (err) {
        console.error('[VTON GET /jobs/:id][fatal]', err);
        return res.status(500).json({ error: String(err?.message || err) });
    }
});

module.exports = router;
