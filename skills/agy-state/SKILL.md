---
name: agy-state
description: Use when 使用者說「存檔」「更新狀態」「save state」，或完成一個子目標／里程碑，或使用者表示要 /clear、/compact、切換模型之前，或 Stop hook 提示 STATE.md 有進行中子目標時。用於把多步驟任務的當前狀態寫入專案根目錄的 STATE.md。純問答或單輪任務不使用。
---

# agy-state

## 目標

把當前任務狀態寫入 `<專案根目錄>/STATE.md`，讓下一個 session（PreInvocation hook 會自動注入此檔）能從「下一步」第 1 項直接接續，不重新探索專案。寫完必須通過 `state-check.mjs check` 驗證。

## 執行步驟

1. 取專案根目錄：`git rev-parse --show-toplevel`；不是 git repo 時用當前工作目錄。
2. 取時間：`date '+%Y-%m-%d %H:%M'`，寫入標題行。
3. 對照現況：`git status --porcelain` 的結果與對話中的認知不一致時，以 `git status` 為準。
4. 讀取既有 `STATE.md`。存在則只改有變動的段落，其餘段落原字保留；不存在則依下方範本建立。
5. 更新子目標標記：剛完成且已跑過驗證的 `[>]` 項目移到「已完成」改為 `[x]` 並附「｜驗證：」；接著要做的一項標 `[>]`；卡住的標 `[!]` 並附「｜原因：」。
6. 執行驗證：`node ~/.gemini/antigravity-cli/skills/agy-state/scripts/state-check.mjs check`。有違規逐條修正後再跑，直到 exit 0。
7. 「下一步」已無任何項目時代表目標完成：`mkdir -p ~/.gemini/state-archive`，把 STATE.md 移到 `~/.gemini/state-archive/<專案目錄名>-YYYYMMDD-HHmm.md`，刪除原檔，回覆「目標完成，STATE.md 已歸檔至 <路徑>」，結束。
8. 首次建立且為 git repo 時，確認 `.git/info/exclude` 含 `/STATE.md`，沒有就加一行。
9. 回覆一行：`已更新 STATE.md（變更段落：目標、下一步）驗證通過`，列出實際改動的段落名稱。使用者若表示要 /clear、/compact 或切換模型，補一句「可以執行了」。

## STATE.md 範本（七段，順序固定，不增不減）

```markdown
# 任務狀態 ── 最後更新 YYYY-MM-DD HH:mm

## 目標
[一到兩行：要達成什麼，含 issue／work item 編號]

## 已完成
- [x] [子目標]｜驗證：[執行過的指令與結果，一行]

## 已變更檔案
- M [相對路徑]（來自 git status，M 修改／A 新增／D 刪除）

## 待解決
- [阻擋進度的問題，每項一行]

## 關鍵資料（原樣保留）
- [最多 5 項：識別碼、路徑、指令、錯誤訊息，逐字照抄不摘要]

## 已試過但失敗
- [方法]：[失敗原因]

## 下一步
- [>] [正在做的一項，含驗證方式]
- [ ] [待辦]
- [!] [受阻項目]｜原因：[原因]
```

## 標記語法與不變量（state-check.mjs 強制）

| 標記 | 意義 | 規則 |
|------|------|------|
| `[ ]` | 待辦 | 只在「下一步」 |
| `[>]` | 進行中 | 只在「下一步」，同時最多一個 |
| `[!]` | 受阻 | 只在「下一步」，必附「｜原因：」 |
| `[x]` | 已完成 | 只在「已完成」，必附「｜驗證：」；沒跑過驗證不得標 |

- 七段標題齊全、順序固定；標題行時間格式 `YYYY-MM-DD HH:mm`，來自 `date` 指令。
- 除「關鍵資料」外每段最多 5 行；「關鍵資料」最多 5 項，每項可多行原文。
- 「已完成」只留影響下一步判斷的項目，其餘刪除。
- 段落內用單層清單，不放程式碼區塊、不貼對話原文與推理過程。
- 存檔時若發現摘要與磁碟不一致（例如測試檔缺 import），寫進「待解決」一行即可，不在此時修正程式。
- 檔名固定 `STATE.md`，放專案根目錄；其他名稱 hook 不會注入。

## 範例

情境：改 `src/parser.py` 處理帶引號 CSV，parse() 已改完並跑過測試，正在補測試案例。

```markdown
# 任務狀態 ── 最後更新 2026-09-09 14:32

## 目標
issue #4412：讓 src/parser.py 的 parse() 正確處理帶引號的 CSV 欄位

## 已完成
- [x] parse() 改用 csv 模組｜驗證：cd src && python3 -m pytest . 2 passed

## 已變更檔案
- M src/parser.py
- A src/test_parser.py

## 待解決
- 在專案根目錄跑 pytest 會載入 Python 內建 parser 模組，需在 src/ 下執行

## 關鍵資料（原樣保留）
- 錯誤：ImportError: cannot import name 'parse' from 'parser'
- 可用的測試指令：cd src && python3 -m pytest .

## 已試過但失敗
- split(",") 加正則切欄：欄位內含換行時失敗

## 下一步
- [>] 補跳脫雙引號（""）測試案例，於 src/ 下跑 python3 -m pytest . 三個通過
- [ ] commit 全部變更（README.md、src/parser.py、src/test_parser.py）
- [!] 開 PR 到 develop，標題含 #4412｜原因：等 #4410 先合併
```
