const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');

const router = express.Router();

// Configure multer for handling uploaded images
const upload = multer({
    dest: path.join(__dirname, '../../../temp/pose-analysis/'),
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// Ensure temp directory exists
const tempDir = path.join(__dirname, '../../../temp/pose-analysis/');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

/**
 * POST /api/pose-analysis/back-view
 * Analyze image for back view detection using MediaPipe
 */
router.post('/back-view', async (req, res) => {
    try {
        const { imagePath } = req.body;

        if (!imagePath) {
            return res.status(400).json({
                success: false,
                error: 'imagePath is required'
            });
        }

        // Check if image file exists
        const fullImagePath = path.resolve(imagePath);
        if (!fs.existsSync(fullImagePath)) {
            return res.status(404).json({
                success: false,
                error: 'Image file not found: ' + imagePath
            });
        }

        console.log(`[PoseAnalysis] Analyzing back view for: ${fullImagePath}`);

        // Call Python pose file analysis script
        const pythonScript = path.join(__dirname, '../pose-file-analysis.py');
        const python = spawn('python', [pythonScript], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        // Prepare input data for Python script
        const inputData = {
            image_path: fullImagePath
        };

        let output = '';
        let errorOutput = '';

        python.stdout.on('data', (data) => {
            output += data.toString();
        });

        python.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        python.on('close', (code) => {
            if (code !== 0) {
                console.error(`[PoseAnalysis] Python script error (code ${code}):`, errorOutput);
                return res.status(500).json({
                    success: false,
                    error: 'Pose detection failed',
                    details: errorOutput
                });
            }

            try {
                // Parse the JSON output from Python
                const result = JSON.parse(output.trim());

                if (result.success && result.pose && result.pose.detected) {
                    const backViewInfo = result.pose.back_view;

                    console.log(`[PoseAnalysis] Back view detection result:`, backViewInfo);

                    res.json({
                        success: true,
                        backView: {
                            isBackView: backViewInfo.is_back_view,
                            confidence: backViewInfo.confidence,
                            frontVisibility: backViewInfo.front_visibility,
                            backVisibility: backViewInfo.back_visibility,
                            reason: backViewInfo.reason
                        },
                        timestamp: Date.now()
                    });
                } else {
                    // No pose detected or analysis failed
                    res.json({
                        success: true,
                        backView: {
                            isBackView: false,
                            confidence: 0,
                            frontVisibility: 0,
                            backVisibility: 0,
                            reason: 'no_pose_detected'
                        },
                        timestamp: Date.now()
                    });
                }
            } catch (parseError) {
                console.error('[PoseAnalysis] Failed to parse Python output:', parseError);
                console.error('[PoseAnalysis] Raw output:', output);
                res.status(500).json({
                    success: false,
                    error: 'Failed to parse pose detection result',
                    details: parseError.message
                });
            }
        });

        // Send input data to Python script
        python.stdin.write(JSON.stringify(inputData) + '\n');
        python.stdin.end();

    } catch (error) {
        console.error('[PoseAnalysis] Error in back-view analysis:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * POST /api/pose-analysis/back-view-blob
 * Analyze uploaded thumbnail image for back view detection using MediaPipe
 */
router.post('/back-view-blob', upload.single('image'), async (req, res) => {
    let tempFilePath = null;

    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No image file uploaded'
            });
        }

        tempFilePath = req.file.path;
        console.log(`[PoseAnalysis] Analyzing thumbnail blob: ${tempFilePath}`);

        // Read the uploaded image file
        const imageBuffer = fs.readFileSync(tempFilePath);

        // Call Python pose detection script using binary protocol
        const pythonScript = path.join(__dirname, '../pose-detection.py');
        const python = spawn('python', [pythonScript], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        // Prepare binary protocol header
        const header = {
            type: "process_frame",
            format: "binary",
            data_length: imageBuffer.length,
            crop_info: null // No crop needed for thumbnails
        };

        const headerJson = JSON.stringify(header);
        const headerBuffer = Buffer.from(headerJson, 'utf-8');
        const headerLengthBuffer = Buffer.allocUnsafe(4);
        headerLengthBuffer.writeUInt32LE(headerBuffer.length, 0);

        let output = '';
        let errorOutput = '';

        python.stdout.on('data', (data) => {
            output += data.toString();
        });

        python.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        python.on('close', (code) => {
            // Clean up temp file
            try {
                if (tempFilePath && fs.existsSync(tempFilePath)) {
                    fs.unlinkSync(tempFilePath);
                }
            } catch (cleanupError) {
                console.warn(`[PoseAnalysis] Failed to cleanup temp file: ${cleanupError.message}`);
            }

            if (code !== 0) {
                console.error(`[PoseAnalysis] Python script error (code ${code}):`, errorOutput);
                return res.status(500).json({
                    success: false,
                    error: 'Pose detection failed',
                    details: errorOutput
                });
            }

            try {
                // Parse the JSON output from Python (binary protocol response)
                const result = JSON.parse(output.trim());

                if (result.success && result.pose && result.pose.detected) {
                    const backViewInfo = result.pose.back_view;

                    console.log(`[PoseAnalysis] Thumbnail back view detection result:`, backViewInfo);

                    res.json({
                        success: true,
                        backView: {
                            isBackView: backViewInfo.is_back_view,
                            confidence: backViewInfo.confidence,
                            frontVisibility: backViewInfo.front_visibility,
                            backVisibility: backViewInfo.back_visibility,
                            reason: backViewInfo.reason
                        },
                        timestamp: Date.now()
                    });
                } else {
                    // No pose detected or analysis failed
                    res.json({
                        success: true,
                        backView: {
                            isBackView: false,
                            confidence: 0,
                            frontVisibility: 0,
                            backVisibility: 0,
                            reason: 'no_pose_detected'
                        },
                        timestamp: Date.now()
                    });
                }
            } catch (parseError) {
                console.error('[PoseAnalysis] Failed to parse Python output:', parseError);
                console.error('[PoseAnalysis] Raw output:', output);
                res.status(500).json({
                    success: false,
                    error: 'Failed to parse pose detection result',
                    details: parseError.message
                });
            }
        });

        // Send binary protocol data to Python script
        python.stdin.write(headerLengthBuffer);  // Header length (4 bytes)
        python.stdin.write(headerBuffer);        // Header JSON
        python.stdin.write(imageBuffer);         // Image binary data
        python.stdin.end();

    } catch (error) {
        // Clean up temp file on error
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            try {
                fs.unlinkSync(tempFilePath);
            } catch (cleanupError) {
                console.warn(`[PoseAnalysis] Failed to cleanup temp file on error: ${cleanupError.message}`);
            }
        }

        console.error('[PoseAnalysis] Error in back-view-blob analysis:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * GET /api/pose-analysis/health
 * Health check for pose analysis service
 */
router.get('/health', (req, res) => {
    res.json({
        success: true,
        service: 'pose-analysis',
        timestamp: Date.now()
    });
});

module.exports = router;