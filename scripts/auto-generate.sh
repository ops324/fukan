#!/bin/zsh
# 俯瞰（FUKAN）— launchd から定期実行されるヘッドレス Claude Code 執筆ジョブ。
# Claude 自身が WebFetch / WebSearch で取材し、忠実な記事を書いてサイトに反映する。
# （翡翠眼方式: API キー不要・Anthropic サブスク内で完結）
set -u

PROJECT_DIR="/Users/takimototetsuya/AIニュースサイト"
CLAUDE_BIN="/Users/takimototetsuya/.local/bin/claude"
PROMPT_FILE="$PROJECT_DIR/prompts/generate-articles.md"
REVIEW_PROMPT_FILE="$PROJECT_DIR/prompts/review-drafts.md"

cd "$PROJECT_DIR" || exit 1

NODE_BIN="/usr/local/bin/node"
HEALTH_FILE="$PROJECT_DIR/data/.health"
# 執筆モデル（writer）。要約＋論評タスクなので安価な Haiku で量産する。src/config.js の writerModel が正本、ここは既定値の写し。
WRITER_MODEL="${WRITER_MODEL:-claude-haiku-4-5-20251001}"
# 査読モデル（judge）。writer と別モデルにして自己相関を下げる（writer=Haiku のため judge=Sonnet）。src/config.js の judgeModel が正本、ここは既定値の写し。
JUDGE_MODEL="${JUDGE_MODEL:-claude-sonnet-4-6}"
# writer/judge に渡すツール allowlist。既定だと ScheduleWakeup/Task(Agent)/Monitor/Workflow など
# 自己再開・オーケストレーション系や MCP サーバ(lazyweb 等)まで掴んでしまい、線形パイプライン
# (候補取得→WebFetch→下書きWrite)から逸脱して 0 本で終わる事故が起きた(2026-06-26)。実際に要るツールだけに絞る。
# 注: 可用性の制限は --tools で行う（--allowedTools は自動承認の制御で、ツール可用性は絞らない。CLI 2.1.185 で確認済み）。
#     MCP は --strict-mcp-config + --mcp-config 不指定で全無効化する。
WRITER_TOOLS="Bash Read Write Edit WebFetch WebSearch Glob Grep"
JUDGE_TOOLS="Bash Read Write WebFetch WebSearch"
# 執筆リトライ上限（初回＋リトライ）。一過性のAPI切断や 0 本終了を1回だけ救済（Haiku・低コスト）。
WRITER_MAX_TRIES=2
# 既定モデルが過負荷/瞬断のとき自動フォールバック（可用性の底上げ。通常は WRITER_MODEL=Haiku を使う）。
WRITER_FALLBACK_MODEL="${WRITER_FALLBACK_MODEL:-claude-sonnet-4-6}"
# 二重起動防止ロック（content ジョブと将来の self-improve ジョブを排他）。mkdir は原子的。
LOCK_DIR="$PROJECT_DIR/data/.harness.lock"
LOCK_MAX_AGE=3600   # 秒。これを超える古いロックは異常終了の残骸とみなし再取得する。

# macOS 通知ヘルパー（失敗時に気づけるように）
notify() {
  /usr/bin/osascript -e "display notification \"$1\" with title \"俯瞰 FUKAN\" sound name \"Basso\"" 2>/dev/null || true
}

# 記事総数を返す（取れなければ -1）
count_articles() {
  "$NODE_BIN" -e 'try{console.log(require("./data/articles.json").length)}catch(e){console.log(-1)}' 2>/dev/null
}

echo "===== $(date '+%Y-%m-%d %H:%M:%S') Claude執筆ジョブ開始 ====="

if [[ ! -x "$CLAUDE_BIN" ]]; then
  echo "ERROR: claude CLI が見つかりません ($CLAUDE_BIN)"
  notify "claude CLI が見つかりません。パイプライン停止中。"
  exit 1
