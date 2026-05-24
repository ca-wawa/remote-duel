"use strict";

function setupGame() {
  const localSlot = assignedLocalSlot();
  if (roomSync.connected && !localSlot) {
    alert("先に接続メニューで先攻/後攻を決めてください。");
    return;
  }

  const remoteMode = roomSync.connected && localSlot;
  syncLocalDeckToRoomDeck();
  const targetSlots = Object.keys(PLAYERS);
  const missingSlots = targetSlots.filter((slot) => !deckForPlayerSlot(slot));
  if (missingSlots.length) {
    alert(
      remoteMode
        ? `${missingSlots.map(playerLabel).join("・")}のデッキ読込待ちです。`
        : "先にデッキZIPを読み込んでください。",
    );
    return;
  }

  saveUndoSnapshot();
  targetSlots.forEach((slot) => {
    const deck = deckForPlayerSlot(slot);
    setupPlayerFromDeck(slot, deck);
  });

  state.turn = state.firstPlayer;
  state.viewer = preferredViewerSlot(state.firstPlayer);
  state.turnCount = startingTurnCount(state.firstPlayer);
  state.extraTurns = { self: 0, opponent: 0 };
  state.selected = [];
  state.pendingShieldAction = null;
  state.pendingDeckAction = null;
  state.pendingShieldCheckReveal = null;
  state.handMenuOwner = null;
  state.deckMenuOwner = null;
  closeTemporaryViews();
  pushLog(
    remoteMode
      ? "初期手札5枚、シールド5枚で開始"
      : "初期手札5枚、シールド5枚で開始",
  );
  render();
}

function setupPlayerFromDeck(slot, deck = state.decks[slot]) {
  const player = emptyPlayerState();
  player.deck = instantiateDeck(deck, slot);
  player.shields = player.deck.splice(0, 5);
  player.shields.forEach((card) => assignShieldNumber(player, card));
  player.hand = player.deck.splice(0, 5);
  state.players[slot] = player;
}

function drawCard(slot) {
  drawCards(slot, 1);
}

function drawCards(slot, count) {
  const player = state.players[slot];
  if (!player.deck.length) {
    pushLog(`${actionPlayerLabel(slot)}の山札がありません`);
    render();
    return;
  }
  saveUndoSnapshot();
  let moved = 0;
  for (let i = 0; i < count; i += 1) {
    const card = player.deck.shift();
    if (!card) break;
    card.tapped = false;
    card.faceUp = false;
    player.hand.push(card);
    moved += 1;
  }
  clearSelection();
  pushLog(`${actionPlayerLabel(slot)}が${moved}枚ドロー`);
  render();
}

function shieldFromDeck(slot) {
  shieldFromDeckCards(slot, 1);
}

function shieldFromDeckCards(slot, count) {
  const player = state.players[slot];
  if (!player.deck.length) {
    pushLog(`${actionPlayerLabel(slot)}の山札がありません`);
    render();
    return;
  }
  saveUndoSnapshot();
  let moved = 0;
  for (let i = 0; i < count; i += 1) {
    const card = player.deck.shift();
    if (!card) break;
    card.tapped = false;
    card.faceUp = false;
    assignShieldNumber(player, card);
    player.shields.push(card);
    moved += 1;
  }
  clearSelection();
  pushLog(`${actionPlayerLabel(slot)}が山札からシールドを${moved}枚追加`);
  render();
}

function millCard(slot) {
  millCards(slot, 1);
}

function millCards(slot, count) {
  const player = state.players[slot];
  if (!player.deck.length) {
    pushLog(`${actionPlayerLabel(slot)}の山札がありません`);
    render();
    return;
  }
  saveUndoSnapshot();
  let moved = 0;
  for (let i = 0; i < count; i += 1) {
    const card = player.deck.shift();
    if (!card) break;
    card.tapped = false;
    card.faceUp = true;
    player.graveyard.push(card);
    moved += 1;
  }
  clearSelection();
  pushLog(`${actionPlayerLabel(slot)}が山札上${moved}枚を墓地へ`);
  render();
}

