// frontend/src/roi-overlay.js
// ROI 영역 시각화 및 손 감지 결과 표시

export class ROIOverlay {
    constructor(canvasElement) {
        this.canvas = canvasElement;
        this.overlayCanvas = null;
        this.overlayCtx = null;
        this.config = null;
        this.handDetections = [];
        this.isEnabled = false;
        
        this.createOverlayCanvas();
        this.setupStyles();
        this.loadROIConfig();
    }

    createOverlayCanvas() {
        // 기존 캔버스 위에 오버레이 캔버스 생성
        this.overlayCanvas = document.createElement('canvas');
        this.overlayCanvas.id = 'roi-overlay-canvas';
        this.overlayCanvas.style.position = 'absolute';
        this.overlayCanvas.style.top = '0';
        this.overlayCanvas.style.left = '0';
        this.overlayCanvas.style.width = '100%';
        this.overlayCanvas.style.height = '100%';
        this.overlayCanvas.style.pointerEvents = 'none';
        this.overlayCanvas.style.zIndex = '200';
        this.overlayCtx = this.overlayCanvas.getContext('2d');
        // 캔버스 부모에 오버레이 추가
        const parent = this.canvas.parentElement;
        if (parent) {
            parent.style.position = 'relative'; // 상대 위치 설정
            parent.appendChild(this.overlayCanvas);
            
            // 디버그 정보 출력
            console.log('[ROI-Overlay] Overlay added to parent:', {
                parentClass: parent.className,
                parentId: parent.id,
                parentTag: parent.tagName,
                parentRect: parent.getBoundingClientRect(),
                canvasRect: this.canvas.getBoundingClientRect(),
                overlayRect: this.overlayCanvas.getBoundingClientRect()
            });
            
            // DOM 구조 확인
            console.log('[ROI-Overlay] DOM structure:', {
                parentChildren: Array.from(parent.children).map(child => ({
                    tag: child.tagName,
                    id: child.id,
                    className: child.className,
                    zIndex: window.getComputedStyle(child).zIndex,
                    position: window.getComputedStyle(child).position,
                    display: window.getComputedStyle(child).display,
                    visibility: window.getComputedStyle(child).visibility,
                    opacity: window.getComputedStyle(child).opacity
                }))
            });
            
            // 오버레이 캔버스의 계산된 스타일 확인
            setTimeout(() => {
                const computedStyle = window.getComputedStyle(this.overlayCanvas);
                console.log('[ROI-Overlay] Computed styles:', {
                    display: computedStyle.display,
                    visibility: computedStyle.visibility,
                    opacity: computedStyle.opacity,
                    position: computedStyle.position,
                    top: computedStyle.top,
                    left: computedStyle.left,
                    width: computedStyle.width,
                    height: computedStyle.height,
                    zIndex: computedStyle.zIndex,
                    border: computedStyle.border
                });
                
                // DOM 트리에서 실제로 존재하는지 확인
                console.log('[ROI-Overlay] DOM presence check:', {
                    inDocument: document.contains(this.overlayCanvas),
                    hasParent: !!this.overlayCanvas.parentElement,
                    parentTag: this.overlayCanvas.parentElement?.tagName,
                    siblingCount: this.overlayCanvas.parentElement?.children.length
                });
            }, 500);
        } else {
            console.error('[ROI-Overlay] No parent element found for canvas');
            return;
        }
        
        // 기본 캔버스 크기에 맞춤
        this.syncCanvasSize();
        
        console.log('[ROI-Overlay] Overlay canvas created:', {
            width: this.overlayCanvas.width,
            height: this.overlayCanvas.height,
            styleWidth: this.overlayCanvas.style.width,
            styleHeight: this.overlayCanvas.style.height,
            zIndex: this.overlayCanvas.style.zIndex,
            position: this.overlayCanvas.style.position
        });
        this.render();
    }

