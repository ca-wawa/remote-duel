"use strict";

function handleDocumentClick(event) {
  const interactive = event.target.closest(
    "button, input, select, label, .file-button, .selected-preview-section",
  );
  if (interactive) return;
  if (
    !state.selected.length &&
    !state.pendingShieldAction &&
    !state.pendingDeckAction &&
    !state.handMenuOwner &&
    !state.deckMenuOwner
  ) {
    return;
  }
  clearSelection();
  render();
}

function toggleSelection(ref) {
  state.pendingShieldAction = null;
  state.pendingDeckAction = null;
  state.handMenuOwner = null;
  state.deckMenuOwner = null;
  const current = Array.isArray(state.selected) ? state.selected : [];
  const existing = current.findIndex((selected) => selected.uid === ref.uid);
  if (existing >= 0) {
    state.selected = current.filter((_, index) => index !== existing);
    return;
  }

  const sameGroup = current.every(
    (selected) => selected.owner === ref.owner && selected.zone === ref.zone,
  );
  state.selected = sameGroup ? [...current, ref] : [ref];
}

function selectRevealGroupCards(owner, zone, cards) {
  state.pendingShieldAction = null;
  state.pendingDeckAction = null;
  state.handMenuOwner = null;
  state.deckMenuOwner = null;
  state.selected = cards.map((card) => ({ owner, zone, uid: card.uid }));
  render();
}

function isSelected(uid) {
  return Array.isArray(state.selected) && state.selected.some((ref) => ref.uid === uid);
}

function selectionOrder(uid) {
  const index = Array.isArray(state.selected)
    ? state.selected.findIndex((ref) => ref.uid === uid)
    : -1;
  return index >= 0 ? index + 1 : "";
}

function selectedRefsWithCards() {
  if (!Array.isArray(state.selected)) return [];
  return state.selected
    .map((ref) => ({ ref, card: findCardInZone(ref) }))
    .filter(({ card }) => card);
}

function findCardInZone(ref) {
  return state.players[ref.owner]?.[ref.zone]?.find((card) => card.uid === ref.uid) || null;
}

function setupZoneDropTarget(element, owner, zoneKey) {
  element.addEventListener("dragover", (event) => {
    event.preventDefault();
    element.classList.add("drop-ready");
    event.dataTransfer.dropEffect = "move";
  });
  element.addEventListener("dragleave", () => {
    element.classList.remove("drop-ready");
  });
  element.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    element.classList.remove("drop-ready");
    const sourceRef = readDragRef(event);
    if (!sourceRef || sourceRef.owner !== owner) return;
    moveDragSelection(sourceRef, zoneKey);
  });
}

function handlePointerMove(event) {
  if (!pointerDrag) return;
  const dx = event.clientX - pointerDrag.startX;
  const dy = event.clientY - pointerDrag.startY;
  if (Math.hypot(dx, dy) > 8) pointerDrag.moved = true;
}

function handlePointerUp(event) {
  if (!pointerDrag) return;
  const drag = pointerDrag;
  pointerDrag = null;
  if (!drag.moved) return;
  suppressCardClickUntil = Date.now() + 250;

  const targetElement = document.elementFromPoint(event.clientX, event.clientY);
  const targetCard = targetElement?.closest?.("[data-card-uid]");
  if (targetCard && targetCard.dataset.cardUid !== drag.ref.uid) {
    const targetRef = {
      owner: targetCard.dataset.cardOwner,
      zone: targetCard.dataset.cardZone,
      uid: targetCard.dataset.cardUid,
    };
    if (reorderBattleCard(drag.ref, targetRef, targetCard, event.clientX)) return;
    stackCardOn(drag.ref, targetRef);
    return;
  }

  const dropZone = targetElement?.closest?.("[data-drop-zone]");
  if (!dropZone) return;
  if (dropZone.dataset.dropOwner !== drag.ref.owner) return;
  moveDragSelection(drag.ref, dropZone.dataset.dropZone);
}

