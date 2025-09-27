# TODO - V2 코드 개선 사항

## 🔴 높은 우선순위 (Critical)

### 1. 사용되지 않는 코드 제거
**파일**: `backend/src/capture.js`
**문제**: `startRecording()`, `stopRecording()` 메서드가 정의되어 있지만 실제로 사용되지 않음
**현황**:
- 실제 녹화 제어는 `electron/main.js`의 FrameHandler에서 직접 처리
- capture.js의 녹화 메서드는 불필요한 코드
**조치**:
```javascript
// backend/src/capture.js 에서 다음 메서드 제거 필요:
- async startRecording() { ... }
- async stopRecording() { ... }
- 관련 속성: isRecording, recordingStartTime
```

### 2. 중복된 ROI 설정 파일
**파일**:
- `config/roi.json`
- `frontend/public/config/roi.json`
**문제**: 동일한 설정 파일이 두 곳에 존재
**조치**:
- 하나로 통합하고 심볼릭 링크 또는 빌드 시 복사

### 3. 임시 파일 정리
**경로**: `backend/temp/`
**문제**: 커밋된 임시 이미지 파일들
```
backend/temp/input_1755971757833.jpg
backend/temp/input_1755971757951.jpg
backend/temp/input_1755971860245.jpg
...
```
**조치**:
- .gitignore에 `/backend/temp/` 추가
- 기존 파일들 git에서 제거

## 🟡 중간 우선순위 (Important)

### 4. 에러 처리 개선
**파일**: `frontend/src/vton-service.js`
**문제**: API 실패 시 폴백 처리는 있지만 사용자에게 명확한 피드백 부족
**조치**:
```javascript
// 현재: 조용히 mock으로 폴백
// 개선: 사용자에게 알림
if (!response.ok) {
    console.warn('VTON API failed, using mock');
    // TODO: UI에 "오프라인 모드" 표시
}
```

### 5. 제스처 인식 안정성
**파일**: `backend/src/hand-router.js`, `backend/src/hand-worker.js`
**문제**: 제스처 녹화 트리거가 8번이나 수정됨 (불안정)
**현황**:
- 최종적으로 롤백됨 (`10b6d6d`)
- 코드는 남아있지만 비활성화 상태
**조치**:
- 제스처 녹화 관련 코드 완전 제거 또는
- 안정화 후 재활성화 (충분한 테스트 후)

### 6. 플랫폼별 기능 격차
**파일**: `backend/src/win-capture.js` vs `backend/src/capture.js`
**문제**: Windows와 Linux 간 기능 차이
**조치**:
- 인터페이스 통일을 위한 추상 클래스 생성
- 플랫폼별 기능 매트릭스 문서화

### 7. 메모리 누수 가능성
**파일**: `frontend/src/frame-manager.js`
**문제**: 프레임 배열이 계속 증가할 수 있음
**조치**:
```javascript
// 최대 프레임 수 제한 필요
const MAX_FRAMES = 1000;
if (this.frames.length > MAX_FRAMES) {
    this.frames = this.frames.slice(-MAX_FRAMES);
}
```

## 🟢 낮은 우선순위 (Nice to have)

### 8. 테스트 코드 추가
**현황**:
- `backend/src/test/hand-gesture-test.js`만 존재
- 대부분의 모듈 테스트 없음
**조치**:
```bash
tests/
├── unit/
│   ├── frame-manager.test.js
│   ├── vton-service.test.js
│   └── wardrobe-controller.test.js
└── e2e/
    ├── recording.test.js
    └── vton-flow.test.js
```

### 9. TypeScript 마이그레이션
**이유**:
- 복잡한 이벤트 시스템 타입 안정성 필요
- IPC 메시지 타입 정의 필요
**조치**:
```typescript
// types/ipc.d.ts
interface IPCMessage {
    channel: 'vton' | 'hand' | 'frame';
    data: any;
}
```

