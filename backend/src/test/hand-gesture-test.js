#!/usr/bin/env node
// backend/src/test/hand-gesture-test.js
// Hand gesture ROI trigger testing script

const path = require('path');
const fs = require('fs');

// Add parent directory to require path
const parentDir = path.join(__dirname, '..');
process.chdir(path.join(__dirname, '../../..'));

const { Device } = require('../capture');
const frameWatcher = require('../frame-watcher');
const HandRouter = require('../hand-router');

// Mock capture device for testing
class MockCaptureDevice {
    constructor() {
        this.isRecording = false;
        this.recordingStartTime = null;
        this.events = [];
    }

    async startRecording() {
        if (this.isRecording) {
            console.log('[MockDevice] Already recording');
            return false;
        }

        this.isRecording = true;
        this.recordingStartTime = Date.now();
        this.events.push({
            type: 'recording_started',
            timestamp: this.recordingStartTime
        });
        
        console.log('🔴 [MockDevice] Recording STARTED');
        return true;
    }

    async stopRecording() {
        if (!this.isRecording) {
            console.log('[MockDevice] Not recording');
            return false;
        }

        const duration = Date.now() - this.recordingStartTime;
        this.isRecording = false;
        this.events.push({
            type: 'recording_stopped',
            timestamp: Date.now(),
            duration: duration
        });
        
        console.log(`⏹️  [MockDevice] Recording STOPPED (${duration}ms)`);
        this.recordingStartTime = null;
        return true;
    }

    getRecordingStatus() {
        return {
            isRecording: this.isRecording,
            startTime: this.recordingStartTime,
            duration: this.isRecording ? Date.now() - this.recordingStartTime : 0
        };
    }

    getEvents() {
        return [...this.events];
    }

    clearEvents() {
        this.events = [];
    }
}

// Test configuration
const TEST_CONFIG = {
    // Test scenarios
    scenarios: [
        {
            name: "Basic Start-Stop Sequence",
            description: "Right hand in start ROI, then left hand in stop ROI",
            steps: [
                { handedness: 'Right', x: 0.85, y: 0.4, expectedAction: 'start' },
                { delay: 300 },
                { handedness: 'Left', x: 0.15, y: 0.4, expectedAction: 'stop' },
            ]
        },
        {
            name: "Debounce Test",
            description: "Multiple rapid right hand triggers should only start once",
            steps: [
                { handedness: 'Right', x: 0.85, y: 0.4, expectedAction: 'start' },
                { delay: 100 },
                { handedness: 'Right', x: 0.85, y: 0.4, expectedAction: 'none' }, // Should be ignored
                { delay: 100 },
                { handedness: 'Right', x: 0.85, y: 0.4, expectedAction: 'none' }, // Should be ignored
            ]
        },
        {
            name: "Cooldown Test", 
            description: "Start trigger should be ignored during cooldown period",
            steps: [
                { handedness: 'Right', x: 0.85, y: 0.4, expectedAction: 'start' },
                { delay: 200 },
                { handedness: 'Left', x: 0.15, y: 0.4, expectedAction: 'stop' },
                { delay: 200 }, // Less than cooldown period (1000ms)
                { handedness: 'Right', x: 0.85, y: 0.4, expectedAction: 'none' }, // Should be ignored
                { delay: 1200 }, // Wait for cooldown
                { handedness: 'Right', x: 0.85, y: 0.4, expectedAction: 'start' }, // Should work now
            ]
        },
        {
            name: "Wrong Hand Test",
            description: "Left hand in start ROI should not trigger recording",
            steps: [
                { handedness: 'Left', x: 0.85, y: 0.4, expectedAction: 'none' }, // Wrong hand
                { handedness: 'Right', x: 0.15, y: 0.4, expectedAction: 'none' }, // Wrong ROI
            ]
        },
        {
            name: "Outside ROI Test",
            description: "Hands outside ROI should not trigger",
            steps: [
                { handedness: 'Right', x: 0.5, y: 0.5, expectedAction: 'none' }, // Center, outside ROI
                { handedness: 'Left', x: 0.5, y: 0.5, expectedAction: 'none' }, // Center, outside ROI
            ]
        }
    ]
};

class TestRunner {
    constructor() {
        this.mockDevice = new MockCaptureDevice();
        this.handRouter = new HandRouter(this.mockDevice);
        this.results = [];
        this.currentTest = null;
    }

    async setup() {
        console.log('🔧 Setting up test environment...');
        
        // Setup event listeners
        this.handRouter.on('recordingStarted', (data) => {
            console.log('✅ Recording started event received:', data);
        });

        this.handRouter.on('recordingStopped', (data) => {
            console.log('✅ Recording stopped event received:', data);
        });

        this.handRouter.on('error', (error) => {
            console.error('❌ HandRouter error:', error);
        });

        // Start hand router (this will fail without MediaPipe, but we can still test logic)
        try {
            await this.handRouter.start();
            console.log('✅ HandRouter started successfully');
        } catch (error) {
            console.warn('⚠️  HandRouter start failed (expected without MediaPipe):', error.message);
            // Continue with test - we can still test the logic
        }

        console.log('✅ Test environment ready\n');
    }

