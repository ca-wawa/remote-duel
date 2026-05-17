# Remote Duel Mat Prototype

GitHub Pagesで動かせる静的な対戦プレイマット試作です。

## できること

- 自分/相手それぞれのデッキZIPを読み込む
- ZIP内の `deck.json` からカード名、枚数、画像名を読む
- 読み込んだデッキをブラウザのIndexedDBへ保存する
- 山札、手札、シールド、マナ、バトルゾーン、墓地の間でカードを移動する
- ドロー、シールド追加、山札上を墓地へ、タップ/アンタップ、ターン交代

## ZIP構成

```text
my-deck.zip
  deck.json
  images/
    bolmeteus.webp
    aqua-hulcus.webp
```

## deck.json

```json
{
  "name": "火水サンプル",
  "cards": [
    {
      "name": "ボルメテウス・ホワイト・ドラゴン",
      "count": 4,
      "image": "bolmeteus.webp"
    },
    {
      "name": "アクア・ハルカス",
      "count": 4,
      "image": "aqua-hulcus.webp"
    }
  ]
}
```

`id` は省略できます。省略した場合は画像ファイル名から自動で作ります。
例: `bolmeteus.webp` -> `bolmeteus`

画像は `images/` フォルダに置いて、JSONにはファイル名だけを書く形でOKです。
自分のZIPと相手のZIPで同じ画像名を使っても大丈夫です。アプリ内部で自分/相手を区別します。
画像がないカードは `image` を省略してOKです。その場合はミニカード中央にカード名が表示されます。

## ローカル起動

```bash
python3 -m http.server 5173
```

そのあとブラウザで `http://localhost:5173` を開きます。

## オンライン対戦

Firebase CDN版SDKをscriptタグで読み込み、匿名ログイン + Realtime Databaseで同期します。npmは不要です。

- ルームIDを入力して `接続` を押すと `rooms/{roomId}` に盤面状態とログを保存します。
- 先攻側/後攻側を選ぶと、そのプレイヤー視点へ切り替わります。
- 画像データはRealtime Databaseへ保存しません。各プレイヤーが手元で読み込んだZIPの画像をローカル表示に使います。

Realtime Database rulesの最小例:

```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    }
  }
}
```

## 次に足すなら

- ルーム参加者だけが読み書きできるSecurity Rules
- Firebase接続時の先攻/後攻ラベルの見せ方改善
- deck.jsonの検証エラー表示
- カード検索とデッキ編集
