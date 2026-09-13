(() => {
  "use strict";

  const MODEL_URL =
    "https://static.amadeus-web.top/live2dmodels/steinsGateKurisuNew/%E7%BA%A2%E8%8E%89%E6%A0%96.model3.json";
  const MIN_DESKTOP_WIDTH = 768;
  const MODEL_SCALE = 0.75;
  const HEAD_ANCHOR = {
    x: 0.5,
    y: 1 - (1 - 0.41) * MODEL_SCALE,
  };
  const MOTION_GROUPS = [
    "neutral",
    "anger",
    "joy",
    "sadness",
    "shy",
    "shy2",
    "smile1",
    "smile2",
    "surprise",
    "unhappy",
    "random1",
    "random2",
    "random3",
    "random4",
    "random5",
  ];
  const EXPRESSIONS = [
    "anger",
    "joy",
    "neutral",
    "sadness",
    "shy",
    "shy2",
    "smile1",
    "smile2",
    "surprise",
    "unhappy",
  ];
  const REACTIONS = EXPRESSIONS;
  const ACTION_LABELS = {
    neutral: "平静",
    anger: "生气",
    joy: "开心",
    sadness: "难过",
    shy: "害羞 Ⅰ",
    shy2: "害羞 Ⅱ",
    smile1: "微笑 Ⅰ",
    smile2: "微笑 Ⅱ",
    surprise: "惊讶",
    unhappy: "不满",
    random1: "随机动作 Ⅰ",
    random2: "随机动作 Ⅱ",
    random3: "随机动作 Ⅲ",
    random4: "随机动作 Ⅳ",
    random5: "随机动作 Ⅴ",
  };
  const INTERACTION_PRIORITY = {
    ambient: 1,
    context: 2,
    feedback: 3,
    manual: 4,
  };
  const IDLE_INITIAL_DELAY = 30000;
  const IDLE_MIN_DELAY = 25000;
  const IDLE_MAX_DELAY = 60000;
  const MANUAL_LOCK_DURATION = 6000;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const DEBUG_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

  let app;
  let model;
  let contextMenu;
  let framePending = false;
  let focusEnabled = true;
  let autoInteractionEnabled = true;
  let debugMenuEnabled = DEBUG_HOSTS.has(window.location.hostname);
  let moodTimer;
  let idleTimer;
  let pauseReactionTimer;
  let hoverReactionTimer;
  let singleClickTimer;
  let hiddenAt = 0;
  let lastIdleMotion = "";
  let lastActivityAt = Date.now();
  let activePriority = 0;
  let activeUntil = 0;
  let clickHistory = [];
  const triggerTimes = new Map();
  const boundAPlayers = new WeakSet();
  const boundAudioElements = new WeakSet();
  let pointerX = window.innerWidth / 2;
  let pointerY = window.innerHeight / 2;

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const fitModel = (container) => {
    if (!model) return;

    model.scale.set(1);
    const scale = Math.min(
      (container.clientWidth * 0.96) / model.width,
      (container.clientHeight * 0.96) / model.height
    );

    model.scale.set(scale * MODEL_SCALE);
    model.anchor.set(0.5, 1);
    model.x = container.clientWidth / 2;
    model.y = container.clientHeight;
  };

  const updateFocus = (container) => {
    framePending = false;
    if (!model || !focusEnabled) return;

    const rect = container.getBoundingClientRect();
    const headX = rect.left + rect.width * HEAD_ANCHOR.x;
    const headY = rect.top + rect.height * HEAD_ANCHOR.y;
    const focusX = clamp(
      (pointerX - headX) / Math.max(window.innerWidth * 0.48, 1),
      -1,
      1
    );
    const focusY = clamp(
      (headY - pointerY) / Math.max(window.innerHeight * 0.48, 1),
      -1,
      1
    );

    model.internalModel.focusController.focus(focusX, focusY);
  };

  const playMotionDirect = (group, index = 0) => {
    if (!model || !MOTION_GROUPS.includes(group)) return false;
    const priority = window.PIXI.live2d.MotionPriority.FORCE;
    model.motion(group, index, priority);
    return true;
  };

  const setExpressionDirect = (name) => {
    if (!model || !EXPRESSIONS.includes(name)) return false;
    model.expression(name);
    return true;
  };

  const resetExpressionDirect = () => {
    const manager = model?.internalModel?.motionManager?.expressionManager;
    if (!manager) return false;
    manager.resetExpression();
    return true;
  };

  const acquireInteraction = ({
    source = "ambient",
    priority = INTERACTION_PRIORITY.ambient,
    cooldown = 3000,
    lock = 0,
    force = false,
  } = {}) => {
    if (!model || document.hidden) return false;
    if (!autoInteractionEnabled && priority < INTERACTION_PRIORITY.manual) return false;

    const now = Date.now();
    const lastTriggeredAt = triggerTimes.get(source) || 0;
    if (!force && now - lastTriggeredAt < cooldown) return false;
    if (!force && now < activeUntil && priority < activePriority) return false;

    triggerTimes.set(source, now);
    activePriority = priority;
    activeUntil = now + lock;
    return true;
  };

  const scheduleMoodReset = (duration = 3000) => {
    window.clearTimeout(moodTimer);
    moodTimer = window.setTimeout(() => {
      if (Date.now() < activeUntil) {
        scheduleMoodReset(activeUntil - Date.now() + 100);
        return;
      }
      resetExpressionDirect();
      activePriority = 0;
    }, duration);
  };

  const requestReaction = (name, options = {}) => {
    if (!REACTIONS.includes(name) || !acquireInteraction(options)) return false;
    setExpressionDirect(name);
    playMotionDirect(name);
    scheduleMoodReset(options.hold ?? 3200);
    return true;
  };

  const requestMotion = (name, options = {}) => {
    if (!MOTION_GROUPS.includes(name) || !acquireInteraction(options)) return false;
    return playMotionDirect(name);
  };

  const requestExpression = (name, options = {}) => {
    if (!EXPRESSIONS.includes(name) || !acquireInteraction(options)) return false;
    const changed = setExpressionDirect(name);
    if (changed) scheduleMoodReset(options.hold ?? 3200);
    return changed;
  };

  const manualOptions = (source) => ({
    source,
    priority: INTERACTION_PRIORITY.manual,
    cooldown: 0,
    lock: MANUAL_LOCK_DURATION,
    hold: 4200,
    force: true,
  });

  const pickIdleMotion = () => {
    const candidates = MOTION_GROUPS.filter(
      (name) => name.startsWith("random") && name !== lastIdleMotion
    );
    const selected = candidates[Math.floor(Math.random() * candidates.length)];
    lastIdleMotion = selected;
    return selected;
  };

  const scheduleIdle = (delay = IDLE_INITIAL_DELAY) => {
    window.clearTimeout(idleTimer);
    if (reducedMotion.matches) return;
    idleTimer = window.setTimeout(() => {
      const trulyIdleFor = Date.now() - lastActivityAt;
      if (
        trulyIdleFor >= delay &&
        !document.hidden &&
        !contextMenu?.classList.contains("is-open")
      ) {
        requestMotion(pickIdleMotion(), {
          source: "idle",
          priority: INTERACTION_PRIORITY.ambient,
          cooldown: 15000,
        });
      }
      const nextDelay =
        IDLE_MIN_DELAY + Math.random() * (IDLE_MAX_DELAY - IDLE_MIN_DELAY);
      scheduleIdle(nextDelay);
    }, delay);
  };

  const registerActivity = () => {
    lastActivityAt = Date.now();
    scheduleIdle();
  };

  const handleCharacterClick = (event) => {
    const area = event.currentTarget.dataset.kurisuHit;
    const now = Date.now();
    clickHistory = clickHistory.filter((time) => now - time < 3000);
    clickHistory.push(now);

    window.clearTimeout(singleClickTimer);
    if (clickHistory.length >= 5) {
      requestReaction("anger", manualOptions("character-click-anger"));
      clickHistory = [];
      return;
    }
    if (clickHistory.length >= 3) {
      requestReaction("unhappy", manualOptions("character-click-unhappy"));
      return;
    }
    if (event.detail >= 2) {
      requestMotion(pickIdleMotion(), manualOptions("character-double-click"));
      return;
    }

    singleClickTimer = window.setTimeout(() => {
      requestReaction(
        area === "head" ? "shy2" : "surprise",
        manualOptions(`character-${area}`)
      );
    }, 240);
  };

  const bindCharacterHitAreas = (container) => {
    container.querySelectorAll("[data-kurisu-hit]").forEach((hitArea) => {
      hitArea.addEventListener("click", handleCharacterClick);
      hitArea.addEventListener("pointerenter", () => {
        if (hitArea.dataset.kurisuHit !== "head") return;
        window.clearTimeout(hoverReactionTimer);
        hoverReactionTimer = window.setTimeout(() => {
          requestReaction("shy", {
            source: "head-hover",
            priority: INTERACTION_PRIORITY.context,
            cooldown: 12000,
            hold: 2600,
          });
        }, 1500);
      });
      hitArea.addEventListener("pointerleave", () => {
        window.clearTimeout(hoverReactionTimer);
      });
    });
  };

  const reactForCurrentPage = ({ initial = false } = {}) => {
    if (!model) return;
    const path = window.location.pathname.toLowerCase();
    const isNotFound =
      document.title.includes("404") || Boolean(document.querySelector("#error-wrap"));

    if (isNotFound) {
      requestReaction("surprise", {
        source: "page-404",
        priority: INTERACTION_PRIORITY.feedback,
        cooldown: 2000,
        hold: 1800,
      });
      window.setTimeout(
        () =>
          requestReaction("unhappy", {
            source: "page-404-followup",
            priority: INTERACTION_PRIORITY.feedback,
            cooldown: 0,
            hold: 3800,
          }),
        1900
      );
      return;
    }

    if (path.startsWith("/about")) {
      requestReaction("shy2", {
        source: "page-about",
        priority: INTERACTION_PRIORITY.context,
        cooldown: 15000,
      });
      return;
    }
    if (path.startsWith("/music")) {
      requestReaction("joy", {
        source: "page-music",
        priority: INTERACTION_PRIORITY.context,
        cooldown: 15000,
      });
      return;
    }
    if (!initial && path.startsWith("/posts/") && Math.random() < 0.25) {
      requestReaction("smile1", {
        source: "page-post",
        priority: INTERACTION_PRIORITY.context,
        cooldown: 10000,
      });
    }
  };

  const runVisitGreeting = () => {
    const now = new Date();
    const today = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    let previousVisit = 0;
    let previousDay = "";
    try {
      previousVisit = Number(localStorage.getItem("kurisu-last-visit") || 0);
      previousDay = localStorage.getItem("kurisu-last-visit-day") || "";
      localStorage.setItem("kurisu-last-visit", String(Date.now()));
      localStorage.setItem("kurisu-last-visit-day", today);
    } catch (_error) {
      // Storage may be unavailable in privacy modes; greeting still works.
    }

    if (previousVisit && Date.now() - previousVisit > 7 * 86400000) {
      requestReaction("surprise", {
        source: "visit-return",
        priority: INTERACTION_PRIORITY.context,
        cooldown: 0,
        hold: 1800,
      });
      window.setTimeout(
        () =>
          requestReaction("joy", {
            source: "visit-return-followup",
            priority: INTERACTION_PRIORITY.context,
            cooldown: 0,
          }),
        1900
      );
      return;
    }

    if (previousDay === today) {
      if (Math.random() < 0.35) {
        requestReaction("smile1", {
          source: "visit-repeat",
          priority: INTERACTION_PRIORITY.ambient,
          cooldown: 0,
        });
      }
      return;
    }

    const hour = now.getHours();
    const greeting = hour < 6 ? "unhappy" : hour < 18 ? "joy" : "smile1";
    requestReaction(greeting, {
      source: "visit-daily",
      priority: INTERACTION_PRIORITY.context,
      cooldown: 0,
      hold: 3800,
    });
  };

  const bindAudioElement = (audio) => {
    if (boundAudioElements.has(audio)) return;
    boundAudioElements.add(audio);
    audio.addEventListener("play", () => {
      window.clearTimeout(pauseReactionTimer);
      requestReaction("joy", {
        source: "music-play",
        priority: INTERACTION_PRIORITY.context,
        cooldown: 2500,
      });
    });
    audio.addEventListener("pause", () => {
      window.clearTimeout(pauseReactionTimer);
      pauseReactionTimer = window.setTimeout(() => {
        if (!audio.ended && audio.paused) {
          requestExpression("neutral", {
            source: "music-pause",
            priority: INTERACTION_PRIORITY.context,
            cooldown: 1500,
            hold: 1800,
          });
        }
      }, 600);
    });
    audio.addEventListener("ended", () => {
      requestReaction("smile1", {
        source: "music-ended",
        priority: INTERACTION_PRIORITY.context,
        cooldown: 1000,
      });
    });
    audio.addEventListener("error", () => {
      requestReaction("unhappy", {
        source: "music-error",
        priority: INTERACTION_PRIORITY.feedback,
        cooldown: 4000,
        hold: 4200,
      });
    });
  };

  const bindAPlayerInteractions = () => {
    document.querySelectorAll(".aplayer audio").forEach(bindAudioElement);
    const players = [
      ...(Array.isArray(window.aplayers) ? window.aplayers : []),
      ...Array.from(document.querySelectorAll("meting-js"), (element) =>
        element.aplayer
      ).filter(Boolean),
    ];
    players.forEach((player) => {
      if (player.audio) bindAudioElement(player.audio);
      if (!player?.on || boundAPlayers.has(player)) return;
      boundAPlayers.add(player);
      player.on("listswitch", () => {
        requestReaction("surprise", {
          source: "music-switch",
          priority: INTERACTION_PRIORITY.context,
          cooldown: 1200,
          hold: 1800,
        });
      });
    });
  };

  const bindSiteInteractions = () => {
    ["pointerdown", "keydown", "wheel", "touchstart"].forEach((eventName) =>
      window.addEventListener(eventName, registerActivity, { passive: true })
    );
    scheduleIdle();

    document.addEventListener("pjax:complete", () => {
      reactForCurrentPage();
      bindAPlayerInteractions();
    });
    document.addEventListener("pjax:error", () => {
      requestReaction("unhappy", {
        source: "pjax-error",
        priority: INTERACTION_PRIORITY.feedback,
        cooldown: 3000,
        hold: 4200,
      });
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest("#darkmode")) return;
      window.setTimeout(() => {
        const isDark = document.documentElement.getAttribute("data-theme") === "dark";
        requestReaction(isDark ? "shy2" : "smile1", {
          source: "theme-change",
          priority: INTERACTION_PRIORITY.context,
          cooldown: 1000,
        });
      }, 180);
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        app?.stop();
        return;
      }
      app?.start();
      registerActivity();
      if (hiddenAt && Date.now() - hiddenAt > 5 * 60000) {
        requestReaction("surprise", {
          source: "visibility-return",
          priority: INTERACTION_PRIORITY.context,
          cooldown: 0,
          hold: 2400,
        });
      }
    });

    const mediaObserver = new MutationObserver(bindAPlayerInteractions);
    mediaObserver.observe(document.body, { childList: true, subtree: true });
    bindAPlayerInteractions();
  };

  const renderActionButtons = (kind, names) =>
    names
      .map(
        (name) =>
          `<button type="button" class="kurisu-menu-action" data-kind="${kind}" data-name="${name}"><span>${ACTION_LABELS[name]}</span><small>${name}</small></button>`
      )
      .join("");

  const setMenuStatus = (message) => {
    const status = contextMenu?.querySelector(".kurisu-menu-status");
    if (status) status.textContent = message;
  };

  const updateFocusButton = () => {
    const button = contextMenu?.querySelector('[data-command="toggle-focus"]');
    if (!button) return;
    button.classList.toggle("is-active", focusEnabled);
    button.querySelector("span").textContent = focusEnabled
      ? "视线跟随：开启"
      : "视线跟随：暂停";
  };

  const updateAutoInteractionButton = () => {
    const button = contextMenu?.querySelector('[data-command="toggle-auto"]');
    if (!button) return;
    button.classList.toggle("is-active", autoInteractionEnabled);
    button.querySelector("span").textContent = autoInteractionEnabled
      ? "自动互动：开启"
      : "自动互动：关闭";
  };

  const closeContextMenu = () => {
    if (!contextMenu) return;
    contextMenu.classList.remove("is-open");
    contextMenu.setAttribute("aria-hidden", "true");
  };

  const openContextMenu = (x, y) => {
    if (!contextMenu || !debugMenuEnabled) return false;
    contextMenu.classList.add("is-open");
    contextMenu.setAttribute("aria-hidden", "false");
    contextMenu.style.left = "0px";
    contextMenu.style.top = "0px";

    const rect = contextMenu.getBoundingClientRect();
    const characterRect = document
      .getElementById("kurisu-live2d-wrap")
      ?.getBoundingClientRect();
    const margin = 12;
    const besideCharacter = characterRect
      ? characterRect.left - rect.width - margin
      : x;
    const menuX =
      besideCharacter >= margin
        ? besideCharacter
        : clamp(x, margin, window.innerWidth - rect.width - margin);
    contextMenu.style.left = `${menuX}px`;
    contextMenu.style.top = `${clamp(y - 72, margin, window.innerHeight - rect.height - margin)}px`;
    return true;
  };

  const createContextMenu = (container) => {
    contextMenu = document.createElement("div");
    contextMenu.id = "kurisu-live2d-menu";
    contextMenu.setAttribute("role", "dialog");
    contextMenu.setAttribute("aria-label", "牧濑红莉栖 Live2D 控制面板");
    contextMenu.setAttribute("aria-hidden", "true");
    contextMenu.innerHTML = `
      <div class="kurisu-menu-header">
        <div><strong>Kurisu Lab</strong><small>Live2D 控制面板</small></div>
        <button type="button" class="kurisu-menu-close" data-command="close" aria-label="关闭">×</button>
      </div>
      <div class="kurisu-menu-tabs" role="tablist">
        <button type="button" class="is-active" data-panel="reaction">联动</button>
        <button type="button" data-panel="motion">动作</button>
        <button type="button" data-panel="expression">表情</button>
        <button type="button" data-panel="control">控制</button>
      </div>
      <div class="kurisu-menu-panel is-active" data-panel-content="reaction">
        <p>同时播放同名动作与表情</p>
        <div class="kurisu-menu-grid">${renderActionButtons("reaction", REACTIONS)}</div>
      </div>
      <div class="kurisu-menu-panel" data-panel-content="motion">
        <p>只播放身体动作，不改变当前表情</p>
        <div class="kurisu-menu-grid">${renderActionButtons("motion", MOTION_GROUPS)}</div>
      </div>
      <div class="kurisu-menu-panel" data-panel-content="expression">
        <p>只改变面部表情</p>
        <div class="kurisu-menu-grid">${renderActionButtons("expression", EXPRESSIONS)}</div>
      </div>
      <div class="kurisu-menu-panel" data-panel-content="control">
        <p>用于独立检查视线和状态恢复</p>
        <div class="kurisu-menu-controls">
          <button type="button" data-command="toggle-auto"><span>自动互动：开启</span><small>automation</small></button>
          <button type="button" data-command="toggle-focus"><span>视线跟随：开启</span><small>focus</small></button>
          <button type="button" data-command="center-focus"><span>注视正前方</span><small>focus(0, 0)</small></button>
          <button type="button" data-command="reset-expression"><span>恢复默认表情</span><small>resetExpression</small></button>
          <button type="button" data-command="random-motion"><span>随机动作</span><small>random1–5</small></button>
        </div>
      </div>
      <div class="kurisu-menu-footer">
        <span class="kurisu-menu-status">右键角色区域可再次打开</span>
        <kbd>Esc</kbd>
      </div>`;
    document.body.appendChild(contextMenu);

    contextMenu.addEventListener("contextmenu", (event) => event.preventDefault());
    contextMenu.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-panel]");
      if (tab) {
        const panelName = tab.dataset.panel;
        contextMenu
          .querySelectorAll("[data-panel]")
          .forEach((item) => item.classList.toggle("is-active", item === tab));
        contextMenu
          .querySelectorAll("[data-panel-content]")
          .forEach((panel) =>
            panel.classList.toggle(
              "is-active",
              panel.dataset.panelContent === panelName
            )
          );
        return;
      }

      const action = event.target.closest("[data-kind][data-name]");
      if (action) {
        const { kind, name } = action.dataset;
        const succeeded =
          kind === "reaction"
            ? requestReaction(name, manualOptions(`menu-reaction-${name}`))
            : kind === "motion"
              ? requestMotion(name, manualOptions(`menu-motion-${name}`))
              : requestExpression(name, manualOptions(`menu-expression-${name}`));
        setMenuStatus(
          succeeded
            ? `已触发：${ACTION_LABELS[name]} · ${kind}`
            : "模型尚未准备完成"
        );
        return;
      }

      const command = event.target.closest("[data-command]")?.dataset.command;
      if (command === "close") closeContextMenu();
      if (command === "toggle-auto") {
        autoInteractionEnabled = !autoInteractionEnabled;
        try {
          localStorage.setItem(
            "kurisu-auto-interaction",
            autoInteractionEnabled ? "on" : "off"
          );
        } catch (_error) {
          // Preference remains valid for the current page when storage is unavailable.
        }
        updateAutoInteractionButton();
        if (autoInteractionEnabled) registerActivity();
        setMenuStatus(
          autoInteractionEnabled ? "自动互动已开启" : "自动互动已关闭"
        );
      }
      if (command === "toggle-focus") {
        focusEnabled = !focusEnabled;
        updateFocusButton();
        if (focusEnabled) updateFocus(container);
        setMenuStatus(focusEnabled ? "视线跟随已开启" : "视线跟随已暂停");
      }
      if (command === "center-focus") {
        focusEnabled = false;
        model?.internalModel?.focusController?.focus(0, 0);
        updateFocusButton();
        setMenuStatus("已转向正前方；视线跟随已暂停");
      }
      if (command === "reset-expression") {
        resetExpressionDirect();
        activePriority = 0;
        activeUntil = 0;
        setMenuStatus("已恢复默认表情");
      }
      if (command === "random-motion") {
        const randomName = pickIdleMotion();
        requestMotion(randomName, manualOptions("menu-random-motion"));
        setMenuStatus(`已触发：${ACTION_LABELS[randomName]}`);
      }
    });

    document.addEventListener("contextmenu", (event) => {
      if (!debugMenuEnabled) return;
      const rect = container.getBoundingClientRect();
      const inCharacterArea =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (!inCharacterArea || !model) return;
      event.preventDefault();
      openContextMenu(event.clientX, event.clientY);
    });
    document.addEventListener("pointerdown", (event) => {
      if (contextMenu?.classList.contains("is-open") && !contextMenu.contains(event.target)) {
        closeContextMenu();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeContextMenu();
      if (
        debugMenuEnabled &&
        (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
      ) {
        event.preventDefault();
        const rect = container.getBoundingClientRect();
        openContextMenu(
          rect.left + rect.width * HEAD_ANCHOR.x,
          rect.top + rect.height * HEAD_ANCHOR.y
        );
      }
    });
    window.addEventListener("resize", closeContextMenu, { passive: true });
    window.addEventListener("scroll", closeContextMenu, {
      passive: true,
      capture: true,
    });
  };

  window.kurisuLive2d = {
    get ready() {
      return Boolean(model);
    },
    get motions() {
      return [...MOTION_GROUPS];
    },
    get expressions() {
      return [...EXPRESSIONS];
    },
    get focusEnabled() {
      return focusEnabled;
    },
    get autoInteractionEnabled() {
      return autoInteractionEnabled;
    },
    get debugMenuEnabled() {
      return debugMenuEnabled;
    },
    setDebugMenuEnabled(enabled) {
      debugMenuEnabled = Boolean(enabled);
      try {
        sessionStorage.setItem(
          "kurisu-debug-menu",
          debugMenuEnabled ? "on" : "off"
        );
      } catch (_error) {
        // Debug state remains valid for the current document.
      }
      if (!debugMenuEnabled) closeContextMenu();
      return debugMenuEnabled;
    },
    openDebugMenu() {
      if (!debugMenuEnabled) return false;
      const container = document.getElementById("kurisu-live2d-wrap");
      if (!container) return false;
      const rect = container.getBoundingClientRect();
      return openContextMenu(
        rect.left + rect.width * HEAD_ANCHOR.x,
        rect.top + rect.height * HEAD_ANCHOR.y
      );
    },
    setAutoInteractionEnabled(enabled) {
      autoInteractionEnabled = Boolean(enabled);
      updateAutoInteractionButton();
      return autoInteractionEnabled;
    },
    setFocusEnabled(enabled) {
      focusEnabled = Boolean(enabled);
      updateFocusButton();
      return focusEnabled;
    },
    playMotion(group, index = 0) {
      return playMotionDirect(group, index);
    },
    setExpression(name) {
      return setExpressionDirect(name);
    },
    resetExpression() {
      return resetExpressionDirect();
    },
    react(name) {
      if (!model) return false;
      const expressionChanged = EXPRESSIONS.includes(name)
        ? setExpressionDirect(name)
        : false;
      const motionPlayed = MOTION_GROUPS.includes(name)
        ? playMotionDirect(name)
        : false;
      return expressionChanged || motionPlayed;
    },
    trigger(name, options = {}) {
      return requestReaction(name, options);
    },
    triggerMotion(name, options = {}) {
      return requestMotion(name, options);
    },
    triggerExpression(name, options = {}) {
      return requestExpression(name, options);
    },
  };

  const init = async () => {
    if (
      window.innerWidth < MIN_DESKTOP_WIDTH ||
      document.getElementById("kurisu-live2d-wrap")
    ) {
      return;
    }

    const Live2DModel = window.PIXI?.live2d?.Live2DModel;
    if (!window.PIXI || !Live2DModel || !window.Live2DCubismCore) {
      console.warn("Kurisu Live2D: renderer dependencies are unavailable.");
      return;
    }

    try {
      autoInteractionEnabled =
        localStorage.getItem("kurisu-auto-interaction") !== "off";
      const storedDebugPreference = sessionStorage.getItem("kurisu-debug-menu");
      if (storedDebugPreference) {
        debugMenuEnabled = storedDebugPreference === "on";
      }
    } catch (_error) {
      autoInteractionEnabled = true;
    }

    const container = document.createElement("div");
    container.id = "kurisu-live2d-wrap";
    container.setAttribute("aria-hidden", "true");

    const canvas = document.createElement("canvas");
    canvas.id = "kurisu-live2d-canvas";
    container.appendChild(canvas);
    ["head", "body"].forEach((area) => {
      const hitArea = document.createElement("div");
      hitArea.className = `kurisu-live2d-hitbox kurisu-live2d-hitbox-${area}`;
      hitArea.dataset.kurisuHit = area;
      container.appendChild(hitArea);
    });
    document.body.appendChild(container);
    createContextMenu(container);
    updateAutoInteractionButton();
    bindCharacterHitAreas(container);

    try {
      app = new window.PIXI.Application({
        view: canvas,
        resizeTo: container,
        autoStart: true,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        backgroundAlpha: 0,
      });

      model = await Live2DModel.from(MODEL_URL, {
        autoInteract: false,
      });

      app.stage.addChild(model);
      fitModel(container);
      updateFocus(container);
      container.classList.add("is-ready");
      bindSiteInteractions();
      runVisitGreeting();
      reactForCurrentPage({ initial: true });
      window.dispatchEvent(
        new CustomEvent("kurisu-live2d:ready", {
          detail: window.kurisuLive2d,
        })
      );

      window.addEventListener(
        "pointermove",
        (event) => {
          pointerX = event.clientX;
          pointerY = event.clientY;
          if (!framePending) {
            framePending = true;
            requestAnimationFrame(() => updateFocus(container));
          }
        },
        { passive: true }
      );

      window.addEventListener("resize", () => fitModel(container), {
        passive: true,
      });
    } catch (error) {
      console.error("Kurisu Live2D failed to load:", error);
      app?.destroy(true);
      app = undefined;
      model = undefined;
      container.remove();
      contextMenu?.remove();
      contextMenu = undefined;
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
