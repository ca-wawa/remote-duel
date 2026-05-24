"use strict";

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
  lastLocalSlot: "",
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
