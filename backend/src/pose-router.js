// backend/src/pose-router.js
const { EventEmitter } = require('events');
const PoseWorker = require('./pose-worker');
const ROIConfig = require('./roi-config');

class PoseRouter extends EventEmitter {
    constructor(captureDevice, frameHandler = null) {
        super();
        this.captureDevice = captureDevice;
        this.frameHandler = frameHandler; // FrameHandler reference for recording control
        this.poseWorker = null;
        this.isEnabled = false;
        
        // ROI configuration for crop mode
        this.roiConfig = ROIConfig.getInstance();
        
        // Pose detection state
        this.fullBodyDetected = false;
        this.fullBodyDetectedTime = 0;
        this.dwellProgress = 0;
        this.DWELL_TIME_MS = 1000; // 1 second dwell time for full body detection
        
        // Stop dwell state (for when full body is lost during recording)
        this.stopDwellActive = false;
        this.stopDwellStartTime = 0;
        this.stopDwellProgress = 0;
        
        // Cooldown state
        this.lastTriggerTime = 0;
        this.COOLDOWN_MS = 3000; // 3 second cooldown between triggers
        
        // Statistics
        this.stats = {
            framesProcessed: 0,
            posesDetected: 0,
            fullBodyDetected: 0,
            recordingsTriggered: 0,
            lastFrameTime: 0,
        };
        
        // Debug mode
        this.debugMode = process.env.POSE_DEBUG === 'true';
        
        // Dwell progress update interval
        this.dwellUpdateInterval = null;
        this.stopDwellUpdateInterval = null;
    }
    
    async start() {
        if (this.isEnabled) {
            console.log('[PoseRouter] Already started');
            return;
        }
        
        console.log('[PoseRouter] Starting PoseRouter...');
        
        try {
            // Initialize pose worker
            this.poseWorker = new PoseWorker({
                fps_limit: 10,
                min_detection_confidence: 0.5,
                min_tracking_confidence: 0.5,
                model_complexity: 1
            });
            
            this.poseWorker.on('detection', (data) => {
                this.handlePoseDetection(data);
            });
            
            this.poseWorker.on('error', (error) => {
                console.error('[PoseRouter] Pose worker error:', error);
                this.emit('error', error);
            });
            
            this.poseWorker.on('stopped', () => {
                console.log('[PoseRouter] Pose worker stopped');
                this.isEnabled = false;
            });
            
            await this.poseWorker.start();
            this.isEnabled = true;
            
            console.log('[PoseRouter] Started successfully');
            this.emit('started');
        } catch (error) {
            console.error('[PoseRouter] Failed to start:', error);
            this.emit('error', error);
            throw error;
        }
    }
    
    stop() {
        if (!this.isEnabled) {
            return;
        }
        
        console.log('[PoseRouter] Stopping...');
        
        if (this.poseWorker) {
            this.poseWorker.stop();
            this.poseWorker = null;
        }
        
        this.isEnabled = false;
        this.resetState();
        
        console.log('[PoseRouter] Stopped');
        this.emit('stopped');
    }
    
    resetState() {
        this.fullBodyDetected = false;
        this.fullBodyDetectedTime = 0;
        this.dwellProgress = 0;
        this.stopDwellActive = false;
        this.stopDwellStartTime = 0;
        this.stopDwellProgress = 0;
        console.log('[PoseRouter] State reset completed');
    }
    
    processFrame(imageBuffer, cropMode = false) {
        if (!this.isEnabled || !this.poseWorker) {
            return false;
        }
        
        this.stats.framesProcessed++;
        this.stats.lastFrameTime = Date.now();
        
        // Get crop_mode from ROI config (set by frontend via _updateBackendSettings)
        const config = this.roiConfig.get();
        const effectiveCropMode = config.crop_mode || cropMode;
        
        return this.poseWorker.processFrame(imageBuffer, effectiveCropMode);
    }
    
