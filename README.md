# 俯瞰（FUKAN）— デザインプロトタイプ

Bloomberg / FT 系を参照した、上品で信頼感のある近未来的な総合ニュースサイト（テック・AI・科学・経済・政治・国際・カルチャー等）のデザインプロトタイプ。

スタンドアロン HTML/CSS、依存ゼロ、ブラウザでファイルを開くだけで動きます。

---

## ファイル構成

```
AIニュースサイト/
├── index.html           # トップ（記事一覧）
├── article.html         # 記事詳細
├── assets/
│   └── styles.css       # 全スタイル + デザイントークン
└── .hallmark/log.json   # 次回 Hallmark 実行時の多様化メモリ
```

## 開く

```sh
open index.html
```

トップから記事タイトルをクリックすると `article.html` に遷移します。

---

## デザインシステム

**方針: 低認知負荷・白基調ミニマル。** 競合する信号（色・罫線・動き）を減らし、余白で区切り、
型階層で序列を作る。見出し＝セリフ（和欧混植）、本文＝サンス、アクセントは1色のみ、装飾モーションは持たない。

### カラー

白基調（わずかに温白）。文字はほぼ黒〜ミュート2段、罫線は極薄、**アクセントは青1色**のみ。
ダークは OS 設定時のフォールバックとして簡素に維持（`[data-theme="dark"]`）。

| トークン | 用途 | 値（ライト） |
|---|---|---|
| `--paper` | ページ背景 | `#fcfcfb`（温白） |
| `--surface` | 入力・ドロップダウン | `#ffffff` |
| `--ink-0` | 本文・見出し | `#1b1b18` |
| `--ink-1` | 副次テキスト | `#585853` |
| `--ink-2` | メタ・キャプション | `#8c8c84` |
| `--rule` / `--rule-strong` | 罫線（極薄） | `#ecebe5` / `#dcdbd3` |
| `--accent` | アクセント（青・唯一） | `#2f6df0` |

### タイポグラフィ（全て Google Fonts・商用無料）

和文を明示的にペアリング（成り行きフォールバックを排除）。

| 役割 | フォント |
|---|---|
| 見出し（Serif） | **Fraunces**（ラテン・可変） × **Noto Serif JP**（和文・明朝） |
| 本文・UI（Sans） | **Inter**（ラテン） × **Noto Sans JP**（和文・ゴシック） |

### スペーシング

4pt スケール、`--space-2xs` (4px) ～ `--space-4xl` (112px) を意味的に命名。

---

## 画像戦略（著作権リスク回避）

**Unsplash の無料素材 API** から記事に合う実写真を1枚取得し、撮影者名＋プロフィールリンクの
**帰属表記付き**で、トップのリードと記事詳細に表示する（Unsplash 規約準拠）。
`.env` に `UNSPLASH_KEY` を設定すると有効。**未設定・検索ヒット0の場合は画像を出さない**（抽象グラデの
ダミーサムネは低認知負荷方針で撤去）。テキストのみでもレイアウトは崩れない。

- ニュース画像の転載はしない（実写真は Unsplash の商用利用可・帰属付き素材のみ）。
- AI 画像生成（DALL·E / Imagen 等の従量課金サービス）は使用しない。
- 既存記事への一括付与は `npm run backfill-images`。
- 例外として、報道対象“本人”の**公式プレス画像**は `npm run set-press-image`（クレジット必須・自動上書き保護）で**手動登録**できる。利用可否は各社の press 規約を確認。詳細は [SPEC.md §6.1](SPEC.md)。

---

## 広告枠の組み込み

空の広告プレースホルダは「未完成」に見え信頼を損ねるため**撤去済み**。AdSense 等を導入する際は、
以下の自然な位置に広告枠を追加できます（レイアウトは IAB 標準サイズを想定）。プライバシーポリシーは
すでに第三者配信 Cookie の利用と無効化導線に言及済みです。

| ページ | 推奨位置 | サイズ |
|---|---|---|
| トップ | ヒーロー直下 / サイドバー上部 | 970×90 / 300×250 |
| 記事詳細 | 本文中盤 / 右サイドバー | 970×250 / 300×250 |

---

## レスポンシブ

- 記事/セクション/タグページは**単一カラム**（コンテンツ幅 `--site-max` 760px・本文 measure 40rem）。
- **トップのみ例外**: PC（≥1000px）で `<body class="page--home">` のとき `--site-max-wide`(1120px) に widen し、ヒーロー左＋トップニュース右レールの2カラム＋最新グリッド＋カテゴリ別ブロックを展開。`<1000px` は全ページ1カラムに畳む。
- 行カードはエブロー型（上段にメタ「カテゴリ · 日付＋時刻」、下段に見出し）。ナビは横スクロール（右端フェード）。