function manaFromDeckCards(slot, count) {
  const player = state.players[slot];
  if (!player.deck.length) {
    pushLog(`${actionPlayerLabel(slot)}の山札がありません`);
    render();
    return;
  }
  saveUndoSnapshot();
  let moved = 0;
  for (let i = 0; i < count; i += 1) {
    const card = player.deck.shift();
    if (!card) break;
    card.tapped = false;
    card.faceUp = true;
    player.mana.push(card);
    moved += 1;
  }
  clearSelection();
  pushLog(`${actionPlayerLabel(slot)}が山札上${moved}枚をマナへ`);
  render();
}

function revealDeckCards(slot, count) {
  const player = state.players[slot];
  if (!player.deck.length) {
    pushLog(`${actionPlayerLabel(slot)}の山札がありません`);
    render();
    return;
  }
  saveUndoSnapshot();
  const cards = player.deck.splice(0, count);
  cards.forEach((card) => {
    card.faceUp = true;
    card.tapped = false;
    player.revealed.push(card);
  });
  clearSelection();
  pushLog(`${actionPlayerLabel(slot)}の山札上${cards.length}枚を公開`);
  render();
}

function startGachinkoJudge() {
  if (hasActiveGachinkoJudge()) {
    pushLog("ガチンコジャッジ解決待ち");
    render();
    return;
  }

  if (!Object.keys(PLAYERS).some((slot) => state.players[slot].deck.length)) {
    pushLog("ガチンコジャッジ: 公開できる山札がありません");
    render();
    return;
  }

  saveUndoSnapshot();
  clearSelection();
  let revealed = 0;
  Object.keys(PLAYERS).forEach((slot) => {
    const player = state.players[slot];
    const card = player.deck.shift();
    if (!card) return;
    card.faceUp = true;
    card.tapped = false;
    card.shieldCheckRevealed = false;
    player.judge.push(card);
    revealed += 1;
  });

  pushLog(`ガチンコジャッジ: ${revealed}枚を公開`);
  render();
}

function resolveGachinkoJudge() {
  if (!hasActiveGachinkoJudge()) return;
  let moved = 0;
  Object.keys(PLAYERS).forEach((slot) => {
    const player = state.players[slot];
    while (player.judge.length) {
      const card = player.judge.shift();
      card.faceUp = false;
      card.tapped = false;
      card.shieldCheckRevealed = false;
      player.deck.push(card);
      moved += 1;
    }
  });

  clearSelection();
  pushLog(`ガチンコジャッジ: ${moved}枚を山札の下へ`);
  render();
}

function hasActiveGachinkoJudge() {
  return Object.keys(PLAYERS).some((slot) => state.players[slot].judge.length);
}

function shuffleDeck(slot) {
  const player = state.players[slot];
  if (!player.deck.length) {
    pushLog(`${actionPlayerLabel(slot)}の山札がありません`);
    render();
    return;
  }

  saveUndoSnapshot();
  player.deck = shuffle(player.deck);
  clearSelection();
  pushLog(`${actionPlayerLabel(slot)}の山札をシャッフル`);
  render();
}

function discardBlindHandCards(slot, count) {
  const player = state.players[slot];
  if (!player.hand.length) {
    pushLog(`${actionPlayerLabel(slot)}の手札がありません`);
    render();
    return;
  }

  saveUndoSnapshot();
  const discardCount = Math.min(count, player.hand.length);
  for (let i = 0; i < discardCount; i += 1) {
    const index = Math.floor(Math.random() * player.hand.length);
    const [card] = player.hand.splice(index, 1);
    card.tapped = false;
    card.faceUp = true;
    card.shieldCheckRevealed = false;
    player.graveyard.push(card);
  }

  const input = document.querySelector("#handDiscardCountInput");
  if (input) input.value = "1";
  clearSelection();
  pushLog(`${actionPlayerLabel(slot)}の手札を見ないで${discardCount}枚捨てました`);
  render();
}

function openHandMenu(owner) {
  clearSelection();
  openHandBrowse(owner);
}

