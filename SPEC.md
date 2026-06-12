# AXIOM AI — システム仕様書

AI ニュースの取得・執筆・画像付与・サイト生成を全自動化する、ヘッドレス Claude Code ベースのニュースパイプライン。

- 最終更新: 2026-06-13
- 対象リポジトリ: `AIニュースサイト/`
- 配信形態: 静的サイト（HTML/CSS、依存ゼロで閲覧可能）

---

## 1. 概要

ローカルの macOS 上で動作し、**ヘッドレス起動した Claude Code 自身が**最新の AI ニュースを取材・執筆して、
既存デザイン（AXIOM AI）の静的サイトを毎日3回自動更新する。

- **追加課金なし**: 外部 LLM API を従量課金で叩かない。執筆は Claude Code（Anthropic サブスク内）で完結。APIキー不要。
- **サイト側に LLM 呼び出しなし**: 生成物は素の HTML。表示は純粋な静的配信。
- **著作権配慮**: 全文転載ではなく「短い独自要約＋論評＋出典リンク」のアグリゲーター型。

### 設計原則
1. **執筆者＝Claude / 描画＝決定的 Node**: 知性が要る工程（取材・執筆・編集判断）は Claude、機械的工程（採番・画像・描画）は Node スクリプトに分離。
2. **編集判断を持つ**: 新着を時系列で全部載せるのではなく、重要度で選別・序列化する。
3. **冪等**: 処理済みリンクは再生成しない。何度走らせても重複記事は作らない。

---

## 2. アーキテクチャ

```
launchd（毎日 6:00 / 12:00 / 18:00）
  └─ scripts/auto-generate.sh
       └─ claude --dangerously-skip-permissions -p prompts/generate-articles.md
            ① node src/fetchCandidates.js
                 RSS取得 → 重複排除 → 弱いソース除外 → 一次情報優先で並べ
                 → data/_candidates.json（候補プール、既定12件）
            ② Claude が編集判断・取材・執筆（セッション内）
                 - 候補を重要度1〜5で採点、3以上を最大2件選別、類似は統合
                 - 元記事を WebFetch で読み、数値を WebSearch で裏取り
                 → data/_drafts.json（下書き）
            ③ node src/ingestDrafts.js
                 slug採番 → 画像取得 → 重複排除 → data/articles.json 保存
                 → render（index.html / archive.html / articles/*.html）
       └─ 実行結果を data/scheduler.log に追記
```

---

## 3. ディレクトリ構成

```
AIニュースサイト/
├── index.html              # 生成: トップページ
├── archive.html            # 生成: アーカイブ（記事が retentionTop を超えたら）
├── article.html            # デザイン参照元（旧プロトタイプ）
├── articles/<slug>.html    # 生成: 各記事ページ
├── assets/styles.css       # デザイン（OKLCH トークン・全クラス）
├── data/
│   ├── articles.json       # コンテンツの永続ストア（=サイトの正本）
│   ├── _candidates.json    # 一時: 候補プール（実行後に掃除）
│   ├── _drafts.json        # 一時: Claude の下書き（実行後に掃除）
│   └── scheduler.log       # 定期実行ログ
├── prompts/
│   └── generate-articles.md # Claude への執筆指示（編集方針を内包）
├── scripts/
│   └── auto-generate.sh    # launchd ラッパー（ヘッドレス Claude を起動）
├── src/
│   ├── config.js           # 設定（フィード・件数・閾値・画像）
│   ├── fetchCandidates.js  # 候補を JSON 出力
│   ├── fetchNews.js        # RSS/補助API 取得・重複排除・一次情報優先
│   ├── ingestDrafts.js     # 下書き取込（採番・画像・保存・再生成）
│   ├── fetchImage.js       # Unsplash/Pexels 画像（無ければ CSS サムネ）
│   ├── backfill-images.js  # 既存記事に実写真を一括付与
│   ├── render.js           # 重要度序列・保持・アーカイブの描画統括
│   ├── renderOnly.js       # 再描画のみ
│   ├── store.js            # articles.json 読み書き・slug採番
│   └── markdown.js         # md→html / エスケープ
├── templates/
│   ├── layout.js           # ticker/header/footer/page 骨格
│   ├── index.js            # トップ
│   ├── article.js          # 記事詳細
│   └── archive.js          # アーカイブ
└── _backup/                # 退避（旧HTML・廃止した qwen フォールバック）
```