    async runScenario(scenario) {
        console.log(`\n🧪 Running: ${scenario.name}`);
        console.log(`   ${scenario.description}`);
        console.log('   ' + '='.repeat(50));

        this.currentTest = {
            name: scenario.name,
            steps: [],
            passed: true,
            errors: []
        };

        this.mockDevice.clearEvents();
        
        // Reset any ongoing recording state to ensure clean test start
        if (this.mockDevice.isRecording) {
            await this.mockDevice.stopRecording();
        }
        
        // Reset hand router state
        if (this.handRouter && this.handRouter.isEnabled) {
            this.handRouter.resetState();
        }
        
        const initialRecordingState = this.mockDevice.getRecordingStatus();
        console.log(`   Initial recording state: ${initialRecordingState.isRecording}`);

        for (let i = 0; i < scenario.steps.length; i++) {
            const step = scenario.steps[i];
            
            if (step.delay) {
                console.log(`   ⏱️  Waiting ${step.delay}ms...`);
                await this.delay(step.delay);
                continue;
            }

            console.log(`   👋 Step ${i + 1}: ${step.handedness} hand at (${step.x}, ${step.y})`);
            
            const beforeState = this.mockDevice.getRecordingStatus();
            const eventsBefore = this.mockDevice.getEvents().length;
            
            // Simulate hand detection
            this.handRouter.simulateHandDetection(step.handedness, step.x, step.y, 0.8);
            
            // Small delay to allow event processing
            await this.delay(50);
            
            const afterState = this.mockDevice.getRecordingStatus();
            const eventsAfter = this.mockDevice.getEvents().length;
            
            const recordingChanged = beforeState.isRecording !== afterState.isRecording;
            const newEventsCount = eventsAfter - eventsBefore;
            
            // Check expectations
            const stepResult = {
                step: i + 1,
                input: step,
                beforeState: beforeState.isRecording,
                afterState: afterState.isRecording,
                eventsTriggered: newEventsCount,
                passed: this.validateStep(step, recordingChanged, newEventsCount)
            };
            
            this.currentTest.steps.push(stepResult);
            
            if (stepResult.passed) {
                console.log(`   ✅ Step ${i + 1} PASSED`);
            } else {
                console.log(`   ❌ Step ${i + 1} FAILED`);
                this.currentTest.passed = false;
            }
            
            console.log(`   📊 Recording: ${beforeState.isRecording} → ${afterState.isRecording}, Events: +${newEventsCount}`);
        }

        // Final state summary
        const finalEvents = this.mockDevice.getEvents();
        console.log(`\n   📋 Final Summary:`);
        console.log(`   - Recording state: ${this.mockDevice.getRecordingStatus().isRecording}`);
        console.log(`   - Total events: ${finalEvents.length}`);
        finalEvents.forEach((event, i) => {
            console.log(`   - Event ${i + 1}: ${event.type} at ${new Date(event.timestamp).toLocaleTimeString()}`);
        });

        if (this.currentTest.passed) {
            console.log(`\n   🎉 ${scenario.name} PASSED\n`);
        } else {
            console.log(`\n   💥 ${scenario.name} FAILED\n`);
        }

        this.results.push(this.currentTest);
        return this.currentTest.passed;
    }

    validateStep(step, recordingChanged, newEvents) {
        switch (step.expectedAction) {
            case 'start':
                return recordingChanged && newEvents > 0 && this.mockDevice.getRecordingStatus().isRecording;
            case 'stop':
                return recordingChanged && newEvents > 0 && !this.mockDevice.getRecordingStatus().isRecording;
            case 'none':
                return !recordingChanged && newEvents === 0;
            default:
                return false;
        }
    }

    async runAllTests() {
        console.log('🚀 Starting Hand Gesture ROI Tests');
        console.log('=' .repeat(60));

        await this.setup();

        let passedTests = 0;
        const totalTests = TEST_CONFIG.scenarios.length;

        for (const scenario of TEST_CONFIG.scenarios) {
            const passed = await this.runScenario(scenario);
            if (passed) passedTests++;
        }

        // Final report
        console.log('\n' + '='.repeat(60));
        console.log('📊 TEST RESULTS SUMMARY');
        console.log('=' .repeat(60));
        console.log(`✅ Passed: ${passedTests}/${totalTests}`);
        console.log(`❌ Failed: ${totalTests - passedTests}/${totalTests}`);
        
        if (passedTests === totalTests) {
            console.log('\n🎉 ALL TESTS PASSED! 🎉');
        } else {
            console.log('\n💥 SOME TESTS FAILED 💥');
            
            // Show failed test details
            const failedTests = this.results.filter(r => !r.passed);
            failedTests.forEach(test => {
                console.log(`\n❌ ${test.name}:`);
                const failedSteps = test.steps.filter(s => !s.passed);
                failedSteps.forEach(step => {
                    console.log(`   Step ${step.step}: Expected ${step.input.expectedAction}, got recording change: ${step.beforeState !== step.afterState}`);
                });
            });
        }

        await this.cleanup();
        return passedTests === totalTests;
    }

    async cleanup() {
        console.log('\n🧹 Cleaning up...');
        if (this.handRouter) {
            this.handRouter.stop();
        }
        console.log('✅ Cleanup complete');
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Run tests if called directly
if (require.main === module) {
    const runner = new TestRunner();
    runner.runAllTests()
        .then((success) => {
            process.exit(success ? 0 : 1);
        })
        .catch((error) => {
            console.error('💥 Test runner crashed:', error);
            process.exit(2);
        });
}

module.exports = { TestRunner, MockCaptureDevice, TEST_CONFIG };