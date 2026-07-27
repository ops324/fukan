# 俯瞰（FUKAN）— 開発ルール

総合ニュースサイト（テック・AI・科学・経済・政治・国際・カルチャー等）。完全ローカル・課金最小・**アグリゲーター型短評**（要約＋中立論評＋出典リンク。全文転載しない）。
源泉データは `data/articles.json`、`npm run build` が全 HTML ＋ 静的アセットを `dist/` に生成する（`npm run render` は HTML のみを dist へ再生成）。
詳細仕様は [SPEC.md](SPEC.md) / [README.md](README.md)、記事の編集方針は [prompts/generate-articles.md](prompts/generate-articles.md) を参照。

このリポジトリは **`git push` した瞬間に Vercel 本番へ自動デプロイ**され、さらに **launchd の自動ジョブ（1日2回・6時/18時）が差分を自動 commit/push** する。壊れたコード・データはそのまま公開事故になる。以下を必ず守ること。

**配信モデル（重要）**: 生成物（HTML/feed/sitemap/search-index）は **VCS にコミットせず**、Vercel が `vercel.json` の `buildCommand:"npm run build"` / `outputDirectory:"dist"` で**デプロイ時に生成・配信**する。`dist/` は gitignore 済み。これにより自動ジョブの各コミットは実質 `data/articles.json` の差分のみになり、Git 肥大を防ぐ（生成物を毎ジョブ数百ファイル churn させない）。`dist/` の外（リポジトリ直下）にあるソース・ドキュメントは公開配信されない。

## 1. コード品質・脆弱性・デグレ防止【最重点】
- **ES Modules**（`"type":"module"`）。Lint/Formatter は未導入 → **周囲のコードのスタイル**（命名・インデント・コメント密度）に合わせる。
- **設定は一元管理**: 挙動を変える定数・件数・ソースは `src/config.js` に集約。スクリプトやテンプレートに直書きしない。
- **XSS / インジェクション防止**: 外部 RSS・外部由来の文字列を HTML/XML へ差し込む箇所は必ずエスケープを通す。
  - テンプレート（`templates/*.js`）= `esc()` / 本文 Markdown = `mdToHtml()`（ともに `src/markdown.js`）。
    `mdToHtml()` は marked レンダラで**生HTMLをテキスト化**し、リンク/画像の `href`/`src` を**プロトコル許可リスト**（`http(s)`/`mailto`/相対/アンカーのみ）で検証する。`javascript:` 等は `#` に無害化。退行は `npm run check` の `checkSanitizer()` が hard-fail で検知。
  - XML（sitemap/feed）= `render.js` 内の `xmlEsc`
  - **タグ名 → ファイルパス / URL** = `tagSlug()`（`src/tagSlug.js`）。タグは writer が自由に書く文字列で、
    そのままファイル名にすると `AR/VR` が `dist/tags/AR/VR.html` と解釈され **render 全体が ENOENT で落ちる**
    （2026-07-26 の障害。Vercel も同じ `npm run build` を走らせるためデプロイごと停止した）。
    適用箇所は「書き出し名・sitemap（`render.js`）／`tagHref`（`cardbits.js`）／canonical（`tag.js`）」の4つで、
    **1つでも外すと URL と実ファイルがずれる**。退行は `npm run check` の `checkTagPathWiring()` が
    危険文字を含む合成タグを実際に描画して hard-fail で検知する（実データは正規化済みで素通りするため、
    実データによる検査では配線の外れを捕まえられない）。取り込み時にも `normalizeSectionTags` が同じ変換をかける。
  - 新たに「外部入力 → 出力」の経路を足したら、必ずエスケープ経路を確認する。
- **秘密情報**: API キー類は `.env`（gitignore 済み）のみ。コード・コミット・ログ・生成物に出さない。新キーは `.env.example` に項目だけ追記。
  - 例外的に `CF_BEACON_TOKEN` / `SITE_URL` は**公開前提の値**（全ページに出てよい）。
  - `SLACK_WEBHOOK_URL` は**秘密**（知っていれば誰でもそのチャンネルに投稿できる）。公開値リストに入れない。
