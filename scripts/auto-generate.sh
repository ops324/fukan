#!/bin/zsh
# 俯瞰（FUKAN）— launchd から定期実行されるヘッドレス Claude Code 執筆ジョブ。
# Claude 自身が WebFetch / WebSearch で取材し、忠実な記事を書いてサイトに反映する。
# （翡翠眼方式: API キー不要・Anthropic サブスク内で完結）
set -u

PROJECT_DIR="/Users/takimototetsuya/AIニュースサイト"
# 既定は固定パス。環境変数で上書きできるようにしてあるのは異常系（認証失敗）の実地テスト用。
CLAUDE_BIN="${CLAUDE_BIN:-/Users/takimototetsuya/.local/bin/claude}"
PROMPT_FILE="$PROJECT_DIR/prompts/generate-articles.md"
REVIEW_PROMPT_FILE="$PROJECT_DIR/prompts/review-drafts.md"
IMAGE_REVIEW_PROMPT_FILE="$PROJECT_DIR/prompts/review-images.md"
# veto 判定基準の正本。初回査読と再査読の両方へ cat で合成し、片方だけ緩む事故を構造的に防ぐ。
CRITERIA_PROMPT_FILE="$PROJECT_DIR/prompts/_veto-criteria.md"
FIX_PROMPT_FILE="$PROJECT_DIR/prompts/fix-drafts.md"
REVIEW_FIXED_PROMPT_FILE="$PROJECT_DIR/prompts/review-fixed.md"

cd "$PROJECT_DIR" || exit 1

NODE_BIN="/usr/local/bin/node"
HEALTH_FILE="$PROJECT_DIR/data/.health"
# 人間が一目で状況を掴むための状態ファイル（最終成功・直近エラー・連続失敗回数）。
# 通知バナーは集中モード等で抑制され見落とされうるため、消えない形でも残す。gitignore 済み。
STATUS_FILE="$PROJECT_DIR/data/.status"
# ロック競合で連続スキップした回数。沈黙したまま公開が止まるのを防ぐ見張り。
SKIP_FILE="$PROJECT_DIR/data/.lockskip"
# writer 出力の退避先。認証エラーは終了コードに出ない（CLI は 401 でも exit 0 を返す）ため、
# 出力そのものを検査する必要がある。gitignore の *.log でカバーされる。
WRITER_LOG="$PROJECT_DIR/data/_writer.log"
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
  # Slack にも送る。バナーは数秒で消え集中モードでも抑制されるため、認証切れの通知が4回出ていたのに
  # 気づけず3日間停止した事故があった（2026-07-22〜25）。SLACK_WEBHOOK_URL 未設定なら何も起きない。
  "$NODE_BIN" src/notifySlack.js "$1" --level "${2:-error}" >/dev/null 2>&1 || true
}

# 状態ファイルを書く。通知バナーは集中モード等で抑制されうるので、消えない形でも残す。
write_status() {
  {
    echo "最終実行: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "状態:     $1"
    echo "詳細:     $2"
    echo "連続で新規記事ゼロ: ${STREAK:-0} 回"
    echo "（自動生成。ログ全文は data/scheduler.log）"
  } > "$STATUS_FILE" 2>/dev/null || true
}

# 記事総数を返す（取れなければ -1）
count_articles() {
  "$NODE_BIN" -e 'try{console.log(require("./data/articles.json").length)}catch(e){console.log(-1)}' 2>/dev/null
}

# --- ログのローテーション（同一 inode を保つ）---
# launchd が StandardOutPath/StandardErrorPath でこのファイルの fd を掴んだまま走るため、
# `mv` でのローテーションは使えない——launchd はリネーム後の inode に書き続け、
# scheduler.log は次回起動まで再生成されない。`> "$LOG_FILE"` なら同じ inode を
# truncate して書き戻すので fd は生き続ける。自分の出力が出る前に済ませる。
# 実測 6KB/ラン・1日2回＝年5MB 程度なので、通常は何年も発火しない保険。
LOG_FILE="$PROJECT_DIR/data/scheduler.log"
LOG_MAX_BYTES=5242880    # 5MB を超えたら
LOG_KEEP_BYTES=2097152   # 末尾 2MB だけ残す
if [[ -f "$LOG_FILE" ]] && (( $(stat -f%z "$LOG_FILE" 2>/dev/null || echo 0) > LOG_MAX_BYTES )); then
  # 退避名は data/*.tmp（gitignore 済み）にする。残骸が commit されないように。
  if tail -c "$LOG_KEEP_BYTES" "$LOG_FILE" > "$LOG_FILE.tmp" 2>/dev/null; then
    {
      printf '===== %s ログを切り詰めました（これより前の行は破棄） =====\n' "$(date '+%Y-%m-%d %H:%M:%S')"
      cat "$LOG_FILE.tmp"
    } > "$LOG_FILE"
  fi
  rm -f "$LOG_FILE.tmp"