fi

# --- 二重起動防止ロック（stale 安全）---
# クラッシュでロックが残ると両ジョブが無言停止＝記事ゼロになるため、古いロックは再取得する。
acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "$$ $(date '+%s')" > "$LOCK_DIR/info"; return 0
  fi
  local age=999999 started pid
  [[ -f "$LOCK_DIR/info" ]] && pid="$(awk '{print $1}' "$LOCK_DIR/info" 2>/dev/null)"
  [[ -f "$LOCK_DIR/info" ]] && started="$(awk '{print $2}' "$LOCK_DIR/info" 2>/dev/null)"
  [[ -n "${started:-}" ]] && age=$(( $(date '+%s') - started ))
  # ロック保持プロセスが生存していれば、age に関わらず奪わない（書込み中の二重実行→破損を防ぐ）。
  if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
    echo "INFO: 別のジョブが実行中（ロックあり, PID=$pid 生存, age=${age}s）。今回はスキップします。"
    return 1
  fi
  if [[ "$age" -ge "$LOCK_MAX_AGE" ]]; then
    echo "WARN: 古いロック（${age}秒）を再取得します（前回ジョブの異常終了の可能性）"
    notify "古いロックを再取得しました。前回の自動ジョブが異常終了した可能性があります。"
    rm -rf "$LOCK_DIR"
    mkdir "$LOCK_DIR" 2>/dev/null && { echo "$$ $(date '+%s')" > "$LOCK_DIR/info"; return 0; }
  fi
  echo "INFO: 別のジョブが実行中（ロックあり, age=${age}s）。今回はスキップします。"
  return 1
}
acquire_lock || exit 0
trap 'rm -rf "$LOCK_DIR"' EXIT

BEFORE_COUNT="$(count_articles)"

# 前回ジョブの残骸を掃除（古い下書き/査読を今回の成功と誤認しないため）。
rm -f "$PROJECT_DIR/data/_drafts.json" "$PROJECT_DIR/data/_review.json"

# 下書き/候補の件数を返すヘルパー（読めなければ 0）。
drafts_count() {
  "$NODE_BIN" -e 'try{const d=require("./data/_drafts.json");process.stdout.write(String(Array.isArray(d)?d.length:0))}catch(e){process.stdout.write("0")}' 2>/dev/null
}
candidates_count() {
  "$NODE_BIN" -e 'try{const c=require("./data/_candidates.json");process.stdout.write(String(Array.isArray(c)?c.length:0))}catch(e){process.stdout.write("0")}' 2>/dev/null
}

# --- 1) 執筆（writer=Haiku。src/config.js の writerModel が正本）---
# プロンプトに従い fetchCandidates → 取材 → 自己批評 → 下書き(data/_drafts.json) まで。取り込みはしない。
# ツールは WRITER_TOOLS に限定し MCP を無効化（先送り・サブエージェント膨張・MCP迷走を構造的に封じる）。
# 失敗（rc≠0、または「候補ありなのに下書き0本」）は最大 WRITER_MAX_TRIES 回までリトライする。
# 注: zsh では $status は読み取り専用（$? の別名）。別名 rc を使う。
# 直近記事の品質傾向（決定的・オフライン）を writer プロンプト末尾へ還流する。
# 取得失敗時は空文字＝従来どおりの挙動（日次ジョブは止めない）。
DIGEST="$("$NODE_BIN" src/qualityDigest.js 2>/dev/null)"
rc=1
DRAFT_COUNT=0
for (( try=1; try<=WRITER_MAX_TRIES; try++ )); do
  echo "writer 実行 (試行 ${try}/${WRITER_MAX_TRIES}, model=$WRITER_MODEL, tools制限/MCP無効)"
  "$CLAUDE_BIN" --model "$WRITER_MODEL" --fallback-model "$WRITER_FALLBACK_MODEL" \
    --dangerously-skip-permissions --tools "$WRITER_TOOLS" --strict-mcp-config \
    -p "$(cat "$PROMPT_FILE")${DIGEST:+

