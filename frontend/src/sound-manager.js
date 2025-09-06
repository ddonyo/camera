// Sound Manager for playing audio effects
export class SoundManager {
    constructor() {
        this.audioContext = null;
        this.enabled = true;
        this.volume = 0.5;
        this.initAudioContext();
    }

    initAudioContext() {
        try {
            // Create audio context
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();
        } catch (error) {
            console.warn('[SoundManager] Web Audio API not supported:', error);
            this.enabled = false;
        }
    }

    // Play a beep sound using Web Audio API
    playBeep(frequency = 440, duration = 200, type = 'sine') {
        if (!this.enabled || !this.audioContext) return;

        try {
            // Resume context if it's suspended (browser policy)
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }

            // Create oscillator for beep
            const oscillator = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();

            // Configure oscillator
            oscillator.type = type;
            oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);

            // Configure gain (volume)
            gainNode.gain.setValueAtTime(this.volume, this.audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration / 1000);

            // Connect nodes
            oscillator.connect(gainNode);
            gainNode.connect(this.audioContext.destination);

            // Play sound
            oscillator.start(this.audioContext.currentTime);
            oscillator.stop(this.audioContext.currentTime + duration / 1000);

        } catch (error) {
            console.error('[SoundManager] Error playing beep:', error);
        }
    }

    // Play recording start sound (higher pitch beep)
    playRecordingStart() {
        // Two quick beeps ascending
        this.playBeep(600, 100, 'sine');
        setTimeout(() => {
            this.playBeep(800, 100, 'sine');
        }, 120);
    }

    // Play recording stop sound (lower pitch beep)
    playRecordingStop() {
        // Two quick beeps descending
        this.playBeep(800, 100, 'sine');
        setTimeout(() => {
            this.playBeep(600, 150, 'sine');
        }, 120);
    }

    // Play simple click sound
    playClick() {
        this.playBeep(1000, 50, 'square');
    }

    // Play error sound
    playError() {
        this.playBeep(200, 300, 'sawtooth');
    }

    // Set volume (0.0 to 1.0)
    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume));
    }

    // Enable/disable sounds
    setEnabled(enabled) {
        this.enabled = enabled;
        if (enabled && !this.audioContext) {
            this.initAudioContext();
        }
    }

    // Cleanup
    destroy() {
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
    }
}

// Singleton instance
let soundManagerInstance = null;

export function getSoundManager() {
    if (!soundManagerInstance) {
        soundManagerInstance = new SoundManager();
    }
    return soundManagerInstance;
}