// frontend/src/vton-service.js
import { safeText, wait } from './dom.js';

const API_BASE = location.origin.startsWith('file') ? 'http://localhost:3000' : '';
export const VTON_ENDPOINT = {
    create: `${API_BASE}/api/v1/vton/jobs`,
    status: (jobId) => `${API_BASE}/api/v1/vton/jobs/${encodeURIComponent(jobId)}`
};

// Mock 이미지 매핑
const MOCK_RESULT_MAP = {
    'green-suit': './resources/vton/vton_green_suit.PNG',
};

const MockVTON = {
    run(personRef, garmentId, options, onProgress) {
        const min = 1800, max = 4200;
        const totalMs = Math.floor(Math.random() * (max - min) + min);
        const stages = [
            { t: 0.10, label: 'Preparing assets...' },
            { t: 0.35, label: 'Body parsing...' },
            { t: 0.65, label: 'Fitting garment...' },
            { t: 0.85, label: 'Compositing...' },
            { t: 1.00, label: 'Finalizing...' },
        ];
        return new Promise((resolve) => {
            const start = performance.now();
            let i = 0;
            const tick = () => {
                const now = performance.now();
                const p = Math.min(1, (now - start) / totalMs);
                if (i < stages.length && p >= stages[i].t) i++;
                onProgress?.(p, stages[Math.min(i, stages.length - 1)].label);
                if (p >= 1) {
                    resolve({ status: 'succeeded', resultUrl: MOCK_RESULT_MAP[garmentId] || './resources/vton/placeholder.jpg' });
                } else {
                    requestAnimationFrame(tick);
                }
            };
            requestAnimationFrame(tick);
        });
    }
};

async function createJob({ personRef, garmentId, options }, onProgress) {
    if (!(personRef && personRef.blob)) throw new Error('personRef.blob is required');
    const fd = new FormData();
    fd.append('garment_id', garmentId);
    fd.append('face_lock', String(!!options?.face_lock));
    fd.append('vton_mode', options?.vton_mode || 'balanced');
    fd.append('person_image', personRef.blob, 'person.jpg');
    
    console.log(`[VTON Service] Sending API request with mode: ${options?.vton_mode || 'balanced'}`);
    console.log('[VTON Service] FormData contents:', {
        garment_id: garmentId,
        face_lock: String(!!options?.face_lock),
        vton_mode: options?.vton_mode || 'balanced',
        person_image: 'blob'
    });

    const res = await fetch(VTON_ENDPOINT.create, { method: 'POST', body: fd });
    if (!res.ok) throw new Error(await safeText(res));
    const data = await res.json();
    if (!data.job_id && !data.status && !data.image_base64) throw new Error('Invalid response');
    onProgress?.(0.2, 'Job submitted'); // POST 성공 시 20%
    return data;
}

async function pollJob(jobId, onProgress, { intervalMs = 1200, timeoutMs = 120000 } = {}) {
    const started = Date.now();
    let progressStep = 0.2; // 초기 20%에서 시작
    while (true) {
        if (Date.now() - started > timeoutMs) throw new Error('poll timeout');
        const r = await fetch(VTON_ENDPOINT.status(jobId));
        if (!r.ok) throw new Error(await safeText(r));
        const j = await r.json();

        if (j.status === 'running') {
            progressStep += 0.2; // running마다 20% 증가
            progressStep = Math.min(0.8, progressStep); // 최대 80%
            onProgress?.(progressStep, j.stage || 'Rendering...');
            await wait(intervalMs);
            continue;
        }
        if (['succeeded', 'success', 'completed'].includes(j.status)) {
            onProgress?.(1.0, 'Completed'); // 완료 시 100%
            const b64 = j.result_base64 || j.image_base64 || j.output?.image_base64 || j.data?.output?.image_base64 ||
                j.output?.[0]?.image_base64 || j.data?.output?.[0]?.image_base64;
            const url = j.result_url || j.output_url || j.output?.url;
            return { status: 'succeeded', result_base64: b64, result_url: url };
        }
        if (['failed', 'canceled'].includes(j.status)) {
            return { status: 'failed', error: j.error || j.message || 'failed' };
        }
        return j;
    }
}

export async function runVTONWithFallback({ personRef, garmentId, options, onProgress }) {
    try {
        onProgress?.(0.08, 'Submitting job...'); // 초기 진행률
        const createRes = await createJob({ personRef, garmentId, options }, onProgress);

        if (createRes.status && ['succeeded', 'failed', 'canceled'].includes(createRes.status))
            return createRes;

        if (createRes.ok && createRes.image_base64)
            return { status: 'succeeded', result_base64: createRes.image_base64 };

        const jobId = createRes.job_id;
        if (!jobId) throw new Error('No job_id from server');

        const result = await pollJob(jobId, (p, stage) => {
            onProgress?.(p, stage); // pollJob에서 전달된 진행률 반영
        }, { intervalMs: 1200, timeoutMs: 120000 });
        return result;
    } catch (err) {
        console.warn('Real VTON failed, fallback to Mock:', err);
        return await MockVTON.run(personRef, garmentId, options, (p, stage) => onProgress?.(p, stage));
    }
}