function readDragRef(event) {
  const raw = event.dataTransfer.getData("application/json");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function moveDragSelection(sourceRef, zoneKey) {
  const target = normalizeMoveTarget(zoneKey);
  const selectedContainsSource = isSelected(sourceRef.uid);
  if (!selectedContainsSource) {
    state.selected = [sourceRef];
  }
  const refs = selectedRefsWithCards();
  if (!refs.length) return;
  const movingToSameZone = refs.every(({ ref }) => ref.zone === target.zone);
  if (movingToSameZone && target.zone !== "deck") return;
  moveSelectedTo(zoneKey);
}

function reorderBattleCard(sourceRef, targetRef, targetElement, clientX) {
  if (!shouldReorderBattleCard(sourceRef, targetRef)) return false;

  const cards = state.players[sourceRef.owner].battle;
  const sourceIndex = cards.findIndex((card) => card.uid === sourceRef.uid);
  const targetIndex = cards.findIndex((card) => card.uid === targetRef.uid);
  if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return true;

  const position = battleReorderPosition(targetElement, clientX);
  if (!position) return false;

  saveUndoSnapshot();
  let insertIndex = position === "after" ? targetIndex + 1 : targetIndex;

  const [card] = cards.splice(sourceIndex, 1);
  if (sourceIndex < insertIndex) insertIndex -= 1;
  cards.splice(insertIndex, 0, card);
  state.selected = [{ owner: sourceRef.owner, zone: "battle", uid: sourceRef.uid }];
  pushLog(`${actionPlayerLabel(sourceRef.owner)}: バトルゾーンの並びを変更`);
  render();
  return true;
}

function battleReorderPosition(targetElement, clientX) {
  const rect = targetElement?.getBoundingClientRect?.();
  if (!rect || !Number.isFinite(clientX)) return null;
  const edgeWidth = Math.max(12, rect.width * 0.28);
  if (clientX <= rect.left + edgeWidth) return "before";
  if (clientX >= rect.right - edgeWidth) return "after";
  return null;
}

function shouldReorderBattleCard(sourceRef, targetRef) {
  return (
    sourceRef.owner === targetRef.owner &&
    sourceRef.zone === "battle" &&
    targetRef.zone === "battle"
  );
}

function stackCardOn(sourceRef, targetRef) {
  if (sourceRef.uid === targetRef.uid) return;
  if (sourceRef.owner !== targetRef.owner) return;

  const source = findCardInZone(sourceRef);
  const target = findCardInZone(targetRef);
  if (!source || !target) return;

  const sourceZone = state.players[sourceRef.owner][sourceRef.zone];
  const sourceIndex = sourceZone.findIndex((card) => card.uid === sourceRef.uid);
  if (sourceIndex === -1) return;

  saveUndoSnapshot();
  sourceZone.splice(sourceIndex, 1);
  source.tapped = false;
  if (targetRef.zone === "shields") assignShieldNumber(state.players[targetRef.owner], source);
  target.stack = target.stack || [];
  target.stack.push(source);
  state.selected = [{ owner: targetRef.owner, zone: targetRef.zone, uid: targetRef.uid }];
  pushLog(`${source.name} を ${target.name} に重ねました`);
  render();
}

function stackSelectedBattleCards(refs = selectedRefsWithCards()) {
  const battleRefs = refs.filter(({ ref }) => ref.zone === "battle");
  if (battleRefs.length < 2) return;
  const owner = battleRefs[0].ref.owner;
  if (!battleRefs.every(({ ref }) => ref.owner === owner)) return;

  const battleCards = state.players[owner].battle;
  const selectedUids = new Set(battleRefs.map(({ ref }) => ref.uid));
  const indexes = battleRefs.map(({ ref }) => battleCards.findIndex((card) => card.uid === ref.uid));
  if (indexes.some((index) => index < 0)) return;

  saveUndoSnapshot();
  const insertIndex = Math.min(...indexes);
  const stackGroup = battleRefs.flatMap(({ card }) => stackGroupCards(card));
  const stackedTop = cloneStackCard(stackGroup[0]);
  applyStackGroup(stackedTop, stackGroup);
  const remainingCards = battleCards.filter((card) => !selectedUids.has(card.uid));
  remainingCards.splice(insertIndex, 0, stackedTop);
  state.players[owner].battle = remainingCards;
  state.selected = [{ owner, zone: "battle", uid: stackedTop.uid }];
  pushLog(`${actionPlayerLabel(owner)}: ${battleRefs.length}枚を重ねました`);
  render();
}

function reorderStackCard(ref, index, direction) {
  const parentCard = findCardInZone(ref);
  if (!parentCard?.stack?.length) return;
  const group = stackGroupCards(parentCard);
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= group.length) return;

  saveUndoSnapshot();
  [group[index], group[nextIndex]] = [group[nextIndex], group[index]];
  const newUid = applyStackGroup(parentCard, group);
  state.selected = [{ owner: ref.owner, zone: ref.zone, uid: newUid }];
  pushLog("重なっているカードの順番を変更");
  render();
}

