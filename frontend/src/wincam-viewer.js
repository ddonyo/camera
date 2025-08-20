// frontend/src/wincam-viewer.js
(function () {
  console.log("wincam-viewer.js loaded");

  const root = document.getElementById("video-root") || document.body;

  const video = document.createElement("video");
  Object.assign(video, {
    autoplay: true,
    playsInline: true,
    muted: true, // 일부 브라우저 자동재생 위해(영상만 사용)
  });
  Object.assign(video.style, {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    background: "#000",
  });

  // 오프스크린 캔버스 (DOM에 붙이지 않음)
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  // ready 상태를 Promise로 노출
  let _readyResolve;
  const ready = new Promise((res) => (_readyResolve = res));

  // 전역 헬퍼 노출
  window.WIN_CAM = {
    /** 웹캠 준비가 끝나면 resolve */
    ready,
    /** 현재 프레임 캡처: {blob, dataUrl, width, height} 반환 */
    async capture(opts = {}) {
      await ready;

      const {
        mimeType = "image/jpeg",
        quality = 0.92,
        mirror = false, // 셀피 제작 시 좌우반전 원하면 true
        maxWidth = 0,   // 리사이즈 원하면 지정 (0은 원본)
        maxHeight = 0,
      } = opts;

      // 비디오의 실제 해상도 사용
      const vw = video.videoWidth;
      const vh = video.videoHeight;

      // 리사이즈(선택)
      let outW = vw;
      let outH = vh;
      if (maxWidth > 0 || maxHeight > 0) {
        const rw = maxWidth > 0 ? maxWidth : vw;
        const rh = maxHeight > 0 ? maxHeight : vh;
        const r = Math.min(rw / vw, rh / vh);
        outW = Math.round(vw * r);
        outH = Math.round(vh * r);
      }

      canvas.width = outW;
      canvas.height = outH;

      // 그리기
      ctx.save();
      if (mirror) {
        ctx.translate(outW, 0);
        ctx.scale(-1, 1);
      }
      // cover 비율 맞추고 싶으면 여기서 drawImage에 크롭 계산 추가 가능
      ctx.drawImage(video, 0, 0, outW, outH);
      ctx.restore();

      const dataUrl = canvas.toDataURL(mimeType, quality);

      // Blob도 필요하면
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, mimeType, quality)
      );

      return { blob, dataUrl, width: outW, height: outH };
    },
    /** 스트림 종료 */
    stop() {
      try {
        const stream = video.srcObject;
        if (stream) stream.getTracks().forEach((t) => t.stop());
        video.srcObject = null;
      } catch (e) {
        console.warn("WIN_CAM.stop error:", e);
      }
    },
    /** 비디오 엘리먼트 접근(디버그 용) */
    get video() {
      return video;
    },
  };

  // getUserMedia
  navigator.mediaDevices
    .getUserMedia({ video: true, audio: false })
    .then((stream) => {
      console.log("Webcam stream started");
      video.srcObject = stream;

      // 메타데이터/프레임 준비 확인
      const markReady = () => {
        // 일부 브라우저는 videoWidth/Height가 0일 수 있으므로 재시도
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          document.body.classList.add("win-webcam");
          root.appendChild(video);
          _readyResolve();
        } else {
          // requestVideoFrameCallback이 있으면 다음 프레임 때 확인
          if (video.requestVideoFrameCallback) {
            video.requestVideoFrameCallback(() => markReady());
          } else {
            setTimeout(markReady, 50);
          }
        }
      };

      // 다양한 이벤트로 준비 감지
      video.addEventListener("loadedmetadata", markReady, { once: true });
      video.addEventListener("canplay", markReady, { once: true });

      // 혹시 이벤트가 안 오는 경우 대비
      setTimeout(markReady, 200);
    })
    .catch((err) => {
      console.error("Webcam access error:", err);
    });
})();
