# 設計案: 記事アーカイブ分離（S-1・ビルド線形肥大の根治）

> ステータス: **設計のみ（未実装）**。着手判断・パラメータは要相談。
> 背景の指摘元: 長期運用監査 S-1。

## 1. 問題

- `src/render.js:220-222` は **全記事（`byRecency` 全件）に個別 HTML ページを生成**する。`sitemap.xml`（`render.js:241`）も全件を列挙。
- `src/store.js` の `saveArticles` は毎回 `articles.json` を**全書き換え**、`ingestDrafts` は毎回全件をパース。
- 記事は約 **24本/日**増える。試算: 1年で約8,900記事・`articles.json` ≈21MB、3年で約27,000記事・≈63MB。
- 結果、**Vercel のデプロイビルド（`npm run build`）が記事数に線形**でスケール（生成ページ数・出力ファイル数・パース時間）。1日2回の再デプロイで、数年後に Vercel のビルド時間/出力上限へ接近しうる。

### 既に効いている緩和（＝壊さない前提）
- トップは `retentionTop`(40) 母集団（`render.js:132`）、`search-index.json` は `searchIndexMax`(600) で上限化済み（`render.js:201-213`）。
- 取り込みは新記事を配列**先頭に prepend**（`ingestDrafts.js`）＝git 差分は先頭局所・デルタ小。**git 履歴肥大は軽微**（問題は build/parse 側）。
- `dist/` は gitignore・デプロイ時生成。

### 制約（設計が守るべき不変条件）
- **パーマリンク安定**: `/articles/<slug>.html` を 404 にしない（既に `sitemap` 経由で外部/検索エンジンにインデックスされている）。SEO・外部リンクのため**古い記事のURLを消せない**。
- **配信モデル**: 生成物は原則コミットしない（コミットは実質 `articles.json` 差分のみ）。凍結アーカイブ層を作る場合のみ、限定的な例外の是非を判断する。
- **後方互換**: `slug`/`link` 一意、スキーマ、`npm run build` 全完走。

## 2. 方針の選択肢

| 案 | 内容 | ビルド線形を断つか | 複雑度 | パーマリンク | 生成物コミット |
|---|---|---|---|---|---|
| **A データのみ分割** | `articles.json`=ホット（最新H件）＋`data/archive/articles-YYYY-MM.json`=コールド。build は両方読んで従来どおり全ページ生成 | ❌（parse/ingest は軽くなるがページ生成数は不変） | 低 | ✅ | 不要 |
| **B 凍結アーカイブHTML層（推奨）** | コールド記事の HTML を**ロール時に一度だけ生成して追跡ディレクトリへ凍結**。build はホットを毎回生成＋凍結分をコピー | ✅（build はホット集合＋コピーに有界化） | 中 | ✅ | 凍結分のみ（変化稀） |
| C 完全プルーニング | 古い記事をサイトから削除 | ✅ | 低 | ❌（404・SEO毀損） | 不要 |

- **A** は parse/メモリ/git デルタは改善するが、**ビルドのページ生成数（＝Vercel 逼迫の主因）を減らさない**ため根治にならない。
- **C** はパーマリンクを壊すため却下。
- **B** が「ビルドをホット集合に有界化しつつ全記事を生かす」唯一の案。

## 3. 推奨設計（B: 凍結アーカイブHTML層）

### データ構造
- ホット: `data/articles.json` … 最新 `hotWindow` 件（例: 直近6ヶ月 or 最新1,500件）。ingest は従来どおりここへ prepend。
- コールド: `data/archive/articles-YYYY-MM.json` … 月別シャード（不変・追記のみ）。
- 凍結HTML: `archive-pages/articles/<slug>.html` … **追跡ディレクトリ**（gitignore しない）。コールド記事の生成済みページ。

### 新スクリプト `npm run roll-archive`（月次 or 件数閾値で実行）
1. `articles.json` から `hotWindow` を超える古い記事を、月別シャードへ移動。
2. 移動対象の記事ページ HTML を**この時だけ**生成し `archive-pages/articles/` へ書き出し（凍結）。
3. `articles.json` を縮小して保存。
- 冪等・再実行安全。移動は「古い順」で、`slug`/`link` 一意は保持。

### `build` / `render` の変更
- 記事ページ生成ループ（`render.js:220`）は**ホット記事のみ**を対象化。
- ビルド末尾で `archive-pages/` を `dist/` へ**コピー**（生成せずコピーのみ＝O(コピー)）。
- `sitemap.xml`・アーカイブ月インデックス（`archive.html`）・`search-index` は、ホット＋シャードのメタ（本文抜き軽量）から構築。**全記事のメタは読むが、重い HTML 生成はホットのみ**。
- 関連記事・タグ・セクションの母集団は現状どおりホット中心（既に `retentionTop` 前提）。

### トレードオフ / 留意
- **凍結ページはテンプレ/CSS 変更に追従しない**（古い記事の見た目が固定）。許容できない場合は「`npm run rebuild-archive` で全凍結ページを一括再生成」する保守コマンドを別途用意（稀に手動実行）。共有 CSS はクラスベースなので、CSS だけの変更は凍結 HTML にも効く（HTML構造を変えない限り破綻しない）。
- 凍結 HTML を**コミットする**点は配信モデルの例外。ただし (a) 変化は月次ロール時のみ・(b) 追記主体でデルタ小・(c) 生成物churn を毎ジョブ起こさない、ため git 肥大は限定的。`dist/` を毎回 churn させない現方針とも整合。
- 自動ジョブ（`auto-generate.sh`）との関係: `roll-archive` は**日次ジョブに入れない**（月次 cron か手動）。日次で走らせると大きめの差分が自動 push される。dirty ガード対象外の `data/`＋追跡 `archive-pages/` を触るため、実行タイミングは人間管理下に置く。

## 4. 段階導入と着手条件（急がない）

現状 975記事のビルドは数秒で完了しており、**S-1 は今すぐの障害ではない**。以下で判断:

- **今すぐ**: ビルド時間・`articles.json` サイズ・生成ページ数を `writeRunSummary` かビルドログに計測出力（観測を先に持つ）。
- **着手トリガー（いずれか）**: `articles.json` が ~10MB 到達／ビルドが ~60s 超／Vercel 出力ファイル数が上限の50%接近。
- **Phase 1**: 案A のデータシャーディング（parse/ingest/メモリの軽量化・低リスク）。
- **Phase 2**: 案B の凍結HTML層（ビルド有界化）。Phase 1 の計測で必要性が確認できてから。

## 5. 未決事項（要相談）
- `hotWindow` の定義（期間ベース6ヶ月 vs 件数ベース1,500件）。
- 凍結ページのテンプレ追従ポリシー（固定許容 or 定期一括再生成）。
- `roll-archive` の実行主体（月次 cron 追加 vs 完全手動）。
- 凍結 HTML をコミットする配信モデル例外の可否（代替: 凍結分を Vercel の別デプロイ/静的ホストに置く案もあるが運用複雑化）。

## 6. 影響ファイル（実装時）
- `src/render.js`（記事ページ生成をホット限定化・archive-pages コピー・sitemap/search-index をメタベース化）
- `src/store.js`（ホット＋シャードのロード/セーブ、メタ抽出API）
- `src/rollArchive.js`（新規）＋ `package.json`（`roll-archive`/`rebuild-archive`）
- `src/config.js`（`hotWindow` 等）
- `.gitignore`（`archive-pages/` は**追跡する**＝除外しない）
- `templates/archive.js`（月インデックスをシャード対応）