function detachStackCard(ref, index) {
  const parentCard = findCardInZone(ref);
  if (!parentCard?.stack?.length) return;
  const group = stackGroupCards(parentCard);
  if (index < 0 || index >= group.length || group.length <= 1) return;

  const zoneCards = state.players[ref.owner][ref.zone];
  const parentIndex = zoneCards.findIndex((card) => card.uid === ref.uid);
  if (parentIndex === -1) return;

  saveUndoSnapshot();
  const [removed] = group.splice(index, 1);
  const newTopUid = applyStackGroup(parentCard, group);
  const detached = cloneStackCard(removed);
  zoneCards.splice(parentIndex + 1, 0, detached);
  state.selected = [{ owner: ref.owner, zone: ref.zone, uid: newTopUid }];
  pushLog(`${detached.name} を重なりから外しました`);
  render();
}

function addSealToSelectedBattleCards(refs = selectedRefsWithCards()) {
  const battleRefs = refs.filter(({ ref }) => ref.zone === "battle");
  if (!battleRefs.length) return;
  const owner = battleRefs[0].ref.owner;
  if (!battleRefs.every(({ ref }) => ref.owner === owner)) return;
  const player = state.players[owner];
  if (!player.deck.length) {
    pushLog(`${actionPlayerLabel(owner)}の山札がないため封印をつけられません`);
    render();
    return;
  }

  saveUndoSnapshot();
  let sealedCount = 0;
  battleRefs.forEach(({ card }) => {
    if (!player.deck.length) return;
    const seal = player.deck.shift();
    seal.tapped = false;
    seal.faceUp = false;
    seal.shieldCheckRevealed = false;
    seal.stack = [];
    seal.seals = [];
    card.seals = card.seals || [];
    card.seals.push(seal);
    sealedCount += 1;
  });
  state.selected = battleRefs.map(({ ref }) => ref);
  pushLog(`${actionPlayerLabel(owner)}: ${sealedCount}枚に封印をつけました`);
  render();
}

function removeSealFromSelectedBattleCards(refs = selectedRefsWithCards()) {
  const battleRefs = refs.filter(({ ref, card }) => ref.zone === "battle" && card.seals?.length);
  if (!battleRefs.length) return;
  const owner = battleRefs[0].ref.owner;
  if (!battleRefs.every(({ ref }) => ref.owner === owner)) return;

  saveUndoSnapshot();
  let removedCount = 0;
  battleRefs.forEach(({ card }) => {
    const seal = card.seals.pop();
    if (!seal) return;
    prepareCardForGraveyard(seal);
    state.players[owner].graveyard.push(seal);
    removedCount += 1;
  });
  state.selected = battleRefs.map(({ ref }) => ref);
  pushLog(`${actionPlayerLabel(owner)}: 封印を${removedCount}枚外しました`);
  render();
}

function stackGroupCards(parentCard) {
  return [cloneStackCard(parentCard), ...(parentCard.stack || []).map(cloneStackCard)];
}

function applyStackGroup(parentCard, group) {
  const [topCard, ...stackCards] = group.map(cloneStackCard);
  Object.keys(parentCard).forEach((key) => {
    delete parentCard[key];
  });
  Object.assign(parentCard, topCard, { stack: stackCards });
  return parentCard.uid;
}

function cloneStackCard(card) {
  const clone = clonePlain(card);
  clone.stack = [];
  return clone;
}

