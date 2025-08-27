const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const EventEmitter = require('events');

// native/linux/capture_interface.h 를 노드용으로 변환

const CAP_MSG_MAGIC = 0x1cf3;

// To capture device
const CAP_MSG_TYPE_REQ_INFO = 0x100;

// From capture device
const CAP_MSG_TYPE_CAM_INFO = 0x200;

class Device extends EventEmitter {
    /**
     * @param {Object} options - 설정 옵션 객체
     * @param {number} [options.debugLevel=0] - 디버그 레벨
     * @param {string} [options.saveDir='/tmp/camera/live'] - 저장 디렉토리
     * @param {string} [options.fileFmt='frame%d.jpg'] - 저장 파일 형식
     * @param {number} [options.numFiles=4] - 저장 파일 수
     * @param {number} [options.width=640] - 프레임 Width
     * @param {number} [options.height=480] - 프레임 Height
     * @param {number} [options.fps=30] - 초당 프래임 수
     * @param {boolean} [options.useStdout=false] - 표준 출력을 사용할지 여부
     */
    constructor(options) {
        super();
        this.process = null;
        this.server = null;
        this.client = null;
        this.socketPath = '/tmp/camera/node.sock';
        this.debugLevel = options.debugLevel || 0;
        this.saveDir = options.saveDir || '/tmp/camera/live';
        this.fileFmt = options.fileFmt || 'frame%d.jpg';
        this.numFiles = options.numFiles || 4;
        this.width = options.width || 640;
        this.height = options.height || 480;
        this.fps = options.fps || 30;
        this.stdout = options.useStdout ? 'inherit' : 'ignore';
        this.isRecording = false;
        this.recordingStartTime = null;
    }

    async #unlinkSocketPath() {
        try {
            await fs.promises.unlink(this.socketPath);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                console.error('Error unlinking socket path:', err);
                throw err;
            }
        }
    }

    async #initSocketPath() {
        await this.#unlinkSocketPath();
        const dirname = path.dirname(this.socketPath);
        await fs.promises.mkdir(dirname, { recursive: true });
        console.log('Directory created:', dirname);
    }

    #setupServer() {
        this.server = net.createServer((client) => {
            if (this.client) {
                console.log('Client already connected');
                client.end();
                return;
            }

            console.log('Client connected');

            this.client = client;

            this.emit('connected', this);

            let buf = Buffer.alloc(0);

            client.on('data', (data) => {
                buf = Buffer.concat([buf, data]);

                while (buf.length >= 8) {
                    const magic = buf.readUint16LE(0);
                    if (magic != CAP_MSG_MAGIC) {
                        console.log('Invalid packet format');
                        buf = Buffer.alloc(0);
                        break;
                    }

                    const type = buf.readUint16LE(2);
                    const len = buf.readUint32LE(4);
                    if (buf.length < 8 + len) break;

                    let payload = null;

                    if (type == CAP_MSG_TYPE_CAM_INFO) {
                        if (len == 16) {
                            const buf2 = buf.subarray(8, 8 + len);
                            payload = {
                                format: buf2.toString('utf-8', 0, 4),
                                width: buf2.readUint16LE(4),
                                height: buf2.readUint16LE(6),
                                fps: buf2.readDoubleLE(8),
                            };
                        }
                    }

                    if (payload) {
                        const msg = {
                            type: type,
                            payload: payload,
                        };
                        this.emit('data', msg);
                    } else {
                        console.log(`Invalid message(type=${type},len=${len})`);
                    }
                    buf = buf.subarray(8 + len);
                }
            });

            client.on('end', () => {
                console.log('Client disconnected');
                this.client = null;
                this.emit('disconnected');
            });

            client.on('error', (err) => {
                this.emit('error', err);
            });
        });
    }

    #startServer() {
        this.#setupServer();
        return new Promise((resolve, reject) => {
            this.server.listen(this.socketPath, () => {
                console.log(`Capture server listening on '${this.socketPath}'`);
                resolve();
            });

            this.server.on('error', (err) => {
                this.emit('error', err);
                reject(err);
            });
        });
    }

    #startProcess() {
        const cmd = path.join(__dirname, '../../native/linux/capture');
        const args = [
            '-t',
            path.join(this.saveDir, '.tmp', 'live.jpg'),
            '-S',
            path.join(this.saveDir, this.fileFmt),
            '-w',
            this.width,
            '-h',
            this.height,
            '-n',
            this.numFiles,
            '-r',
            this.fps,
            '-u',
            this.socketPath,
        ];

        if (this.debugLevel > 0) {
            args.push('-D');
        }

        this.process = spawn(cmd, args, { stdio: ['ignore', this.stdout, 'inherit'] });
        this.process.on('close', (code) => {
            console.log(`capture program exited with code: ${code}`);
        });

        console.log(`Starting v4l2_capture with '${args.join(' ')}'`);
    }

    async start() {
        try {
            await this.#initSocketPath();
            await this.#startServer();
            this.#startProcess();
        } catch (err) {
            this.emit('error', err);
            throw err;
        }
    }

    async stop() {
        if (this.client) {
            this.client.end();
            this.client = null;
        }

        if (this.process) {
            this.process.kill();
            this.process = null;
        }

        if (this.server) {
            this.server.close();
            this.server = null;
        }

        await this.#unlinkSocketPath();
    }

    send(type, payload = null) {
        if (this.client) {
            const length = payload ? payload.length : 0;
            const buf = Buffer.alloc(8 + length);
            buf.writeUint16LE(CAP_MSG_MAGIC, 0);
            buf.writeUint16LE(type, 2);
            buf.writeUint32LE(length, 4);
            if (payload) {
                // TODO: Convert to C struct format
                payload.copy(buf, 8);
            }
            this.client.write(buf);
        }
    }

    async destroy() {
        await this.stop();
    }

    // Recording control methods
    async startRecording() {
        if (this.isRecording) {
            console.log('[Capture] Already recording, ignoring start request');
            return false;
        }

        try {
            this.isRecording = true;
            this.recordingStartTime = Date.now();
            console.log('[Capture] Recording started');
            this.emit('recordingStarted', {
                timestamp: this.recordingStartTime,
                saveDir: this.saveDir
            });
            return true;
        } catch (error) {
            this.isRecording = false;
            this.recordingStartTime = null;
            console.error('[Capture] Failed to start recording:', error);
            this.emit('recordingError', error);
            return false;
        }
    }

    async stopRecording() {
        if (!this.isRecording) {
            console.log('[Capture] Not recording, ignoring stop request');
            return false;
        }

        try {
            const duration = Date.now() - this.recordingStartTime;
            this.isRecording = false;
            console.log(`[Capture] Recording stopped after ${duration}ms`);
            this.emit('recordingStopped', {
                startTime: this.recordingStartTime,
                duration: duration,
                saveDir: this.saveDir
            });
            this.recordingStartTime = null;
            return true;
        } catch (error) {
            console.error('[Capture] Failed to stop recording:', error);
            this.emit('recordingError', error);
            return false;
        }
    }

    getRecordingStatus() {
        return {
            isRecording: this.isRecording,
            startTime: this.recordingStartTime,
            duration: this.isRecording ? Date.now() - this.recordingStartTime : 0
        };
    }
}

module.exports = {
    Device,
    CAP_MSG_TYPE_REQ_INFO,
    CAP_MSG_TYPE_CAM_INFO,
};
