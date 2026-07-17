# 俯瞰（FUKAN）— システム仕様書

各分野のニュース（テック・AI・科学・経済・政治・国際・カルチャー等）の取得・執筆・画像付与・サイト生成を全自動化する、ヘッドレス Claude Code ベースのニュースパイプライン。

- 最終更新: 2026-07-17
- 対象リポジトリ: `AIニュースサイト/`
- 本番URL: `https://fukan-news.vercel.app`（Vercel・git push で自動デプロイ。旧 `axiom-ai-xi.vercel.app` はこちらへリダイレクト）
- 配信形態: 静的サイト（HTML/CSS、閲覧は依存ゼロ。検索・演出のみ軽量バニラ JS = `search.js` / `reveal.js`）
- ビルド/配信: 生成物は **VCS にコミットせず** `dist/` に出力（gitignore 済み）。Vercel が `buildCommand:"npm run build"` / `outputDirectory:"dist"` で**デプロイ時に生成・配信**する（§13）。`dist/` 外のソース・ドキュメントは公開されない。

---

## 1. 概要

ローカルの macOS 上で動作し、**ヘッドレス起動した Claude Code 自身が**各分野の最新ニュースを取材・執筆して、
静的サイト（俯瞰／FUKAN）を毎日2回（6時/18時）自動更新する。

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
launchd（毎日 6:00 / 18:00）
  └─ scripts/auto-generate.sh
       └─ claude --dangerously-skip-permissions -p prompts/generate-articles.md
            ① node src/fetchCandidates.js
                 RSS取得 → 重複排除 → 弱いソース除外 → 一次情報優先で並べ
                 → data/_candidates.json（候補プール、既定140件）
            ② Claude が編集判断・取材・執筆（セッション内）
                 - 候補を重要度1〜5で採点、3以上を最大25件選別（床を越えた分だけ・可変）、類似は統合
                 - 元記事を WebFetch で読み、数値を WebSearch で裏取り
                 → data/_drafts.json（下書き）
            ③ node src/ingestDrafts.js
                 slug採番 → 画像取得 → 重複排除 → data/articles.json 保存
                 → render（dist/ へ：index / archive（月インデックス＋archive/YYYY-MM）/ articles/* / sections/* / tags/*
                           / 法的6ページ / search-index.json / sitemap.xml
                           / robots.txt / feed.xml / feed.xsl）※ dist は gitignore のため commit されない
       └─ 健全性チェック（記事数増減・exit code）→ 異常なら macOS 通知
       └─ 変更があれば git commit & push（実質 data/articles.json の差分のみ）→ Vercel が npm run build でデプロイ
       └─ 実行結果を data/scheduler.log に追記
```

> 上図は**自動ジョブ**の経路（`main` へ直 push＝即本番）。**手動開発は PR ベース**で、`.github/workflows/check.yml` が Pull Request 上で `npm run check` を実行する（CI 緑を確認してマージ＝本番反映）。`main` にブランチ保護はかけていない（直 push 禁止にすると自動ジョブが止まるため）。詳細な手順は [CONTRIBUTING.md](CONTRIBUTING.md) を参照。

---

## 3. ディレクトリ構成

```
AIニュースサイト/
├── index.html              # 生成: トップページ
├── archive.html            # 生成: アーカイブ月インデックス（記事が retentionTop を超えたら）
├── archive/YYYY-MM.html    # 生成: 月別アーカイブ（1ページ肥大を防ぐ分割）
├── articles/<slug>.html    # 生成: 各記事ページ
├── sections/<slug>.html    # 生成: ナビ各タブ（セクション別一覧。空でも生成）
├── tags/<tag>.html         # 生成: タグ別一覧（UTF-8ファイル名）＋ index.html（タグクラウド）
├── about/contact/privacy/terms/editorial/disclaimer.html # 生成: 法的・運営ページ
├── sitemap.xml             # 生成: サイトマップ
├── robots.txt              # 生成: クローラ指示（Sitemap 参照）
├── feed.xml                # 生成: RSS 2.0 フィード（XSL 参照付き）
├── feed.xsl                # 生成: feed.xml をブラウザで読み物表示する XSLT
├── search-index.json       # 生成: サイト内検索のクライアント用インデックス（直近 searchIndexMax 件）
├── assets/
│   ├── styles.css          # デザイン（白基調ミニマル・トークン・全クラス・OS dark フォールバック）
│   ├── search.js           # サイト内検索の初期化（依存ゼロ）
│   ├── reveal.js           # 読了プログレスバー（依存ゼロ・装飾リビールは廃止）
│   ├── share.js            # 記事共有の強化（依存ゼロ・リンクコピー＋Web Share API の能力検出）
│   ├── og-default.jpg      # SNSシェア共通OG画像（1200×630）
│   └── logo.png            # 構造化データ publisher.logo（512×512）
├── data/
│   ├── articles.json       # コンテンツの永続ストア（=サイトの正本）
│   ├── brand-photos.json   # ブランド写真の索引（写真スラッグ→ブランド。refresh-brand-photos が生成）
│   ├── _candidates.json    # 一時: 候補プール（実行後に掃除）
│   ├── _drafts.json        # 一時: Claude の下書き（実行後に掃除）
│   ├── .health             # 一時: 新規ゼロの連続回数（監視用・git管理外）
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
│   ├── fetchImage.js       # Unsplash/Pexels 画像（無ければ画像なし）
│   ├── imageBrands.js      # 記事とサムネのブランド不一致判定（他社ロゴ/UI の写り込みを弾く）
│   ├── refreshBrandPhotos.js # ブランド写真の索引を生成（data/brand-photos.json・マージ方式）
│   ├── recheckImageBrands.js # 既存記事のサムネをブランド不一致で点検・差し替え
│   ├── backfill-images.js  # 既存記事に実写真を一括付与（press画像は上書きしない）
│   ├── pressImage.js       # 公式ドメインの og:image を取り込み時に自動採用（報道用素材・allowlist厳格）
│   ├── set-press-image.js  # 公式プレス画像を特定記事へ手動登録（クレジット必須・上書き保護）
│   ├── render.js           # 重要度序列・保持・アーカイブの描画統括（任意 outDir 対応）
│   ├── renderOnly.js       # 再描画のみ
│   ├── check.js            # 公開前チェック（render完走/スキーマ/鍵混入）
│   ├── store.js            # articles.json 読み書き・slug採番
│   └── markdown.js         # md→html / エスケープ / 本文の生HTML・危険プロトコル無害化
├── templates/
│   ├── layout.js           # header(ナビ・検索)/footer/page 骨格・解析（ticker は空スタブ）
│   ├── cardbits.js         # 共有: メタ行 metaLine()/isoDate() / 中立カテゴリラベル sectionChip() / tagHref() / optimizedUrl()
│   ├── index.js            # トップ（ヒーロー＋トップニュース右レール→最新グリッド→カテゴリ別ブロック→購読）
│   ├── article.js          # 記事詳細（読了時間・共有ボタン[X/LINE/はてブ/コピー＋Web Share]・関連記事）
│   ├── section.js          # セクション別一覧
│   ├── tag.js              # タグ別一覧 renderTag() / タグクラウド renderTagsIndex()
│   ├── legal.js            # 法的・運営ページ renderLegalPages()
│   └── archive.js          # アーカイブ（月インデックス renderArchiveIndex / 月別 renderArchiveMonth）
├── CLAUDE.md               # 開発ルール（毎回自動読込・コード品質/Git/検証）
├── README.md               # デザイン・概要
├── SPEC.md                 # 本書（技術仕様・運用）
├── package.json            # スクリプト（candidates / render / check / backfill-images / recheck-images / refresh-brand-photos / set-press-image / serve）
├── .env.example            # 環境変数の雛形（すべて任意）
└── _backup/                # 退避（旧HTML・廃止した qwen フォールバック）
```

> ドキュメント3層: **CLAUDE.md＝開発ルール** / **SPEC.md＝技術仕様・運用** / **README.md＝デザイン・概要**。記事の編集方針は `prompts/generate-articles.md`。

---

## 4. データスキーマ（`data/articles.json` の1要素）

```jsonc
{
  "slug": "20260613-09",            // YYYYMMDD-連番（最大連番+1で採番）
  "headline": "…",                  // 日本語見出し（40字以内）
  "lead": "…",                      // 要点1文（80字以内）
  "body_markdown": "…",             // 本文（Markdown・目安550〜750字／床450・上限900で警告）
  "tags": ["…"],                    // 日本語タグ 3〜5個
  "section": "AI",                  // セクション（navSections 推奨。旧カテゴリは sectionAliases で正規化）
  "source": "OpenAI",               // 出典名
  "link": "https://…",              // 出典URL（冪等キー）
  "importance": 4,                  // 重要度 1〜5（編集序列に使用）
  "image_query": "data center servers", // Claude が決めた画像検索ワード（内容準拠）
  "image": { "imageUrl": "…", "photographer": "…", "profileUrl": "…", "provider": "unsplash",
             "alt": "a computer generated image of a human brain" },
                                    // alt は提供元の説明文（ブランド不一致の判定に使う。§6の2.5）。
                                    // レガシー記事には無い（欠落可・後方互換）。
                                    // 画像が無い場合は { "fallbackThumb": "thumb--blue" }
                                    // 公式プレス画像（手動 set-press-image / 自動 pressImage・上書き対象外）の場合:
                                    // { "kind": "press", "imageUrl": "…", "credit": "Anthropic",
                                    //   "creditUrl": "https://…（任意）", "source": "報道利用メモ（自動採用は 'og:image auto'）" }
  "mode": "full",
  "createdAt": "2026-06-13T03:29:00.000Z", // 取り込み時刻（ingest 時に採番）
  "publishedAt": "2026-06-12T22:00:00.000Z" // 出典の発行日時（任意・候補の publishedAt 由来）
                                    // 並び・表示日時・鮮度（ヒーロー窓）・sitemap/feed/JSON-LD の基準。
                                    // 欠落時は createdAt にフォールバック（レガシー後方互換）。
}
```

---

## 5. 編集方針（エディトリアルポリシー）

| 項目 | 内容 | 関連設定 |
|---|---|---|
| 一次情報優先 | フィードを `tier`（primary=企業公式 / media=報道）で区別。候補は primary を上位に。media の主張は Claude が WebSearch で裏取り。 | `config.rssFeeds[].tier` |
| 重要度で選別 | Claude が候補を 1〜5 で採点し、閾値以上のみ・1回最大N本を掲載（床を越えた分だけ＝本数は可変）。類似トピックは1本に統合。網羅性のため話題・セクションを分散。 | `importanceFloor`=3, `maxArticles`=25, `candidatePool`=140 |
| 並び・鮮度の基準日時 | 並び順・表示日時・鮮度判定は **`publishedAt`（出典の発行日時）優先・無ければ `createdAt`（取り込み時刻）** にフォールバック。取り込み時刻基準だと「昨日発行を今日取り込んだ記事」が新着扱いになる歪みを防ぐ。 | `render.js: effDate` |
| 重要度で序列 | トップ最上段の**リード1本**を重要度順（同点は新しい順＝`publishedAt`基準）で選ぶ。以降は**トップニュース右レール（重要度上位6本）→「最新」グリッド（時系列）→ カテゴリ別ブロック**の骨格で展開（詳細は §デザイン「トップの骨格」）。 | `render.js: importanceThenRecency`, `templates/index.js` |
| カテゴリ正規化 | 記事の `section` は `config.sectionAliases`（旧 AI 細分類＝産業応用/研究/基盤モデル/規制・倫理/スタートアップ/ハードウェア/開発 → **`AI`**）で navSections へ正規化。**旧ラベルは記事のタグへ退避**して回遊性・粒度を保つ。取り込み時（`ingestDrafts`）に自動適用＋一括移行 `npm run migrate-sections` で既存データを統一（冪等）。新規の総合カテゴリは素通り。リブランド前レガシーの不整合（薄い section ページ・`evaluate.js` の未知セクション警告）を解消する。 | `config.sectionAliases`, `store.js: normalizeSectionTags`, `src/migrateSections.js` |
| リードの鮮度ウィンドウ | トップ最上段（リード）は**直近 `heroRecencyHours` 時間内（`publishedAt`基準）の最重要記事**から選ぶ。古い高importance記事がトップに居座る停滞を防ぐ（ほぼ日次で入れ替わる）。ウィンドウ内に記事が無ければ全体の最重要をリードに（保険）。 | `render.js`（featured 先頭差し替え）, `heroRecencyHours`=24 |
| AI関連度フィルタ | media tier 候補は `aiKeywords` のヒット数が閾値未満なら除外（primary 公式は常に通す）。 | `aiKeywords`, `relevanceFloorMedia`=1 |
| 関連記事 | 「あわせて読みたい」はタグ共有×3＋同セクション×2 でスコアし上位3件。不足は重要度で補完。 | `render.js: relatedFor` |
| 保持とアーカイブ | トップは最新 N 本。超過分は**月別アーカイブ**へ（`archive.html`＝月インデックス、`archive/YYYY-MM.html`＝各月一覧。記事増でも1ページが肥大しない）。月分けは `publishedAt` 基準。記事HTMLは全保持。 | `retentionTop`=40, `templates/archive.js` |
| 掲載数 | 1回最大25本 × 1日2回（6/18時）= 最大約50本/日（網羅型）。床を越えた分だけ載せるため実際はこれ以下。床を越える候補が無い回は無理に載せない。 | `maxArticles`, スケジュール |

重要度ルブリック: 5=業界を変える重大発表 / 4=主要企業の新製品・大型調達・注目研究 / 3=標準 / 1〜2=些末（掲載しない）。

---

## 6. 画像処理（取得・帰属・フォールバック）

> **AI 画像生成は行わない。** 記事に合う写真を**フリー素材 API（Unsplash）から取得**して表示する。
> DALL·E / Imagen 等の従量課金や、ローカル Stable Diffusion は使わない。

取り込み時の画像決定順（`ingestDrafts.js`）: **①公式プレス画像の自動採用（§6.2・出典が公式ドメインのとき）
→ ②stock 写真（下記 `fetchImage.js`）→ ③抽象サムネ**。以下は②の詳細。

処理は `src/fetchImage.js`（`ingestDrafts.js` から記事ごとに呼ばれる）:

1. **キーワード生成（段階的フォールバック）** — `keywordVariants()` が「具体的→広い」順に検索語の候補列を作り、
   **0ヒットなら次の語へ広げて最初に当たった集合を採用**する（`image_query` が具体的すぎると Unsplash は
   AND 的検索で0件になり抽象サムネへ落ちるため、それを防ぐ）。順序:
   - **①記事ごとの `image_query`**（最優先）— Claude が決めた英語ワード（**2〜3語**）。内容を視覚的に表す具体的な被写体。
     記事レコードにも保存（将来の再取得でも内容準拠を維持）。
   - **②語を減らした版** — `image_query` が4語以上なら先頭3語・先頭2語に短縮（例: `dna genetic research laboratory`→0件 なら `dna genetic research`→`dna genetic`）。
   - **③簡易語彙マップ** — `tags`／見出しから推定（例: 診断→`medical technology`）。
   - **④既定** `artificial intelligence technology`。
2. **取得（候補30件）** — 各語につき `imageProvider`（既定 Unsplash、無ければ Pexels）で landscape 写真を**最大30件**検索。
2.5. **ブランド不一致の排除（`src/imageBrands.js`）** — 記事が扱っていないブランドが写った候補を捨てる。
   `artificial intelligence` 等の一般語には他社のロゴ/UI が写った写真が多数混ざるため、素通しすると
   **Claude の記事に ChatGPT のサムネ**が付き、事実に反する印象を与える（アグリゲーターとして致命的）。
   記事側のブランドは見出し・リード・タグ・出典・`image_query` から判定（日本語表記も拾う）。写真側は2層で判定:
   - **①テキスト層** — 写真の `alt`/`description` にブランド名が出るか（例「chatgpt on a phone」）。
   - **②ランキング層** — **そのブランド名で検索した上位に出る写真か**（索引 `data/brand-photos.json`）。
     alt は自動生成で当てにならない——OpenAI ロゴの 3D レンダですら alt は「a ball of string」で、
     テキスト層では捕まらない。「そのブランド名で引くと出てくる」方が写り込みの信号として強い。
     索引は `npm run refresh-brand-photos` で更新（**マージ方式**・レート制限に当たっても続きから育つ）。
     **索引が無くても①だけで動く**（縮退運転。選定は止めない）。
   記事がブランドに触れていなければ、ブランド写真は**一律に避ける**。全候補が落ちたら次の（より広い）語へ、
   最後まで残らなければ抽象サムネ＝**誤った写真より安全**という優先順位。
3. **重複回避** — 候補の中から**他記事で未使用の写真を選ぶ**。判定は `imageKey()`（URL から写真固有IDを抽出）。
   使用済みキーの `Set` を生成・バックフィル全体で共有し、既存記事とも突き合わせる。
   全件使用済みのときのみ index ベースで分散（最終手段は重複許容）。
4. **帰属** — 取得できたら `{ imageUrl, photographer, profileUrl, provider, alt }` を記録し、
   **撮影者名＋プロフィールリンクを必ず表示**（Unsplash 規約準拠）。Unsplash はダウンロードトリガーを叩く（規約準拠）。
5. **フォールバック** — **全キーワード候補が0ヒット**、またはキー未設定・APIエラー時のみ `{ fallbackThumb: "thumb--blue" 等 }` を返し、
   CSS 抽象グラデーションサムネを表示（デザイン崩れゼロ）。`npm run backfill-images` で後から実写真へ差し替え可能。

**レート制限の扱い（RateLimitError）** — Unsplash デモキーは 50req/時。制限を「ヒット0」と取り違えると
「該当写真なし」に化けて事故る（空の索引を正常扱いで書く／まともな写真を抽象サムネで潰す）。そのため
プロバイダは 403/429 で `RateLimitError` を送出し、用途ごとに扱いを変える:
- **日次の取り込み（ingest・既定 `strict:false`）** — 握り潰して抽象サムネへ。**公開を止めない**
  （評価機構の故障で公開事故/停止を起こさない、という §12 の原則と同じ）。
- **既存画像の差し替え（recheck・`strict:true`）／索引生成** — 打ち切る。制限のせいで既存の写真を壊さない。

**既存記事の点検（`npm run recheck-images`）** — 全記事のサムネをブランド不一致の観点で点検する。
判定は索引のスラッグ照合なので **API を使わない**（API を使うのは `--apply` の差し替え取得だけ）。
既定は dry-run。`--apply` で差し替え＋再生成、`--limit N` で1回の差し替え件数を絞る（レート制限対策）。
新しい記事から順に直す（読者の目に触れている写真を先に直す）。公式プレス画像（`kind:'press'`）は
報道対象そのものの写真なので対象外。

**画像を付ける対象**（取得・ページ重量の節約。`imageImportanceFloor`＝既定4）
- 約50本/日で全件に画像を用意するのは過剰なため、**重要度 importance>=4 の記事だけ**画像を取得・付与する（`ingestDrafts.js`）。
  これ未満は `image:null`（テンプレは画像が無ければ何も出さない）。`backfill-images.js` も importance<floor は付与しない。
- ヒーローは常に高importanceなので必ず画像が付く。結果として画像は「トップのヒーロー＋重要記事の詳細ページ」に出る。

**表示箇所**（白基調ミニマル方針：画像は実写真があるときのみ。抽象グラデのダミーサムネは描画しない）
- トップ: リードに実写真があれば1枚（`templates/index.js: leadStory`）。最新の行リストはテキストのみ。
- 記事詳細: アイキャッチ（実写真があるときのみ・`templates/article.js: heroFigure`）。重要度未満の記事は画像なし。
- セクション/タグ/アーカイブ/関連記事: すべてテキストの行リスト（画像なし）。メタ行はトップの「最新」と同じ共有 `metaLine()` で「カテゴリ · 日付＋時刻」に統一（**セクションページはカテゴリが自明＝重複のため日時のみ**＝`metaLine(a,false)`）。出典行（`.feed-item__src`）は行の**右端**に寄せる。
- ※ `fetchImage.js` はデータ上 `fallbackThumb` を返すことがあるが、テンプレートは参照しない（実写真のみ表示）。

**リードのクリック導線**: リードに画像があるとき、画像（`.lead__media`）は記事ページへのリンク。見出しリンクと同一記事への重複リンクになるため `tabindex="-1"` ＋ `aria-hidden="true"` で**マウス操作専用**とし、AT／キーボードには出さない（読み上げ・タブ移動は見出しリンクのみ）。記事詳細のアイキャッチは**リンク化しない**（既に記事内のため）。

**画像クレジットの表示方針**: 一覧（カード・セクション・タグ・関連記事）には**クレジットを出さない**（見た目の情報過多を避ける）。クレジットは画像が大きく出る**記事ページ本体のアイキャッチ**（`article.js` の `heroFigure()` の figcaption）にのみ表示する。Unsplash ライセンスは帰属を「推奨（必須ではない）」とするため一覧省略でも準拠。プレス画像（`kind:'press'`）のクレジットは記事ページに必ず出る（`check.js` が credit を必須化）。

**運用**
- 有効化: `.env` に `UNSPLASH_KEY`（または `PEXELS_KEY`）。Unsplash 無料 Demo は 50 req/h で 1日6記事に十分。
- 一括メンテ: `npm run backfill-images` — ①画像が無い記事に付与、②**他記事と重複している画像をユニークな写真へ差し替え**、の両方を行い再描画。**`kind:'press'` の手動画像は上書きしない**。
- 新規記事: 生成時に自動取得（`ingestDrafts.js` が使用済みキーを seed して `fetchImage` を呼ぶ → 既存記事と重複しない）。
- `.env` は git 管理外（キーは公開されない）。

### 6.1 公式プレス画像（手動・クレジット必須）

報道対象“本人”の公式キービジュアル（例: Anthropic 公式の発表画像）を、特定記事に**人手で**登録する経路。生成・自動ジョブの既定挙動（stock/抽象サムネ）は変えず、判断を要する画像だけ“昇格”させる。

- 登録: `npm run set-press-image -- <slug> <imageUrl> <credit> [creditUrl] [source]`
  - `imageUrl` は**外部公式URL直リンク（既定推奨・複製を残さない）**または `/assets/press/<slug>.jpg`（ローカル複製・リンク切れに強いが“複製”の許諾確認がより重要）。
  - 解除: `npm run set-press-image -- <slug> --clear`（`image` を外し、次回 `backfill-images` で stock 再取得）。
- 表示: クレジットは**記事ページのアイキャッチ**にのみ **「提供: ◇◇」**（`config.pressCreditLabel`）で表示（`article.js` の `heroFigure()` が `kind` で分岐）。`creditUrl` があれば公式発表ページへリンク。プレス画像は「（イメージ写真）」表記を付けない。一覧（カード・セクション）にはクレジットを出さない。
- 非提携・商標の断り: 各社共通ルール「提携・推奨を示唆しない」への対応は、**画像ごとには出さず**（読者の信頼を損ねるため）、**フッター（全ページ・控えめ／`config.trademarkNotice`）と免責ページ（disclaimer.html の「商標・第三者の画像について」）に1回だけ**集約する。
- 保護: `kind:'press'` は `backfill-images` の自動上書き対象外。og:image / JSON-LD は `imageUrl` を自動反映。
- 検証: `check.js` が press 画像で `imageUrl`・`credit` 欠落を**公開前に弾く**（無断・無クレジット掲載の防止）。

**安全チェックリスト（登録前に必ず）**
- [ ] 報道対象“本人”の公式画像か（第三者の写真・競合製品の画像は使わない）
- [ ] 各社の **brand / press / newsroom ガイドライン**で**報道目的の利用可**を確認した
- [ ] **クレジット（提供元）を明記**した（`credit` 必須）。可能なら `creditUrl` で出典明示
- [ ] 不安・許諾不明なら**使わず Unsplash か公式埋め込み（oEmbed）にフォールバック**する
- [ ] ローカル複製（`assets/press/`）する場合は“複製の許諾”がより明確であることを確認した

### 6.2 公式プレス画像の自動採用（`src/pressImage.js`・取り込み時）

§6.1 の「報道用素材を条件付きで使う」を、**一次情報の公式ソースに限って自動化**したもの。取り込み時、
記事の出典が各社の公式ドメインなら、そのページの `og:image`（各社が SNS 共有用に自ら配布している画像＝
報道用素材）を提供クレジット付きで自動採用する。stock 写真より優先し、取れなければ従来どおり stock/
抽象サムネへフォールバックする（**今より悪くならない**）。

**安全境界（なぜ壊れないか）**:
- **対象は allowlist のドメインだけ**（`config.pressImage.allowlist`）。各社が「自社について」発表する
  一次情報の公式ドメイン（openai.com / anthropic.com / blog.google / ai.meta.com / mistral.ai / x.ai /
  huggingface.co / blogs.nvidia.com / nasa.gov 等）のみ。
  ホストが「そのドメイン自身 or サブドメイン」なら一致。**第三者メディア（BBC/Guardian/TechCrunch 等）は
  対象外**——通信社・ライセンス物が多く転載が権利侵害になりやすいため、自動では絶対に使わない。
- **必ず「提供: 〈社名〉」＋出典リンク**を伴う（`check.js` が press 画像のクレジット必須を強制）。
- **URL を厳格検証**——絶対 http(s) で、`url('…')` やタグを破れる文字を含む URL は弾く（CSS/HTML インジェクション防止）。
- 取得失敗（403 でボット拒否する openai.com 等）・タイムアウト・`og:image` 無しは **null → stock へ**。
- `minImportance`（既定4＝`imageImportanceFloor` と同じ）未満の記事には付けない。
- 自動採用も手動同様 `kind:'press'`＝`backfill-images` の上書き対象外。ブランド不一致チェックの対象外
  （報道対象“本人”の公式画像なので）。手動登録（§6.1）は引き続き優先経路として利用できる。

**対象ソースの増減**は `config.pressImage.allowlist` を編集するだけ。`enabled:false` で機能ごと無効化。

---

## 7. 設定リファレンス（`src/config.js`）

| キー | 既定 | 説明 |
|---|---|---|
| `siteUrl` | 本番URL | 共有リンク・検索・canonical の絶対パス（`SITE_URL` で上書き可） |
| `siteName` / `siteDescription` | 俯瞰（FUKAN）/ 紹介文 | OGP・JSON-LD・RSS で使用 |
| `ogImage` / `logo` | /assets/og-default.jpg / /assets/logo.png | 共通OG画像・publisher.logo の絶対パス基準 |
| `operator` | FlowMate / 滝本哲也 / 所在地 / contact@flowmate.jp | 運営者ページ・JSON-LD publisher の情報 |
| `maxArticles` | 5 | 1回に掲載する上限本数（床を越えた分だけ＝可変。`MAX_ARTICLES` 環境変数で上書き可） |
| `candidatePool` | 30 | Claude に提示する候補数（小さいと primary で満杯になり media/新ソースが届かない） |
| `importanceFloor` | 3 | これ未満の重要度は掲載しない |
| `retentionTop` | 40 | トップ掲載の上限。超過分は月別アーカイブへ |
| `sectionBlockMin` | 2 | トップ中段カテゴリ別ブロックの最小本数。これ以上ある section を `navSections` 順に固定表示（未満は脱落） |
| `sectionBlockMax` | 4 | 1カテゴリ別ブロックあたりの最大カード数 |
| `searchIndexMax` | 600 | `search-index.json` に載せる最大件数（直近順・クライアント負荷抑制。全記事はアーカイブから辿れる） |
| `heroRecencyHours` | 24 | ヒーローは直近この時間内の最重要記事から選ぶ（トップ停滞の防止） |
| `skipUrlPatterns` | 動画/音声系 | 取材に向かない弱いソースを除外 |
| `aiKeywords` | AI関連語44件 | media 候補のAI関連度判定に使うキーワード |
| `relevanceFloorMedia` | 1 | media 候補のキーワードヒットがこれ未満なら除外 |
| `timeouts` | `{ rssMs:15000, linkCheckMs:5000 }` | ネットワーク timeout（ms）。RSS 取得（`fetchNews`）と出典リンク死活（`evaluate.checkLink`）。挙動を変える定数の一元管理 |
| `rssFeeds` | AI系14フィード | `tier` 付き。一次情報3＋メディア11（開発: GitHub/AWS ML/MS Dev/Stack Overflow、HW: NVIDIA/IEEE 等）。汎用フィードは `aiKeywords` で非AI記事を足切り |
| `imageProvider` / `*Key` | unsplash | 画像API（未設定なら CSS サムネ） |
| `pressImage` | `enabled:true` / allowlist13件（主要AIラボ＋公式ソース） | 公式ドメインの og:image を取り込み時に自動採用（§6.2）。`allowlist`＝報道用素材を認める一次情報の公式ドメイン。第三者メディアは対象外 |
| `analytics.token` | 空（`CF_BEACON_TOKEN`） | Cloudflare Web Analytics の beacon トークン。空なら出力しない |
| `thumbVariants` | CSS抽象サムネ6種 | 実写真が無いときのフォールバック（`styles.css` のグラデクラス） |
| `navSections` | 総合10セクション（AI/テクノロジー/サイエンス/ビジネス/経済・マネー/政治/国際・地政学/カルチャー/エンタメ/ライフ・キャリア） | ナビ生成元。各要素は `slug`（`sections/<slug>.html`）と `hue`（OKLCH 色相）を持つ。総合ニュース化で旧 AI 細分類から再編。`section` 値自体は自由でナビ外でも記事ページは生成 |
| `sectionAliases` | 旧7カテゴリ → `AI` | 旧 AI 細分類（産業応用/研究/基盤モデル/規制・倫理/スタートアップ/ハードウェア/開発）を navSections へ正規化。ingest 自動＋`npm run migrate-sections`。旧ラベルはタグへ退避（§編集・運用「カテゴリ正規化」） |

---

## 7.5 フロント機能（コンテンツ・体験）

| 機能 | 概要 | 実装 |
|---|---|---|
| タグページ | `tags/<タグ>.html`（UTF-8名）と `tags/index.html`（件数で大小をつけるタグクラウド）。記事内タグ・パンくずから辿れる。 | `templates/tag.js`, `render.js` |
| 関連記事 | タグ／セクションの一致度で「あわせて読みたい」を選出。関連集合内で**被写体（`image_query` キーワード＋画像URL）を分散**させ、同種写真の並びを避ける（関連度は犠牲にしない＝無関係記事は混ぜない）。 | `render.js: relatedFor` / `pickDiverse` / `imgSig` |
| トップの骨格 | 総合ニュースの定番骨格：**ヒーロー（リード1本）＋「トップニュース」右レール → 「最新」グリッド → カテゴリ別ブロック → 購読**。リードは重要度順（鮮度窓つき）、トップニュース＝`featured[1..6]`（右レール6本）。**カテゴリ別ブロックは `universe` に実在する `section` 値から ≥`sectionBlockMin`(2)本のものを自動生成**（1カテゴリあたり最大 `sectionBlockMax`(4) カード）。表示順は `navSections` 優先（薄いカテゴリも2本あれば見出しを出して固定表示）→`navSections` 外の旧カテゴリは本数降順で末尾。「すべて見る→」は `navSections` 名に一致するときのみ section ページへリンク（リンク切れ回避）。重複抑制のためヒーロー＋トップニュース既出は下段から除外。 | `templates/index.js: renderIndex` / `topRail` / `latestList` / `sectionBlocks` |
| 重要度で配置 | リード以下の「最新」「トップニュース」「カテゴリ別カード」はいずれも**エブロー型**（上段にメタ「カテゴリ · 日付＋時刻」、下段にセリフ見出し。ブロック内カード／セクションページはカテゴリ重複のため日時のみ＝`metaLine(a,false)`）。**同じ `metaLine()` をセクション/タグ/アーカイブの一覧でも共用**（`cardbits.js`）し全ページで体裁を統一。色や帯による強調は使わず、位置と型階層で序列を示す。日付＋時刻は `displayDateShort`（`MM.DD`）＋`displayTime`（`HH:MM`）で表示（`render.js: decorate`）。 | `render.js: importanceThenRecency` / `decorate`, `templates/cardbits.js: metaLine` |
| 型階層・エディトリアル | 色を増やさず**型と余白だけで序列**を立てる（白基調ミニマル堅持）。リード見出しを `clamp(--text-2xl, 6.4vw, 46px)`・字間 -0.014em でヘッドライン化、リード文（デッキ）をサンス→**セリフ 20px** に格上げ、「最新」見出し（`.feed__head`）を罫線付きの欄見出しに、本文 `.prose h2` の頭に短い罫線。**「最新」行はエブロー型**（`.feed-item` はフレックス縦積み、`.feed-item__meta` に「カテゴリ（`.feed-item__cat` ＝ ink-1・中字500・字間0.08em ＋ 中点 `::after`＝ink-2・前に余白）· 日時（`.feed-item__time`＝等幅数字）」、下段に `.feed-item__title`、一覧では出典 `.feed-item__src`＝右寄せ `align-self:flex-end`。余白広め・極薄罫線・見出し hover で青。単色のミニマル洗練）。記事リード `.article-lede` は 24px のデッキ格。新規トークンは追加しない（既存 `--text-*`/`--space-*` のみ）。※`importance>=5` の行強調（`.feed-item[data-imp]`/`.feed-item--lead`）は CSS 側を用意済みだがテンプレが当該属性を未出力のため現状休眠（無害）。由来: design-sprint 勝者案 B。 | `assets/styles.css`（§15 型階層）, `templates/index.js`/`article.js` |
| タブレット中間帯 | `640/600/420` のスマホ寄り BP に加え **680–1024px** を新設。ガターを 32px に広げ、`site-footer__top` を「ブランド全幅＋4等分」の2行に組み直して 600–768px の窮屈さを解消。`min-width` 加算でモバイル既存レイアウトは不変（相互排他で衝突なし）。 | `assets/styles.css`（§15 @media 680–1024px） |
| セクション表記 | 多色チップ（セクション別 hue）は**撤去**し、色を持たない中立のカテゴリ文字ラベル（`.cat` / 行リストの `feed-item__cat`）に統一。色信号の競合を避ける。 | `templates/cardbits.js: sectionChip`, `styles.css`（`.cat`） |
| 記事体験 | 読了時間（≈400字/分）、公開時刻、機能する共有ボタン（**X / LINE / はてブ / リンクコピー**、いずれも正式SVGアイコン）。共有URLは `siteUrl` 基準の絶対パス。**読了プログレスバー**（本文 `.prose` のあるページに自動表示）。 | `templates/article.js`, `assets/reveal.js` |
| 記事共有（progressive enhancement） | サーバーHTMLは X/LINE/はてブ/コピー の4ボタンを常時出力（JS無効でも動作）。`assets/share.js` が `navigator.share` 対応端末でだけルートに `has-web-share` を付与し、CSS が個別SNSを畳んで「**共有**（OS共有シート）＋**コピー**」の2点に切替（主にモバイル）。コピーは `navigator.clipboard`→失敗時 `execCommand` フォールバックで必ず成功表示。ホバーで各社ブランド色。 | `templates/article.js: shareButtons/SHARE_ICONS`, `assets/share.js`, `assets/styles.css`（`.share-btn` / `.has-web-share`） |
| ミニマル・演出 | 装飾演出（影・グレイン・発光・hover リフト＋画像ズーム・下線スライド・段階リビール）は**撤去**。動きは記事の読了プログレスバーのみ。対応ブラウザではページ遷移に控えめな View Transitions（`@view-transition`）。すべて `prefers-reduced-motion` で無効化。 | `assets/styles.css`, `assets/reveal.js` |
| 角丸スケール | 単一の `--radius`（8px）に統一（用途別の硬軟分けは廃止）。 | `assets/styles.css`（TOKENS節） |
| アクセシビリティ・人間工学 | 白基調で本文 `ink-0`／メタ `ink-2` とも WCAG AA 以上を確保。タップ領域はナビ各項目とも **44×44px 以上**。装飾モーションを持たず、唯一の動き（読了バー）も `prefers-reduced-motion` で停止。 | `assets/styles.css`（TOKENS節・`.site-nav`）, `templates/article.js`（クレジット色） |
| ライト/ダーク | 既定はライト（白基調）。OS が dark のときのみ簡素なダークへフォールバック（トグルは廃止）。`<head>` のインラインJSが OS設定/localStorage から `data-theme` を paint 前に適用（フラッシュ防止）。 | `styles.css` の `[data-theme="dark"]`, `layout.js` |
| サイト内検索 | `search-index.json`（直近 `searchIndexMax`=600 件）をクライアントで部分一致検索（見出し/タグ/セクション/リード重み付け、キーボード操作対応）。古い記事は月別アーカイブから辿る。追加依存なし。 | `assets/search.js`, `render.js`, `searchIndexMax` |
| 画像最適化 | Unsplash 画像に配信パラメータ（`w/q/auto=format/fit=crop`）を付与＋`images.unsplash.com` を preconnect。CLS はサムネの `aspect-ratio` で抑制。 | `cardbits.js: optimizedUrl`, `layout.js` |
| アナリティクス | `CF_BEACON_TOKEN` 設定時のみ Cloudflare Web Analytics（Cookieless・無料）の beacon を全ページに出力。未設定なら無出力。 | `config.analytics`, `layout.js` |

---

## 8. 定期実行（launchd）

- ラベル: `com.axiom.generate`
- plist: `~/Library/LaunchAgents/com.axiom.generate.plist`
- スケジュール: 毎日 **6:00 / 18:00**（1日2回）
- 実行: `scripts/auto-generate.sh`（ollama 不要・claude CLI を使用）
- ログ: `data/scheduler.log`
- **二重起動の排他**: `data/.harness.lock`（`mkdir` 原子性）。stale 判定の前に**ロック保持プロセスの生存を
  `kill -0` で確認**し、生存していれば経過時間に関わらず奪わない（`ingestDrafts` の `articles.json`
  書込み中の二重実行→破損を防ぐ）。プロセスが死んでいてかつ `LOCK_MAX_AGE`(3600s) 超のときだけ残骸として再取得する。
- 健全性監視: 実行前後で `articles.json` の件数を比較。**異常終了・articles.json 破損・push 失敗・
  新規ゼロが3回連続**のとき macOS 通知（`osascript`）を出す。連続回数は `data/.health` に記録。
  さらに **候補が1件以上あるのに下書き0本（＝writer 失敗の疑い）** は3回を待たず**即時通知**する
  （真に新着が無い回や、下書きは出たが veto/重複で全て公開見送りになった回＝品質ゲート作動、とは区別する）。
- **ソース変更ガード**: commit 前に `src/ templates/ scripts/ prompts/ package.json` の未コミット変更を検査し、
  あれば **auto-commit/push を中止して通知**する（作業途中コードが無人ジョブで自動公開される事故を防ぐ）。
  生成物・`data/` は対象外。クリーンな通常時のみ `git add -A` → commit → push する。

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
npm run check                # 公開前ゲート（レンダー完走＋スキーマ/slug・link一意＋鍵混入チェック）
npm run candidates           # 候補だけ確認（data/_candidates.json）
zsh scripts/auto-generate.sh # 取材→執筆→反映まで全自動で1回
npm run build                # articles.json から dist/ に全 HTML ＋ アセットを生成（Vercel と同一・→ §13）
npm run render               # articles.json から dist/ に HTML のみ再描画（アセット複製なし）
npm run serve                # dist/ を http://localhost:8000 で配信して目視
npm run quality-digest       # 直近記事の品質傾向フィードバックを表示（writer還流の内容確認・→ §12.3）
npm run backfill-images      # 既存記事の抽象サムネを実写真へ一括差し替え（要 UNSPLASH_KEY）
npm run set-press-image -- <slug> <imageUrl> <credit> [creditUrl] [source]  # 公式プレス画像を手動登録（→ §6.1）
```

> `npm run check` は一時ディレクトリへお試しレンダーするため**作業ツリーを汚さない**。手動で `git push`（=本番反映）する前に必ず実行する。開発時の規約は [CLAUDE.md](CLAUDE.md)、手動開発の PR フローは [CONTRIBUTING.md](CONTRIBUTING.md) を参照。

リセット: `data/articles.json` を削除（生成物は `dist/` に出るだけなので `dist/` を消す）。

---

## 10. 前提・依存

- **claude**（Claude Code CLI）が認証済みであること。執筆はこれに依存（Anthropic サブスク内）。
- **Node.js 18+**（内蔵 `fetch` を使用）。依存は `rss-parser` / `marked` / `dotenv` のみ。
- 画像APIキー（任意）: `UNSPLASH_KEY` / `PEXELS_KEY` を `.env` に。未設定でも CSS 抽象サムネで動作。

---

## 11. 設計上の既知事項

- **本文MarkdownのXSS無害化（多層防御）**: 本文は外部ソース由来の素材から生成されるため、`src/markdown.js` の
  `mdToHtml()` は marked レンダラで**生HTMLトークンをテキスト化**し、リンク/画像の `href`/`src` を**プロトコル許可リスト**
  （`http(s)`／`mailto`／相対／アンカーのみ）で検証する。`javascript:`・`data:`・`vbscript:` 等は `#` に無害化。
  無人＋push=即本番のため、ソース由来のインジェクションや writer 変更1回での公開事故を防ぐ。退行は `npm run check` の
  `checkSanitizer()`（既知の悪性入力を通して無害化を確認・オフライン・hard-fail）が検知する。
- **claude CLI 認証が切れると定期ジョブは失敗する**。`data/scheduler.log` を時々確認する。
- 記事の正本は `data/articles.json`。HTML はそこからの派生（いつでも `npm run build` で `dist/` に再生成可能）。
- **`loadArticles()` は破損時に throw する（握りつぶさない）**: ファイル不在は正常な初回として `[]` を返すが、
  読込/JSON parse 失敗は `throw`。これが `[]` を返すと load→save 経路（`ingestDrafts`／`set-press-image`／
  `migrate-sections`／`backfill-images`）が**既存記事を空配列で全上書き**してしまうため。破損時は `npm run check` が
  赤、`build`（Vercel）は fail-loud（空サイト公開を防ぐ）になる。`auto-generate.sh` の `count_articles()` は
  `require()` 直読みで破損時 -1 を返し健全性監視が通知する（整合）。
- **コード改善はブランチで**: 自動ジョブの `git push origin main` は `main` 上の未 push コミットも一緒に送るため、
  WIP を `main` に直コミットすると次の自動実行で本番へ出る。改善・機能追加は作業ブランチで行い、検証後に `main` へマージする（[CLAUDE.md](CLAUDE.md) §2）。
- `makeSlug` は「同日最大連番+1」方式（削除で欠番が出ても衝突しない）。
- zsh の `$status` は読取専用のため、シェルスクリプトでは別名（`rc`）を使う。
- **再描画は非決定的**: `feed.xml` の `lastBuildDate` と `sitemap.xml` の `lastmod` が毎回更新されるが、
  出力先は gitignore の `dist/` なので**git 差分には出ない**（§13）。`npm run check` は
  この性質を踏まえ「2回描画して diff 空」方式は採らず、一時dirへの描画完走で健全性を判定する。
- **左端整列（ガター不変条件）**: ロゴ／ナビ／リード／最新リスト／フッターは `.container`（`--gutter`：24px・SP 18px、`--site-max` 760px）で左端を揃える。`.container` を入れ子で**二重に付けない**（ナビ行・ヘッダーバーはそれぞれ `.container` を1つだけ持つ）。
  - **例外＝トップのみ PC で widen**: `<body class="page--home">` のとき `@media(min-width:1000px)` で `.container` を `--site-max-wide`（1120px）に拡張（ヘッダー/ナビ/メイン/フッターが揃って広がる）。`bodyClass` は `page()` の任意引数（既定空）で、トップ以外（記事/セクション/タグ/アーカイブ）は 760px のまま。`<1000px` は全ページ1カラム＝モバイル挙動を維持。
- **ナビ**: ヘッダー各タブは `config.navSections` から `sections/<slug>.html` を生成・リンク（`render.js`）。
  記事0のセクションも空状態ページを生成する。記事のパンくず／タグはセクション・タグページへリンク済み。
  **フッターは実ページ（運営者情報/編集方針/お問い合わせ/プライバシー/利用規約/免責/RSS）へ接続済み**。
- **未実装機能の扱い**: バックエンドが無いため、ログイン・メール購読・メルマガUIは**設置しない**（「準備中」アラートも撤去済み）。
  記事の購読は **RSS（`feed.xml`）** で提供。`feed.xml` は XSL（`feed.xsl`）でブラウザ表示時は読み物化、リーダーには通常のRSSとして機能。
- **広告**: 空の広告プレースホルダは撤去済み。AdSense 等を導入する際に枠を追加する（プライバシーポリシーは Cookie 利用に言及済み）。
- **SEO（P0・実装済み）**: OGP / Twitter Card / canonical / JSON-LD（NewsArticle・WebSite・Organization）/
  sitemap.xml / robots.txt / RSSフィード（feed.xml＋feed.xsl）を出力。共通OG画像 `assets/og-default.jpg`。
- **アナリティクス**: Cloudflare Web Analytics を導入済み（`.env` の `CF_BEACON_TOKEN`）。トークンは公開前提の値で、
  HTML（=デプロイ物）に埋め込まれる。`.env` 自体は git 管理外。

## 12. 自己改善ハーネス（MVP）

記事品質を継続的に上げるため、**評価→蓄積→改善** のループを既存パイプラインに載せる。
今回実装したのは **MVP（内ループ＋記憶）＋軽量フィードバック還流**。設計上の弱点（自己参照・代理指標の目標化・小N）への対策として
4つの錨（**出典照合・別モデル judge・人間キャリブレーション・不変条項**）を据えている。
**還流（最小の改善ループ）**: 直近記事の客観フラグを集計し、writer プロンプトへ動的注入する（§12.3 step 1・`src/qualityDigest.js`）。
代理指標は「床」であり最大化目標ではない（§12.1）ため、還流は**逸脱の是正の促し**にとどめ、数値最適化は誘発しない。

### 12.1 評価の信号（追加課金0・決定的）
- **客観指標**（`src/evaluate.js`・LLM/ネットワーク不使用）: 本文長・見出し長・リード長・タグ数・セクション整合・
  直近記事との話題類似度（タグ＋見出しの文字2-gram Jaccard）・画像種別。しきい値は `config.qualityThresholds`。
  **これらは「床（ガードレール）」であって最大化目標ではない**（機械的な水増し/切り詰めを誘発しないため）。
- **LLM 採点**（別モデル judge）: `config.rubric` の6次元を1〜5で採点。faithfulness は**出典リンクを再取得して事実照合**する。
- **人間キャリブレーション**: `npm run evaluate -- --rate <slug> <1-5> [メモ]` で人手評価を蓄積し、自己参照ループの錨にする。

### 12.2 不変条項（constitution）と退行検査
- `config.constitution`: 自己改善が**決して弱められない核**（事実忠実性・数値保全・全文転載しない・中立・出典明示）。
- `config.lockedDecisions`: 文字列で固定する決定（署名「AI 自動要約 + 人手編集」など）。
  記事HTMLから消えると `npm run check` が落ちる（**退行検査**）。

### 12.3 日次フロー（内ループ）
`scripts/auto-generate.sh` が3段で実行する（**stale安全ロックで二重起動を排他**）:
1. **writer（`config.writerModel`＝既定 Haiku）** `prompts/generate-articles.md` … 候補取得→取材→**自己批評**→下書き `data/_drafts.json`。**取り込みはしない**。要約＋論評タスクなので安価な Haiku で量産（約30本/日）。`auto-generate.sh` が `--model "$WRITER_MODEL"` で指定する。
   - **ツール暴走対策（重要）**: writer は `--tools`（`Bash Read Write Edit WebFetch WebSearch Glob Grep` の allowlist）＋ `--strict-mcp-config`（MCP サーバを全無効化）で起動する。既定のフルツールセットだと `ScheduleWakeup`/`Agent`/`Monitor`/`Workflow` 等のオーケストレーション系や MCP（lazyweb 等）を掴み、線形パイプライン（候補→取材→下書きWrite）から逸脱して**下書き0本で終わる事故**が起きたため（2026-06-26）、必要ツールだけに絞って構造的に防ぐ。可用性制限は `--tools` で行う（`--allowedTools` は自動承認の制御でツール可用性は絞らない）。
   - **リトライ／フォールバック**: 失敗（プロセス異常終了、または「候補ありなのに下書き0本」）時は最大 `WRITER_MAX_TRIES`（既定2＝初回＋1）まで再実行する。過負荷/瞬断には `--fallback-model`（既定 Sonnet）で対応し、可用性を底上げする（通常は Haiku を使う）。
   実行時、`src/qualityDigest.js`（直近8本の客観フラグ集計・決定的・オフライン）の**品質フィードバックをプロンプト末尾へ動的注入**する（前回までの逸脱の是正を促す）。取得失敗時は空＝従来挙動で**日次を止めない**。手動確認は `npm run quality-digest`。
2. **judge（別モデル `config.judgeModel`＝既定 Sonnet）** `prompts/review-drafts.md` … 出典照合で faithfulness を採点し、`data/_review.json` に
   各下書きの `verdict: pass|veto`＋スコアを出力。judge も writer 同様に `--tools`（`Bash Read Write WebFetch WebSearch`）＋ `--strict-mcp-config` で起動する（迷走防止）。**veto は「明確な事実誤り」で行う**（出典矛盾・数値/単位の改変・更新済み数値の旧値記載・趣旨の取り違え＝過小/過大表現・出典死活・constitution 違反）。事実誤りは `suggestions` で流さず veto し、**迷う事実誤りは veto 寄り**に倒す。一方、体裁・文体・構成の好みでは落とさない（事実が出典と一致していれば pass＋suggestions、迷ったら pass）。
3. **ingest** `src/ingestDrafts.js` … veto を尊重して破棄、画像付与・再生成、評価を **ledger** に追記。
- **トークン削減の triage**: judge 呼び出しの前に `node src/evaluate.js --triage` を実行。下書きが**すべて `tier:'primary'` かつ客観フラグ無し**の
  低リスク回は judge を**丸ごとスキップ**（客観ゲート＋writer 自己批評のみで公開）。`media` 混在 or 客観フラグ有り＝独立検証が最も要る回だけ judge を走らせる。
  `tier` が `primary` と明示されない下書きは risky 扱い（フェイルセーフ）。writer=Haiku のため judge は一段上の **Sonnet** を既定にしている（writer≠judge を保ち、安いHaikuの量産を賢いSonnetが独立検証する分業）。
- **失敗時最優先＝日次を止めない**: judge がエラー/タイムアウト/スキップでも**ブロックせず**客観ゲートのみで通常公開し（失敗時は通知＋`data/quality/incidents.jsonl` に `judge_absent` を1行記録して後追い分析できるようにする）。

### 12.4 記憶（ledger）
`data/quality/`（**data 配下＝dirty ガードに触れず auto コミットに乗る**）:
- `evaluations.jsonl` … 1記事1評価（客観指標＋judge 結果を合流）。
- `runs.jsonl` … 実行ごとのサイト集計（セクション/importance 分布・画像ヒット率・平均フラグ）。
- `calibration.jsonl` … 人間評価。
- `incidents.jsonl` … 運用イベント（現状は judge 不在 `judge_absent`）。日次を止めずに観測性だけ残す。

### 12.5 将来フェーズ（未実装・検証ゲートの先）
MVP を数日〜2週間運用し「評価信号が役立つ」と確認できたら着手する:
- **外ループ（週次・別ブランチ・人間承認 PR）**: ledger＋calibration を分析し、`prompts`/`config`（可変パラメータ）/`templates`/CSS への
  改善差分を作る。**constitution は不可・design はテキスト提案のみ**（headless はピクセルを見ないため）。
- **対話ハーネス**: subagents（news-judge / site-auditor）と slash commands（`/evaluate`・`/self-improve`）。
  `/self-improve` は preview スクショ＋デザインスキルで**視覚監査込み**の改善を人と回す。

---

## 13. ビルド・配信（Vercel）

生成物（HTML/feed/sitemap/search-index）は **VCS にコミットしない**。Vercel が**デプロイ時にビルド**して配信する。

- **出力先**: 全生成物は `dist/`（gitignore 済み）。`renderSite()` の既定 `outDir` が `dist`（`src/render.js`）で、ingest/backfill/set-press/renderОnly のレンダーもすべて dist に出る。`check.js` だけは一時ディレクトリへ描画して作業ツリーを汚さない。
- **`npm run build`（`src/build.js`）**: `renderSite()` → dist ＋ `assets/` を `dist/assets/` へ複製（`cpSync`・依存追加なし）。これ1本で「dist だけで配信が完結」する。Vercel もローカル目視もこれを使う。
- **`vercel.json`**: `buildCommand:"npm run build"` / `installCommand:"npm install"` / `outputDirectory:"dist"`。Vercel は push 時に install→build し、`dist/` を公開する。render はオフライン・決定的（`articles.json` を読むだけ）なのでビルドは安定して通る。
- **狙い（Git 肥大の抑止）**: 旧モデル（生成物を root にコミットし `outputDirectory:"."` で無加工配信）では自動ジョブの `git add -A` が毎回数百ファイルを churn し `.git` が肥大していた。dist 化で各 auto コミットは実質 `data/articles.json` の差分のみになる。
- **副次効果**: `dist/` 外のソース・ドキュメント（`SPEC.md`・`CLAUDE.md`・`src/` 等）は**公開配信されない**（旧モデルでは `/SPEC.md` 等が公開されていた）。
- **非決定性と git の関係**: `feed.xml` の `lastBuildDate`・`sitemap` の `lastmod`・日付ラベルは毎回変わるが、出力先が gitignore の `dist/` なので**git 差分には出ない**。
- **スコープ外（別ロードマップ）**: render の決定化、既存履歴の `git filter-repo` 縮小、`data/articles.json` の月別シャーディング/SQLite 化。
