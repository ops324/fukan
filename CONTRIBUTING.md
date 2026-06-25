# コントリビューションガイド（手動開発フロー）

俯瞰（FUKAN）への**手動の変更はPRベース**で行う。詳細な開発ルールは [CLAUDE.md](CLAUDE.md) / [SPEC.md](SPEC.md) を参照。ここでは手順だけを短くまとめる。

> **前提**: このリポジトリは **`main` への push がそのまま Vercel 本番デプロイ**になる。壊れたコード・データはそのまま公開事故になる。

## 手動開発の手順（PRベース）

1. **作業ブランチを切る**
   ```
   git switch -c work/<topic>
   ```
   `main` に直接コミットしてよいのは **記事内容・軽微な文言・ドキュメントの微修正**のみ。コード改善・機能追加・リスクのある変更は必ずブランチで行う。

2. **実装する**（周囲のコードのスタイルに合わせる。設定は `src/config.js` に集約）

3. **ローカルで検証する**
   ```
   npm run check     # 公開前ゲート（必須・緑になること）
   npm run serve     # 主要ページの目視確認（任意・推奨）
   ```

4. **push して PR を作成する**
   ```
   git push -u origin work/<topic>
   gh pr create --fill
   ```

5. **CI（`check`）の緑を確認してマージする**
   PR を作ると GitHub Actions の `check`（= `npm run check`）が自動で走る。**緑を確認してから**マージする。**マージした瞬間に本番反映**される。

### コミットメッセージ
- プレフィックス: `feat / fix / docs / chore / refactor`
- フッターに以下を付ける:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

## なぜブランチに置くのか（このリポジトリ固有の理由）

自動ジョブ（後述）の `git push origin main` は **`main` 上の未 push コミットをまとめて送る**。
そのため「WIP を `main` にコミットだけして push しない」は安全ではなく、**次の自動実行が本番へ出してしまう**。
WIP を作業ブランチに置けば `main` の外に居るため、自動ジョブに拾われない。

## 自動ジョブとの関係

- 自動ジョブ（launchd・1日3回 6/12/18時 `scripts/auto-generate.sh`）は、サブスク内の Claude Code CLI で記事を生成し、**`main` へ直接 push** して公開する（PR を経由しない）。
- CI ワークフロー（`.github/workflows/check.yml`）は **`pull_request` 時のみ**走る。自動ジョブの直 push では走らない（無駄な実行と自動公開のブロックを避けるため）。
- **`main` にはブランチ保護をかけていない。** ハード保護で直 push を禁止すると自動公開が止まるため。手動側の品質は、この PR フローと CI で担保する（将来、自動ジョブに専用 bot ID を与えれば、保護と両立できる）。
