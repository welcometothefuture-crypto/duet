// Cockpit: all the atmosphere — starfield, LED walls, boot sequence, telemetry, SFX.
// app.js calls into window.Cockpit on orchestration events.
(() => {
  const $ = (id) => document.getElementById(id);

  // Visual phenomena tied to backend events. The viewport is no longer a passive
  // starfield — it's a living instrument that reacts to what the agents are doing.
  // - Stars warp faster when agents are busy (token-rate driven)
  // - A central CORE pulses in the active agent's color (amber/teal)
  // - Each event spawns visible space phenomena:
  //     tool/tool_result → expanding ring burst
  //     reasoning        → slow nebula shimmer
  //     text             → trailing particle stream
  //     usage            → faint shockwave whose radius scales with the token delta
  //     turn-start       → "jump" pulse + nebula color shift
  //     turn-end         → soft fade
  //     done             → multi-ring celebration
  //     error            → red flash
  const AGENT_COLOR = {
    claude: [255, 209, 122],   // Claudy amber
    codex:  [111, 226, 210],   // Cody teal
  };
  const state = {
    active: new Set(), warp: 0, targetWarp: 0, sound: false, audio: null,
    bursts: [],       // {x,y,r,maxR,life,age,color,thickness}
    particles: [],    // {x,y,vx,vy,age,life,color,size}
    core: { color: [180, 170, 150], targetColor: [180, 170, 150], intensity: 0.25, targetIntensity: 0.18, phase: 0 },
    nebula: { hue: 30, targetHue: 30, alpha: 0.06, targetAlpha: 0.05 },
    tokenPulse: 0,   // decays after each usage event
    spinPhase: 0,    // for slow swirl
  };

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

  // ---------------------------------------------------------- starfield + reactive viz
  function starfield() {
    const cv = $('starfield');
    const ctx = cv.getContext('2d');
    let w, h, stars = [];
    function resize() {
      w = cv.width = window.innerWidth;
      h = cv.height = window.innerHeight;
      const n = Math.min(560, Math.floor((w * h) / 3400));
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
    function lerp(a, b, t) { return a + (b - a) * t; }
    function lerpColor(a, b, t) {
      return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
    }
    function rgba(c, a) { return `rgba(${c[0]|0},${c[1]|0},${c[2]|0},${a})`; }

    function tick() {
      // ----- ease global state -----
      state.warp += (state.targetWarp - state.warp) * 0.05;
      state.tokenPulse *= 0.94; // decay token shockwave
      state.spinPhase += 0.0009;
      const c = state.core;
      c.color = lerpColor(c.color, c.targetColor, 0.06);
      c.intensity = lerp(c.intensity, c.targetIntensity + Math.sin(c.phase) * 0.05, 0.08);
      c.phase += 0.04 + state.warp * 0.05;
      state.nebula.hue   = lerp(state.nebula.hue, state.nebula.targetHue, 0.02);
      state.nebula.alpha = lerp(state.nebula.alpha, state.nebula.targetAlpha, 0.04);

      const cx = w / 2, cy = h * 0.42;

      // ----- 1. background fade (deeper black when warping) -----
      ctx.fillStyle = `rgba(6,5,3,${0.38 - state.warp * 0.22})`;
      ctx.fillRect(0, 0, w, h);

      // ----- 2. nebula clouds (slow drifting hue-shifted gradient) -----
      const nebRad = Math.max(w, h) * 0.6;
      const ng = ctx.createRadialGradient(
        cx + Math.sin(state.spinPhase * 6) * 60,
        cy + Math.cos(state.spinPhase * 5) * 40,
        20, cx, cy, nebRad,
      );
      const h1 = state.nebula.hue;
      ng.addColorStop(0,   `hsla(${h1},70%,55%,${state.nebula.alpha * 1.4})`);
      ng.addColorStop(0.4, `hsla(${(h1 + 40) % 360},65%,45%,${state.nebula.alpha * 0.8})`);
      ng.addColorStop(1,   `hsla(${(h1 + 80) % 360},60%,15%,0)`);
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = ng;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';

      // ----- 3. central CORE (the "agent reactor") -----
      const coreR = 22 + c.intensity * 80 + state.tokenPulse * 60;
      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      cg.addColorStop(0,   rgba(c.color, 0.55 + c.intensity * 0.3));
      cg.addColorStop(0.4, rgba(c.color, 0.18));
      cg.addColorStop(1,   rgba(c.color, 0));
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';

      // ----- 4. stars (warp drive) -----
      const speed = 0.6 + state.warp * 22 + state.tokenPulse * 14;
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
        const size = (1 - s.z / w) * 2.4;
        const t = 1 - s.z / w;
        // Stars tint toward the active agent when one is working
        const tinted = state.active.size > 0;
        const col = tinted ? c.color : [255, 240, 220];
        ctx.strokeStyle = rgba(col, t * (tinted ? 1 : 0.9));
        ctx.lineWidth = size;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(x, y);
        ctx.stroke();
      }

      // ----- 5. expanding ring bursts (tool calls, results, jumps, completions) -----
      ctx.globalCompositeOperation = 'lighter';
      for (let i = state.bursts.length - 1; i >= 0; i--) {
        const b = state.bursts[i];
        b.age++;
        if (b.age >= b.life) { state.bursts.splice(i, 1); continue; }
        const t = b.age / b.life;
        const r = b.r + (b.maxR - b.r) * easeOut(t);
        const a = (1 - t) * (b.alpha || 0.55);
        ctx.strokeStyle = rgba(b.color, a);
        ctx.lineWidth = b.thickness * (1 - t * 0.7);
        ctx.beginPath();
        ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
        ctx.stroke();
        // double ring for celebratory bursts
        if (b.double) {
          ctx.strokeStyle = rgba(b.color, a * 0.5);
          ctx.beginPath();
          ctx.arc(b.x, b.y, r * 0.6, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // ----- 6. particle stream (text events drift outward + curl) -----
      for (let i = state.particles.length - 1; i >= 0; i--) {
        const p = state.particles[i];
        p.age++;
        if (p.age >= p.life) { state.particles.splice(i, 1); continue; }
        // gentle curl toward the spin direction
        const angle = Math.atan2(p.y - cy, p.x - cx) + 0.012;
        const dist = Math.hypot(p.x - cx, p.y - cy) + 0.5;
        p.x = cx + Math.cos(angle) * dist + p.vx;
        p.y = cy + Math.sin(angle) * dist + p.vy;
        p.vx *= 0.985; p.vy *= 0.985;
        const a = (1 - p.age / p.life) * 0.9;
        ctx.fillStyle = rgba(p.color, a);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      requestAnimationFrame(tick);
    }
    function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

    window.addEventListener('resize', resize);
    resize();
    tick();
  }

  // ---------------------------------------------------------- visual hooks
  function viewportCenter() {
    return { cx: window.innerWidth / 2, cy: window.innerHeight * 0.42 };
  }
  function spawnBurst(color, opts = {}) {
    const { cx, cy } = viewportCenter();
    state.bursts.push({
      x: opts.x ?? cx, y: opts.y ?? cy,
      r: opts.r0 ?? 8, maxR: opts.maxR ?? 220,
      color, life: opts.life ?? 70, age: 0,
      thickness: opts.thickness ?? 2.2,
      alpha: opts.alpha ?? 0.55,
      double: opts.double || false,
    });
    if (state.bursts.length > 80) state.bursts.splice(0, state.bursts.length - 80);
  }
  function spawnParticles(color, n, vel = 1.4) {
    const { cx, cy } = viewportCenter();
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const v = vel * (0.5 + Math.random());
      state.particles.push({
        x: cx + Math.cos(ang) * 8,
        y: cy + Math.sin(ang) * 8,
        vx: Math.cos(ang) * v,
        vy: Math.sin(ang) * v,
        age: 0, life: 80 + Math.random() * 40,
        color, size: 0.8 + Math.random() * 1.4,
      });
    }
    if (state.particles.length > 400) state.particles.splice(0, state.particles.length - 400);
  }
  function colorFor(agent) {
    return AGENT_COLOR[agent] || [200, 200, 200];
  }
  // Map event kinds → visible space phenomena
  function pulse(agent, kind, magnitude = 1) {
    const c = colorFor(agent);
    switch (kind) {
      case 'tool':
      case 'tool_result':
        spawnBurst(c, { maxR: 180 + magnitude * 60, life: 55, thickness: 2.6 });
        break;
      case 'reasoning':
        // Wider, dimmer, slower halo
        spawnBurst(c, { maxR: 280, life: 110, thickness: 1.2, alpha: 0.3 });
        break;
      case 'text':
        spawnParticles(c, 14, 1.6);
        break;
      case 'result':
        spawnBurst(c, { maxR: 320, life: 90, thickness: 3, alpha: 0.7, double: true });
        spawnParticles(c, 22, 2.4);
        break;
      case 'usage':
        // Magnitude scales with token delta (clamped); also bumps warp briefly
        state.tokenPulse = Math.min(1.6, state.tokenPulse + Math.min(0.6, magnitude));
        spawnBurst(c, { maxR: 120 + magnitude * 200, life: 38, thickness: 1.4, alpha: 0.45 });
        break;
      case 'error':
        spawnBurst([255, 100, 80], { maxR: 260, life: 60, thickness: 3.5, alpha: 0.85, double: true });
        break;
      case 'jump':
        spawnBurst(c, { maxR: 380, life: 70, thickness: 3.2, alpha: 0.7, double: true });
        spawnParticles(c, 30, 3);
        break;
      case 'celebrate':
        // Done — fire a sequence over a few frames
        for (let i = 0; i < 5; i++) {
          setTimeout(() => {
            spawnBurst([255, 215, 130], { maxR: 380, life: 120, thickness: 2.4, alpha: 0.55, double: true });
            spawnBurst([111, 226, 210], { maxR: 320, life: 110, thickness: 2, alpha: 0.45 });
            spawnParticles([255, 215, 130], 18, 2.2);
            spawnParticles([111, 226, 210], 14, 1.8);
          }, i * 180);
        }
        break;
    }
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

    // Color the reactor core + nebula by the active agent.
    if (state.active.size > 0) {
      const a = [...state.active].pop();           // most recent
      state.core.targetColor = AGENT_COLOR[a] || [180, 170, 150];
      state.core.targetIntensity = 0.6;
      state.nebula.targetHue   = a === 'claude' ? 32 : 168;
      state.nebula.targetAlpha = 0.12;
    } else {
      state.core.targetColor = [120, 110, 95];
      state.core.targetIntensity = 0.18;
      state.nebula.targetAlpha = 0.05;
    }
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
      const lampMap = { tool: 'tool', tool_result: 'tool', reasoning: 'think', text: 'active',
                        status: 'active', result: 'active', system: 'active', error: 'tool', usage: 'active' };
      if (ev.agent && lampMap[ev.kind]) {
        setAgentState(ev.agent, lampMap[ev.kind]);
        pulseActivity();
        if (ev.kind === 'tool') blip(660, 0.04, 'square', 0.06);
        if (ev.kind === 'result') blip(520, 0.12, 'sine', 0.08);
        if (ev.kind === 'error') blip(180, 0.18, 'sawtooth', 0.1);
      }
      // Drive the cosmic visualization from the same event stream.
      if (ev.agent) {
        let mag = 1;
        if (ev.kind === 'usage' && ev.raw) {
          // Magnitude = total tokens this turn, log-scaled to keep big runs bounded.
          mag = Math.log10(((ev.raw.total) || 1) + 9) / 4; // ≈0 (1 tok) → ~1.5 (100k)
        }
        pulse(ev.agent, ev.kind, mag);
      }
    },
    onTurnStart(agent) {
      setAgentState(agent, 'active');
      pulse(agent, 'jump');
      blip(330, 0.09, 'triangle', 0.1);
      setTimeout(() => blip(495, 0.07, 'triangle', 0.08), 120);
    },
    onTurnEnd(agent) {
      setAgentState(agent, 'idle');
      blip(440, 0.06, 'sine', 0.07);
    },
    onStatus(s) {
      // sync lamps to authoritative state
      if (s.currentAgent) setAgentState(s.currentAgent, 'active');
      if (['done', 'stopped', 'error'].includes(s.status)) {
        ['claude', 'codex'].forEach((a) => setAgentState(a, s.status === 'done' ? 'done' : 'idle'));
        state.targetWarp = 0;
        if (s.status === 'done') {
          pulse('claude', 'celebrate');
          blip(660, 0.15, 'sine', 0.1);
          setTimeout(() => blip(880, 0.2, 'sine', 0.1), 140);
          setTimeout(() => blip(1100, 0.25, 'sine', 0.09), 320);
        } else if (s.status === 'error') {
          pulse('claude', 'error');
        }
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
