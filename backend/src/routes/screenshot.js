const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;

const router = express.Router();

// 스크린샷 저장 디렉토리
const SCREENSHOT_DIR = path.join(__dirname, '../../../frontend/public/screenshots');

// 디렉토리 존재 확인 및 생성
async function ensureScreenshotDir() {
    try {
        await fs.access(SCREENSHOT_DIR);
    } catch (error) {
        if (error.code === 'ENOENT') {
            await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
            console.log('Screenshot directory created:', SCREENSHOT_DIR);
        }
    }
}

// Windows용 스크린샷 캡처 함수
async function captureScreenshotWindows() {
    return new Promise((resolve, reject) => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `screenshot_${timestamp}.png`;
        const filepath = path.join(SCREENSHOT_DIR, filename);
        
        // PowerShell을 사용하여 스크린샷 캡처
        const powershellScript = `
            Add-Type -AssemblyName System.Windows.Forms
            Add-Type -AssemblyName System.Drawing
            $Screen = [System.Windows.Forms.SystemInformation]::VirtualScreen
            $Width = $Screen.Width
            $Height = $Screen.Height
            $Left = $Screen.Left
            $Top = $Screen.Top
            $bitmap = New-Object System.Drawing.Bitmap $Width, $Height
            $graphic = [System.Drawing.Graphics]::FromImage($bitmap)
            $graphic.CopyFromScreen($Left, $Top, 0, 0, $bitmap.Size)
            $bitmap.Save('${filepath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
            $graphic.Dispose()
            $bitmap.Dispose()
        `;
        
        const child = spawn('powershell.exe', ['-Command', powershellScript], {
            windowsHide: true
        });
        
        child.on('close', (code) => {
            if (code === 0) {
                resolve({ filename, filepath });
            } else {
                reject(new Error(`PowerShell screenshot command failed with code ${code}`));
            }
        });
        
        child.on('error', (error) => {
            reject(error);
        });
    });
}

// Linux용 스크린샷 캡처 함수 (scrot 또는 xwd 사용)
async function captureScreenshotLinux() {
    return new Promise((resolve, reject) => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `screenshot_${timestamp}.png`;
        const filepath = path.join(SCREENSHOT_DIR, filename);
        
        // scrot을 먼저 시도 (설치되어 있다면)
        const scrotChild = spawn('scrot', [filepath], { stdio: 'ignore' });
        
        scrotChild.on('close', (code) => {
            if (code === 0) {
                resolve({ filename, filepath });
            } else {
                // scrot 실패시 xwd + convert 시도
                tryXwdCapture();
            }
        });
        
        scrotChild.on('error', (error) => {
            // scrot이 없는 경우 xwd + convert 시도
            tryXwdCapture();
        });
        
        function tryXwdCapture() {
            // xwd로 전체 화면 캡처 후 convert로 PNG 변환
            const xwdTempPath = path.join(SCREENSHOT_DIR, `temp_${timestamp}.xwd`);
            
            const xwdChild = spawn('xwd', ['-root', '-out', xwdTempPath]);
            
            xwdChild.on('close', (code) => {
                if (code === 0) {
                    // xwd 파일을 PNG로 변환
                    const convertChild = spawn('convert', [xwdTempPath, filepath]);
                    
                    convertChild.on('close', (convertCode) => {
                        // 임시 xwd 파일 삭제
                        spawn('rm', [xwdTempPath]);
                        
                        if (convertCode === 0) {
                            resolve({ filename, filepath });
                        } else {
                            reject(new Error(`ImageMagick convert failed with code ${convertCode}`));
                        }
                    });
                    
                    convertChild.on('error', (convertError) => {
                        spawn('rm', [xwdTempPath]);
                        tryGnomeScreenshot();
                    });
                } else {
                    tryGnomeScreenshot();
                }
            });
            
            xwdChild.on('error', (error) => {
                tryGnomeScreenshot();
            });
        }
        
        function tryGnomeScreenshot() {
            // GNOME 환경에서 gnome-screenshot 시도
            const gnomeChild = spawn('gnome-screenshot', ['-f', filepath]);
            
            gnomeChild.on('close', (code) => {
                if (code === 0) {
                    resolve({ filename, filepath });
                } else {
                    reject(new Error(`All screenshot methods failed. Please install scrot, ImageMagick, or gnome-screenshot`));
                }
            });
            
            gnomeChild.on('error', (error) => {
                reject(new Error(`All screenshot methods failed. Please install scrot, ImageMagick, or gnome-screenshot`));
            });
        }
    });
}

// POST /capture - 스크린샷 캡처
router.post('/capture', async (req, res) => {
    try {
        console.log('[Screenshot] Capture request received');
        
        // 스크린샷 디렉토리 확인
        await ensureScreenshotDir();
        
        let result;
        if (process.platform === 'win32') {
            result = await captureScreenshotWindows();
        } else if (process.platform === 'linux') {
            result = await captureScreenshotLinux();
        } else {
            throw new Error(`Screenshot capture is not supported on ${process.platform}`);
        }
        
        console.log(`[Screenshot] Captured: ${result.filename}`);
        
        res.json({
            success: true,
            filename: result.filename,
            path: `/screenshots/${result.filename}`,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[Screenshot] Capture failed:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// GET /list - 저장된 스크린샷 목록 조회
router.get('/list', async (req, res) => {
    try {
        await ensureScreenshotDir();
        
        const files = await fs.readdir(SCREENSHOT_DIR);
        const screenshots = files
            .filter(file => file.endsWith('.png') && file.startsWith('screenshot_'))
            .map(file => ({
                filename: file,
                path: `/screenshots/${file}`,
                timestamp: file.replace('screenshot_', '').replace('.png', '')
            }))
            .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        
        res.json({
            success: true,
            screenshots
        });
        
    } catch (error) {
        console.error('[Screenshot] List failed:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;