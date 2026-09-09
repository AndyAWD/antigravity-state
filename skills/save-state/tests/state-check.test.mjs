import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/state-check.mjs');

const VALID = `# 任務狀態 ── 最後更新 2026-09-09 10:00

## 目標
issue #4412：讓 src/parser.py 的 parse() 正確處理帶引號的 CSV 欄位

## 已完成
- [x] parse() 改用 csv 模組｜驗證：cd src && python3 -m pytest . 2 passed

## 已變更檔案
- M src/parser.py
- A src/test_parser.py

## 待解決
- src/test_parser.py 缺 from parser import parse

## 關鍵資料（原樣保留）
- 錯誤：ModuleNotFoundError: No module named 'pytest'
- 多行錯誤：
  Traceback (most recent call last):
    File "x.py", line 1
  ValueError: bad

## 已試過但失敗
- split(",") 加正則切欄：欄位內含換行時失敗

## 下一步
- [>] 補跳脫雙引號測試案例，於 src/ 下跑 python3 -m pytest . 三個通過
- [ ] commit 全部變更
- [!] 開 PR 到 develop｜原因：等 #4410 先合併
`;

function tmpWorkspace(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-check-'));
  if (content !== null) fs.writeFileSync(path.join(dir, 'STATE.md'), content, 'utf8');
  return dir;
}

function run(args, { cwd, input, env } = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
    input,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: '', ...env },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function withReplaced(from, to) {
  assert.ok(VALID.includes(from), `測試樣本缺少片段：${from}`);
  return VALID.replace(from, to);
}

// ---------- check ----------

test('check：合法檔通過，exit 0', () => {
  const dir = tmpWorkspace(VALID);
  const r = run(['check', dir]);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /驗證通過/);
});

test('check：無 STATE.md 時 exit 0 並提示', () => {
  const dir = tmpWorkspace(null);
  const r = run(['check', dir]);
  assert.equal(r.code, 0);
  assert.match(r.out, /無 STATE.md/);
});

test('check：標題時間格式錯誤', () => {
  const dir = tmpWorkspace(withReplaced('2026-09-09 10:00', '2026-09-09'));
  const r = run(['check', dir]);
  assert.equal(r.code, 1);
  assert.match(r.out, /標題行/);
});

test('check：缺段落', () => {
  const dir = tmpWorkspace(withReplaced('## 待解決\n- src/test_parser.py 缺 from parser import parse\n\n', ''));
  const r = run(['check', dir]);
  assert.equal(r.code, 1);
  assert.match(r.out, /七段/);
});

test('check：段落順序錯誤', () => {
  const swapped = VALID
    .replace('## 已完成', '## TMP')
    .replace('## 已變更檔案', '## 已完成')
    .replace('## TMP', '## 已變更檔案');
  const dir = tmpWorkspace(swapped);
  const r = run(['check', dir]);
  assert.equal(r.code, 1);
  assert.match(r.out, /順序/);
});

test('check：兩個 [>] 進行中項目', () => {
  const dir = tmpWorkspace(withReplaced('- [ ] commit 全部變更', '- [>] commit 全部變更'));
  const r = run(['check', dir]);
  assert.equal(r.code, 1);
  assert.match(r.out, /最多一個 \[>\]/);
});

test('check：[x] 缺「｜驗證：」', () => {
  const dir = tmpWorkspace(withReplaced('｜驗證：cd src && python3 -m pytest . 2 passed', ''));
  const r = run(['check', dir]);
  assert.equal(r.code, 1);
  assert.match(r.out, /驗證：/);
});

test('check：[x] 出現在「下一步」', () => {
  const dir = tmpWorkspace(withReplaced('- [ ] commit 全部變更', '- [x] commit 全部變更｜驗證：git log'));
  const r = run(['check', dir]);
  assert.equal(r.code, 1);
  assert.match(r.out, /不得含 \[x\]/);
});

test('check：[!] 缺「｜原因：」', () => {
  const dir = tmpWorkspace(withReplaced('｜原因：等 #4410 先合併', ''));
  const r = run(['check', dir]);
  assert.equal(r.code, 1);
  assert.match(r.out, /原因：/);
});

test('check：一般段落超過 5 行', () => {
  const dir = tmpWorkspace(withReplaced(
    '- M src/parser.py\n- A src/test_parser.py',
    '- M a\n- M b\n- M c\n- M d\n- M e\n- M f',
  ));
  const r = run(['check', dir]);
  assert.equal(r.code, 1);
  assert.match(r.out, /已變更檔案.*5 行/);
});