$DIGEST}"
  rc=$?
  DRAFT_COUNT="$(drafts_count)"
  if [[ "$rc" -eq 0 && "$DRAFT_COUNT" -gt 0 ]]; then
    echo "writer 成功: 下書き ${DRAFT_COUNT} 件"
    break
  fi
  CC="$(candidates_count)"
  if [[ "$CC" -eq 0 ]]; then
    echo "候補 0 件（新着なし）→ リトライ不要"
    rc=0
    break
  fi
  echo "WARN: writer が下書きを生成できず (rc=$rc, drafts=$DRAFT_COUNT, candidates=$CC)"
  if (( try < WRITER_MAX_TRIES )); then
    echo "→ writer を再実行します（10秒待機）"
    sleep 10
  fi
done

# 健全性チェック用に候補数を退避（ingestDrafts.js が _candidates.json を削除するため後では読めない）。
CAND_COUNT="$(candidates_count)"

# --- 2) 査読（judge=別モデル）→ 3) 取り込み。下書きがあるときだけ実行。---
HAS_DRAFTS="$("$NODE_BIN" -e 'try{const d=require("./data/_drafts.json");process.stdout.write(Array.isArray(d)&&d.length?"1":"0")}catch(e){process.stdout.write("0")}' 2>/dev/null)"
if [[ "$HAS_DRAFTS" == "1" ]]; then
  # トークン削減: 低リスク（全 draft が primary かつ客観フラグ無し）なら査読を丸ごとスキップ。
  # media 混在 or 客観フラグ有り（=独立検証が最も要る回）のときだけ judge を走らせる。
  NEED_JUDGE="$("$NODE_BIN" src/evaluate.js --triage 2>/dev/null)"
  if [[ "$NEED_JUDGE" == "1" ]]; then
    echo "高リスクの下書きあり → 別モデル($JUDGE_MODEL)で査読（出典照合・採点, tools制限/MCP無効）"
    "$CLAUDE_BIN" --model "$JUDGE_MODEL" --dangerously-skip-permissions \
      --tools "$JUDGE_TOOLS" --strict-mcp-config -p "$(cat "$REVIEW_PROMPT_FILE")"
    jrc=$?
    # 失敗時最優先: 日次ジョブを止めない。査読不在なら客観ゲートのみで通常公開し通知。
    if [[ "$jrc" -ne 0 || ! -f "$PROJECT_DIR/data/_review.json" ]]; then
      echo "WARN: 査読が完了しませんでした (exit=$jrc)。客観ゲートのみで取り込みを続行します。"
      notify "査読(judge)が不在のまま公開します。後で品質をご確認ください。"
      # 観測性: judge 不在を ledger に残し、後追いで頻度・原因を分析できるようにする（日次は止めない）。
      printf '{"ts":"%s","type":"judge_absent","exit":%s}\n' "$(date -u +%FT%TZ)" "$jrc" \
        >> "$PROJECT_DIR/data/quality/incidents.jsonl"
    fi
  else
    echo "低リスク（全て一次情報・客観フラグ無し）→ 査読をスキップし客観ゲートのみで公開"
  fi
  echo "取り込み（veto尊重・画像付与・再生成・評価をledgerへ記録）"
  "$NODE_BIN" src/ingestDrafts.js
  irc=$?
  if [[ "$irc" -ne 0 ]]; then
    echo "ERROR: ingestDrafts が失敗 (exit=$irc)"
    notify "取り込みに失敗しました (exit=$irc)。ログを確認してください。"
    rc=$irc
  fi
else
  echo "下書きなし（査読・取り込みはスキップ）"
fi

