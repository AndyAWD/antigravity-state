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
    env: { ...process.env, AGY_PROJECT_DIR: '', GEMINI_PROJECT_DIR: '', ...env },
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

test('inject：CLI 模式有 STATE.md 時印前導與全文', () => {
  const dir = tmpWorkspace(VALID);
  const r = run(['inject'], { env: { AGY_PROJECT_DIR: dir } });
  assert.equal(r.code, 0);
  assert.match(r.out, /=== STATE\.md/);
  assert.match(r.out, /\[>\] 進行中/);
  assert.ok(r.out.includes('## 下一步'));
  assert.ok(r.out.includes('issue #4412'));
});

test('inject：CLI 模式無 STATE.md 時無輸出，exit 0', () => {
  const dir = tmpWorkspace(null);
  const r = run(['inject'], { env: { AGY_PROJECT_DIR: dir } });
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
});

test('inject：PreInvocation hook 傳入 agy JSON 時輸出 injectSteps 契約', () => {
  const dir = tmpWorkspace(VALID);
  const payload = {
    conversationId: 'test-conv-123',
    workspacePaths: [dir],
    invocationNum: 1,
  };
  const r = run(['inject'], { input: JSON.stringify(payload) });
  assert.equal(r.code, 0);
  const out = JSON.parse(r.out);
  assert.ok(Array.isArray(out.injectSteps));
  assert.equal(out.injectSteps.length, 1);
  assert.match(out.injectSteps[0].ephemeralMessage, /=== STATE\.md/);
});

test('inject：PreInvocation hook 非首輪（invocationNum > 1）時靜默', () => {
  const dir = tmpWorkspace(VALID);
  const payload = {
    conversationId: 'test-conv-123',
    workspacePaths: [dir],
    invocationNum: 2,
  };
  const r = run(['inject'], { input: JSON.stringify(payload) });
  assert.equal(r.code, 0);
  const out = JSON.parse(r.out);
  assert.deepEqual(out.injectSteps, []);
});

test('inject：PreInvocation hook 無 STATE.md 時輸出空 injectSteps', () => {
  const dir = tmpWorkspace(null);
  const payload = {
    conversationId: 'test-conv-123',
    workspacePaths: [dir],
    invocationNum: 1,
  };
  const r = run(['inject'], { input: JSON.stringify(payload) });
  assert.equal(r.code, 0);
  const out = JSON.parse(r.out);
  assert.deepEqual(out.injectSteps, []);
});

// ---------- stop-guard ----------

test('stop-guard：Stop hook 有 [>] 且 executionNum 為 1 時回傳 continue 阻止結束', () => {
  const dir = tmpWorkspace(VALID);
  const payload = {
    conversationId: 'test-conv-123',
    workspacePaths: [dir],
    executionNum: 1,
  };
  const r = run(['stop-guard'], { input: JSON.stringify(payload) });
  assert.equal(r.code, 0);
  const out = JSON.parse(r.out);
  assert.equal(out.decision, 'continue');
  assert.match(out.reason, /進行中子目標/);
  assert.match(out.reason, /補跳脫雙引號測試案例/);
  assert.match(out.reason, /\/agy-state/);
});

test('stop-guard：Stop hook 續跑時（executionNum > 1）放行，避免無窮迴圈', () => {
  const dir = tmpWorkspace(VALID);
  const payload = {
    conversationId: 'test-conv-123',
    workspacePaths: [dir],
    executionNum: 2,
  };
  const r = run(['stop-guard'], { input: JSON.stringify(payload) });
  assert.equal(r.code, 0);
  const out = JSON.parse(r.out);
  assert.equal(out.decision, 'allow');
});

test('stop-guard：Stop hook 沒有 [>] 或無檔案時放行', () => {
  const noProg = tmpWorkspace(withReplaced('- [>] 補跳脫', '- [ ] 補跳脫'));
  const r1 = run(['stop-guard'], { input: JSON.stringify({ conversationId: 'c1', workspacePaths: [noProg], executionNum: 1 }) });
  assert.equal(r1.code, 0);
  assert.equal(JSON.parse(r1.out).decision, 'allow');

  const noFile = tmpWorkspace(null);
  const r2 = run(['stop-guard'], { input: JSON.stringify({ conversationId: 'c2', workspacePaths: [noFile], executionNum: 1 }) });
  assert.equal(r2.code, 0);
  assert.equal(JSON.parse(r2.out).decision, 'allow');
});

test('stop-guard：CLI 模式有 [>] 時 exit 2，stderr 含提示', () => {
  const dir = tmpWorkspace(VALID);
  const r = run(['stop-guard'], { env: { AGY_PROJECT_DIR: dir }, input: '' });
  assert.equal(r.code, 2);
  assert.match(r.err, /進行中子目標/);
  assert.match(r.err, /\/agy-state/);
});

test('stop-guard：CLI 模式無 [>] 或無檔案時 exit 0', () => {
  const noProg = tmpWorkspace(withReplaced('- [>] 補跳脫', '- [ ] 補跳脫'));
  assert.equal(run(['stop-guard'], { env: { AGY_PROJECT_DIR: noProg }, input: '' }).code, 0);
  const noFile = tmpWorkspace(null);
  assert.equal(run(['stop-guard'], { env: { AGY_PROJECT_DIR: noFile }, input: '' }).code, 0);
});

// ---------- 其他 ----------

test('未知子指令 exit 64 並印用法', () => {
  const r = run(['bogus']);
  assert.equal(r.code, 64);
  assert.match(r.err, /用法/);
});
