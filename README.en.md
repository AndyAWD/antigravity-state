# antigravity-state

[English](README.en.md) | [繁體中文](README.md)

Based on the research paper *SKILL.state: Scalable Long-Horizon Agent Skills* by Badhe, Tiwari, Chung ([arXiv:2608.26263](https://arxiv.org/abs/2608.26263)), `antigravity-state` is a task state management plugin for the Google Antigravity (`agy`) and Gemini ecosystem. By decoupling "immutable skill specifications" from "explicit mutable task state (`STATE.md`)", and leveraging lifecycle hooks (`PreInvocation` and `Stop`), it dramatically cuts token accumulation across multi-turn long-horizon tasks (saving ~81.8% tokens compared to standard stateful agents) while ensuring seamless resumption across context resets (`/clear`).

---

## Installation & Management

### Install Plugin

#### Method A: Remote Installation via GitHub (Recommended)
```bash
agy plugin install https://github.com/AndyAWD/antigravity-state
```

#### Method B: Local Development Installation
```bash
# From within the repository:
agy plugin install .

# Or specify absolute path:
agy plugin install /path/to/antigravity-state
```

### List Installed Plugins
```bash
agy plugin list
```

### (Optional) Global Git Exclusion
Add `STATE.md` to your global gitignore to avoid accidentally committing temporary state files:
```bash
echo "/STATE.md" >> ~/.gitignore_global
git config --global core.excludesfile ~/.gitignore_global
```

---

## Theoretical Foundation & Token Savings

### 1. Core Principles (arXiv:2608.26263)
Standard stateful agents suffer from quadratic token growth ($O(T^2)$) as conversation and tool outputs pile up, leading to degraded attention and high API costs.

This plugin implements the paper\'s core tenets:
1. **Immutable Specification vs. Mutable State**: Decouple static instructions (`/agy-state`) from dynamic state boards (`STATE.md`).
2. **Intermediate History Pruning**: Each step requires only the skill spec, the structured state, and the latest observation. Intermediate exploratory logs are safely pruned via `/clear`.
3. **Deterministic Invariant Enforcement**: State files are validated by a native Node.js runtime script before disk write.

### 2. Quantitative Token Comparison (60-turn Task Model)

| Mode | Mechanism | Estimated Tokens | Savings vs. Baseline |
| :--- | :--- | :---: | :---: |
| **Baseline: Standard Stateful Agent** | Context accumulates quadratically over 60 turns | **2,745,000** tokens | 0% (Baseline) |
| **Mode A: Per-turn State Saving** | Context uncleared, adding per-turn write & check overhead | **2,775,000** tokens | **-1.1% (Negative savings)** |
| **Mode B: Milestone-driven State Saving**<br>(**This Plugin**) | Free exploration during subgoals, state saved at milestones followed by `/clear`, new session injected with ~400-token state board | **500,400** tokens | **~81.8% Saved** |

---

## Component Architecture

This plugin consists of three primary components:

1. **Skill**: [`skills/agy-state/SKILL.md`](skills/agy-state/SKILL.md)
   - Invoked via `/agy-state` slash command.
   - Discovers project root, diffs against `git status --porcelain`, modifies changed sections, and archives to `~/.gemini/state-archive/` once all items are done.
2. **Lifecycle Hooks**: [`hooks.json`](hooks.json)
   - **`PreInvocation`**: Injects `STATE.md` as an ephemeral message on session startup (`invocationNum === 1`); remains completely silent on subsequent turns (zero token overhead).
   - **`Stop`**: Intercepts session termination if an in-progress `[>]` item remains on first stop (`executionNum === 1`); allows exit on subsequent retries to prevent infinite loops.
3. **State Checker Script**: [`skills/agy-state/scripts/state-check.mjs`](skills/agy-state/scripts/state-check.mjs)
   - Pure Node.js 18+ ES module with zero external dependencies.
   - Provides `check`, `in-progress`, `inject`, and `stop-guard` commands, fully compatible with both CLI and Antigravity hook contracts.

---

## Workflow & Usage

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

### 1. Save State upon Milestone Completion (`/agy-state`)

```text
────────────────────────────────────────────────
> /agy-state
────────────────────────────────────────────────
Updated STATE.md (changed sections: Done, Changed Files, Next Steps) and passed verification. You may now run /clear.
```

### 2. Context Reset & Automated Injection (`/clear`)

```text
────────────────────────────────────────────────
> /clear
────────────────────────────────────────────────
Clear conversation history?
> Yes
────────────────────────────────────────────────
=== STATE.md (Project Task State) ===
Following is saved from previous session. Resume from item 1 of Next Steps...
# Task State ── Last Updated 2026-09-09 23:40
## Goal
...
## Next Steps
- [>] Implement connection health check timer | Verify: simulate disconnect and check reconnection within 3s
────────────────────────────────────────────────
> Please continue with next steps.
────────────────────────────────────────────────
```

### 3. Stop Hook Safety Guard

```text
────────────────────────────────────────────────
⎿  [Stop Hook Intercepted]
   STATE.md has an in-progress item: "Implement connection health check timer". Before ending, resolve it and run /agy-state: if finished move to Done with "| Verify:"; if pausing change to [ ]; if blocked change to [!] with "| Reason:".
────────────────────────────────────────────────
```

---

## State File Format (STATE.md)

### 1. Seven Fixed Sections (Strict Order)
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

### 2. Task Item Syntax
- `- [ ] `: Pending item (Only allowed in "下一步")
- `- [>] `: In-progress item (Only in "下一步", max 1 across entire file)
- `- [!] `: Blocked item (Only in "下一步", must include `｜原因：`)
- `- [x] `: Done item (Only in "已完成", must include `｜驗證：` with command and output)

*Note: Delimiter must be the full-width pipe character `｜` (`U+FF5C`).*

### 3. Runtime Invariants
1. Header matches `# 任務狀態 ── 最後更新 YYYY-MM-DD HH:mm`; all 7 section titles present in exact order.
2. "下一步" has at most one `[>]` item and zero `[x]` items.
3. Every done item in "已完成" has `｜驗證：`; every blocked item in "下一步" has `｜原因：`.
4. Max 5 non-empty lines per section, except "關鍵資料" which allows up to 5 items (each item can be multi-line).
5. When "下一步" is empty, task is considered complete: `STATE.md` is archived to `~/.gemini/state-archive/` and removed.

---

## Directory Structure

```text
antigravity-state/
├── plugin.json                                  # Plugin manifest (name, version, description)
├── package.json                                 # Node.js module configuration & test scripts
├── hooks.json                                   # Lifecycle hooks definition (PreInvocation & Stop)
├── hooks/
│   └── hooks.json                               # Fallback hooks definition
├── skills/
│   └── agy-state/
│       ├── SKILL.md                             # Skill instructions (/agy-state)
│       ├── scripts/
│       │   └── state-check.mjs                  # Invariant validator and hook handler (100755)
│       └── tests/
│           └── state-check.test.mjs             # 24 automated unit tests
├── settings-hook-snippet.json                   # Manual configuration snippet for settings.json
├── README.md                                    # Traditional Chinese documentation
└── README.en.md                                 # English documentation
```

---

## Testing & Verification

```bash
# Run unit tests (24 passed)
npm test

# Validate plugin format
agy plugin validate .
```

---

## License

This project is licensed under the [MIT License](LICENSE).