fi

echo "===== $(date '+%Y-%m-%d %H:%M:%S') Claude執筆ジョブ開始 ====="

if [[ ! -x "$CLAUDE_BIN" ]]; then
  echo "ERROR: claude CLI が見つかりません ($CLAUDE_BIN)"
  notify "claude CLI が見つかりません。パイプライン停止中。"
  exit 1
fi

# --- 二重起動防止ロック（stale 安全）---
# クラッシュでロックが残ると両ジョブが無言停止＝記事ゼロになるため、古いロックは再取得する。
# プロセスの開始時刻。PID だけでは同一性を判定できないため併用する。
proc_start() { ps -o lstart= -p "$1" 2>/dev/null | tr -s ' ' | sed 's/^ *//;s/ *$//'; }

# ロック情報: "PID 取得時刻(epoch) プロセス開始時刻"。開始時刻は空白を含むので必ず最後。
write_lock_info() { printf '%s %s %s\n' "$$" "$(date '+%s')" "$(proc_start "$$")" > "$LOCK_DIR/info"; }

# 「ロックを取った本人」が生きているか。開始時刻まで一致して初めて同一とみなす。
# PID だけで見ると、macOS が PID を再利用した瞬間に無関係なプロセスを「実行中」と誤判定し、
# **永久にスキップし続ける**（=公開が止まったまま誰も気づけない）。
proc_alive() {
  local cur
  [[ -n "${1:-}" ]] || return 1
  cur="$(proc_start "$1")"
  [[ -n "$cur" ]] || return 1
  [[ -z "${2:-}" ]] && return 0   # 旧形式のロック（開始時刻なし）は PID だけで判断
  [[ "$cur" == "$2" ]]
}

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    write_lock_info; return 0
  fi
  local pid started lstart age
  if [[ -f "$LOCK_DIR/info" ]]; then
    pid="$(awk '{print $1}' "$LOCK_DIR/info" 2>/dev/null)"
    started="$(awk '{print $2}' "$LOCK_DIR/info" 2>/dev/null)"
    lstart="$(cut -d' ' -f3- "$LOCK_DIR/info" 2>/dev/null | tr -d '\n')"
  fi
  # info が無い/壊れている＝mkdir 直後で書き込み前の可能性がある。「無限に古い」と見なすと
  # 作りかけのロックを奪って二重実行になるため、ディレクトリの mtime を年齢の基準にする。
  [[ "${started:-}" =~ ^[0-9]+$ ]] || started="$(stat -f %m "$LOCK_DIR" 2>/dev/null || echo 0)"
  age=$(( $(date '+%s') - started ))

  # 保持者が分からない（info をまだ書いていない＝mkdir 直後の可能性）。
  # ここで奪うと二重実行になるため、LOCK_MAX_AGE を超えたときだけ残骸とみなす。
  if [[ -z "${pid:-}" ]]; then
    if [[ "$age" -ge "$LOCK_MAX_AGE" ]]; then
      echo "WARN: 保持者不明の古いロック（${age}秒）を再取得します"
      notify "保持者不明の古いロックを再取得しました。前回の自動ジョブが異常終了した可能性があります。"
      rm -rf "$LOCK_DIR"
      mkdir "$LOCK_DIR" 2>/dev/null && { write_lock_info; return 0; }
    fi
    echo "INFO: ロック情報を読めません（作成直後の可能性, age=${age}s）。今回はスキップします。"
    return 1
  fi

  if proc_alive "$pid" "${lstart:-}"; then
    # 生存していても LOCK_MAX_AGE を超えていればハングとみなして奪う。
    if [[ "$age" -ge "$LOCK_MAX_AGE" ]]; then
      echo "WARN: ロック保持プロセス(PID=$pid)が ${age}秒 終了していません。ハングとみなし再取得します"
      notify "前回のジョブが ${age}秒 終了していません。ロックを再取得しました。"
      rm -rf "$LOCK_DIR"
      mkdir "$LOCK_DIR" 2>/dev/null && { write_lock_info; return 0; }
    fi
    echo "INFO: 別のジョブが実行中（ロックあり, PID=$pid 生存, age=${age}s）。今回はスキップします。"
    return 1
  fi

  # 保持プロセスが死んでいる＝書込み中ではないので、年齢を待たずに再取得する。
  # LOCK_MAX_AGE(3600s) を待つ設計だと、異常終了や Ctrl-C の残骸で最大1サイクル
  # （＝12時間・記事2回分）公開が止まる。死んでいるなら待つ理由がない。
  echo "WARN: 残骸のロックを再取得します（PID=${pid:-?} は不在, age=${age}s。前回ジョブの異常終了の可能性）"
  notify "前回の自動ジョブが異常終了した形跡があります（残骸のロックを再取得しました）。" info
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR" 2>/dev/null && { write_lock_info; return 0; }
  echo "INFO: ロックの再取得に失敗しました（他ジョブと競合）。今回はスキップします。"
  return 1
}

