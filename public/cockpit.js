// Cockpit: all the atmosphere — starfield, LED walls, boot sequence, telemetry, SFX.
// app.js calls into window.Cockpit on orchestration events.
(() => {
  const $ = (id) => document.getElementById(id);
  const state = { active: new Set(), warp: 0, targetWarp: 0, sound: false, audio: null };

  // ---------------------------------------------------------- LED dot fields
  function buildLeds() {
    document.querySelectorAll('.led-field').forEach((field) => {
      const rows = +field.dataset.rows || 8;
      const cols = +field.dataset.cols || 12;
      const frag = document.createDocumentFragment();
      field.style.setProperty('--cols', cols);
      for (let i = 0; i < rows * cols; i++) {
        const d = document.createElement('span');
        d.className = 'led';
        // pseudo-random lit state + flicker phase (deterministic-ish, no Math.random ban here)
        const r = Math.random();
        if (r > 0.82) d.classList.add('hot');
        else if (r > 0.5) d.classList.add('warm');
        d.style.setProperty('--ph', (Math.random() * 4).toFixed(2) + 's');
        frag.appendChild(d);
      }
      field.appendChild(frag);
    });
    // occasional random blink to feel alive
    setInterval(() => {
      const leds = document.querySelectorAll('.led-field .led');
      if (!leds.length) return;
      for (let k = 0; k < 6; k++) {
        const led = leds[(Math.random() * leds.length) | 0];
        led.classList.toggle('hot');
      }
    }, 900);
  }

  // ---------------------------------------------------------- wall meters
  function animateMeters() {
    setInterval(() => {
      document.querySelectorAll('[data-meter]').forEach((el) => {
        const v = (Math.random() * 100) | 0;
        el.textContent = String(v).padStart(3, '0');
      });
    }, 1500);
  }

  // ---------------------------------------------------------- starfield
  function starfield() {
    const cv = $('starfield');
    const ctx = cv.getContext('2d');
    let w, h, stars = [];
    function resize() {
      w = cv.width = window.innerWidth;
      h = cv.height = window.innerHeight;
      const n = Math.min(420, Math.floor((w * h) / 4200));
      stars = Array.from({ length: n }, () => newStar(true));
    }
    function newStar(spread) {
      return {
        x: (Math.random() - 0.5) * w,
        y: (Math.random() - 0.5) * h,
        z: spread ? Math.random() * w : w,
        pz: 0,
      };
    }
    function tick() {
      // ease warp toward target
      state.warp += (state.targetWarp - state.warp) * 0.05;
      const cx = w / 2, cy = h * 0.42;
      ctx.fillStyle = 'rgba(6,5,3,' + (0.35 - state.warp * 0.2) + ')';
      ctx.fillRect(0, 0, w, h);
      const speed = 0.6 + state.warp * 22;
      for (const s of stars) {
        s.pz = s.z;
        s.z -= speed;
        if (s.z < 1) Object.assign(s, newStar(false));
        const k = 128 / s.z;
        const x = cx + s.x * k;
        const y = cy + s.y * k;
        const pk = 128 / s.pz;
        const px = cx + s.x * pk;
        const py = cy + s.y * pk;
        if (x < 0 || x > w || y < 0 || y > h) continue;
        const size = (1 - s.z / w) * 2.2;
        const warm = state.warp > 0.15;
        ctx.strokeStyle = warm ? 'rgba(255,210,150,' + (1 - s.z / w) + ')'
                               : 'rgba(255,240,220,' + (1 - s.z / w) * 0.9 + ')';
        ctx.lineWidth = size;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      requestAnimationFrame(tick);
    }
    window.addEventListener('resize', resize);
    resize();
    tick();
  }

  // ---------------------------------------------------------- audio (WebAudio)
  function ensureAudio() {
    if (state.audio) return state.audio;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    const ac = new Ctx();
    const master = ac.createGain();
    master.gain.value = 0.0;
    master.connect(ac.destination);
    // ambient hum: two detuned low oscillators
    const hum = ac.createGain(); hum.gain.value = 0.06; hum.connect(master);
    [55, 55.4, 110].forEach((f, i) => {
      const o = ac.createOscillator();
      o.type = i === 2 ? 'sine' : 'sawtooth';
      o.frequency.value = f;
      const g = ac.createGain(); g.gain.value = i === 2 ? 0.015 : 0.03;
      o.connect(g); g.connect(hum); o.start();
    });
    state.audio = { ac, master };
    return state.audio;
  }
  function blip(freq, dur = 0.08, type = 'square', vol = 0.12) {
    if (!state.sound) return;
    const a = ensureAudio(); if (!a) return;
    const o = a.ac.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = a.ac.createGain();
    g.gain.setValueAtTime(0, a.ac.currentTime);
    g.gain.linearRampToValueAtTime(vol, a.ac.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, a.ac.currentTime + dur);
    o.connect(g); g.connect(a.master); o.start(); o.stop(a.ac.currentTime + dur + 0.02);
  }
  function setSound(on) {
    state.sound = on;
    $('sndState').textContent = on ? 'ON' : 'OFF';
    $('soundBtn').classList.toggle('on', on);
    if (on) {
      const a = ensureAudio(); if (a) { a.ac.resume?.(); a.master.gain.linearRampToValueAtTime(0.5, a.ac.currentTime + 0.4); }
      blip(440, 0.1, 'sine');
    } else if (state.audio) {
      state.audio.master.gain.linearRampToValueAtTime(0, state.audio.ac.currentTime + 0.3);
    }
  }

  // ---------------------------------------------------------- boot sequence
  const BOOT_LINES = [
    'DUET FLIGHT SYSTEMS v1.0',
    'cold-start reactor ............ OK',
    'main bus voltage .............. 28.4V',
    'nav computer .................. ONLINE',
    'agent core CLAUDY (claude) .... LINKED',
    'agent core CODY   (codex)  .... LINKED',
    'comms array .................. OPEN',
    'sublight drive ............... NOMINAL',
    'ALL SYSTEMS ONLINE',
  ];
  function runBoot() {
    const boot = $('boot'); const log = $('bootLog'); const fill = $('bootFill');
    let i = 0, done = false;
    const finish = () => {
      if (done) return; done = true;
      boot.classList.add('gone');
      $('cockpit').classList.add('live');
      setTimeout(() => boot.remove(), 900);
    };
    boot.addEventListener('click', finish);
    const step = () => {
      if (done) return;
      if (i < BOOT_LINES.length) {
        log.textContent += BOOT_LINES[i] + '\n';
        fill.style.width = Math.round(((i + 1) / BOOT_LINES.length) * 100) + '%';
        blip(180 + i * 40, 0.05, 'square', 0.05);
        i++;
        setTimeout(step, 150 + Math.random() * 160);
      } else {
        setTimeout(finish, 550);
      }
    };
    setTimeout(step, 350);
  }

  // ---------------------------------------------------------- telemetry API
  const lamps = { claude: () => $('lampU'), codex: () => $('lampCody') };
  const acts = { claude: () => $('actU'), codex: () => $('actCody') };
  let activityBars;

  function setAgentState(agent, s) {
    const lamp = lamps[agent] && lamps[agent](); if (!lamp) return;
    lamp.className = 'lamp agent ' + s;
    const act = acts[agent]();
    act.textContent = { active: 'WORKING', tool: 'EXEC', think: 'THINKING', idle: 'STANDBY', done: 'DONE' }[s] || s;
    act.dataset.s = s;
    // warp when anyone is active
    if (s === 'active' || s === 'tool' || s === 'think') state.active.add(agent);
    else state.active.delete(agent);
    state.targetWarp = state.active.size ? 1 : 0;
    $('vpGlow').classList.toggle('hot', state.active.size > 0);
  }

  function pulseActivity() {
    activityBars = activityBars || document.querySelectorAll('#gaugeAct .g-bars i');
    activityBars.forEach((b) => { b.style.height = (20 + Math.random() * 80) + '%'; });
  }

  const Cockpit = {
    init() {
      buildLeds();
      animateMeters();
      starfield();
      runBoot();
      $('soundBtn').addEventListener('click', () => setSound(!state.sound));
    },
    // called by app.js
    onEvent(ev) {
      const map = { tool: 'tool', tool_result: 'tool', reasoning: 'think', text: 'active',
                    status: 'active', result: 'active', system: 'active', error: 'tool' };
      if (ev.agent && map[ev.kind]) {
        setAgentState(ev.agent, map[ev.kind]);
        pulseActivity();
        if (ev.kind === 'tool') blip(660, 0.04, 'square', 0.06);
        if (ev.kind === 'result') blip(520, 0.12, 'sine', 0.08);
      }
    },
    onTurnStart(agent) { setAgentState(agent, 'active'); blip(330, 0.09, 'triangle', 0.1); },
    onTurnEnd(agent) { setAgentState(agent, 'idle'); blip(440, 0.06, 'sine', 0.07); },
    onStatus(s) {
      // sync lamps to authoritative state
      if (s.currentAgent) setAgentState(s.currentAgent, 'active');
      if (['done', 'stopped', 'error'].includes(s.status)) {
        ['claude', 'codex'].forEach((a) => setAgentState(a, s.status === 'done' ? 'done' : 'idle'));
        state.targetWarp = 0;
        if (s.status === 'done') { blip(660, 0.15, 'sine', 0.1); setTimeout(() => blip(880, 0.2, 'sine', 0.1), 140); }
      }
      // turns needle
      const ng = document.querySelector('#gaugeTurns .g-needle');
      if (ng && s.maxRounds) ng.style.transform = `rotate(${-90 + Math.min(1, (s.turnCount || 0) / s.maxRounds) * 180}deg)`;
    },
    setSysLamp(cls) { $('lampSys').className = 'lamp ' + cls; },
  };

  window.Cockpit = Cockpit;
  document.addEventListener('DOMContentLoaded', () => Cockpit.init());
})();
