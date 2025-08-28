// backend/src/hand-worker.js
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');

class HandWorker extends EventEmitter {
    constructor(config = {}) {
        super();
        this.process = null;
        this.isRunning = false;
        this.config = {
            fps_limit: 15,
            max_num_hands: 2,
            min_detection_confidence: 0.5,
            min_tracking_confidence: 0.5,
            ...config
        };
        this.lastProcessTime = 0;
        this.frameInterval = 1000 / this.config.fps_limit;
        this.pendingFrames = 0;
        this.maxPendingFrames = 3; // Drop frames if too many pending
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
                stdio: ['pipe', 'pipe', 'pipe']
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
                    reject(new Error(`Python dependencies not found. Install with: pip install mediapipe opencv-python\nError: ${errorOutput}`));
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
            stdio: ['pipe', 'pipe', 'pipe']
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

        // Send initial configuration
        this.sendCommand({
            type: 'config',
            config: {
                max_num_hands: this.config.max_num_hands,
                min_detection_confidence: this.config.min_detection_confidence,
                min_tracking_confidence: this.config.min_tracking_confidence
            }
        });
    }

    sendCommand(command) {
        if (!this.process || !this.isRunning) {
            return false;
        }

        try {
            this.process.stdin.write(JSON.stringify(command) + '\n');
            return true;
        } catch (error) {
            console.error('[HandWorker] Failed to send command:', error);
            return false;
        }
    }

    processFrame(imageBuffer) {
        if (!this.isRunning) {
            console.log('[HandWorker] Skipping frame - worker not running');
            return false;
        }

        // Validate image buffer
        if (!imageBuffer || imageBuffer.length === 0) {
            console.log('[HandWorker] Skipping frame - empty image buffer');
            return false;
        }

        // Rate limiting
        const now = Date.now();
        if (now - this.lastProcessTime < this.frameInterval) {
            return false; // Skip frame due to rate limit
        }

        // Drop frame if too many pending
        if (this.pendingFrames >= this.maxPendingFrames) {
            console.log('[HandWorker] Dropping frame - too many pending:', this.pendingFrames);
            return false;
        }

        this.lastProcessTime = now;
        this.pendingFrames++;

        // Convert image buffer to base64
        const base64Image = imageBuffer.toString('base64');

        return this.sendCommand({
            type: 'process_frame',
            image_data: base64Image,
            format: 'base64'
        });
    }

    processImagePath(imagePath) {
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
            
            return this.processFrame(imageBuffer);
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
            this.emit('detection', {
                hands: result.hands,
                timestamp: result.timestamp,
                frameTime: Date.now()
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
                min_tracking_confidence: this.config.min_tracking_confidence
            }
        });
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
            lastProcessTime: this.lastProcessTime
        };
    }
}

module.exports = HandWorker;