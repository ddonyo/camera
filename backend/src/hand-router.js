// backend/src/hand-router.js
const { EventEmitter } = require('events');
const HandWorker = require('./hand-worker');
const { getInstance: getROIConfig } = require('./roi-config');

class HandRouter extends EventEmitter {
    constructor(captureDevice, frameHandler = null) {
        super();
        this.captureDevice = captureDevice;
        this.frameHandler = frameHandler; // FrameHandler reference for recording control
        this.handWorker = null;
        this.roiConfig = getROIConfig();
        this.isEnabled = false;

        // Debouncing and cooldown state
        this.lastTriggers = {
            start: 0,
            stop: 0,
        };

        this.triggerState = {
            start: false, // Whether right hand is currently in start ROI
            stop: false, // Whether left hand is currently in stop ROI
        };

        // Dwell time tracking (1초 동안 ROI에 머물러야 트리거)
        this.dwellState = {
            start: {
                isInROI: false,
                enteredTime: 0,
                progress: 0, // 0 to 1 for visual feedback
                locked: false, // Whether recording is locked in (will start after delay)
                lockTimeout: null, // Timeout ID for delayed start
            },
            stop: {
                isInROI: false,
                enteredTime: 0,
                progress: 0, // 0 to 1 for visual feedback
                locked: false, // Whether stop is locked in (will stop after delay)
                lockTimeout: null, // Timeout ID for delayed stop
            },
        };

        this.DWELL_TIME_MS = 1000; // 1초 dwell time
        this.dwellUpdateInterval = null;

        // Debug mode - Enable verbose logging with HAND_DEBUG=true
        const config = this.roiConfig.get();
        this.debugMode = process.env.HAND_DEBUG === 'true' || (config && config.hand_detection && config.hand_detection.debug_mode);

        // Statistics
        this.stats = {
            framesProcessed: 0,
            handsDetected: 0,
            triggersStart: 0,
            triggersStop: 0,
            lastFrameTime: 0,
        };

        this.setupROIConfigListener();
    }

