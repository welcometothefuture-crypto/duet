import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Orchestrator } from './src/orchestrator.js';
import { listModes } from './src/modes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4317;

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const orch = new Orchestrator({ runsDir: path.join(__dirname, 'runs') });

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// ----- broadcast every orchestrator event to all connected dashboards -----
function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}
orch.on('event', (ev) => broadcast('event', ev));
orch.on('state', (s) => broadcast('state', s));
orch.on('log', (line) => broadcast('log', { line, ts: Date.now() }));
orch.on('turn-start', (t) => broadcast('turn-start', t));
orch.on('turn-end', (t) => broadcast('turn-end', t));

wss.on('connection', (ws) => {
  // Send a full snapshot so a late-joining client can render current state.
  ws.send(JSON.stringify({ type: 'snapshot', payload: orch.snapshot() }));
});

// ------------------------------------------------------------------ REST
app.get('/api/modes', (req, res) => res.json({ modes: listModes() }));

app.get('/api/state', (req, res) => res.json(orch.snapshot()));

app.get('/api/repo', async (req, res) => {
  res.json(await orch.repoInfo());
});

app.post('/api/start', async (req, res) => {
  try {
    const out = await orch.start(req.body || {});
    res.json({ ok: true, ...out });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err.message || err) });
  }
});

app.post('/api/pause', (req, res) => { orch.pause(); res.json({ ok: true }); });
app.post('/api/resume', (req, res) => { orch.resume(); res.json({ ok: true }); });
app.post('/api/stop', (req, res) => { orch.stop(); res.json({ ok: true }); });
app.post('/api/inject', (req, res) => {
  orch.inject((req.body && req.body.text) || '');
  res.json({ ok: true });
});

server.listen(PORT, () => {
  console.log(`\n  Duet dashboard → http://localhost:${PORT}\n`);
});
