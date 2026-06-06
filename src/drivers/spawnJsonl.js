import { spawn } from 'node:child_process';

/**
 * Spawn a CLI process and parse its stdout as JSONL (one JSON object per line).
 *
 * @param {object} opts
 * @param {string} opts.command          - executable name
 * @param {string[]} opts.args           - argv
 * @param {string} opts.cwd              - working directory
 * @param {(obj:any)=>void} opts.onJson  - called for every parsed stdout JSON line
 * @param {(line:string)=>void} [opts.onStderr] - called for every stderr line
 * @param {(child:import('node:child_process').ChildProcess)=>void} [opts.onChild] - receive the child handle (for kill)
 * @returns {Promise<{code:number}>}
 */
export function spawnJsonl({ command, args, cwd, env, onJson, onStderr, onChild }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...(env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (onChild) onChild(child);

    let outBuf = '';
    let errBuf = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      outBuf += chunk;
      let nl;
      while ((nl = outBuf.indexOf('\n')) !== -1) {
        const line = outBuf.slice(0, nl).trim();
        outBuf = outBuf.slice(nl + 1);
        if (!line) continue;
        try {
          onJson(JSON.parse(line));
        } catch {
          // Non-JSON line on stdout — surface as stderr-style text.
          if (onStderr) onStderr(line);
        }
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      errBuf += chunk;
      let nl;
      while ((nl = errBuf.indexOf('\n')) !== -1) {
        const line = errBuf.slice(0, nl).trim();
        errBuf = errBuf.slice(nl + 1);
        if (line && onStderr) onStderr(line);
      }
    });

    child.on('error', reject);
    child.on('close', (code) => {
      // Flush any trailing partial line.
      const tail = outBuf.trim();
      if (tail) {
        try { onJson(JSON.parse(tail)); } catch { if (onStderr) onStderr(tail); }
      }
      resolve({ code: code ?? 0 });
    });
  });
}