### 10. 로깅 시스템 개선
**현황**: console.log 사용
**조치**:
- Winston 또는 Pino 로거 도입
- 로그 레벨 설정 (debug, info, warn, error)
- 파일 로깅 옵션

### 11. 설정 관리 통합
**현황**:
- 하드코딩된 설정값들 산재
- roi.json만 별도 파일
**조치**:
```javascript
// config/app.config.js
module.exports = {
    camera: {
        width: 640,
        height: 360,
        fps: 24
    },
    vton: {
        modes: { ... },
        timeout: 30000
    },
    gesture: {
        roi: { ... },
        gestures: { ... }
    }
};
```

### 12. API 문서화
**조치**:
- Swagger/OpenAPI 스펙 작성
- JSDoc 주석 추가
- README에 API 엔드포인트 문서화

## 📋 리팩토링 제안

### 1. 컴포넌트 책임 명확화
```
현재: mjpeg-viewer.js가 너무 많은 책임 (700+ 라인)
개선:
- CameraController: 카메라 제어
- RecordingController: 녹화 제어
- PlaybackController: 재생 제어
- GestureController: 제스처 제어
```

### 2. 이벤트 시스템 정리
```
현재: EventEmitter, IPC, DOM 이벤트 혼재
개선: 통합 이벤트 버스
```

### 3. 상태 관리 패턴
```
현재: 각 컴포넌트가 개별 상태 관리
개선: 중앙 상태 관리 (Redux-like 패턴)
```

## 🐛 버그 수정 필요

### 1. 프레임 로딩 중 모드 전환
**문제**: 프레임 로딩 중 다른 모드로 전환하면 백그라운드에서 계속 로딩
**해결**: 로딩 취소 로직 추가

### 2. Full 모드에서 워드로브 클릭
**문제**: Full 모드에서 숨겨진 워드로브가 여전히 클릭 가능할 수 있음
**해결**: pointer-events: none 추가

### 3. Windows에서 카메라 해제
**문제**: 앱 종료 시 카메라가 제대로 해제되지 않을 수 있음
**해결**: 명시적 cleanup 로직 추가

## 📊 성능 최적화

### 1. 프레임 버퍼링
- 현재: 파일 시스템 기반
- 개선: 메모리 버퍼 + 파일 시스템 하이브리드

### 2. 이미지 로딩 최적화
- 현재: 동기적 로딩
- 개선: 프로그레시브 로딩, 썸네일 프리로드

### 3. MediaPipe 모델 캐싱
- 현재: 매번 로드
- 개선: 모델 파일 로컬 캐싱

## 🔒 보안 개선

### 1. 파일 경로 검증
- 사용자 입력 경로 검증 필요
- Path traversal 공격 방지

### 2. API 인증
- VTON API 호출 시 인증 토큰 추가
- Rate limiting 구현

### 3. IPC 메시지 검증
- IPC 메시지 스키마 검증
- 신뢰할 수 없는 렌더러 프로세스 고려

## 📝 문서화 필요

1. **개발자 가이드**: 새 기능 추가 방법
2. **API 레퍼런스**: 모든 엔드포인트 문서화
3. **배포 가이드**: 프로덕션 배포 절차
4. **트러블슈팅**: 자주 발생하는 문제 해결법
5. **아키텍처 문서**: 시스템 구조 다이어그램

## 완료 예상 시간

- 🔴 높은 우선순위: 1주일
- 🟡 중간 우선순위: 2-3주
- 🟢 낮은 우선순위: 1-2개월

## 즉시 조치 가능한 항목

1. **지금 바로**:
   - backend/temp/ 파일들 제거
   - .gitignore 업데이트

2. **오늘 중**:
   - capture.js의 불필요한 녹화 메서드 제거
   - 중복 roi.json 정리

3. **이번 주**:
   - 주요 버그 수정
   - 기본적인 에러 처리 개선