    processImagePath(imagePath, cropMode = false) {
        if (!this.isEnabled || !this.poseWorker) {
            return false;
        }
        
        this.stats.framesProcessed++;
        this.stats.lastFrameTime = Date.now();
        
        // Get crop_mode from ROI config (set by frontend via _updateBackendSettings)
        const config = this.roiConfig.get();
        const effectiveCropMode = config.crop_mode || cropMode;
        
        return this.poseWorker.processImagePath(imagePath, effectiveCropMode);
    }
    
    handlePoseDetection(data) {
        const { pose, timestamp, cropInfo } = data;
        const now = Date.now();
        
        // Check if recording state (needed for both pose detected and not detected cases)
        const isRecording = this.frameHandler && this.frameHandler.isRecording;
        
        if (!pose || !pose.detected) {
            // No pose detected, reset state
            if (this.fullBodyDetected) {
                if (this.debugMode) {
                    console.log('[PoseRouter] Full body lost');
                }
                this.fullBodyDetected = false;
                this.fullBodyDetectedTime = 0;
                this.dwellProgress = 0;
                this.stopDwellProgressUpdates();
                
                // Emit event for UI update
                this.emit('poseDetection', {
                    detected: false,
                    fullBodyVisible: false,
                    dwellProgress: 0,
                    timestamp
                });
                
                // Also emit dwellProgress reset
                this.emit('dwellProgress', {
                    start: 0,
                    stop: 0,
                    startActive: false,
                    stopActive: false
                });
            }
            
            // Still need to handle stop condition when no person is detected during recording
            if (isRecording) {
                // If no person detected during recording, this should trigger stop condition
                if (!this.stopDwellActive) {
                    // Start stop dwell timer
                    this.stopDwellActive = true;
                    this.stopDwellStartTime = now;
                    this.stopDwellProgress = 0;
                    console.log('[PoseRouter] No person detected during recording - starting stop dwell timer');
                    this.startStopDwellProgressUpdates();
                } else {
                    // Update stop dwell progress
                    const dwellTime = now - this.stopDwellStartTime;
                    this.stopDwellProgress = Math.min(dwellTime / this.DWELL_TIME_MS, 1);
                    
                    // Check if dwell time reached for stop
                    if (dwellTime >= this.DWELL_TIME_MS) {
                        console.log('[PoseRouter] RECORDING STOP TRIGGER - No person detected for 1 second');
                        this.stopRecording();
                        this.stopDwellActive = false;
                        this.stopDwellProgress = 0;
                        this.stopStopDwellProgressUpdates();
                    }
                }
                
                // Debug log for stop condition (even when no person detected)
                if (this.stats.framesProcessed % 30 === 0) { // Log every 30 frames
                    console.log(`[PoseRouter] isRecording: ${isRecording}, no_person_detected: true, stopDwellActive: ${this.stopDwellActive}`);
                }
            }
            
            return;
        }
        
        this.stats.posesDetected++;
        
        // Check if full body is visible
        if (pose.full_body_visible) {
            // If already recording, don't start dwell timer for recording start
            if (isRecording) {
                // Just maintain full body detected state but don't trigger anything
                if (!this.fullBodyDetected) {
                    this.fullBodyDetected = true;
                    console.log('[PoseRouter] Full body detected but already recording - no trigger needed');
                }
                // Reset any dwell progress since we're not triggering
                this.dwellProgress = 0;
                this.fullBodyDetectedTime = 0;
            } else {
                // Not recording, handle dwell timer for recording start
                if (!this.fullBodyDetected) {
                    // Full body just became visible
                    this.fullBodyDetected = true;
                    this.fullBodyDetectedTime = now;
                    this.dwellProgress = 0;
                    this.stats.fullBodyDetected++;
                    
                    console.log('[PoseRouter] Full body detected - starting dwell timer for recording start');
                    
                    // Start periodic dwell progress updates for UI
                    this.startDwellProgressUpdates();
                } else {
                    // Full body is still visible, update dwell progress
                    const dwellTime = now - this.fullBodyDetectedTime;
                    this.dwellProgress = Math.min(dwellTime / this.DWELL_TIME_MS, 1);
                    
                    // Check if dwell time reached
                    if (dwellTime >= this.DWELL_TIME_MS) {
                        // Check cooldown
                        if (now - this.lastTriggerTime > this.COOLDOWN_MS) {
                            this.lastTriggerTime = now;
                            this.stats.recordingsTriggered++;
                            
                            console.log('[PoseRouter] RECORDING START TRIGGER - Full body detected for 1 second');
                            this.triggerRecording();
                            
                            // Reset dwell progress after trigger but keep fullBodyDetected true
                            this.dwellProgress = 0;
                            this.fullBodyDetectedTime = 0;
                            this.stopDwellProgressUpdates();
                        } else if (this.debugMode) {
                            const remainingCooldown = Math.ceil((this.COOLDOWN_MS - (now - this.lastTriggerTime)) / 1000);
                            console.log(`[PoseRouter] Full body trigger ignored - cooldown (${remainingCooldown}s remaining)`);
                        }
                    }
                }
            }
            
            if (this.debugMode) {
                console.log(`[PoseRouter] Full body visible - confidence: ${pose.confidence.toFixed(2)}, progress: ${(this.dwellProgress * 100).toFixed(0)}%`);
            }
        } else {
            // Full body not visible
            if (this.fullBodyDetected) {
                if (this.debugMode) {
                    console.log('[PoseRouter] Full body no longer visible');
                }
                this.fullBodyDetected = false;
                this.fullBodyDetectedTime = 0;
                this.dwellProgress = 0;
                this.stopDwellProgressUpdates();
            }
            
            // Don't handle stop here - it's handled by should_stop_recording flag
        }
        
        // Debug log for stop condition
        if (this.stats.framesProcessed % 30 === 0) { // Log every 30 frames
            console.log(`[PoseRouter] isRecording: ${isRecording}, should_stop: ${pose.should_stop_recording}, stopDwellActive: ${this.stopDwellActive}`);
            if (pose.stop_debug) {
                console.log(`[PoseRouter] Stop Debug - Left: ${pose.stop_debug.left_invisible}/${pose.stop_debug.left_total}, Right: ${pose.stop_debug.right_invisible}/${pose.stop_debug.right_total}`);
            }
        }
        
        // Handle stop recording based on should_stop_recording flag
        if (isRecording && pose.should_stop_recording) {
            if (!this.stopDwellActive) {
                // Start stop dwell timer
                this.stopDwellActive = true;
                this.stopDwellStartTime = now;
                this.stopDwellProgress = 0;
                console.log('[PoseRouter] Stop condition met (left/right side gone) - starting stop dwell timer');
                this.startStopDwellProgressUpdates();
            } else {
                // Update stop dwell progress
                const dwellTime = now - this.stopDwellStartTime;
                this.stopDwellProgress = Math.min(dwellTime / this.DWELL_TIME_MS, 1);
                
                // Check if dwell time reached for stop
                if (dwellTime >= this.DWELL_TIME_MS) {
                    console.log('[PoseRouter] RECORDING STOP TRIGGER - Stop condition met for 1 second');
                    this.stopRecording();
                    this.stopDwellActive = false;
                    this.stopDwellProgress = 0;
                    this.stopStopDwellProgressUpdates();
                }
            }
        } else if (!pose.should_stop_recording && this.stopDwellActive) {
            // Reset stop dwell if stop condition is no longer met
            console.log('[PoseRouter] Stop condition no longer met - canceling stop dwell timer');
            this.stopDwellActive = false;
            this.stopDwellProgress = 0;
            this.stopStopDwellProgressUpdates();
        }
        
        // Emit detection event for UI feedback
        this.emit('poseDetection', {
            detected: pose.detected,
            fullBodyVisible: pose.full_body_visible,
            confidence: pose.confidence,
            bbox: pose.bbox,
            dwellProgress: this.dwellProgress,
            timestamp,
            isRecording: this.frameHandler && this.frameHandler.isRecording
        });
        
        // Also emit dwellProgress event for trigger progress bar (like hand router)
        this.emit('dwellProgress', {
            start: this.dwellProgress,
            stop: this.stopDwellProgress,
            startActive: this.dwellProgress > 0,
            stopActive: this.stopDwellProgress > 0
        });
    }
    