if ! acquire_lock; then
  # スキップは従来**完全に沈黙**していた（status も通知も STREAK も残らず exit 0）。
  # ロックが恒常的に残るとその見え方は「3日間停止」（2026-07-22〜25）と区別が付かない。
  LOCK_SKIPS=0
  [[ -f "$SKIP_FILE" ]] && LOCK_SKIPS="$(cat "$SKIP_FILE" 2>/dev/null || echo 0)"
  [[ "$LOCK_SKIPS" =~ ^[0-9]+$ ]] || LOCK_SKIPS=0
  LOCK_SKIPS=$(( LOCK_SKIPS + 1 ))
  echo "$LOCK_SKIPS" > "$SKIP_FILE"
  write_status "ロック競合でスキップ（連続 ${LOCK_SKIPS} 回）" "別のジョブが実行中と判断しました。続くようなら data/.harness.lock を確認してください。"
  if [[ "$LOCK_SKIPS" -ge 2 ]]; then
    notify "自動ジョブが ${LOCK_SKIPS} 回連続でロック競合によりスキップされました。記事が更新されていません。data/.harness.lock を確認してください。"
  fi
  exit 0
fi
rm -f "$SKIP_FILE"
trap 'rm -rf "$LOCK_DIR"' EXIT

BEFORE_COUNT="$(count_articles)"

# 前回ジョブの残骸を掃除（古い下書き/査読を今回の成功と誤認しないため）。
rm -f "$PROJECT_DIR/data/_drafts.json" "$PROJECT_DIR/data/_review.json" \
      "$PROJECT_DIR/data/_image_review_targets.json" "$PROJECT_DIR/data/_image_review.json" \
      "$PROJECT_DIR/data/_drafts.bak.json" "$PROJECT_DIR/data/_fix_targets.json" \
      "$PROJECT_DIR/data/_fix_result.json" "$PROJECT_DIR/data/_review_fixed.json" \
      "$PROJECT_DIR/data/_lint.json" \
      "$WRITER_LOG"

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
# 認証切れ(401)は終了コードに出ない（CLI は失敗しても exit 0 を返す実績あり）ため、
# 出力を検査して立てるフラグ。set -u があるので必ず初期化しておく。
AUTH_FAILED=0
for (( try=1; try<=WRITER_MAX_TRIES; try++ )); do
  echo "writer 実行 (試行 ${try}/${WRITER_MAX_TRIES}, model=$WRITER_MODEL, tools制限/MCP無効)"
  # tee でログに流しつつ退避する（$(...) で丸ごと抱えると数分間ログが無言になり進行が見えない）。
  # 終了コードは pipestatus で writer 自身のものを取る（tee の 0 に潰させない）。
  "$CLAUDE_BIN" --model "$WRITER_MODEL" --fallback-model "$WRITER_FALLBACK_MODEL" \
    --dangerously-skip-permissions --tools "$WRITER_TOOLS" --strict-mcp-config \
    -p "$(cat "$PROMPT_FILE")${DIGEST:+