function openHandBrowse(owner) {
  state.handBrowse = { owner, revealedUids: [] };
  state.handPeek = null;
  state.zoneBrowse = null;
  state.handMenuOwner = null;
  state.deckMenuOwner = null;
  clearSelection();
  render();
}

function openDeckMenu(owner) {
  clearSelection();
  state.deckMenuOwner = owner;
  render();
}

function openHandPeek(owner) {
  state.handPeek = { owner };
  state.handBrowse = null;
  state.zoneBrowse = null;
  state.handMenuOwner = null;
  state.deckMenuOwner = null;
  clearSelection();
  pushLog(`${actionPlayerLabel(owner)}の手札を確認`);
  render();
}

function closeHandPeek() {
  state.handPeek = null;
  clearSelection();
  render();
}

function closeHandBrowse() {
  state.handBrowse = null;
  clearSelection();
  render();
}

function openZoneBrowse(owner, zone, options = {}) {
  const browse = { ...options, owner, zone };
  if (zone === "deck" && Number.isInteger(options.count)) {
    const deck = state.players[owner]?.deck || [];
    const count = Math.min(Math.max(options.count, 0), deck.length);
    browse.count = count;
    browse.deckSize = deck.length;
    browse.uids = deck.slice(0, count).map((card) => card.uid);
  }
  state.zoneBrowse = browse;
  state.handPeek = null;
  state.handBrowse = null;
  state.handMenuOwner = null;
  state.deckMenuOwner = null;
  clearSelection();
  render();
}

function closeZoneBrowse() {
  state.zoneBrowse = null;
  clearSelection();
  render();
}

function moveSelectedTo(zoneKey, options = {}) {
  const refs = selectedRefsWithCards();
  if (!refs.length) return;
  const moveTarget = normalizeMoveTarget(zoneKey, options);

  if (moveTarget.zone === "hand" && refs.every(({ ref }) => ref.zone === "shields")) {
    startShieldCheck(refs);
    return;
  }

  if (!canMoveShieldCheckRefs(refs, moveTarget.zone)) return;

  if (moveTarget.zone === "deck" && options.position == null && zoneKey === "deck") {
    state.pendingShieldAction = null;
    state.pendingDeckAction = { type: "move", zoneKey: moveTarget.zone };
    render();
    return;
  }

  if (moveTarget.zone === "shields" && options.faceUp == null) {
    state.pendingShieldAction = { type: "move", zoneKey: moveTarget.zone };
    state.pendingDeckAction = null;
    render();
    return;
  }

  saveUndoSnapshot();
  const movedRefs = [];
  refs.forEach(({ ref, card }) => {
    const source = state.players[ref.owner][ref.zone];
    const index = source.findIndex((sourceCard) => sourceCard.uid === ref.uid);
    if (index === -1) return;
    source.splice(index, 1);
    card.tapped = moveTarget.zone === "battle" || moveTarget.zone === "mana" ? card.tapped : false;
    card.faceUp = faceUpForZone(moveTarget.zone, options);
    card.shieldCheckRevealed = false;
    if (ref.zone === "battle" && moveTarget.zone !== "battle") {
      releaseSealsToGraveyard(ref.owner, card);
    }
    if (moveTarget.zone === "shields") assignShieldNumber(state.players[ref.owner], card);
    insertCardIntoZone(state.players[ref.owner], moveTarget, card);
    movedRefs.push({ owner: ref.owner, zone: moveTarget.zone, uid: card.uid });
  });

  removeMovedCardsFromZoneBrowse(movedRefs);
  removeMovedCardsFromHandBrowse(movedRefs);
  state.selected = [];
  state.pendingShieldAction = null;
  state.pendingDeckAction = null;
  state.pendingShieldCheckReveal = null;
  const ownerLabel = actionPlayerLabel(refs[0].ref.owner);
  pushLog(`${ownerLabel}: ${movedRefs.length}枚を${moveTarget.label}へ`);
  render();
}

