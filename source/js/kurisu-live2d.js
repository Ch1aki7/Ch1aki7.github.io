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

  let app;
  let model;
  let contextMenu;
  let framePending = false;
  let focusEnabled = true;
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

  const closeContextMenu = () => {
    if (!contextMenu) return;
    contextMenu.classList.remove("is-open");
    contextMenu.setAttribute("aria-hidden", "true");
  };

  const openContextMenu = (x, y) => {
    if (!contextMenu) return;
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
            ? window.kurisuLive2d.react(name)
            : kind === "motion"
              ? window.kurisuLive2d.playMotion(name)
              : window.kurisuLive2d.setExpression(name);
        setMenuStatus(
          succeeded
            ? `已触发：${ACTION_LABELS[name]} · ${kind}`
            : "模型尚未准备完成"
        );
        return;
      }

      const command = event.target.closest("[data-command]")?.dataset.command;
      if (command === "close") closeContextMenu();
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
        window.kurisuLive2d.resetExpression();
        setMenuStatus("已恢复默认表情");
      }
      if (command === "random-motion") {
        const randomName = `random${Math.floor(Math.random() * 5) + 1}`;
        window.kurisuLive2d.playMotion(randomName);
        setMenuStatus(`已触发：${ACTION_LABELS[randomName]}`);
      }
    });

    document.addEventListener("contextmenu", (event) => {
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
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
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
    setFocusEnabled(enabled) {
      focusEnabled = Boolean(enabled);
      updateFocusButton();
      return focusEnabled;
    },
    playMotion(group, index = 0) {
      if (!model || !MOTION_GROUPS.includes(group)) return false;
      const priority = window.PIXI.live2d.MotionPriority.FORCE;
      model.motion(group, index, priority);
      return true;
    },
    setExpression(name) {
      if (!model || !EXPRESSIONS.includes(name)) return false;
      model.expression(name);
      return true;
    },
    resetExpression() {
      const manager =
        model?.internalModel?.motionManager?.expressionManager;
      if (!manager) return false;
      manager.resetExpression();
      return true;
    },
    react(name) {
      if (!model) return false;
      const expressionChanged = EXPRESSIONS.includes(name)
        ? this.setExpression(name)
        : false;
      const motionPlayed = MOTION_GROUPS.includes(name)
        ? this.playMotion(name)
        : false;
      return expressionChanged || motionPlayed;
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

    const container = document.createElement("div");
    container.id = "kurisu-live2d-wrap";
    container.setAttribute("aria-hidden", "true");

    const canvas = document.createElement("canvas");
    canvas.id = "kurisu-live2d-canvas";
    container.appendChild(canvas);
    document.body.appendChild(container);
    createContextMenu(container);

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
