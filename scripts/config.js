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