$DIGEST}" 2>&1 | tee "$WRITER_LOG"
  rc=${pipestatus[1]}
  DRAFT_COUNT="$(drafts_count)"
  if [[ "$rc" -eq 0 && "$DRAFT_COUNT" -gt 0 ]]; then
    echo "writer 成功: 下書き ${DRAFT_COUNT} 件"
    break
  fi
  # 認証切れはリトライしても同じ 401 になるだけ。即中止し、下流で異常として扱わせる。
  # 候補取得は writer 自身が担うため、認証で即死すると候補 0 件になる——これを下の
  # 「新着なし」と取り違えて 6 ラン無言停止した事故がある（2026-07-22〜25）。判定順が要。
  if grep -q "Failed to authenticate" "$WRITER_LOG" 2>/dev/null; then
    AUTH_FAILED=1
    rc=1
    echo "ERROR: claude CLI の認証に失敗しました（401）。リトライせず中止します。"
    break
  fi
  CC="$(candidates_count)"
  if [[ "$CC" -eq 0 ]]; then
    # 認証は生きていて候補も 0 ＝本当に新着が無い日。従来どおり正常終了として扱う。
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
  # --- 決定論リント（writer が §3.6 で自ら実行するのと同じ検査を、ここでも必ず走らせる）---
  # writer が手順を飛ばしても検査が消えないようにするための二重化。判定はしない（警告のみ）。
  # 結果は judge プロンプトへ「確認の起点」として添付し、件数はログ／Slack サマリに出す。
  LINT_TEXT="$("$NODE_BIN" src/lintDrafts.js 2>/dev/null)"
  LINT_COUNT="$("$NODE_BIN" -e 'try{const d=require("./data/_lint.json");process.stdout.write(String(Array.isArray(d)?d.length:0))}catch(e){process.stdout.write("0")}' 2>/dev/null)"
  [[ "$LINT_COUNT" =~ ^[0-9]+$ ]] || LINT_COUNT=0
  echo "下書きリント: 要確認 ${LINT_COUNT} 件"
  if [[ "$LINT_COUNT" -gt 0 ]]; then
    echo "$LINT_TEXT"
    printf '{"ts":"%s","type":"draft_lint","flagged":%s,"drafts":%s}\n' \
      "$(date -u +%FT%TZ)" "$LINT_COUNT" "$(drafts_count)" \
      >> "$PROJECT_DIR/data/quality/incidents.jsonl"
  fi

  # トークン削減: 低リスク（全 draft が primary かつ客観フラグ無し）なら査読を丸ごとスキップ。
  # media 混在 or 客観フラグ有り（=独立検証が最も要る回）のときだけ judge を走らせる。
  NEED_JUDGE="$("$NODE_BIN" src/evaluate.js --triage 2>/dev/null)"
  if [[ "$NEED_JUDGE" == "1" ]]; then
    echo "高リスクの下書きあり → 別モデル($JUDGE_MODEL)で査読（出典照合・採点, tools制限/MCP無効）"
    # リントの指摘は judge へ「確認の起点」として渡す（判定の根拠にはさせない）。
    # 静的解析のレポートをレビュアーに添えるのと同じ位置づけ。空なら何も足さない。
    LINT_NOTE=""
    if [[ "$LINT_COUNT" -gt 0 ]]; then
      LINT_NOTE="## 機械リントの指摘（参考・偽陽性を含む）
下記は出典を読まずに検出した機械的な疑いです。**判定の根拠にはせず、確認の起点にのみ使ってください。**
ここに無いから正しい、という意味でもありません（あなた自身の出典照合が判定の根拠です）。

${LINT_TEXT}"
    fi
    "$CLAUDE_BIN" --model "$JUDGE_MODEL" --dangerously-skip-permissions \
      --tools "$JUDGE_TOOLS" --strict-mcp-config \
      -p "$(cat "$CRITERIA_PROMPT_FILE" "$REVIEW_PROMPT_FILE")${LINT_NOTE:+

