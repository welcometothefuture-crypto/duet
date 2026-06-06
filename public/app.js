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

// Beta = lowest compute. Reflect it in the model fields so the choice is visible.
function applyBeta() {
  const beta = el('betaMode').checked;
  document.querySelector('.beta-toggle').classList.toggle('off', !beta);
  const mc = el('modelClaude'), mx = el('modelCodex');
  if (beta) {
    mc.value = 'haiku'; mc.disabled = true;
    mx.value = ''; mx.placeholder = 'low reasoning effort'; mx.disabled = true;
  } else {
    // Restore to a capable default if it was locked to the beta value.
    if (mc.value === 'haiku' || !mc.value) mc.value = 'opus';
    mc.disabled = false;
    mx.placeholder = '(CLI default)'; mx.disabled = false;
  }
  // Update the hint line under the model row
  const hint = el('modelHint');
  if (hint) {
    hint.textContent = beta
      ? 'U → claude-3-5-haiku  ·  Cody → low reasoning effort  ·  fastest & cheapest tier'
      : 'Type a model alias (haiku / sonnet / opus) or a full ID (claude-sonnet-4-20250514)';
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
  const paused = st === 'paused';
  el('pauseBtn').textContent = paused ? 'RESUME' : 'HOLD';
  el('pauseBtn').dataset.paused = paused ? '1' : '';
  renderTimeline(s);
  window.Cockpit && window.Cockpit.onStatus(s);
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

// ---------------------------------------------------------------- boot
loadModes();
applyBeta();
connect();
pollRepo();
