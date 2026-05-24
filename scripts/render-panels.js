"use strict";

function renderPlayerInfo(slot, target) {
  target.innerHTML = "";

  const header = document.createElement("div");
  header.className = "player-readout-header";

  const title = document.createElement("h2");
  const order = playerOrderLabel(slot);
  title.textContent = `${playerLabel(slot)}（${order}${state.turn === slot ? "・行動中" : ""}）`;
  header.appendChild(title);

  if (target === els.opponentInfo) {
    const status = document.createElement("span");
    status.className = `connection-readout-status ${headerConnectionType()}`.trim();
    status.textContent = headerConnectionStatus();
    header.appendChild(status);
  }

  target.appendChild(header);

  if (target === els.opponentInfo && roomSync.connected && assignedLocalSlot()) {
    const statusDetail = document.createElement("p");
    statusDetail.className = "connection-readout-detail";
    statusDetail.textContent = seatStatusText();
    target.appendChild(statusDetail);
  }
}

function renderReadoutConnectionStatus() {
  const status = els.opponentInfo?.querySelector(".connection-readout-status");
  if (!status) return;
  status.textContent = headerConnectionStatus();
  status.className = `connection-readout-status ${headerConnectionType()}`.trim();
}

function renderPendingButtons() {
  els.pendingButtons.innerHTML = "";
  const bottomSlot = displayBottomSlot();
  const visualOrder = [opponentOf(bottomSlot), bottomSlot];
  const groups = visualOrder.filter((slot) => state.players[slot].pending.length);
  els.pendingButtons.parentElement.dataset.emptyPending = groups.length ? "false" : "true";
  els.pendingButtons.dataset.groupCount = String(groups.length);

  if (!groups.length) {
    const empty = document.createElement("span");
    empty.className = "pending-empty";
    empty.textContent = "保留なし";
    els.pendingButtons.appendChild(empty);
    return;
  }

  groups.forEach((slot) => {
    const cards = state.players[slot].pending;
    const group = document.createElement("article");
    group.className = `pending-group pending-${slot}`;

    const label = document.createElement("button");
    label.type = "button";
    label.className = "pending-label";
    label.textContent = `${playerLabel(slot)} 保留 ${cards.length}`;
    label.addEventListener("click", (event) => {
      event.stopPropagation();
      openZoneBrowse(slot, "pending");
    });
    group.appendChild(label);

    const row = document.createElement("div");
    row.className = "pending-card-row";
    cards.forEach((card) => {
      row.appendChild(renderCard(slot, "pending", card, true, "非公開"));
    });
    group.appendChild(row);
    els.pendingButtons.appendChild(group);
  });
}

function renderHandPanel() {
  const slot = state.viewer;
  const hand = state.players[slot].hand;
  els.handPanel.innerHTML = "";
  els.handPanel.dataset.empty = hand.length ? "" : "true";

  if (!hand.length) {
    els.handPanel.textContent = "手札なし";
    return;
  }

  hand.forEach((card) => {
    els.handPanel.appendChild(renderCard(slot, "hand", card, true, "非公開", "compact"));
  });
}

function renderSelectedPreview() {
  const refs = selectedRefsWithCards();
  els.selectedPreview.innerHTML = "";
  els.selectedPreviewSection.hidden = refs.length === 0;
  if (!refs.length) return;

  els.selectedPreview.className = `selected-preview ${
    refs.length > 1 ? "is-multiple" : "is-single"
  }`;
  refs.forEach(({ ref, card }, index) => {
    const stackCards = stackGroupCards(card);
    const previewIndex = stackPreviewIndex(ref, stackCards);
    const previewCard = stackCards[previewIndex] || card;
    const visible = canShowCard(ref.owner, ref.zone, previewCard);
    const item = document.createElement("article");
    item.className = "selected-preview-card";
    item.addEventListener("click", (event) => event.stopPropagation());

    const media = document.createElement("div");
    media.className = "selected-preview-media";
    if (visible && previewCard.imageUrl) {
      const image = document.createElement("img");
      image.src = previewCard.imageUrl;
      image.alt = previewCard.name;
      media.appendChild(image);
    } else {
      const fallback = document.createElement("div");
      fallback.className = visible ? "selected-preview-fallback" : "selected-preview-back";
      fallback.textContent = visible ? previewCard.name : "非公開カード";
      media.appendChild(fallback);
    }

    if (refs.length > 1) {
      const order = document.createElement("span");
      order.className = "selected-preview-order";
      order.textContent = index + 1;
      media.appendChild(order);
    }

    const meta = document.createElement("p");
    meta.textContent = `${playerLabel(ref.owner)} / ${zoneLabel(ref.zone)}`;

    item.appendChild(media);
    if (stackCards.length > 1) {
      item.appendChild(renderPreviewStackList(ref, stackCards, previewIndex));
    } else {
      const name = document.createElement("h3");
      name.textContent = visible ? previewCard.name : "非公開カード";
      item.appendChild(name);
    }
    item.appendChild(meta);
    els.selectedPreview.appendChild(item);
  });
}