    syncCanvasSize() {
        if (!this.overlayCanvas || !this.canvas) return;
        
        // 실제 표시 크기를 가져옴
        const rect = this.canvas.getBoundingClientRect();
        
        // 캔버스 내부 해상도는 기본 캔버스와 동일하게
        this.overlayCanvas.width = this.canvas.width;
        this.overlayCanvas.height = this.canvas.height;
        
        // CSS 크기는 100%로 설정 (부모와 동일)
        this.overlayCanvas.style.width = '100%';
        this.overlayCanvas.style.height = '100%';
        
        console.log('[ROI-Overlay] Canvas size synced:', {
            canvasWidth: this.canvas.width,
            canvasHeight: this.canvas.height,
            overlayWidth: this.overlayCanvas.width,
            overlayHeight: this.overlayCanvas.height,
            rectWidth: rect.width,
            rectHeight: rect.height,
            cssWidth: this.overlayCanvas.style.width,
            cssHeight: this.overlayCanvas.style.height
        });
    }

    setupStyles() {
        // ROI 스타일 설정
        this.styles = {
            startROI: {
                strokeStyle: '#00ff00', // 녹색 (시작)
                fillStyle: 'rgba(0, 255, 0, 0.1)',
                lineWidth: 3,
                lineDash: [10, 5]
            },
            stopROI: {
                strokeStyle: '#ff0000', // 빨간색 (중지)
                fillStyle: 'rgba(255, 0, 0, 0.1)',
                lineWidth: 3,
                lineDash: [10, 5]
            },
            handMarker: {
                right: {
                    fillStyle: '#00ff00',
                    strokeStyle: '#ffffff',
                    radius: 8
                },
                left: {
                    fillStyle: '#ff0000', 
                    strokeStyle: '#ffffff',
                    radius: 8
                }
            },
            label: {
                font: 'bold 14px Arial',
                fillStyle: '#ffffff',
                strokeStyle: '#000000',
                lineWidth: 2
            }
        };
    }

    async loadROIConfig() {
        try {
            const response = await fetch('./config/roi.json');
            if (response.ok) {
                this.config = await response.json();
                console.log('[ROI-Overlay] Configuration loaded:', this.config);
                if (this.isEnabled) {
                    this.render();
                }
            } else {
                console.error('[ROI-Overlay] Failed to fetch config:', response.status, response.statusText);
            }
        } catch (error) {
            console.error('[ROI-Overlay] Failed to load ROI config:', error);
        }
    }

    enable() {
        this.isEnabled = true;
        this.overlayCanvas.style.display = 'block';
        
        // 설정이 이미 로드되어 있으면 즉시 렌더링
        if (this.config) {
            this.render();
        } else {
            // 설정이 없으면 다시 로드 시도
            console.log('[ROI-Overlay] Config not loaded, attempting to reload...');
            this.loadROIConfig();
        }
        
        console.log('[ROI-Overlay] Enabled');
    }

    disable() {
        this.isEnabled = false;
        this.overlayCanvas.style.display = 'none';
        console.log('[ROI-Overlay] Disabled');
    }

    toggle() {
        if (this.isEnabled) {
            this.disable();
        } else {
            this.enable();
        }
    }

    updateHandDetections(detections) {
        this.handDetections = detections || [];
        if (this.isEnabled) {
            this.render();
        }
    }

    render() {
        console.log('[ROI-Overlay] Render called:', {
            isEnabled: this.isEnabled,
            hasOverlayCtx: !!this.overlayCtx,
            hasConfig: !!this.config,
            configContent: this.config
        });
        
        if (!this.isEnabled || !this.overlayCtx || !this.config) {
            console.log('[ROI-Overlay] Render skipped - missing requirements');
            return;
        }

        // 캔버스 크기 동기화
        this.syncCanvasSize();
        
        // 오버레이 클리어
        this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
        
        console.log('[ROI-Overlay] Drawing ROI areas...');
        
        // ROI 영역 그리기
        this.drawROI('start_roi', this.styles.startROI, 'START (Right Hand)');
        this.drawROI('stop_roi', this.styles.stopROI, 'STOP (Left Hand)');
        
        // 손 감지 결과 그리기
        this.drawHandDetections();
        
        // 상태 정보 표시
        this.drawStatusInfo();
        
        console.log('[ROI-Overlay] Render completed');
    }

