(() => {
  const HIDDEN_TITLE = "(；′⌒`) 信号丢失，世界线偏移…";
  const RETURN_TITLE = "(｡•̀ᴗ-)✧ 欢迎回到 β 世界线";
  const LOADING_TITLE = "正在连接目标世界线…";
  const RETURN_DURATION = 1500;
  const TYPE_INTERVAL = 120;
  const VISIBILITY_PRIORITY = 100;
  const PRELOADER_PRIORITY = 80;
  const TYPEWRITER_PRIORITY = 20;

  let baseTitle = document.title;
  let restoreTimer = null;
  let typingTimer = null;
  let typewriterHasRun = false;
  const states = new Map();

  const renderTitle = () => {
    const activeState = [...states.values()].sort(
      (left, right) => right.priority - left.priority
    )[0];

    document.title = activeState?.title ?? baseTitle;
  };

  // Shared controller for later preloader, typing and reading-progress effects.
  window.customTitleController = Object.freeze({
    setBaseTitle(title = document.title) {
      baseTitle = title;
      renderTitle();
    },

    getBaseTitle() {
      return baseTitle;
    },

    setState(key, title, priority = 0) {
      states.set(key, { title, priority });
      renderTitle();
    },

    clearState(key) {
      states.delete(key);
      renderTitle();
    }
  });

  const stopTypewriter = (reset = false) => {
    window.clearTimeout(typingTimer);
    typingTimer = null;
    window.customTitleController.clearState("typewriter");

    if (reset) {
      typewriterHasRun = false;
    }
  };

  const startTypewriter = () => {
    if (
      typewriterHasRun ||
      document.hidden ||
      window.customPreloaderActive === true ||
      document.getElementById("custom-preloader")
    ) {
      return;
    }

    const characters = Array.from(
      window.customTitleController.getBaseTitle()
    );

    if (characters.length === 0) {
      typewriterHasRun = true;
      return;
    }

    typewriterHasRun = true;
    let characterIndex = 1;

    const typeNextCharacter = () => {
      window.customTitleController.setState(
        "typewriter",
        characters.slice(0, characterIndex).join(""),
        TYPEWRITER_PRIORITY
      );

      if (characterIndex >= characters.length) {
        typingTimer = window.setTimeout(() => {
          window.customTitleController.clearState("typewriter");
          typingTimer = null;
        }, TYPE_INTERVAL);
        return;
      }

      characterIndex += 1;
      typingTimer = window.setTimeout(typeNextCharacter, TYPE_INTERVAL);
    };

    typeNextCharacter();
  };

  const handleVisibilityChange = () => {
    window.clearTimeout(restoreTimer);

    if (document.hidden) {
      window.customTitleController.setState(
        "visibility",
        HIDDEN_TITLE,
        VISIBILITY_PRIORITY
      );
      return;
    }

    window.customTitleController.setState(
      "visibility",
      RETURN_TITLE,
      VISIBILITY_PRIORITY
    );

    restoreTimer = window.setTimeout(() => {
      window.customTitleController.clearState("visibility");
      startTypewriter();
    }, RETURN_DURATION);
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);

  const setPreloaderTitle = () => {
    stopTypewriter(true);
    window.customTitleController.setState(
      "preloader",
      LOADING_TITLE,
      PRELOADER_PRIORITY
    );
  };

  const clearPreloaderTitle = () => {
    window.customTitleController.clearState("preloader");
    startTypewriter();
  };

  window.addEventListener("custom-preloader:show", setPreloaderTitle);
  window.addEventListener("custom-preloader:hide", clearPreloaderTitle);

  // Cover the case where the preloader was created before this script loaded.
  if (
    window.customPreloaderActive === true ||
    document.getElementById("custom-preloader")
  ) {
    setPreloaderTitle();
  }

  // Keep the original title correct if PJAX is enabled in the future.
  document.addEventListener("pjax:complete", () => {
    const nextPageTitle = document.title;
    stopTypewriter(true);
    window.customTitleController.setBaseTitle(nextPageTitle);
    startTypewriter();
  });

  const startInitialTypewriter = () => {
    startTypewriter();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startInitialTypewriter, {
      once: true
    });
  } else {
    startInitialTypewriter();
  }

  if (document.hidden) {
    handleVisibilityChange();
  }
})();
