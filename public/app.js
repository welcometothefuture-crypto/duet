// ---------------------------------------------------------------- state
let MODES = [];
let selectedMode = null;
const el = (id) => document.getElementById(id);

// ---------------------------------------------------------------- setup
async function loadModes() {
  const { modes } = await fetch('/api/modes').then((r) => r.json());
  MODES = modes;
  const list = el('modeList');
  list.innerHTML = '';
  for (const m of modes) {
    const div = document.createElement('div');
    div.className = 'mode';
    div.dataset.id = m.id;
    div.innerHTML = `<div class="name">${m.label}</div><div class="desc">${m.description}</div>`;
    div.onclick = () => selectMode(m.id);
    list.appendChild(div);
  }
  selectMode(modes[0].id);
}

function selectMode(id) {
  selectedMode = MODES.find((m) => m.id === id);
  document.querySelectorAll('.mode').forEach((d) => d.classList.toggle('selected', d.dataset.id === id));
  renderRoleFields();
}

function renderRoleFields() {
  const box = el('roleFields');
  box.innerHTML = '';
  for (const f of selectedMode.roleFields || []) {
    const wrap = document.createElement('label');
    wrap.className = 'field';
    const span = document.createElement('span');
    span.textContent = f.label;
    wrap.appendChild(span);

    if (f.type === 'agent') {
      const seg = document.createElement('div');
      seg.className = 'seg';
      seg.dataset.key = f.key;
      for (const opt of ['claude', 'codex']) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = opt[0].toUpperCase() + opt.slice(1);
        b.dataset.val = opt;
        b.className = opt === f.default ? 'on' : '';
        b.onclick = () => {
          seg.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
          b.classList.add('on');
        };
        seg.appendChild(b);
      }
      wrap.appendChild(seg);
    } else {
      const input = document.createElement('input');
      input.type = f.type === 'number' ? 'number' : 'text';
      input.value = f.default;
      input.dataset.key = f.key;
      input.className = 'rolefield';
      wrap.appendChild(input);
    }
    box.appendChild(wrap);
  }
}

function collectRoles() {
  const roles = {};
  document.querySelectorAll('#roleFields .seg').forEach((seg) => {
    const on = seg.querySelector('button.on');
    roles[seg.dataset.key] = on ? on.dataset.val : null;
  });
  document.querySelectorAll('#roleFields .rolefield').forEach((inp) => {
    roles[inp.dataset.key] = inp.value;
  });
  return roles;
}

// ---------------------------------------------------------------- model picker
// Custom dropdown styled like the Claude Code / Codex selectors. Click the
// styled button to open a floating menu; click an option to set the hidden input.
// Standard 200k-context options only. The 1M-context Opus variants are
// deliberately excluded — they burn through tokens 5x faster and are easy
// to pick by accident. Sonnet is the default: capable but not ruinous.
const CLAUDE_MODELS = [
  { v: 'sonnet', label: 'Sonnet (latest)',  hint: 'balanced · DEFAULT · 200k ctx' },
  { v: 'haiku',  label: 'Haiku (latest)',   hint: 'fastest & cheapest · 200k ctx' },
  { v: 'opus',   label: 'Opus (latest)',    hint: 'most capable · 200k ctx · pricey' },
];
// Cody is locked to the Codex CLI's own default. Other model ids either
// require API-key auth (gpt-5-codex / o3 / gpt-4o) or have hit availability
// issues on ChatGPT-account auth — the CLI default always works.
const CODEX_MODELS = [
  { v: '', label: '(CLI default)', hint: 'whatever codex selects · only safe option' },
];
const REASONING = [
  { v: 'low',    label: 'Low',    hint: 'fastest' },
  { v: 'medium', label: 'Medium' },
  { v: 'high',   label: 'High',   hint: 'codex CLI default' },
];

let pickerOpenFor = null; // 'claude' | 'codex' | null
const reasoningState = { codex: '' }; // tracked separately, applied at run start

function fmtTok(n) {
  if (!n) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 2 : 1) + 'k';
  return (n / 1_000_000).toFixed(2) + 'M';
}