function stackPreviewKey(ref) {
  return `${ref.owner}:${ref.zone}:${ref.uid}`;
}

function stackPreviewIndex(ref, cards) {
  const key = stackPreviewKey(ref);
  const maxIndex = Math.max(cards.length - 1, 0);
  const index = Math.max(0, Math.min(uiState.stackPreviewIndexes[key] || 0, maxIndex));
  uiState.stackPreviewIndexes[key] = index;
  return index;
}

function setStackPreviewIndex(ref, index) {
  uiState.stackPreviewIndexes[stackPreviewKey(ref)] = Math.max(0, index);
  render();
}

function renderPreviewStackList(ref, cards, activeIndex) {
  const wrap = document.createElement("div");
  wrap.className = "selected-preview-stack-list";

  const controls = document.createElement("div");
  controls.className = "selected-preview-stack-controls";
  controls.appendChild(
    actionButton("表示↑", () => setStackPreviewIndex(ref, activeIndex - 1), activeIndex <= 0),
  );
  controls.appendChild(
    actionButton(
      "表示↓",
      () => setStackPreviewIndex(ref, activeIndex + 1),
      activeIndex >= cards.length - 1,
    ),
  );
  wrap.appendChild(controls);

  cards.forEach((stackCard, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `selected-preview-stack-name${index === activeIndex ? " active" : ""}`;
    const name = canShowCard(ref.owner, ref.zone, stackCard) ? stackCard.name : "非公開カード";
    button.textContent = `${index + 1}. ${name}${index === activeIndex ? "（表示中）" : ""}`;
    button.addEventListener("click", () => setStackPreviewIndex(ref, index));
    wrap.appendChild(button);
  });

  return wrap;
}

function renderSelection() {
  const panel = els.selectionPanel;
  panel.innerHTML = "";

  const refs = selectedRefsWithCards();
  if (state.handMenuOwner) {
    renderHandDisruptionChoice(panel);
    return;
  }

  if (state.deckMenuOwner) {
    renderDeckMenuChoice(panel);
    return;
  }

  if (state.pendingShieldCheckReveal) {
    if (canResolveShieldCheck()) {
      renderShieldCheckRevealChoice(panel);
    } else {
      renderShieldCheckWaiting(panel);
    }
    return;
  }

  if (!refs.length) {
    panel.className = "selection-panel muted";
    panel.textContent = "カードを選択してください。";
    return;
  }

  if (state.pendingShieldAction) {
    renderShieldFaceChoice(panel, refs);
    return;
  }

  if (state.pendingDeckAction) {
    renderDeckPositionChoice(panel, refs);
    return;
  }

  panel.className = "selection-panel is-selected";
  const title = document.createElement("p");
  title.className = "selection-title";
  title.textContent = `${refs.length}枚選択中`;
  panel.appendChild(title);

  const meta = document.createElement("p");
  meta.className = "selection-meta";
  const zones = [...new Set(refs.map(({ ref }) => zoneLabel(ref.zone)))].join(" / ");
  meta.textContent = `${playerLabel(refs[0].ref.owner)} / ${zones}`;
  panel.appendChild(meta);

  panel.appendChild(renderSelectedCardsSummary(refs));

  const actions = document.createElement("div");
  actions.className = "selection-actions";
  getBatchSelectionActions(refs).forEach(([actionKey, label]) => {
    const onClick = () => runSelectionAction(actionKey, refs);
    const button = actionButton(label, onClick);
    const actionClass = zoneActionClass(actionKey);
    if (actionClass) button.classList.add(actionClass);
    actions.appendChild(button);
  });
  if (refs.some(({ ref, card }) => canToggleTapped(ref.zone, card))) {
    const shouldTap = refs.some(({ card }) => !card.tapped);
    actions.appendChild(actionButton(shouldTap ? "タップ" : "アンタップ", toggleTapped));
  }
  panel.appendChild(actions);

  if (refs.length === 1 && refs[0].card.stack?.length) {
    panel.appendChild(renderStackEditor(refs[0].ref, refs[0].card));
  }
}

