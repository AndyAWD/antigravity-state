#!/usr/bin/env node
/**
 * state-check.mjs ── STATE.md 驗證與 hook 處理器
 *
 * 子指令：
 *   check [path]        驗證 STATE.md 不變量。0 通過／1 違規／無檔案時 0 並提示
 *   in-progress [path]  印出「下一步」的 [>] 項目。0 有／1 無或無檔案
 *   inject              PreInvocation hook 用：印前導指示與 STATE.md 全文（支援 agy JSON 與 CLI 輸出）
 *   stop-guard          Stop hook 用：讀 stdin JSON，有 [>] 且未曾續跑（executionNum <= 1）時阻止結束
 *
 * 專案根目錄解析順序：明確路徑參數 > AGY_PROJECT_DIR > GEMINI_PROJECT_DIR > stdin 的 workspacePaths/cwd > 向上找 STATE.md 或 .git
 * Node 18+，零依賴。
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const SECTIONS = ['目標', '已完成', '已變更檔案', '待解決', '關鍵資料（原樣保留）', '已試過但失敗', '下一步'];
export const KEY_SECTION = '關鍵資料（原樣保留）';
export const LINE_LIMIT = 5;
export const KEY_ITEM_LIMIT = 5;

const TITLE_RE = /^# 任務狀態 ── 最後更新 \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
const ITEM_RE = /^\s*-\s\[( |>|!|x)\]\s+(.*)$/;
const BULLET_RE = /^\s*[-*]\s/;

export const INJECT_HEADER = [
  '=== STATE.md（專案任務狀態）===',
  '以下為上個 session 存檔。從「下一步」第 1 項開始，不重新探索專案；使用者當前指示優先，STATE.md 與工作區現況矛盾時以現況為準並執行 /agy-state 更新。標記：[>] 進行中、[ ] 待辦、[!] 受阻。',
].join('\n');

/** 解析專案根目錄 */
export function resolveWorkspace(customPath, fallbackCwd) {
  if (customPath) return path.resolve(customPath);
  if (process.env.AGY_PROJECT_DIR) return path.resolve(process.env.AGY_PROJECT_DIR);
  if (process.env.GEMINI_PROJECT_DIR) return path.resolve(process.env.GEMINI_PROJECT_DIR);
  let current = fallbackCwd ? path.resolve(fallbackCwd) : process.cwd();
  while (current) {
    if (fs.existsSync(path.join(current, 'STATE.md')) || fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return fallbackCwd ? path.resolve(fallbackCwd) : process.cwd();
}

export function statePath(workspace) {
  return path.join(workspace, 'STATE.md');
}

/** 解析為 { title, order, sections }；sections 只保留非空白行 */
export function parseState(text) {
  let title = null;
  const order = [];
  const sections = {};
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (title === null && line.startsWith('# ')) {
      title = line;
      continue;
    }
    const m = line.match(/^## (.+)$/);
    if (m) {
      current = m[1].trim();
      order.push(current);
      sections[current] = [];
      continue;
    }
    if (current && line.trim() !== '') sections[current].push(line);
  }
  return { title, order, sections };
}

/** 回傳違規訊息陣列；空陣列表示通過 */
export function validate(text) {
  const errors = [];
  const { title, order, sections } = parseState(text);

  if (!title || !TITLE_RE.test(title)) {
    errors.push('標題行須為「# 任務狀態 ── 最後更新 YYYY-MM-DD HH:mm」');
  }
  if (order.join('\n') !== SECTIONS.join('\n')) {
    errors.push(`段落須恰為七段且順序固定：${SECTIONS.join('、')}；實際：${order.join('、') || '（無）'}`);
  }

  for (const name of SECTIONS) {
    const lines = sections[name];
    if (!lines) continue;
    if (name === KEY_SECTION) {
      const items = lines.filter((l) => BULLET_RE.test(l)).length;
      if (items > KEY_ITEM_LIMIT) errors.push(`「${KEY_SECTION}」最多 ${KEY_ITEM_LIMIT} 項，實際 ${items} 項`);
    } else if (lines.length > LINE_LIMIT) {
      errors.push(`「${name}」最多 ${LINE_LIMIT} 行，實際 ${lines.length} 行`);
    }
  }

  for (const line of sections['已完成'] || []) {
    const m = line.match(ITEM_RE);
    if (!m || m[1] !== 'x') errors.push(`「已完成」每項須以「- [x] 」開頭：${line.trim()}`);
    else if (!line.includes('｜驗證：')) errors.push(`「已完成」項目缺「｜驗證：」：${line.trim()}`);
  }

  let inProgress = 0;
  for (const line of sections['下一步'] || []) {
    const m = line.match(ITEM_RE);
    if (!m) {
      errors.push(`「下一步」每項須以「- [ ] 」「- [>] 」或「- [!] 」開頭：${line.trim()}`);
      continue;
    }
    if (m[1] === 'x') errors.push(`「下一步」不得含 [x]，已完成項目請移到「已完成」：${line.trim()}`);
    if (m[1] === '>') inProgress += 1;
    if (m[1] === '!' && !line.includes('｜原因：')) errors.push(`受阻項目缺「｜原因：」：${line.trim()}`);
  }
  if (inProgress > 1) errors.push(`「下一步」最多一個 [>] 進行中項目，實際 ${inProgress} 個`);

  return errors;
}

/** 「下一步」中 [>] 項目的文字（去掉標記） */
export function inProgressItems(text) {
  return (parseState(text).sections['下一步'] || [])
    .map((l) => l.match(ITEM_RE))
    .filter((m) => m && m[1] === '>')
    .map((m) => m[2].trim());
}

/** 「下一步」為空即目標完成 */
export function isGoalDone(text) {
  return (parseState(text).sections['下一步'] || []).length === 0;
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
  });
}

