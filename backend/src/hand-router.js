// backend/src/hand-router.js
const { EventEmitter } = require('events');
const HandWorker = require('./hand-worker');
const { getInstance: getROIConfig } = require('./roi-config');

class HandRouter extends EventEmitter {
    constructor(captureDevice) {
        super();
        this.captureDevice = captureDevice;
        this.handWorker = null;
        this.roiConfig = getROIConfig();
        this.isEnabled = false;
        
        // Debouncing and cooldown state
        this.lastTriggers = {
            start: 0,
            stop: 0
        };
        
        this.triggerState = {
            start: false,  // Whether right hand is currently in start ROI
            stop: false    // Whether left hand is currently in stop ROI  
        };

        // Statistics
        this.stats = {
            framesProcessed: 0,
            handsDetected: 0,
            triggersStart: 0,
            triggersStop: 0,
            lastFrameTime: 0
        };

        this.setupROIConfigListener();
    }

    setupROIConfigListener() {
        this.roiConfig.on('configChanged', (newConfig) => {
            console.log('[HandRouter] ROI configuration changed');
            if (this.handWorker && this.handWorker.isRunning) {
                this.handWorker.updateConfig(newConfig.hand_detection);
            }
        });
    }

    async start() {
        if (this.isEnabled) {
            console.log('[HandRouter] Already started');
            return;
        }

        console.log('[HandRouter] Starting HandRouter...');

        try {
            const config = this.roiConfig.get();
            if (!config || !config.enabled) {
                console.log('[HandRouter] ROI detection disabled in config');
                return;
            }

            // Initialize hand worker
            this.handWorker = new HandWorker(config.hand_detection);
            
            this.handWorker.on('detection', (data) => {
                this.handleHandDetection(data);
            });

            this.handWorker.on('error', (error) => {
                console.error('[HandRouter] Hand worker error:', error);
                this.emit('error', error);
            });

            this.handWorker.on('stopped', () => {
                console.log('[HandRouter] Hand worker stopped');
                this.isEnabled = false;
            });

            await this.handWorker.start();
            this.isEnabled = true;
            
            console.log('[HandRouter] Started successfully');
            this.emit('started');
            
        } catch (error) {
            console.error('[HandRouter] Failed to start:', error);
            this.emit('error', error);
            throw error;
        }
    }

    stop() {
        if (!this.isEnabled) {
            return;
        }

        console.log('[HandRouter] Stopping...');
        
        if (this.handWorker) {
            this.handWorker.stop();
            this.handWorker = null;
        }

        this.isEnabled = false;
        this.resetState();
        
        console.log('[HandRouter] Stopped');
        this.emit('stopped');
    }

    resetState() {
        this.triggerState = { start: false, stop: false };
        this.lastTriggers = { start: 0, stop: 0 };
        console.log('[HandRouter] State reset completed');
    }

    processFrame(imageBuffer) {
        if (!this.isEnabled || !this.handWorker) {
            return false;
        }

        this.stats.framesProcessed++;
        this.stats.lastFrameTime = Date.now();

        return this.handWorker.processFrame(imageBuffer);
    }

    processImagePath(imagePath) {
        if (!this.isEnabled || !this.handWorker) {
            return false;
        }

        this.stats.framesProcessed++;
        this.stats.lastFrameTime = Date.now();

        return this.handWorker.processImagePath(imagePath);
    }

    handleHandDetection(data) {
        const { hands, timestamp } = data;
        const config = this.roiConfig.get();
        
        // Only log when hands are detected or ROI hit
        if (hands.length > 0) {
            console.log(`[HandRouter] ${hands.length} hand(s) detected`);
        }
        
        if (!config || hands.length === 0) {
            return;
        }

        this.stats.handsDetected += hands.length;

        // Process each detected hand
        let rightHandInStartROI = false;
        let leftHandInStopROI = false;

        for (const hand of hands) {
            const { handedness, center, confidence } = hand;
            
            // Apply coordinate transformation based on flip_mode
            const effectiveCenter = config.flip_mode 
                ? { x: 1 - center.x, y: center.y } // Flip X coordinate when flip_mode is true
                : center; // Use original coordinates when flip_mode is false
            
            // MediaPipe returns mirrored handedness for webcam:
            // Physical right hand = "Left" in MediaPipe, Physical left hand = "Right" in MediaPipe
            // 
            // We want the effectiveHandedness to represent the PHYSICAL hand, not MediaPipe's result
            // flip_mode false (normal): show physical hand names
            // flip_mode true (flipped): show physical hand names (same as normal)
            const effectiveHandedness = handedness === 'Right' ? 'Left' : 'Right'; // Always flip MediaPipe to show physical hands
            
            // Show hand position for debugging (use effective handedness and coordinates)
            console.log(`[HandRouter] ${effectiveHandedness} hand at (${effectiveCenter.x.toFixed(3)}, ${effectiveCenter.y.toFixed(3)}) confidence: ${confidence.toFixed(3)} [original: (${center.x.toFixed(3)}, ${center.y.toFixed(3)})]`);
            
            if (confidence < config.min_confidence) {
                console.log(`[HandRouter] Skipping ${effectiveHandedness} hand - low confidence (${confidence.toFixed(3)} < ${config.min_confidence})`);
                continue; 
            }
            
            // Check ROI intersections - always use same logic regardless of flip mode
            // Right hand -> start ROI (녹화 시작), Left hand -> stop ROI (녹화 중지)
            if (effectiveHandedness === 'Right') {
                if (this.roiConfig.isPointInROI(effectiveCenter.x, effectiveCenter.y, 'start')) {
                    rightHandInStartROI = true;
                    console.log(`[HandRouter] Right hand in start ROI at (${effectiveCenter.x.toFixed(3)}, ${effectiveCenter.y.toFixed(3)})`);
                }
            } else if (effectiveHandedness === 'Left') {
                if (this.roiConfig.isPointInROI(effectiveCenter.x, effectiveCenter.y, 'stop')) {
                    leftHandInStopROI = true;
                    console.log(`[HandRouter] Left hand in stop ROI at (${effectiveCenter.x.toFixed(3)}, ${effectiveCenter.y.toFixed(3)})`);
                }
            }
        }

        // Handle trigger logic with debouncing and cooldown  
        this.handleTriggerLogic(rightHandInStartROI, leftHandInStopROI, config);
        
        // Show ROI status when hands detected
        if (rightHandInStartROI || leftHandInStopROI) {
            console.log(`[HandRouter] ROI HIT! Right in start: ${rightHandInStartROI}, Left in stop: ${leftHandInStopROI}`);
        }

        // Emit detection event for UI feedback
        this.emit('handDetection', {
            hands,
            rightHandInStartROI,
            leftHandInStopROI,
            timestamp
        });
    }