test('check：關鍵資料可超過 5 行，但不可超過 5 項', () => {
  const okDir = tmpWorkspace(VALID);
  assert.equal(run(['check', okDir]).code, 0, '多行錯誤原文應被允許');
  const sixItems = withReplaced(
    '- 錯誤：ModuleNotFoundError: No module named \'pytest\'',
    '- k1\n- k2\n- k3\n- k4\n- k5\n- k6',
  );
  const badDir = tmpWorkspace(sixItems);
  const r = run(['check', badDir]);
  assert.equal(r.code, 1);
  assert.match(r.out, /關鍵資料.*5 項/);
});

// ---------- in-progress ----------

test('in-progress：有 [>] 時印出項目，exit 0', () => {
  const dir = tmpWorkspace(VALID);
  const r = run(['in-progress', dir]);
  assert.equal(r.code, 0);
  assert.match(r.out, /補跳脫雙引號測試案例/);
  assert.doesNotMatch(r.out, /\[>\]/);
});

test('in-progress：沒有 [>] 或無檔案時 exit 1', () => {
  const noProg = tmpWorkspace(withReplaced('- [>] 補跳脫', '- [ ] 補跳脫'));
  assert.equal(run(['in-progress', noProg]).code, 1);
  const noFile = tmpWorkspace(null);
  assert.equal(run(['in-progress', noFile]).code, 1);
});

// ---------- inject ----------

test('inject：有 STATE.md 時印前導與全文', () => {
  const dir = tmpWorkspace(VALID);
  const r = run(['inject'], { env: { CLAUDE_PROJECT_DIR: dir } });
  assert.equal(r.code, 0);
  assert.match(r.out, /=== STATE\.md/);
  assert.match(r.out, /\[>\] 進行中/);
  assert.ok(r.out.includes('## 下一步'));
  assert.ok(r.out.includes('issue #4412'));
});

test('inject：無 STATE.md 時無輸出，exit 0', () => {
  const dir = tmpWorkspace(null);
  const r = run(['inject'], { env: { CLAUDE_PROJECT_DIR: dir } });
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
});

// ---------- stop-guard ----------

test('stop-guard：有 [>] 且 stop_hook_active 為 false 時 exit 2，stderr 含項目', () => {
  const dir = tmpWorkspace(VALID);
  const r = run(['stop-guard'], { env: { CLAUDE_PROJECT_DIR: dir }, input: JSON.stringify({ stop_hook_active: false, cwd: dir }) });
  assert.equal(r.code, 2);
  assert.match(r.err, /進行中子目標/);
  assert.match(r.err, /補跳脫雙引號測試案例/);
  assert.match(r.err, /\/save-state/);
});

test('stop-guard：stop_hook_active 為 true 時放行', () => {
  const dir = tmpWorkspace(VALID);
  const r = run(['stop-guard'], { env: { CLAUDE_PROJECT_DIR: dir }, input: JSON.stringify({ stop_hook_active: true, cwd: dir }) });
  assert.equal(r.code, 0);
  assert.equal(r.err, '');
});

test('stop-guard：沒有 [>] 或無檔案時放行', () => {
  const noProg = tmpWorkspace(withReplaced('- [>] 補跳脫', '- [ ] 補跳脫'));
  assert.equal(run(['stop-guard'], { env: { CLAUDE_PROJECT_DIR: noProg }, input: '{"stop_hook_active":false}' }).code, 0);
  const noFile = tmpWorkspace(null);
  assert.equal(run(['stop-guard'], { env: { CLAUDE_PROJECT_DIR: noFile }, input: '{"stop_hook_active":false}' }).code, 0);
});

test('stop-guard：stdin 非 JSON 或空白時仍能判斷', () => {
  const dir = tmpWorkspace(VALID);
  assert.equal(run(['stop-guard'], { env: { CLAUDE_PROJECT_DIR: dir }, input: '' }).code, 2);
  assert.equal(run(['stop-guard'], { env: { CLAUDE_PROJECT_DIR: dir }, input: 'not json' }).code, 2);
});

test('stop-guard：無 CLAUDE_PROJECT_DIR 時改用 stdin 的 cwd', () => {
  const dir = tmpWorkspace(VALID);
  const r = run(['stop-guard'], { cwd: os.tmpdir(), input: JSON.stringify({ stop_hook_active: false, cwd: dir }) });
  assert.equal(r.code, 2);
});

// ---------- 其他 ----------

test('未知子指令 exit 64 並印用法', () => {
  const r = run(['bogus']);
  assert.equal(r.code, 64);
  assert.match(r.err, /用法/);
});
