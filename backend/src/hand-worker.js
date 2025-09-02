// backend/src/hand-worker.js
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
// const sharp = require('sharp'); // Removed - processing done in Python for better performance

class HandWorker extends EventEmitter {
    constructor(config = {}) {
        super();
        this.process = null;
        this.isRunning = false;
        // Detect ARM architecture for optimization
        const isARM = process.arch === 'arm' || process.arch === 'arm64';
        this.config = {
            fps_limit: isARM ? 5 : 15, // Lower FPS on ARM
            max_num_hands: isARM ? 1 : 2, // Detect fewer hands on ARM
            min_detection_confidence: isARM ? 0.6 : 0.5, // Higher threshold on ARM
            min_tracking_confidence: isARM ? 0.6 : 0.5,
            model_complexity: isARM ? 0 : 1, // Use lite model on ARM
            ...config,
        };
        this.lastProcessTime = 0;
        this.frameInterval = 1000 / this.config.fps_limit;
        this.pendingFrames = 0;
        this.maxPendingFrames = isARM ? 1 : 3; // Stricter limit on ARM
        this.frameSkipCounter = 0;
        this.adaptiveFpsEnabled = isARM; // Enable adaptive FPS on ARM
        this.cpuLoadThreshold = 0.8; // Reduce FPS if CPU > 80%
        this.lastCropInfo = null; // Store crop info for coordinate transformation
    }

    async start() {
        if (this.isRunning) {
            console.log('[HandWorker] Already running');
            return;
        }

        try {
            await this.checkPythonDependencies();
            this.startPythonProcess();
            this.isRunning = true;
            console.log('[HandWorker] Started successfully');
        } catch (error) {
            console.error('[HandWorker] Failed to start:', error);
            throw error;
        }
    }

