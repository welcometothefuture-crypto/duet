import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { MODES } from './modes.js';
import { claudeDriver } from './drivers/claude.js';
import { codexDriver } from './drivers/codex.js';

const execFileP = promisify(execFile);
const DRIVERS = { claude: claudeDriver, codex: codexDriver };

/**
 * Drives one collaboration run. A single Orchestrator instance handles one run at a time.
 * Emits:
 *   'event' (normalized agent event), 'turn-start', 'turn-end', 'state', 'log'
 */
export class Orchestrator extends EventEmitter {
  constructor({ runsDir }) {
    super();
    this.runsDir = runsDir;
    this.run = null;
    this.currentChild = null;
    this._resumeGate = null;
  }

  get state() {
    if (!this.run) return { status: 'idle' };
    const { id, mode, task, status, maxRounds, models, roles, workspace, turns, beta } = this.run;
    return {
      status, id, mode, task, maxRounds, models, roles, workspace, beta,
      turnCount: turns.length,
      currentAgent: this.run.currentAgent || null,
    };
  }

  /** Snapshot enough for a freshly-connected client to render the whole run. */
  snapshot() {
    if (!this.run) return { state: this.state, events: [], turns: [] };
    return {
      state: this.state,
      events: this.run.events.slice(-2000),
      turns: this.run.turns.map((t) => ({ n: t.n, agent: t.agent, output: t.output, ts: t.ts })),
    };
  }

  async start(config) {
    if (this.run && this.run.status === 'running') {
      throw new Error('A run is already in progress. Stop it first.');
    }
    const mode = MODES[config.mode];
    if (!mode) throw new Error(`Unknown mode: ${config.mode}`);

    const id = stamp();
    const workspace = path.resolve(config.workspace || './workspace');
    fs.mkdirSync(workspace, { recursive: true });

    // Beta = lowest-compute POC mode (default ON): cheapest/fastest tier per engine.
    const beta = config.beta !== false;
    const run = {
      id,
      mode: config.mode,
      task: config.task,
      workspace,
      maxRounds: Number(config.maxRounds) || 8,
      beta,
      // Explicit model choices win; otherwise beta picks the cheap tier (Claude haiku),
      // standard picks the strong tier (Claude opus). Codex model defaults to the CLI default.
      // Model aliases ('haiku', 'sonnet', 'opus') auto-track the latest version in that family.
      // Full versioned IDs (e.g. 'claude-opus-4-20250514') are also accepted.
      models: {
        claude: config.models?.claude || (beta ? 'haiku' : 'opus'),
        codex: config.models?.codex || '',
      },
      // Codex has no model swap here; lower its compute via reasoning effort instead.
      reasoningEffort: { codex: beta ? 'low' : null },
      roles: { ...defaultRoles(mode), ...(config.roles || {}) },
      sessions: { claude: null, codex: null },
      status: 'running',
      turns: [],
      events: [],
      pendingInjects: [],
      scratch: {},
      currentAgent: null,
    };
    this.run = run;

    await this._initWorkspace(run);
    this._persist();
    this.emit('state', this.state);
    this.emit('log', `Run ${id} started · mode=${config.mode} · workspace=${workspace}`);

    // Kick off the loop without blocking the HTTP response.
    this._loop().catch((err) => {
      this.emit('log', `Loop error: ${err.stack || err}`);
      run.status = 'error';
      this._persist();
      this.emit('state', this.state);
    });

    return { id };
  }

  async _loop() {
    const run = this.run;
    const mode = MODES[run.mode];
    let agent = mode.firstAgent(run);

    while (run.status === 'running' && run.turns.length < run.maxRounds) {
      await this._waitIfPaused();
      if (run.status !== 'running') break;

      run.currentAgent = agent;
      this.emit('state', this.state);

      const n = run.turns.length + 1;
      const prompt = mode.buildPrompt(run, agent);
      this.emit('turn-start', { n, agent, prompt });
      this.emit('log', `— Turn ${n}: ${agent} —`);

      const driver = DRIVERS[agent];
      let result;
      try {
        result = await driver.run({
          prompt,
          cwd: run.workspace,
          model: run.models[agent],
          sessionId: run.sessions[agent],
          reasoningEffort: run.reasoningEffort?.[agent] || null,
          onChild: (child) => { this.currentChild = child; },
          onEvent: (ev) => this._record(ev),
        });
      } catch (err) {
        this._record({ agent, kind: 'error', text: String(err.message || err), ts: Date.now() });
        result = { sessionId: run.sessions[agent], finalText: '', ok: false };
      } finally {
        this.currentChild = null;
      }

      run.sessions[agent] = result.sessionId || run.sessions[agent];
      const turn = { n, agent, prompt, output: result.finalText || '', ts: Date.now() };
      run.turns.push(turn);
      this.emit('turn-end', { n, agent, output: turn.output });

      await this._commit(run, turn);
      this._persist();

      if (run.status === 'stopped') break;
      if (mode.isDone(run, turn)) {
        run.status = 'done';
        break;
      }
      agent = mode.nextAgent(run, agent);
    }

    if (run.status === 'running') run.status = 'done'; // hit maxRounds
    run.currentAgent = null;
    this._persist();
    this.emit('state', this.state);
    this.emit('log', `Run ${run.id} finished · status=${run.status} · ${run.turns.length} turns`);
  }