- **デグレ不変条件（壊さない）**:
  - `data/articles.json` のスキーマ（`slug, headline, lead, body_markdown, tags[], section, source, link, importance(1-5), image_query, image, mode, createdAt, publishedAt`）を**後方互換**で維持。`importance` 欠落のレガシー記事あり（render は 3 にフォールバック）。`createdAt`＝取り込み時刻／`publishedAt`＝出典の発行日時（任意・並び/表示/鮮度の基準）。`publishedAt` 欠落時は `createdAt` にフォールバック。
  - **`slug` 一意・`link` 一意**（link による冪等な重複排除）の前提を壊さない。
  - `npm run build`（および `npm run render`）が**全ページ例外なく完走**すること（1 テンプレの破壊で全生成が止まる）。これが落ちると Vercel のデプロイビルドも失敗する。
- **自己改善ハーネス（MVP）の不変条件**（詳細 SPEC §12）:
  - `src/config.js` の `constitution`（事実忠実性・創作禁止・全文転載しない 等）と `lockedDecisions`（署名表記など）は**弱めない**。`lockedDecisions` の文言が記事HTMLから消えると `npm run check` が落ちる（退行検査）。署名「AI 自動要約 + 人手編集」は現状維持。
  - 日次フローは **writer(Haiku, 下書きのみ・量産)→ judge(別モデル/Sonnet, 出典照合・veto)→ ingest(veto尊重・評価をledgerへ)** の3段。writer は安価な Haiku で約30本/日を量産し、judge は writer≠judge を保つため一段上の Sonnet で独立検証する（モデルは `src/config.js` の `writerModel`/`judgeModel` が正本）。`generate-articles.md` は ingest を実行しない（`auto-generate.sh` が査読と取り込みを行う）。
  - **judge が失敗しても日次ジョブは止めない**（客観ゲートのみで公開＋通知）。評価機構の故障で公開事故/停止を起こさないこと。
  - **修正リトライ（`config.fixRound`）の不変条件**: 修正は**1回限り**（イテレーションを増やすと judge を騙す勾配ができる）。
    再査読の判定基準は初回と**同一**（`prompts/_veto-criteria.md` を両ラウンドへ `cat` 合成する。片方だけ緩めない）。
    `fixHint` は出典側の事実指摘のみで**修正文を書かせない**（judge が自作を査読すると writer≠judge が崩れる）。
    **fix が失敗しても pass 記事の公開を妨げない**——`src/mergeFixReview.js` がドラフトを原状復帰させる（SPEC §12.6）。
  - **veto は必ず ledger に残す**（`data/quality/vetoes.jsonl`）。writer が自分の失敗を見られない構造に戻さないこと。
    ただし記録の失敗で取り込みを止めない（try/catch で握る）。
    **握るなら、後から気づける経路を必ず残す**——2026-07-26 は記録ブロックごと飛んで21本が未記録のまま
    公開され、記事は正常に見えるため指摘されるまで発覚しなかった。`npm run check` の `checkLedgerCoverage()` が
    直近 `config.ledger.coverageWindow` 件の記録漏れを警告する（非ブロック）。この警告を消さないこと。
    **握る範囲は1件ずつに閉じる**——try/catch でループ全体を包むと、1本の失敗で残り全部の記録が消える。
    **記録に失敗したときは入力を捨てない**——judge の `scores`/`sourceFetched` は `_review.json` にしか無く、
    消すと復元不能。`data/quality/_review-failed-<UTC>.json` へ退避し `ledger_write_failed` を残す。
    **還流（`vetoDigest`）の母集団から「救済された veto」を外さない**——外すと修正リトライが効くほど writer が
    自分の失敗を見られなくなる（2026-07-25 は 15件中11件が救済され、還流が 4件まで痩せていた）。
    逆に**救済されたという結果は writer に見せない**（「直してもらえる」と学ばせない）。救済率は stderr のみ。
  - **決定論リント（`src/lintDrafts.js`）を空回りさせない**（SPEC §12.7）。writer は自己批評でこれを実行し、
    `auto-generate.sh` も ingest 前に同じ検査を走らせる（プロンプトを飛ばされても消えないための二重化）。
    すべて警告で公開はブロックしない。指摘の解消を**数値・固有名詞の削除**でやらせないこと（回避であって訂正ではない）。
    検出力の退行は `npm run check` の `checkDraftLint()` が hard-fail で止める。