$LINT_NOTE}"
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
  # --- 修正リトライ（fixable な veto のみ・1回限り）---
  # veto の大半は「骨子は正しく数値・固有名詞だけが誤り」で、文言の訂正で救える。judge が
  # fixable と判定したものを writer に差し戻し、**初回と同一の基準**で再査読して通れば公開する。
  # 置き場所が要: ingestDrafts が _drafts.json/_review.json を消すので、必ず ingest の前。
  # 失敗しても pass 記事の公開は妨げない（mergeFixReview.js がドラフトを原状復帰させる）。
  # 停止したいときは config.fixRound.enabled=false（prepareFixRound が 0 を返して素通りする）。
  FIX_COUNT="$("$NODE_BIN" src/prepareFixRound.js 2>/dev/null)"
  [[ "$FIX_COUNT" =~ ^[0-9]+$ ]] || FIX_COUNT=0
  if [[ "$FIX_COUNT" -gt 0 ]]; then
    echo "修正リトライ: ${FIX_COUNT} 件を writer に差し戻し（$WRITER_MODEL・出典を再取得して訂正）"
    "$CLAUDE_BIN" --model "$WRITER_MODEL" --fallback-model "$WRITER_FALLBACK_MODEL" \
      --dangerously-skip-permissions --tools "$WRITER_TOOLS" --strict-mcp-config \
      -p "$(cat "$FIX_PROMPT_FILE")" \
      || echo "WARN: 修正が完了しませんでした（元の判定のまま続行）"
    echo "修正分を再査読（$JUDGE_MODEL・判定基準は初回と同一）"
    "$CLAUDE_BIN" --model "$JUDGE_MODEL" --dangerously-skip-permissions \
      --tools "$JUDGE_TOOLS" --strict-mcp-config \
      -p "$(cat "$CRITERIA_PROMPT_FILE" "$REVIEW_FIXED_PROMPT_FILE")" \
      || echo "WARN: 再査読が完了しませんでした（veto 据え置き）"
    "$NODE_BIN" src/mergeFixReview.js \
      || echo "WARN: 修正結果の統合に失敗しました（pass 記事の公開は継続）"
  fi

  echo "取り込み（veto尊重・画像付与・再生成・評価をledgerへ記録）"
  "$NODE_BIN" src/ingestDrafts.js
  irc=$?
  if [[ "$irc" -ne 0 ]]; then
    echo "ERROR: ingestDrafts が失敗 (exit=$irc)"
    notify "取り込みに失敗しました (exit=$irc)。ログを確認してください。"
    rc=$irc
  fi

  # --- 画像一致 LLM 査読（任意・境界スコアのみ）---
  # ingest が境界スコアの新規画像を _image_review_targets.json に書いたときだけ走る
  # （config.imageRelevance.llmReview.enabled=false ならターゲットが無い＝このブロックは丸ごとスキップ）。
  # judge と同じ規律: 失敗しても日次ジョブは止めない。結果は applyImageReview.js が適用・掃除する。
  if [[ -f "$PROJECT_DIR/data/_image_review_targets.json" ]]; then
    echo "境界スコアの画像あり → 別モデル($JUDGE_MODEL)で画像一致を査読（alt照合, tools制限/MCP無効）"
    "$CLAUDE_BIN" --model "$JUDGE_MODEL" --dangerously-skip-permissions \
      --tools "Read Write" --strict-mcp-config -p "$(cat "$IMAGE_REVIEW_PROMPT_FILE")"
    ircv=$?
    if [[ "$ircv" -ne 0 || ! -f "$PROJECT_DIR/data/_image_review.json" ]]; then
      echo "WARN: 画像査読が完了しませんでした (exit=$ircv)。画像はそのまま公開します。"
      printf '{"ts":"%s","type":"image_review_absent","exit":%s}\n' "$(date -u +%FT%TZ)" "$ircv" \
        >> "$PROJECT_DIR/data/quality/incidents.jsonl"
    fi
    # 査読結果があれば swap を適用、無ければ残骸を掃除するだけ（どちらも公開は止めない）。
    "$NODE_BIN" src/applyImageReview.js || echo "WARN: applyImageReview が非0終了。画像はそのまま公開します。"
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

