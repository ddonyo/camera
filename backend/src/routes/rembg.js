// routes/rembg.js (CommonJS)
const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// POST /rembg/remove
router.post('/remove', upload.single('image'), async (req, res) => {
    const startTime = Date.now();

    try {
        console.log('[REMBG] Starting background removal');

        if (!req.file) {
            return res.status(400).json({ error: 'Image file is required' });
        }

        // 임시 파일 경로 생성
        const tempDir = path.join(__dirname, '../../temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const inputPath = path.join(tempDir, `input_${Date.now()}.jpg`);
        const outputPath = path.join(tempDir, `output_${Date.now()}.png`);

        // 입력 이미지를 임시 파일로 저장
        fs.writeFileSync(inputPath, req.file.buffer);

        // rembg Python 스크립트 실행
        const scriptPath = path.join(__dirname, '../rembg_script.py');
        const rembgProcess = spawn('python', [scriptPath, inputPath, outputPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        rembgProcess.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        rembgProcess.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        rembgProcess.on('close', (code) => {
            try {
                // 임시 입력 파일 정리
                if (fs.existsSync(inputPath)) {
                    fs.unlinkSync(inputPath);
                }

                if (code !== 0) {
                    console.error('[REMBG] Process failed with code:', code);
                    console.error('[REMBG] stderr:', stderr);

                    let errorMessage = 'Background removal failed';
                    if (stderr.includes('ModuleNotFoundError') || stderr.includes('ImportError')) {
                        errorMessage =
                            'Missing Python dependencies. Please run: pip install rembg[new] onnxruntime aiohttp filetype pillow numpy';
                    }

                    return res.status(500).json({
                        error: errorMessage,
                        details: stderr,
                        code: code,
                    });
                }

                // 결과 파일 확인
                if (!fs.existsSync(outputPath)) {
                    console.error('[REMBG] Output file not created');
                    return res
                        .status(500)
                        .json({ error: 'Background removal failed - no output file' });
                }

                // 결과를 base64로 인코딩
                const resultBuffer = fs.readFileSync(outputPath);
                const base64Result = resultBuffer.toString('base64');

                // 임시 출력 파일 정리
                fs.unlinkSync(outputPath);

                const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
                console.log(`[REMBG] Background removal completed in ${elapsedTime} seconds`);

                res.json({
                    success: true,
                    result_base64: base64Result,
                    elapsed_time: elapsedTime,
                });
            } catch (error) {
                console.error('[REMBG] Error processing result:', error);
                res.status(500).json({ error: 'Error processing background removal result' });
            }
        });

        rembgProcess.on('error', (error) => {
            console.error('[REMBG] Failed to start rembg process:', error);

            // 임시 파일 정리
            if (fs.existsSync(inputPath)) {
                fs.unlinkSync(inputPath);
            }

            res.status(500).json({
                error: 'Failed to start background removal process',
                details: error.message,
            });
        });
    } catch (error) {
        console.error('[REMBG] Unexpected error:', error);
        res.status(500).json({ error: 'Unexpected error during background removal' });
    }
});

module.exports = router;