# 結果を決定的にログへ残す（-p 出力は要約として不確実なため）。
"$NODE_BIN" -e 'const a=require("./data/articles.json");console.log("現在の総記事数: "+a.length);console.log("最新の見出し:");a.slice(0,3).forEach(x=>console.log("  - "+x.slug+" | "+x.headline))' 2>/dev/null

# --- 健全性チェック（失敗を検知して通知）---
AFTER_COUNT="$(count_articles)"
ADDED=$(( AFTER_COUNT - BEFORE_COUNT ))
echo "記事数: ${BEFORE_COUNT} → ${AFTER_COUNT}（追加 ${ADDED} 件）"

# 連続「無増加」回数を data/.health に記録（増えたらリセット）
STREAK=0
[[ -f "$HEALTH_FILE" ]] && STREAK="$(cat "$HEALTH_FILE" 2>/dev/null || echo 0)"

if [[ "$rc" -ne 0 ]]; then
  echo "ERROR: claude 実行が異常終了 (exit=$rc)"
  notify "執筆ジョブが異常終了しました (exit=$rc)。ログを確認してください。"
elif [[ "$AFTER_COUNT" -lt 0 ]]; then
  echo "ERROR: articles.json を読めません"
  notify "articles.json を読めません。データ破損の可能性。"
elif [[ "$ADDED" -le 0 ]]; then
  STREAK=$(( STREAK + 1 ))
  if [[ "$CAND_COUNT" -gt 0 && "$DRAFT_COUNT" -le 0 ]]; then
    # 候補はあったのに writer が 1 本も書けなかった＝writer 失敗。3回待たず即通知。
    echo "ERROR: 候補 ${CAND_COUNT} 件に対し下書き 0 本（writer 失敗の疑い, 連続 ${STREAK} 回）"
    notify "執筆失敗: 候補 ${CAND_COUNT} 件に対し記事 0 本でした。writer を確認してください。"
  else
    # 真に新着なし、または下書きは出たが veto/重複で全て公開見送り（品質ゲート作動）＝writer 失敗ではない。
    echo "INFO: 新規記事なし（候補 ${CAND_COUNT}件 / 下書き ${DRAFT_COUNT}件, 連続 ${STREAK} 回）"
  fi
  # 3回連続（=約半日以上）新規ゼロは異常の可能性が高いので通知（RSS取得断や認証切れの検知）
  if [[ "$STREAK" -ge 3 ]]; then
    notify "新規記事が ${STREAK} 回連続でゼロです。RSS取得や認証を確認してください。"
  fi
else
  STREAK=0
fi
echo "$STREAK" > "$HEALTH_FILE"

# --- ソース変更ガード ---
# 作業途中の src/templates 等のコードが、無人ジョブに巻き込まれて自動公開される事故を防ぐ。
# 生成物・data/ は対象外。ソース系に未コミット変更があれば commit/push をスキップする。
SRC_DIRTY="$(git status --porcelain -- src templates scripts prompts package.json package-lock.json 2>/dev/null)"
if [[ -n "$SRC_DIRTY" ]]; then
  echo "WARN: ソースに未コミット変更があるため自動コミットを中止します:"
  echo "$SRC_DIRTY"
  notify "ソースに未コミット変更があるため自動コミットを中止しました。手動で整理してください。"
# 本番(Vercel)へ自動反映: 変更があれば commit & push。push すると Vercel が自動デプロイ。
elif [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
  echo "変更を検出 → git push（Vercel 自動デプロイ）"
  git add -A
  git commit -q -m "auto: $(date '+%Y-%m-%d %H:%M') 記事を更新

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  if git push -q origin main; then
    echo "push 完了"
  else
    echo "WARN: push 失敗（認証/ネットワークを確認）"
    notify "git push に失敗しました。Vercel に反映されていません。"
  fi
else
  echo "変更なし（push スキップ）"
fi

echo "===== $(date '+%Y-%m-%d %H:%M:%S') 終了 (exit=$rc) ====="
exit $rc
