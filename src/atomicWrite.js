// ファイルを「壊れた中間状態を他のプロセスに見せずに」置き換える。依存ゼロの葉モジュール。
//
// 素の writeFile は O_TRUNC で開くため、書き込みが終わるまでファイルは不正な状態になる。
// これは「クラッシュしたとき」だけの問題ではない——正常時でも、書いている最中に
// 読み手（count_articles / npm run check / 別スクリプト）が中途半端な JSON を読める。
// 同一ディレクトリに一時ファイルを書いてから rename すると、POSIX では置き換えが原子的なので
// 読み手は必ず「前の完全な内容」か「後の完全な内容」のどちらかを見る。
//
// 一時ファイル名に PID を入れるのは、固定名だと並行実行時に両者が同じ temp を掴み、
// rename によって「壊れた JSON」ではなく「片方の世界」が静かに確定してしまうため
// （壊れていれば loadArticles が throw して気づけるのに、静かな取り違えは気づけない）。
// data/*.tmp は .gitignore 済み——残骸が git add -A で本番へ push されるのを防ぐ。
import { writeFile, rename, unlink } from 'node:fs/promises';

export async function atomicWrite(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, data, 'utf8');
    await rename(tmp, file); // 同一ディレクトリ＝同一FS なので原子的
  } catch (err) {
    // 失敗時の掃除はベストエフォート（SIGKILL や電源断では動かない。だから .gitignore が本命）。
    try { await unlink(tmp); } catch { /* noop */ }
    throw err;
  }
}
