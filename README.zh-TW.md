# antigravity-state

[English](README.md) | 繁體中文

依據 Badhe、Tiwari、Chung 之研究論文 *SKILL.state: Scalable Long-Horizon Agent Skills*（[arXiv:2608.26263](https://arxiv.org/abs/2608.26263)），為 Google Antigravity 與 Gemini 生態系打造的長程任務狀態管理外掛程式（Plugin）。透過「不可變技能規格（Skill Specification）」與「顯式結構化狀態（`STATE.md`）」的解耦架構，搭配生命週期掛鉤（Lifecycle Hook，`PreInvocation` 與 `Stop`）進行跨工作階段狀態注入與防呆把關，大幅降低長程多輪任務的權杖（Token）累積消耗（相較傳統有狀態代理在 60 輪長程任務模型下節省約 81.8%），並保證多步驟任務在對話清空（`/clear`）後依然能精準接續。

本外掛程式完整支援 Antigravity 三大平台：
- Antigravity 命令列介面（Command-Line Interface）（`agy`）
- Antigravity 整合開發環境（Integrated Development Environment）
- Antigravity 2.0 桌面應用程式（Desktop Application）

---

## 如何安裝

```bash
agy plugin install https://github.com/AndyAWD/antigravity-state
```

---

## 特色亮點

- **規格與狀態分離架構（arXiv:2608.26263）**：落實學術論文架構，將不可變技能指示與顯式可變任務看板（`STATE.md`）解耦，中間探索紀錄於里程碑完成後可安全拋棄，杜絕上下文二次方累積。
- **大幅降低權杖消耗（81.8%）**：以 60 輪長程任務模型驗證，從傳統基準的 2,745,000 權杖降至 500,400 權杖，總權杖消耗節省約 81.8%。
- **自動化生命週期掛鉤**：整合 `PreInvocation`（新工作階段首輪自動注入約 400 權杖狀態看板，後續輪次完全靜默）與 `Stop`（存在進行中子目標時自動阻擋並提示存檔）掛鉤機制。
- **確定性執行時期驗證**：由原生 Node.js 18+ 腳本在工作階段存檔時即時驗證五大不變量（Invariant），保證狀態格式百分之百合規。
- **跨工作階段無縫接續**：在對話執行 `/clear` 重置後，代理能直接自「下一步」第 1 項任務繼續執行，無需重複掃描探索工作區。
- **完整多平台適配**：跨平台相容 macOS、Linux 與 Windows，並全面支援 Antigravity 命令列介面、整合開發環境及 2.0 桌面應用程式。

---

## 如何管理與切換外掛程式

• 列出已安裝外掛：

  ```bash
  agy plugin list
  ```

• 啟用外掛：

  ```bash
  agy plugin enable antigravity-state
  ```

• 停用外掛：

  ```bash
  agy plugin disable antigravity-state
  ```

• 移除外掛：

  ```bash
  agy plugin uninstall antigravity-state
  ```

---

## 專案資料夾目錄

```text
antigravity-state/
├── hooks/
│   └── hooks.json
├── skills/
│   └── agy-state/
│       ├── scripts/
│       │   └── state-check.mjs
│       ├── tests/
│       │   └── state-check.test.mjs
│       └── SKILL.md
├── hooks.json
├── package.json
├── plugin.json
├── README.md
├── README.zh-TW.md
└── settings-hook-snippet.json
```

---

## 指令功能說明

### `/agy-state`

將當前任務進度與狀態寫入專案根目錄之 `<專案根目錄>/STATE.md`，並執行嚴格的執行時期不變量檢驗。

```bash
/antigravity-state:agy-state
```

#### 使用情境

- 使用者指示「存檔」、「更新狀態」或「save state」時。
- 完成一項子目標／里程碑且通過驗證時。
- 在執行 `/clear`、`/compact` 或切換人工智慧模型之前。
- 當 `Stop` 掛鉤提示 `STATE.md` 中仍有進行中子目標時。

#### 運作流程

1. **取得專案根目錄**：透過 `git rev-parse --show-toplevel` 取得根路徑（若非 Git 儲存庫（Repository）則以當前工作目錄為準）。
2. **對照工作區狀態**：透過 `git status --porcelain` 比對檔案異動現況。
3. **增量更新段落**：讀取現有 `STATE.md`，僅修改變動段落，其餘段落原樣保留。
4. **不變量驗證**：呼叫 `node skills/agy-state/scripts/state-check.mjs check`，確認五大不變量全數合規（結束代碼為 0）。
5. **自動歸檔與清理**：若「下一步」已無任何待辦項目，自動將狀態檔歸檔至 `~/.gemini/state-archive/<專案名>-YYYYMMDD-HHmm.md` 並自工作區刪除 `STATE.md`。

```mermaid
flowchart TD
    subgraph S1["Session 1：執行里程碑"]
        A["啟動 / 接手長程任務"] --> B["執行子目標 1（探索、修改、測試）<br>（正常多輪互動，不額外存檔）"]
        B --> C{"子目標完成且通過驗證？"}
        C -->|是| D["呼叫 /agy-state 技能<br>更新 STATE.md（[>] 轉為 [x] 附驗證）"]
        D --> E["提示使用者：已存檔，可以 /clear"]
    end

    E -->|使用者輸入 /clear| S2

    subgraph S2["Session 2：跨對話無縫接續"]
        F["新 Session 啟動"] --> G["PreInvocation 掛鉤觸發<br>（僅首輪 invocationNum = 1 執行）"]
        G -->|注入 STATE.md 看板| H["模型載入精簡狀態（約 400 權杖）"]
        H --> I["直接從「下一步」第 1 項開始工作<br>（無需重新掃描探索專案）"]
        I --> J["非首輪（第 2 輪起）掛鉤自動靜默"]
    end

    subgraph SG["Stop 掛鉤把關機制"]
        K["模型準備結束回合"] --> L{"STATE.md 是否有 [>]？"}
        L -->|有且為首度攔截| M["攔截結束（continue）<br>提示模型更新狀態"]
        L -->|無 [>] 或已續跑過| N["放行結束（allow）"]
    end

    B -.-> K
```

#### 狀態檔案規格（`STATE.md`）

`STATE.md` 包含固定七段結構，順序不可變動：

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

##### 標記語法規範與不變量

| 標記 | 語意 | 允許出現段落 | 強制附加格式 |
| :---: | :---: | :---: | :--- |
| `- [ ] ` | 待辦項目 | 僅限「下一步」 | 一般清單項目 |
| `- [>] ` | 進行中項目 | 僅限「下一步」 | 全檔同時最多存在一個 |
| `- [!] ` | 受阻項目 | 僅限「下一步」 | 必附全形「｜原因：」說明阻礙原因 |
| `- [x] ` | 已完成項目 | 僅限「已完成」 | 必附全形「｜驗證：」列出一行驗證指令與結果 |

> [!IMPORTANT]
> 分隔符號一律採用全形直線「｜」（`U+FF5C`），不得使用半形直線「|」。

##### 執行時期五大不變量

1. **標題與結構完整性**：標題行必須符合 `# 任務狀態 ── 最後更新 YYYY-MM-DD HH:mm` 格式；七段標題必須完整齊全且順序固定。
2. **進行中項目單一性**：「下一步」段落中最多只能有一個 `[>]` 項目，且「下一步」段落內嚴禁出現 `[x]`。
3. **驗證與原因標註**：「已完成」之每項必須以 `- [x] ` 開頭且包含「｜驗證：」；「下一步」的 `[!]` 必須包含「｜原因：」。
4. **行數與項目精簡度**：除「關鍵資料」外，其餘各段非空白行不得超過 5 行；「關鍵資料」最多容納 5 個項目（以 `- ` 開頭計），單一項目允許包含多行原文。
5. **自動歸檔與清理**：當「下一步」段落內無任何待辦項目時，視為整體任務已達成，技能會自動將狀態檔歸檔至 `~/.gemini/state-archive/<專案名>-YYYYMMDD-HHmm.md` 並自工作區刪除 `STATE.md`。

#### 腳本子指令選項

核心腳本 `state-check.mjs` 提供四項子指令：

- `check`：驗證 `STATE.md` 格式與五大不變量。
- `in-progress`：檢查工作區是否存在標記為 `[>]` 的進行中子目標。
- `inject`：輸出供 `PreInvocation` 掛鉤使用的狀態注入資料。
- `stop-guard`：供 `Stop` 掛鉤判斷是否攔截結束動作（`continue`）或放行（`allow`）。

#### 單元測試套件與驗證

專案具備基於 Node.js 原生測試模組撰寫之 24 項自動化單元測試：

```bash
npm test
```

---

## 授權條款

本專案採用 [MIT 授權條款](LICENSE)。
