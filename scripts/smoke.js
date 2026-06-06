// Driver smoke test: verifies each driver can (1) drive its CLI autonomously to
// write a file, (2) stream normalized events, and (3) resume its session with memory.
//
//   node scripts/smoke.js          # both
//   node scripts/smoke.js claude   # one
//   node scripts/smoke.js codex
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { claudeDriver } from '../src/drivers/claude.js';
import { codexDriver } from '../src/drivers/codex.js';

const which = process.argv[2];
const drivers = { claude: claudeDriver, codex: codexDriver };
const pick = which ? { [which]: drivers[which] } : drivers;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'duet-smoke-'));
execFileSync('git', ['init', '-q'], { cwd: tmp });
console.log('workspace:', tmp, '\n');

const WORDS = { claude: 'ELDERBERRY', codex: 'KUMQUAT' };

for (const [name, driver] of Object.entries(pick)) {
  if (!driver) { console.log(`skip unknown driver: ${name}`); continue; }
  const word = WORDS[name];
  const file = `${name}_answer.txt`;
  const kinds = new Set();
  const onEvent = (ev) => {
    kinds.add(ev.kind);
    const t = (ev.text || '').replace(/\s+/g, ' ').slice(0, 80);
    process.stdout.write(`  [${name}/${ev.kind}] ${t}\n`);
  };

  console.log(`=== ${name}: turn 1 (autonomous write) ===`);
  const r1 = await driver.run({
    prompt: `Create a file named ${file} whose ONLY contents are the single word ${word}. Then briefly confirm.`,
    cwd: tmp,
    onEvent,
  });
  const wrote = fs.existsSync(path.join(tmp, file)) &&
    fs.readFileSync(path.join(tmp, file), 'utf8').includes(word);
  console.log(`  session=${r1.sessionId} fileWritten=${wrote}`);

  console.log(`=== ${name}: turn 2 (resume memory) ===`);
  const r2 = await driver.run({
    prompt: `Without reading any file, what single word did you just write to ${file}? Reply with only that word.`,
    cwd: tmp,
    sessionId: r1.sessionId,
    onEvent,
  });
  const remembered = (r2.finalText || '').toUpperCase().includes(word);
  console.log(`  resumedSession=${r2.sessionId} remembered=${remembered} reply="${(r2.finalText||'').trim().slice(0,60)}"`);

  console.log(`\n  RESULT ${name}: write=${wrote} resume=${remembered} kinds=[${[...kinds].join(',')}]\n`);
}

console.log('done. workspace left at', tmp);