    setupROIConfigListener() {
        this.roiConfig.on('configChanged', (newConfig) => {
            console.log('[HandRouter] ROI configuration changed');
            // Update debug mode
            this.debugMode = process.env.HAND_DEBUG === 'true' || (newConfig && newConfig.hand_detection && newConfig.hand_detection.debug_mode);
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
            // ROI가 비활성화되어도 hand detection은 작동해야 함
            // ROI disabled = 전체 화면에서 감지
            if (!config) {
                console.log('[HandRouter] No ROI config found, using defaults');
                return;
            }
            
            // Log ROI state but continue regardless
            const isROIEnabled = this.roiConfig.isEnabled();
            console.log(`[HandRouter] ROI mode: ${isROIEnabled ? 'enabled' : 'disabled (detecting anywhere in image)'}`);

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
        this.dwellState = {
            start: { isInROI: false, enteredTime: 0, progress: 0 },
            stop: { isInROI: false, enteredTime: 0, progress: 0 },
        };
        if (this.dwellUpdateInterval) {
            clearInterval(this.dwellUpdateInterval);
            this.dwellUpdateInterval = null;
        }
        console.log('[HandRouter] State reset completed');
    }

    adjustROIForCropMode(roi) {
        // In crop_mode, we don't need to adjust ROI boundaries
        // because hand coordinates are already transformed to full screen space in Python
        // Just return the original ROI
        return roi;
    }

    processFrame(imageBuffer) {
        if (!this.isEnabled || !this.handWorker) {
            return false;
        }

        this.stats.framesProcessed++;
        this.stats.lastFrameTime = Date.now();

        const config = this.roiConfig.get();
        return this.handWorker.processFrame(imageBuffer, config.crop_mode, config);
    }

    processImagePath(imagePath) {
        if (!this.isEnabled || !this.handWorker) {
            return false;
        }

        this.stats.framesProcessed++;
        this.stats.lastFrameTime = Date.now();

        const config = this.roiConfig.get();
        return this.handWorker.processImagePath(imagePath, config.crop_mode, config);
    }

    handleHandDetection(data) {
        const { hands, timestamp, cropInfo } = data;
        const config = this.roiConfig.get();

        // Only log hand count in debug mode
        if (this.debugMode && hands.length > 0) {
            console.log(
                `[HandRouter] ${hands.length} hand(s) detected, crop_mode: ${config.crop_mode}`
            );
        }

        if (!config) {
            return;
        }
        
        // If no hands detected, reset dwell states
        if (hands.length === 0) {
            // Reset START dwell state if active
            if (this.dwellState.start.isInROI) {
                console.log('[HandRouter] No hands detected - resetting START dwell state');
                this.dwellState.start.isInROI = false;
                this.dwellState.start.progress = 0;
                
                // Emit reset progress
                this.emit('dwellProgress', {
                    start: 0,
                    stop: this.dwellState.stop.progress,
                    startActive: false,
                    stopActive: this.dwellState.stop.isInROI,
                });
            }
            
            // Reset STOP dwell state if active
            if (this.dwellState.stop.isInROI) {
                console.log('[HandRouter] No hands detected - resetting STOP dwell state');
                this.dwellState.stop.isInROI = false;
                this.dwellState.stop.progress = 0;
                
                // Emit reset progress
                this.emit('dwellProgress', {
                    start: 0,
                    stop: 0,
                    startActive: false,
                    stopActive: false,
                });
            }
            return;
        }

        // Adjust ROI boundaries for crop_mode
        let adjustedConfig = config;
        if (config.crop_mode) {
            // In crop_mode, we only see middle third (1/3 to 2/3)
            // Need to adjust ROI coordinates to match the transformed hand coordinates
            adjustedConfig = {
                ...config,
                start_roi: this.adjustROIForCropMode(config.start_roi),
                stop_roi: this.adjustROIForCropMode(config.stop_roi)
            };
        }

        this.stats.handsDetected += hands.length;

        // Process each detected hand
        let rightHandInStartROI = false;
        let leftHandInStopROI = false;
        let rightHandDetected = false;
        let leftHandDetected = false;

        for (const hand of hands) {
            const { handedness, center, confidence, gesture } = hand;

            // Coordinates are already in full image space (transformed in Python)
            let effectiveCenter = center;

            // Apply flip transformation
            if (adjustedConfig.flip_mode) {
                effectiveCenter = {
                    x: 1 - effectiveCenter.x,
                    y: effectiveCenter.y,
                };
            }

            // MediaPipe returns mirrored handedness for webcam:
            // Physical right hand = "Left" in MediaPipe, Physical left hand = "Right" in MediaPipe
            //
            // We want the effectiveHandedness to represent the PHYSICAL hand, not MediaPipe's result
            // flip_mode false (normal): show physical hand names
            // flip_mode true (flipped): show physical hand names (same as normal)
            const effectiveHandedness = handedness === 'Right' ? 'Left' : 'Right'; // Always flip MediaPipe to show physical hands

            // Show hand position only in debug mode
            if (this.debugMode) {
                console.log(
                    `[HandRouter] ${effectiveHandedness} hand at (${effectiveCenter.x.toFixed(3)}, ${effectiveCenter.y.toFixed(3)}) gesture: ${gesture}, confidence: ${confidence.toFixed(3)} [original: (${center.x.toFixed(3)}, ${center.y.toFixed(3)})]`
                );
            }

            if (confidence < config.min_confidence) {
                if (this.debugMode) {
                    console.log(
                        `[HandRouter] Skipping ${effectiveHandedness} hand - low confidence (${confidence.toFixed(3)} < ${config.min_confidence})`
                    );
                }
                continue;
            }

            // Check if gesture is open palm
            const isOpenPalm = gesture === 'open_palm';
            
            // Track which hands are detected with open palm
            if (effectiveHandedness === 'Right' && isOpenPalm) {
                rightHandDetected = true;
            } else if (effectiveHandedness === 'Left' && isOpenPalm) {
                leftHandDetected = true;
            }
            
            // Skip if not open palm
            if (!isOpenPalm) {
                if (this.debugMode) {
                    console.log(`[HandRouter] Skipping ${effectiveHandedness} hand - gesture: ${gesture} (not open palm)`);
                }
                continue;
            }

            // Check ROI intersections or full image detection based on enabled state
            // Right hand -> start ROI (녹화 시작), Left hand -> stop ROI (녹화 중지)
            // ROI 모드 상태 로그는 처음 몇 번만
            const isROIEnabled = this.roiConfig.isEnabled();
            if (this.stats.handsDetected < 5) {
                console.log(`[HandRouter] ROI enabled state: ${isROIEnabled}, checking hand: ${effectiveHandedness}`);
            }
            if (isROIEnabled) {
                // ROI mode enabled - check boundaries
                if (effectiveHandedness === 'Right') {
                    if (this.roiConfig.isPointInROI(effectiveCenter.x, effectiveCenter.y, 'start')) {
                        rightHandInStartROI = true;
                        // Always log ROI hits
                        console.log(
                            `[HandRouter] Right hand (open palm) in START ROI at (${effectiveCenter.x.toFixed(3)}, ${effectiveCenter.y.toFixed(3)})`
                        );
                    }
                } else if (effectiveHandedness === 'Left') {
                    if (this.roiConfig.isPointInROI(effectiveCenter.x, effectiveCenter.y, 'stop')) {
                        leftHandInStopROI = true;
                        // Always log ROI hits
                        console.log(
                            `[HandRouter] Left hand (open palm) in STOP ROI at (${effectiveCenter.x.toFixed(3)}, ${effectiveCenter.y.toFixed(3)})`
                        );
                    }
                }
            } else {
                // ROI mode disabled - detect anywhere in the image
                if (effectiveHandedness === 'Right') {
                    rightHandInStartROI = true;
                    console.log(
                        `[HandRouter] Right hand (open palm) detected (full image) at (${effectiveCenter.x.toFixed(3)}, ${effectiveCenter.y.toFixed(3)})`
                    );
                } else if (effectiveHandedness === 'Left') {
                    leftHandInStopROI = true;
                    console.log(
                        `[HandRouter] Left hand (open palm) detected (full image) at (${effectiveCenter.x.toFixed(3)}, ${effectiveCenter.y.toFixed(3)})`
                    );
                }
            }
        }

        // Handle trigger logic with debouncing and cooldown
        this.handleTriggerLogic(
            rightHandInStartROI,
            leftHandInStopROI,
            config,
            rightHandDetected,
            leftHandDetected
        );

        // Show ROI status only in debug mode (already logged above when ROI hit)
        if (this.debugMode && (rightHandInStartROI || leftHandInStopROI)) {
            console.log(
                `[HandRouter] ROI HIT! Right in start: ${rightHandInStartROI}, Left in stop: ${leftHandInStopROI}`
            );
        }

        // Emit detection event for UI feedback
        const isRecordingNow = this.frameHandler && this.frameHandler.isRecording;
        this.emit('handDetection', {
            hands,
            rightHandInStartROI: rightHandInStartROI && !isRecordingNow, // Block START ROI when recording
            leftHandInStopROI: leftHandInStopROI && isRecordingNow, // Block STOP ROI when not recording
            timestamp,
            isRecording: isRecordingNow,
        });
    }

    handleTriggerLogic(
        rightHandInStartROI,
        leftHandInStopROI,
        config,
        rightHandDetected = false,
        leftHandDetected = false
    ) {
        const now = Date.now();

        // Handle START ROI with dwell time (only if not already recording)
        const isRecording = this.frameHandler && this.frameHandler.isRecording;
        
        // Only reset if not locked
        if (!rightHandDetected && this.dwellState.start.isInROI && !this.dwellState.start.locked) {
            console.log('[HandRouter] Right hand (open palm) lost - resetting START dwell state');
            this.dwellState.start.isInROI = false;
            this.dwellState.start.progress = 0;
            
            // Emit reset progress
            this.emit('dwellProgress', {
                start: 0,
                stop: this.dwellState.stop.progress,
                startActive: false,
                stopActive: this.dwellState.stop.isInROI || this.dwellState.stop.locked,
            });
        }
        // If locked, just keep updating progress without any interruption
        
        // Only reset if not locked
        if (!leftHandDetected && this.dwellState.stop.isInROI && !this.dwellState.stop.locked) {
            console.log('[HandRouter] Left hand (open palm) lost - resetting STOP dwell state');
            this.dwellState.stop.isInROI = false;
            this.dwellState.stop.progress = 0;
            
            // Emit reset progress
            this.emit('dwellProgress', {
                start: this.dwellState.start.progress,
                stop: 0,
                startActive: this.dwellState.start.isInROI || this.dwellState.start.locked,
                stopActive: false,
            });
        }
        // If locked, just keep updating progress without any interruption
        
        if (rightHandInStartROI && !isRecording && !this.dwellState.start.locked) {
            if (!this.dwellState.start.isInROI) {
                // Hand just detected - immediately lock in recording decision
                this.dwellState.start.isInROI = true;
                this.dwellState.start.enteredTime = now;
                this.dwellState.start.progress = 0;
                this.dwellState.start.locked = true; // Lock immediately

                console.log('[HandRouter] Right hand (open palm) detected - recording will start in 1 second');

                // Start progress update for visual feedback
                this.startDwellProgress('start');
                
                // Schedule recording start after 1 second
                if (now - this.lastTriggers.start > config.cooldown_ms) {
                    this.dwellState.start.lockTimeout = setTimeout(() => {
                        if (this.dwellState.start.locked) {
                            this.lastTriggers.start = Date.now();
                            this.stats.triggersStart++;
                            console.log('[HandRouter] START TRIGGER - 1 second delay completed, starting recording now');
                            this.triggerRecordingStart();
                            
                            // Reset state after trigger
                            this.dwellState.start.isInROI = false;
                            this.dwellState.start.progress = 0;
                            this.dwellState.start.locked = false;
                            this.dwellState.start.lockTimeout = null;
                        }
                    }, this.DWELL_TIME_MS);
                } else {
                    console.log('[HandRouter] Cooldown active - recording start cancelled');
                    this.dwellState.start.locked = false;
                }
            }
        } else if (this.dwellState.start.locked) {
            // Keep updating progress while locked, regardless of hand presence
            const dwellTime = now - this.dwellState.start.enteredTime;
            this.dwellState.start.progress = Math.min(dwellTime / this.DWELL_TIME_MS, 1);
        } else if (!rightHandInStartROI && !this.dwellState.start.locked) {
            // Hand not detected and not locked - reset
            if (this.dwellState.start.isInROI) {
                if (this.debugMode) {
                    const reason = isRecording ? 'recording active' : 'hand not detected';
                    console.log(`[HandRouter] Right hand START ROI reset - ${reason}`);
                }
                this.dwellState.start.isInROI = false;
                this.dwellState.start.progress = 0;
            }
            
            // Log when recording blocks START ROI
            if (rightHandInStartROI && isRecording) {
                if (this.debugMode) {
                    console.log('[HandRouter] START ROI ignored - recording in progress');
                }
            }
        }

        // Handle STOP ROI with dwell time (only if recording)
        if (leftHandInStopROI && isRecording && !this.dwellState.stop.locked) {
            if (!this.dwellState.stop.isInROI) {
                // Hand just detected - immediately lock in stop decision
                this.dwellState.stop.isInROI = true;
                this.dwellState.stop.enteredTime = now;
                this.dwellState.stop.progress = 0;
                this.dwellState.stop.locked = true; // Lock immediately

                console.log('[HandRouter] Left hand (open palm) detected - recording will stop in 1 second');

                // Start progress update for visual feedback
                this.startDwellProgress('stop');
                
                // Schedule recording stop after 1 second
                if (now - this.lastTriggers.stop > config.cooldown_ms) {
                    this.dwellState.stop.lockTimeout = setTimeout(() => {
                        if (this.dwellState.stop.locked) {
                            this.lastTriggers.stop = Date.now();
                            this.stats.triggersStop++;
                            console.log('[HandRouter] STOP TRIGGER - 1 second delay completed, stopping recording now');
                            this.triggerRecordingStop();
                            
                            // Reset state after trigger
                            this.dwellState.stop.isInROI = false;
                            this.dwellState.stop.progress = 0;
                            this.dwellState.stop.locked = false;
                            this.dwellState.stop.lockTimeout = null;
                        }
                    }, this.DWELL_TIME_MS);
                } else {
                    console.log('[HandRouter] Cooldown active - recording stop cancelled');
                    this.dwellState.stop.locked = false;
                }
            }
        } else if (this.dwellState.stop.locked) {
            // Keep updating progress while locked, regardless of hand presence
            const dwellTime = now - this.dwellState.stop.enteredTime;
            this.dwellState.stop.progress = Math.min(dwellTime / this.DWELL_TIME_MS, 1);
        } else if (!leftHandInStopROI && !this.dwellState.stop.locked) {
            // Hand not detected and not locked - reset
            if (this.dwellState.stop.isInROI) {
                if (this.debugMode) {
                    const reason = !isRecording ? 'not recording' : 'hand not detected';
                    console.log(`[HandRouter] Left hand STOP ROI reset - ${reason}`);
                }
                this.dwellState.stop.isInROI = false;
                this.dwellState.stop.progress = 0;
            }
            
            // Log when not recording blocks STOP ROI
            if (leftHandInStopROI && !isRecording) {
                if (this.debugMode) {
                    console.log('[HandRouter] STOP ROI ignored - not recording');
                }
            }
        }
    }

    startDwellProgress(type) {
        // Emit progress updates for UI feedback
        if (!this.dwellUpdateInterval) {
            this.dwellUpdateInterval = setInterval(() => {
                const now = Date.now();

                // Update and emit START ROI progress (including locked state)
                if (this.dwellState.start.isInROI || this.dwellState.start.locked) {
                    const dwellTime = now - this.dwellState.start.enteredTime;
                    this.dwellState.start.progress = Math.min(dwellTime / this.DWELL_TIME_MS, 1);
                }

                // Update and emit STOP ROI progress (including locked state)
                if (this.dwellState.stop.isInROI || this.dwellState.stop.locked) {
                    const dwellTime = now - this.dwellState.stop.enteredTime;
                    this.dwellState.stop.progress = Math.min(dwellTime / this.DWELL_TIME_MS, 1);
                }

                // Emit dwell progress for UI
                this.emit('dwellProgress', {
                    start: this.dwellState.start.progress,
                    stop: this.dwellState.stop.progress,
                    startActive: this.dwellState.start.isInROI || this.dwellState.start.locked,
                    stopActive: this.dwellState.stop.isInROI || this.dwellState.stop.locked,
                });

                // Clear interval if no hands in ROI and not locked
                if (
                    !this.dwellState.start.isInROI &&
                    !this.dwellState.stop.isInROI &&
                    !this.dwellState.start.locked &&
                    !this.dwellState.stop.locked
                ) {
                    clearInterval(this.dwellUpdateInterval);
                    this.dwellUpdateInterval = null;
                }
            }, 50); // Update every 50ms for smooth progress
        }
    }

    triggerRecordingStart() {
        console.log('[HandRouter] Triggering recording START');

        // Frontend에만 알리고, 실제 녹화는 Frontend가 처리하도록 함
        // 이렇게 하면 버튼 녹화와 동일한 플로우를 따름
        this.emit('recordingStarted', {
            trigger: 'hand_gesture',
            timestamp: Date.now(),
        });
        
        // Clear start progress bar after recording starts
        this.emit('dwellProgress', {
            start: 0,
            stop: 0,
            startActive: false,
            stopActive: false,
        });
    }

    triggerRecordingStop() {
        console.log('[HandRouter] Triggering recording STOP');

        // Frontend에만 알리고, 실제 녹화 중지는 Frontend가 처리하도록 함
        // 이렇게 하면 버튼 녹화와 동일한 플로우를 따름
        this.emit('recordingStopped', {
            trigger: 'hand_gesture',
            timestamp: Date.now(),
        });
        
        // Clear stop progress bar after recording stops
        this.emit('dwellProgress', {
            start: 0,
            stop: 0,
            startActive: false,
            stopActive: false,
        });
    }

    // Test methods for unit testing
    simulateHandDetection(handedness, x, y, confidence = 0.8) {
        const fakeHand = {
            handedness: handedness,
            confidence: confidence,
            center: { x, y },
            bbox: { x1: x - 0.1, y1: y - 0.1, x2: x + 0.1, y2: y + 0.1 },
            landmarks: [],
        };

        const fakeData = {
            hands: [fakeHand],
            timestamp: Date.now(),
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
            handWorkerStatus: this.handWorker ? this.handWorker.getStatus() : null,
        };
    }

    getStats() {
        return {
            ...this.stats,
            uptime: this.isEnabled ? Date.now() - this.stats.lastFrameTime : 0,
        };
    }
}

module.exports = HandRouter;