# --- 公開前ゲート（CLAUDE.md §2「npm run check 通過まで push しない」を無人ジョブにも適用）---
# 2026-07-26: タグ 'AR/VR' でレンダーが落ちたのに、push 判定が git 差分しか見ていなかったため
# 描画できない articles.json が本番へ出て、同じ npm run build を走らせる Vercel のデプロイが失敗、
# サイトが半日以上古いまま止まった。check は決定論・オフライン・LLM 不使用なので、
# 「judge / 通知 / 画像査読の故障で日次を止めない」（＝LLM・ネットワーク依存の評価機構）の対象外。
# 止めないのではなく「壊れたものを公開しない」側の仕組みとして働かせる。
#
# ソースが dirty な回は元々 push しないので走らせない（無関係な理由で赤くして警報を出さないため）。
# 判定順の都合でここに前倒しする（本来の使用箇所は下の commit/push チェーン）。
SRC_DIRTY="$(git status --porcelain -- src templates scripts prompts package.json package-lock.json 2>/dev/null)"
PUBLISH_BLOCKED=0
if [[ "$AUTH_FAILED" -eq 0 && -z "$SRC_DIRTY" && -n "$(git status --porcelain 2>/dev/null)" ]]; then
  echo "公開前チェック（node src/check.js）"
  # 出力は品質警告で数百行になる。成功時は要約だけ、失敗時のみ全文をログへ。
  if CHECK_OUT="$("$NODE_BIN" src/check.js 2>&1)"; then
    echo "  ✓ check 通過"
  else
    PUBLISH_BLOCKED=1
    rc=1
    echo "ERROR: 公開前チェックに失敗しました。commit/push を中止します"
    echo "$CHECK_OUT"
    # 通知本文に失敗内容そのものを載せる（認証切れ通知と同じ流儀。見に行かなくても何が起きたか分かる）。
    CHECK_FAILS="$(printf '%s\n' "$CHECK_OUT" | grep -E '^\s+- ' | head -5)"
    notify "公開前チェックに失敗したため push を中止しました。本番は前回の内容のままです。$(printf '\n%s' "$CHECK_FAILS")"
    printf '{"ts":"%s","type":"publish_blocked"}\n' "$(date -u +%FT%TZ)" \
      >> "$PROJECT_DIR/data/quality/incidents.jsonl"

    # ブロック中の記事はワークツリーにしか無く、GitHub にも git の object にも入っていない。
    # しかも案内している復旧手順 `git checkout -- data/articles.json` は**それを破棄する**。
    # 退避ブランチへ commit + push しておけば、捨てる判断をしても後から取り戻せる。
    # Vercel は main しか見ないので本番には影響しない。
    # `git stash create` は作業ツリーも stash スタックも動かさずにコミットオブジェクトだけ作る。
    # それを退避ブランチに指させて push すれば、記事は git の object と GitHub の両方に残る。
    BLOCKED_SHA="$(git stash create 2>/dev/null || true)"
    if [[ -n "$BLOCKED_SHA" ]]; then
      BLOCKED_BRANCH="blocked/$(date '+%Y-%m-%d-%H%M')"
      if git branch -f "$BLOCKED_BRANCH" "$BLOCKED_SHA" >/dev/null 2>&1 \
        && git push -q origin "$BLOCKED_BRANCH" 2>/dev/null; then
        echo "未公開の変更を $BLOCKED_BRANCH へ退避しました（main には影響しないので本番は動きません）"
      else
        echo "WARN: 未公開の変更を退避できませんでした。data/articles.json を消さないでください"
      fi
    fi
  fi
fi

# 連続「無増加」回数を data/.health に記録（増えたらリセット）
STREAK=0
[[ -f "$HEALTH_FILE" ]] && STREAK="$(cat "$HEALTH_FILE" 2>/dev/null || echo 0)"

# 状態ファイル用（set -u があるので必ず初期化）
STATUS_STATE="不明"
STATUS_DETAIL="-"

if [[ "$AUTH_FAILED" -eq 1 ]]; then
  # 認証切れは最優先で分岐する。外形が「新着なし」と同じ（候補0件）ため汎用文言に混ぜると
  # 気づけない——何をすれば直るかを通知本文そのものに書く。
  STREAK=$(( STREAK + 1 ))
  echo "ERROR: claude の認証切れにより記事を更新できませんでした（連続 ${STREAK} 回）"
  notify "認証が切れています。ターミナルで claude を起動し /login してください。記事は更新されていません。"
  printf '{"ts":"%s","type":"auth_failed","streak":%s}\n' "$(date -u +%FT%TZ)" "$STREAK" \
    >> "$PROJECT_DIR/data/quality/incidents.jsonl"
  STATUS_STATE="認証切れ（要対応）"
  STATUS_DETAIL="ターミナルで claude を起動し /login して再認証してください。"