    async checkPythonDependencies() {
        return new Promise((resolve, reject) => {
            const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
            const testProcess = spawn(pythonCmd, ['-c', 'import mediapipe, cv2; print("OK")'], {
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            let output = '';
            let errorOutput = '';

            testProcess.stdout.on('data', (data) => {
                output += data.toString();
            });

            testProcess.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            testProcess.on('close', (code) => {
                if (code === 0 && output.includes('OK')) {
                    resolve();
                } else {
                    reject(
                        new Error(
                            `Python dependencies not found. Install with: pip install mediapipe opencv-python\nError: ${errorOutput}`
                        )
                    );
                }
            });

            testProcess.on('error', (error) => {
                reject(new Error(`Python not found: ${error.message}. Please install Python 3`));
            });
        });
    }

    startPythonProcess() {
        const scriptPath = path.join(__dirname, 'hand-detection.py');
        const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

        this.process = spawn(pythonCmd, [scriptPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        this.process.stdout.on('data', (data) => {
            const lines = data.toString().split('\n');
            for (const line of lines) {
                if (line.trim()) {
                    try {
                        const result = JSON.parse(line);
                        this.handleResult(result);
                    } catch (error) {
                        console.error('[HandWorker] Failed to parse result:', error);
                    }
                }
            }
        });

        this.process.stderr.on('data', (data) => {
            console.error('[HandWorker] Python error:', data.toString());
        });

        this.process.on('close', (code) => {
            console.log(`[HandWorker] Python process exited with code ${code}`);
            this.isRunning = false;
            this.emit('stopped', code);
        });

        this.process.on('error', (error) => {
            console.error('[HandWorker] Process error:', error);
            this.isRunning = false;
            this.emit('error', error);
        });

        // Send initial configuration with model complexity
        this.sendCommand({
            type: 'config',
            config: {
                max_num_hands: this.config.max_num_hands,
                min_detection_confidence: this.config.min_detection_confidence,
                min_tracking_confidence: this.config.min_tracking_confidence,
                model_complexity: this.config.model_complexity || 1,
            },
        });
    }

    sendCommand(command) {
        if (!this.process || !this.isRunning) {
            return false;
        }

        try {
            // Use binary protocol for all commands
            const header = JSON.stringify(command);
            const headerBuffer = Buffer.from(header);
            const headerLength = Buffer.allocUnsafe(4);
            headerLength.writeUInt32LE(headerBuffer.length, 0);
            
            this.process.stdin.write(headerLength);
            this.process.stdin.write(headerBuffer);
            
            return true;
        } catch (error) {
            console.error('[HandWorker] Failed to send command:', error);
            return false;
        }
    }

    async processFrame(imageBuffer, cropMode = false, roiConfig = null) {
        if (!this.isRunning) {
            console.log('[HandWorker] Skipping frame - worker not running');
            return false;
        }

        // Validate image buffer
        if (!imageBuffer || imageBuffer.length === 0) {
            console.log('[HandWorker] Skipping frame - empty image buffer');
            return false;
        }

        // Rate limiting with adaptive FPS
        const now = Date.now();
        const currentInterval = this.adaptiveFpsEnabled ? this.getAdaptiveInterval() : this.frameInterval;
        if (now - this.lastProcessTime < currentInterval) {
            this.frameSkipCounter++;
            return false; // Skip frame due to rate limit
        }

        // Drop frame if too many pending
        if (this.pendingFrames >= this.maxPendingFrames) {
            // Don't log every dropped frame to avoid console spam
            if (this.pendingFrames % 10 === 0) {
                console.log('[HandWorker] Dropping frames - too many pending:', this.pendingFrames);
            }
            return false;
        }

        this.lastProcessTime = now;
        this.pendingFrames++;

        try {
            // Prepare crop info for display mode (middle third)
            let cropInfo = null;
            if (cropMode) {
                // Middle third crop info for display purposes
                cropInfo = {
                    offsetX: 1/3,
                    offsetY: 0,
                    scaleX: 1/3,
                    scaleY: 1
                };
            }
            
            // Prepare ROI info separately
            let roiInfo = null;
            if (roiConfig && roiConfig.enabled && roiConfig.start_roi && roiConfig.stop_roi) {
                const startROI = roiConfig.start_roi;
                const stopROI = roiConfig.stop_roi;
                
                // ROI boundaries for detection
                roiInfo = {
                    start_roi: startROI,
                    stop_roi: stopROI,
                    // Calculate bounding box for optimization
                    bbox: {
                        x1: Math.min(startROI.x1, stopROI.x1),
                        y1: Math.min(startROI.y1, stopROI.y1),
                        x2: Math.max(startROI.x2, stopROI.x2),
                        y2: Math.max(startROI.y2, stopROI.y2)
                    }
                };
            }

            // Store both for later use in handleResult
            this.lastCropInfo = cropInfo;
            this.lastRoiInfo = roiInfo;

            // Send binary data length and both crop/roi info as JSON header
            const header = JSON.stringify({
                type: 'process_frame',
                format: 'binary',
                data_length: imageBuffer.length,
                crop_info: cropInfo,
                roi_info: roiInfo
            });

            // Send header length (4 bytes), header, then binary data
            const headerBuffer = Buffer.from(header);
            const headerLength = Buffer.allocUnsafe(4);
            headerLength.writeUInt32LE(headerBuffer.length, 0);
            
            // Write all data to Python process
            this.process.stdin.write(headerLength);
            this.process.stdin.write(headerBuffer);
            this.process.stdin.write(imageBuffer);
            
            return true;
        } catch (error) {
            console.error('[HandWorker] Failed to process image:', error);
            this.pendingFrames--;
            return false;
        }
    }

    processImagePath(imagePath, cropMode = false, roiConfig = null) {
        if (!this.isRunning) {
            return false;
        }

        try {
            const imageBuffer = fs.readFileSync(imagePath);

            // Additional validation for file-based images
            if (!imageBuffer || imageBuffer.length === 0) {
                console.log('[HandWorker] Skipping frame - empty image file:', imagePath);
                return false;
            }

            return this.processFrame(imageBuffer, cropMode, roiConfig);
        } catch (error) {
            console.error('[HandWorker] Failed to read image:', error);
            return false;
        }
    }

    handleResult(result) {
        this.pendingFrames = Math.max(0, this.pendingFrames - 1);

        if (result.error) {
            console.error('[HandWorker] Detection error:', result.error);
            this.emit('error', new Error(result.error));
            return;
        }

        if (result.success && result.hands) {
            // Include crop info if available for coordinate transformation
            this.emit('detection', {
                hands: result.hands,
                timestamp: result.timestamp,
                frameTime: Date.now(),
                cropInfo: this.lastCropInfo,
            });
        }
    }

    ping() {
        return this.sendCommand({ type: 'ping' });
    }

    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        this.frameInterval = 1000 / this.config.fps_limit;

        return this.sendCommand({
            type: 'config',
            config: {
                max_num_hands: this.config.max_num_hands,
                min_detection_confidence: this.config.min_detection_confidence,
                min_tracking_confidence: this.config.min_tracking_confidence,
                model_complexity: this.config.model_complexity || 1,
            },
        });
    }

    getAdaptiveInterval() {
        // Adaptive frame interval based on pending frames
        if (this.pendingFrames >= 2) {
            return this.frameInterval * 2; // Halve FPS if backlogged
        }
        return this.frameInterval;
    }

    stop() {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;

        if (this.process) {
            this.process.kill('SIGTERM');

            // Force kill if not stopped within timeout
            setTimeout(() => {
                if (this.process && !this.process.killed) {
                    console.log('[HandWorker] Force killing process');
                    this.process.kill('SIGKILL');
                }
            }, 5000);

            this.process = null;
        }

        console.log('[HandWorker] Stopped');
    }

    getStatus() {
        return {
            isRunning: this.isRunning,
            pendingFrames: this.pendingFrames,
            config: this.config,
            lastProcessTime: this.lastProcessTime,
            frameSkipCounter: this.frameSkipCounter,
            adaptiveFpsEnabled: this.adaptiveFpsEnabled,
            currentFps: this.frameInterval > 0 ? Math.round(1000 / this.getAdaptiveInterval()) : 0,
        };
    }
}

module.exports = HandWorker;
