#!/bin/zsh
# AXIOM AI — launchd から定期実行されるヘッドレス Claude Code 執筆ジョブ。
# Claude 自身が WebFetch / WebSearch で取材し、忠実な記事を書いてサイトに反映する。
# （翡翠眼方式: API キー不要・Anthropic サブスク内で完結）
set -u

PROJECT_DIR="/Users/takimototetsuya/AIニュースサイト"
CLAUDE_BIN="/Users/takimototetsuya/.local/bin/claude"
PROMPT_FILE="$PROJECT_DIR/prompts/generate-articles.md"

cd "$PROJECT_DIR" || exit 1

NODE_BIN="/usr/local/bin/node"
HEALTH_FILE="$PROJECT_DIR/data/.health"

# macOS 通知ヘルパー（失敗時に気づけるように）
notify() {
  /usr/bin/osascript -e "display notification \"$1\" with title \"AXIOM AI\" sound name \"Basso\"" 2>/dev/null || true
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

BEFORE_COUNT="$(count_articles)"

# ヘッドレス実行。プロンプトに従い fetchCandidates → 取材執筆 → ingestDrafts まで自走する。
# 注: zsh では $status は読み取り専用（$? の別名）。別名 rc を使う。
"$CLAUDE_BIN" --dangerously-skip-permissions -p "$(cat "$PROMPT_FILE")"
rc=$?

# claude の -p 出力は要約として不確実なため、結果を決定的にログへ残す。
/usr/local/bin/node -e 'const a=require("./data/articles.json");console.log("現在の総記事数: "+a.length);console.log("最新の見出し:");a.slice(0,3).forEach(x=>console.log("  - "+x.slug+" | "+x.headline))' 2>/dev/null

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
  echo "INFO: 新規記事なし（連続 ${STREAK} 回）"
  # 3回連続（=約半日以上）新規ゼロは異常の可能性が高いので通知
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