function startShieldCheck(refs) {
  saveUndoSnapshot();
  const movedRefs = [];
  refs.forEach(({ ref, card }) => {
    const player = state.players[ref.owner];
    const source = player.shields;
    const index = source.findIndex((sourceCard) => sourceCard.uid === ref.uid);
    if (index === -1) return;
    source.splice(index, 1);
    card.tapped = false;
    card.faceUp = false;
    card.shieldCheckRevealed = false;
    player.shieldCheck.push(card);
    movedRefs.push({ owner: ref.owner, zone: "shieldCheck", uid: card.uid });
  });

  state.selected = [];
  state.pendingShieldAction = null;
  state.pendingDeckAction = null;
  state.pendingShieldCheckReveal = { owner: refs[0].ref.owner };
  const ownerLabel = actionPlayerLabel(refs[0].ref.owner);
  pushLog(`${ownerLabel}: ${movedRefs.length}枚をシールドチェック`);
  render();
}

function revealSelectedShieldCheckCards() {
  const owner = state.pendingShieldCheckReveal?.owner || state.selected[0]?.owner;
  if (!owner) return;
  if (!canResolveShieldCheck(owner)) return;
  const refs = selectedRefsWithCards().filter(
    ({ ref }) => ref.owner === owner && ref.zone === "shieldCheck",
  );
  const player = state.players[owner];
  if (!player.shieldCheck.length) return;
  saveUndoSnapshot();
  const selectedUids = new Set(refs.map(({ ref }) => ref.uid));
  let sentToHand = 0;
  player.shieldCheck = player.shieldCheck.filter((card) => {
    if (selectedUids.has(card.uid)) return true;
    card.faceUp = false;
    card.tapped = false;
    card.shieldCheckRevealed = false;
    player.hand.push(card);
    sentToHand += 1;
    return false;
  });
  refs.forEach(({ card }) => {
    card.faceUp = true;
    card.shieldCheckRevealed = true;
  });
  state.pendingShieldCheckReveal = null;
  state.selected = refs.map(({ ref }) => ref);
  pushLog(`${actionPlayerLabel(owner)}: ${refs.length}枚を開示、${sentToHand}枚を手札へ`);
  render();
}

function revealSelectedDeckBrowseCards(refs = selectedRefsWithCards()) {
  const deckRefs = refs.filter(({ ref }) => ref.zone === "deck");
  if (!isDeckBrowseSelection(deckRefs)) return;
  const owner = deckRefs[0].ref.owner;
  const player = state.players[owner];

  saveUndoSnapshot();
  const movedRefs = [];
  deckRefs.forEach(({ ref }) => {
    const index = player.deck.findIndex((card) => card.uid === ref.uid);
    if (index === -1) return;
    const [card] = player.deck.splice(index, 1);
    card.faceUp = true;
    card.tapped = false;
    card.shieldCheckRevealed = false;
    player.revealed.push(card);
    movedRefs.push({ owner, zone: "revealed", uid: card.uid });
  });

  removeMovedCardsFromZoneBrowse(movedRefs);
  state.selected = [];
  state.pendingShieldAction = null;
  state.pendingDeckAction = null;
  state.pendingShieldCheckReveal = null;
  pushLog(`${actionPlayerLabel(owner)}: 山札から${movedRefs.length}枚を開示`);
  render();
}

function revealSelectedHandBrowseCards(refs = selectedRefsWithCards()) {
  if (!isHandBrowseSelection(refs)) return;
  const owner = refs[0].ref.owner;
  const revealedUids = new Set(state.handBrowse.revealedUids || []);
  refs.forEach(({ ref }) => revealedUids.add(ref.uid));
  state.handBrowse.revealedUids = [...revealedUids];
  pushLog(`${actionPlayerLabel(owner)}の手札から${refs.length}枚を確認`);
  render();
}

function openSelectedShieldBrowse(refs = selectedRefsWithCards()) {
  if (!isShieldSelection(refs)) return;
  const owner = refs[0].ref.owner;
  openZoneBrowse(owner, "shields", {
    uids: refs.map(({ ref }) => ref.uid),
    title: `${playerLabel(owner)} シールド確認 ${refs.length}枚`,
  });
}

