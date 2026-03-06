# Pi Agent Watchdog

A configurable extension that looks for agent-stall pathologies during long autonomous runs and can surface, steer, or block them before they burn huge budgets.

## Why this exists

Some bad runs are not "the model is dumb" so much as "the loop never converged":

- rereading the same file hundreds of times
- oscillating across overlapping chunks
- restarting at the top of the same file repeatedly
- staying trapped in read/search mode without phase changes
- quietly burning tools/tokens for tens of minutes

This extension focuses on those failure modes.

## Design

The watchdog has three layers:

- **detectors** — pure, pluggable heuristics that inspect rolling tool history
- **responses** — configurable actions by severity (`status`, `persist`, `notify`, `steer`, `block`)
- **replay CLI** — analyze real session JSONL or embedded subagent transcripts offline to tune thresholds and validate false positives

It intentionally uses Pi's existing hooks rather than inventing a second runtime, but the detector/response split gives a stable internal surface for adding new heuristics without rewriting the UX each time.

## Baseline detectors

### Repetitive read detector

Looks for read-heavy convergence failures such as:

- one path dominating the recent read window
- exact chunk rereads of the same `(path, offset, limit)`
- overlapping-range churn
- repeated restarts to `offset=1`
- high read/search monopolization with low path novelty

### Tool budget detector

Tracks total tool calls and elapsed runtime and can surface when a session crosses soft or hard budgets.

This is intentionally simple in the first version; it is most useful when combined with the more specific repetitive-read detector.

## Installation

### Local package

```bash
pi install ~/dotfiles/ai/pi/extensions/watchdog
```

### One-off local load

```bash
pi -e ~/dotfiles/ai/pi/extensions/watchdog/index.ts
```

## Configuration

Supports JSON and JSONC at:

- `~/.pi/agent/watchdog.json`
- `~/.pi/agent/watchdog.jsonc`
- `.pi/watchdog.json`
- `.pi/watchdog.jsonc`

Later files override earlier ones.

Start from [`watchdog.config.example.jsonc`](./watchdog.config.example.jsonc).

Recommended first rollout:

- keep `delivery: "custom"`
- keep the built-in defaults in observe/notify mode first
- add `steer` and `block` only after replaying a few normal long runs and checking false positives

## Runtime behavior

The extension:

- rebuilds tool history from the current branch on `session_start`/`session_switch`
- evaluates each new tool call against the detector set
- appends persisted incidents as custom entries
- can emit a status line / notification / steer message / block depending on severity and config

Command:

- `/watchdog` — show a compact runtime summary

## Replay CLI

Replay a normal session:

```bash
bun run replay-watchdog --session ~/.pi/agent/sessions/<session>.jsonl --head-line 1200
```

Replay an embedded subagent transcript from a parent-session `subagent` tool result:

```bash
bun run replay-watchdog --session ~/.pi/agent/sessions/<session>.jsonl --subagent-line 507
```

Useful options:

- `--cwd <path>` — strongly recommended when tool paths in the session are relative
- `--config <path>` — replay with a specific config
- `--head-message-id <id>` — cut a normal session at a specific JSONL entry id
- `--subagent-result-index <n>` — pick a different embedded child result
- `--output markdown|json`

This is the main tuning loop for detector thresholds.

## Development

```bash
bun install
bun test
bun run typecheck
bun run replay-watchdog --help
```
