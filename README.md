# antigravity-state

English | [繁體中文](README.zh-TW.md)

Based on the research paper *SKILL.state: Scalable Long-Horizon Agent Skills* by Badhe, Tiwari, Chung ([arXiv:2608.26263](https://arxiv.org/abs/2608.26263)), `antigravity-state` is a long-horizon task state management plugin designed for Google Antigravity (`agy`) and the Gemini ecosystem. By decoupling immutable skill specifications from explicit structured task state (`STATE.md`) and leveraging automated lifecycle hooks (`PreInvocation` and `Stop`), it cuts token accumulation in multi-turn workflows by ~81.8% compared to traditional stateful agents, while guaranteeing seamless cross-session resumption after context resets (`/clear`).

This plugin fully supports three major Antigravity platforms:
- Antigravity Command-Line Interface (`agy`)
- Antigravity Integrated Development Environment
- Antigravity 2.0 Desktop Application

---

## Installation

```bash
agy plugin install https://github.com/AndyAWD/antigravity-state
```

---

## Features

- **Decoupled Architecture (arXiv:2608.26263)**: Separates immutable agent skill instructions from mutable workspace task state (`STATE.md`), allowing safe pruning of intermediate reasoning traces.
- **81.8% Token Savings**: Reduces estimated token consumption from 2,745,000 to 500,400 tokens across a 60-turn task model by resetting context (`/clear`) upon reaching milestones.
- **Automated Lifecycle Hooks**: Automatically injects structured state (~400 tokens) on turn 1 (`PreInvocation`) and intercepts premature turn ends when tasks are in progress (`Stop`).
- **Deterministic Invariant Validation**: Enforces 5 strict runtime invariants via a zero-dependency native Node.js 18+ verification script before persisting state.
- **Seamless Cross-Session Resumption**: Enables agents to pick up exactly from the first pending item in "Next Steps" without redundant project re-exploration.
- **Multi-Environment Support**: Works across Antigravity CLI, Antigravity IDE, and Antigravity 2.0 Desktop.

---

## Plugin Management

• List installed plugins:

  ```bash
  agy plugin list
  ```

• Enable plugin:

  ```bash
  agy plugin enable antigravity-state
  ```

• Disable plugin:

  ```bash
  agy plugin disable antigravity-state
  ```

• Uninstall plugin:

  ```bash
  agy plugin uninstall antigravity-state
  ```

---

## Directory Structure

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

## Commands and Skills

### `/agy-state`

Save current task state into `<project-root>/STATE.md` with deterministic invariant validation.

```bash
/antigravity-state:agy-state
```

#### When to Use

- When a subgoal or milestone has been completed and verified.
- Before executing `/clear`, `/compact`, or switching AI models.
- When explicitly requested by the user ("save state", "存檔").
- When the `Stop` hook intercepts session termination and reports an in-progress task.

#### How It Works

1. **Locate Project Root**: Identifies project root via `git rev-parse --show-toplevel` (or current working directory for non-git workspaces).
2. **Verify Workspace Diff**: Cross-references modified files against `git status --porcelain`.
3. **Incremental Section Update**: Reads existing `STATE.md`, modifies only updated sections, and preserves other lines verbatim.
4. **Invariant Validation**: Executes `node skills/agy-state/scripts/state-check.mjs check`. All 5 runtime invariants must pass with exit code 0.
5. **Automatic Archiving**: When all items in "下一步" are resolved, archives `STATE.md` to `~/.gemini/state-archive/<project>-YYYYMMDD-HHmm.md` and deletes the active workspace file.

```mermaid
flowchart TD
    subgraph S1["Session 1: Milestone Execution"]
        A["Start Task"] --> B["Work on Subgoal 1 (Explore, Edit, Test)<br>(Normal multi-turn flow, no saving)"]
        B --> C{"Subgoal verified & done?"}
        C -->|Yes| D["Invoke /agy-state<br>Update STATE.md ([>] -> [x] with verification)"]
        D --> E["Agent prompts: Saved, ready for /clear"]
    end

    E -->|User inputs /clear| S2

    subgraph S2["Session 2: Cross-session Resumption"]
        F["New Session Starts"] --> G["PreInvocation Hook Triggers<br>(Only on invocationNum = 1)"]
        G -->|Injects STATE.md| H["Agent receives ~400 token state board"]
        H --> I["Resumes directly from next step<br>(Zero token waste rediscovering project)"]
        I --> J["Hook stays silent on turns 2+"]
    end

    subgraph SG["Stop Hook Safety Guard"]
        K["Agent attempts to conclude turn"] --> L{"Does STATE.md have [>]?"}
        L -->|Yes & first intercept| M["Blocks exit (continue)<br>Prompts agent to update state"]
        L -->|No [>] or already retried| N["Allows exit (allow)"]
    end

    B -.-> K
```

#### Task State Format (`STATE.md`)

`STATE.md` consists of seven fixed sections in strict sequential order:

```markdown
# 任務狀態 ── 最後更新 YYYY-MM-DD HH:mm

## 目標
[One or two lines defining target objective and issue IDs]

## 已完成
- [x] [Subgoal]｜驗證：[One-line verification command and result]

## 已變更檔案
- M [Relative file path]

## 待解決
- [Blocker or issue]

## 關鍵資料（原樣保留）
- [Verbatim identifiers, paths, commands, or error logs]

## 已試過但失敗
- [Approach]: [Reason for failure]

## 下一步
- [>] [Currently active item with verification criteria]
- [ ] [Pending item]
- [!] [Blocked item]｜原因：[Reason for blockage]
```

##### Item Syntax & Runtime Invariants

| Marker | Meaning | Permitted Section | Syntax Constraints |
| :---: | :---: | :---: | :--- |
| `- [ ] ` | Pending | Only in "下一步" | Standard list item |
| `- [>] ` | In Progress | Only in "下一步" | Maximum 1 item across entire file |
| `- [!] ` | Blocked | Only in "下一步" | Must include full-width `｜原因：` |
| `- [x] ` | Done | Only in "已完成" | Must include full-width `｜驗證：` with tested command & result |

> [!IMPORTANT]
> The delimiter must be the full-width pipe character `｜` (`U+FF5C`), not the ASCII pipe `|`.

##### 5 Runtime Invariants

1. **Header & Section Integrity**: Header matches `# 任務狀態 ── 最後更新 YYYY-MM-DD HH:mm`; all 7 section titles present in exact order.
2. **Singular In-Progress Item**: "下一步" contains at most one `[>]` item and zero `[x]` items.
3. **Mandatory Verification & Reason**: Every done item has `｜驗證：`; every blocked item has `｜原因：`.
4. **Line Count Limits**: Maximum 5 non-empty lines per section, except "關鍵資料" which allows up to 5 items (each item can span multiple lines).
5. **Auto Archiving**: When "下一步" has zero items, the task is marked completed, archived to `~/.gemini/state-archive/`, and removed from workspace.

#### Helper Script CLI Options

The companion script `state-check.mjs` provides four execution subcommands:

- `check`: Validates `STATE.md` formatting and 5 runtime invariants.
- `in-progress`: Returns 0 if an active `[>]` task exists, 1 otherwise.
- `inject`: Outputs structured hook response for `PreInvocation` lifecycle hook.
- `stop-guard`: Evaluates whether to intercept termination (`continue`) or proceed (`allow`) for `Stop` hook.

#### Unit Testing & Verification

Run the automated test suite containing 24 test cases:

```bash
npm test
```

---

## License

This project is licensed under the [MIT License](LICENSE).