ブラウザ DevTools で 375 / 768 / 1280 px を確認してください。

---

## アクセシビリティ

- WCAG AA 準拠コントラスト：白基調で本文 ink-0／メタ ink-2 とも AA 以上を確保
- タップ領域 44×44px 以上（ナビ各項目）
- 全インタラクティブ要素に `:focus-visible` リング（コントラスト 3:1 以上）
- 装飾モーションは持たず、唯一の動き（記事の読了プログレスバー）も `prefers-reduced-motion: reduce` で停止
- セマンティック HTML（`<main>` / `<article>` / `<nav>` / `aria-label`）

---

## 自動生成パイプライン（実装済み）

ニュース取得 → 記事執筆 → 画像付与 → サイト生成を、**ヘッドレス Claude Code** が自動化する。
launchd が `claude --dangerously-skip-permissions -p` でヘッドレス起動し、Claude 自身が
**元記事を WebFetch で読み、数値を WebSearch で裏取りしながら**忠実な日本語短評を執筆する。
APIキー不要（Anthropic サブスク内）。画像は無料素材 API（未設定でも CSS 抽象サムネ）。
サイト側コードに LLM 呼び出しは無い（執筆者は Claude 自身）。

```
launchd → scripts/auto-generate.sh
  → claude -p prompts/generate-articles.md
       ① node src/fetchCandidates.js  … 新着候補を data/_candidates.json へ
       ② 各候補を WebFetch/WebSearch で取材 → data/_drafts.json へ下書き
       ③ node src/ingestDrafts.js      … slug採番/画像/重複排除/保存/再生成
```

### 前提
- `claude`（Claude Code CLI）が認証済みで使えること。
- Node.js 18+（内蔵 `fetch` を使用）。`npm install` で依存を導入。

### 手動実行

```sh
npm run candidates           # 候補だけ確認（data/_candidates.json）
zsh scripts/auto-generate.sh # 取材→執筆→反映まで全自動で1回
npm run build                # articles.json から dist/ に全 HTML ＋ アセットを生成
npm run serve                # dist/ を http://localhost:8000 で配信して目視
```

> 生成物は `dist/`（gitignore 済み）に出力し、**コミットしない**。本番は Vercel が
> デプロイ時に `npm run build` を実行して `dist/` を配信する（`vercel.json`）。

### 設計のポイント

- **記事はアグリゲーター型の短評**（全文リライトではない）。Claude が元記事を読み、
  「短い独自要約＋論評＋目立つ出典リンク」を生成 → 著作権リスクと事実誤りを同時に抑制。
- **冪等**：処理済み `link` は再生成しない。`data/articles.json` が蓄積され、走らせるほど記事が増える。
- リセットしたい場合は `data/articles.json` を削除（生成物は `dist/` に出るだけなので `dist/` を消せばよい）。

### 編集方針（エディトリアルポリシー）

機械的に全部載せるのではなく、編集判断を加えている:

- **一次情報優先** — 各フィードに `tier`（`primary`=企業公式 / `media`=報道）。候補は primary を上位に並べ、
  ヘッドレス Claude が media の主張を WebSearch で裏取りしてから採用する（`src/config.js` の `rssFeeds`）。
- **重要度で選別＋序列化** — Claude が候補を重要度 1〜5 で採点し、`importanceFloor`(3) 以上だけを
  1回 `maxArticles`(2) 本まで掲載（＝1日6本前後）。重要なものが無い回は載せない。類似トピックは1本に統合。
- **重要度で配置** — `render.js` がトップ最上段の**リード1本**を重要度順（`importanceThenRecency`）で選ぶ。
  リード以下の「最新」は時系列の行リスト。
- **ヒーローの鮮度ウィンドウ** — トップ最上段（リード）は直近 `heroRecencyHours`(24) 時間内の最重要記事から選び、
  古い高importance記事の居座り（トップ停滞）を防ぐ。ウィンドウ内に無ければ全体の最重要を表示（保険）。
- **保持とアーカイブ** — トップは最新 `retentionTop`(40) 本まで。超過分は `archive.html`（月別一覧）へ。記事HTMLは全保持。

### 主な設定（`src/config.js`）