    drawROI(roiKey, style, label) {
        console.log(`[ROI-Overlay] Drawing ${roiKey}:`, {
            roiExists: !!this.config[roiKey],
            roi: this.config[roiKey],
            style: style,
            label: label
        });
        
        if (!this.config[roiKey]) {
            console.log(`[ROI-Overlay] No config for ${roiKey}`);
            return;
        }
        
        const roi = this.config[roiKey];
        const ctx = this.overlayCtx;
        const canvas = this.overlayCanvas;
        
        // 정규화된 좌표를 픽셀 좌표로 변환
        const x1 = roi.x1 * canvas.width;
        const y1 = roi.y1 * canvas.height;
        const x2 = roi.x2 * canvas.width;
        const y2 = roi.y2 * canvas.height;
        
        // 중심점과 반지름 계산
        const centerX = (x1 + x2) / 2;
        const centerY = (y1 + y2) / 2;
        const radius = Math.min((x2 - x1), (y2 - y1)) / 2;
        
        console.log(`[ROI-Overlay] ${roiKey} circle:`, {
            centerX, centerY, radius,
            canvasSize: { width: canvas.width, height: canvas.height }
        });
        
        // ROI 원형 그리기
        ctx.save();
        ctx.strokeStyle = style.strokeStyle;
        ctx.fillStyle = style.fillStyle;
        ctx.lineWidth = style.lineWidth;
        ctx.setLineDash(style.lineDash);
        
        // 원형 배경 채우기
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        ctx.fill();
        
        // 원형 테두리 그리기
        ctx.stroke();
        
        // 라벨 그리기 (원 위쪽에)
        this.drawLabel(centerX, centerY - radius - 10, label);
        
        // 중심점에 작은 점 추가
        ctx.fillStyle = style.strokeStyle;
        ctx.beginPath();
        ctx.arc(centerX, centerY, 3, 0, 2 * Math.PI);
        ctx.fill();
        
        ctx.restore();
        
        console.log(`[ROI-Overlay] ${roiKey} drawn successfully`);
    }

    drawLabel(x, y, text) {
        const ctx = this.overlayCtx;
        const style = this.styles.label;
        
        ctx.save();
        ctx.font = style.font;
        ctx.fillStyle = style.fillStyle;
        ctx.strokeStyle = style.strokeStyle;
        ctx.lineWidth = style.lineWidth;
        ctx.textAlign = 'center'; // 중앙 정렬
        
        // 텍스트 테두리
        ctx.strokeText(text, x, y);
        // 텍스트 내용
        ctx.fillText(text, x, y);
        
        ctx.restore();
    }

    drawHandDetections() {
        if (!this.handDetections || this.handDetections.length === 0) {
            return;
        }
        
        const ctx = this.overlayCtx;
        const canvas = this.overlayCanvas;
        
        for (const detection of this.handDetections) {
            const { handedness, center, confidence, bbox } = detection;
            
            if (!center || confidence < (this.config.min_confidence || 0.7)) {
                continue;
            }
            
            // 정규화된 좌표를 픽셀 좌표로 변환
            const x = center.x * canvas.width;
            const y = center.y * canvas.height;
            
            // 손 위치 마커 그리기
            const handStyle = handedness === 'Right' ? 
                this.styles.handMarker.right : 
                this.styles.handMarker.left;
                
            ctx.save();
            ctx.fillStyle = handStyle.fillStyle;
            ctx.strokeStyle = handStyle.strokeStyle;
            ctx.lineWidth = 2;
            
            // 원형 마커
            ctx.beginPath();
            ctx.arc(x, y, handStyle.radius, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
            
            // 손 라벨
            const label = `${handedness} (${(confidence * 100).toFixed(0)}%)`;
            this.drawLabel(x + 15, y - 5, label);
            
            // 바운딩 박스 (옵션)
            if (bbox && this.config.show_bounding_box) {
                ctx.strokeStyle = handStyle.fillStyle;
                ctx.lineWidth = 1;
                ctx.setLineDash([5, 5]);
                
                const bx = bbox.x1 * canvas.width;
                const by = bbox.y1 * canvas.height;
                const bw = (bbox.x2 - bbox.x1) * canvas.width;
                const bh = (bbox.y2 - bbox.y1) * canvas.height;
                
                ctx.strokeRect(bx, by, bw, bh);
            }
            
            ctx.restore();
        }
    }

    drawStatusInfo() {
        if (!this.config.enabled) {
            this.drawLabel(10, 30, '❌ ROI Detection DISABLED');
            return;
        }
        
        // ROI 상태 표시
        const statusY = this.overlayCanvas.height - 60;
        
        this.drawLabel(10, statusY, '👋 Hand Gesture Recording:');
        this.drawLabel(10, statusY + 20, `• Right hand in green area → START recording`);
        this.drawLabel(10, statusY + 40, `• Left hand in red area → STOP recording`);
        
        // 현재 감지된 손 개수
        const handCount = this.handDetections.length;
        if (handCount > 0) {
            this.drawLabel(10, statusY - 20, `👋 Detected: ${handCount} hand(s)`);
        }
    }

    // 리사이즈 이벤트 처리
    handleResize() {
        this.syncCanvasSize();
        if (this.isEnabled) {
            this.render();
        }
    }

    // ROI 설정 업데이트
    updateConfig(newConfig) {
        this.config = newConfig;
        if (this.isEnabled) {
            this.render();
        }
        console.log('[ROI-Overlay] Configuration updated');
    }

    // 정리
    destroy() {
        if (this.overlayCanvas && this.overlayCanvas.parentElement) {
            this.overlayCanvas.parentElement.removeChild(this.overlayCanvas);
        }
        this.overlayCanvas = null;
        this.overlayCtx = null;
        console.log('[ROI-Overlay] Destroyed');
    }

    // ROI 좌표 검증 (원형)
    isPointInROI(x, y, roiType) {
        if (!this.config) return false;
        
        const roiKey = roiType === 'start' ? 'start_roi' : 'stop_roi';
        const roi = this.config[roiKey];
        
        if (!roi) return false;
        
        // 원형 ROI 검사를 위한 중심점과 반지름 계산
        const centerX = (roi.x1 + roi.x2) / 2;
        const centerY = (roi.y1 + roi.y2) / 2;
        const radiusX = (roi.x2 - roi.x1) / 2;
        const radiusY = (roi.y2 - roi.y1) / 2;
        const radius = Math.min(radiusX, radiusY);
        
        // 점과 중심점 사이의 거리 계산
        const distance = Math.sqrt(
            Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2)
        );
        
        return distance <= radius;
    }

