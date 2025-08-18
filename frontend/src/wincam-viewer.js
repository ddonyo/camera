// frontend/src/wincam-viewer.js
// 로드되면 바로 실행되는 즉시 실행 스크립트(IIFE)
(function () {
  console.log("wincam-viewer.js loaded");

  const root = document.getElementById("video-root") || document.body;

  const video = document.createElement("video");
  Object.assign(video, {
    autoplay: true,
    playsInline: true,
  });
  Object.assign(video.style, {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    background: "#000",
  });

  navigator.mediaDevices
    .getUserMedia({ video: true, audio: false })
    .then((stream) => {
      console.log("Webcam stream started");
      video.srcObject = stream;

      // CSS 토글로 캔버스 숨기고 video-root 노출
      document.body.classList.add("win-webcam");

      root.appendChild(video);
    })
    .catch((err) => {
      console.error("Webcam access error:", err);
    });
})();