    triggerRecording() {
        if (!this.frameHandler) {
            console.error('[PoseRouter] No frameHandler available for recording control');
            return;
        }
        
        // Start recording
        console.log('[PoseRouter] Triggering recording start via full body detection');
        this.emit('recordingStarted', {
            trigger: 'pose',
            timestamp: Date.now()
        });
        
        // If frameHandler has a method to start recording, call it
        if (typeof this.frameHandler.startRecording === 'function') {
            this.frameHandler.startRecording();
        }
    }
    
    stopRecording() {
        if (!this.frameHandler) {
            console.error('[PoseRouter] No frameHandler available for recording control');
            return;
        }
        
        // Stop recording
        console.log('[PoseRouter] Stopping recording - left or right side completely gone');
        this.emit('recordingStopped', {
            trigger: 'pose',
            reason: 'side_not_visible',
            timestamp: Date.now()
        });
        
        // If frameHandler has a method to stop recording, call it
        if (typeof this.frameHandler.stopRecording === 'function') {
            this.frameHandler.stopRecording();
        }
    }
    
    getStatus() {
        return {
            isRunning: this.isEnabled,
            stats: this.stats,
            fullBodyDetected: this.fullBodyDetected,
            dwellProgress: this.dwellProgress,
            workerStatus: this.poseWorker ? this.poseWorker.getStatus() : null
        };
    }
    
