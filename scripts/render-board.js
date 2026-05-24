"use strict";

function render() {
  enforceLocalPerspective();
  renderViewerLabels();
  els.viewerSelect.value = state.viewer;

  Object.keys(PLAYERS).forEach((slot) => {
    els[`deckName-${slot}`].textContent = state.decks[slot]?.name || "未読込";
  });
  const bottomSlot = displayBottomSlot();
  renderLane(opponentOf(bottomSlot), els["lane-opponent"], "top");
  renderLane(bottomSlot, els["lane-self"], "bottom");

  renderPlayerInfo(opponentOf(bottomSlot), els.opponentInfo);
  renderPlayerInfo(bottomSlot, els.selfInfo);
  renderPendingButtons();
  renderRevealArea();
  renderSelection();
  renderSelectedPreview();
  renderHandPanel();
  renderLog();
  renderStatus();
  renderRoomControls();
  scheduleRoomStateWrite();
}

function renderRevealArea() {
  els.revealArea.innerHTML = "";
  const visibleGroups = Object.keys(PLAYERS).flatMap((slot) => {
    const player = state.players[slot];
    const groups = [];
    if (player.revealed.length) {
      groups.push({
        slot,
        zone: "revealed",
        cards: player.revealed,
        label: `${playerLabel(slot)} 公開中`,
      });
    }
    if (player.shieldCheck.length) {
      groups.push({
        slot,
        zone: "shieldCheck",
        cards: player.shieldCheck,
        label: `${playerLabel(slot)} シールドチェック`,
      });
    }
    if (player.judge.length) {
      groups.push({
        slot,
        zone: "judge",
        cards: player.judge,
        label: `${playerLabel(slot)} ガチンコジャッジ`,
      });
    }
    return groups;
  });

  if (state.zoneBrowse) {
    const { owner, zone, count, deckSize, uids, title } = state.zoneBrowse;
    const allCards = state.players[owner]?.[zone] || [];
    const deckCountAtOpen = Number.isInteger(deckSize) ? deckSize : allCards.length;
    const browseCount =
      zone === "deck" && Number.isInteger(count)
        ? Math.min(Math.max(count, 0), deckCountAtOpen)
        : allCards.length;
    const cards =
      Array.isArray(uids)
        ? uids.map((uid) => allCards.find((card) => card.uid === uid)).filter(Boolean)
        : zone === "deck" && Number.isInteger(count)
          ? allCards.slice(0, browseCount)
          : allCards;
    const label =
      title ||
      (zone === "deck" && Number.isInteger(count)
        ? `${playerLabel(owner)} 山札 ${
            browseCount === deckCountAtOpen ? "全部" : `上${browseCount}枚`
          }`
        : `${playerLabel(owner)} ${zoneLabel(zone)}`);
    if (cards.length) {
      visibleGroups.push({
        slot: owner,
        zone,
        cards,
        label,
        forceVisible: true,
        isTemporary: true,
      });
    } else {
      state.zoneBrowse = null;
      clearSelection();
    }
  }

  if (state.handPeek) {
    const { owner } = state.handPeek;
    const cards = state.players[owner]?.hand || [];
    if (cards.length) {
      visibleGroups.push({
        slot: owner,
        zone: "hand",
        cards,
        label: `${playerLabel(owner)} 手札確認`,
        forceVisible: true,
        isTemporary: true,
      });
    } else {
      state.handPeek = null;
      clearSelection();
    }
  }

  if (state.handBrowse) {
    const { owner, revealedUids = [] } = state.handBrowse;
    const cards = state.players[owner]?.hand || [];
    if (cards.length) {
      visibleGroups.push({
        slot: owner,
        zone: "hand",
        cards,
        label: `${playerLabel(owner)} 手札`,
        visibleUids: revealedUids,
        isTemporary: true,
      });
    } else {
      state.handBrowse = null;
      clearSelection();
    }
  }

  if (!visibleGroups.length) {
    els.revealLayer.hidden = true;
    return;
  }

  els.revealLayer.hidden = false;
  visibleGroups.forEach(
    ({ slot, zone, cards, label: groupLabel, forceVisible, visibleUids, isTemporary }) => {
    const group = document.createElement("div");
    group.className = "reveal-group";

    const header = document.createElement("div");
    header.className = "reveal-group-header";
    const label = document.createElement("span");
    label.className = "reveal-label";
    label.textContent = groupLabel;
    header.appendChild(label);
    if (isTemporary && cards.length) {
      const selectAll = document.createElement("button");
      selectAll.type = "button";
      selectAll.className = "reveal-select-all";
      selectAll.textContent = "全選択";
      selectAll.addEventListener("click", (event) => {
        event.stopPropagation();
        selectRevealGroupCards(slot, zone, cards);
      });
      header.appendChild(selectAll);
    }
    group.appendChild(header);

    const row = document.createElement("div");
    row.className = "reveal-cards";
    if (cards.length) {
      cards.forEach((card) => {
        row.appendChild(
          renderCard(
            slot,
            zone,
            card,
            forceVisible || visibleUids?.includes(card.uid) || canShowCard(slot, zone, card),
            "非公開",
            "compact",
          ),
        );
      });
    } else {
      const empty = document.createElement("p");
      empty.className = "reveal-empty";
      empty.textContent = "カードはありません。";
      row.appendChild(empty);
    }
    group.appendChild(row);
    els.revealArea.appendChild(group);
    },
  );

  if (state.pendingShieldCheckReveal) {
    const owner = state.pendingShieldCheckReveal.owner;
    const canResolve = canResolveShieldCheck(owner);
    const note = document.createElement("div");
    note.className = "reveal-note";

    const text = document.createElement("p");
    text.textContent = canResolve
      ? "開示するカードをすべて選択してください。選ばなかったカードは手札に加わります。"
      : `${playerLabel(owner)}が開示するカードを選んでいます。`;
    note.appendChild(text);

    if (canResolve) {
      const button = actionButton("OK", revealSelectedShieldCheckCards);
      button.classList.add("primary-button");
      note.appendChild(button);
    }
    els.revealArea.appendChild(note);
  }

  const revealActions = [];
  if (visibleGroups.some(({ zone }) => zone === "judge")) {
    revealActions.push(actionButton("OK", resolveGachinkoJudge));
  }
  if (state.zoneBrowse) {
    revealActions.push(actionButton("終了", closeZoneBrowse));
  }
  if (state.handPeek) {
    revealActions.push(actionButton("終了", closeHandPeek));
  }
  if (state.handBrowse) {
    revealActions.push(actionButton("終了", closeHandBrowse));
  }
  if (revealActions.length) {
    const actions = document.createElement("div");
    actions.className = "reveal-actions";
    revealActions.forEach((button) => actions.appendChild(button));
    els.revealArea.appendChild(actions);
  }
}

