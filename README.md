# antigravity-state

[English](README.en.md) | [繁體中文](README.md)

依據 Badhe, Tiwari, Chung 之論文 *SKILL.state: Scalable Long-Horizon Agent Skills*（[arXiv:2608.26263](https://arxiv.org/abs/2608.26263)），為 Google Antigravity（`agy`）與 Gemini 生態系打造的長程任務狀態管理外掛程式（Plugin）。透過「**不可變技能規格（Skill Specification）**」與「**顯式結構化狀態（`STATE.md`）**」的解耦架構，搭配**生命週期掛鉤（Lifecycle Hooks，`PreInvocation` 與 `Stop`）**進行跨對話狀態注入與防呆把關，大幅降低長程多輪任務的權杖（Token）累積消耗（相較傳統有狀態代理節省約 81.8%），並保證多步驟任務在對話清空（`/clear`）後依然能精準接續。

---

## 安裝與管理

### 安裝外掛程式

#### 方式 A：透過 GitHub 遠端安裝（推薦）
```bash
agy plugin install https://github.com/AndyAWD/antigravity-state
```

#### 方式 B：從本機開發路徑安裝
```bash
# 在專案目錄下執行：
agy plugin install .

# 或指定絕對路徑：
agy plugin install /path/to/antigravity-state
```

### 檢視已安裝清單
```bash
agy plugin list
```

### （選用）全域 Git 忽略設定
建議將 `STATE.md` 加入全域 Git 排除清單，避免個別專案誤將狀態暫存檔提交至版本控制：
```bash
echo "/STATE.md" >> ~/.gitignore_global
git config --global core.excludesfile ~/.gitignore_global
```

---

## 核心特性與設計依據

### 1. 論文理論核心（Theoretical Foundation）
在長程代理任務中，傳統有狀態代理（Stateful Agent）會將所有歷史思維與工具輸出不斷累積於上下文（Context）中，導致總權杖消耗呈二次方（$O(T^2)$）暴增，且容易引發注意力渙散。

本外掛採用論文主張：
1. **規格與狀態分離**：將任務拆解為不可變的技能指示（`/agy-state`）與顯式可變的結構化文字看板（`STATE.md`）。
2. **中間歷史丟棄**：每一步推論僅需三項輸入──技能規格、結構化狀態、最新環境觀察；其餘探索歷史可安全拋棄。
3. **確定性驗證落盤**：狀態寫入工作區前，必須由執行時期（Runtime）腳本完成五大不變量（Invariants）檢驗，確保結構嚴謹。

### 2. 權杖消耗量化對比（60 輪長程任務模型）

| 運作模式 | 機制說明 | 預估總權杖消耗 | 相較基準節省率 |
| :--- | :--- | :---: | :---: |
| **基準：傳統有狀態代理** | 上下文歷史完全不清除，隨輪次二次方累積 | **2,745,000** 權杖 | 0%（基準） |
| **模式 A：每輪對話皆存檔** | 未清空上下文，每輪額外增加狀態寫入與檢查開銷 | **2,775,000** 權杖 | **-1.1%（消耗增加）** |
| **模式 B：里程碑完成才存檔**<br>（**本外掛架構**） | 於子目標內自由探索，里程碑完成後存檔並執行 `/clear`，新對話僅注入約 400 權杖之狀態看板 | **500,400** 權杖 | **節省約 81.8%** |

---

## 元件架構

本外掛由以下三大核心元件構成：

1. **技能（Skill）**：[`skills/agy-state/SKILL.md`](skills/agy-state/SKILL.md)
   - 可在任何交談工作階段中以 `/agy-state` 斜線指令觸發。
   - 負責取得專案根目錄、對照 `git status --porcelain` 檢查檔案異動、讀取並更新變動段落，且在子目標全數完成時自動歸檔至 `~/.gemini/state-archive/`。
2. **生命週期掛鉤（Lifecycle Hooks）**：[`hooks.json`](hooks.json)
   - **`PreInvocation`**：在新 Session 首輪（`invocationNum === 1`）以暫態訊息（Ephemeral Message）形式自動注入 `STATE.md` 全文；非首輪自動靜默（零權杖負擔）。
   - **`Stop`**：當模型嘗試結束回合時，檢查是否仍有 `[>]` 進行中項目；首度結束（`executionNum === 1`）回傳 `continue` 阻擋並提示存檔；續跑（`executionNum > 1`）自動放行以防無窮迴圈。
3. **狀態檢查腳本（State Checker）**：[`skills/agy-state/scripts/state-check.mjs`](skills/agy-state/scripts/state-check.mjs)
   - 採用原生 Node.js 18+ ES 模組，零外部依賴。
   - 提供 `check`、`in-progress`、`inject`、`stop-guard` 四大子指令，自動適配 CLI 終端機模式與 Antigravity 掛鉤協議之 JSON 資料契約。

---

## 使用方式與工作流程

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

### 1. 里程碑完成後執行存檔（`/agy-state`）

當完成一項具體子目標並通過單元測試後，輸入 `/agy-state` 更新狀態：

```text
────────────────────────────────────────────────
> /agy-state
────────────────────────────────────────────────
已更新 STATE.md（變更段落：已完成、已變更檔案、下一步）驗證通過。可以執行 /clear 了。
```

### 2. 跨工作階段重置與自動注入（`/clear`）

存檔完成後輸入 `/clear` 清空累積的龐大歷史，新 Session 首輪由 `PreInvocation` 自動注入看板：

```text
────────────────────────────────────────────────
> /clear
────────────────────────────────────────────────
Clear conversation history?
> Yes
────────────────────────────────────────────────
=== STATE.md（專案任務狀態）===
以下為上個 session 存檔。從「下一步」第 1 項開始，不重新探索專案...
# 任務狀態 ── 最後更新 2026-09-09 23:40
## 目標
...
## 下一步
- [>] 實作連線健康檢查定時器｜驗證：模擬斷線並檢查 3 秒內自動重連
────────────────────────────────────────────────
> 請繼續執行下一步
────────────────────────────────────────────────
```

### 3. Stop 掛鉤防呆攔截

若模型在仍有 `[>]` 進行中項目時試圖結束回答，`Stop` 掛鉤將自動介入：

```text
────────────────────────────────────────────────
⎿  [Stop Hook Intercepted]
   STATE.md 有進行中子目標：「實作連線健康檢查定時器」。結束前擇一處理後執行 /agy-state：已完成則移到「已完成」並附「｜驗證：」；要暫停則改回 [ ]；受阻改為 [!] 並附「｜原因：」。
────────────────────────────────────────────────
```

---

## 狀態檔案規格（STATE.md）

### 1. 七段固定結構（順序不可變動）

```markdown
# 任務狀態 ── 最後更新 YYYY-MM-DD HH:mm
## 目標
## 已完成
## 已變更檔案
## 待解決
## 關鍵資料（原樣保留）
## 已試過但失敗
## 下一步
```

### 2. 標記語法規範

| 標記 | 語意 | 允許出現段落 | 強制附加格式 |
| :---: | :---: | :---: | :--- |
| `- [ ] ` | 待辦項目 | 僅限「下一步」 | 無 |
| `- [>] ` | 進行中項目 | 僅限「下一步」 | 全域同時最多存在一個 |
| `- [!] ` | 受阻項目 | 僅限「下一步」 | 必附全形「｜原因：」說明阻礙 |
| `- [x] ` | 已完成項目 | 僅限「已完成」 | 必附全形「｜驗證：」列出一行驗證指令與結果 |

> [!IMPORTANT]
> 分隔符號一律採用全形直線「｜」（U+FF5C），不得使用半形直線「|」。

### 3. 執行時期（Runtime）五大不變量

1. **標題與結構完整性**：標題行必須完全符合 `# 任務狀態 ── 最後更新 YYYY-MM-DD HH:mm` 格式；七段標題必須完整齊全且順序固定。
2. **進行中項目單一性**：「下一步」段落中最多只能有一個 `[>]` 項目，且「下一步」段落內嚴禁出現 `[x]`。
3. **驗證與原因標註**：「已完成」之每項必須以 `- [x] ` 開頭且包含「｜驗證：」；「下一步」的 `[!]` 必須包含「｜原因：」。
4. **行數與項目精簡度**：除「關鍵資料」外，其餘各段非空白行不得超過 5 行；「關鍵資料」最多容納 5 個項目（以 `- ` 開頭計），單一項目允許包含多行原文報錯。
5. **自動歸檔與清理**：當「下一步」段落內無任何待辦項目時，視為整體任務已達成，技能會自動將狀態檔歸檔至 `~/.gemini/state-archive/<專案名>-YYYYMMDD-HHmm.md` 並自工作區刪除 `STATE.md`。

---

## 檔案清單與目錄結構

```text
antigravity-state/
├── plugin.json                                  # 外掛程式清單（Plugin Manifest，定義名稱與版本）
├── package.json                                 # Node.js 模組配置與測試指令
├── hooks.json                                   # 外掛程式生命週期掛鉤定義（PreInvocation 與 Stop）
├── hooks/
│   └── hooks.json                               # 掛鉤設定備援檔
├── skills/
│   └── agy-state/
│       ├── SKILL.md                             # 技能定義與作業流程規範檔（/agy-state）
│       ├── scripts/
│       │   └── state-check.mjs                  # 狀態驗證與掛鉤處理核心腳本（可執行 100755）
│       └── tests/
│           └── state-check.test.mjs             # 24 項自動化單元測試套件
├── settings-hook-snippet.json                   # 本機手動安裝時 settings.json 之掛鉤設定片段
└── README.md                                    # 專案完整說明手冊
```

---

## 測試套件與驗證

### 1. 執行單元測試套件
專案隨附 24 項基於 Node.js 原生 `node:test` 撰寫之單元測試：
```bash
npm test
```
測試覆蓋範圍包含：
- `check` 子指令之格式與五大不變量強制檢查（合法檔通過、時間格式、缺少段落、順序錯置、多重進行中項目、缺少驗證或原因標註、行數上限等）。
- `in-progress` 子指令之進行中狀態讀取。
- `inject` 子指令之 CLI 模式與 Antigravity `PreInvocation` 協議測試（首輪注入 `injectSteps` 暫態訊息、非首輪靜默）。
- `stop-guard` 子指令之 CLI 模式與 Antigravity `Stop` 協議測試（首度結束攔截 `continue`、續跑放行 `allow`、無檔案或無進行中項目放行）。

### 2. 執行官方外掛格式驗證
透過 Antigravity CLI 內建外掛驗證工具確認結構無誤：
```bash
agy plugin validate .
```
預期輸出：
```text
[ok]    .
        ✔ skills      : 1 processed
        - agents      : skipped (not found)
        - commands    : skipped (not found)
        - mcpServers  : skipped (not found)
        ✔ hooks       : 1 processed
```

---

## 移除步驟

若需卸載本外掛程式：

```bash
# 1. 透過 CLI 卸載外掛
agy plugin uninstall antigravity-state

# 2. （選用）若曾設定全域 Git 排除，可自 ~/.gitignore_global 移除 /STATE.md
```

---

## 授權條款

本專案採用 [MIT 授權條款](LICENSE)。