- **出典の扱い（事実忠実性の要）**:
  - **出典の約3割は自動取得できない**（Guardian/Verge/BBC は bot 拒否、CNBC は 403、Variety は課金ゲート）。
    これは障害ではなく「AI に読ませたくない」という**意思表示**なので、**UA 偽装で回避しない**（SPEC §11）。
    **例外は openai.com のみ**——robots.txt が `Allow: /` で拒否の記載が無く、403 は WAF の誤検知。
    `config.summaryFetch.domains` に**ドメインを追加するときは、必ず robots.txt を確認する**。
    拒否しているドメインを足すのは意思の迂回であり、してはならない。
  - **記事間の取り違えを疑う**。同じ回に書いた別記事の固有名詞（人名・社名・所在地・金額・従業員数）が
    混入する事故が繰り返し起きている。writer は自己批評で1件ずつ出典と突き合わせ、judge は
    **全下書きを横断して**取り違えを探す（judge はそれができる唯一の層）。
  - **`sourceFetched` は pass にも veto にも記録する**。veto だけ見ると「読めない出典は veto が少ない＝品質が良い」と
    誤読する（実際は検査できていないだけ）。この観測を止めない。
- **通知は「向こうから届く」経路を保つ**:
  - 異常（認証切れ・執筆失敗・push 失敗など11種）と毎ランの実行サマリを **Slack** へ送る（`src/notifySlack.js`）。
    macOS のバナーだけだった頃、認証切れの通知が4回出ていたのに気づけず**3日間サイトが止まった**（2026-07-22〜25）。
    「見に行けば分かる」だけの状態に戻さないこと。
  - **通知の失敗で日次を止めない**——未設定・不正 URL・ネットワーク断でも `notifySlack` は常に exit 0。
    この規律は judge / 画像査読と同じ（評価・通知機構の故障で公開事故を起こさない）。
  - 読めないときは ①候補の `summary`（出典自身の RSS 要約）→ ②`config.trustedSecondary` の報道機関で裏取り →
    ③どれでも確認できなければ**書かない**、の順。**想像で埋めない**。
  - **他媒体を使ったら必ず `sources[]` に記録し、本文でも帰属を示す。** 他媒体の参照自体は正しい取材で、
    禁じるのは**出所を隠すこと**。`link` を掲げながらそこに無い数値を載せると読者が検証できない。
  - **全体値を内訳に合わせて動かさない**（合計を下げて辻褄を合わせるのは訂正ではなく改変）。合計を自分で足し算して作らない。
  - **固有名詞は出典の表記のまま**。原綴りがあるものを独自にカタカナ化しない（`SpaceX`→「スペックス」は veto 事由）。
  - `data/quality/`（評価 ledger）は **data 配下＝dirty ガードに触れない**。客観指標のしきい値は「床」であって最大化目標ではない。
- **「直した」と報告する前に、同じ判定器で確かめる**（自動修復ツール共通の規律）:
  検出して直すツール（`recheck-images` / `recheck-image-relevance`）は、**差し替え後の結果を再判定してから**
  成功を報告する。①差し替え対象を候補集合から外さずに取得すると*同じものが選び直され*、中身が変わっていないのに
  「差し替えました」と出る（2026-07-27 に発生）。②別のものに替わっても*依然として不適合*なことがある。
  どちらも「点検して直したつもりのまま不適合が残り続ける」という同じ失敗の形。
  `改善 N / 依然として不足 M / 変化なし L` を必ず集計し、残りは slug 付きで警告に出す。
  差し替え0件なら保存・再生成そのものを行わない（無意味な再デプロイを起こさない）。
- **`articles.json` / ledger を書くときは `atomicWrite` を通し、CAS を外さない**（SPEC §11）:
  `saveArticles` は「読み込み後にディスク側が変わっていたら書かずに throw」する。自動ジョブ（6:00/18:00）と
  手動コマンドが重なると相手の記事をまるごと消すため（2026-07-27 に再現確認）。
  - **排他ロックを手動コマンドへ配らない**。取り残すと公開が止まり、`process.on('exit')` は SIGINT/SIGTERM で
    発火しないので Ctrl-C を拾えない。可逆で可視な障害を、不可逆で不可視な障害に変えてはいけない。
  - CAS を回避したいときは `saveArticles(arts, { force: true })` を**意図的に**使う（復旧作業用）。
    衝突が出るからといって既定を force にしない。
  - 新しい一時ファイルを作る書き込みを足したら **`.gitignore` を同じコミットで**更新する
    （`git add -A` が残骸を本番へ push し、以後 git status が常に汚れて空コミットが積まれる）。
