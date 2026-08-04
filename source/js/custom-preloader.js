(() => {
  const VIDEO_PATH = "/video/loading.webm";
  const FADE_DURATION = 500;

  // 兜底时间，防止视频加载失败后遮罩永久存在
  const MAX_WAIT_TIME = 10000;

  let pageLoaded = document.readyState === "complete";
  let videoEnded = false;
  let hidden = false;

  const hidePreloader = () => {
    if (hidden) {
      return;
    }

    // 页面和视频都完成后才隐藏
    if (!pageLoaded || !videoEnded) {
      return;
    }

    hidden = true;

    const preloader = document.getElementById("custom-preloader");

    if (!preloader) {
      return;
    }

    preloader.classList.add("is-hidden");

    window.setTimeout(() => {
      preloader.remove();
    }, FADE_DURATION);
  };

  const forceHidePreloader = () => {
    if (hidden) {
      return;
    }

    hidden = true;

    const preloader = document.getElementById("custom-preloader");

    if (!preloader) {
      return;
    }

    preloader.classList.add("is-hidden");

    window.setTimeout(() => {
      preloader.remove();
    }, FADE_DURATION);
  };

  const createPreloader = () => {
    if (document.getElementById("custom-preloader")) {
      return;
    }

    const preloader = document.createElement("div");
    preloader.id = "custom-preloader";
    preloader.setAttribute("aria-hidden", "true");

    preloader.innerHTML = `
      <video
        id="custom-preloader-video"
        autoplay
        muted
        playsinline
        preload="auto"
        disablepictureinpicture
      >
        <source src="${VIDEO_PATH}" type="video/webm">
      </video>
    `;

    document.body.prepend(preloader);

    const video = document.getElementById("custom-preloader-video");

    if (!video) {
      videoEnded = true;
      hidePreloader();
      return;
    }

    video.addEventListener(
      "ended",
      () => {
        videoEnded = true;
        hidePreloader();
      },
      { once: true }
    );

    video.addEventListener(
      "error",
      () => {
        console.warn("Preloader video failed to load:", VIDEO_PATH);

        videoEnded = true;
        hidePreloader();
      },
      { once: true }
    );

    // 部分浏览器可能阻止自动播放，主动尝试一次
    const playPromise = video.play();

    if (playPromise !== undefined) {
      playPromise.catch((error) => {
        console.warn("Preloader autoplay failed:", error);

        videoEnded = true;
        hidePreloader();
      });
    }

    // 最终兜底，避免页面一直被遮住
    window.setTimeout(forceHidePreloader, MAX_WAIT_TIME);
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      createPreloader,
      { once: true }
    );
  } else {
    createPreloader();
  }

  window.addEventListener(
    "load",
    () => {
      pageLoaded = true;
      hidePreloader();
    },
    { once: true }
  );
})();