---

## 4. データスキーマ（`data/articles.json` の1要素）

```jsonc
{
  "slug": "20260613-09",            // YYYYMMDD-連番（最大連番+1で採番）
  "headline": "…",                  // 日本語見出し（40字以内）
  "lead": "…",                      // 要点1文（80字以内）
  "body_markdown": "…",             // 本文（Markdown・400〜800字）
  "tags": ["…"],                    // 日本語タグ 3〜5個
  "section": "基盤モデル",            // セクション
  "source": "OpenAI",               // 出典名
  "link": "https://…",              // 出典URL（冪等キー）
  "importance": 4,                  // 重要度 1〜5（編集序列に使用）
  "image": { "imageUrl": "…", "photographer": "…", "profileUrl": "…", "provider": "unsplash" },
                                    // 画像が無い場合は { "fallbackThumb": "thumb--blue" }
  "mode": "full",
  "createdAt": "2026-06-13T03:29:00.000Z"
}
```

---

## 5. 編集方針（エディトリアルポリシー）

| 項目 | 内容 | 関連設定 |
|---|---|---|
| 一次情報優先 | フィードを `tier`（primary=企業公式 / media=報道）で区別。候補は primary を上位に。media の主張は Claude が WebSearch で裏取り。 | `config.rssFeeds[].tier` |
| 重要度で選別 | Claude が候補を 1〜5 で採点し、閾値以上のみ・1回最大N本を掲載。類似トピックは1本に統合。 | `importanceFloor`=3, `maxArticles`=2 |
| 重要度で序列 | ヒーロー大見出し／カード／人気記事を重要度順（同点は新しい順）に配置。「最新記事」のみ時系列。 | `render.js: importanceThenRecency` |
| 保持とアーカイブ | トップは最新 N 本。超過分は `archive.html`（月別一覧）へ。記事HTMLは全保持。 | `retentionTop`=40 |
| 掲載数 | 1回最大2本 × 1日3回 = 約6本/日。重要なものが無い回は載せない。 | `maxArticles`, スケジュール |

重要度ルブリック: 5=業界を変える重大発表 / 4=主要企業の新製品・大型調達・注目研究 / 3=標準 / 1〜2=些末（掲載しない）。

---

## 6. 画像処理（取得・帰属・フォールバック）

> **AI 画像生成は行わない。** 記事に合う写真を**フリー素材 API（Unsplash）から取得**して表示する。
> DALL·E / Imagen 等の従量課金や、ローカル Stable Diffusion は使わない。

処理は `src/fetchImage.js`（`ingestDrafts.js` から記事ごとに呼ばれる）:

1. **キーワード生成** — 記事の `tags`／見出しから検索用の英語キーワードを決定（簡易語彙マップ。
   該当なしは `artificial intelligence technology`）。
2. **取得** — `imageProvider`（既定 Unsplash、無ければ Pexels）で landscape 写真を1枚検索。
   Unsplash はダウンロードトリガーを叩く（規約準拠・ベストエフォート）。
3. **帰属** — 取得できたら `{ imageUrl, photographer, profileUrl, provider }` を記録し、
   **撮影者名＋プロフィールリンクを必ず表示**（Unsplash 規約準拠）。
4. **フォールバック** — キー未設定・ヒット0・APIエラー時は `{ fallbackThumb: "thumb--blue" 等 }` を返し、
   CSS 抽象グラデーションサムネを表示（デザイン崩れゼロ）。