elif [[ "$PUBLISH_BLOCKED" -eq 1 ]]; then
  # 記事はローカルで増えているので、下の ADDED 分岐に落ちると「正常」と報告されてしまう。
  # 実際には本番へ出ていないため専用分岐で先取りする（data/.status と Slack が食い違うのを防ぐ）。
  # STREAK も進める——ADDED>0 でリセットすると、公開が何日止まっても
  # 「3回連続ゼロ」の見張りが永久に発火しない。
  STREAK=$(( STREAK + 1 ))
  echo "ERROR: 公開前チェック失敗により公開をブロックしました（連続 ${STREAK} 回）"
  STATUS_STATE="公開ブロック（check 失敗・要対応）"
  STATUS_DETAIL="記事 ${ADDED} 件はローカルのみ。node src/check.js の指摘を直すか、捨てる場合は git checkout -- data/articles.json。"
elif [[ "$rc" -ne 0 ]]; then
  echo "ERROR: claude 実行が異常終了 (exit=$rc)"
  notify "執筆ジョブが異常終了しました (exit=$rc)。ログを確認してください。"
  STATUS_STATE="異常終了 (exit=$rc)"
  STATUS_DETAIL="data/scheduler.log を確認してください。"
elif [[ "$AFTER_COUNT" -lt 0 ]]; then
  echo "ERROR: articles.json を読めません"
  notify "articles.json を読めません。データ破損の可能性。"
  STATUS_STATE="articles.json 読み込み不可"
  STATUS_DETAIL="データ破損の可能性。data/articles.json を確認してください。"
elif [[ "$ADDED" -le 0 ]]; then
  STREAK=$(( STREAK + 1 ))
  if [[ "$CAND_COUNT" -gt 0 && "$DRAFT_COUNT" -le 0 ]]; then
    # 候補はあったのに writer が 1 本も書けなかった＝writer 失敗。3回待たず即通知。
    echo "ERROR: 候補 ${CAND_COUNT} 件に対し下書き 0 本（writer 失敗の疑い, 連続 ${STREAK} 回）"
    notify "執筆失敗: 候補 ${CAND_COUNT} 件に対し記事 0 本でした。writer を確認してください。"
    STATUS_STATE="writer 失敗の疑い"
    STATUS_DETAIL="候補 ${CAND_COUNT} 件に対し下書き 0 本。data/scheduler.log を確認してください。"
  else
    # 真に新着なし、または下書きは出たが veto/重複で全て公開見送り（品質ゲート作動）＝writer 失敗ではない。
    echo "INFO: 新規記事なし（候補 ${CAND_COUNT}件 / 下書き ${DRAFT_COUNT}件, 連続 ${STREAK} 回）"
    STATUS_STATE="新規記事なし"
    STATUS_DETAIL="候補 ${CAND_COUNT} 件 / 下書き ${DRAFT_COUNT} 件。新着が無いか品質ゲートで全て見送り。"
  fi
  # 3回連続（=約半日以上）新規ゼロは異常の可能性が高いので通知（RSS取得断の検知）。
  # 認証切れは上の専用分岐で通知済みなのでここには来ない（二重通知を避ける）。
  if [[ "$STREAK" -ge 3 ]]; then
    notify "新規記事が ${STREAK} 回連続でゼロです。RSS取得や認証を確認してください。"
  fi
else
  STREAK=0
  STATUS_STATE="正常"
  STATUS_DETAIL="記事を ${ADDED} 件追加しました。"
fi
echo "$STREAK" > "$HEALTH_FILE"
write_status "$STATUS_STATE" "$STATUS_DETAIL"

# --- 実行サマリを Slack へ（生成ログ）---
# 異常時は上の notify() が個別に飛んでいる。ここは「毎回の結果が見える」ようにするためのもので、
# 正常回も送る（config.slack.notifyOnSuccess）。1日2回なので通知過多にはならない。
# 失敗しても日次は止めない。
SUMMARY="状態: ${STATUS_STATE}
記事: ${BEFORE_COUNT} → ${AFTER_COUNT}（追加 ${ADDED} 件）
候補 ${CAND_COUNT} 件 / 下書き ${DRAFT_COUNT} 件"
[[ "${LINT_COUNT:-0}" -gt 0 ]] && SUMMARY="${SUMMARY}
下書きリント: ${LINT_COUNT} 件が要確認"
[[ "${FIX_COUNT:-0}" -gt 0 ]] && SUMMARY="${SUMMARY}
修正リトライ: ${FIX_COUNT} 件を差し戻し"
SUMMARY="${SUMMARY}
${STATUS_DETAIL}"
if [[ "$rc" -eq 0 && "$ADDED" -gt 0 ]]; then
  "$NODE_BIN" src/notifySlack.js "$SUMMARY" --level info >/dev/null 2>&1 || true
