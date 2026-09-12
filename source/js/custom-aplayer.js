(() => {
  const initializedPlayers = new WeakSet();
  let observer = null;
  let stopTimer = null;

  const initializePlayers = () => {
    const players = document.querySelectorAll(".aplayer.aplayer-fixed");
    let foundFixedPlayer = players.length > 0;

    players.forEach((player) => {
      if (initializedPlayers.has(player)) {
        return;
      }

      const lyricButton = player.querySelector(".aplayer-icon-lrc");

      if (!lyricButton) {
        foundFixedPlayer = false;
        return;
      }

      initializedPlayers.add(player);
      lyricButton.click();
    });

    if (foundFixedPlayer) {
      observer?.disconnect();
      observer = null;
      window.clearTimeout(stopTimer);
      stopTimer = null;
    }

    return foundFixedPlayer;
  };

  const watchForPlayer = () => {
    if (initializePlayers() || observer) {
      return;
    }

    observer = new MutationObserver(initializePlayers);
    observer.observe(document.body, { childList: true, subtree: true });

    stopTimer = window.setTimeout(() => {
      observer?.disconnect();
      observer = null;
      stopTimer = null;
    }, 10000);
  };

  watchForPlayer();
  document.addEventListener("pjax:complete", watchForPlayer);
})();