function runSelectionAction(actionKey, refs) {
  if (actionKey === "shield-check-reveal") {
    revealSelectedShieldCheckCards();
    return;
  }
  if (actionKey === "deck-browse-reveal") {
    revealSelectedDeckBrowseCards(refs);
    return;
  }
  if (actionKey === "hand-browse-reveal") {
    revealSelectedHandBrowseCards(refs);
    return;
  }
  if (actionKey === "shield-look") {
    openSelectedShieldBrowse(refs);
    return;
  }
  if (actionKey === "shield-face-up") {
    faceUpSelectedShields(refs);
    return;
  }
  if (actionKey === "stack-selected") {
    stackSelectedBattleCards(refs);
    return;
  }
  if (actionKey === "add-seal") {
    addSealToSelectedBattleCards(refs);
    return;
  }
  if (actionKey === "remove-seal") {
    removeSealFromSelectedBattleCards(refs);
    return;
  }
  if (actionKey.startsWith("deck-") || actionKey === "gachinko-judge") {
    runSelectedDeckAction(actionKey, refs);
    return;
  }
  moveSelectedTo(actionKey);
}

function renderHandDisruptionChoice(panel) {
  const owner = state.handMenuOwner;
  const handCount = state.players[owner].hand.length;
  panel.className = "selection-panel hand-disruption-choice";

  const title = document.createElement("p");
  title.className = "selection-title";
  title.textContent = `${playerLabel(owner)}の手札`;
  panel.appendChild(title);

  const meta = document.createElement("p");
  meta.className = "selection-meta";
  meta.textContent = `手札 ${handCount}枚`;
  panel.appendChild(meta);

  const stepper = document.createElement("label");
  stepper.className = "number-stepper";
  const label = document.createElement("span");
  label.textContent = "枚数";
  const input = document.createElement("input");
  input.id = "handDiscardCountInput";
  input.type = "number";
  input.min = "1";
  input.max = "20";
  input.value = "1";
  stepper.appendChild(label);
  stepper.appendChild(input);
  panel.appendChild(stepper);

  const actions = document.createElement("div");
  actions.className = "selection-actions";
  const discardButton = actionButton("見ないで捨てる", () =>
    discardBlindHandCards(owner, handDiscardCount()),
  );
  discardButton.classList.add("zone-action-hand");
  const peekButton = actionButton("見る", () => openHandPeek(owner));
  peekButton.classList.add("zone-action-hand");
  actions.appendChild(discardButton);
  actions.appendChild(peekButton);
  panel.appendChild(actions);
}

function renderDeckMenuChoice(panel) {
  const owner = state.deckMenuOwner;
  const deckCount = state.players[owner].deck.length;
  panel.className = "selection-panel deck-menu-choice";

  const title = document.createElement("p");
  title.className = "selection-title";
  title.textContent = `${playerLabel(owner)}の山札`;
  panel.appendChild(title);

  const meta = document.createElement("p");
  meta.className = "selection-meta";
  meta.textContent = `山札 ${deckCount}枚`;
  panel.appendChild(meta);

  const stepper = document.createElement("label");
  stepper.className = "number-stepper with-fill";
  const label = document.createElement("span");
  label.textContent = "枚数";
  const input = document.createElement("input");
  input.id = "deckCountInput";
  input.type = "number";
  input.min = "1";
  input.max = String(Math.max(deckCount, 1));
  input.value = "1";
  const fillButton = document.createElement("button");
  fillButton.type = "button";
  fillButton.textContent = "全部";
  fillButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    input.value = String(deckCount);
  });
  stepper.appendChild(label);
  stepper.appendChild(input);
  stepper.appendChild(fillButton);
  panel.appendChild(stepper);

  const actions = document.createElement("div");
  actions.className = "selection-actions";
  getSelectionActions("deck").forEach(([actionKey, labelText]) => {
    const button = actionButton(labelText, () => runDeckMenuAction(actionKey, owner));
    const actionClass = zoneActionClass(actionKey);
    if (actionClass) button.classList.add(actionClass);
    actions.appendChild(button);
  });
  panel.appendChild(actions);
}

function renderShieldFaceChoice(panel, refs) {
  panel.className = "selection-panel shield-choice";
  const title = document.createElement("p");
  title.className = "selection-title";
  title.textContent = `${refs.length}枚をシールドへ`;
  panel.appendChild(title);

  const meta = document.createElement("p");
  meta.className = "selection-meta";
  meta.textContent = "置き方を選択してください。";
  panel.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "selection-actions";
  const commit = (faceUp) => moveSelectedTo("shields", { faceUp });
  actions.appendChild(actionButton("表向き", () => commit(true)));
  actions.appendChild(actionButton("裏向き", () => commit(false)));
  actions.appendChild(
    cancelActionButton(() => {
      state.pendingShieldAction = null;
      render();
    }),
  );
  panel.appendChild(actions);
}

