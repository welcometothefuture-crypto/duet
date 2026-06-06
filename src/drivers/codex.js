import { spawnJsonl } from './spawnJsonl.js';

/**
 * Driver for the OpenAI Codex CLI in headless (`codex exec`) JSON mode.
 *
 * Normalized events: { agent:'codex', kind, text, raw, ts }
 * Codex's session id is the `thread_id` from the `thread.started` event.
 */
export const codexDriver = {
  agent: 'codex',
  defaultModel: null, // use Codex CLI default unless overridden

  /**
   * @param {object} o
   * @param {string} o.prompt
   * @param {string} o.cwd
   * @param {string} [o.model]
   * @param {string|null} [o.sessionId]
   * @param {(ev:object)=>void} o.onEvent
   * @param {(child:any)=>void} [o.onChild]
   * @returns {Promise<{sessionId:string|null, finalText:string, ok:boolean}>}
   */
  async run({ prompt, cwd, model, sessionId, reasoningEffort, onEvent, onChild }) {
    // Common flags for autonomous, non-interactive operation inside the sandbox folder.
    // NOTE: cwd is set via the spawned process (see spawnJsonl), not `-C` — the
    // `exec resume` subcommand does not accept `-C` and filters sessions by cwd.
    const common = [
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      '--skip-git-repo-check',
    ];
    if (model) common.push('-m', model);
    // Lower compute by overriding reasoning effort (Codex defaults to "high").
    // "minimal" is rejected by Codex's tool set, so "low" is the practical floor.
    if (reasoningEffort) common.push('-c', `model_reasoning_effort="${reasoningEffort}"`);

    const args = sessionId
      ? ['exec', 'resume', sessionId, prompt, ...common]
      : ['exec', prompt, ...common];

    let capturedSession = sessionId || null;
    let finalText = '';
    let ok = true;

    const emit = (kind, text, raw) =>
      onEvent({ agent: 'codex', kind, text, raw, ts: Date.now() });

    await spawnJsonl({
      command: 'codex',
      args,
      cwd,
      onChild,
      onStderr: (line) => {
        // Codex prints a benign "Reading additional input from stdin..." notice; ignore it.
        if (/Reading additional input/i.test(line)) return;
        emit('error', line);
      },
      onJson: (obj) => {
        switch (obj.type) {
          case 'thread.started':
            capturedSession = obj.thread_id || capturedSession;
            emit('system', `thread ${capturedSession}`, obj);
            break;
          case 'turn.started':
            break;
          case 'item.started':
          case 'item.completed': {
            const item = obj.item || {};
            const done = obj.type === 'item.completed';
            switch (item.type) {
              case 'agent_message':
                if (done && item.text) {
                  finalText = item.text;
                  emit('text', item.text, item);
                }
                break;
              case 'reasoning':
                if (done && item.text) emit('reasoning', item.text, item);
                break;
              case 'command_execution':
                if (!done) {
                  emit('tool', `$ ${truncate(stripShell(item.command), 140)}`, item);
                } else {
                  const out = (item.aggregated_output || '').trim();
                  emit('tool_result', `exit ${item.exit_code}${out ? ' · ' + truncate(out, 400) : ''}`, item);
                }
                break;
              case 'file_change':
              case 'patch':
                if (done) emit('tool', describeFileChange(item), item);
                break;
              case 'error':
                ok = false;
                emit('error', item.message || JSON.stringify(item), item);
                break;
              default:
                if (done && item.text) emit('text', item.text, item);
                break;
            }
            break;
          }
          case 'turn.completed':
            emit('result', finalText, obj);
            break;
          case 'turn.failed':
          case 'error':
            ok = false;
            emit('error', obj.message || obj.error || JSON.stringify(obj), obj);
            break;
          default:
            break;
        }
      },
    });

    return { sessionId: capturedSession, finalText, ok };
  },
};

function stripShell(cmd) {
  if (!cmd) return '';
  // Unwrap `/bin/zsh -lc '...'` to show the inner command.
  const m = String(cmd).match(/-lc\s+'([\s\S]*)'\s*$/);
  return m ? m[1] : String(cmd);
}

function describeFileChange(item) {
  const files = item.files || item.changes || [];
  if (Array.isArray(files) && files.length) {
    return 'edit ' + files.map((f) => f.path || f.file || '').filter(Boolean).join(', ');
  }
  return 'file change';
}

function truncate(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n) + '…' : s;
}