function deckActionCount(owner = state.deckMenuOwner || state.viewer) {
  const input = document.querySelector("#deckCountInput");
  const count = Number(input?.value || 1);
  if (!Number.isFinite(count)) return 1;
  const deckCount = state.players[owner]?.deck.length || 0;
  const max = Math.max(deckCount, 1);
  return Math.max(1, Math.min(max, Math.floor(count)));
}

function handDiscardCount() {
  const input = document.querySelector("#handDiscardCountInput");
  const count = Number(input?.value || 1);
  if (!Number.isFinite(count)) return 1;
  return Math.max(1, Math.min(20, Math.floor(count)));
}

function runDeckMenuAction(actionKey, owner = state.deckMenuOwner || state.viewer) {
  const count = deckActionCount(owner);
  if (actionKey === "deck-draw") drawCards(owner, count);
  if (actionKey === "deck-shield") shieldFromDeckCards(owner, count);
  if (actionKey === "deck-mana") manaFromDeckCards(owner, count);
  if (actionKey === "deck-mill") millCards(owner, count);
  if (actionKey === "deck-look") openZoneBrowse(owner, "deck", { count });
  if (actionKey === "deck-reveal") revealDeckCards(owner, count);
  if (actionKey === "deck-shuffle") shuffleDeck(owner);
  if (actionKey === "gachinko-judge") startGachinkoJudge();
  const input = document.querySelector("#deckCountInput");
  if (input) input.value = "1";
}

function runSelectedDeckAction(actionKey, refs) {
  const owner = refs.find(({ ref }) => ref.zone === "deck")?.ref.owner || state.viewer;
  runDeckMenuAction(actionKey, owner);
}

function normalizeMoveTarget(zoneKey, options = {}) {
  if (zoneKey === "deck-top" || (zoneKey === "deck" && options.position === "top")) {
    return { zone: "deck", position: "top", label: "山札の上" };
  }
  if (zoneKey === "deck-bottom" || zoneKey === "deck") {
    return { zone: "deck", position: "bottom", label: "山札の下" };
  }
  return { zone: zoneKey, position: "bottom", label: zoneLabel(zoneKey) };
}

function insertCardIntoZone(player, target, card) {
  if (target.zone === "deck" && target.position === "top") {
    player.deck.unshift(card);
    return;
  }
  player[target.zone].push(card);
}

function getBatchSelectionActions(refs) {
  const zones = [...new Set(refs.map(({ ref }) => ref.zone))];
  if (zones.length !== 1) return [];
  if (zones[0] === "shieldCheck") {
    if (state.pendingShieldCheckReveal && !canResolveShieldCheck(refs[0].ref.owner)) return [];
    const allFaceUp = refs.every(({ card }) => card.faceUp);
    if (allFaceUp) {
      return [
        ["hand", "手札に加える"],
        ["graveyard", "墓地に置く"],
        ["battle", "場に出す"],
      ];
    }
    return [["shield-check-reveal", "開示する"]];
  }
  if (isDeckBrowseSelection(refs)) {
    return [
      ["deck-browse-reveal", "開示する"],
      ["hand", "手札に加える"],
      ["battle", "場に出す"],
      ["mana", "マナに置く"],
      ["graveyard", "墓地に置く"],
      ["shields", "シールドに置く"],
      ["deck", "山札に置く"],
    ];
  }
  if (isHandBrowseSelection(refs)) {
    return [
      ["hand-browse-reveal", "見る"],
      ["graveyard", "墓地に置く"],
    ];
  }
  const actions = getSelectionActions(zones[0]);
  if (zones[0] === "battle") {
    const sealActions = [["add-seal", "封印をつける"]];
    if (refs.some(({ card }) => card.seals?.length)) {
      sealActions.push(["remove-seal", "封印を外す"]);
    }
    if (refs.length > 1) {
      return [["stack-selected", "重ねる"], ...sealActions, ...actions];
    }
    return [...sealActions, ...actions];
  }
  return actions;
}

