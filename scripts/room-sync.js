"use strict";

function initFirebase() {
  if (!window.firebase?.initializeApp) {
    roomSync.status = "Firebase SDKを読み込めませんでした";
    roomSync.statusType = "error";
    return;
  }

  try {
    roomSync.app = window.firebase.apps?.length
      ? window.firebase.app()
      : window.firebase.initializeApp(firebaseConfig);
    roomSync.auth = window.firebase.auth();
    roomSync.db = window.firebase.database();
    roomSync.auth.onAuthStateChanged((user) => {
      roomSync.user = user;
      if (!roomSync.connected && !roomSync.connecting) {
        roomSync.status = user ? "匿名ログイン済み" : "匿名ログイン待機中";
        roomSync.statusType = user ? "" : "error";
        renderRoomControls();
      }
    });
    roomSync.auth.signInAnonymously().catch((error) => {
      roomSync.status = firebaseErrorMessage(error, "匿名ログインエラー");
      roomSync.statusType = "error";
      renderRoomControls();
    });
  } catch (error) {
    roomSync.status = firebaseErrorMessage(error, "Firebase初期化エラー");
    roomSync.statusType = "error";
  }
}

function firebaseErrorMessage(error, prefix) {
  const code = String(error?.code || "").toLowerCase();
  const message = error?.message || "不明なエラー";
  if (code.includes("unauthorized-domain")) {
    return `${prefix}: Firebase ConsoleのAuthorized domainsに ca-wawa.github.io を追加してください`;
  }
  if (code.includes("permission") || message.includes("PERMISSION_DENIED")) {
    return `${prefix}: Realtime Database rulesを確認してください`;
  }
  return `${prefix}: ${message}`;
}

async function connectRoom() {
  if (!roomSync.db || !roomSync.auth) {
    roomSync.status = "Firebaseがまだ使えません";
    roomSync.statusType = "error";
    renderRoomControls();
    return;
  }

  const roomId = normalizeRoomId(els.roomIdInput.value || generateRoomId());
  if (!roomId) {
    roomSync.status = "ルームIDを入力してください";
    roomSync.statusType = "error";
    renderRoomControls();
    return;
  }

  roomSync.connecting = true;
  roomSync.status = "接続中...";
  roomSync.statusType = "";
  renderRoomControls();

  try {
    if (!roomSync.user) {
      const credential = await roomSync.auth.signInAnonymously();
      roomSync.user = credential.user;
    }

    if (roomSync.connected) disconnectRoom({ silent: true });

    roomSync.roomId = roomId;
    roomSync.localSlot = "";
    roomSync.seats = {};
    roomSync.roomRef = roomSync.db.ref(`rooms/${roomId}`);
    roomSync.presenceRef = roomSync.roomRef.child(`presence/${roomSync.clientId}`);
    roomSync.presenceWatchRef = roomSync.roomRef.child("presence");
    roomSync.connected = true;
    clearSelection();
    closeTemporaryViews();

    await roomSync.presenceRef.set({
      clientId: roomSync.clientId,
      joinedAt: window.firebase.database.ServerValue.TIMESTAMP,
    });
    roomSync.presenceRef.onDisconnect().remove();
    roomSync.presenceWatchRef.on("value", handlePresenceSnapshot);
    await claimOpenPlayerSlot();
    if (!assignedLocalSlot()) {
      throw new Error("この部屋は満席です");
    }

    const snapshot = await roomSync.roomRef.once("value");
    const payload = snapshot.val();
    if (payload?.state) {
      applyRoomPayload(payload);
    } else {
      await writeRoomState({ force: true });
    }

    roomSync.roomRef.on("value", handleRoomSnapshot);
    roomSync.status = `接続中: ${roomId} / ${seatStatusText()}`;
    roomSync.statusType = "connected";
  } catch (error) {
    disconnectRoom({ silent: true });
    roomSync.status = firebaseErrorMessage(error, "接続エラー");
    roomSync.statusType = "error";
  } finally {
    roomSync.connecting = false;
    render();
  }
}

