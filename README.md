# STATE.md 狀態管理機制（Claude Code 版）

本儲存庫依據 Badhe, Tiwari, Chung 之論文 *SKILL.state: Scalable Long-Horizon Agent Skills*（[arXiv:2608.26263](https://arxiv.org/abs/2608.26263)），為 Claude Code 提供基於顯式狀態檔案（`STATE.md`）的長程任務管理機制。

核心主張：把長程任務拆成「不可變技能規格（Skill Specification）」與「顯式可變執行狀態（`STATE.md`）」，每步只給模型三樣輸入：規格、當前結構化狀態、最新觀察；中間推論與對話歷史丟棄。狀態以 patch 方式合併，且由 runtime 確定性驗證後才寫入。相較有狀態代理（Stateful Agent），大幅節省權杖（Token）消耗（如論文實驗由 1,062,387 降至 65,408），並提升任務完成準確度。

---

## 1. 核心特性與不變量（Invariants）

### 1.1 七段固定結構

`STATE.md` 必須嚴格按照以下七段順序組織，不可增刪或改變順序：
1. `# 任務狀態 ── 最後更新 YYYY-MM-DD HH:mm`
2. `## 目標`
3. `## 已完成`
4. `## 已變更檔案`
5. `## 待解決`
6. `## 關鍵資料（原樣保留）`
7. `## 已試過但失敗`
8. `## 下一步`

### 1.2 標記語法

| 標記 | 意義 | 允許出現的段落 | 附加要求 |
|------|------|------|------|
| `- [ ] ` | 待辦 | 下一步 | 無 |
| `- [>] ` | 進行中 | 下一步 | 同時最多一個 |
| `- [!] ` | 受阻 | 下一步 | 必含「｜原因：」 |
| `- [x] ` | 已完成 | 已完成 | 必含「｜驗證：」（指令與結果一行） |

分隔符採用全形直線「｜」（U+FF5C）。

### 1.3 運行時（Runtime）不變量強制驗證

1. 標題行符合 `# 任務狀態 ── 最後更新 YYYY-MM-DD HH:mm`；七段標題齊全且順序正確。
2. 「下一步」最多一個 `[>]`；不得含 `[x]`。
3. 「已完成」每項以 `- [x] ` 開頭且含 `｜驗證：`；「下一步」的 `[!]` 含 `｜原因：`。
4. 除「關鍵資料」外每段非空白行最多 5 行；「關鍵資料」最多 5 個項目（以 `- ` 起頭計），每項可多行。
5. 「下一步」無任何項目即目標完成，技能自動歸檔至 `~/.claude/state-archive/<專案名稱>-YYYYMMDD-HHmm.md` 並刪除 `STATE.md`。

---

## 2. 檔案清單與目錄結構

```
agy-state/
├── hooks/
│   └── hooks.json                               # Plugin 版掛鉤設定（SessionStart 與 Stop）
├── skills/
│   └── save-state/
│       ├── SKILL.md                             # 技能規格說明檔
│       ├── scripts/
│       │   └── state-check.mjs                  # 狀態驗證與掛鉤處理腳本
│       └── tests/
│           └── state-check.test.mjs             # 21 個自動化單元測試
├── settings-hook-snippet.json                   # 本機版 settings.json 掛鉤設定片段
├── 實作書.md                                     # 完整規格與實作依據文件
└── README.md                                    # 專案說明與安裝手冊
```

---

## 3. 安裝與設定步驟

### 3.1 本機技能（Local Skill）安裝

1. **部署技能檔案**：
   將 `skills/save-state/` 目錄複製到 Claude Code 技能目錄：
   ```bash
   mkdir -p ~/.claude/skills/save-state
   cp -r skills/save-state/* ~/.claude/skills/save-state/
   chmod +x ~/.claude/skills/save-state/scripts/state-check.mjs
   ```

2. **執行單元測試**：
   驗證腳本與環境行為，確認 21 項測試全數通過：
   ```bash
   node --test ~/.claude/skills/save-state/tests/state-check.test.mjs
   ```

3. **註冊掛鉤（Hooks）**：
   將 `settings-hook-snippet.json` 內的 `SessionStart` 與 `Stop` 掛鉤合併至 `~/.claude/settings.json`：
   ```json
   {
     "hooks": {
       "SessionStart": [
         {
           "matcher": "startup|clear|compact",
           "hooks": [
             {
               "type": "command",
               "command": "node \"$HOME/.claude/skills/save-state/scripts/state-check.mjs\" inject",
               "timeout": 5
             }
           ]
         }
       ],
       "Stop": [
         {
           "hooks": [
             {
               "type": "command",
               "command": "node \"$HOME/.claude/skills/save-state/scripts/state-check.mjs\" stop-guard",
               "timeout": 5
             }
           ]
         }
       ]
     }
   }
   ```

4. **設定全域 Git 忽略（.gitignore_global）**：
   避免個別儲存庫將 `STATE.md` 誤提交至版控：
   ```bash
   echo "/STATE.md" >> ~/.gitignore_global
   git config --global core.excludesfile ~/.gitignore_global
   ```

---

## 4. 運行機制

### 4.1 手動存檔（/save-state）
當使用者輸入「存檔」、「更新狀態」、「save state」，或完成子目標、準備執行 `/clear`、`/compact`、切換模型前觸發：
1. 自動取專案根目錄與當前時戳。
2. 對照 `git status --porcelain` 比對檔案異動。
3. 僅更新變動段落，保留未變更段落原文。
4. 自動執行 `node state-check.mjs check` 驗證，若有錯誤即逐條修正直至通過。
5. 若「下一步」已無項目，自動觸發歸檔至 `~/.claude/state-archive/` 並刪除工作區檔案。

### 4.2 SessionStart 自動注入
在新 Session 啟動、`/clear` 或 `/compact` 之後，SessionStart 掛鉤自動執行 `inject` 子指令，輸出前導說明與 `STATE.md` 全文，模型直接從「下一步」第一項開始工作，不浪費權杖重複探索專案。

### 4.3 Stop 把關機制
當模型欲結束當前回合時，Stop 掛鉤自動執行 `stop-guard`：
- 若有 `[>]` 進行中項目且未曾攔截過（`stop_hook_active: false`），以退出碼 2 阻止結束，提示模型更新狀態。
- 若已被攔截過一次（`stop_hook_active: true`），則自動放行以避免無窮迴圈。

---

## 5. 測試套件

執行專案隨附的 21 個自動化測試案例：
```bash
node --test skills/save-state/tests/state-check.test.mjs
```

---

## 6. 移除步驟

1. 刪除技能目錄：`rm -rf ~/.claude/skills/save-state`
2. 編輯 `~/.claude/settings.json`，自 `hooks` 移除 `SessionStart` 與 `Stop` 相關區塊。
3. （選用）自 `~/.gitignore_global` 移除 `/STATE.md`。