function openPicker(agent) {
  pickerOpenFor = agent;
  const menu = el('modelMenu');
  const list = el('mmList');
  const reasoningCol = el('mmReasoningCol');
  list.innerHTML = '';
  el('mmTitle').textContent = agent === 'claude' ? 'CLAUDY · MODEL' : 'CODY · MODEL';
  const opts = agent === 'claude' ? CLAUDE_MODELS : CODEX_MODELS;
  const current = (agent === 'claude' ? el('modelClaude').value : el('modelCodex').value) || '';
  let n = 1;
  for (const opt of opts) {
    if (opt.sep) { const s = document.createElement('div'); s.className = 'mm-sep'; list.appendChild(s); continue; }
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'mm-item';
    if (opt.v === current) item.classList.add('on');
    item.innerHTML =
      `<span class="mm-check">${opt.v === current ? '✓' : ''}</span>` +
      `<span class="mm-name">${opt.label}${opt.hint ? `<small> ${opt.hint}</small>` : ''}</span>` +
      `<span class="mm-key">${n}</span>`;
    item.addEventListener('click', () => choosePicker(opt.v, opt.label));
    list.appendChild(item);
    n++;
  }
  // Codex gets a reasoning-effort sub-column.
  if (agent === 'codex') {
    reasoningCol.classList.remove('hidden');
    const rlist = el('mmReasoningList');
    rlist.innerHTML = '';
    let rn = 1;
    for (const r of REASONING) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'mm-item';
      const beta = el('betaMode').checked;
      const effective = beta ? 'low' : (reasoningState.codex || 'high');
      if (r.v === effective) item.classList.add('on');
      item.innerHTML =
        `<span class="mm-check">${r.v === effective ? '✓' : ''}</span>` +
        `<span class="mm-name">${r.label}${r.hint ? `<small> ${r.hint}</small>` : ''}</span>` +
        `<span class="mm-key">${rn}</span>`;
      item.addEventListener('click', () => {
        reasoningState.codex = r.v;
        openPicker('codex'); // re-render with the new selection highlighted
      });
      rlist.appendChild(item);
      rn++;
    }
  } else {
    reasoningCol.classList.add('hidden');
  }
  // Position the menu under the triggering button.
  const btn = el(agent === 'claude' ? 'modelClaudeBtn' : 'modelCodexBtn');
  const r = btn.getBoundingClientRect();
  menu.style.left = `${Math.max(12, r.left)}px`;
  menu.style.top  = `${r.bottom + 6}px`;
  menu.classList.remove('hidden');
  menu.setAttribute('aria-hidden', 'false');
}
function choosePicker(value, label) {
  if (!pickerOpenFor) return;
  const inputId = pickerOpenFor === 'claude' ? 'modelClaude' : 'modelCodex';
  const btnId   = pickerOpenFor === 'claude' ? 'modelClaudeBtn' : 'modelCodexBtn';
  el(inputId).value = value;
  el(btnId).querySelector('.mp-label').textContent = label || value || '(CLI default)';
  closePicker();
}
function closePicker() {
  pickerOpenFor = null;
  el('modelMenu').classList.add('hidden');
  el('modelMenu').setAttribute('aria-hidden', 'true');
}
document.addEventListener('click', (e) => {
  if (!pickerOpenFor) return;
  const menu = el('modelMenu');
  if (menu.contains(e.target)) return;
  if (e.target.closest('.model-pick')) return;
  closePicker();
});
document.addEventListener('keydown', (e) => {
  if (!pickerOpenFor) return;
  if (e.key === 'Escape') return closePicker();
  // 1-9 hotkeys
  const idx = Number(e.key) - 1;
  if (idx >= 0 && idx < 9) {
    const items = el('mmList').querySelectorAll('.mm-item');
    if (items[idx]) items[idx].click();
  }
});

// Beta = lowest compute. Reflect it in the model fields so the choice is visible.
function applyBeta() {
  const beta = el('betaMode').checked;
  document.querySelector('.beta-toggle').classList.toggle('off', !beta);
  const mcBtn = el('modelClaudeBtn'), mxBtn = el('modelCodexBtn');
  const mc = el('modelClaude'), mx = el('modelCodex');
  // Cody is always (CLI default) — leave it alone. Only toggle Claudy + reasoning hint.
  mx.value = '';
  mxBtn.querySelector('.mp-label').textContent =
    beta ? '(CLI default · low reasoning)' : '(CLI default)';
  if (beta) {
    mc.value = 'haiku'; mcBtn.querySelector('.mp-label').textContent = 'haiku (beta)';
    mcBtn.disabled = true; mcBtn.classList.add('locked');
  } else {
    if (mc.value === 'haiku' || !mc.value) { mc.value = 'sonnet'; mcBtn.querySelector('.mp-label').textContent = 'sonnet'; }
    mcBtn.disabled = false; mcBtn.classList.remove('locked');
  }
  const hint = el('modelHint');
  if (hint) {
    hint.textContent = beta
      ? 'Claudy → haiku  ·  Cody → low reasoning effort  ·  fastest & cheapest tier'
      : 'Sonnet is the default — balanced and cost-safe. Aliases auto-track the latest standard (200k context) version. Cody uses your Codex CLI default.';
  }
}

