// End-to-end orchestrator test: a tiny 2-turn Peers run exercising the full loop
// (mode prompts, both drivers, COLLAB.md handoff, per-turn git commits, persistence).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Orchestrator } from '../src/orchestrator.js';

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'duet-orch-'));
const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duet-runs-'));
const orch = new Orchestrator({ runsDir });

orch.on('turn-start', (t) => console.log(`\n>>> TURN ${t.n} — ${t.agent} starting`));
orch.on('turn-end', (t) => console.log(`<<< TURN ${t.n} — ${t.agent} done: ${(t.output||'').replace(/\s+/g,' ').slice(0,90)}`));
orch.on('log', (l) => console.log('   [log]', l));
orch.on('event', (e) => {
  if (e.kind === 'system') console.log(`   [${e.agent} system] ${e.text}`);
  if (e.kind === 'tool') console.log(`   (${e.agent}) ${e.text.slice(0, 80)}`);
});

const done = new Promise((resolve) => {
  orch.on('state', (s) => { if (['done','stopped','error'].includes(s.status)) resolve(s.status); });
});

await orch.start({
  mode: 'peers',
  task: 'Create a Python file calc.py with a function add(a, b) that returns a + b. Then create test_calc.py with one assertion. Keep it tiny.',
  workspace: ws,
  maxRounds: 2,
  roles: { first: 'claude' },
});

const status = await done;
console.log('\n=== FINAL STATUS:', status, '===');
console.log('workspace files:', fs.readdirSync(ws).join(', '));
console.log('\n--- git log ---');
console.log(execFileSync('git', ['log', '--oneline'], { cwd: ws }).toString());
console.log('--- COLLAB.md (tail) ---');
const collab = fs.readFileSync(path.join(ws, 'COLLAB.md'), 'utf8');
console.log(collab.slice(-600));
const transcript = path.join(runsDir, fs.readdirSync(runsDir)[0], 'transcript.json');
console.log('\ntranscript saved:', fs.existsSync(transcript), '→', transcript);
console.log('workspace:', ws);