function getSelectionActions(zoneKey) {
  const actionsByZone = {
    hand: [
      ["battle", "場に出す"],
      ["pending", "保留状態へ"],
      ["mana", "マナに置く"],
      ["graveyard", "墓地に置く"],
      ["shields", "シールドに置く"],
      ["deck", "山札に置く"],
    ],
    revealed: [
      ["hand", "手札に加える"],
      ["deck", "山札に置く"],
      ["graveyard", "墓地に置く"],
      ["battle", "場に出す"],
      ["mana", "マナに置く"],
      ["shields", "シールドに置く"],
    ],
    battle: [
      ["mana", "マナに置く"],
      ["graveyard", "墓地に置く"],
      ["hand", "手札に戻す"],
      ["deck", "山札に置く"],
      ["shields", "シールドに置く"],
    ],
    mana: [
      ["battle", "場に出す"],
      ["pending", "保留状態へ"],
      ["graveyard", "墓地に置く"],
      ["hand", "手札に戻す"],
      ["deck", "山札に置く"],
      ["shields", "シールドに置く"],
    ],
    shields: [
      ["shield-look", "見る"],
      ["shield-face-up", "表にする"],
      ["hand", "手札に加える"],
      ["graveyard", "墓地に置く"],
      ["mana", "マナに置く"],
      ["deck", "山札に置く"],
    ],
    graveyard: [
      ["battle", "場に出す"],
      ["pending", "保留状態へ"],
      ["hand", "手札に戻す"],
      ["mana", "マナに置く"],
      ["deck", "山札に置く"],
      ["shields", "シールドに置く"],
    ],
    pending: [
      ["battle", "場に出す"],
      ["hand", "手札に加える"],
      ["mana", "マナに置く"],
      ["graveyard", "墓地に置く"],
      ["deck", "山札に置く"],
      ["shields", "シールドに置く"],
    ],
    deck: [
      ["deck-draw", "ドロー"],
      ["deck-shield", "シールドへ"],
      ["deck-mana", "マナへ"],
      ["deck-mill", "墓地へ"],
      ["deck-look", "山札を見る"],
      ["deck-reveal", "表向きにする"],
      ["deck-shuffle", "シャッフル"],
      ["gachinko-judge", "ガチンコジャッジ"],
    ],
  };
  return actionsByZone[zoneKey] || [];
}

function isDeckBrowseSelection(refs) {
  const browseUids = state.zoneBrowse?.uids;
  return (
    state.zoneBrowse?.zone === "deck" &&
    refs.length > 0 &&
    refs.every(
      ({ ref }) =>
        ref.owner === state.zoneBrowse.owner &&
        ref.zone === "deck" &&
        (!Array.isArray(browseUids) || browseUids.includes(ref.uid)),
    )
  );
}

function isHandBrowseSelection(refs) {
  return (
    state.handBrowse?.owner &&
    refs.length > 0 &&
    refs.every(
      ({ ref }) =>
        ref.owner === state.handBrowse.owner &&
        ref.zone === "hand" &&
        state.players[ref.owner]?.hand.some((card) => card.uid === ref.uid),
    )
  );
}

function isShieldSelection(refs) {
  return refs.length > 0 && refs.every(({ ref }) => ref.zone === "shields");
}

function canResolveShieldCheck(owner = state.pendingShieldCheckReveal?.owner) {
  return Boolean(owner && owner === state.viewer);
}

function canToggleTapped(zoneKey, card = null) {
  if (zoneKey === "battle" && card?.seals?.length) return false;
  return zoneKey === "battle" || zoneKey === "mana";
}

function canShowCard(slot, zoneKey, card = null) {
  if (card?.faceUp) return true;
  if (state.handPeek?.owner === slot && zoneKey === "hand") return true;
  if (
    state.handBrowse?.owner === slot &&
    zoneKey === "hand" &&
    state.handBrowse.revealedUids?.includes(card?.uid)
  ) {
    return true;
  }
  if (state.zoneBrowse?.owner === slot && state.zoneBrowse.zone === zoneKey) {
    const browseUids = state.zoneBrowse.uids;
    return !Array.isArray(browseUids) || browseUids.includes(card?.uid);
  }
  if (["battle", "mana", "graveyard", "pending"].includes(zoneKey)) return true;
  if (zoneKey === "shieldCheck") return slot === state.viewer;
  return slot === state.viewer && zoneKey === "hand";
}