- **依存は最小**: runtime 依存は `dotenv` / `marked` / `rss-parser` の3つのみ。安易に増やさない（閲覧側はゼロ依存の静的物）。
- **render は“非決定的”**: 日付ラベル・`feed.xml` の `lastBuildDate`・`sitemap` の `lastmod` が毎回更新される。
  → ただし出力先は `dist/`（gitignore 済み）なので、この揺れが **git 差分に出ることはない**。追加の揺れ（`Math.random()` 等）を新たに持ち込まない。

## 2. Git・コミット・デプロイ
- **手動開発の具体手順は [CONTRIBUTING.md](CONTRIBUTING.md) を参照**（`work/<topic>` → PR → マージ）。PR は CI（`.github/workflows/check.yml` = `npm run check`）通過を確認してからマージする。
- **障害対応・復旧の手順は [docs/RUNBOOK.md](docs/RUNBOOK.md)**（articles.json 破損／記事の取り下げ／公開ゲートが赤／ジョブが動かない／作業ブランチのまま時刻を迎えた／画像／定期メンテ／バックアップ対象外の一覧）。
- **push = 即本番**。`npm run check` 通過 ＋ 目視確認まで `origin main` に push しない。
- **commit / push は明示依頼があったときだけ**行う。
- **コード改善・機能追加・リスクある変更は作業ブランチで行う（既定）**。`main` 直コミットは記事内容や軽微な文言／ドキュメント微修正に限る。
  - 手順: `git switch -c work/<topic>` → 実装 → `npm run check` ＋ preview で検証 → 依頼を受けて `main` にマージ（その瞬間に本番反映）。
  - **離席前に `main` へ戻す**（2026-07-27 追加）。自動ジョブは `git add -- data` → `git commit` を
    **checkout 中のブランチ**に対して行うため、作業ブランチのまま 6/18 時を迎えると記事がそのブランチに積まれ、
    直後の `git push origin main` は「変更なしの main」を送って**成功と報告する**——ログは `push 完了`、本番は無風。
    現在は commit 前に `main` かどうかを確認して中止＋通知するようにしたが、規律としては「戻してから離れる」。
  - **理由（このリポジトリ固有・重要）**: 自動ジョブの `git push origin main` は **`main` 上の未 push コミットをまとめて送る**。
    つまり「WIP を `main` にコミットだけして push しない」は安全ではなく、次の自動実行（6/18時）が本番へ出してしまう。
    WIP コミットをブランチに置けば `main` の外に居るため、自動ジョブに拾われない。§(C)のガードは dirty な作業ツリーは止めるが、
    **未 push コミットは止められない**——その穴をブランチ運用で塞ぐ。
  - 自動ジョブのコミットは実質 `data/articles.json`（＋プレス画像等の追跡アセット）のみを触る——生成物は `dist/`（gitignore）に出るため commit されない。よって `src/` のコード変更とは通常競合しない（マージ/リベースはクリーンになりやすい）。
- **自動ジョブとの共存**: `scripts/auto-generate.sh` が差分を自動 commit/push する。`src/` や `templates/` に**作業途中（dirty）の変更を放置しない**——commit（ブランチ上で）するか stash／退避してから離席する。
  （保険として auto-generate.sh はソース系が dirty なら自動コミットを中止し通知するが、根本はこの規律。）
- **コミットメッセージ**:
  - 自動ジョブ: `auto: YYYY-MM-DD HH:MM 記事を更新`（人間は使わない）
  - 人間 / Claude: `feat / fix / docs / chore / refactor` プレフィックス。フッターに
    `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` を付ける。

## 3. テスト・検証（公開前は必須）
自動テストは無い。**公開前に必ず `npm run check`**（レンダー完走＋スキーマ/一意性＋鍵混入チェック。作業ツリーは汚さない）。

