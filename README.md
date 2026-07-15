# タイミングチャート エディタ

[English](README.en.md)

FPGA・組み込み向けの **タイミングチャート（波形図）** をブラウザ内で作図するツールです。
クロック / データ / 制御信号、立ち上がり・立ち下がりエッジ、High / Low / X / Z、複数bitバス、
セットアップ・ホールド注釈を編集でき、SVG/PNG/JSON/SPICE-PWL 出力と共有リンクに対応します。

**▶ Live: <https://kakuteki.github.io/timing-chart/>**（スマホ対応）

- **完全クライアントサイド**（サーバー・DBなし。処理はすべてブラウザ内）
- 描画エンジンは [WaveDrom](https://github.com/wavedrom/wavedrom)
- **ハイブリッド編集**: GUIテーブルと WaveJSON テキストを相互同期
- 配布は GitHub Pages

## 使い方（編集）

- **GUIグリッド**: 上の「状態」ピッカーで置くものを選び、マスをクリック/ドラッグで描く
  - 既定の **「High/Low切替」** はクリックで `0`⇄`1` をトグル
  - **High（オン）/ Low（オフ）/ クロック / バス（値）/ 延長** を選ぶとその状態を塗る
  - **「もっと」** から `x`（不定）・`z`（Hi-Z）・矢印付きクロック（`P/N`）・バス`2`–`9`・ギャップ（`|`）、および**順送り**（クリックで `0→1→p→n→P→N→x→z→=` を一巡、`Shift+クリック`で逆送り）
  - **「延長」** または `Alt+クリック` で直前セルを延長（`.`）。横ドラッグで連続して塗れる
- **バス値**: `=` のセルは「バス値」パネルでラベル（`data[]`）を編集
- **注釈**: 信号を選び tick を指定して「マーカー追加」→ マーカー間を矢印で接続（setup/hold 等）
- **WaveJSON テキスト**: 直接編集も可能。無効なJSONの間は直前の図を保持し、エラーを表示（JSON5構文＝末尾カンマ等も許容）
- **クロック生成 / ＋信号 / ＋tick** はツールバーと信号エディタ上部から
- **信号の複製**: 信号を選び、ツールバーの「複製」で1つ下に複製
- **周期・位相（分周クロック）**: 「周期・位相」パネルで `period`/`phase` を設定し clk/2 等を作成（マス目編集は `period=1` のとき正確。`period≠1` 時は警告とコードタブ誘導）
- **タイトル・時間軸**: 「タイトル・時間軸」パネルで図のタイトル・下注記・サイクル番号（WaveDrom の `head`/`foot`）を設定。エクスポートにも反映
- **モバイル**: 行操作は「⋯」に集約、グリッドは縦横スクロール可。「スワイプで塗る」をオンにすると指のスワイプで連続塗り
- キーボード操作（矢印で移動 / Enter・Space で適用 / Alt+Enter で延長）に対応

## 出力・共有

- **SVG / PNG（1×/2×/4×・背景透過オプション） / JSON / SPICE-PWL保存** … ツールバーから
- **画像コピー** … PNG をクリップボードへ（スライド/ドキュメントに貼り付け）
- **JSON読込** … `.wavejson` / `.json` を読み込み
- **共有リンク** … モデルを圧縮してURLハッシュ（`#d=…`）に格納。リンクを開くと復元（巨大/過多な共有は安全に拒否、後述）

## 開発

```bash
npm install
npm run dev        # http://localhost:5173/ （BASE_PATH=/ を内部使用）
npm run build      # 型チェック + 本番ビルド → dist/
npm run preview
npm test           # 結合/単体テスト（bridge・WaveDrom描画・wave-codec・GUIアクション・封筒/共有）
```

> テストは `node --test`。`pretest` が `src/model`・`src/state` を esbuild でバンドルし、
> TS のコアロジック（可逆 wave-codec・GUI変換アクション等）も CI で検証します。

## Docker

本番用コンテナは <http://localhost:8080> でビルド済みアプリを配信します。

```bash
docker compose up --build
```

API サービスにはサーバー環境（または Compose の `.env`）から `AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL` を渡します。
`AI_API_KEY` は必ずサーバー側だけに置き、`VITE_AI_API_KEY` など Vite/クライアント環境変数には絶対に入れないでください。

Vite を使う開発環境は <http://localhost:5173> で起動します。

```bash
docker compose -f compose.yaml -f compose.dev.yaml up --build
```

任意のローカルブリッジはポート `51123` で利用できます。

```bash
docker compose -f compose.yaml -f compose.dev.yaml --profile dev up --build
```

このコマンドは開発用の web/API スタックと `dev` プロファイルのブリッジをまとめて起動します。
ブリッジだけを起動する場合も、先にこの開発スタックを起動しておいてください。

### 公開・社内ネットワーク公開時の注意

本番 Compose の web ポートは既定で `127.0.0.1:8080` にのみバインドされます。会社の他の端末から利用する場合は、Docker ポートを直接公開せず、ホスト側の Nginx などのリバースプロキシを HTTPS で設定し、次の対策を行ってください。

- 会社の SSO、VPN、またはリバースプロキシの認証を必須にする
- 会社のネットワーク範囲だけを許可し、外部インターネットから直接アクセスできないようにする
- `51124`（AI API）と `51123`（ブリッジ）を公開しない。ブリッジは開発時だけ、ループバックで使用する
- リバースプロキシからアプリへは `127.0.0.1:8080` に転送する。Host/Origin のチェックにより、想定外の値は `403` になります
- AI API キーは `.env`、Secret Manager などのサーバー側だけで管理し、GitHub やブラウザへ出さない
- このアプリはチャート内容、チャット履歴、変更依頼を設定した AI プロバイダーへ送信するため、会社のデータ保護規程とプロバイダーの契約を確認する
- リバースプロキシ側でも認証、レート制限、アクセスログの機密情報マスキングを設定する

認証なしでインターネットへ公開する構成はサポート対象外です。既定の同時 AI リクエスト制限は濫用緩和用であり、ユーザー認証の代わりにはなりません。

## AIチャットの設定

オプションのチャットパネルは、サーバー側の Node プロキシ経由で OpenAI互換サービスを利用します。
2つのターミナルで Vite の画面と API プロキシを起動します。

```bash
npm run dev        # ブラウザ画面: http://localhost:5173/
npm run api        # サーバー側プロキシ: http://localhost:51124/
```

`npm run api` の前に、プロキシのプロセスへ次の環境変数を設定します。

- `AI_BASE_URL`: プロバイダーのベースURL（例: `https://api.openai.com/v1`）。プロキシは末尾に `/chat/completions` を付けて呼び出します
- `AI_API_KEY`: プロバイダーの API キー
- `AI_MODEL`: プロバイダーが提供するモデル識別子

例:

```bash
AI_BASE_URL=https://api.openai.com/v1 \
AI_API_KEY=your-key \
AI_MODEL=your-model \
npm run api
```

`AI_API_KEY` はサーバー側だけで管理してください。**Vite/クライアントの環境変数（`VITE_AI_API_KEY` など）や
ソースコード、公開フロントエンドに絶対に入れないでください**。クライアント用の値はブラウザ利用者に公開されます。
ブラウザはローカルプロキシにだけチャット要求を送り、プロキシがサービスへの接続時にキーを付加します。

チャットパネルで変更内容を入力し、**提案を生成**します。説明・警告・一時的な波形プレビューと、必要に応じて
技術的な WaveJSON 差分を確認してから、**提案を適用**または**破棄**します。適用するとエディタ（Undo履歴を含む）が更新され、
破棄するとチャートは変更されません。

## Claude Code 連携（ブリッジ / HTTPエンドポイント）

外部ツール（Claude Code など）から、ブラウザで開いているチャートを読み書きできます。
依存ゼロのローカルHTTPサーバ `bridge/server.mjs` がモデルを仲介し、ブラウザとは
SSE＋POSTで**双方向同期**します（疎結合・本体を止めない設計）。

```bash
npm run build      # 先にビルド（ブリッジがdist/も配信する）
npm run bridge     # http://localhost:51123 で起動
```

- ブラウザで `http://localhost:51123/timing-chart/` を開く（または `npm run dev` のローカル/公開サイトでも可）
- ツールバーの **「ブリッジ接続」** を押す（ドットが緑で接続）
- これで Claude Code 側の編集 ⇄ ブラウザの編集 が同期します

### API（CORS有効）

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/health` | `{ ok, clients, rev }` |
| GET | `/model` | 現在の WaveJSON を取得 |
| POST | `/model` | WaveJSON をセット（`signal`配列必須・不正は400）→ 全クライアントへ配信 |
| GET | `/events` | SSE。接続時に現在値、以後は変更のたびに push |

### Claude Code からの編集例

```bash
# 現在のモデルを取得
curl -s http://localhost:51123/model | jq .

# モデルを差し替え（ブラウザが即更新）
curl -s -X POST http://localhost:51123/model \
  -H 'Content-Type: application/json' \
  -d '{"signal":[{"name":"clk","wave":"P.P.P."},{"name":"d","wave":"x=.=.x","data":["A","B"]}]}'
```

ポートは `BRIDGE_PORT` 環境変数で変更可（既定 51123）。公開サイト(HTTPS)から
`http://localhost` への接続は **Chrome/Edge/Firefox では通りますが Safari はブロック**
します。確実なのはローカル運用（`npm run bridge` の配信URLを開く）です。

#### セキュリティ
- **127.0.0.1 のみ**で待ち受け（LANには出さない）
- **CSRF/DNSリバインド対策**: 状態変更系リクエストは許可 Origin（localhost / 本 Pages）＋
  ループバック Host のみ受理。`curl`（Origin なし）は従来どおり可
- 不正/巨大入力は 4xx で拒否（5MB上限・型検証）、不正パスや不正%エンコードも安全に処理
- SSE 接続数の上限・ソケットタイムアウトでローカル DoS を緩和
- ブラウザ本体側も CSP（`script-src 'self'` 等）と共有リンクのサイズ/信号数上限を実装

> ブリッジは無認証のローカル開発ツールです（同一マシン内からの読み書きを想定）。

## GitHub Pages へのデプロイ

1. リポジトリ名は **ASCII の `timing-chart`** にする（非ASCIIはアセットURLが壊れる）。
   別名にする場合は `vite.config.ts` の `base` を `'/<repo>/'` に合わせる。
2. `main` ブランチに push すると `.github/workflows/deploy.yml` が
   ビルド → Pages へ公開（`actions/deploy-pages`）。
3. リポジトリ **Settings → Pages → Source = GitHub Actions** を選択。
4. 公開URL: `https://<user>.github.io/timing-chart/`

## 技術構成

- React + Vite + TypeScript / 状態管理 Zustand
- `src/model` … WaveJSON 型・wave文字列の展開/圧縮（ロスレス）・clock生成・parse(JSON5)/serialize
- `src/render` … WaveDromRenderer（`renderWaveElement` + スキン明示渡し）
- `src/state` … ストア（単一情報源）・GUI変換アクション・セレクタ
- `src/components` … ツールバー / GUIテーブル / バス・注釈パネル / テキスト / プレビュー
- `src/export` … SVG直列化・PNGラスタライズ・ダウンロード
- `src/share` … lz-string によるURL共有

## ライセンス

[MIT License](LICENSE)。描画エンジンの [WaveDrom](https://github.com/wavedrom/wavedrom) も MIT。