function removeMovedCardsFromZoneBrowse(movedRefs) {
  if (!Array.isArray(state.zoneBrowse?.uids) || !movedRefs.length) return;
  const movedUids = new Set(movedRefs.map((ref) => ref.uid));
  state.zoneBrowse.uids = state.zoneBrowse.uids.filter((uid) => !movedUids.has(uid));
  if (!state.zoneBrowse.uids.length) state.zoneBrowse = null;
}

function removeMovedCardsFromHandBrowse(movedRefs) {
  if (!state.handBrowse || !movedRefs.length) return;
  const movedUids = new Set(
    movedRefs
      .filter((ref) => ref.owner === state.handBrowse.owner && ref.zone !== "hand")
      .map((ref) => ref.uid),
  );
  if (!movedUids.size) return;
  state.handBrowse.revealedUids = (state.handBrowse.revealedUids || []).filter(
    (uid) => !movedUids.has(uid),
  );
  if (!state.players[state.handBrowse.owner]?.hand.length) state.handBrowse = null;
}

function releaseSealsToGraveyard(owner, card) {
  const player = state.players[owner];
  flattenCards([card]).forEach((targetCard) => {
    const seals = targetCard.seals || [];
    seals.forEach((seal) => {
      prepareCardForGraveyard(seal);
      player.graveyard.push(seal);
    });
    targetCard.seals = [];
  });
}

function prepareCardForGraveyard(card) {
  card.tapped = false;
  card.faceUp = true;
  card.shieldCheckRevealed = false;
  card.stack = card.stack || [];
  card.seals = card.seals || [];
}

function faceUpForZone(zoneKey, options = {}) {
  if (zoneKey === "shields") return Boolean(options.faceUp);
  return ["battle", "mana", "graveyard", "pending"].includes(zoneKey);
}

function assignShieldNumber(player, card) {
  if (card.shieldNumber) return;
  const nextNumber =
    Number.isInteger(player.nextShieldNumber) && player.nextShieldNumber > 0
      ? player.nextShieldNumber
      : highestShieldNumber(player) + 1;
  card.shieldNumber = nextNumber;
  player.nextShieldNumber = nextNumber + 1;
}

function highestShieldNumber(player) {
  return Object.values(player)
    .flatMap((value) => (Array.isArray(value) ? flattenCards(value) : []))
    .reduce((max, card) => Math.max(max, card.shieldNumber || 0), 0);
}

function flattenCards(cards) {
  return cards.flatMap((card) => [card, ...flattenCards(card.stack || [])]);
}

function findSelectedCard() {
  return selectedRefsWithCards()[0]?.card || null;
}

function saveUndoSnapshot() {
  state.undoStack.push(
    clonePlain({
      players: state.players,
      roomDecks: state.roomDecks,
      viewer: state.viewer,
      firstPlayer: state.firstPlayer,
      turn: state.turn,
      turnCount: state.turnCount,
      extraTurns: state.extraTurns,
      selected: state.selected,
      pendingShieldAction: state.pendingShieldAction,
      pendingDeckAction: state.pendingDeckAction,
      pendingShieldCheckReveal: state.pendingShieldCheckReveal,
      handMenuOwner: state.handMenuOwner,
      deckMenuOwner: state.deckMenuOwner,
      zoneBrowse: state.zoneBrowse,
      handPeek: state.handPeek,
      handBrowse: state.handBrowse,
      log: state.log,
    }),
  );
  if (state.undoStack.length > MAX_UNDO_HISTORY) state.undoStack.shift();
}

function undoLastAction() {
  const snapshot = state.undoStack.pop();
  if (!snapshot) return;

  state.players = clonePlain(snapshot.players);
  state.roomDecks = clonePlain(snapshot.roomDecks || state.roomDecks);
  state.viewer = snapshot.viewer || "self";
  state.firstPlayer = snapshot.firstPlayer || "self";
  state.turn = snapshot.turn;
  state.turnCount = clonePlain(snapshot.turnCount);
  state.extraTurns = clonePlain(snapshot.extraTurns || { self: 0, opponent: 0 });
  state.selected = clonePlain(snapshot.selected || []);
  state.pendingShieldAction = snapshot.pendingShieldAction || null;
  state.pendingDeckAction = snapshot.pendingDeckAction || null;
  state.pendingShieldCheckReveal = snapshot.pendingShieldCheckReveal || null;
  state.handMenuOwner = snapshot.handMenuOwner || null;
  state.deckMenuOwner = snapshot.deckMenuOwner || null;
  state.zoneBrowse = snapshot.zoneBrowse || null;
  state.handPeek = snapshot.handPeek || null;
  state.handBrowse = snapshot.handBrowse || null;
  state.log = clonePlain(snapshot.log || []);
  pushLog("操作を取り消しました");
  render();
}