**自動ジョブも push 前に `check` を通す**（`auto-generate.sh`）。落ちたら commit/push を中止し、Slack へ失敗内容を送り、
`data/quality/incidents.jsonl` に `publish_blocked` を残す。2026-07-26 は push 判定が git 差分しか見ておらず、
`ingestDrafts` の失敗を検知して通知まで出していながら描画できないデータを本番へ送った——`rc≠0` の回は push しない。
- **スコープ境界**: 「失敗しても日次を止めない」のは **judge / 通知 / 画像査読** ＝ LLM・ネットワーク依存の**評価・通知**機構。
  評価機構の故障で公開事故や停止を招かないための規律であって、`check` のような**決定論の公開ゲートは止める側**。混同しない。
- **ゲートが赤のときの復旧**: `node src/check.js` の指摘を読み、`data/articles.json` を直す。
  その回の記事を捨てるなら `git checkout -- data/articles.json`。放置すると**ローカルにだけ記事が溜まり公開は止まったまま**になる
  （`data/.status` は「公開ブロック」、STREAK も進むので 3 回連続で追加通知が出る）。

| コマンド | 用途 |
|---|---|
| `npm run check` | 公開前ゲート（必須）。レンダー完走＋スキーマ/一意性＋鍵混入＋**constitution 退行検査**＋**タグ→パス配線の退行検査**＋**客観品質警告**（警告は非ブロック） |
| `npm run candidates` | RSS 取得の疎通（`data/_candidates.json` 生成） |
| `npm run build` | `articles.json` から `dist/` に全 HTML ＋ `dist/assets/` を生成（Vercel のデプロイビルドと同一）。ローカル目視はこれ |
| `npm run render` | `articles.json` から `dist/` に HTML のみ再生成（アセットは複製しない。下書き再描画用） |
| `npm run migrate-sections` | 旧カテゴリ section を `config.sectionAliases` で navSections へ一括正規化（旧ラベルはタグへ退避・冪等）。**既定 dry-run**（変わるタグと消えるタグ URL を表示）／`-- --apply` で適用 → `npm run build` |
| `npm run evaluate` | 直近記事を客観評価して ledger に記録（`--rate <slug> <1-5> [メモ]` で人手評価）。SPEC §12 |
| `npm run quality-digest` | writer に注入される品質フィードバックを確認（veto 傾向＋体裁逸脱）。stderr に救済率も出る |
| `npm run lint-drafts` | 下書き（`data/_drafts.json`）の決定論リント。出典を読まずに分かる矛盾＝要約層だけの数値／比率の食い違い／円換算の疑い／全角合成文字／**別記事からの語の混入**を検出（警告のみ）。SPEC §12.7 |
| `npm run seed-veto-ledger` | 過去の veto を `scheduler.log` から `vetoes.jsonl` へ遡及投入（既定 dry-run／`-- --apply`）。冪等 |
| `npm run backfill-images` | 画像の補完／重複解消（画像系を触ったとき） |
| `npm run refresh-brand-photos` | ブランド写真の索引（`data/brand-photos.json`）を更新。他社ロゴ/UI の写り込み判定に使う。マージ方式＝レート制限に当たっても再実行で続きから育つ。月1回程度 |
| `npm run recheck-images` | 既存記事のサムネをブランド不一致で点検（dry-run・API不要）。`-- --apply` で差し替え＋再生成、`-- --limit N` で件数を絞る |
| `npm run recheck-image-relevance` | 既存記事のサムネを記事内容との関連度で点検（dry-run・API不要）。alt有りの低関連度を洗い出す（alt欠落は別枠集計）。`-- --apply` で差し替え、`-- --slug <slug>` で1件だけ |
| `npm run set-press-image` | 公式プレス画像を手動登録（クレジット必須・自動上書き保護。SPEC §6.1） |
| `npm run serve` | `npm run build` 実行後、`dist/` を http://localhost:8000 で配信してローカル確認 |

フロント目視は `npm run serve`（dist を配信）か Claude の preview_*（ポートは環境依存）で起動 → console/network のエラー確認 → トップ／記事／セクション／タグ／`feed.xml` を確認し、スクショで証跡を残す。

**公開前チェックリスト**
- [ ] `npm run check` が緑
- [ ] 主要ページ（トップ／記事／セクション／タグ／RSS）が崩れていない
- [ ] `sitemap.xml` / `robots.txt` / `feed.xml` / `search-index.json` が生成されている
- [ ] `git diff` に鍵・個人情報・想定外の巨大差分がない
