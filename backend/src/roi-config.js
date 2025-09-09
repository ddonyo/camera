// backend/src/roi-config.js
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

class ROIConfig extends EventEmitter {
    constructor() {
        super();
        this.configPath = path.join(__dirname, '../../config/roi.json');
        this.config = null;
        this.watcher = null;
        
        // UI settings (managed by frontend, stored in memory only)
        this.uiSettings = {
            enabled: false,  // Default to disabled
            flip_mode: true,
            crop_mode: false
        };
        
        this.loadConfig();
        this.startWatching();
    }

    loadConfig() {
        try {
            const data = fs.readFileSync(this.configPath, 'utf8');
            const newConfig = JSON.parse(data);

            // Validate config structure
            this.validateConfig(newConfig);

            const oldConfig = this.config;
            this.config = newConfig;

            console.log('[ROI-Config] Configuration loaded:', {
                enabled: this.config.enabled,
                debounce_ms: this.config.debounce_ms,
                cooldown_ms: this.config.cooldown_ms,
            });

            if (oldConfig) {
                this.emit('configChanged', this.config, oldConfig);
            }
        } catch (error) {
            console.error('[ROI-Config] Failed to load config:', error.message);

            // Use default config if load fails
            this.config = this.getDefaultConfig();
            console.log('[ROI-Config] Using default configuration');
        }
    }

    validateConfig(config) {
        const required = ['start_roi', 'stop_roi', 'debounce_ms', 'cooldown_ms', 'min_confidence'];

        for (const field of required) {
            if (!(field in config)) {
                throw new Error(`Missing required field: ${field}`);
            }
        }

        // Validate ROI structure
        ['start_roi', 'stop_roi'].forEach((roiName) => {
            const roi = config[roiName];
            const coords = ['x1', 'y1', 'x2', 'y2'];

            for (const coord of coords) {
                if (
                    !(coord in roi) ||
                    typeof roi[coord] !== 'number' ||
                    roi[coord] < 0 ||
                    roi[coord] > 1
                ) {
                    throw new Error(`Invalid ${roiName}.${coord}: must be number between 0 and 1`);
                }
            }

            if (roi.x1 >= roi.x2 || roi.y1 >= roi.y2) {
                throw new Error(`Invalid ${roiName}: x1,y1 must be < x2,y2`);
            }
        });
    }

    getDefaultConfig() {
        return {
            start_roi: { x1: 0.7, y1: 0.2, x2: 0.95, y2: 0.6 },
            stop_roi: { x1: 0.05, y1: 0.2, x2: 0.3, y2: 0.6 },
            debounce_ms: 250,
            cooldown_ms: 1000,
            min_confidence: 0.8,
            enabled: false,
            hand_detection: {
                fps_limit: 15,
                max_num_hands: 2,
                min_detection_confidence: 0.5,
                min_tracking_confidence: 0.5,
            },
        };
    }

    startWatching() {
        if (this.watcher) return;

        try {
            this.watcher = fs.watch(this.configPath, (eventType) => {
                if (eventType === 'change') {
                    console.log('[ROI-Config] Configuration file changed, reloading...');
                    setTimeout(() => this.loadConfig(), 100); // Debounce file changes
                }
            });

            console.log('[ROI-Config] Started watching configuration file');
        } catch (error) {
            console.warn('[ROI-Config] Could not watch config file:', error.message);
        }
    }

    stopWatching() {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
            console.log('[ROI-Config] Stopped watching configuration file');
        }
    }

    get() {
        // Merge config with UI settings for backward compatibility
        return {
            ...this.config,
            ...this.uiSettings
        };
    }

    isEnabled() {
        return this.uiSettings.enabled;
    }

    getStartROI() {
        return this.config ? this.config.start_roi : null;
    }

    getStopROI() {
        return this.config ? this.config.stop_roi : null;
    }

    getDebounceMs() {
        return this.config ? this.config.debounce_ms : 250;
    }

    getCooldownMs() {
        return this.config ? this.config.cooldown_ms : 1000;
    }

    getMinConfidence() {
        return this.config ? this.config.min_confidence : 0.8;
    }

    getHandDetectionConfig() {
        return this.config ? this.config.hand_detection : this.getDefaultConfig().hand_detection;
    }

    // Update UI settings (in memory only, not saved to file)
    updateUISettings(updates) {
        const validKeys = ['enabled', 'flip_mode', 'crop_mode'];
        const filteredUpdates = {};
        
        // Only update valid UI settings
        for (const key of validKeys) {
            if (key in updates) {
                filteredUpdates[key] = updates[key];
            }
        }
        
        if (Object.keys(filteredUpdates).length > 0) {
            this.uiSettings = {
                ...this.uiSettings,
                ...filteredUpdates
            };
            
            console.log('[ROI-Config] UI settings updated:', filteredUpdates);
            
            // Emit change event with merged config
            this.emit('configChanged', this.get());
        }
        
        return { success: true, uiSettings: this.uiSettings };
    }

    // Get current UI settings
    getUISettings() {
        return { ...this.uiSettings };
    }

    // Helper method to check if point is inside ROI
    isPointInROI(x, y, roiType) {
        const roi = roiType === 'start' ? this.getStartROI() : this.getStopROI();
        if (!roi) return false;

        // Simple coordinate check - no transformation needed
        // MediaPipe always receives appropriate image (full or cropped)
        return x >= roi.x1 && x <= roi.x2 && y >= roi.y1 && y <= roi.y2;
    }

    destroy() {
        this.stopWatching();
        this.removeAllListeners();
    }
}

// Singleton instance
let instance = null;

module.exports = {
    getInstance() {
        if (!instance) {
            instance = new ROIConfig();
        }
        return instance;
    },

    createInstance() {
        return new ROIConfig();
    },
};