    getStats() {
        return this.stats;
    }
    
    startDwellProgressUpdates() {
        // Stop any existing interval
        if (this.dwellUpdateInterval) {
            clearInterval(this.dwellUpdateInterval);
        }
        
        // Start new interval for smooth UI updates
        this.dwellUpdateInterval = setInterval(() => {
            if (this.fullBodyDetected) {
                const now = Date.now();
                const dwellTime = now - this.fullBodyDetectedTime;
                this.dwellProgress = Math.min(dwellTime / this.DWELL_TIME_MS, 1);
                
                // Emit progress event for UI
                this.emit('poseDetection', {
                    detected: true,
                    fullBodyVisible: true,
                    dwellProgress: this.dwellProgress,
                    timestamp: Date.now()
                });
                
                // Stop updates if dwell is complete
                if (this.dwellProgress >= 1) {
                    this.stopDwellProgressUpdates();
                }
            } else {
                // Stop updates if full body is no longer detected
                this.stopDwellProgressUpdates();
            }
        }, 50); // Update every 50ms for smooth progress
    }
    
    stopDwellProgressUpdates() {
        if (this.dwellUpdateInterval) {
            clearInterval(this.dwellUpdateInterval);
            this.dwellUpdateInterval = null;
        }
    }
    
    startStopDwellProgressUpdates() {
        // Stop any existing interval
        if (this.stopDwellUpdateInterval) {
            clearInterval(this.stopDwellUpdateInterval);
        }
        
        // Start new interval for smooth UI updates
        this.stopDwellUpdateInterval = setInterval(() => {
            if (this.stopDwellActive) {
                const now = Date.now();
                const dwellTime = now - this.stopDwellStartTime;
                this.stopDwellProgress = Math.min(dwellTime / this.DWELL_TIME_MS, 1);
                
                // Emit progress event for UI
                this.emit('dwellProgress', {
                    start: 0,
                    stop: this.stopDwellProgress,
                    startActive: false,
                    stopActive: true
                });
                
                // Stop updates if dwell is complete
                if (this.stopDwellProgress >= 1) {
                    this.stopStopDwellProgressUpdates();
                }
            } else {
                // Stop updates if stop dwell is no longer active
                this.stopStopDwellProgressUpdates();
            }
        }, 50); // Update every 50ms for smooth progress
    }
    
    stopStopDwellProgressUpdates() {
        if (this.stopDwellUpdateInterval) {
            clearInterval(this.stopDwellUpdateInterval);
            this.stopDwellUpdateInterval = null;
        }
    }
}

module.exports = PoseRouter;