    handleTriggerLogic(rightHandInStartROI, leftHandInStopROI, config) {
        const now = Date.now();
        
        // Handle start trigger (right hand in start ROI)
        if (rightHandInStartROI && !this.triggerState.start) {
            // Check debounce and cooldown
            if (now - this.lastTriggers.start > config.cooldown_ms) {
                this.triggerState.start = true;
                this.lastTriggers.start = now;
                this.stats.triggersStart++;
                
                console.log('[HandRouter] START TRIGGER - Right hand entered start ROI');
                this.triggerRecordingStart();
            }
        } else if (!rightHandInStartROI && this.triggerState.start) {
            // Reset state when hand exits ROI
            setTimeout(() => {
                this.triggerState.start = false;
            }, config.debounce_ms);
        }

        // Handle stop trigger (left hand in stop ROI)
        if (leftHandInStopROI && !this.triggerState.stop) {
            // Check debounce and cooldown
            if (now - this.lastTriggers.stop > config.cooldown_ms) {
                this.triggerState.stop = true;
                this.lastTriggers.stop = now;
                this.stats.triggersStop++;
                
                console.log('[HandRouter] STOP TRIGGER - Left hand entered stop ROI');
                this.triggerRecordingStop();
            }
        } else if (!leftHandInStopROI && this.triggerState.stop) {
            // Reset state when hand exits ROI
            setTimeout(() => {
                this.triggerState.stop = false;
            }, config.debounce_ms);
        }
    }

    triggerRecordingStart() {
        if (!this.captureDevice) {
            console.warn('[HandRouter] No capture device available for recording start');
            return;
        }

        console.log('[HandRouter] Triggering recording START');
        
        this.captureDevice.startRecording()
            .then((success) => {
                if (success) {
                    this.emit('recordingStarted', {
                        trigger: 'hand_gesture',
                        timestamp: Date.now()
                    });
                }
            })
            .catch((error) => {
                console.error('[HandRouter] Failed to start recording:', error);
                this.emit('recordingError', error);
            });
    }

    triggerRecordingStop() {
        if (!this.captureDevice) {
            console.warn('[HandRouter] No capture device available for recording stop');
            return;
        }

        console.log('[HandRouter] Triggering recording STOP');
        
        this.captureDevice.stopRecording()
            .then((success) => {
                if (success) {
                    this.emit('recordingStopped', {
                        trigger: 'hand_gesture', 
                        timestamp: Date.now()
                    });
                }
            })
            .catch((error) => {
                console.error('[HandRouter] Failed to stop recording:', error);
                this.emit('recordingError', error);
            });
    }

    // Test methods for unit testing
    simulateHandDetection(handedness, x, y, confidence = 0.8) {
        const fakeHand = {
            handedness: handedness,
            confidence: confidence,
            center: { x, y },
            bbox: { x1: x - 0.1, y1: y - 0.1, x2: x + 0.1, y2: y + 0.1 },
            landmarks: []
        };

        const fakeData = {
            hands: [fakeHand],
            timestamp: Date.now()
        };

        console.log(`[HandRouter] SIMULATION: ${handedness} hand at (${x}, ${y})`);
        this.handleHandDetection(fakeData);
    }

    getStatus() {
        return {
            isEnabled: this.isEnabled,
            triggerState: { ...this.triggerState },
            stats: { ...this.stats },
            config: this.roiConfig.get(),
            handWorkerStatus: this.handWorker ? this.handWorker.getStatus() : null
        };
    }

    getStats() {
        return {
            ...this.stats,
            uptime: this.isEnabled ? Date.now() - this.stats.lastFrameTime : 0
        };
    }
}

module.exports = HandRouter;