function faceUpSelectedShields(refs = selectedRefsWithCards()) {
  const shieldRefs = refs.filter(({ ref }) => ref.zone === "shields");
  if (!isShieldSelection(shieldRefs)) return;
  const owner = shieldRefs[0].ref.owner;

  saveUndoSnapshot();
  shieldRefs.forEach(({ card }) => {
    card.faceUp = true;
    card.tapped = false;
    card.shieldCheckRevealed = false;
  });
  state.selected = [];
  state.pendingShieldAction = null;
  state.pendingDeckAction = null;
  state.pendingShieldCheckReveal = null;
  pushLog(`${actionPlayerLabel(owner)}: シールド${shieldRefs.length}枚を表にしました`);
  render();
}

function canMoveShieldCheckRefs(refs, targetZone) {
  if (!refs.every(({ ref }) => ref.zone === "shieldCheck")) return true;
  if (targetZone === "hand") return true;
  const allFaceUp = refs.every(({ card }) => card.faceUp);
  return allFaceUp && ["battle", "graveyard"].includes(targetZone);
}

function toggleTapped() {
  const refs = selectedRefsWithCards().filter(({ ref, card }) => canToggleTapped(ref.zone, card));
  if (!refs.length) return;
  saveUndoSnapshot();
  const shouldTap = refs.some(({ card }) => !card.tapped);
  refs.forEach(({ card }) => {
    card.tapped = shouldTap;
  });
  if (refs.some(({ ref }) => ref.zone === "mana")) {
    clearSelection();
  }
  pushLog(`${refs.length}枚を${shouldTap ? "タップ" : "アンタップ"}`);
  render();
}

function toggleSingleCardTapped(ref) {
  const card = findCardInZone(ref);
  if (!canToggleTapped(ref.zone, card)) return;
  if (!card) return;
  saveUndoSnapshot();
  card.tapped = !card.tapped;
  clearSelection();
  pushLog(`${card.name}を${card.tapped ? "タップ" : "アンタップ"}`);
  render();
}

function untapPlayer(slot) {
  const hasTapped = [...state.players[slot].battle, ...state.players[slot].mana].some(
    (card) => card.tapped && !card.seals?.length,
  );
  if (!hasTapped) return;
  saveUndoSnapshot();
  state.players[slot].battle.forEach((card) => {
    if (card.seals?.length) return;
    card.tapped = false;
  });
  state.players[slot].mana.forEach((card) => {
    card.tapped = false;
  });
  pushLog(`${actionPlayerLabel(slot)}を全アンタップ`);
  render();
}

function addExtraTurn() {
  saveUndoSnapshot();
  state.extraTurns[state.turn] = (state.extraTurns[state.turn] || 0) + 1;
  pushLog(`${actionPlayerLabel(state.turn)}のEXターンを追加`);
  render();
}

function endTurn() {
  saveUndoSnapshot();
  const currentTurn = state.turn;
  const usesExtraTurn = (state.extraTurns[currentTurn] || 0) > 0;
  if (usesExtraTurn) {
    state.extraTurns[currentTurn] -= 1;
  } else {
    state.turn = opponentOf(state.turn);
  }
  state.viewer = preferredViewerSlot(state.turn);
  state.turnCount[state.turn] += 1;
  state.pendingShieldCheckReveal = null;
  closeTemporaryViews();
  clearSelection();
  pushLog(`${actionPlayerLabel(state.turn)}${usesExtraTurn ? "のEXターン" : "のターン"}`);
  render();
}

function resetGame() {
  saveUndoSnapshot();
  state.players.self = emptyPlayerState();
  state.players.opponent = emptyPlayerState();
  state.turn = state.firstPlayer;
  state.viewer = preferredViewerSlot(state.firstPlayer);
  state.turnCount = startingTurnCount(state.firstPlayer);
  state.extraTurns = { self: 0, opponent: 0 };
  state.selected = [];
  state.pendingShieldAction = null;
  state.pendingDeckAction = null;
  state.pendingShieldCheckReveal = null;
  state.handMenuOwner = null;
  state.deckMenuOwner = null;
  closeTemporaryViews();
  state.log = [];
  render();
}
