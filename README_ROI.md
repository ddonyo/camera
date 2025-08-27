# ROI-based Hand-Triggered Recording

This feature enables automatic recording control through hand gestures in predefined regions of interest (ROI).

## Overview

- **Right hand** in **start ROI** → Start recording
- **Left hand** in **stop ROI** → Stop recording
- Built-in debouncing and cooldown to prevent accidental triggers
- Real-time hand detection using MediaPipe

## Installation

### 1. Install Python Dependencies

```bash
# Install MediaPipe and OpenCV
npm run setup:python

# Or manually:
pip install mediapipe opencv-python

# Verify installation
npm run check:deps
```

### 2. Configuration

Edit `config/roi.json` to customize ROI areas and detection settings:

```json
{
  "start_roi": { 
    "x1": 0.70, "y1": 0.20, 
    "x2": 0.95, "y2": 0.60 
  },
  "stop_roi": { 
    "x1": 0.05, "y1": 0.20, 
    "x2": 0.30, "y2": 0.60 
  },
  "debounce_ms": 250,
  "cooldown_ms": 1000,
  "min_confidence": 0.7,
  "enabled": true
}
```

### 3. ROI Coordinate System

- Coordinates are normalized (0.0 to 1.0)
- `(0, 0)` = top-left corner
- `(1, 1)` = bottom-right corner
- `x1, y1` = top-left of ROI rectangle
- `x2, y2` = bottom-right of ROI rectangle

### Example ROI Positions:
- **Start ROI** (right side): `x1: 0.70, y1: 0.20, x2: 0.95, y2: 0.60`
- **Stop ROI** (left side): `x1: 0.05, y1: 0.20, x2: 0.30, y2: 0.60`

## Usage

### Enable Hand Detection
The system will automatically start when:
1. ROI config has `"enabled": true`
2. Python dependencies are installed
3. Camera is running

### Manual Testing
```bash
# Run test suite
npm run test:hand

# Test specific gestures in running app (via browser console):
frameWatcher.simulateHandGesture('Right', 0.85, 0.4);  // Start recording
frameWatcher.simulateHandGesture('Left', 0.15, 0.4);   // Stop recording
```

### Configuration Hot-Reload
- Changes to `config/roi.json` are automatically detected
- No need to restart the application
- Invalid configurations fall back to defaults

## Troubleshooting

### Common Issues

1. **"mediapipe not installed" error**
   ```bash
   npm run setup:python
   ```

2. **Hand detection not working**
   - Check camera permissions
   - Verify ROI coordinates are valid (0-1 range)
   - Ensure good lighting conditions
   - Check `min_confidence` setting

3. **False triggers**
   - Increase `cooldown_ms` (default: 1000ms)
   - Increase `min_confidence` (default: 0.7)
   - Adjust ROI areas to be more specific

4. **Missed triggers**
   - Decrease `min_confidence` 
   - Increase ROI area size
   - Check hand positioning in ROI

### Debug Information
```javascript
// Get system status (browser console)
const status = frameWatcher.getHandRouterStatus();
console.log('Hand detection status:', status);

// View current configuration
fetch('./config/roi.json').then(r => r.json()).then(console.log);
```

## Performance Settings

### Frame Processing Limits
- Default: 15 FPS hand detection (configurable)
- Automatic frame dropping under high load
- Non-blocking processing

### Configuration Options
```json
{
  "hand_detection": {
    "fps_limit": 15,
    "max_num_hands": 2,
    "min_detection_confidence": 0.5,
    "min_tracking_confidence": 0.5
  }
}
```

## Architecture

### Components
- **`roi-config.js`**: Configuration loader with hot-reload
- **`hand-detection.py`**: MediaPipe hand detection worker
- **`hand-worker.js`**: Node.js wrapper for Python worker  
- **`hand-router.js`**: ROI logic and trigger management
- **`frame-watcher.js`**: Integration with frame pipeline

### Event Flow
1. Camera frame → `frame-watcher.js`
2. Frame → `hand-worker.js` → `hand-detection.py`
3. Hand landmarks → `hand-router.js` 
4. ROI intersection check → Recording trigger
5. `capture.js` → Start/stop recording

## Logs

Monitor the console for log messages:
- `[ROI-Config]` - Configuration loading/changes
- `[HandWorker]` - Python process management  
- `[HandRouter]` - ROI triggers and debouncing
- `[hand]` - Hand detection events

Example successful trigger:
```
[HandRouter] Right hand in start ROI at (0.880, 0.320)
[HandRouter] START TRIGGER - Right hand entered start ROI
[Capture] Recording started
```