function renderLane(slot, lane = els[`lane-${slot}`], position = slot === "opponent" ? "top" : "bottom") {
  const player = state.players[slot];
  lane.innerHTML = "";
  lane.dataset.slot = slot;

  const pileColumn = document.createElement("div");
  pileColumn.className = "pile-column";
  if (position === "top") {
    pileColumn.appendChild(renderHandPileZone(slot));
    pileColumn.appendChild(renderPileZone(slot, "graveyard"));
    pileColumn.appendChild(renderPileZone(slot, "deck"));
  } else {
    pileColumn.appendChild(renderPileZone(slot, "deck"));
    pileColumn.appendChild(renderPileZone(slot, "graveyard"));
    pileColumn.appendChild(renderHandPileZone(slot));
  }

  const zoneColumn = document.createElement("div");
  zoneColumn.className = "zone-column";
  const order =
    position === "top"
      ? ["mana", "shields", "battle"]
      : ["battle", "shields", "mana"];
  order.forEach((zoneKey) => {
    zoneColumn.appendChild(renderZoneStrip(slot, zoneKey));
  });

  if (position === "top") {
    lane.appendChild(pileColumn);
    lane.appendChild(zoneColumn);
  } else {
    lane.appendChild(zoneColumn);
    lane.appendChild(pileColumn);
  }
}

function renderZoneStrip(slot, zoneKey) {
  const cards = state.players[slot][zoneKey];
  const strip = document.createElement("section");
  strip.className = `zone-strip ${zoneClass(zoneKey)}${cards.length ? "" : " empty"}`;
  strip.dataset.dropOwner = slot;
  strip.dataset.dropZone = zoneKey;
  setupZoneDropTarget(strip, slot, zoneKey);
  const label = document.createElement("div");
  label.className = "zone-label";
  label.textContent = `${zoneLabel(zoneKey)} ${cards.length}`;
  strip.appendChild(label);

  const cardRow = document.createElement("div");
  cardRow.className = "zone-cards";
  cards.forEach((card) => {
    cardRow.appendChild(renderCard(slot, zoneKey, card, canShowCard(slot, zoneKey, card), "非公開"));
  });
  strip.appendChild(cardRow);

  return strip;
}

function renderPileZone(slot, zoneKey) {
  const cards = state.players[slot][zoneKey];
  const zone = document.createElement("section");
  zone.className = `pile-zone ${zoneKey}-pile ${cards.length ? "" : "empty"}`;
  zone.dataset.dropOwner = slot;
  zone.dataset.dropZone = zoneKey;
  setupZoneDropTarget(zone, slot, zoneKey);
  zone.textContent = cards.length ? "" : zoneLabel(zoneKey);

  if (!cards.length) return zone;

  const card = zoneKey === "deck" ? cards[0] : cards[cards.length - 1];
  const visible = zoneKey === "graveyard" || card.faceUp;
  const pileOptions =
    zoneKey === "graveyard"
      ? { draggable: false, onClick: () => openZoneBrowse(slot, "graveyard") }
      : zoneKey === "deck"
        ? { onClick: () => openDeckMenu(slot) }
        : {};
  const pileCard = renderCard(
    slot,
    zoneKey,
    card,
    visible,
    zoneKey === "deck" ? "山札" : "墓地",
    "compact pile-card",
    pileOptions,
  );
  if (zoneKey === "deck" && state.deckMenuOwner === slot) pileCard.classList.add("selected");
  const count = document.createElement("span");
  count.className = "pile-count";
  count.textContent = cards.length;
  pileCard.appendChild(count);
  zone.appendChild(pileCard);

  return zone;
}