**表示箇所**
- トップ: ヒーロー大画像＋注目カード（`templates/index.js` の `thumb()` / `credit()`）。
- 記事詳細: アイキャッチ（`templates/article.js`）。
- ヒーロー横・最新一覧・人気記事: テキストのみ（画像なし）。

**運用**
- 有効化: `.env` に `UNSPLASH_KEY`（または `PEXELS_KEY`）。Unsplash 無料 Demo は 50 req/h で 1日6記事に十分。
- 既存記事への一括付与: `npm run backfill-images`（抽象サムネの記事だけ実写真へ差し替え→再描画）。
- 新規記事: 生成時に自動取得（`ingestDrafts.js` 内で `fetchImage` を呼ぶ）。
- `.env` は git 管理外（キーは公開されない）。

---

## 7. 設定リファレンス（`src/config.js`）

| キー | 既定 | 説明 |
|---|---|---|
| `maxArticles` | 2 | 1回に掲載する本数（`MAX_ARTICLES` 環境変数で上書き可） |
| `candidatePool` | 12 | Claude に提示する候補数 |
| `importanceFloor` | 3 | これ未満の重要度は掲載しない |
| `retentionTop` | 40 | トップ掲載の上限。超過分はアーカイブへ |
| `skipUrlPatterns` | 動画/音声系 | 取材に向かない弱いソースを除外 |
| `rssFeeds` | AI系8フィード | `tier` 付き。一次情報3＋メディア5 |
| `imageProvider` / `*Key` | unsplash | 画像API（未設定なら CSS サムネ） |

---

## 8. 定期実行（launchd）

- ラベル: `com.axiom.generate`
- plist: `~/Library/LaunchAgents/com.axiom.generate.plist`
- スケジュール: 毎日 **6:00 / 12:00 / 18:00**
- 実行: `scripts/auto-generate.sh`（ollama 不要・claude CLI を使用）
- ログ: `data/scheduler.log`

```sh
# 状態 / 停止 / 再開 / 即時実行
launchctl print  gui/$(id -u)/com.axiom.generate | grep -i state
launchctl bootout   gui/$(id -u) ~/Library/LaunchAgents/com.axiom.generate.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.axiom.generate.plist
launchctl kickstart -k gui/$(id -u)/com.axiom.generate
```

> Mac がスリープ中の時刻はスキップされ、起床後に1回だけ補完実行される（launchd 仕様）。

---

## 9. 手動操作

```sh
npm install                  # 依存導入（rss-parser / marked / dotenv）
npm run candidates           # 候補だけ確認（data/_candidates.json）
zsh scripts/auto-generate.sh # 取材→執筆→反映まで全自動で1回
npm run render               # articles.json から再描画のみ
npm run backfill-images      # 既存記事の抽象サムネを実写真へ一括差し替え（要 UNSPLASH_KEY）
open index.html
```

リセット: `data/articles.json` と `articles/*.html` を削除。

---

## 10. 前提・依存

- **claude**（Claude Code CLI）が認証済みであること。執筆はこれに依存（Anthropic サブスク内）。
- **Node.js 18+**（内蔵 `fetch` を使用）。依存は `rss-parser` / `marked` / `dotenv` のみ。
- 画像APIキー（任意）: `UNSPLASH_KEY` / `PEXELS_KEY` を `.env` に。未設定でも CSS 抽象サムネで動作。

---

## 11. 設計上の既知事項

- **claude CLI 認証が切れると定期ジョブは失敗する**。`data/scheduler.log` を時々確認する。
- 記事の正本は `data/articles.json`。HTML はそこからの派生（いつでも `npm run render` で再生成可能）。
- `makeSlug` は「同日最大連番+1」方式（削除で欠番が出ても衝突しない）。
- zsh の `$status` は読取専用のため、シェルスクリプトでは別名（`rc`）を使う。
