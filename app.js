"use strict";

const DB_NAME = "remote-duel-mat-prototype";
const DB_VERSION = 1;
const DECK_STORE = "decks";
const MAX_UNDO_HISTORY = 30;
const ROOM_WRITE_DEBOUNCE_MS = 350;
const TAB_INSTANCE_ID =
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const firebaseConfig = {
  apiKey: "AIzaSyCkiAVvIi7GS-Sy5ukISXTv1IDE913L15k",
  authDomain: "remoteduel-9e458.firebaseapp.com",
  databaseURL: "https://remoteduel-9e458-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "remoteduel-9e458",
  storageBucket: "remoteduel-9e458.firebasestorage.app",
  messagingSenderId: "400106444751",
  appId: "1:400106444751:web:3441ea11e310cfc04724ba",
};

const PLAYERS = {
  self: { label: "自分", laneId: "lane-self" },
  opponent: { label: "相手", laneId: "lane-opponent" },
};

const ZONES = [
  { key: "battle", label: "バトルゾーン", public: true },
  { key: "mana", label: "マナゾーン", public: true },
  { key: "hand", label: "手札", public: false },
  { key: "shields", label: "シールド", public: false },
  { key: "graveyard", label: "墓地", public: true },
  { key: "pending", label: "保留状態", public: true },
  { key: "deck", label: "山札", public: false },
  { key: "revealed", label: "公開中", public: true },
  { key: "shieldCheck", label: "シールドチェック", public: false },
  { key: "judge", label: "ガチンコジャッジ", public: true },
];

const state = {
  decks: {
    self: null,
    opponent: null,
  },
  players: {
    self: emptyPlayerState(),
    opponent: emptyPlayerState(),
  },
  roomDecks: {
    self: null,
    opponent: null,
  },
  viewer: "self",
  firstPlayer: "self",
  turn: "self",
  turnCount: {
    self: 1,
    opponent: 0,
  },
  extraTurns: {
    self: 0,
    opponent: 0,
  },
  selected: [],
  pendingShieldAction: null,
  pendingDeckAction: null,
  pendingShieldCheckReveal: null,
  handMenuOwner: null,
  deckMenuOwner: null,
  zoneBrowse: null,
  handPeek: null,
  handBrowse: null,
  undoStack: [],
  log: [],
};

const uiState = {
  stackPreviewIndexes: {},
};

const els = {};
const roomSync = {
  app: null,
  auth: null,
  db: null,
  user: null,
  roomId: "",
  localSlot: "",
  seats: {},
  roomRef: null,
  presenceRef: null,
  presenceWatchRef: null,
  presence: {},
  connected: false,
  connecting: false,
  applyingRemote: false,
  writeTimer: null,
  lastSyncedHash: "",
  pendingLocalHash: "",
  clientId: getClientId(),
  status: "Firebase初期化中",
  statusType: "",
};
let pointerDrag = null;
let suppressCardClickUntil = 0;
let lastCardClick = null;

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

function getClientId() {
  const key = "remote-duel-client-id";
  try {
    const existing = sessionStorage.getItem(key) || crypto.randomUUID();
    sessionStorage.setItem(key, existing);
    return `${existing}:${TAB_INSTANCE_ID}`;
  } catch {
    return TAB_INSTANCE_ID;
  }
}

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

function emptyPlayerState() {
  return {
    deck: [],
    hand: [],
    shields: [],
    mana: [],
    battle: [],
    graveyard: [],
    pending: [],
    revealed: [],
    shieldCheck: [],
    judge: [],
    nextShieldNumber: 1,
  };
}

async function importZipDeck(slot, file) {
  if (!window.JSZip) {
    throw new Error("JSZipを読み込めませんでした。ネット接続を確認してください。");
  }

  const zip = await window.JSZip.loadAsync(file);
  const jsonFile = findDeckJson(zip);
  if (!jsonFile) {
    throw new Error("ZIP内にdeck.jsonが見つかりません。");
  }

  const jsonText = await jsonFile.async("text");
  const raw = JSON.parse(jsonText);
  const deck = normalizeDeck(raw, file.name.replace(/\.zip$/i, ""));
  const jsonBasePath = jsonFile.name.includes("/")
    ? jsonFile.name.slice(0, jsonFile.name.lastIndexOf("/") + 1)
    : "";

  for (const card of deck.cards) {
    if (!card.image) continue;
    const imageFile = findZipImageFile(zip, jsonBasePath, card.image);
    if (!imageFile) {
      console.warn(`Image not found in zip: ${card.image}`);
      continue;
    }
    card.imageBlob = await imageFile.async("blob");
    card.imageUrl = URL.createObjectURL(card.imageBlob);
  }

  state.decks[slot] = deck;
  state.roomDecks[deckInputTargetSlot(slot)] = sanitizeDeckDefinition(deck);
  await saveDeck(slot, deck);
  hydratePlayerImages(deckInputTargetSlot(slot));
}

