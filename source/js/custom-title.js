(() => {
  const HIDDEN_TITLE = "(；′⌒`) 信号丢失，世界线偏移…";
  const RETURN_TITLE = "(｡•̀ᴗ-)✧ 欢迎回到 β 世界线";
  const RETURN_DURATION = 1500;
  const VISIBILITY_PRIORITY = 100;

  let baseTitle = document.title;
  let restoreTimer = null;
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
    }, RETURN_DURATION);
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);

  // Keep the original title correct if PJAX is enabled in the future.
  document.addEventListener("pjax:complete", () => {
    window.customTitleController.setBaseTitle(document.title);
  });

  if (document.hidden) {
    handleVisibilityChange();
  }
})();