  _record(ev) {
    if (!this.run) return;
    this.run.events.push(ev);
    if (this.run.events.length > 5000) this.run.events.splice(0, 1000);
    this.emit('event', ev);
  }

  // -------------------------------------------------------------- controls
  pause() {
    if (this.run && this.run.status === 'running') {
      this.run.status = 'paused';
      this.emit('state', this.state);
      this.emit('log', 'Paused — will stop after the current turn completes.');
    }
  }

  resume() {
    if (this.run && this.run.status === 'paused') {
      this.run.status = 'running';
      if (this._resumeGate) { this._resumeGate.resolve(); this._resumeGate = null; }
      this.emit('state', this.state);
      this.emit('log', 'Resumed.');
    }
  }

  inject(text) {
    if (this.run && text && text.trim()) {
      this.run.pendingInjects.push(text.trim());
      this.emit('log', `Operator note queued for next turn: ${text.trim()}`);
    }
  }

  stop() {
    if (!this.run) return;
    this.run.status = 'stopped';
    if (this._resumeGate) { this._resumeGate.resolve(); this._resumeGate = null; }
    if (this.currentChild) {
      try { this.currentChild.kill('SIGTERM'); } catch {}
    }
    this.emit('state', this.state);
    this.emit('log', 'Stopped by operator.');
  }

  _waitIfPaused() {
    if (!this.run || this.run.status !== 'paused') return Promise.resolve();
    return new Promise((resolve) => { this._resumeGate = { resolve }; });
  }

  // -------------------------------------------------------------- workspace
  async _initWorkspace(run) {
    const ws = run.workspace;
    if (!fs.existsSync(path.join(ws, '.git'))) {
      await git(ws, ['init', '-q']);
      await git(ws, ['config', 'user.email', 'duet@local']);
      await git(ws, ['config', 'user.name', 'Duet']);
    }
    const collab = path.join(ws, 'COLLAB.md');
    if (!fs.existsSync(collab)) {
      fs.writeFileSync(
        collab,
        `# Shared Whiteboard\n\nTask: ${run.task}\n\nClaude and Codex coordinate here. Each appends a handoff note at the end of its turn.\n`,
      );
    }
    await git(ws, ['add', '-A']).catch(() => {});
    await git(ws, ['commit', '-q', '-m', `duet: start run ${run.id}`, '--allow-empty']).catch(() => {});
  }

  async _commit(run, turn) {
    try {
      await git(run.workspace, ['add', '-A']);
      await git(run.workspace, [
        'commit', '-q', '--allow-empty',
        '-m', `turn ${turn.n}: ${turn.agent}`,
      ]);
    } catch (err) {
      this.emit('log', `git commit failed: ${err.message}`);
    }
  }

  /** Recent git history + current diffstat, for the dashboard's repo panel. */
  async repoInfo() {
    if (!this.run) return { log: '', diffstat: '' };
    const ws = this.run.workspace;
    const log = await git(ws, ['log', '--oneline', '-n', '20']).then((r) => r.stdout).catch(() => '');
    const diffstat = await git(ws, ['show', '--stat', '--oneline', 'HEAD']).then((r) => r.stdout).catch(() => '');
    return { log, diffstat };
  }

  // -------------------------------------------------------------- persistence
  _persist() {
    if (!this.run) return;
    const dir = path.join(this.runsDir, this.run.id);
    fs.mkdirSync(dir, { recursive: true });
    const data = {
      id: this.run.id,
      mode: this.run.mode,
      task: this.run.task,
      workspace: this.run.workspace,
      models: this.run.models,
      beta: this.run.beta,
      roles: this.run.roles,
      status: this.run.status,
      maxRounds: this.run.maxRounds,
      turns: this.run.turns.map((t) => ({ n: t.n, agent: t.agent, output: t.output, ts: t.ts })),
    };
    fs.writeFileSync(path.join(dir, 'transcript.json'), JSON.stringify(data, null, 2));
  }
}

function defaultRoles(mode) {
  const out = {};
  for (const f of mode.roleFields || []) out[f.key] = f.default;
  return out;
}

async function git(cwd, args) {
  return execFileP('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
}

function stamp() {
  // Avoid Date in workflow-restricted contexts is irrelevant here (normal runtime).
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