function disconnectRoom(options = {}) {
  if (roomSync.writeTimer) {
    clearTimeout(roomSync.writeTimer);
    roomSync.writeTimer = null;
  }
  if (roomSync.roomRef) roomSync.roomRef.off("value", handleRoomSnapshot);
  if (roomSync.presenceWatchRef) {
    roomSync.presenceWatchRef.off("value", handlePresenceSnapshot);
    roomSync.presenceWatchRef = null;
  }
  if (roomSync.presenceRef) {
    roomSync.presenceRef.remove();
    roomSync.presenceRef = null;
  }

  const previousSlot = assignedLocalSlot();
  if (previousSlot) {
    roomSync.lastLocalSlot = previousSlot;
    state.viewer = previousSlot;
  }
  roomSync.roomRef = null;
  roomSync.connected = false;
  roomSync.connecting = false;
  roomSync.localSlot = "";
  roomSync.seats = {};
  roomSync.presence = {};
  roomSync.lastSyncedHash = "";
  roomSync.pendingLocalHash = "";
  if (!options.silent) {
    roomSync.status = roomSync.user ? "匿名ログイン済み" : "未接続";
    roomSync.statusType = "";
    render();
  }
}

function normalizeRoomId(value) {
  return String(value || "")
    .trim()
    .replace(/[.#$/\[\]]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 48);
}

function generateRoomId() {
  return `room-${Math.random().toString(36).slice(2, 8)}`;
}

function renderRoomControls() {
  if (!els.syncStatus) return;
  renderViewerLabels();
  if (assignedLocalSlot()) {
    els.viewerSelect.value = roomSync.localSlot;
  }
  els.roomIdInput.value = roomSync.roomId || els.roomIdInput.value;
  els.roomIdInput.disabled = roomSync.connected || roomSync.connecting;
  els.viewerSelect.disabled = roomSync.connected;
  els.joinRoomButton.disabled = roomSync.connected || roomSync.connecting;
  els.leaveRoomButton.disabled = !roomSync.connected && !roomSync.connecting;
  const needsSeat = roomSync.connected && !assignedLocalSlot();
  els.randomSeatButton.disabled = !roomSync.connected || roomSync.connecting || needsSeat;
  els.claimFirstButton.disabled = !roomSync.connected || roomSync.connecting || needsSeat;
  els.claimSecondButton.disabled = !roomSync.connected || roomSync.connecting || needsSeat;
  els.setupButton.disabled = needsSeat;
  els.drawButton.disabled = needsSeat;
  els.untapButton.disabled = needsSeat;
  els.extraTurnButton.disabled = needsSeat;
  els.endTurnButton.disabled = needsSeat;
  els.seatStatus.textContent = seatStatusText();
  els.syncStatus.textContent = roomSync.status || "未接続";
  els.syncStatus.className = `sync-status ${roomSync.statusType || ""}`.trim();
  renderReadoutConnectionStatus();
}

function headerConnectionStatus() {
  if (roomSync.connected) {
    if (!assignedLocalSlot()) return activePeerClientIds().length ? "2人接続" : "担当未決定";
    return activePeerClientIds().length ? "2人接続" : "相手待ち";
  }
  if (roomSync.connecting) return "接続中...";
  if (roomSync.statusType === "error") return "接続エラー";
  if (roomSync.user) return "未接続";
  return "準備中";
}

function headerConnectionType() {
  if (roomSync.statusType === "error") return "error";
  if (roomSync.connected) return "connected";
  return "pending";
}

async function runRoomAction(action) {
  try {
    await action();
  } catch (error) {
    roomSync.status = firebaseErrorMessage(error, "ルーム操作エラー");
    roomSync.statusType = "error";
    renderRoomControls();
  }
}

async function claimOpenPlayerSlot() {
  if (!roomSync.connected || !roomSync.roomRef) return;
  const activeClientIds = await readActiveClientIds();
  const result = await updateRoomSeats((seats) => {
    const next = removeInactiveSeats(removeClientFromSeats(seats, roomSync.clientId), activeClientIds);
    if (!next.self) {
      next.self = roomSync.clientId;
      return next;
    }
    if (!next.opponent) {
      next.opponent = roomSync.clientId;
      return next;
    }
    if (slotForClient(next, roomSync.clientId)) return next;
    return null;
  });

  if (!result.committed) {
    roomSync.status = "この部屋は満席です";
    roomSync.statusType = "error";
    renderRoomControls();
    return;
  }
  const slot = slotForClient(normalizeSeats(result.snapshot.val() || {}), roomSync.clientId);
  if (slot) await updatePresenceSlot(slot);
  applySeats(result.snapshot.val() || {});
}

async function chooseFirstPlayer(firstSlot) {
  if (!roomSync.connected || !assignedLocalSlot()) return;
  if (!["self", "opponent"].includes(firstSlot)) return;
  saveUndoSnapshot();
  state.firstPlayer = firstSlot;
  state.turn = firstSlot;
  state.turnCount = startingTurnCount(firstSlot);
  state.extraTurns = { self: 0, opponent: 0 };
  clearSelection();
  closeTemporaryViews();
  pushLog(`${actionPlayerLabel(firstSlot)}が先攻になりました`);
  render();
  await writeRoomState({ force: true });
}

async function randomizeFirstPlayer() {
  if (!roomSync.connected || !roomSync.roomRef || !assignedLocalSlot()) return;
  const activeClientIds = await readActiveClientIds();
  const peerClientIds = [...activeClientIds].filter((clientId) => clientId !== roomSync.clientId);
  if (peerClientIds.length !== 1) {
    roomSync.status = "ランダム決定は2人接続の状態で実行してください";
    roomSync.statusType = "error";
    renderRoomControls();
    return;
  }
  const firstSlot = Math.random() < 0.5 ? "self" : "opponent";
  await chooseFirstPlayer(firstSlot);
}

async function updateRoomSeats(updater) {
  const seatsRef = roomSync.roomRef.child("seats");
  const result = await seatsRef.transaction((current) => {
    const next = updater(normalizeSeats(current));
    return next || undefined;
  });
  return { committed: result.committed, snapshot: result.snapshot };
}

async function readActiveClientIds() {
  const snapshot = await roomSync.roomRef.child("presence").once("value");
  return new Set(
    Object.values(snapshot.val() || {})
      .map((entry) => entry?.clientId)
      .filter(Boolean),
  );
}

function handlePresenceSnapshot(snapshot) {
  roomSync.presence = snapshot.val() || {};
  renderRoomControls();
}

function activeClientIdsFromPresence() {
  return new Set(
    Object.values(roomSync.presence || {})
      .map((entry) => entry?.clientId)
      .filter(Boolean),
  );
}

function activePeerClientIds() {
  return [...activeClientIdsFromPresence()].filter((clientId) => clientId !== roomSync.clientId);
}

async function updatePresenceSlot(slot) {
  if (!roomSync.presenceRef) return;
  await roomSync.presenceRef.update({ slot });
}

function applySeats(rawSeats = {}) {
  roomSync.seats = normalizeSeats(rawSeats);
  roomSync.localSlot = slotForClient(roomSync.seats, roomSync.clientId);
  if (roomSync.localSlot) roomSync.lastLocalSlot = roomSync.localSlot;
  if (roomSync.connected) {
    roomSync.status = `接続中: ${roomSync.roomId} / ${seatStatusText()}`;
    roomSync.statusType = "connected";
  }
}

function normalizeSeats(rawSeats = {}) {
  rawSeats = rawSeats || {};
  const seats = {};
  if (rawSeats.self) seats.self = String(rawSeats.self);
  if (rawSeats.opponent) seats.opponent = String(rawSeats.opponent);
  return seats;
}

function slotForClient(seats, clientId) {
  if (seats.self === clientId) return "self";
  if (seats.opponent === clientId) return "opponent";
  return "";
}

function removeClientFromSeats(seats, clientId) {
  if (seats.self === clientId) delete seats.self;
  if (seats.opponent === clientId) delete seats.opponent;
  return seats;
}

function removeInactiveSeats(seats, activeClientIds) {
  if (seats.self && !activeClientIds.has(seats.self)) delete seats.self;
  if (seats.opponent && !activeClientIds.has(seats.opponent)) delete seats.opponent;
  return seats;
}

function scheduleRoomStateWrite() {
  if (!roomSync.connected || roomSync.connecting || roomSync.applyingRemote || !roomSync.roomRef) {
    return;
  }
  const { hash } = buildRoomPayload();
  if (hash === roomSync.lastSyncedHash) return;
  roomSync.pendingLocalHash = hash;
  if (roomSync.writeTimer) clearTimeout(roomSync.writeTimer);
  roomSync.writeTimer = setTimeout(() => {
    roomSync.writeTimer = null;
    writeRoomState().catch((error) => {
      roomSync.pendingLocalHash = "";
      roomSync.status = firebaseErrorMessage(error, "同期エラー");
      roomSync.statusType = "error";
      renderRoomControls();
    });
  }, ROOM_WRITE_DEBOUNCE_MS);
}

async function writeRoomState(options = {}) {
  if (!roomSync.connected || !roomSync.roomRef) return;
  const { stateData, logData, hash } = buildRoomPayload();
  if (!options.force && hash === roomSync.lastSyncedHash) return;
  await roomSync.roomRef.update({
    state: stateData,
    log: logData,
    updatedAt: window.firebase.database.ServerValue.TIMESTAMP,
    updatedBy: roomSync.clientId,
  });
  roomSync.lastSyncedHash = hash;
  if (roomSync.pendingLocalHash === hash) roomSync.pendingLocalHash = "";
}

function handleRoomSnapshot(snapshot) {
  const payload = snapshot.val();
  if (!payload?.state) {
    const previousSlot = assignedLocalSlot();
    applySeats(payload?.seats || {});
    if (previousSlot !== assignedLocalSlot()) render();
    return;
  }
  applyRoomPayload(payload);
}

function applyRoomPayload(payload) {
  const previousSlot = assignedLocalSlot();
  applySeats(payload.seats || {});
  const seatChanged = previousSlot !== assignedLocalSlot();
  const logData = normalizeRoomLog(payload.log);
  const hash = roomHash(payload.state, logData);
  if (hash === roomSync.lastSyncedHash) {
    if (seatChanged) render();
    return;
  }
  if (roomSync.pendingLocalHash && hash !== roomSync.pendingLocalHash) {
    if (seatChanged) render();
    return;
  }

  const localSelection = clonePlain(state.selected || []);
  const localPendingShieldAction = clonePlain(state.pendingShieldAction || null);
  const localPendingDeckAction = clonePlain(state.pendingDeckAction || null);
  const localZoneBrowse = clonePlain(state.zoneBrowse || null);
  const localHandPeek = clonePlain(state.handPeek || null);
  const localHandBrowse = clonePlain(state.handBrowse || null);
  roomSync.applyingRemote = true;
  state.roomDecks = normalizeRoomDecks(payload.state.roomDecks || state.roomDecks);
  state.players = hydrateSyncedPlayers(payload.state.players || {});
  state.viewer = preferredViewerSlot(state.viewer || "self");
  state.firstPlayer = normalizePlayerSlot(payload.state.firstPlayer, "self");
  state.turn = normalizePlayerSlot(payload.state.turn, state.firstPlayer);
  state.turnCount = clonePlain(payload.state.turnCount || startingTurnCount(state.firstPlayer));
  state.extraTurns = clonePlain(payload.state.extraTurns || { self: 0, opponent: 0 });
  state.log = logData;
  state.pendingShieldCheckReveal = normalizeSyncedShieldCheckReveal(
    payload.state.pendingShieldCheckReveal,
  );
  restoreSelectionAfterRemote(localSelection, {
    pendingShieldAction: localPendingShieldAction,
    pendingDeckAction: localPendingDeckAction,
  });
  state.handMenuOwner = null;
  state.deckMenuOwner = null;
  restoreTemporaryViewsAfterRemote(localZoneBrowse, localHandPeek, localHandBrowse);
  roomSync.lastSyncedHash = hash;
  if (roomSync.pendingLocalHash === hash) roomSync.pendingLocalHash = "";
  render();
  roomSync.applyingRemote = false;
}

function restoreSelectionAfterRemote(selection, pending = {}) {
  state.selected = (Array.isArray(selection) ? selection : []).filter((ref) => findCardInZone(ref));
  state.pendingShieldAction = state.selected.length ? pending.pendingShieldAction || null : null;
  state.pendingDeckAction = state.selected.length ? pending.pendingDeckAction || null : null;
}

function restoreTemporaryViewsAfterRemote(zoneBrowse, handPeek, handBrowse) {
  state.zoneBrowse = null;
  state.handPeek = null;
  state.handBrowse = null;

  const browse = normalizeZoneBrowseAfterRemote(zoneBrowse);
  if (browse) {
    state.zoneBrowse = browse;
    return;
  }

  if (handPeek?.owner && state.players[handPeek.owner]) {
    state.handPeek = handPeek;
    return;
  }

  const browseHand = normalizeHandBrowseAfterRemote(handBrowse);
  if (browseHand) state.handBrowse = browseHand;
}

function normalizeZoneBrowseAfterRemote(zoneBrowse) {
  if (!zoneBrowse?.owner || !zoneBrowse.zone) return null;
  const cards = state.players[zoneBrowse.owner]?.[zoneBrowse.zone];
  if (!Array.isArray(cards)) return null;

  const browse = clonePlain(zoneBrowse);
  if (Array.isArray(browse.uids)) {
    const liveUids = new Set(cards.map((card) => card.uid));
    browse.uids = browse.uids.filter((uid) => liveUids.has(uid));
    if (!browse.uids.length) return null;
  }
  return browse;
}

function normalizeHandBrowseAfterRemote(handBrowse) {
  if (!handBrowse?.owner || !state.players[handBrowse.owner]) return null;
  const hand = state.players[handBrowse.owner].hand || [];
  if (!hand.length) return null;
  const liveUids = new Set(hand.map((card) => card.uid));
  return {
    owner: handBrowse.owner,
    revealedUids: (handBrowse.revealedUids || []).filter((uid) => liveUids.has(uid)),
  };
}

function buildRoomPayload() {
  const stateData = {
    players: sanitizePlayersForRoom(),
    roomDecks: sanitizeRoomDecks(),
    firstPlayer: normalizePlayerSlot(state.firstPlayer, "self"),
    turn: normalizePlayerSlot(state.turn, state.firstPlayer),
    turnCount: clonePlain(state.turnCount),
    extraTurns: clonePlain(state.extraTurns),
    pendingShieldCheckReveal: normalizeLocalShieldCheckReveal(),
  };
  const logData = state.log.slice(-120);
  return {
    stateData,
    logData,
    hash: roomHash(stateData, logData),
  };
}

function roomHash(stateData, logData) {
  return JSON.stringify({ state: stateData, log: logData });
}

function sanitizePlayersForRoom() {
  return Object.keys(PLAYERS).reduce((players, slot) => {
    const player = state.players[slot] || emptyPlayerState();
    players[slot] = {
      deck: sanitizeCardsForRoom(player.deck),
      hand: sanitizeCardsForRoom(player.hand),
      shields: sanitizeCardsForRoom(player.shields),
      mana: sanitizeCardsForRoom(player.mana),
      battle: sanitizeCardsForRoom(player.battle),
      graveyard: sanitizeCardsForRoom(player.graveyard),
      pending: sanitizeCardsForRoom(player.pending),
      revealed: sanitizeCardsForRoom(player.revealed),
      shieldCheck: sanitizeCardsForRoom(player.shieldCheck),
      judge: sanitizeCardsForRoom(player.judge),
      nextShieldNumber: player.nextShieldNumber || 1,
    };
    return players;
  }, {});
}

function sanitizeRoomDecks() {
  syncLocalDeckToRoomDeck();
  return Object.keys(PLAYERS).reduce((decks, slot) => {
    decks[slot] = sanitizeDeckDefinition(state.roomDecks[slot]);
    return decks;
  }, {});
}

function sanitizeDeckDefinition(deck) {
  if (!deck) return null;
  return {
    id: deck.id || "",
    name: deck.name || "Untitled deck",
    cards: (deck.cards || []).map((card) => ({
      id: card.id || cardIdFromImage(card.image || "") || card.name || "",
      name: card.name || card.id || "カード",
      count: Math.max(1, Math.floor(Number(card.count || 1))),
      image: card.image || "",
    })),
  };
}

function normalizeRoomDecks(decks = {}) {
  return Object.keys(PLAYERS).reduce((result, slot) => {
    result[slot] = decks[slot] ? sanitizeDeckDefinition(decks[slot]) : state.roomDecks[slot] || null;
    return result;
  }, {});
}

function normalizeLocalShieldCheckReveal() {
  const owner = state.pendingShieldCheckReveal?.owner;
  if (!PLAYERS[owner]) return null;
  return hasUnrevealedShieldCheck(owner) ? { owner } : null;
}

function normalizeSyncedShieldCheckReveal(pending) {
  const owner = pending?.owner;
  if (!PLAYERS[owner]) return null;
  return hasUnrevealedShieldCheck(owner) ? { owner } : null;
}

function hasUnrevealedShieldCheck(owner) {
  return state.players[owner]?.shieldCheck?.some((card) => !card.faceUp && !card.shieldCheckRevealed);
}

function sanitizeCardsForRoom(cards = []) {
  return cards.map((card) => sanitizeCardForRoom(card));
}

function sanitizeCardForRoom(card) {
  const clean = {
    uid: card.uid,
    cardId: card.cardId || "",
    name: card.name || "カード",
    tapped: Boolean(card.tapped),
    faceUp: Boolean(card.faceUp),
    stack: sanitizeCardsForRoom(card.stack || []),
    seals: sanitizeCardsForRoom(card.seals || []),
  };
  if (card.shieldNumber) clean.shieldNumber = card.shieldNumber;
  if (card.shieldCheckRevealed) clean.shieldCheckRevealed = true;
  return clean;
}

function hydrateSyncedPlayers(players) {
  return Object.keys(PLAYERS).reduce((result, slot) => {
    const source = players[slot] || {};
    const player = emptyPlayerState();
    Object.keys(player).forEach((zone) => {
      if (Array.isArray(player[zone])) {
        player[zone] = hydrateSyncedCards(slot, source[zone] || []);
      }
    });
    player.nextShieldNumber =
      Number.isInteger(source.nextShieldNumber) && source.nextShieldNumber > 0
        ? source.nextShieldNumber
        : highestShieldNumber(player) + 1;
    result[slot] = player;
    return result;
  }, {});
}

function hydrateSyncedCards(slot, cards = []) {
  return cards.map((card) => hydrateSyncedCard(slot, card));
}

function hydrateSyncedCard(slot, card) {
  return {
    uid: card.uid,
    cardId: card.cardId || "",
    name: card.name || "カード",
    imageUrl: resolveLocalCardImageUrl(slot, card),
    tapped: Boolean(card.tapped),
    faceUp: Boolean(card.faceUp),
    shieldNumber: card.shieldNumber || undefined,
    shieldCheckRevealed: Boolean(card.shieldCheckRevealed),
    stack: hydrateSyncedCards(slot, card.stack || []),
    seals: hydrateSyncedCards(slot, card.seals || []),
  };
}

function resolveLocalCardImageUrl(slot, card) {
  const deck = state.decks[deckSlotForPlayerSlot(slot)];
  if (!deck) return "";
  const rawCardId = unscopedCardId(card.cardId || "");
  const match = deck.cards.find(
    (deckCard) =>
      scopedCardId(slot, deckCard.id) === card.cardId ||
      deckCard.id === rawCardId ||
      deckCard.name === card.name,
  );
  return match?.imageUrl || "";
}

function unscopedCardId(cardId) {
  return String(cardId).includes(":") ? String(cardId).slice(String(cardId).indexOf(":") + 1) : cardId;
}

function hydratePlayerImages(slot) {
  const player = state.players[slot];
  if (!player) return;
  Object.keys(player).forEach((zone) => {
    if (!Array.isArray(player[zone])) return;
    hydrateCardImages(slot, player[zone]);
  });
}

function hydrateCardImages(slot, cards) {
  cards.forEach((card) => {
    card.imageUrl = resolveLocalCardImageUrl(slot, card) || card.imageUrl || "";
    if (card.stack?.length) hydrateCardImages(slot, card.stack);
    if (card.seals?.length) hydrateCardImages(slot, card.seals);
  });
}

function normalizeRoomLog(log) {
  if (Array.isArray(log)) return log.filter((entry) => typeof entry === "string");
  if (!log || typeof log !== "object") return [];
  return Object.keys(log)
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => log[key])
    .filter((entry) => typeof entry === "string");
}
