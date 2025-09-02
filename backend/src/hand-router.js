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
            vton: 0,
        };

        this.triggerState = {
            start: false, // Whether right hand is currently in start ROI
            stop: false, // Whether left hand is currently in stop ROI
            vton: false, // Whether V gesture is currently in start ROI
        };

        // Dwell time tracking (1초 동안 ROI에 머물러야 트리거)
        this.dwellState = {
            start: {
                isInROI: false,
                enteredTime: 0,
                progress: 0, // 0 to 1 for visual feedback
            },
            stop: {
                isInROI: false,
                enteredTime: 0,
                progress: 0, // 0 to 1 for visual feedback
            },
            vton: {
                isInROI: false,
                enteredTime: 0,
                progress: 0, // 0 to 1 for visual feedback
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
        this.triggerState = { start: false, stop: false, vton: false };
        this.lastTriggers = { start: 0, stop: 0, vton: 0 };
        this.dwellState = {
            start: { isInROI: false, enteredTime: 0, progress: 0 },
            stop: { isInROI: false, enteredTime: 0, progress: 0 },
            vton: { isInROI: false, enteredTime: 0, progress: 0 },
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

        if (!config || hands.length === 0) {
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
        let rightHandVGestureInStartROI = false;

        for (const hand of hands) {
            const { handedness, center, confidence, is_v_gesture } = hand;

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
                    `[HandRouter] ${effectiveHandedness} hand at (${effectiveCenter.x.toFixed(3)}, ${effectiveCenter.y.toFixed(3)}) confidence: ${confidence.toFixed(3)} [original: (${center.x.toFixed(3)}, ${center.y.toFixed(3)})]`
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

            // Check ROI intersections - simple coordinate check
            // Right hand -> start ROI (녹화 시작), Left hand -> stop ROI (녹화 중지)
            if (effectiveHandedness === 'Right') {
                if (this.roiConfig.isPointInROI(effectiveCenter.x, effectiveCenter.y, 'start')) {
                    // Check for V gesture - has higher priority than normal start
                    if (is_v_gesture) {
                        rightHandVGestureInStartROI = true;
                        // Always log V gesture ROI hits
                        console.log(
                            `[HandRouter] Right hand V GESTURE in START ROI at (${effectiveCenter.x.toFixed(3)}, ${effectiveCenter.y.toFixed(3)})`
                        );
                    } else {
                        rightHandInStartROI = true;
                        // Always log ROI hits
                        console.log(
                            `[HandRouter] Right hand in START ROI at (${effectiveCenter.x.toFixed(3)}, ${effectiveCenter.y.toFixed(3)})`
                        );
                    }
                }
            } else if (effectiveHandedness === 'Left') {
                if (this.roiConfig.isPointInROI(effectiveCenter.x, effectiveCenter.y, 'stop')) {
                    leftHandInStopROI = true;
                    // Always log ROI hits
                    console.log(
                        `[HandRouter] Left hand in STOP ROI at (${effectiveCenter.x.toFixed(3)}, ${effectiveCenter.y.toFixed(3)})`
                    );
                }
            }
        }

        // Handle trigger logic with debouncing and cooldown
        // V gesture has priority over normal start recording
        this.handleTriggerLogic(
            rightHandInStartROI,
            leftHandInStopROI,
            rightHandVGestureInStartROI,
            config
        );

        // Show ROI status only in debug mode (already logged above when ROI hit)
        if (this.debugMode && (rightHandInStartROI || leftHandInStopROI)) {
            console.log(
                `[HandRouter] ROI HIT! Right in start: ${rightHandInStartROI}, Left in stop: ${leftHandInStopROI}`
            );
        }

        // Emit detection event for UI feedback
        this.emit('handDetection', {
            hands,
            rightHandInStartROI,
            leftHandInStopROI,
            rightHandVGestureInStartROI,
            timestamp,
        });
    }

    handleTriggerLogic(
        rightHandInStartROI,
        leftHandInStopROI,
        rightHandVGestureInStartROI,
        config
    ) {
        const now = Date.now();

        // Handle V GESTURE in START ROI with dwell time (highest priority)
        if (rightHandVGestureInStartROI) {
            if (!this.dwellState.vton.isInROI) {
                // V gesture just entered START ROI
                this.dwellState.vton.isInROI = true;
                this.dwellState.vton.enteredTime = now;
                this.dwellState.vton.progress = 0;

                // Always log V gesture ROI entry/dwell events
                console.log(
                    '[HandRouter] Right hand V GESTURE entered START ROI - starting dwell timer for VTON'
                );

                // Start progress update for visual feedback
                this.startDwellProgress('vton');
            } else {
                // V gesture is dwelling in START ROI
                const dwellTime = now - this.dwellState.vton.enteredTime;
                this.dwellState.vton.progress = Math.min(dwellTime / this.DWELL_TIME_MS, 1);

                // Check if dwell time reached and cooldown passed
                if (dwellTime >= this.DWELL_TIME_MS && !this.triggerState.vton) {
                    if (now - this.lastTriggers.vton > config.cooldown_ms) {
                        this.triggerState.vton = true;
                        this.lastTriggers.vton = now;
                        this.stats.triggersVton = (this.stats.triggersVton || 0) + 1;

                        console.log(
                            '[HandRouter] VTON TRIGGER - 1 second V gesture dwell completed'
                        );
                        this.triggerVTON();

                        // Reset dwell state after trigger
                        this.dwellState.vton.isInROI = false;
                        this.dwellState.vton.progress = 0;
                    }
                }
            }
        } else if (this.dwellState.vton.isInROI) {
            // V gesture left START ROI
            if (this.debugMode) {
                console.log('[HandRouter] Right hand V GESTURE left START ROI - resetting dwell');
            }
            this.dwellState.vton.isInROI = false;
            this.dwellState.vton.progress = 0;

            // Reset trigger state after debounce
            if (this.triggerState.vton) {
                setTimeout(() => {
                    this.triggerState.vton = false;
                }, config.debounce_ms);
            }
        }

        // Handle START ROI with dwell time (only if not V gesture)
        if (rightHandInStartROI && !rightHandVGestureInStartROI) {
            if (!this.dwellState.start.isInROI) {
                // Hand just entered START ROI
                this.dwellState.start.isInROI = true;
                this.dwellState.start.enteredTime = now;
                this.dwellState.start.progress = 0;

                // Always log ROI entry/dwell events
                console.log('[HandRouter] Right hand entered START ROI - starting dwell timer');

                // Start progress update for visual feedback
                this.startDwellProgress('start');
            } else {
                // Hand is dwelling in START ROI
                const dwellTime = now - this.dwellState.start.enteredTime;
                this.dwellState.start.progress = Math.min(dwellTime / this.DWELL_TIME_MS, 1);

                // Check if dwell time reached and cooldown passed
                if (dwellTime >= this.DWELL_TIME_MS && !this.triggerState.start) {
                    if (now - this.lastTriggers.start > config.cooldown_ms) {
                        this.triggerState.start = true;
                        this.lastTriggers.start = now;
                        this.stats.triggersStart++;

                        console.log('[HandRouter] START TRIGGER - 1 second dwell completed');
                        this.triggerRecordingStart();

                        // Reset dwell state after trigger
                        this.dwellState.start.isInROI = false;
                        this.dwellState.start.progress = 0;
                    }
                }
            }
        } else {
            // Hand left START ROI
            if (this.dwellState.start.isInROI) {
                if (this.debugMode) {
                    console.log('[HandRouter] Right hand left START ROI - resetting dwell');
                }
                this.dwellState.start.isInROI = false;
                this.dwellState.start.progress = 0;

                // Reset trigger state after debounce
                if (this.triggerState.start) {
                    setTimeout(() => {
                        this.triggerState.start = false;
                    }, config.debounce_ms);
                }
            }
        }

        // Handle STOP ROI with dwell time
        if (leftHandInStopROI) {
            if (!this.dwellState.stop.isInROI) {
                // Hand just entered STOP ROI
                this.dwellState.stop.isInROI = true;
                this.dwellState.stop.enteredTime = now;
                this.dwellState.stop.progress = 0;

                // Always log ROI entry/dwell events
                console.log('[HandRouter] Left hand entered STOP ROI - starting dwell timer');

                // Start progress update for visual feedback
                this.startDwellProgress('stop');
            } else {
                // Hand is dwelling in STOP ROI
                const dwellTime = now - this.dwellState.stop.enteredTime;
                this.dwellState.stop.progress = Math.min(dwellTime / this.DWELL_TIME_MS, 1);

                // Check if dwell time reached and cooldown passed
                if (dwellTime >= this.DWELL_TIME_MS && !this.triggerState.stop) {
                    if (now - this.lastTriggers.stop > config.cooldown_ms) {
                        this.triggerState.stop = true;
                        this.lastTriggers.stop = now;
                        this.stats.triggersStop++;

                        console.log('[HandRouter] STOP TRIGGER - 1 second dwell completed');
                        this.triggerRecordingStop();

                        // Reset dwell state after trigger
                        this.dwellState.stop.isInROI = false;
                        this.dwellState.stop.progress = 0;
                    }
                }
            }
        } else {
            // Hand left STOP ROI
            if (this.dwellState.stop.isInROI) {
                if (this.debugMode) {
                    console.log('[HandRouter] Left hand left STOP ROI - resetting dwell');
                }
                this.dwellState.stop.isInROI = false;
                this.dwellState.stop.progress = 0;

                // Reset trigger state after debounce
                if (this.triggerState.stop) {
                    setTimeout(() => {
                        this.triggerState.stop = false;
                    }, config.debounce_ms);
                }
            }
        }
    }

    startDwellProgress(type) {
        // Emit progress updates for UI feedback
        if (!this.dwellUpdateInterval) {
            this.dwellUpdateInterval = setInterval(() => {
                const now = Date.now();

                // Update and emit START ROI progress
                if (this.dwellState.start.isInROI) {
                    const dwellTime = now - this.dwellState.start.enteredTime;
                    this.dwellState.start.progress = Math.min(dwellTime / this.DWELL_TIME_MS, 1);
                }

                // Update and emit STOP ROI progress
                if (this.dwellState.stop.isInROI) {
                    const dwellTime = now - this.dwellState.stop.enteredTime;
                    this.dwellState.stop.progress = Math.min(dwellTime / this.DWELL_TIME_MS, 1);
                }

                // Update and emit VTON progress (in start ROI with V gesture)
                if (this.dwellState.vton.isInROI) {
                    const dwellTime = now - this.dwellState.vton.enteredTime;
                    this.dwellState.vton.progress = Math.min(dwellTime / this.DWELL_TIME_MS, 1);
                }

                // Emit dwell progress for UI
                this.emit('dwellProgress', {
                    start: this.dwellState.start.progress,
                    stop: this.dwellState.stop.progress,
                    vton: this.dwellState.vton.progress,
                    startActive: this.dwellState.start.isInROI,
                    stopActive: this.dwellState.stop.isInROI,
                    vtonActive: this.dwellState.vton.isInROI,
                });

                // Clear interval if no hands in ROI
                if (
                    !this.dwellState.start.isInROI &&
                    !this.dwellState.stop.isInROI &&
                    !this.dwellState.vton.isInROI
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
    }

    triggerRecordingStop() {
        console.log('[HandRouter] Triggering recording STOP');

        // Frontend에만 알리고, 실제 녹화 중지는 Frontend가 처리하도록 함
        // 이렇게 하면 버튼 녹화와 동일한 플로우를 따름
        this.emit('recordingStopped', {
            trigger: 'hand_gesture',
            timestamp: Date.now(),
        });
    }

    triggerVTON() {
        console.log('[HandRouter] Triggering VTON');

        // Emit VTON trigger event
        this.emit('vtonTriggered', {
            trigger: 'v_gesture',
            timestamp: Date.now(),
        });

        // Send VTON command to capture device if it has VTON capability
        if (this.captureDevice && this.captureDevice.triggerVTON) {
            this.captureDevice
                .triggerVTON()
                .then((success) => {
                    if (success) {
                        console.log('[HandRouter] VTON triggered successfully');
                    }
                })
                .catch((error) => {
                    console.error('[HandRouter] Failed to trigger VTON:', error);
                    this.emit('vtonError', error);
                });
        } else {
            // Fallback: Just emit the event for frontend to handle
            console.log('[HandRouter] VTON trigger event emitted (no capture device VTON support)');
        }
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