function readStateFile(workspace) {
  const file = statePath(workspace);
  if (!fs.existsSync(file)) return { file, exists: false, text: '' };
  return { file, exists: true, text: fs.readFileSync(file, 'utf8') };
}

export async function main(argv) {
  const [cmd, arg] = argv;

  switch (cmd) {
    case 'check': {
      const { file, exists, text } = readStateFile(resolveWorkspace(arg));
      if (!exists) {
        console.log(`無 STATE.md：${file}`);
        return 0;
      }
      const errors = validate(text);
      if (errors.length) {
        console.log(`STATE.md 驗證失敗（${errors.length} 項）：${file}`);
        for (const e of errors) console.log(`- ${e}`);
        return 1;
      }
      console.log(`STATE.md 驗證通過：${file}`);
      return 0;
    }

    case 'in-progress': {
      const { exists, text } = readStateFile(resolveWorkspace(arg));
      if (!exists) return 1;
      const items = inProgressItems(text);
      if (!items.length) return 1;
      for (const i of items) console.log(i);
      return 0;
    }

    case 'inject': {
      let payload = {};
      try {
        const raw = await readStdin();
        payload = raw.trim() ? JSON.parse(raw) : {};
      } catch {
        payload = {};
      }
      const workspacePath = payload?.workspacePaths?.[0] || payload?.cwd;
      const { exists, text } = readStateFile(resolveWorkspace(arg, workspacePath));
      const isAgyHook = Boolean(
        payload.conversationId ||
        payload.workspacePaths ||
        typeof payload.invocationNum === 'number'
      );

      if (isAgyHook) {
        if (typeof payload.invocationNum === 'number' && payload.invocationNum > 1) {
          process.stdout.write(JSON.stringify({ injectSteps: [] }) + '\n');
          return 0;
        }
        if (!exists) {
          process.stdout.write(JSON.stringify({ injectSteps: [] }) + '\n');
          return 0;
        }
        const message = `${INJECT_HEADER}\n\n${text.endsWith('\n') ? text : `${text}\n`}`;
        process.stdout.write(JSON.stringify({
          injectSteps: [
            {
              ephemeralMessage: message,
            },
          ],
        }) + '\n');
        return 0;
      }

      if (!exists) return 0;
      process.stdout.write(`${INJECT_HEADER}\n\n${text.endsWith('\n') ? text : `${text}\n`}`);
      return 0;
    }

    case 'stop-guard': {
      let payload = {};
      try {
        const raw = await readStdin();
        payload = raw.trim() ? JSON.parse(raw) : {};
      } catch {
        payload = {};
      }
      const isAgyHook = Boolean(
        payload.conversationId ||
        payload.workspacePaths ||
        typeof payload.executionNum === 'number'
      );
      const workspacePath = payload?.workspacePaths?.[0] || payload?.cwd;
      const { exists, text } = readStateFile(resolveWorkspace(arg, workspacePath));

      if (isAgyHook) {
        if (typeof payload.executionNum === 'number' && payload.executionNum > 1) {
          process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\n');
          return 0;
        }
        if (!exists) {
          process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\n');
          return 0;
        }
        const items = inProgressItems(text);
        if (!items.length) {
          process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\n');
          return 0;
        }
        const reason = `STATE.md 有進行中子目標：「${items[0]}」。結束前擇一處理後執行 /agy-state：已完成則移到「已完成」並附「｜驗證：」；要暫停則改回 [ ]；受阻改為 [!] 並附「｜原因：」。`;
        process.stdout.write(JSON.stringify({
          decision: 'continue',
          reason,
        }) + '\n');
        return 0;
      }

      const items = exists ? inProgressItems(text) : [];
      if (!exists || !items.length) return 0;
      process.stderr.write(
        `STATE.md 有進行中子目標：「${items[0]}」。結束前擇一處理後執行 /agy-state：已完成則移到「已完成」並附「｜驗證：」；要暫停則改回 [ ]；受阻改為 [!] 並附「｜原因：」。\n`,
      );
      return 2;
    }

    default:
      process.stderr.write('用法: node state-check.mjs <check|in-progress|inject|stop-guard> [path]\n');
      return 64;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