function renderShieldCheckRevealChoice(panel) {
  const owner = state.pendingShieldCheckReveal.owner;
  const refs = selectedRefsWithCards().filter(
    ({ ref }) => ref.owner === owner && ref.zone === "shieldCheck",
  );
  panel.className = "selection-panel shield-check-choice";

  const title = document.createElement("p");
  title.className = "selection-title";
  title.textContent = "シールドチェック";
  panel.appendChild(title);

  const meta = document.createElement("p");
  meta.className = "selection-meta";
  meta.textContent = `${playerLabel(owner)}のシールドチェック`;
  panel.appendChild(meta);

  if (refs.length) {
    panel.appendChild(renderSelectedCardsSummary(refs));
  }

  const actions = document.createElement("div");
  actions.className = "selection-actions";
  const okButton = actionButton("OK", revealSelectedShieldCheckCards);
  actions.appendChild(okButton);
  panel.appendChild(actions);
}

function renderShieldCheckWaiting(panel) {
  const owner = state.pendingShieldCheckReveal.owner;
  panel.className = "selection-panel muted shield-check-choice";

  const title = document.createElement("p");
  title.className = "selection-title";
  title.textContent = "シールドチェック待機中";
  panel.appendChild(title);

  const meta = document.createElement("p");
  meta.className = "selection-meta";
  meta.textContent = `${playerLabel(owner)}が開示するカードを選択しています。`;
  panel.appendChild(meta);
}

function renderDeckPositionChoice(panel, refs) {
  panel.className = "selection-panel deck-choice";
  const title = document.createElement("p");
  title.className = "selection-title";
  title.textContent = `${refs.length}枚を山札へ`;
  panel.appendChild(title);

  const meta = document.createElement("p");
  meta.className = "selection-meta";
  meta.textContent = "置く場所を選択してください。";
  panel.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "selection-actions";
  actions.appendChild(actionButton("上", () => moveSelectedTo("deck", { position: "top" })));
  actions.appendChild(actionButton("下", () => moveSelectedTo("deck", { position: "bottom" })));
  actions.appendChild(
    cancelActionButton(() => {
      state.pendingDeckAction = null;
      render();
    }),
  );
  panel.appendChild(actions);
}

function renderSelectedCardsSummary(refs) {
  const list = document.createElement("div");
  list.className = "selected-card-list";
  refs.forEach(({ ref, card }, index) => {
    const item = document.createElement("button");
    item.className = "selected-card-pill";
    item.type = "button";
    const label = canShowCard(ref.owner, ref.zone, card) ? card.name : "非公開カード";
    item.textContent = `${index + 1}. ${label}`;
    item.addEventListener("click", () => {
      toggleSelection(ref);
      render();
    });
    list.appendChild(item);
  });
  return list;
}

function renderStackEditor(ref, card) {
  const wrap = document.createElement("div");
  wrap.className = "stack-editor";

  const title = document.createElement("h3");
  title.textContent = "重なっているカード";
  wrap.appendChild(title);

  stackGroupCards(card).forEach((stackedCard, index, cards) => {
    const row = document.createElement("div");
    row.className = "stack-row";
    const order = document.createElement("span");
    order.className = "stack-order";
    order.textContent = index + 1;
    row.appendChild(order);
    const name = document.createElement("span");
    name.className = "stack-name";
    name.textContent = canShowCard(ref.owner, ref.zone, stackedCard)
      ? stackedCard.name
      : "非公開カード";
    row.appendChild(name);
    row.appendChild(
      actionButton("上へ", () => reorderStackCard(ref, index, -1), index === 0),
    );
    row.appendChild(
      actionButton("下へ", () => reorderStackCard(ref, index, 1), index === cards.length - 1),
    );
    row.appendChild(actionButton("外す", () => detachStackCard(ref, index), cards.length <= 1));
    wrap.appendChild(row);
  });

  return wrap;
}

function renderLog() {
  els.logList.innerHTML = "";
  state.log
    .slice(-40)
    .reverse()
    .forEach((entry, index) => {
      const li = document.createElement("li");
      li.setAttribute("value", state.log.length - index);
      li.textContent = formatLogEntry(entry);
      els.logList.appendChild(li);
    });
  els.logList.scrollTop = 0;
}

function renderStatus() {
  const ready = Object.keys(PLAYERS).some((slot) => state.decks[slot]) || hasStartedGameState();
  const turnLabel = playerLabel(state.turn);
  const orderLabel = playerOrderLabel(state.turn);
  const extraTurnText = state.extraTurns[state.turn] ? ` EX+${state.extraTurns[state.turn]}` : "";
  els.turnBadge.textContent =
    ready
      ? `${turnLabel}（${orderLabel}） ${state.turnCount[state.turn]}ターン目${extraTurnText}`
      : "待機中";
  const latestAction = latestLogMessage();
  els.statusText.textContent =
    ready
      ? latestAction
        ? `最新: ${latestAction}`
        : `${turnLabel}のターンです。`
      : "デッキZIPを読み込んで開始できます。";
  els.undoButton.disabled = !state.undoStack.length;
}