function renderHandPileZone(slot) {
  const hand = state.players[slot].hand;
  const zone = document.createElement("section");
  zone.className = "pile-zone hand-pile";
  zone.dataset.dropOwner = slot;
  zone.dataset.dropZone = "hand";
  setupZoneDropTarget(zone, slot, "hand");

  const button = document.createElement("button");
  button.className = "card compact pile-card hand-pile-card";
  button.type = "button";
  button.title = `${playerLabel(slot)}の手札`;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (slot === state.viewer) {
      clearSelection();
      render();
      return;
    }
    openHandMenu(slot);
  });

  const visual = document.createElement("span");
  visual.className = "card-visual";
  const back = document.createElement("div");
  back.className = "card-back";
  back.textContent = "手札";
  visual.appendChild(back);
  button.appendChild(visual);

  const count = document.createElement("span");
  count.className = "pile-count";
  count.textContent = hand.length;
  button.appendChild(count);
  zone.appendChild(button);
  return zone;
}

function renderCard(
  slot,
  zoneKey,
  card,
  visible,
  hiddenLabel = "非公開",
  extraClass = "",
  options = {},
) {
  const button = document.createElement("button");
  button.className = `card${extraClass ? ` ${extraClass}` : ""}${card.tapped ? " tapped" : ""}`;
  button.dataset.cardOwner = slot;
  button.dataset.cardZone = zoneKey;
  button.dataset.cardUid = card.uid;
  if (isSelected(card.uid)) button.classList.add("selected");
  if (card.stack?.length) button.classList.add("stacked");
  if (card.seals?.length) button.classList.add("sealed");
  button.type = "button";
  button.draggable = options.draggable !== false;
  button.title = visible ? card.name : hiddenLabel;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (Date.now() < suppressCardClickUntil) return;
    const now = Date.now();
    const isDoubleClick =
      lastCardClick?.uid === card.uid &&
      lastCardClick.owner === slot &&
      lastCardClick.zone === zoneKey &&
      now - lastCardClick.time < 360;
    if (isDoubleClick && canToggleTapped(zoneKey, card)) {
      lastCardClick = null;
      toggleSingleCardTapped({ owner: slot, zone: zoneKey, uid: card.uid });
      return;
    }
    lastCardClick = { owner: slot, zone: zoneKey, uid: card.uid, time: now };
    if (options.onClick) {
      options.onClick(event);
      return;
    }
    toggleSelection({ owner: slot, zone: zoneKey, uid: card.uid });
    render();
  });
  if (button.draggable) {
    button.addEventListener("pointerdown", (event) => {
      pointerDrag = {
        ref: { owner: slot, zone: zoneKey, uid: card.uid },
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
    });
    button.addEventListener("dragstart", (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(
        "application/json",
        JSON.stringify({ owner: slot, zone: zoneKey, uid: card.uid }),
      );
    });
    button.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    });
    button.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const sourceRef = readDragRef(event);
      if (!sourceRef) return;
      const targetRef = { owner: slot, zone: zoneKey, uid: card.uid };
      if (reorderBattleCard(sourceRef, targetRef, event.currentTarget, event.clientX)) return;
      stackCardOn(sourceRef, targetRef);
    });
  }

  const visual = document.createElement("span");
  visual.className = "card-visual";

  if (visible) {
    if (card.imageUrl) {
      const image = document.createElement("img");
      image.src = card.imageUrl;
      image.alt = card.name;
      visual.appendChild(image);
    } else {
      const fallback = document.createElement("div");
      fallback.className = "card-fallback";
      fallback.textContent = card.name;
      visual.appendChild(fallback);
    }
  } else {
    const back = document.createElement("div");
    back.className = "card-back";
    back.textContent = hiddenLabel;
    visual.appendChild(back);
  }

  button.appendChild(visual);
  if (card.stack?.length) {
    const stackCount = document.createElement("span");
    stackCount.className = "stack-count";
    stackCount.textContent = `+${card.stack.length}`;
    button.appendChild(stackCount);
  }
  if (card.seals?.length) {
    const sealCount = document.createElement("span");
    sealCount.className = "seal-count";
    sealCount.textContent = `封${card.seals.length}`;
    button.appendChild(sealCount);
  }
  const selectedOrder = selectionOrder(card.uid);
  if (selectedOrder) {
    const order = document.createElement("span");
    order.className = "selected-order";
    order.textContent = selectedOrder;
    button.appendChild(order);
  }
  if (zoneKey === "shields" && card.shieldNumber) {
    const shieldNumber = document.createElement("span");
    shieldNumber.className = "shield-number";
    shieldNumber.textContent = card.shieldNumber;
    button.appendChild(shieldNumber);
  }

  return button;
}
