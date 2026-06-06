import { spawnJsonl } from './spawnJsonl.js';

/**
 * Driver for the Claude Code CLI in headless (`-p`) stream-json mode.
 *
 * Normalized events are delivered via onEvent with shape:
 *   { agent:'claude', kind, text, raw, ts }
 * where kind ∈ system | reasoning | text | tool | tool_result | status | result | error
 */
export const claudeDriver = {
  agent: 'claude',
  defaultModel: 'opus',

  /**
   * @param {object} o
   * @param {string} o.prompt
   * @param {string} o.cwd
   * @param {string} [o.model]
   * @param {string|null} [o.sessionId]   - resume this session if provided
   * @param {(ev:object)=>void} o.onEvent
   * @param {(child:any)=>void} [o.onChild]
   * @returns {Promise<{sessionId:string|null, finalText:string, ok:boolean}>}
   */
  async run({ prompt, cwd, model, sessionId, onEvent, onChild }) {
    const args = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--model', model || this.defaultModel,
      '--dangerously-skip-permissions',
    ];
    if (sessionId) args.push('--resume', sessionId);

    let capturedSession = sessionId || null;
    let finalText = '';
    let ok = true;

    const emit = (kind, text, raw) =>
      onEvent({ agent: 'claude', kind, text, raw, ts: Date.now() });

    await spawnJsonl({
      command: 'claude',
      args,
      cwd,
      onChild,
      onStderr: (line) => emit('error', line),
      onJson: (obj) => {
        switch (obj.type) {
          case 'system':
            if (obj.subtype === 'init') {
              capturedSession = obj.session_id || capturedSession;
              emit('system', `session ${capturedSession} · model ${obj.model}`, obj);
            } else if (obj.subtype === 'post_turn_summary') {
              if (obj.status_detail) emit('status', obj.status_detail, obj);
            }
            break;
          case 'assistant': {
            const content = obj.message?.content || [];
            for (const block of content) {
              if (block.type === 'text' && block.text) {
                emit('text', block.text, block);
              } else if (block.type === 'tool_use') {
                emit('tool', `${block.name} ${summarizeInput(block.input)}`, block);
              }
            }
            break;
          }
          case 'user': {
            const content = obj.message?.content || [];
            for (const block of content) {
              if (block.type === 'tool_result') {
                emit('tool_result', extractText(block.content), block);
              }
            }
            break;
          }
          case 'result':
            if (obj.session_id) capturedSession = obj.session_id;
            finalText = obj.result || finalText;
            ok = !obj.is_error;
            emit('result', finalText, obj);
            break;
          case 'rate_limit_event':
            // informational only
            break;
          default:
            break;
        }
      },
    });

    return { sessionId: capturedSession, finalText, ok };
  },
};

function summarizeInput(input) {
  if (!input) return '';
  if (input.command) return `$ ${truncate(input.command, 120)}`;
  if (input.file_path) return input.file_path;
  if (input.path) return input.path;
  if (input.pattern) return `/${input.pattern}/`;
  const s = JSON.stringify(input);
  return truncate(s, 120);
}

function extractText(content) {
  if (typeof content === 'string') return truncate(content, 600);
  if (Array.isArray(content)) {
    return truncate(content.map((c) => (typeof c === 'string' ? c : c.text || '')).join(' '), 600);
  }
  return '';
}

function truncate(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n) + '…' : s;
}