| 項目 | 既定 | 説明 |
|---|---|---|
| `maxArticles` | 25 | 1 回に掲載する本数の上限（×2回/日・6時/18時）。`MAX_ARTICLES` で上書き可 |
| `candidatePool` | 140 | Claude に提示する候補数（この中から重要度＋カバレッジ均等化で選別） |
| `importanceFloor` | 3 | 重要度がこれ未満の候補は掲載しない |
| `retentionTop` | 40 | トップ掲載の上限。超過分は `archive.html` へ |
| `sectionBlockMin` / `sectionBlockMax` | 2 / 4 | トップ中段カテゴリ別ブロックの最小本数（`navSections` 順に固定表示）／1ブロックの最大カード数 |
| `heroRecencyHours` | 24 | ヒーローは直近この時間内の最重要記事から選ぶ（トップ停滞の防止） |
| `rssFeeds` | 総合ニュース10セクションのRSS（`tier`付き） | 一次情報/メディアの別。実フィードは `src/config.js` を参照（増減もここで編集） |
| `imageImportanceFloor` | 4 | この重要度未満の記事には画像を付けない（取得・ページ重量の節約） |
| `imageProvider` | `unsplash` | `unsplash` / `pexels`（キー未設定なら画像なし） |

### 定期実行（設定済み）

`~/Library/LaunchAgents/com.axiom.generate.plist` を登録済みで、**毎日 6:00 / 18:00** に
`scripts/auto-generate.sh`（＝ヘッドレス Claude 方式）が自走する。ログは `data/scheduler.log`。

```sh
# 状態確認 / 一時停止 / 再開 / 即時実行
launchctl print  gui/$(id -u)/com.axiom.generate | grep -i state
launchctl bootout   gui/$(id -u) ~/Library/LaunchAgents/com.axiom.generate.plist   # 停止
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.axiom.generate.plist   # 再開
launchctl kickstart -k gui/$(id -u)/com.axiom.generate                            # 今すぐ1回
```

---

## 機能（コンテンツ・体験・運用）

- **関連記事**: タグ／セクションの一致度でスコアリングして提示（`src/render.js` の `relatedFor`）。
- **タグページ**: `tags/<タグ>.html` を自動生成、`tags/index.html` はタグクラウド。記事内タグから辿れる。
- **AI 関連度フィルタ**: media 系 RSS の AI 無関係記事を `config.aiKeywords` で足切り（公式 primary は常に通す）。
- **記事体験**: 読了時間の目安、公開時刻、機能する共有ボタン（X / はてブ / リンクコピー）、読了プログレスバー。
- **ミニマルな体験**: 装飾モーション（発光・グレイン・hover リフト・段階リビール）は撤去。動きは記事の読了プログレスバーのみ（`assets/reveal.js`）。対応ブラウザではページ遷移に控えめな View Transitions（`prefers-reduced-motion` で無効）。
- **テーマ**: 既定はライト（白基調）。OS が dark のときのみ簡素なダークにフォールバック（`<head>` のインラインJSが paint 前に `data-theme` を適用）。
- **サイト内検索**: 静的（追加依存ゼロ）。`search-index.json` をクライアントで部分一致検索。
- **画像最適化**: Unsplash 画像に配信パラメータを付与＋ `images.unsplash.com` を preconnect（CWV 改善）。
- **パイプライン監視**: `scripts/auto-generate.sh` が異常終了・push 失敗・新規ゼロ連続を検知して macOS 通知。
- **自己改善ハーネス（MVP）**: 日次フローが **writer → 別モデル査読（出典照合・veto）→ 取り込み** の3段で動き、各記事の評価を `data/quality/` の ledger に蓄積。客観品質は `npm run check` の警告と `npm run evaluate` で可視化、人手評価は `npm run evaluate -- --rate <slug> <1-5>`。詳細は [SPEC.md](SPEC.md) §12。
- **アナリティクス（任意）**: `.env` に `CF_BEACON_TOKEN` を設定すると Cloudflare Web Analytics（Cookieless）を出力。未設定なら無効。
- **SEO**: 全ページに OGP / Twitter Card / canonical / JSON-LD（NewsArticle・WebSite・Organization）。`sitemap.xml` / `robots.txt` / `feed.xml`（RSS）を生成。共通OG画像 `assets/og-default.jpg`。
- **法的・運営ページ**: 運営者情報 / お問い合わせ / プライバシーポリシー / 利用規約 / 編集方針 / 免責事項を生成し、フッターに接続。

## 今後の発展（任意）

1. **Astro + Cloudflare Pages** へ移植（無料枠で十分）
2. **Google Search Console** に `sitemap.xml` を登録してインデックスを促進
3. **AdSense 申請**（運営者情報・プライバシー・お問い合わせページは実装済み）

---

## ライセンス

このプロトタイプのコードは自由に改変してください。Google Fonts（Fraunces / Noto Serif JP / Inter / Noto Sans JP）は SIL Open Font License（商用利用可）。
