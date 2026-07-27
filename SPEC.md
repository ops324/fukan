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
       ① writer（claude・config.writerModel＝Haiku）← prompts/generate-articles.md
            node src/fetchCandidates.js
              RSS取得 → 重複排除 → 弱いソース除外 → AI関連度足切り
              → 本文補完（summaryFetch・robots許可ドメインのみ）→ 一次情報優先＋セクションround-robin
              → data/_candidates.json（候補プール・既定140件／選別の内訳は incidents.jsonl へ）
            候補を重要度1〜5で採点し3以上を最大25件選別（床を越えた分だけ・可変）、類似は統合
            取材（WebFetch／読めなければ候補のsummary→trustedSecondaryで裏取りしsources[]に記録）→ 執筆
              → data/_drafts.json（下書き）
            ※ 直近の veto 傾向と体裁逸脱（qualityDigest）をプロンプト末尾へ動的注入
       ② judge（claude・config.judgeModel＝Sonnet）← _veto-criteria.md + review-drafts.md
            ※ node src/evaluate.js --triage が 1 のときだけ起動（全件primary＋フラグ無しならスキップ）
            出典照合（link → 候補summary → sources[]）→ 記事間の取り違えを横断チェック
            → ルブリック採点・veto判定・fixable/fixHint・sourceFetched
              → data/_review.json
       ③ 修正リトライ（config.fixRound.enabled・**1回限り**・§12.6）
            prepareFixRound（対象抽出＋バックアップ）→ fix-writer（Haiku）→ 再査読（Sonnet・**基準は初回と同一**）
            → mergeFixReview（決定論の検証・違反は原状復帰・_review.json へ統合）
       ④ node src/ingestDrafts.js
            veto破棄（理由を vetoes.jsonl へ）→ 二重掲載ブロック → slug採番 → 画像取得 → data/articles.json 保存
            → render（dist/ へ：index / archive（月インデックス＋archive/YYYY-MM）/ articles/* / sections/* / tags/*
                      / 法的6ページ / search-index.json / sitemap.xml
                      / robots.txt / feed.xml / feed.xsl）※ dist は gitignore のため commit されない
            → 評価を ledger へ（evaluations.jsonl / runs.jsonl）
       ⑤ 画像一致の LLM 査読（境界スコアの新規stock画像があるときだけ・既定OFF・§6.3）
       └─ 健全性チェック（認証切れ → 記事数増減・exit code の順に判定）→ 異常なら macOS 通知＋data/.status
       └─ 変更があれば git commit & push（実質 data/articles.json の差分のみ）→ Vercel が npm run build でデプロイ
            ※ 認証切れのランは記事ゼロ＝公開すべき変更なしなので commit/push ごとスキップ
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
├── tags/<tagSlug>.html     # 生成: タグ別一覧（UTF-8ファイル名・src/tagSlug.js で整形）＋ index.html（タグクラウド）
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
│   ├── _review.json        # 一時: judge の判定（verdict/scores/fixable/sourceFetched）
│   ├── _drafts.bak.json    # 一時: 修正リトライ前のバックアップ（原状復帰に使う・§12.6）
│   ├── _fix_targets.json   # 一時: 修正対象（link/headline/critique/fixHint。scores は渡さない）
│   ├── _fix_result.json    # 一時: fix-writer の自己申告（fixed | unfixable）
│   ├── _review_fixed.json  # 一時: 再査読の結果（mergeFixReview が _review.json へ統合）
│   ├── quality/            # 評価 ledger（§12.4）
│   │   ├── evaluations.jsonl # 1記事1評価（客観指標＋judge 結果＋sourceFetched）
│   │   ├── vetoes.jsonl      # 不採用にした下書き（critique 原文・categories・救済結果）
│   │   ├── runs.jsonl        # 実行ごとのサイト集計
│   │   └── incidents.jsonl   # 運用イベント（judge_absent / auth_failed / publish_blocked / ledger_write_failed / candidates 等）
│   ├── .health             # 一時: 新規ゼロの連続回数（監視用・git管理外）
│   ├── .status             # 一時: 最終実行の状態サマリ（人間が読む・git管理外）
│   ├── _writer.log         # 一時: writer 出力の退避（認証エラー検査用・実行後に掃除）
│   └── scheduler.log       # 定期実行ログ
├── prompts/
│   ├── generate-articles.md # writer への執筆指示（編集方針を内包）
│   ├── _veto-criteria.md    # veto 判定基準の**正本**。初回査読と再査読の両方へ cat で合成する
│   ├── review-drafts.md     # judge への初回査読指示（出典照合・採点・fixable 判定）
│   ├── fix-drafts.md        # 修正リトライ: writer への訂正指示（§12.6）
│   ├── review-fixed.md      # 修正リトライ: judge への再査読指示（基準は初回と同一）
│   └── review-images.md     # 画像一致の LLM 査読（境界スコアのみ・既定OFF・§6.3）
├── scripts/
│   └── auto-generate.sh    # launchd ラッパー（ヘッドレス Claude を起動）
├── src/
│   ├── config.js           # 設定（フィード・件数・閾値・画像）
│   ├── fetchCandidates.js  # 候補を JSON 出力
│   ├── fetchNews.js        # RSS/補助API 取得・重複排除・一次情報優先・候補選別の内訳を ledger へ
│   ├── summaryFetch.js     # 候補の本文補完（robots.txt が許可したドメインのみ・§7 summaryFetch）
│   ├── notifySlack.js      # Slack 通知（異常＋実行サマリ。未設定なら何もしない・§8）
│   ├── ingestDrafts.js     # 下書き取込（採番・画像・保存・再生成）
│   ├── fetchImage.js       # Unsplash/Pexels 画像＋関連度スコアリング（無ければ画像なし）
│   ├── imageBrands.js      # 記事とサムネのブランド不一致判定（他社ロゴ/UI の写り込みを弾く）
│   ├── refreshBrandPhotos.js # ブランド写真の索引を生成（data/brand-photos.json・マージ方式）
│   ├── recheckImageBrands.js # 既存記事のサムネをブランド不一致で点検・差し替え
│   ├── recheckImageRelevance.js # 既存記事のサムネを記事との関連度で点検・差し替え
│   ├── applyImageReview.js # 画像一致 LLM 査読（§6.3）の keep/swap 結果を適用
│   ├── backfill-images.js  # 既存記事に実写真を一括付与（press画像は上書きしない）
│   ├── pressImage.js       # 公式ドメインの og:image を取り込み時に自動採用（報道用素材・allowlist厳格）
│   ├── set-press-image.js  # 公式プレス画像を特定記事へ手動登録（クレジット必須・上書き保護）
│   ├── render.js           # 重要度序列・保持・アーカイブの描画統括（任意 outDir 対応）
│   ├── renderOnly.js       # 再描画のみ
│   ├── check.js            # 公開前チェック（render完走/スキーマ/鍵混入）
│   ├── store.js            # articles.json 読み書き・slug採番
│   ├── markdown.js         # md→html / エスケープ / 本文の生HTML・危険プロトコル無害化
│   ├── evaluate.js         # 客観評価・ledger 追記・有界化・二重掲載の特徴語判定（§12.1）
│   ├── qualityDigest.js    # 直近の逸脱と veto 傾向を writer プロンプトへ還流（§12.6）
│   ├── vetoLedger.js       # veto の記録と critique の分類（data/quality/vetoes.jsonl）
│   ├── vetoDigest.js       # veto 傾向 → writer への是正指示テキスト
│   ├── seedVetoLedger.js   # 過去の veto を scheduler.log から遡及投入（冪等・既定 dry-run）
│   ├── prepareFixRound.js  # 修正リトライの対象抽出とバックアップ（§12.6）
│   └── mergeFixReview.js   # 修正結果の検証・原状復帰・再査読の統合（決定論の安全装置）
├── templates/
│   ├── layout.js           # skip link/header(ナビ・検索)/footer/page 骨格・解析
│   ├── cardbits.js         # 共有: メタ行 metaLine()/isoDate() / 中立カテゴリラベル sectionChip() / tagHref() / optimizedUrl() / 版面マーク plate()
│   ├── index.js            # トップ（ヒーロー＋トップニュース右レール→最新グリッド→カテゴリ別ブロック→購読）
│   ├── article.js          # 記事詳細（読了時間・共有ボタン[X/LINE/はてブ/コピー＋Web Share]・関連記事）
│   ├── section.js          # セクション別一覧
│   ├── tag.js              # タグ別一覧 renderTag() / タグクラウド renderTagsIndex()
│   ├── legal.js            # 法的・運営ページ renderLegalPages()
│   └── archive.js          # アーカイブ（月インデックス renderArchiveIndex / 月別 renderArchiveMonth）
├── CLAUDE.md               # 開発ルール（毎回自動読込・コード品質/Git/検証）
├── README.md               # デザイン・概要
├── SPEC.md                 # 本書（技術仕様・運用）
├── package.json            # スクリプト（candidates / render / check / backfill-images / recheck-images / recheck-image-relevance / refresh-brand-photos / set-press-image / serve）
├── .env.example            # 環境変数の雛形（すべて任意）
└── _backup/                # 退避（旧HTML・廃止した qwen フォールバック）
```

> ドキュメント3層: **CLAUDE.md＝開発ルール** / **SPEC.md＝技術仕様・運用** / **README.md＝デザイン・概要**。記事の編集方針は `prompts/generate-articles.md`。

---

## 4. データスキーマ（`data/articles.json` の1要素）

```jsonc
{
  "slug": "20260613-09",            // YYYYMMDD-連番（最大連番+1で採番）。ファイル名・URLになるため形式は check が hard-fail で固定
  "headline": "…",                  // 日本語見出し（40字以内）
  "lead": "…",                      // 要点1文（80字以内）
  "body_markdown": "…",             // 本文（Markdown・目安550〜750字／床450・上限900で警告）
  "tags": ["…"],                    // 日本語タグ 3〜5個。取り込み時に tagSlug で整形＋重複排除（パスに使えない文字は '-' へ・§11）
  "section": "AI",                  // セクション（navSections 推奨。旧カテゴリは sectionAliases で正規化）
  "source": "OpenAI",               // 出典名
  "link": "https://…",              // 出典URL（冪等キー）＝主出典
  "sources": [{ "url": "https://…", "name": "Reuters" }],
                                    // 裏取りに使った2次媒体（任意・レガシー記事には無い＝後方互換）。
                                    // 出典本文を取得できないときに参照した報道を記録し、記事ページの
                                    // 出典欄へ併記して読者が検証できるようにする（§5「複数出典の明示」）。
                                    // 取り込み時に config.trustedSecondary 外のホスト・壊れたURL・
                                    // 主出典の重複を落とす（ingestDrafts.normalizeSources・上限4件）。
  "importance": 4,                  // 重要度 1〜5（編集序列に使用）
  "image_query": "data center servers", // Claude が決めた画像検索ワード（内容準拠）
  "image": { "imageUrl": "…", "photographer": "…", "profileUrl": "…", "provider": "unsplash",
             "alt": "a computer generated image of a human brain", "description": "…（任意）" },
                                    // alt/description は提供元の説明文（ブランド不一致・関連度の判定に使う。§6の2.5/2.7）。
                                    // どちらも公開出力には出さない内部メタデータ。description は非空時のみ保存。
                                    // レガシー記事には無い（欠落可・後方互換）。Unsplash の alt は null が多いため
                                    // description を併せ持つと遡及点検（recheck）のカバレッジが上がる。
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
| **出典が読めないときの手順** | 出典の約3割は自動取得できない（§11）。**想像で埋めない**。①候補の `summary`（出典サイト自身が配信した RSS 要約）で書ける範囲を書く ②足りなければ `trustedSecondary` の報道機関で裏取りし、**使った媒体を `sources[]` に記録** ③どれでも確認できない事実は書かない（450字に届かないならその候補を選ばない）。 | `trustedSecondary`, `prompts/generate-articles.md` |
| **複数出典の明示** | 他媒体を参照すること自体は正しい取材だが、**参照したなら読者に見せる**のが条件。`sources[]` は記事ページの出典欄に併記され、本文でも帰属を示す（例:「ロイターによると〜」）。記録せず他所の数値を書くのは veto 事由——`link` を掲げながらそこに無い数値を載せると読者が検証できない。 | `templates/article.js: sourceCard`, `prompts/_veto-criteria.md` |
| **固有名詞の表記** | 企業名・製品名・人名は**出典の表記をそのまま**使う。原綴りがあるものは原綴りで書き、独自にカタカナ化しない（`SpaceX` を「スペックス」と書かない）。見出し・リードも揃える。逸脱は veto 事由（読者が別の対象と誤認するため体裁ではなく事実の問題として扱う）。 | `prompts/generate-articles.md`, `prompts/_veto-criteria.md` |
| **二重掲載の防止** | 同じ出来事を出典違いで複数本出さない。`link` 重複排除は同一URLしか捕まえないため、取り込み時に**特徴語の包含率**でも判定する（§11）。 | `dupBlockContainment`, `dupBlockMinShared`, `ingestDrafts` |

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
   - **③簡易語彙マップ** — `tags`／見出しから推定（例: 診断→`medical healthcare hospital`）。総合ニュース各分野
     （政治／国際／環境／エンタメ／経済等）のパターンを含む（`KW_MAP`）。
   - **④既定** — 記事の `section` に応じた中立語（`SECTION_DEFAULT`。例 政治→`government building parliament`、
     国際→`world map globe`）。未定義セクションは `artificial intelligence technology` にフォールバック。
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
2.7. **関連度スコアリング（`config.imageRelevance`・API 追加コストなし）** — ブランド排除後の候補を、
   写真の `alt`+`description` と記事キーワードの重なりで採点し、**最も内容が合う写真を選ぶ**（従来は先頭採用）。
   記事側トークンは重み付き（`image_query` 最強 ＞ `KW_MAP` 由来 ＞ `tags`/見出しの英字。汎用語は除外せず低重み化）。
   `enabled=false` で従来の先頭採用に即戻せる安全弁。**このスコアリングは正の一致判定**で、2.5 の負の除外（ブランド不一致）を補完する。
   - **重複回避との両立** — 最高スコア±`tolerance` を「同等」とみなし、その帯内で未使用を優先。帯内に未使用が無ければ
     **全候補から未使用を探す**（従来の重複回避の強度を維持）。
   - **弱一致の扱い** — どのクエリも `minScore` 未満なら「弱一致」を退避して次の広い語へ。全滅時は `acceptWeak` なら
     退避した最良候補を採用（抽象サムネより実写を優先）。既定 `minScore:0` はクエリ拡張挙動・抽象サムネ落ち率を現行のまま保つ。
   - **限界** — トークン一致のため「語は重なるがトピック違い」の写真を拾う余地がある。そこは 6.3 の LLM 査読が補う。
3. **重複回避** — 候補の中から**他記事で未使用の写真を選ぶ**。判定は `imageKey()`（URL から写真固有IDを抽出）。
   使用済みキーの `Set` を生成・バックフィル全体で共有し、既存記事とも突き合わせる。
   全件使用済みのときのみ index ベースで分散（最終手段は重複許容）。スコアリング有効時は 2.7 の帯内で効かせる。
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
差し替え後は同じ判定器で検査し直し、`解消 N / 依然として不一致 M` を集計する（下の関連度点検と同じ規律）。

**既存記事の関連度点検（`npm run recheck-image-relevance`）** — 保存画像の `alt`＋`description` と記事キーワードの
関連度を採点し、`config.imageRelevance.recheckMinScore`（既定1・取り込み時 `minScore` とは別）未満を洗い出す（API 不要）。
既定 dry-run／`--apply` で差し替え。**制約**: 説明文（alt/description）が両方とも無い記事は採点不能なので、スコア0でも
「メタデータ欠落」であり**ミスマッチとは別枠**として集計する（証拠のない一括差し替えをしない）。レガシー記事は説明文が
無いものが多い（新規記事は取り込み時に alt/description を保存するため自然に減る）。実務上のミスマッチ抽出は 6.3 の LLM 査読が有効。
`--slug <slug>` で1件だけを対象にできる（個別に見つけたミスマッチを直すのに、他の記事まで巻き込んで API を消費しないため）。

> **地名は被写体語として扱わない**（2026-07-27 に修正）。写真の説明文は「どこで撮ったか」より「何が写っているか」を
> 書くため、地名の一致は写真がその出来事を写している保証にならない。`config.imageRelevance.placeTokens` に挙げた
> 地名・国名・国籍は `genericTokens` と同じ `genericWeight` まで薄める。
> *背景*: 台風が中国に上陸した記事に、スウェーデンで撮られた「Coca-cola china filmstad sign on snowy day」が
> 付いていた。`image_query` は `typhoon landfall china weather` で、写真側は `china` の1語だけが一致。
> 重み 1.0 × 1語 がちょうどしきい値 1 に達し、点検を素通りしていた（1052記事のうち判定が変わったのはこの1件のみ）。
>
> **差し替え時は対象の写真を `used` に残したまま取得する**。先に解放すると、いま不適合と判定したその写真が
> 再び最高スコア候補として選び直され、中身が変わっていないのに「差し替えました」と報告される（同日に実際に発生）。
> 同一キーが返った場合は「変化なし」として数え、差し替え0件なら保存・再生成そのものを行わない。
>
> **差し替えた結果は同じ判定器で採点し直す**。写真が入れ替わっただけで依然としてしきい値未満なら
> 「直った」とは言えない——ここを見ないと*点検して直したつもりのまま不適合が残り続ける*。
> 実例（2026-07-27）: 台風記事のサムネを差し替えたが score 0.15 のままで、それでも「✓ 差し替え」と
> 報告されていた。現在は `改善 N / 依然として不足 M` を集計し、残ったものは slug と `image_query` を
> 添えて末尾に警告する。抽象サムネ（適合写真なし）は正しい結論なので不足には数えない。
> **この規律は `npm run recheck-images`（ブランド不一致）にも同じ形で適用する**——別の他社ブランドが
> 写った写真に替わっただけでは直っていない。

### 6.3 画像一致の LLM 査読（任意・境界ケースのみ・既定 OFF）
決定論スコア（2.7）で判断が付きにくい境界ケースだけを、別モデル judge の意味理解で keep/swap 裁定する層。
`config.imageRelevance.llmReview.enabled`（既定 `false`）で切替。判定は写真の `alt` × 記事 `headline`/`lead`（**テキストのみ**・
Vision 不使用）で、翡翠眼方式（API キー不使用・CLI サブスク内）。フロー:
1. `ingestDrafts.js` が画像付与後、スコアが `llmReview.band`（境界帯）の**新規 stock 画像**を `data/_image_review_targets.json` に書く（該当ゼロなら書かない＝以降スキップ）。
2. `auto-generate.sh` が ingest 後、ターゲットがあるときだけ judge モデルで `prompts/review-images.md` を実行し `data/_image_review.json` に `{slug, verdict, reason}` を出力。
3. `src/applyImageReview.js` が `swap` の記事だけ画像を再取得・再生成し、一時ファイルを掃除。
**judge と同じ規律で失敗しても公開は止めない**（不在は `incidents.jsonl` に記録）。一時ファイルは gitignore 済み＝自動コミットに載らない（配信モデル不変）。

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
- **UA は既定で正直な Bot 名乗り**（`config.pressImage.userAgent`）。一部の公式ドメイン（例: openai.com の
  Cloudflare）は Bot UA を一律 403 で拒否するため、**403 が返ったときだけ**ブラウザ UA
  （`config.pressImage.fallbackUserAgent`）で1回だけ再試行する（全面的な UA 偽装ではなく 403 時限定の保険。
  既に Bot UA で成功しているドメインの挙動は変えない）。
- 再試行しても失敗・タイムアウト・`og:image` 無しは **null → stock へ**（今より悪くならない安全設計）。
- `minImportance`（既定4＝`imageImportanceFloor` と同じ）未満の記事には付けない。
- 自動採用も手動同様 `kind:'press'`＝`backfill-images` の上書き対象外。ブランド不一致チェックの対象外
  （報道対象“本人”の公式画像なので）。手動登録（§6.1）は引き続き優先経路として利用できる。

**対象ソースの増減**は `config.pressImage.allowlist` を編集するだけ。`enabled:false` で機能ごと無効化。
allowlist ドメイン判定 `pressAllowlistCredit()` は `pressImage.js` から export され、他ツール（`evaluate.js` 等）
からも同じ判定を再利用する（単一情報源）。

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
| `slack` | `webhookUrl`（`SLACK_WEBHOOK_URL`）/ `timeoutMs:5000` / `notifyOnSuccess:true` | 自動ジョブの**異常と実行サマリ**を Slack へ送る（`src/notifySlack.js`・§8）。`notifyOnSuccess:false` にすると異常時のみになる。**未設定・不正 URL・ネットワーク断のいずれでも通知は常に exit 0** で、日次を止めない。Webhook URL は秘密情報なので `.env` にのみ置く（`PUBLIC_ENV_KEYS` に入れない＝値が追跡ファイルに混入すれば `npm run check` が赤） |
| `thumbVariants` | CSS抽象サムネ6種 | 実写真が無いときのフォールバック（`styles.css` のグラデクラス） |
| `navSections` | 総合10セクション（AI/テクノロジー/サイエンス/ビジネス/経済・マネー/政治/国際・地政学/カルチャー/エンタメ/ライフ・キャリア） | ナビ生成元。各要素は `slug`（`sections/<slug>.html`）と `hue`（OKLCH 色相）を持つ。総合ニュース化で旧 AI 細分類から再編。`section` 値自体は自由でナビ外でも記事ページは生成 |
| `summaryFetch` | `enabled:true` / `domains:['openai.com']` / `minSummaryLen:400` / `maxChars:1200` | RSS 要約が薄い候補の**本文を Node 側で取得して `summary` を厚くする**（`src/summaryFetch.js`）。writer/judge の WebFetch は 403 に打つ手がないため、先に読んで候補に載せる。403 のときだけ `pressImage.fallbackUserAgent` で1回再試行（画像取得と同じ手当て）。**`domains` に載せてよいのは robots.txt が明示的に許可したドメインのみ**——拒否しているサイトへの適用は意思の迂回になる（§11）。失敗しても候補は RSS の要約のまま残る |
| `timeouts.summaryFetchMs` | 8000 | 上記の取得タイムアウト |
| `trustedSecondary` | 通信社・主要報道・学術系 約40ドメイン | 出典本文を取得できないときに**裏取りへ使ってよい2次媒体**。ここに無いホスト（ブログ・まとめ・SNS・出所不明）は取り込み時に `sources[]` から落とされる。判定は「それ自身 or そのサブドメイン」（`pressImage.allowlist` と同じ規則） |
| `qualityThresholds.dupBlockContainment` | 0.8 | 二重掲載として**取り込みをブロック**する特徴語の包含率。実測でこの閾値でないと対象ケース（0.83）を逃す |
| `qualityThresholds.dupBlockMinShared` | 3 | 同時に要求する共通特徴語の数。特徴語1〜2語での誤ブロックを防ぐ |
| `qualityThresholds.dupBlockJaccard` | 0.78 | 「見出しがほぼ同一」のケース用に併置する従来型の閾値（警告用 `dupJaccardMax`=0.6 より高い） |
| `freshness.staleDays` | 2 | `npm run check` が「最終記事からの経過日数」を警告するしきい値（非ブロック）。1日2回稼働なので 2日＝4ラン分の空振り。自動ジョブの無言停止に手作業時も気づくための最後の砦（§11） |
| `ledger.coverageWindow` | 50 | `npm run check` が「直近 N 件が品質 ledger に記録されているか」を警告する母集団（非ブロック）。1ラン最大25本×1日2回なので直近1日ぶんに相当。ローテーション上限（`evalMaxLines`）より十分小さく、切り詰められた古い行を誤検知しない（§11） |
| `sectionAliases` | 旧7カテゴリ → `AI` | 旧 AI 細分類（産業応用/研究/基盤モデル/規制・倫理/スタートアップ/ハードウェア/開発）を navSections へ正規化。ingest 自動＋`npm run migrate-sections`。旧ラベルはタグへ退避（§編集・運用「カテゴリ正規化」） |

---

## 7.5 フロント機能（コンテンツ・体験）

| 機能 | 概要 | 実装 |
|---|---|---|
| タグページ | `tags/<tagSlug(タグ)>.html`（UTF-8名）と `tags/index.html`（件数で大小をつけるタグクラウド）。記事内タグ・パンくずから辿れる。ファイル名・`tagHref`・canonical・sitemap の4経路すべてが `tagSlug()`（`src/tagSlug.js`）を通り、パスとして壊れる文字（`\ / : * ? " < > \|` と制御文字）を `-` に落とす。タグは取り込み時にも正規化されるため、表示名と slug は一致する（§11）。 | `templates/tag.js`, `render.js`, `src/tagSlug.js` |
| 関連記事 | タグ／セクションの一致度で「あわせて読みたい」を選出。関連集合内で**被写体（`image_query` キーワード＋画像URL）を分散**させ、同種写真の並びを避ける（関連度は犠牲にしない＝無関係記事は混ぜない）。 | `render.js: relatedFor` / `pickDiverse` / `imgSig` |
| トップの骨格 | 総合ニュースの定番骨格：**ヒーロー（リード1本）＋「トップニュース」右レール → 「最新」グリッド → カテゴリ別ブロック → 購読**。リードは重要度順（鮮度窓つき）、トップニュース＝`featured[1..6]`（右レール6本）。**カテゴリ別ブロックは `universe` に実在する `section` 値から ≥`sectionBlockMin`(2)本のものを自動生成**（1カテゴリあたり最大 `sectionBlockMax`(4) カード）。表示順は `navSections` 優先（薄いカテゴリも2本あれば見出しを出して固定表示）→`navSections` 外の旧カテゴリは本数降順で末尾。「すべて見る→」は `navSections` 名に一致するときのみ section ページへリンク（リンク切れ回避）。重複抑制のためヒーロー＋トップニュース既出は下段から除外。 | `templates/index.js: renderIndex` / `topRail` / `latestList` / `sectionBlocks` |
| 重要度で配置 | リード以下の「最新」「トップニュース」「カテゴリ別カード」はいずれも**エブロー型**（上段にメタ「カテゴリ · 日付＋時刻」、下段にセリフ見出し。ブロック内カード／セクションページはカテゴリ重複のため日時のみ＝`metaLine(a,false)`）。**同じ `metaLine()` をセクション/タグ/アーカイブの一覧でも共用**（`cardbits.js`）し全ページで体裁を統一。色や帯による強調は使わず、位置と型階層で序列を示す。日付＋時刻は `displayDateShort`（`MM.DD`）＋`displayTime`（`HH:MM`）で表示（`render.js: decorate`）。 | `render.js: importanceThenRecency` / `decorate`, `templates/cardbits.js: metaLine` |
| 日本語組版 | 見出し／デッキに `font-feature-settings: 'palt'`（和文プロポーショナル＝約物のアキ詰め）を適用。**本文には掛けない**（長文で窮屈になる）。`word-break: auto-phrase` で**文節折り返し**——「上場/後初決算」のような語中での分断と、助詞が行頭に取り残される組みを解消する（代償として見出しが1行増える場合がある。実測 7 件中 2 件）。`text-spacing-trim: trim-start` で行頭の始め括弧を詰める。`font-optical-sizing: auto` を明示（Fraunces は opsz 9..144 の可変フォントだが従来は未指定で大サイズのディスプレイ字形が効いていなかった）。**和欧の字間を分離**——palt が和文を詰めるぶん欧文向けの負トラッキングを浅くする（lead 見出し -0.014em → -0.006em。深いままだと和文が潰れる）。`time`／件数は `tabular-nums` で桁を揃え一覧の縦のリズムを守る。`.prose strong` は 500 固定（700 を要求すると Noto Sans JP は 400/500 しか読み込んでおらず擬似ボールドで潰れる）。いずれも非対応ブラウザでは従来どおりに落ちる（progressive enhancement）。 | `assets/styles.css`（§2 RESET/BASE） |
| 型階層・エディトリアル | 色を増やさず**型と余白だけで序列**を立てる（白基調ミニマル堅持）。リード見出しを `clamp(--text-2xl, 6.4vw, var(--text-4xl))`・字間 -0.006em でヘッドライン化、リード文（デッキ）をサンス→**セリフ 20px** に格上げ、「最新」見出し（`.feed__head`）を罫線付きの欄見出しに、本文 `.prose h2` の頭に短い罫線。**「最新」行はエブロー型**（`.feed-item` はフレックス縦積み、`.feed-item__meta` に「カテゴリ（`.feed-item__cat` ＝ ink-1・中字500・字間0.08em ＋ 中点 `::after`＝ink-2・前に余白）· 日時（`.feed-item__time`＝等幅数字）」、下段に `.feed-item__title`、一覧では出典 `.feed-item__src`＝右寄せ `align-self:flex-end`。余白広め・極薄罫線・見出し hover で青。単色のミニマル洗練）。記事リード `.article-lede` は 24px のデッキ格。**`importance>=5` の行強調（`.feed-item[data-imp="5"]`）は稼働中**——`index.js`/`section.js`/`tag.js` が `data-imp` を出力し、見出しが 18→20px に上がる（色や帯は使わない）。由来: design-sprint 勝者案 B。 | `assets/styles.css`（§5/§6/§8/§9）, `templates/index.js`/`section.js`/`tag.js` |
| 版面マーク（`.plate`） | 写真を持たない記事（1014本中 **484本＝約48%**。出典側の事情で画像が取れない）のヒーロー枠に置く**組版の標**。従来この枠は空だった。3本の罫の**長さ・太さの組み合わせ**でセクションを表し（`asc`=情報・計算系／`peak`=観測系／`weight`=数量系／`desc`=記録系／`split`=表現系／`pair`=技術系）、変奏（標の全長 40/56/76px）は **slug の FNV-1a ハッシュ**で決まる。`Math.random()` は使わない——render に新しい非決定性を持ち込まないため（CLAUDE.md の不変条件）。同じ記事は何度ビルドしても同じ版面になる。**写真には擬態しない**（16:9 の箱を作らない）。既存の `.prose h2::before`（24×2px の短罫）と同じ語彙の拡張で、新しい装飾言語も新色相も持ち込まない。装飾なので `aria-hidden`（セクション名はメタ行が既に読み上げる）。 | `templates/cardbits.js: plate/hash32/PLATE_SYSTEM`, `assets/styles.css`（§13 PLATE） |
| レスポンシブ（min-width 加算） | ブレークポイントは**すべて `min-width`**で「小さい方が既定、広くなるほど足す」の一方向に統一する。`--gutter` は 18px（既定）→ 600px で 24 → 900px で 32。`site-footer__top` は 1列（既定）→ 600px で2列 → 900px で「ブランド全幅＋4等分」→ 1000px で `1.6fr + 4等分`。`secblock__grid` は 1列 → 680px で2列 → 1000px で3列。画像を持つグリッドトラックは `minmax(0, 1fr)`（素の `1fr` は溢れる）。*経緯*: 旧実装は `max-width: 640/600/420` 主体で、後から足したタブレット帯（680–1024px）と打ち消し合う構造だった。design-sprint REPORT が「マークアップ順依存で脆い」と指摘していた箇所を、C案の加算方式で置き換えた。 | `assets/styles.css`（§14 RESPONSIVE） |
| セクション表記 | 多色チップ（セクション別 hue）は**撤去**し、色を持たない中立のカテゴリ文字ラベル（`.cat` / 行リストの `feed-item__cat`）に統一。色信号の競合を避ける。 | `templates/cardbits.js: sectionChip`, `styles.css`（`.cat`） |
| 記事体験 | 読了時間（≈400字/分）、公開時刻、機能する共有ボタン（**X / LINE / はてブ / リンクコピー**、いずれも正式SVGアイコン）。共有URLは `siteUrl` 基準の絶対パス。**読了プログレスバー**（本文 `.prose` のあるページに自動表示）。 | `templates/article.js`, `assets/reveal.js` |
| 記事共有（progressive enhancement） | サーバーHTMLは X/LINE/はてブ/コピー の4ボタンを常時出力（JS無効でも動作）。`assets/share.js` が `navigator.share` 対応端末でだけルートに `has-web-share` を付与し、CSS が個別SNSを畳んで「**共有**（OS共有シート）＋**コピー**」の2点に切替（主にモバイル）。コピーは `navigator.clipboard`→失敗時 `execCommand` フォールバックで必ず成功表示。ホバーで各社ブランド色。 | `templates/article.js: shareButtons/SHARE_ICONS`, `assets/share.js`, `assets/styles.css`（`.share-btn` / `.has-web-share`） |
| ミニマル・演出 | 装飾演出（影・グレイン・発光・hover リフト＋画像ズーム・下線スライド・段階リビール）は**撤去**。動きは記事の読了プログレスバーのみ。対応ブラウザではページ遷移に控えめな View Transitions（`@view-transition`）。すべて `prefers-reduced-motion` で無効化。 | `assets/styles.css`, `assets/reveal.js` |
| 角丸スケール | 単一の `--radius`（8px）に統一（用途別の硬軟分けは廃止）。 | `assets/styles.css`（TOKENS節） |
| アクセシビリティ・人間工学 | 白基調で本文 `ink-0`／メタ `ink-2` とも WCAG AA 以上を確保。タップ領域はナビ各項目・共有ボタンとも **44×44px 以上**（共有ボタンは 38px で自ら定めた基準を割っていたのを是正）。**「本文へスキップ」**を `header()` の先頭に置き、全テンプレの `<main>` に `id="main" tabindex="-1"` を付ける（sticky ヘッダ＋ナビ10項目の後に毎回本文が来る構造で、従来キーボード／SR 利用者に迂回路が無かった）。**出現判定は `:focus`**——`:focus-visible` はブラウザのヒューリスティクス次第で発火せず「スキップリンクが出てこない」事故になる。装飾モーションを持たず、唯一の動き（読了バー）も `prefers-reduced-motion` で停止。 | `assets/styles.css`（`.skip-link` / `.sr-only` / `.share-btn`）, `templates/layout.js: header`, 全テンプレの `<main>` |
| ライト/ダーク | 既定はライト（白基調）。OS が dark のときのみ簡素なダークへフォールバック（トグルは廃止）。`<head>` のインラインJSが OS設定/localStorage から `data-theme` を paint 前に適用（フラッシュ防止）。 | `styles.css` の `[data-theme="dark"]`, `layout.js` |
| サイト内検索 | `search-index.json`（直近 `searchIndexMax`=600 件）をクライアントで部分一致検索（見出し/タグ/セクション/リード重み付け、キーボード操作対応）。古い記事は月別アーカイブから辿る。追加依存なし。入力は `role="combobox"` として宣言し、`aria-expanded` / `aria-activedescendant` / `aria-selected` を `search.js` が同期する（`role="listbox"` はあったが状態を一切通知していなかった）。 | `assets/search.js`, `render.js`, `searchIndexMax` |
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
- **認証切れの検知（最優先分岐）**: writer の出力を `data/_writer.log` に退避し `Failed to authenticate` を検査する。
  claude CLI は **401 でも exit 0 を返す**ため終了コードでは判定できない。検出したら**リトライせず即中止**し、
  `data/quality/incidents.jsonl` に `auth_failed` を1行記録、「ターミナルで claude を起動し /login」と
  **具体的な復旧手順を本文に書いた**通知を出す（新規ゼロ3回連続の汎用通知は抑制＝二重通知を避ける）。
  さらに **commit/push を丸ごとスキップ**する——記事は1本も増えていないので公開すべき変更が無く、
  ここで commit すると `incidents.jsonl` の1行だけを抱えたコミットが毎ラン積まれて Vercel が無意味に
  再デプロイされ、「自動ジョブのコミットは実質 `articles.json` の差分のみ」という配信モデルも崩れる。
  *背景*: 候補取得は writer 自身が担うため認証で即死すると候補0件になる。これを「新着なし」と取り違えて
  `rc=0` に上書きしていたため、**6ラン連続ゼロ・3日間を無言で見逃した**（2026-07-22〜25）。判定順が要。
- **公開前ゲート（push の直前ではなく、状態判定より前）**: 記事数の集計直後に `node src/check.js` を実行し、
  落ちたら `PUBLISH_BLOCKED=1` / `rc=1` を立てて **commit/push を中止**、失敗内容を本文に載せた通知を出し、
  `incidents.jsonl` に `publish_blocked` を1行記録する。実行するのは「認証切れでなく、ソースが dirty でなく、
  git に差分がある」回だけ（無関係な理由で赤くして警報を出さないため）。実測 1052 記事で約1.4秒。
  **判定順が要**——push 判定の直前に置くと `data/.status` と成功サマリが先に「正常・N件追加」を報告し終えており、
  ブロックしたのに正常と記録され Slack に矛盾する2通が飛ぶ。状態分岐にも `PUBLISH_BLOCKED` を最優先で入れ、
  STREAK を**進める**（`ADDED>0` でリセットすると公開が何日止まっても「3回連続ゼロ」の見張りが発火しない）。
  あわせて push 判定チェーンに `rc≠0` の分岐を入れる。
  *背景*: 2026-07-26、push 判定が git 差分しか見ておらず、`ingestDrafts` の失敗（`rc=1`）を検知して通知まで
  出しながら**描画できない `articles.json` を本番へ送り**、Vercel のデプロイが失敗してサイトが半日以上停止した（§11）。
  **復旧**: `node src/check.js` の指摘を直すか、その回を捨てるなら `git checkout -- data/articles.json`。
  放置するとローカルにだけ記事が溜まり公開は止まったままになる。
- **commit/push の前提条件**（2026-07-27 強化）:
  - **`main` にいることを確認する**。`git add`/`git commit` は checkout 中のブランチに効くので、
    作業ブランチのままだと記事はそこに積まれ、`git push origin main` は「変更なしの main」を送って
    **成功と報告する**（ログは `push 完了`、本番は無風という沈黙した公開失敗）。違えば中止＋通知。
  - **commit 対象は `data/` だけ**（`git add -- data`）。従来の `git add -A` は `vercel.json` /
    `.gitignore` / `.github/` / docs / `assets/` まで巻き込み、編集途中のまま 18:00 を迎えると
    本番のビルド設定が自動 push されうる（`SRC_DIRTY` ガードは `src templates scripts prompts package*.json` しか見ていない）。
    `data/` 以外の未コミット変更はログに出し、`assets/` に変更があるときだけ通知する
    （プレス画像を置いたまま放置すると `articles.json` が指す実体が push されず**本番で 404**）。
  - **ブロック時は退避ブランチへ push する**。公開前ゲートが赤の間、記事はワークツリーにしか無く
    GitHub にも git の object にも入っていない。しかも案内している `git checkout -- data/articles.json` は
    **それを破棄する**。`git stash create`（作業ツリーも stash スタックも動かさずコミットだけ作る）で
    `blocked/<日時>` を作って push しておけば、捨てる判断をしても後から取り戻せる。Vercel は `main` しか見ない。
- **ログのローテーション**: `data/scheduler.log` が 5MB を超えたら末尾 2MB を残して切り詰める。
  launchd が `StandardOutPath`/`StandardErrorPath` でこのファイルの **fd を掴んだまま**走るため、
  `mv` によるローテーションは使えない（launchd はリネーム後の inode に書き続け、`scheduler.log` は
  次回起動まで再生成されない）。`> "$LOG_FILE"` で**同一 inode を truncate** して書き戻す。
  実測 6KB/ラン・1日2回＝年5MB 程度なので、通常は何年も発火しない保険。
- **`git` のオブジェクト肥大**: 2.4MB の `articles.json` を1日2回コミットするため loose object が溜まる
  （実測 loose 55.6MiB / pack 5.4MiB。pack は 108 版を 5.4MB に収めており delta 圧縮がよく効く）。
  既定の `gc.auto=6700` は**オブジェクト数**で判定するため、「少数だが巨大」なこのワークロードでは
  約230日発火しない。リポジトリに `gc.auto=250` を設定して自動 gc が定期的に効くようにしている
  （`gc.autoDetach` は既定のまま＝自動ジョブの commit をブロックしない）。
- **ロックの同一性は PID ＋ プロセス開始時刻**（2026-07-27 修正）。従来は `kill -0` の生存確認が
  年齢判定より先に return していたため、**macOS が PID を再利用すると永久にスキップし続けた**。
  しかも `acquire_lock || exit 0` は `.status` も通知も STREAK も残さず沈黙するので、
  見え方は 2026-07-22〜25 の3日間停止と区別が付かない。
  - 保持者が**死んでいれば年齢を待たず即再取得**（死んだプロセスは書込み中ではない。3600秒待つと
    Ctrl-C の残骸だけで最大1サイクル＝12時間・記事2回分が飛ぶ）。
  - **生存していても `LOCK_MAX_AGE` 超過はハングとみなして奪う**。
  - **保持者不明（`info` 未書き込み＝`mkdir` 直後の可能性）は奪わない**——作りかけを奪うと二重実行になる。
    年齢は `info` が読めないときディレクトリの mtime から取る。
  - スキップした回は `.status` に残し、連続2回で通知（`data/.lockskip` で数える）。
- **状態ファイル `data/.status`**（git 管理外）: 最終実行時刻・状態・詳細・連続ゼロ回数を毎ラン上書きする。
  通知バナー（`osascript`）は集中モード等で抑制されうるため、**消えない形でも残す**のが目的。
- **Slack 通知**（`src/notifySlack.js`・`SLACK_WEBHOOK_URL` があるときだけ）: 異常時は `notify()` から、
  正常時は実行サマリ（記事数の変化・候補/下書き件数・修正リトライの件数）をランの最後に送る。
  *背景*: 通知が macOS のバナーだけだったため、**認証切れの通知が4回出ていたのに気づけず3日間停止**した
  （2026-07-22〜25）。バナーは数秒で消え集中モードでも抑制される。「見に行けば分かる」ではなく
  **「向こうから届く」経路**を1本持つ。未設定・ネットワーク断・不正 URL のいずれでも**日次は止めない**
  （通知は常に exit 0）。Webhook URL は秘密情報なので `.env` にのみ置く（`npm run check` の鍵混入検査の対象）。
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
npm run check                # 公開前ゲート（レンダー完走＋スキーマ/slug・link一意＋タグ→パス配線＋鍵混入。警告として ledger 網羅・品質・鮮度。自動ジョブも push 前に実行・§8）
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

- **タグ名は writer が自由に書く文字列で、そのままファイルパスにできない**（2026-07-26 の障害）。
  タグ `AR/VR` の書き出し先が `dist/tags/AR/VR.html` と解釈され、存在しないディレクトリへの書き込みとなって
  render 全体が ENOENT で停止。Vercel も `buildCommand: npm run build` で同じ経路を走るためデプロイが失敗し、
  サイトは前回成功版のまま半日以上停止した。事故が本番へ届いた原因は3段階ある:
  ①`ingestDrafts` が **保存 → レンダー** の順で、レンダーが落ちても `articles.json` は保存済みだった、
  ②`auto-generate.sh` の push 判定が git 差分しか見ておらず、`rc≠0` を検知・通知しながら push した、
  ③Vercel が同じ `renderSite` を走らせるため同じ場所で落ちた。
  対策は4層: **レンダーしてから保存**（`ingestDrafts.js` / `applyImageReview.js`。「保存済み ＝ 描画できる」を
  構造的な不変条件にする）→ **`tagSlug()` で変換を一点集約**（§7.5）→ **取り込み時に正規化**（`normalizeSectionTags`）
  → **push 前に `check` を通す**（§8）。
  検知は `npm run check` の `checkTagPathWiring()` が担う——**実データによる検査では配線の外れを捕まえられない**
  （取り込み時の正規化により実データの全タグは `tagSlug` の不動点で、変換を外しても出力が変わらない）ため、
  危険文字を含む合成タグを実際に描画して4つの適用箇所を突き合わせる。
- **取り込みの記録が飛んでも、記事は正常に見える**（2026-07-26 の副次被害）。上のタグ障害で `renderSite` が
  落ちたとき、`ingestDrafts` の評価記録ブロックごと実行されず、公開された21本が `evaluations.jsonl` に
  1行も残らなかった。記事そのものは読めるので**指摘されるまで誰も気づけなかった**。
  評価の記録は「評価機構の故障で公開を止めない」ため try/catch で握る設計であり、これは維持する。
  代わりに **`npm run check` の `checkLedgerCoverage()` が直近 `ledger.coverageWindow` 件の記録漏れを警告する**（非ブロック）。
  握って黙るのではなく、握った上で**後から気づける**ようにするのが要点。
  なお現在は「レンダーしてから保存」により、レンダー失敗時はそもそも記事が保存されないため
  「公開済みなのに未記録」という乖離は構造的に起きない（残るのは記録処理自体の失敗と異常終了の窓）。
  さらに 2026-07-27 に次の3点を足した:
  - **try/catch は1記事ごと**（`ingestDrafts.js`）。ループ全体を包んでいたため、i 番目の失敗で
    **i 以降すべての評価・rescue 記録・`writeRunSummary` までまとめて失われていた**。
    1本の失敗は1本に閉じ込め、ラン集計は独立した try/catch にする。
  - **judge 出力を捨てない**。`scores` / `overall` / `critique` / `suggestions` / `sourceFetched` は
    `_review.json` にしか無く、`evaluations.jsonl` へ書けなかった時点で削除すると**復元不能**になる
    （客観指標は `articles.json` から再計算できるが、judge の判定は再現できない）。
    記録に失敗した回は `data/quality/_review-failed-<UTC>.json` へ **rename** する。
    退避先が `data/quality/` なのは、そこが **git 追跡対象＝バックアップされる唯一の置き場**だから。
    **その場に残さない**のが要点——`_review.json` のまま置くと、次の手動 ingest がそれを
    「今回の judge 判定」として読み、古い veto が新しい下書きを落としうる。
  - **`incidents.jsonl` に `ledger_write_failed`** を残し、`npm run check` は退避ファイルの存在を
    警告する（replay して消す運用）。公開は止めない。
- **本文MarkdownのXSS無害化（多層防御）**: 本文は外部ソース由来の素材から生成されるため、`src/markdown.js` の
  `mdToHtml()` は marked レンダラで**生HTMLトークンをテキスト化**し、リンク/画像の `href`/`src` を**プロトコル許可リスト**
  （`http(s)`／`mailto`／相対／アンカーのみ）で検証する。`javascript:`・`data:`・`vbscript:` 等は `#` に無害化。
  無人＋push=即本番のため、ソース由来のインジェクションや writer 変更1回での公開事故を防ぐ。退行は `npm run check` の
  `checkSanitizer()`（既知の悪性入力を通して無害化を確認・オフライン・hard-fail）が検知する。
- **claude CLI 認証が切れると定期ジョブは記事を書けない**（トークンは有限寿命なので再発する）。検知は三重にした:
  ①ジョブが認証エラーを検出して復旧手順つきで通知＋`incidents.jsonl` に記録（§8）、②`data/.status` に消えない形で残す、
  ③`npm run check` が最終記事から `config.freshness.staleDays` 日超で**更新停滞を警告**する（非ブロック）。
  復旧はターミナルで `claude auth login`（または `claude` を起動して `/login`）。OAuth 再認証は対話が必要で
  ヘッドレスジョブからは不可。
  **診断に `claude auth status` を使ってはいけない**——失効中でも `loggedIn: true` を返す（保存された資格情報の
  「存在」を見ているだけで有効性を検証しない）。実際に生きているかは最小の呼び出しで確かめる:
  `claude -p "OK とだけ答えてください" --model claude-haiku-4-5-20251001 --strict-mcp-config`。
  失効していれば `Failed to authenticate. API Error: 401` が返る（2026-07-25 の復旧時、`auth status` の
  `loggedIn: true` で一度誤診しかけた）。
- **出典の約3割は自動取得できない**（2026-07-25 実測 292/993本）。Guardian(77)・Verge(59)・BBC(37) は bot 拒否、
  openai.com(58)・CNBC(46) は 403、Variety(15) は TollBit の課金ゲートで**ブラウザでも読めない**。
  **ただし openai.com だけは例外**——robots.txt の実測で `User-agent: * / Allow: /` であり、**拒否の意思表示が無い**
  （403 は WAF の誤検知）。他の5社は Claude 系エージェントを名指しで拒否している。この違いは決定的なので、
  `summaryFetch.domains` は **robots.txt が明示的に許可したドメインだけ**を対象にする（§7）。
  拒否しているドメインは障害ではなく**「AI に読ませたくない」という意思表示**であり、**UA 偽装での回避は取らない**
  （このサイト自身が `robots.txt` を出す側でもある）。業界標準は ①ライセンス契約 ②RSS の範囲に留める
  ③一次情報を厚くする、の3つで、本サイトの「アグリゲーター型短評」は元々②に一致する。
  対処は §5「出典が読めないときの手順」「複数出典の明示」。
  *背景*: judge はこの3割で出典照合ができず、writer も読めない出典から550〜750字を書いていた。
  veto 理由の21%が「出典にない事実の創作」だったのはこれが一因。
- **記事間の取り違え（下書き混線）が創作の主因のひとつ**。writer が1セッションで最大25本を書くため、
  **同じ回の別記事の固有名詞が混入する**事故が繰り返し起きている（veto から7件確認）。実例: 「Etched が
  50億ドル評価」の記事に、同じ回に書いた EquiLibre の創業者・所在地・従業員数が丸ごと入っていた／
  Anthropic の記事に OpenAI の製品名が入っていた。**出典の可読性とは無関係**で、似た分野の記事が並んだ回ほど
  起きやすい。対策は writer の自己批評（§3.5）での1件ずつの突き合わせと、**全下書きを一度に見ている
  judge による横断チェック**（judge はこれができる唯一の層）。
- **veto だけを見ると品質を誤読する（検査バイアス）**。出典を読めなかった記事は誤りがあっても検出されず、
  veto にも上がらない。つまり「取得できないドメインは veto が少ない＝品質が良い」ように見えるが、
  実際は**検査していないだけ**。これを測るため judge は `sourceFetched`（その `link` を実際に読めたか）を
  **pass・veto の両方**に記録し、`evaluations.jsonl` / `vetoes.jsonl` の双方へ転記する（§12.4）。
  「取得不能 → 品質が低い」が成り立つかは、このデータが貯まるまで判断できない。
- **二重掲載は類似度だけでは捕まらない**。`link` 重複排除は同一URLしか見ず、日本語の文字 bigram による
  話題類似度は**表記揺れに弱い**。同じ Starship 試験飛行を「スペックス Starship第13次…」と
  「SpaceX Starship第13次…」で書いた2本の Jaccard は **0.278** で、警告閾値 0.6 にも届かなかった
  （誤表記が重複検出そのものを無力化した）。一方**見出し＋リードの英数字トークン（固有名詞・型番・序数）の
  包含率は 0.83** と明確に出る。よって取り込みブロックは包含率を主、Jaccard を従にしている
  （`evaluate.js: featureTokens / maxFeatureContainment`）。導入時の全数照合で既存に19件の
  二重掲載が見つかり、13本を整理した（一次情報の出典を残す）。
- 記事の正本は `data/articles.json`。HTML はそこからの派生（いつでも `npm run build` で `dist/` に再生成可能）。
- **`loadArticles()` は破損時に throw する（握りつぶさない）**: ファイル不在は正常な初回として `[]` を返すが、
  読込/JSON parse 失敗は `throw`。これが `[]` を返すと load→save 経路（`ingestDrafts`／`set-press-image`／
  `migrate-sections`／`backfill-images`）が**既存記事を空配列で全上書き**してしまうため。破損時は `npm run check` が
  赤、`build`（Vercel）は fail-loud（空サイト公開を防ぐ）になる。`auto-generate.sh` の `count_articles()` は
  `require()` 直読みで破損時 -1 を返し健全性監視が通知する（整合）。
- **容量とスケールの見通し**（2026-07-27 実測）。1,076記事・30.4本/日 → 1年後およそ12,000記事。
  - **最初に効く上限は Vercel ではなく `sitemap.xml` の 50,000 URL**（sitemaps.org の仕様）。
    現在 2,830 URL＝記事1本あたり 2.7 URL なので、到達はおよそ18,600記事（2028年ごろ）。
    `npm run check` が `config.sitemapWarnUrls`（40,000）で警告する。対処は sitemap index への分割。
    ※ Vercel の「100MB」は **CLI アップロード**の制限でビルド出力には適用されない。
    出力ファイル数も公式に上限は無い（10万件規模でビルドが長くなる、という案内があるだけ）。
    `dist/` が 43MB・2,828ファイル → 1年後およそ490MB・3万ファイルになるが、これ自体は制約にならない。
  - **ファイル数を牽引しているのは記事ではなくタグ**。`dist/tags` 1,756ファイル vs `dist/articles` 1,076ファイル。
    ユニークタグは1,757個（1記事あたり4.5個・**新規タグが1記事あたり1.67個ずつ増える**）で、
    大半が1記事しか持たない。減らすなら「N記事未満のタグはページを作らない」閾値が最も効く
    （薄いページの量産は SEO 上も不利）。
  - **render は線形ではない**。`relatedFor`（`render.js`）が記事ごとに全プールを走査する **O(N²)**。
    実測 0.76→0.94ms/件（250→1,052件）の上昇がその項で、12,000記事では線形外挿の11秒ではなく
    **35〜40秒**が見込み。Vercel のビルド上限（45分）には遠いが、「ほぼ線形」と誤解しないこと。
    改善するならタグの転置索引（`render.js` が既に作っている `tagMap`）で候補を絞る。
  - `config.retentionTop`（トップ）と `searchIndexMax`（検索索引）は**読者向けの負荷しか制限しない**。
    ファイル数・`dist/` 容量・`articles.json` サイズ・`.git` の肥大は一切制限しない。
- **`articles.json` の書き込みは原子的＋楽観的並行制御（CAS）**（2026-07-27 追加）。
  `articles.json` を「全体読み → 手元で変更 → 全体書き」する経路は7本あり（`ingestDrafts` /
  `applyImageReview` / `recheckImageBrands` / `recheckImageRelevance` / `backfill-images` /
  `migrateSections` / `set-press-image`）、自動ジョブ（6:00/18:00）と手動コマンドが重なると
  後から保存した側が相手の変更を丸ごと消す（**ロストアップデート**。2026-07-27 に再現確認）。
  - **原子的書き込み**（`src/atomicWrite.js`）: 同一ディレクトリに `<file>.<pid>.tmp` を書いて `rename`。
    素の `writeFile` は `O_TRUNC` なので**正常時でも書き込み中はファイルが不正**で、
    `count_articles()` や `npm run check` が中途半端な JSON を読める。rename ならこれが消える。
    一時ファイル名に PID を入れるのは、固定名だと並行時に「壊れた JSON」ではなく
    「片方の世界」が静かに確定してしまうため。`data/*.tmp` は **.gitignore 必須**——
    残骸が `git add -A` で本番へ push され、以後 git status が常に汚れる。
  - **CAS**（`src/store.js`）: `loadArticles` が読んだ内容の sha1 を保持し、`saveArticles` は
    書く直前に再読込・再ハッシュして不一致なら**書かずに throw**。`{ force: true }` で明示的に飛ばせる
    （復旧作業用）。ファイル不在で読んだ場合は「不在のまま」を条件にする（空配列での全上書きを CAS 経由で再発させない）。
  - **ロックを配らない理由**: 排他ロックは取り残すと**公開が止まる**。しかも `process.on('exit')` は
    SIGINT/SIGTERM で発火しないため、手動コマンドの Ctrl-C という最も起きやすい中断を拾えない。
    可逆で可視な障害（ロストアップデートは git 履歴から復元でき差分にも出る）を、不可逆で不可視な
    障害に変換してしまう。CAS は衝突時に「書かずに中止」＝損失もデッドロックも起こさず、
    7本すべてが通る1関数で済み、将来の書き手も自動的に守られる。
    自動ジョブ同士の排他（`data/.harness.lock`）は従来どおり有効。
  - **限界（正直に）**: 完全な排他ではない。read→hash→rename の数ミリ秒は残る。
    load→save の間（API 呼び出しを挟むと数分）に比べて桁違いに小さい、というだけ。
  - ledger の切り詰め（`appendBounded`）も同じ `atomicWrite` を通す。ledger は**git 追跡対象**なので、
    中途半端な truncate が commit・push されると壊れた行が本番リポジトリに残り、
    読み手は壊れた行を skip する作りなので静かに件数が減って気づけない。
    素の `appendFile` は `O_APPEND` の単一 write なので安全（**read-modify-write に変えないこと**）。
- **コード改善はブランチで**: 自動ジョブの `git push origin main` は `main` 上の未 push コミットも一緒に送るため、
  WIP を `main` に直コミットすると次の自動実行で本番へ出る。改善・機能追加は作業ブランチで行い、検証後に `main` へマージする（[CLAUDE.md](CLAUDE.md) §2）。
- `makeSlug` は「同日最大連番+1」方式（削除で欠番が出ても衝突しない）。
- zsh の `$status` は読取専用のため、シェルスクリプトでは別名（`rc`）を使う。
- **再描画は非決定的**: `feed.xml` の `lastBuildDate` と `sitemap.xml` の `lastmod` が毎回更新されるが、
  出力先は gitignore の `dist/` なので**git 差分には出ない**（§13）。`npm run check` は
  この性質を踏まえ「2回描画して diff 空」方式は採らず、一時dirへの描画完走で健全性を判定する。
- **左端整列（ガター不変条件）**: ロゴ／ナビ／リード／最新リスト／フッターは `.container`（`--gutter`：18px → 600px で 24px → 900px で 32px の min-width 加算、`--site-max` 760px）で左端を揃える。`.container` を入れ子で**二重に付けない**（ナビ行・ヘッダーバーはそれぞれ `.container` を1つだけ持つ）。
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
   下書きを書いたら writer 自身が **`node src/lintDrafts.js`（決定論の検算器）を実行**し、出典を読まずに分かる矛盾を潰してから終了する（§12.7）。
2. **judge（別モデル `config.judgeModel`＝既定 Sonnet）** `prompts/review-drafts.md` … 出典照合で faithfulness を採点し、`data/_review.json` に
   各下書きの `verdict: pass|veto`＋スコアを出力。judge も writer 同様に `--tools`（`Bash Read Write WebFetch WebSearch`）＋ `--strict-mcp-config` で起動する（迷走防止）。**veto は「明確な事実誤り」で行う**（出典矛盾・数値/単位の改変・更新済み数値の旧値記載・趣旨の取り違え＝過小/過大表現・出典死活・constitution 違反）。事実誤りは `suggestions` で流さず veto し、**迷う事実誤りは veto 寄り**に倒す。一方、体裁・文体・構成の好みでは落とさない（事実が出典と一致していれば pass＋suggestions、迷ったら pass）。
3. **修正リトライ（任意・`config.fixRound.enabled`）** … judge が `fixable:true` と判定した veto を writer に差し戻し、
   訂正後に**初回と同一の基準**で再査読する。詳細は §12.6。ingest が `_drafts.json`/`_review.json` を消すため**必ず ingest の前**に置く。
4. **ingest** `src/ingestDrafts.js` … veto を尊重して破棄、画像付与・再生成、評価を **ledger** に追記。
   破棄した下書きは `vetoes.jsonl` に1行残す（失敗の記憶。§12.6）。記録の失敗で公開は止めない。
- **トークン削減の triage**: judge 呼び出しの前に `node src/evaluate.js --triage` を実行。下書きが**すべて `tier:'primary'` かつ客観フラグ無し
  かつリント指摘無し**の低リスク回は judge を**丸ごとスキップ**（客観ゲート＋writer 自己批評のみで公開）。`media` 混在 or 客観フラグ有り＝独立検証が最も要る回だけ judge を走らせる。
  `tier` が `primary` と明示されない下書きは risky 扱い（フェイルセーフ）。writer=Haiku のため judge は一段上の **Sonnet** を既定にしている（writer≠judge を保ち、安いHaikuの量産を賢いSonnetが独立検証する分業）。
- **失敗時最優先＝日次を止めない**: judge がエラー/タイムアウト/スキップでも**ブロックせず**客観ゲートのみで通常公開し（失敗時は通知＋`data/quality/incidents.jsonl` に `judge_absent` を1行記録して後追い分析できるようにする）。

### 12.4 記憶（ledger）
`data/quality/`（**data 配下＝dirty ガードに触れず auto コミットに乗る**）:
- `evaluations.jsonl` … 1記事1評価（客観指標＋judge 結果を合流）。
- `runs.jsonl` … 実行ごとのサイト集計（セクション/importance 分布・画像ヒット率・平均フラグ・
  `pressAllowlistMiss`＝その回に評価した記事のうち「公式出典(allowlist)なのに press 画像が
  付かず stock に落ちた」件数。累積ではなく**その回の評価分に限定**することで、既存の
  対応見送り分に埋もれず、§6.2 の自動採用が再び silent に失敗し始めた回帰を検知できる）。
- `calibration.jsonl` … 人間評価。
- `incidents.jsonl` … 運用イベント（judge 不在 `judge_absent`／画像査読不在 `image_review_absent`／認証切れ `auth_failed`／
  公開前ゲート赤 `publish_blocked`／ledger 書き込み失敗 `ledger_write_failed`／候補選別の内訳 `candidates`）。日次を止めずに観測性だけ残す。`candidates` を足したのは、`fetchNews` の除外ログが
  writer の CLI セッション内で消えて**どのログにも残らない**ことを実測で確認したため（除外が効きすぎ/効かなさすぎを
  検知できない状態だった）。
- **`sourceFetched`**（`evaluations.jsonl` と `vetoes.jsonl` の両方）… judge がその出典を実際に読めたか。
  **pass 側にも記録するのが要点**——veto だけでは検査バイアスで品質を誤読する（§11）。
- `vetoes.jsonl` … **不採用にした下書き**（1件1行。`critique` 原文・`categories`・`fixable`・`stage`・`outcome`）。
  `evaluations.jsonl` と分ける理由: veto 記事は slug 未採番で「1公開記事1行・slug がキー」という契約を壊すうえ、
  veto のバーストが公開記事の retention を押し出すため。`categories` は `critique` から再計算できる派生ビューに
  留め（原文を必ず保存する）、分類器を直せば後から再分類できるようにする＝分類の誤りを不可逆にしない。

**有界化（無制限追記の抑制）**: `evaluations.jsonl`／`runs.jsonl` は append-only で毎ラン auto コミットに載るため、
`config.ledger`（`evalMaxLines`/`runsMaxLines`/`margin`）で**アクティブファイルを直近 N 行に有界化**する。上限＋margin を
超えた回だけ切り詰め、溢れた古い行は `<file>.archive.jsonl`（**gitignore 済み＝git を肥大させない**・履歴はローカル保持）へ退避する
（`src/evaluate.js` の `appendBounded`）。間は純追記なので git 差分は末尾1行のみ。`qualityDigest` 等は直近行しか使わないため機能は不変。

### 12.5 将来フェーズ（未実装・検証ゲートの先）
MVP を数日〜2週間運用し「評価信号が役立つ」と確認できたら着手する:
- **外ループ（週次・別ブランチ・人間承認 PR）**: ledger＋calibration を分析し、`prompts`/`config`（可変パラメータ）/`templates`/CSS への
  改善差分を作る。**constitution は不可・design はテキスト提案のみ**（headless はピクセルを見ないため）。
- **対話ハーネス**: subagents（news-judge / site-auditor）と slash commands（`/evaluate`・`/self-improve`）。
  `/self-improve` は preview スクショ＋デザインスキルで**視覚監査込み**の改善を人と回す。

### 12.6 veto の還流と修正リトライ（学習ループ）
**背景**: veto された下書きは従来その場で破棄され、理由は `scheduler.log` にしか残らなかった。累計169件を
分類したところ **数値・桁・単位の誤変換が約6割**（例「$1.5B と $15B で10倍」「£3 billion を3000億ポンドと100倍」）、
次いで固有名詞の取り違え・出典にない創作。writer はこの指摘を**一度も見ていなかった**ため同じ型の誤りを繰り返していた。

**(A) 記録** — `src/vetoLedger.js`。`classifyCritique()` が critique を6カテゴリ（numeric / entity / contradiction /
fabrication / date / unreachable）に分類する。`contradiction` は**下書き内部の不整合に限定**し、出典との不一致は
numeric/entity 側に寄せる（writer への指示が「書いた後に突き合わせろ」と「出典を取り直せ」で根本的に違うため）。
過去分は `npm run seed-veto-ledger`（既定 dry-run・`--apply`・二重投入を拒む冪等ガードつき）でログから遡及投入する。

**(B) 還流（予防）** — `src/vetoDigest.js` が傾向を writer プロンプトへ注入する（`qualityDigest.js` の CLI で連結。
注入点 `auto-generate.sh` の `$DIGEST` は不変）。
**母集団は「初回査読で veto された下書き」全部**（救済されたものを含む）。ledger の行はすべて初回 veto であり、
救済の有無は結果であって、writer が誤りを犯した事実は変わらない。一時期ここで `outcome:'rescued'` を除いており、
修正リトライを有効化した途端に writer が見られる失敗が 15件中4件（27%）まで痩せた（2026-07-25 実測）。
**安全網が働くほど writer が学べなくなる**逆説で、「writer が自分の失敗を見られない構造に戻さない」に反する。
ただし**救済されたかどうかは writer に見せない**（「直してもらえる」と学ぶと初回精度を上げる動機が消える）。
救済率は §12.6(C) のとおり stderr にだけ出す。**体裁 digest とは必ず別セクション**にする（母集団も、測るものも、
是正の性質も違う。混ぜると事実誤りの優先度が下がる）。順序は veto→体裁＝賭け金の大きい順。
**禁止**: 「veto を N 件未満にせよ」等の目標値を注入しない — 数値を省略してぼかす最悪の最適化を誘発する。是正は必ず手続きで書く。

**(C) 救済** — `config.fixRound.enabled`（既定 false）。fixable な veto を writer に差し戻して訂正させ、再査読する。
- **判定基準は `prompts/_veto-criteria.md` に切り出し**、初回・再査読の両方へシェルが `cat` で合成する。
  バイト単位で同一の基準文が入るため「再査読だけ緩む」ドリフトが構造的に起きない。再査読には初回 critique を**渡さない**
  （「指摘が直ったか」ではなく「出典と一致するか」を独立に判定させる）。
- **`fixHint` は事実指摘のみ**。judge に修正文を書かせない — 次ラウンドで judge が自作を査読することになり
  `writer≠judge` が実質崩壊するため。`fixable:true` は判定を緩めない（依然 veto。再査読を通らない限り公開されない）。
- **訂正の根拠は「読者が辿れる形」で示せるものに限る**（2026-07-25 の事故を受けて強化）。`fixable:true` にしてよいのは
  ①`link` を取得できた ②候補の `summary` で確認できた ③`trustedSecondary` の媒体で確認できた（**媒体名と URL を
  `fixHint` に添え、writer が `sources[]` に記録する**）のいずれか。どれでも確定できなければ `fixable:false`。
  **他媒体の使用は禁じない。出所を隠すことだけを禁じる。**
  *背景*: 初回の実運用で、BBC（bot 拒否）を出典とする記事に対し judge が WebSearch で得た別ソースの数値を
  `fixHint` に書き、writer がそれで本文を書き換えた。記事は「BBC を出典に掲げながら BBC と異なる避難者数を
  載せる」状態になり、読者が検証できなくなった。さらに writer は本文の内訳に合わせて**リードの合計値を
  下げて**おり、これは訂正ではなく改変にあたる。よって「全体値を内訳に合わせて動かすこと」「合計を自分で
  足し算して作ること」も明示的に禁止した（`fix-drafts.md` / `review-fixed.md`）。
- 修正ラウンドで変更してよいのは `headline`/`lead`/`body_markdown`/`tags`/`sources` の5つのみ。
  `sources` が可変なのは他媒体で裏取りしたときに出所を追記させるため（信頼リスト外は `normalizeSources` が落とす）。
- **安全装置 `src/mergeFixReview.js`（決定論・LLM 不使用）**: `ingestDrafts.js` は `_drafts.json` の parse 失敗で
  `process.exit(1)` するため、fix-writer が JSON を壊す/記事を落とすと **pass 記事まで巻き添えで全滅**する
  （しかも writer プロンプトには「直しきれない記事は外す」という既存の指示があり癖が転移しうる）。そこで
  ①パース ②link 多重集合の一致 ③対象外要素の完全一致 ④可変フィールドは `headline`/`lead`/`body_markdown`/`tags` のみ
  ⑤必須フィールド非空、を検証し違反は**バックアップから復元**する。最悪ケースが「fix 実行前とバイト単位で同一」に落ちる。
  処理順は**①ドラフト復元 → ②`_review.json` 書き込み**に固定（①の後で落ちてもドラフトと判定の整合が保たれる）。
  再査読が pass 記事の判定をひっくり返すのも、プロンプトではなく**コードで**排除する。
- **ゲーム化の防止**: 修正は1回限り（N=1 では登れる勾配が無い）／fix-writer に `scores` を渡さない／削除による
  辻褄合わせを禁止（ただし創作記述の削除は正しい訂正）／出典の再取得を必須化。
  **救済率は監視する** — `outcome:'rescued'` の割合を `qualityDigest` が **stderr にだけ**出す（writer に見せると
  「通ればよい」という目標値として作用する）。**100%に張り付くのは執筆改善ではなく再査読のゲーム化のシグナル**で、
  持続的に80%超なら手動監査のうえ `enabled:false` で即停止する。

### 12.7 下書きの決定論リント（writer の検算器）

**背景**: veto の最多カテゴリ（numeric＝約6割）への対策は、これまで**プロンプトの文言だけ**だった。文言は
「読んだつもり」で素通りできるが、実行される検査は素通りできない。2026-07-25 に差し戻された4件を調べると、
うち3件は**出典を読まなくても機械的に疑える形**をしていた（リードだけが主張する数値／同一記事内の比率の
食い違い／別記事の固有名詞の混入）。そこで writer 自身が実行する検算器 `src/lintDrafts.js` を置く。

- **検査（すべて出典不要・決定論・オフライン）**:
  | code | 何を見るか | 由来した事故 |
  |---|---|---|
  | `summary-only-number` | 見出し・リードの数量が本文に無い | 見出し「20万人超が避難」が本文の内訳と繋がらない／別記事の「Brent原油100ドル」がリードに混入 |
  | `ratio-conflict` | 同一記事内で比率表現が食い違う（要約層が比率を主張しているときだけ） | リード「Fable 5の半値」× 本文「およそ3分の1」 |
  | `currency-conversion` | 出典が日本語圏でないのに円建ての数値がある | 為替レートは出典に無い＝自分で換算すれば出典外の数値になる |
  | `composite-char` | 全角合成文字（㌦㌫㌧ 等） | 表記ルールの機械化 |
  | `crosstalk` | **同じ回の別記事にしか出ない稀語**が、この記事には1回だけ出る | Trump 関税記事に別記事の「Brent」が入った／Etched の記事に EquiLibre の創業者・所在地 |
- **混入検出のノイズ抑制**: 直近 `config.draftLint.corpusRecent` 本の公開記事から**文書頻度**を作り、
  `corpusDfMax` 本以上に出る語（「データセンター」「Nvidia」等のサイト常出語）は判定から外す。
  実測（2026-07-26・公開済み200本）: 除外なしだと指摘81件／除外ありで15件。実際の混入語は df=0 なので残る。
- **位置づけ（重要）**: これは **judge の出典照合を代替しない**。前段で「出典を読まずに分かる矛盾」を落とし、
  judge を本質的な照合へ集中させるためのもの。すべて**警告**で公開はブロックしない（CLI は常に exit 0）。
- **二重化**: writer がプロンプトの手順（§3.6）を飛ばしても検査が消えないよう、`auto-generate.sh` も ingest 前に
  同じ検査を実行する。指摘があれば ①ログと Slack サマリに件数 ②`incidents.jsonl` に `draft_lint`
  ③judge プロンプトへ「**確認の起点**（判定の根拠にしない・偽陽性を含む・ここに無いから正しいわけでもない）」として添付。
  さらに `evaluate.js --triage` は**リント指摘があれば必ず judge を走らせる**（安く疑えたものを独立検証に回す）。
- **誤った直し方の封じ込め**: 指摘の解消を「数値・固有名詞を削る」で行わせない。CLI の出力・両プロンプトに
  「削除・曖昧化での辻褄合わせは訂正ではなく回避（再査読で veto）」「出典に無い記述のときだけ削除が正しい訂正」を明記する。
- **退行検査**: `npm run check` の `checkDraftLint()` が、上表の事故形を再現した合成下書きを通し、
  4つの code が今も検出されることを hard-fail で確認する（サニタイザ検査と同じ方式）。
  安全弁 `config.draftLint.enabled=false` の間は警告に落とす（安全弁を引いたら check が赤になる逆転を避けるため）。

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
