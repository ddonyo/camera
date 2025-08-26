class ScreenshotManager {
    constructor() {
        this.isCapturing = false;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setupKeyboardShortcut();
    }

    setupEventListeners() {
        const screenshotBtn = document.getElementById('screenshotBtn');
        if (screenshotBtn) {
            screenshotBtn.addEventListener('click', () => {
                this.captureScreenshot();
            });
        }
    }

    setupKeyboardShortcut() {
        // F12 키로 스크린샷 캡처
        document.addEventListener('keydown', (event) => {
            if (event.key === 'F12') {
                event.preventDefault(); // 기본 브라우저 개발자 도구 방지
                this.captureScreenshot();
            }
        });

        console.log('Screenshot keyboard shortcut registered: F12');
    }

    async captureScreenshot() {
        if (this.isCapturing) {
            console.log('Screenshot already in progress');
            return;
        }

        const screenshotBtn = document.getElementById('screenshotBtn');
        
        try {
            this.isCapturing = true;
            
            // 버튼 상태 변경
            if (screenshotBtn) {
                screenshotBtn.disabled = true;
                screenshotBtn.classList.add('capturing');
            }

            console.log('Capturing screenshot...');

            // Electron IPC를 통해 스크린샷 캡처 요청
            const result = await window.electronAPI.captureScreenshot();
            
            if (result.success) {
                console.log('Screenshot saved:', result.filename);
                
                // 성공 피드백 (선택적)
                this.showFeedback('Screenshot saved!', 'success');
            } else {
                throw new Error(result.error || 'Screenshot capture failed');
            }

        } catch (error) {
            console.error('Screenshot capture error:', error);
            this.showFeedback('Screenshot failed!', 'error');
        } finally {
            this.isCapturing = false;
            
            // 버튼 상태 복원
            if (screenshotBtn) {
                screenshotBtn.disabled = false;
                screenshotBtn.classList.remove('capturing');
            }
        }
    }

    showFeedback(message, type = 'info') {
        // 간단한 토스트 알림 생성
        const toast = document.createElement('div');
        toast.className = `screenshot-toast toast-${type}`;
        toast.textContent = message;
        
        // 스타일 적용
        Object.assign(toast.style, {
            position: 'fixed',
            top: '20px',
            right: '20px',
            background: type === 'success' ? '#10b981' : '#ef4444',
            color: 'white',
            padding: '12px 20px',
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: '500',
            zIndex: '9999',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            opacity: '0',
            transform: 'translateY(-10px)',
            transition: 'all 0.3s ease'
        });

        document.body.appendChild(toast);

        // 애니메이션 효과
        setTimeout(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        }, 10);

        // 3초 후 제거
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-10px)';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, 3000);
    }
}

export { ScreenshotManager };