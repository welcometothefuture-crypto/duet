# Duet — Claude × Codex, collaborating autonomously

A local web dashboard that puts **Claude Code** and **OpenAI Codex** to work *together* on a
single shared task (a repo/folder/program). You pick **how** they collaborate, give them a task,
hit Start, and watch both agents work in real time — side by side — editing the same git-tracked
workspace.

The UI is a **vintage-spaceship flight deck**: the two agents are CRT terminals — **Claudy** (Claude,
amber phosphor) and **Cody** (Codex, teal phosphor) — embedded in a tilted amber console, framed by
LED-dot walls, a hexagonal ceiling dome, and a starfield viewport that jumps to hyperspace whenever
an agent is working. There's a power-up boot sequence, reactive telemetry lamps/gauges, and a
mutable retro sound layer (the `♪ SND` toggle, off by default).

![two columns: Claude on the left, Codex on the right, a shared task in the middle]

## How it works

Both CLIs expose a scriptable headless mode that streams JSONL events and supports resumable
sessions. Duet drives them as two cooperating workers around one shared folder:

- **Claude:** `claude -p … --output-format stream-json --resume <id>`
- **Codex:** `codex exec … --json` + `codex exec resume <id>`

The orchestrator runs **turn-based** (one agent acts at a time) so the two never collide on the
same files. They coordinate three ways:

1. **`COLLAB.md`** — a shared whiteboard in the workspace. Each agent reads it at the start of its
   turn and appends a handoff note at the end.
2. **Handoff injection** — the other agent's last message is fed into the next prompt.
3. **Git** — every turn is committed, so the whole collaboration is a readable history you can diff
   or roll back.

Each agent keeps its own memory across turns via session resume.

## Collaboration modes (chosen before prompting)

| Mode | What happens |
|------|--------------|
| **Peers** | Equal pair-programmers alternate, each building on the other's work until done. |
| **Builder + Reviewer** | One implements; the other reviews, runs/tests it, and returns feedback. Loops until the reviewer approves. |
| **Manager + Workers** | One decomposes the task into a `COLLAB.md` checklist; both then take items in turn until all are checked. |
| **Debate → consensus** | Both argue approaches for N rounds, converge on a plan, then split the work and implement. |

You choose which engine plays which role (e.g. who builds, who goes first).

## Beta mode (default — lowest compute)

For cheap, fast proof-of-concept iteration, **Beta mode is on by default**. It runs both engines at
their lowest practical compute tier:

- **Claude → `haiku`** (the smallest/fastest Claude model)
- **Codex → `low` reasoning effort** (Codex defaults to `high`; `minimal` is rejected by Codex's
  tool set, so `low` is the floor)

Untick the toggle on the setup screen for full power (Claude `opus`, Codex default reasoning), or
type explicit model names. The active run shows a `⚡beta` marker in its header.

## Run it

```bash
npm install
npm start            # → http://localhost:4317
```

Open the dashboard, pick a mode, assign roles, write a task, and Start. Live controls: **Pause /
Resume**, **Stop** (kills both child processes), and **Inject** (drop a human note into the next
turn — human-in-the-loop steering).

### Prerequisites

- Node 18+
- `claude` CLI authenticated (`claude` once interactively)
- `codex` CLI installed and authenticated — `npm i -g @openai/codex`, then `codex login`

### Verify the plumbing

```bash
node scripts/smoke.js        # each driver: autonomous write + session resume
node scripts/orch-test.js    # a tiny 2-turn Peers run, end to end
```

## ⚠ Safety model

For the agents to work unattended, Duet runs them with **permissions bypassed**
(`--dangerously-skip-permissions` for Claude, `--dangerously-bypass-approvals-and-sandbox` for
Codex). To contain that:

- They operate inside a dedicated, **git-initialized `workspace/` folder** (configurable per run).
- **Every turn is committed**, so all changes are reviewable and reversible (`git log`, `git diff`).
- **Stop** terminates both processes immediately.

Only point the workspace at a directory you're comfortable letting two autonomous agents modify.

## Layout

```
server.js              HTTP + WebSocket server, REST controls
src/
  orchestrator.js      turn engine: rounds, mode application, git commits, persistence
  modes.js             the four collaboration modes
  drivers/
    claude.js          drives the Claude CLI, normalizes its stream-json events
    codex.js           drives the Codex CLI, normalizes its JSON events
    spawnJsonl.js      shared line-by-line JSONL process reader
public/
  index.html           flight-deck markup
  styles.css           the cockpit skin (amber panels, CRT terminals, LEDs, lamps)
  cockpit.js           atmosphere: starfield/hyperspace, LED walls, boot sequence, telemetry, SFX
  app.js               orchestration client: WebSocket stream, controls, beta toggle
runs/<timestamp>/      saved transcript.json per run
workspace/             the shared repo both agents edit
```