    // 픽셀 좌표를 정규화된 좌표로 변환
    pixelToNormalized(pixelX, pixelY) {
        const canvas = this.overlayCanvas;
        return {
            x: pixelX / canvas.width,
            y: pixelY / canvas.height
        };
    }

    // 정규화된 좌표를 픽셀 좌표로 변환  
    normalizedToPixel(normalizedX, normalizedY) {
        const canvas = this.overlayCanvas;
        return {
            x: normalizedX * canvas.width,
            y: normalizedY * canvas.height
        };
    }

    // 가시성 테스트 (디버그용)
    drawVisibilityTest() {
        if (!this.overlayCtx) {
            console.error('[ROI-Overlay] No overlay context for visibility test');
            return;
        }
        
        const ctx = this.overlayCtx;
        const canvas = this.overlayCanvas;
        
        console.log('[ROI-Overlay] Drawing visibility test:', {
            canvasWidth: canvas.width,
            canvasHeight: canvas.height,
            contextExists: !!ctx
        });
        
        // 캔버스 클리어
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // 캔버스 전체에 강한 색상 배경
        ctx.fillStyle = 'rgba(255, 0, 255, 0.8)'; // 밝은 마젠타
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // 중앙에 큰 텍스트
        ctx.fillStyle = 'white';
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 4;
        ctx.font = 'bold 64px Arial';
        ctx.textAlign = 'center';
        ctx.strokeText('ROI OVERLAY', canvas.width / 2, canvas.height / 2);
        ctx.fillText('ROI OVERLAY', canvas.width / 2, canvas.height / 2);
        
        // 큰 원형 마커들
        ctx.fillStyle = 'lime';
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 3;
        
        // 왼쪽 상단
        ctx.beginPath();
        ctx.arc(80, 80, 40, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        
        // 오른쪽 상단  
        ctx.beginPath();
        ctx.arc(canvas.width - 80, 80, 40, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        
        // 왼쪽 하단
        ctx.beginPath();
        ctx.arc(80, canvas.height - 80, 40, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        
        // 오른쪽 하단
        ctx.beginPath();
        ctx.arc(canvas.width - 80, canvas.height - 80, 40, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        
        // 테두리 사각형
        ctx.strokeStyle = 'yellow';
        ctx.lineWidth = 10;
        ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
        
        console.log('[ROI-Overlay] Visibility test drawn - should be VERY visible now');
    }

}