async function startRun() {
  el('startErr').textContent = '';
  const task = el('task').value.trim();
  if (!task) { el('startErr').textContent = 'Please describe the task.'; return; }
  const beta = el('betaMode').checked;
  const body = {
    mode: selectedMode.id,
    task,
    beta,
    workspace: el('workspace').value.trim() || './workspace',
    maxRounds: Number(el('maxRounds').value) || 8,
    // When beta, leave models blank so the server applies the low-compute defaults.
    models: beta
      ? { claude: '', codex: '' }
      : { claude: el('modelClaude').value.trim() || 'opus', codex: el('modelCodex').value.trim() },
    // Reasoning effort override for Codex (applied per-turn on the CLI).
    reasoningEffort: beta ? { codex: 'low' } : (reasoningState.codex ? { codex: reasoningState.codex } : {}),
    roles: collectRoles(),
  };
  const res = await fetch('/api/start', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then((r) => r.json());
  if (!res.ok) { el('startErr').textContent = res.error || 'Failed to start.'; return; }
  showRun();
}

// ---------------------------------------------------------------- views
function showRun() {
  el('setup').classList.add('hidden');
  el('run').classList.remove('hidden');
}
function showSetup() {
  el('run').classList.add('hidden');
  el('setup').classList.remove('hidden');
}

// ---------------------------------------------------------------- render
const streams = { claude: () => el('streamClaude'), codex: () => el('streamCodex') };

function appendEvent(ev) {
  const col = streams[ev.agent] && streams[ev.agent]();
  if (!col) return;
  const div = document.createElement('div');
  div.className = `ev ${ev.kind}`;
  const label = ev.kind === 'tool' ? 'tool' : ev.kind === 'tool_result' ? 'result' : ev.kind;
  div.innerHTML = `<span class="k">${label}</span>`;
  div.appendChild(document.createTextNode(ev.text || ''));
  const atBottom = col.scrollHeight - col.scrollTop - col.clientHeight < 60;
  col.appendChild(div);
  if (atBottom) col.scrollTop = col.scrollHeight;
  window.Cockpit && window.Cockpit.onEvent(ev);
}

const SYSLAMP = { running: 'active', paused: 'think', done: 'done', stopped: 'idle', error: 'tool', idle: 'idle' };
let lastStatus = 'idle';
function setStatus(s) {
  const st = s.status || 'idle';
  el('hudStatus').textContent = st.toUpperCase();
  el('lampSys').className = 'lamp ' + (SYSLAMP[st] || 'idle');
  el('hudTurn').textContent = st === 'idle' ? '' :
    `T${s.turnCount || 0}/${s.maxRounds || ''}${s.beta ? ' ·⚡' : ''}`;
  if (s.mode) {
    const m = MODES.find((x) => x.id === s.mode);
    el('runMode').textContent = m ? m.label : s.mode;
  }
  el('runTurn').textContent = `turn ${s.turnCount || 0}/${s.maxRounds || ''}` +
    (s.beta ? ' · beta' : '') + (s.currentAgent ? ` · ${s.currentAgent}` : '');
  if (s.task) el('runTask').textContent = s.task;
  if (s.models) {
    el('subU').textContent = 'claude' + (s.models.claude ? ` · ${s.models.claude}` : '');
    el('subCody').textContent = 'codex' + (s.models.codex ? ` · ${s.models.codex}` : (s.beta ? ' · low' : ''));
  }
  // Token meters
  if (s.tokens) {
    el('tokU').textContent    = `${fmtTok(s.tokens.claude?.total || 0)} tok`;
    el('tokCody').textContent = `${fmtTok(s.tokens.codex?.total || 0)} tok`;
    el('tokGrand').textContent = fmtTok(s.tokens.grand || 0);
  }
  const paused = st === 'paused';
  el('pauseBtn').textContent = paused ? 'RESUME' : 'HOLD';
  el('pauseBtn').dataset.paused = paused ? '1' : '';
  renderTimeline(s);
  window.Cockpit && window.Cockpit.onStatus(s);

  // When the run transitions to a terminal state, pop the completion modal.
  const wasActive = lastStatus === 'running' || lastStatus === 'paused';
  if (wasActive && (st === 'done' || st === 'stopped' || st === 'error')) {
    showDoneModal(s);
  }
  // Hide the modal again the moment a new run starts.
  if (st === 'running' && lastStatus !== 'running') hideDoneModal();
  lastStatus = st;
}

// ---------------------------------------------------------------- done modal
function showDoneModal(s) {
  const dm = el('doneModal');
  const title = el('dmTitle');
  if (s.status === 'done')   title.textContent = '▰▰▰  MISSION COMPLETE  ▰▰▰';
  if (s.status === 'stopped') title.textContent = '✕  RUN ABORTED';
  if (s.status === 'error')  title.textContent = '⚠  ERROR · RUN HALTED';
  const t = s.tokens || {};
  el('dmSummary').innerHTML =
    `<div class="dm-row"><span>turns</span><b>${s.turnCount}/${s.maxRounds}</b></div>` +
    `<div class="dm-row"><span>Claudy</span><b>${fmtTok(t.claude?.total || 0)} tok</b></div>` +
    `<div class="dm-row"><span>Cody</span><b>${fmtTok(t.codex?.total || 0)} tok</b></div>` +
    `<div class="dm-row total"><span>total</span><b>${fmtTok(t.grand || 0)} tok</b></div>`;
  dm.classList.remove('hidden');
}
function hideDoneModal() { el('doneModal').classList.add('hidden'); }
async function extendRun() {
  const n = Math.max(1, Number(el('extendTurns').value) || 4);
  const res = await fetch('/api/extend', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ turns: n }),
  }).then((r) => r.json()).catch(() => ({ ok: false }));
  if (res.ok) hideDoneModal();
  else addLog(`extend failed: ${res.error || 'unknown'}`);
}

