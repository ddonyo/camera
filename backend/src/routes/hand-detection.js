// backend/src/routes/hand-detection.js
// Hand detection API routes

const express = require('express');
const HandRouter = require('../hand-router');
const { getInstance: getROIConfig } = require('../roi-config');

const router = express.Router();

// Global hand router instance (will be initialized when needed)
let handRouterInstance = null;

// Initialize hand router with capture device
function initializeHandRouter(captureDevice) {
    if (!handRouterInstance && captureDevice) {
        try {
            handRouterInstance = new HandRouter(captureDevice);
            
            // Setup event forwarding to main process (Electron IPC)
            handRouterInstance.on('handDetection', (data) => {
                // Forward hand detection data to frontend via Electron IPC
                if (process.send) {
                    process.send({
                        type: 'hand-detection',
                        data: data
                    });
                }
            });
            
            handRouterInstance.on('recordingStarted', (data) => {
                console.log('[HandDetection API] Recording started via hand gesture');
                if (process.send) {
                    process.send({
                        type: 'recording-started',
                        data: data
                    });
                }
            });
            
            handRouterInstance.on('recordingStopped', (data) => {
                console.log('[HandDetection API] Recording stopped via hand gesture');
                if (process.send) {
                    process.send({
                        type: 'recording-stopped', 
                        data: data
                    });
                }
            });
            
            handRouterInstance.start()
                .then(() => {
                    console.log('[HandDetection API] Hand router initialized successfully');
                })
                .catch((error) => {
                    console.warn('[HandDetection API] Hand router initialization failed:', error.message);
                });
                
        } catch (error) {
            console.error('[HandDetection API] Failed to initialize hand router:', error);
        }
    }
    
    return handRouterInstance;
}

// GET /api/v1/hand/status - Get hand detection system status
router.get('/status', (req, res) => {
    try {
        const roiConfig = getROIConfig().get();
        const handRouterStatus = handRouterInstance ? handRouterInstance.getStatus() : null;
        
        res.json({
            success: true,
            enabled: roiConfig?.enabled || false,
            config: roiConfig,
            handRouter: handRouterStatus,
            initialized: !!handRouterInstance
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// GET /api/v1/hand/config - Get ROI configuration
router.get('/config', (req, res) => {
    try {
        const config = getROIConfig().get();
        res.json({
            success: true,
            config: config
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// POST /api/v1/hand/simulate - Simulate hand detection for testing
router.post('/simulate', (req, res) => {
    try {
        const { handedness, x, y, confidence } = req.body;
        
        if (!handedness || x === undefined || y === undefined) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameters: handedness, x, y'
            });
        }
        
        if (!handRouterInstance) {
            return res.status(503).json({
                success: false,
                error: 'Hand router not initialized'
            });
        }
        
        const result = handRouterInstance.simulateHandDetection(
            handedness, 
            parseFloat(x), 
            parseFloat(y), 
            confidence || 0.8
        );
        
        res.json({
            success: true,
            simulated: true,
            input: { handedness, x, y, confidence: confidence || 0.8 }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// GET /api/v1/hand/stats - Get detection statistics
router.get('/stats', (req, res) => {
    try {
        if (!handRouterInstance) {
            return res.status(503).json({
                success: false,
                error: 'Hand router not initialized'
            });
        }
        
        const stats = handRouterInstance.getStats();
        res.json({
            success: true,
            stats: stats
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// POST /api/v1/hand/start - Start hand detection
router.post('/start', async (req, res) => {
    try {
        if (!handRouterInstance) {
            return res.status(503).json({
                success: false,
                error: 'Hand router not initialized. Need capture device.'
            });
        }
        
        await handRouterInstance.start();
        res.json({
            success: true,
            message: 'Hand detection started'
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// POST /api/v1/hand/stop - Stop hand detection
router.post('/stop', (req, res) => {
    try {
        if (handRouterInstance) {
            handRouterInstance.stop();
        }
        
        res.json({
            success: true,
            message: 'Hand detection stopped'
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = {
    router,
    initializeHandRouter,
    getHandRouterInstance: () => handRouterInstance
};