function findDeckJson(zip) {
  return (
    zip.file("deck.json") ||
    Object.values(zip.files).find((file) => /(^|\/)deck\.json$/i.test(file.name))
  );
}

function resolveZipPath(basePath, imagePath) {
  const cleanImagePath = imagePath.replace(/^\.?\//, "");
  if (!basePath || imagePath.startsWith("/")) return cleanImagePath;
  return `${basePath}${cleanImagePath}`;
}

function findZipImageFile(zip, basePath, imagePath) {
  const cleanImagePath = imagePath.replace(/^\.?\//, "");
  const candidates = [resolveZipPath(basePath, imagePath)];
  if (cleanImagePath && !cleanImagePath.includes("/")) {
    candidates.push(resolveZipPath(basePath, `images/${cleanImagePath}`));
  }

  for (const candidate of [...new Set(candidates)]) {
    const file = zip.file(candidate);
    if (file) return file;
  }
  return null;
}

function cardIdFromImage(imagePath) {
  const filename = imagePath.replace(/^.*[\\/]/, "").trim();
  if (!filename) return "";
  return filename.replace(/\.[^.]+$/, "");
}

function normalizeDeck(raw, fallbackName) {
  const sourceCards = Array.isArray(raw) ? raw : raw.cards;
  if (!Array.isArray(sourceCards)) {
    throw new Error("deck.jsonにはcards配列が必要です。");
  }

  const deck = {
    id: raw.id || crypto.randomUUID(),
    name: raw.name || fallbackName || "Untitled deck",
    cards: sourceCards.map((card, index) => {
      const rawImage = card.image || card.imageName || "";
      const image = rawImage ? String(rawImage).trim() : "";
      const id = String(card.id || cardIdFromImage(image) || card.name || `card-${index + 1}`);
      const count = Number(card.count || 1);
      if (!Number.isInteger(count) || count < 1) {
        throw new Error(`${card.name || id} のcountが不正です。`);
      }
      return {
        id,
        name: String(card.name || id),
        count,
        image,
      };
    }),
  };

  const total = deck.cards.reduce((sum, card) => sum + card.count, 0);
  if (total < 1) {
    throw new Error("デッキ枚数が0枚です。");
  }

  return deck;
}

function instantiateDeck(deck, owner) {
  const cards = [];
  deck.cards.forEach((card) => {
    const cardId = scopedCardId(owner, card.id);
    for (let i = 0; i < card.count; i += 1) {
      cards.push({
        uid: `${cardId}-${i}-${crypto.randomUUID()}`,
        cardId,
        name: card.name,
        imageUrl: card.imageUrl || "",
        tapped: false,
        faceUp: false,
        stack: [],
        seals: [],
      });
    }
  });
  return shuffle(cards);
}

function scopedCardId(owner, cardId) {
  return `${owner}:${cardId}`;
}

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

function deckForPlayerSlot(playerSlot) {
  const localSlot = assignedLocalSlot();
  if (!roomSync.connected || !localSlot) return state.decks[playerSlot];
  if (playerSlot === localSlot) return state.decks.self || state.roomDecks[playerSlot];
  return state.roomDecks[playerSlot] || state.decks.opponent;
}

function syncLocalDeckToRoomDeck() {
  const localSlot = assignedLocalSlot();
  if (!localSlot || !state.decks.self) return;
  state.roomDecks[localSlot] = sanitizeDeckDefinition(state.decks.self);
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
    pileColumn.appendChild(renderPileZone(slot, "deck"));
    pileColumn.appendChild(renderHandPileZone(slot));
    pileColumn.appendChild(renderPileZone(slot, "graveyard"));
  } else {
    pileColumn.appendChild(renderPileZone(slot, "graveyard"));
    pileColumn.appendChild(renderHandPileZone(slot));
    pileColumn.appendChild(renderPileZone(slot, "deck"));
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
  const localSlot = assignedLocalSlot();
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
  const localSlot = assignedLocalSlot();
  if (!localSlot) return uiSlot;
  return uiSlot === "self" ? localSlot : opponentOf(localSlot);
}

function deckSlotForPlayerSlot(playerSlot) {
  const localSlot = assignedLocalSlot();
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
  return assignedLocalSlot() || fallback;
}

function enforceLocalPerspective() {
  const localSlot = assignedLocalSlot();
  if (localSlot) state.viewer = localSlot;
}

function displayBottomSlot() {
  enforceLocalPerspective();
  return assignedLocalSlot() || "self";
}

function assignedLocalSlot() {
  return ["self", "opponent"].includes(roomSync.localSlot) ? roomSync.localSlot : "";
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

function shuffle(cards) {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function restoreDecks() {
  const entries = await Promise.all(Object.keys(PLAYERS).map((slot) => loadDeck(slot)));
  entries.forEach(([slot, deck]) => {
    if (deck) {
      hydrateDeck(deck);
      state.decks[slot] = deck;
    }
  });
}

function serializeDeck(deck) {
  return {
    id: deck.id,
    name: deck.name,
    cards: deck.cards.map((card) => ({
      id: card.id,
      name: card.name,
      count: card.count,
      image: card.image,
      imageBlob: card.imageBlob || null,
      imageUrl: card.imageUrl?.startsWith("data:") ? card.imageUrl : "",
    })),
  };
}

function hydrateDeck(deck) {
  deck.cards.forEach((card) => {
    if (card.imageBlob && !card.imageUrl) {
      card.imageUrl = URL.createObjectURL(card.imageBlob);
    }
  });
  return deck;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DECK_STORE)) {
        db.createObjectStore(DECK_STORE, { keyPath: "slot" });
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

async function saveDeck(slot, deck) {
  const db = await openDb();
  await txDone(db, DECK_STORE, "readwrite", (store) => {
    store.put({ slot, deck: serializeDeck(deck) });
  });
  db.close();
}

async function loadDeck(slot) {
  const db = await openDb();
  const record = await new Promise((resolve, reject) => {
    const tx = db.transaction(DECK_STORE, "readonly");
    const store = tx.objectStore(DECK_STORE);
    const request = store.get(slot);
    request.addEventListener("success", () => resolve(request.result || null));
    request.addEventListener("error", () => reject(request.error));
  });
  db.close();
  return [slot, record?.deck || null];
}

function txDone(db, storeName, mode, work) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    work(tx.objectStore(storeName));
    tx.addEventListener("complete", resolve);
    tx.addEventListener("error", () => reject(tx.error));
    tx.addEventListener("abort", () => reject(tx.error));
  });
}

function createSampleDeck(slot) {
  const prefix = slot === "self" ? "A" : "B";
  const names = [
    "ルビー・ストライカー",
    "アクア・ランナー",
    "フォレスト・ガード",
    "ライトニング・ゲート",
    "シャドウ・スパーク",
    "メタル・チャージャー",
    "クリムゾン・ボルト",
    "ミスト・ウォール",
    "サンライズ・ブレード",
    "ディープ・サーチ",
  ];

  return {
    id: `sample-${slot}`,
    name: `${PLAYERS[slot].label}サンプル`,
    cards: names.map((name, index) => ({
      id: `${prefix}-${index + 1}`,
      name,
      count: 4,
      image: "",
      imageUrl: sampleCardImage(name, index, slot),
    })),
  };
}

function sampleCardImage(name, index, slot) {
  const palettes =
    slot === "self"
      ? [
          ["#0b7a53", "#dff1e8"],
          ["#22577a", "#d7ecf6"],
          ["#8c4a2f", "#f7e2d3"],
        ]
      : [
          ["#6f3d7b", "#eadcf2"],
          ["#99582a", "#f3dfc1"],
          ["#345995", "#d7e4f7"],
        ];
  const [base, soft] = palettes[index % palettes.length];
  const escaped = escapeHtml(name);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="300" height="420" viewBox="0 0 300 420">
      <rect width="300" height="420" rx="20" fill="${soft}"/>
      <rect x="18" y="18" width="264" height="384" rx="16" fill="white" stroke="${base}" stroke-width="8"/>
      <rect x="38" y="48" width="224" height="188" rx="12" fill="${base}" opacity="0.92"/>
      <circle cx="94" cy="118" r="38" fill="white" opacity="0.24"/>
      <path d="M54 204 C104 142, 146 236, 246 154 L246 236 L54 236 Z" fill="white" opacity="0.28"/>
      <text x="150" y="292" text-anchor="middle" font-family="system-ui, sans-serif" font-size="25" font-weight="800" fill="#162019">${escaped}</text>
      <text x="150" y="344" text-anchor="middle" font-family="system-ui, sans-serif" font-size="20" font-weight="700" fill="${base}">SAMPLE ${index + 1}</text>
    </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