let knownTurns = [];
function renderTimeline(s) {
  const tl = el('timeline');
  tl.innerHTML = '';
  for (const t of knownTurns) {
    const d = document.createElement('div');
    d.className = `tl-item ${t.agent}`;
    d.innerHTML = `<span class="who">${t.agent}</span><span>turn ${t.n}</span>`;
    tl.appendChild(d);
  }
  if (s.currentAgent && s.status === 'running') {
    const d = document.createElement('div');
    d.className = `tl-item ${s.currentAgent} active`;
    d.innerHTML = `<span class="who">${s.currentAgent}</span><span>working…</span>`;
    tl.appendChild(d);
  }
  tl.scrollTop = tl.scrollHeight;
}

function addLog(line) {
  const feed = el('logFeed');
  const d = document.createElement('div');
  d.textContent = line;
  feed.appendChild(d);
  if (feed.children.length > 200) feed.removeChild(feed.firstChild);
  feed.scrollTop = feed.scrollHeight;
}

// ---------------------------------------------------------------- repo poll
async function pollRepo() {
  try {
    const info = await fetch('/api/repo').then((r) => r.json());
    el('repoLog').textContent =
      (info.log || '(no commits yet)') + '\n\n— HEAD —\n' + (info.diffstat || '');
  } catch {}
}
setInterval(pollRepo, 4000);

// ---------------------------------------------------------------- websocket
function connect() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onmessage = (e) => {
    const { type, payload } = JSON.parse(e.data);
    if (type === 'snapshot') {
      knownTurns = payload.turns || [];
      if (payload.state && payload.state.status && payload.state.status !== 'idle') {
        showRun();
        for (const ev of payload.events || []) appendEvent(ev);
      }
      setStatus(payload.state || { status: 'idle' });
    } else if (type === 'event') {
      appendEvent(payload);
    } else if (type === 'state') {
      setStatus(payload);
    } else if (type === 'turn-start') {
      window.Cockpit && window.Cockpit.onTurnStart(payload.agent);
    } else if (type === 'turn-end') {
      knownTurns.push({ n: payload.n, agent: payload.agent });
      window.Cockpit && window.Cockpit.onTurnEnd(payload.agent);
    } else if (type === 'log') {
      addLog(payload.line);
    }
  };
  ws.onclose = () => setTimeout(connect, 1500);
}

// ---------------------------------------------------------------- controls
async function post(path, body) {
  await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

el('startBtn').onclick = startRun;
el('stopBtn').onclick = () => post('/api/stop');
el('pauseBtn').onclick = () => {
  const paused = el('pauseBtn').dataset.paused === '1';
  post(paused ? '/api/resume' : '/api/pause');
};
el('injectBtn').onclick = () => {
  const t = el('injectText').value.trim();
  if (t) { post('/api/inject', { text: t }); el('injectText').value = ''; addLog(`you → ${t}`); }
};
el('injectText').addEventListener('keydown', (e) => { if (e.key === 'Enter') el('injectBtn').click(); });
el('newBtn').onclick = () => {
  knownTurns = [];
  el('streamClaude').innerHTML = '';
  el('streamCodex').innerHTML = '';
  showSetup();
};

el('betaMode').addEventListener('change', applyBeta);

// Model picker buttons
el('modelClaudeBtn').addEventListener('click', (e) => {
  if (e.currentTarget.disabled) return;
  e.stopPropagation(); openPicker('claude');
});
el('modelCodexBtn').addEventListener('click', (e) => {
  if (e.currentTarget.disabled) return;  // Cody is permanently locked
  e.stopPropagation(); openPicker('codex');
});

// Completion modal
el('extendBtn').addEventListener('click', extendRun);
el('dmCloseBtn').addEventListener('click', hideDoneModal);
el('extendTurns').addEventListener('keydown', (e) => { if (e.key === 'Enter') extendRun(); });

// ---------------------------------------------------------------- boot
loadModes();
applyBeta();
connect();
pollRepo();