fi

# --- ソース変更ガード ---
# 作業途中の src/templates 等のコードが、無人ジョブに巻き込まれて自動公開される事故を防ぐ。
# 生成物・data/ は対象外。ソース系に未コミット変更があれば commit/push をスキップする。
# SRC_DIRTY は公開前ゲートの判定でも使うため、上（記事数チェックの直後）で取得済み。
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
if [[ "$AUTH_FAILED" -eq 1 ]]; then
  # 認証切れ＝記事は 1 本も増えていない。ここで commit すると incidents.jsonl の 1 行だけを抱えた
  # 「記事を更新」コミットが毎ラン積まれ、Vercel が無意味に再デプロイされる（「自動ジョブのコミットは
  # 実質 articles.json の差分のみ」という配信モデルも崩れる）。記録は次の正常ランに相乗りさせる。
  echo "認証切れのため commit/push をスキップします（公開すべき変更なし）"
elif [[ -n "$SRC_DIRTY" ]]; then
  echo "WARN: ソースに未コミット変更があるため自動コミットを中止します:"
  echo "$SRC_DIRTY"
  notify "ソースに未コミット変更があるため自動コミットを中止しました。手動で整理してください。"
elif [[ "$rc" -ne 0 ]]; then
  # 途中の工程が失敗した回は push しない。2026-07-26 はここが git 差分しか見ていなかったため、
  # ingestDrafts の失敗（rc=1）を検知して通知まで出していながら、描画できないデータを本番へ送った。
  # 通知は失敗した工程の側で既に出ているので、ここでは重ねない。
  echo "異常終了 (exit=$rc) のため commit/push をスキップします"
# 本番(Vercel)へ自動反映: 変更があれば commit & push。push すると Vercel が自動デプロイ。
elif [[ "$CURRENT_BRANCH" != "main" ]]; then
  # ブランチを確認せずに commit すると、記事は**作業ブランチ**に積まれ、
  # 直後の `git push origin main` は「ローカル main（＝変更なし）」を送って**成功と報告する**。
  # ログには「push 完了」と出るのに本番には何も出ない、という沈黙した公開失敗になる。
  # CLAUDE.md の「WIP をブランチに置けば自動ジョブに拾われない」は、この経路では成立しない。
  echo "WARN: 現在のブランチが main ではありません（$CURRENT_BRANCH）。commit/push を中止します"
  notify "作業ブランチ（$CURRENT_BRANCH）が checkout されたままのため、記事を公開できませんでした。main に戻してください。"
  rc=1
elif [[ -n "$(git status --porcelain -- data 2>/dev/null)" ]]; then
  echo "変更を検出 → git push（Vercel 自動デプロイ）"
  # 無人ジョブが commit してよいのは data/ だけ、と**許可リストで**限定する。
  # `git add -A` だと vercel.json / .gitignore / .github/ / docs / assets まで巻き込み、
  # 編集途中のまま 18:00 を迎えると本番のビルド設定が自動 push されうる
  # （SRC_DIRTY ガードは src templates scripts prompts package*.json しか見ていない）。
  git add -- data
  git commit -q -m "auto: $(date '+%Y-%m-%d %H:%M') 記事を更新

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  if git push -q origin main; then
    echo "push 完了"
  else
    echo "WARN: push 失敗（認証/ネットワークを確認）"
    notify "git push に失敗しました。Vercel に反映されていません。"
  fi
  # data/ 以外は commit しない。放置に気づけるようログには出す。
  OTHER_DIRTY="$(git status --porcelain 2>/dev/null | grep -v ' data/' || true)"
  if [[ -n "$OTHER_DIRTY" ]]; then
    echo "INFO: data/ 以外の未コミット変更は commit していません:"
    echo "$OTHER_DIRTY"
    # assets/ だけは公開物なので別扱い。手動登録したプレス画像を置いたまま放置すると、
    # articles.json は /assets/press/... を指しているのに実体が push されず**本番で 404** になる。
    if printf '%s\n' "$OTHER_DIRTY" | grep -q 'assets/'; then
      notify "assets/ に未コミットの変更があります。プレス画像なら本番で表示されません。手動で commit してください。"
    fi
  fi
else
  echo "変更なし（push スキップ）"
fi

echo "===== $(date '+%Y-%m-%d %H:%M:%S') 終了 (exit=$rc) ====="
exit $rc
