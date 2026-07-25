// Slack 通知 — 自動ジョブの結果と異常を Slack へ送る。
// 追加依存なし（Node 組み込みの fetch のみ）。
//
// なぜ必要か: 従来の通知は macOS のバナー（osascript）だけで、数秒で消え集中モードでも抑制される。
// 実際に認証切れの通知が4回出ていたのに気づけず、3日間サイトが更新されない事故が起きた
// （2026-07-22〜25）。「見に行けば分かる」ではなく「向こうから届く」経路を1本用意する。
//
// 使い方（auto-generate.sh から）:
//   node src/notifySlack.js "本文" [--level error|warn|info]
// SLACK_WEBHOOK_URL が未設定なら**何もせず正常終了**する（設定していない環境で日次を壊さない）。
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';

const LEVEL_PREFIX = {
  error: ':rotating_light: ',
  warn: ':warning: ',
  info: '',
};

export async function notifySlack(text, level = 'info') {
  const url = config.slack?.webhookUrl;
  if (!url || !String(text || '').trim()) return false;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.slack.timeoutMs ?? 5000);
  try {
    const body = JSON.stringify({
      text: `${LEVEL_PREFIX[level] ?? ''}*${config.siteName} 自動ジョブ*\n${text}`,
    });
    const res = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    return res.ok;
  } catch {
    return false; // ネットワーク断・タイムアウト。通知の失敗で日次を止めない
  } finally {
    clearTimeout(timer);
  }
}

// CLI: 第1引数を本文として送る。--level で見出しの記号を変える。
// 終了コードは常に 0（通知の成否で auto-generate.sh を止めないため）。
// パスに日本語を含むため file:// の単純結合では一致しない。pathToFileURL で正規化する
// （qualityDigest.js / evaluate.js と同じ判定方法）。
const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isMain) {
  const args = process.argv.slice(2);
  const li = args.indexOf('--level');
  const level = li >= 0 ? args[li + 1] : 'info';
  const text = args.filter((a, i) => i !== li && i !== li + 1).join(' ');
  await notifySlack(text, level);
  process.exit(0);
}
