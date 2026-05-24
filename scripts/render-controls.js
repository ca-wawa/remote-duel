"use strict";

function hasStartedGameState() {
  return Object.values(state.players).some((player) =>
    ["deck", "hand", "shields", "mana", "battle", "graveyard", "pending", "revealed"].some(
      (zone) => player[zone]?.length,
    ),
  );
}

function latestLogMessage() {
  const latest = state.log[state.log.length - 1] || "";
  return formatLogEntry(latest).replace(/^\d{1,2}:\d{2}:\d{2}\s+/, "");
}

function actionButton(label, onClick, disabled = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

function cancelActionButton(onClick) {
  const button = actionButton("キャンセル", onClick);
  button.classList.add("cancel-button");
  return button;
}

function zoneActionClass(actionKey) {
  return (
    {
      battle: "zone-action-battle",
      hand: "zone-action-hand",
      mana: "zone-action-mana",
      shields: "zone-action-shields",
      graveyard: "zone-action-graveyard",
      pending: "zone-action-pending",
      "deck-browse-reveal": "zone-action-deck",
      "deck-draw": "zone-action-hand",
      "deck-shield": "zone-action-shields",
      "deck-mill": "zone-action-graveyard",
      "deck-look": "zone-action-deck",
      "shield-look": "zone-action-shields",
      "shield-face-up": "zone-action-shields",
      "stack-selected": "zone-action-battle",
      "add-seal": "zone-action-battle",
      "remove-seal": "zone-action-graveyard",
      "hand-browse-reveal": "zone-action-hand",
      "deck-mana": "zone-action-mana",
    }[actionKey] || ""
  );
}
