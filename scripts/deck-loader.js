"use strict";

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

async function swapLoadedDecks() {
  [state.decks.self, state.decks.opponent] = [state.decks.opponent, state.decks.self];
  Object.keys(PLAYERS).forEach((slot) => {
    const targetSlot = deckInputTargetSlot(slot);
    state.roomDecks[targetSlot] = sanitizeDeckDefinition(state.decks[slot]);
  });
  await Promise.all(Object.keys(PLAYERS).map((slot) => saveDeck(slot, state.decks[slot])));
  Object.keys(PLAYERS).forEach((slot) => hydratePlayerImages(slot));
  pushLog("読み込みZIPを入れ替えました");
  render();
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
    if (!deck) {
      store.delete(slot);
      return;
    }
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