function clonePlain(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function clearSelection() {
  state.selected = [];
  state.pendingShieldAction = null;
  state.pendingDeckAction = null;
  state.handMenuOwner = null;
  state.deckMenuOwner = null;
}

function closeTemporaryViews() {
  state.zoneBrowse = null;
  state.handPeek = null;
  state.handBrowse = null;
}

function playerOrderLabel(slot) {
  return slot === state.firstPlayer ? "先攻" : "後攻";
}

function startingTurnCount(firstSlot = state.firstPlayer) {
  return {
    self: firstSlot === "self" ? 1 : 0,
    opponent: firstSlot === "opponent" ? 1 : 0,
  };
}

function playerLabel(slot) {
  const localSlot = localPerspectiveSlot();
  if (!localSlot) return PLAYERS[slot].label;
  return slot === localSlot ? "自分" : "相手";
}

function renderViewerLabels() {
  if (!els.viewerSelect) return;
  Object.keys(PLAYERS).forEach((slot) => {
    const option = els.viewerSelect.querySelector(`option[value="${slot}"]`);
    if (option) option.textContent = playerLabel(slot);
  });
}

function deckInputTargetSlot(uiSlot) {
  const localSlot = localPerspectiveSlot();
  if (!localSlot) return uiSlot;
  return uiSlot === "self" ? localSlot : opponentOf(localSlot);
}

function deckSlotForPlayerSlot(playerSlot) {
  const localSlot = localPerspectiveSlot();
  if (!localSlot) return playerSlot;
  return playerSlot === localSlot ? "self" : "opponent";
}

function actionPlayerLabel(slot) {
  if (!roomSync.connected) return PLAYERS[slot].label;
  return playerLogToken(slot);
}

function playerLogToken(slot) {
  return `{{player:${slot}}}`;
}

function formatLogEntry(entry) {
  return String(entry || "").replace(/\{\{player:(self|opponent)\}\}/g, (_, slot) =>
    playerLabel(slot),
  );
}

function preferredViewerSlot(fallback = "self") {
  return localPerspectiveSlot() || fallback;
}

function enforceLocalPerspective() {
  const localSlot = localPerspectiveSlot();
  if (localSlot) state.viewer = localSlot;
}

function displayBottomSlot() {
  enforceLocalPerspective();
  return localPerspectiveSlot() || "self";
}

function assignedLocalSlot() {
  return ["self", "opponent"].includes(roomSync.localSlot) ? roomSync.localSlot : "";
}

function localPerspectiveSlot() {
  return assignedLocalSlot() || normalizePlayerSlot(roomSync.lastLocalSlot, "");
}

function normalizePlayerSlot(slot, fallback = "self") {
  return ["self", "opponent"].includes(slot) ? slot : fallback;
}

function seatStatusText() {
  if (!roomSync.connected && !roomSync.connecting) return "未接続";
  const slot = assignedLocalSlot();
  if (!slot) return "未決定";
  return `自分は${playerOrderLabel(slot)}`;
}

function opponentOf(slot) {
  return slot === "self" ? "opponent" : "self";
}

function zoneLabel(zoneKey) {
  return ZONES.find((zone) => zone.key === zoneKey)?.label || zoneKey;
}

function zoneClass(zoneKey) {
  return (
    {
      battle: "battle-zone",
      mana: "mana-zone",
      hand: "hand-zone",
      shields: "shield-zone",
    }[zoneKey] || "battle-zone"
  );
}

function pushLog(message) {
  const time = new Date().toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  state.log.push(`${time} ${message}`);
}

function shuffle(cards) {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
