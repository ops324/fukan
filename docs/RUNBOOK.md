# 運用ランブック

困ったときの手順書。**push した瞬間に本番へ出る**リポジトリなので、迷ったら「止める」側に倒す。

前提: 作業は `main` で行い、終わったら `main` に戻しておく（自動ジョブは checkout 中のブランチに
commit するため、作業ブランチのままだと記事が本番に出ない → §5）。

---

## 1. `articles.json` が壊れた

**症状**: `npm run check` が「articles.json を JSON として解析できません（破損の可能性）」で赤。
自動ジョブは `ERROR: ingestDrafts が失敗` で止まり、Slack に通知が来る。

`loadArticles()` は破損時に**わざと throw する**（空配列を返すと全記事を空で上書きしてしまうため）。
つまりパイプライン全体が止まる。これは仕様。

```bash
# ① まず現物を見る（壊れ方で判断が変わる）
tail -c 300 data/articles.json

# ② 直前のコミットから戻す（自動ジョブは正常回ごとに commit しているので最大でも1ラン分の損失）
git checkout -- data/articles.json

# ③ それでも駄目なら、さらに前の版から
git log --oneline -10 -- data/articles.json
git show <sha>:data/articles.json > data/articles.json

# ④ 確認してから公開
npm run check && npm run build
```

**注意**: ②③は**未コミットの記事を破棄する**。公開ゲートが赤で止まっていた期間があるなら、
先に §3 の退避ブランチを確認すること。

現在は `saveArticles` が temp+rename の原子的書き込みなので、書き込み途中の破損は起きにくい
（SPEC §11）。それでも壊れているならディスクや外部要因を疑う。

---

## 2. 記事を1本取り消したい（公開を止めたい）

**専用コマンドは無い**。`data/articles.json` から該当オブジェクトを削除する。

```bash
# ① 対象を確認
node -e "const a=require('./data/articles.json');const x=a.find(y=>y.slug==='20260726-29');console.log(x.headline, x.link)"

# ② 削除（slug 指定）
node -e "
const fs=require('fs');const p='data/articles.json';
const a=JSON.parse(fs.readFileSync(p,'utf8'));
const before=a.length;
const out=a.filter(x=>x.slug!=='20260726-29');
if(out.length===before){console.error('該当なし');process.exit(1)}
fs.writeFileSync(p, JSON.stringify(out,null,2));
console.log(before+' → '+out.length);"

# ③ 検証して公開
npm run check && npm run build
git add -- data/articles.json && git commit -m "fix: 記事 20260726-29 を取り下げる" && git push
```

**取り下げても URL は 404 になるだけで、リダイレクトは張られない**（この構成にリダイレクト機構は無い）。
`sitemap.xml` は次のビルドで自動的に落ちる。外部から参照されている記事なら、削除ではなく
本文の訂正で対応するほうが読者には親切。

`link`（出典URL）は重複判定のキーなので、**削除するとその出典が再取り込みされうる**。
恒久的に載せたくないなら出典側で除外する必要がある。

---

## 3. 公開ゲート（`npm run check`）が赤で公開が止まっている

**症状**: `data/.status` が「公開ブロック（check 失敗・要対応）」。Slack に失敗内容つきの通知。
`data/quality/incidents.jsonl` に `publish_blocked`。記事はローカルにだけ溜まっていく。

```bash
# ① 何が落ちているか見る
node src/check.js

# ② 直せるなら直して、通れば次の自動ジョブが公開する（手動で push してもよい）
npm run check && npm run build

# ③ その回の記事を捨てる判断をした場合
git checkout -- data/articles.json
```

**③の前に必ず確認**: ブロック中の記事は `blocked/<日時>` ブランチへ自動退避されている。
捨てた後でも取り戻せる。

```bash
git branch -a --list '*blocked/*'
git show blocked/2026-07-27-0600:data/articles.json > /tmp/recovered.json
```

放置すると**ローカルにだけ記事が溜まり公開は止まったまま**になる。連続でブロックされると
STREAK が進み「3回連続」の通知が出る。

---

## 4. 自動ジョブが動いていない / 記事が増えない

```bash
# ① 状態ファイルとログ
cat data/.status
tail -40 data/scheduler.log

# ② launchd に登録されているか
launchctl print gui/$(id -u)/com.axiom.generate | grep -i state

# ③ 認証切れの確認（claude auth status は当てにならない。失効中でも loggedIn:true を返す）
claude -p "OK とだけ答えてください" --model claude-haiku-4-5-20251001 --strict-mcp-config
#   → 失敗するなら: claude を起動して /login
```

**ロック競合でスキップし続けている場合**（`data/.status` が「ロック競合でスキップ」）:

```bash
ls -la data/.harness.lock/ && cat data/.harness.lock/info   # PID 開始時刻
rm -rf data/.harness.lock                                   # 保持プロセスが居ないことを確認してから
```

---

## 5. 作業ブランチのまま自動ジョブの時刻（6:00 / 18:00）を迎えてしまった

現在はジョブ側が `main` にいるか確認して中止し、通知する。記事は取り込まれているが**公開されていない**。

```bash
git branch --show-current      # main でなければ
git stash -u                   # 作業中の変更を退避
git switch main
npm run check && npm run build # 記事は data/ に入っているので、通れば
git add -- data && git commit -m "auto: 記事を更新" && git push
git switch -                   # 作業ブランチに戻る
git stash pop
```

**離席前に `main` へ戻す**のが本来の規律（CLAUDE.md §2）。

---

## 6. 画像がおかしい

```bash
npm run recheck-images                    # 他社ブランドの写り込み（dry-run・API不要）
npm run recheck-image-relevance           # 記事内容との関連度（dry-run・API不要）
npm run recheck-image-relevance -- --apply --slug 20260726-18   # 1件だけ差し替え
```

差し替え後は**同じ判定器で再判定**され、`改善 N / 依然として不足 M` が出る。
「依然として不足」が残るときは `image_query` が事象名になっている可能性が高い
（`typhoon landfall` ではなく `flooded street storm` のように**情景**を書く）。

---

## 7. 定期メンテナンス

```bash
# git のオブジェクトを詰める。2.4MB の JSON を1日2回コミットするため loose object が溜まる。
# 既定の gc.auto=6700 は「オブジェクト数」判定なので、少数×巨大のこのリポジトリでは
# なかなか発火しない。gc.auto を下げてあるが、気になったら手動でも実行してよい。
git gc

# ブランド写真の索引を育てる（Unsplash 50req/時。月1回程度・何度でも再実行可）
npm run refresh-brand-photos
```

---

## 8. バックアップされていないもの

GitHub が実質のバックアップだが、以下は**含まれない**。

| 対象 | 扱い |
|---|---|
| `.env` | 意図的に除外。復旧時は各キーを再発行する。**未設定でも通知が黙って止まるだけ**なので、復旧後は Slack 通知が届くか必ず確認する |
| `data/quality/*.archive.jsonl` | ledger のローテーション退避（4,500行超で発生）。分析用の履歴で、プロダクトではない。発生開始は 2026年12月ごろの見込み |
| `data/scheduler.log` / `.status` / `.health` / `.lockskip` | ローカルの実行状態。失われても次のランで作り直される |
| 公開ゲートでブロック中の未コミット記事 | `blocked/<日時>` ブランチへ自動退避される（§3） |
