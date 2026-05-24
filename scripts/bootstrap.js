"use strict";

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  bindEvents();
  initFirebase();
  restoreDecks().finally(() => render());
});

function bindElements() {
  els.menuButton = document.querySelector("#menuButton");
  els.menuCloseButton = document.querySelector("#menuCloseButton");
  els.menuBackdrop = document.querySelector("#menuBackdrop");
  els.appMenu = document.querySelector("#appMenu");
  els.resetButton = document.querySelector("#resetButton");
  els.setupButton = document.querySelector("#setupButton");
  els.untapButton = document.querySelector("#untapButton");
  els.undoButton = document.querySelector("#undoButton");
  els.endTurnButton = document.querySelector("#endTurnButton");
  els.extraTurnButton = document.querySelector("#extraTurnButton");
  els.viewerSelect = document.querySelector("#viewerSelect");
  els.selectionPanel = document.querySelector("#selectionPanel");
  els.selectedPreviewSection = document.querySelector("#selectedPreviewSection");
  els.selectedPreview = document.querySelector("#selectedPreview");
  els.logList = document.querySelector("#logList");
  els.statusText = document.querySelector("#statusText");
  els.pendingButtons = document.querySelector("#pendingButtons");
  els.revealLayer = document.querySelector("#revealLayer");
  els.revealArea = document.querySelector("#revealArea");
  els.turnBadge = document.querySelector("#turnBadge");
  els.selfInfo = document.querySelector("#selfInfo");
  els.opponentInfo = document.querySelector("#opponentInfo");
  els.handPanel = document.querySelector("#handPanel");
  els.drawButton = document.querySelector("#drawButton");
  els.roomIdInput = document.querySelector("#roomIdInput");
  els.seatStatus = document.querySelector("#seatStatus");
  els.swapDecksButton = document.querySelector("#swapDecksButton");
  els.randomSeatButton = document.querySelector("#randomSeatButton");
  els.claimFirstButton = document.querySelector("#claimFirstButton");
  els.claimSecondButton = document.querySelector("#claimSecondButton");
  els.joinRoomButton = document.querySelector("#joinRoomButton");
  els.leaveRoomButton = document.querySelector("#leaveRoomButton");
  els.syncStatus = document.querySelector("#syncStatus");

  Object.keys(PLAYERS).forEach((slot) => {
    els[`zipInput-${slot}`] = document.querySelector(`#zipInput-${slot}`);
    els[`deckName-${slot}`] = document.querySelector(`#deckName-${slot}`);
    els[`lane-${slot}`] = document.querySelector(`#${PLAYERS[slot].laneId}`);
  });
}

function bindEvents() {
  Object.keys(PLAYERS).forEach((slot) => {
    els[`zipInput-${slot}`].addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const targetSlot = deckInputTargetSlot(slot);
        await importZipDeck(slot, file);
        pushLog(`${actionPlayerLabel(targetSlot)}のデッキを読み込みました`);
      } catch (error) {
        console.error(error);
        pushLog(`読込エラー: ${error.message}`);
        alert(error.message);
      } finally {
        event.target.value = "";
        render();
      }
    });
  });

  els.viewerSelect.addEventListener("change", (event) => {
    if (roomSync.connected) {
      state.viewer = assignedLocalSlot() || "self";
      render();
      return;
    }
    roomSync.lastLocalSlot = "";
    state.viewer = event.target.value;
    clearSelection();
    render();
  });

  els.setupButton.addEventListener("click", setupGame);
  els.untapButton.addEventListener("click", () => untapPlayer(state.turn));
  els.undoButton.addEventListener("click", undoLastAction);
  els.endTurnButton.addEventListener("click", endTurn);
  els.extraTurnButton.addEventListener("click", addExtraTurn);
  els.resetButton.addEventListener("click", resetGame);
  els.drawButton.addEventListener("click", () => drawCards(state.viewer, 1));
  els.swapDecksButton.addEventListener("click", swapLoadedDecks);
  els.joinRoomButton.addEventListener("click", connectRoom);
  els.leaveRoomButton.addEventListener("click", disconnectRoom);
  els.randomSeatButton.addEventListener("click", () => runRoomAction(randomizeFirstPlayer));
  els.claimFirstButton.addEventListener("click", () =>
    runRoomAction(() => chooseFirstPlayer(assignedLocalSlot())),
  );
  els.claimSecondButton.addEventListener("click", () =>
    runRoomAction(() => chooseFirstPlayer(opponentOf(assignedLocalSlot()))),
  );
  els.menuButton.addEventListener("click", toggleMenu);
  els.menuCloseButton.addEventListener("click", closeMenu);
  els.menuBackdrop.addEventListener("click", closeMenu);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });
  document.addEventListener("click", handleDocumentClick);
  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", handlePointerUp);
}

function toggleMenu() {
  if (els.appMenu.hidden) {
    openMenu();
    return;
  }
  closeMenu();
}

function openMenu() {
  els.appMenu.hidden = false;
  els.menuBackdrop.hidden = false;
  els.menuButton.setAttribute("aria-expanded", "true");
}

function closeMenu() {
  if (!els.appMenu || els.appMenu.hidden) return;
  els.appMenu.hidden = true;
  els.menuBackdrop.hidden = true;
  els.menuButton.setAttribute("aria-expanded", "false");
}
