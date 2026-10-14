/**
 * BeYou Studio — Pro Drum Machine v2
 * Full 16-step / 8-pad drum machine with:
 * - Synthesized drum sounds (no file loading)
 * - Multiple drum kits (Trap, Acoustic, Electronic, Lo-Fi, 808)
 * - Per-step velocity control
 * - Swing / shuffle
 * - Real-time pattern playback synced to main BPM
 * - Pattern copy/paste, randomize, humanize
 * - Solo/mute per pad
 */

'use strict';

/* ─── Drum Kit Definitions ───────────────────────────────────────────────── */

const DRUM_KITS = {
  'Trap': {
    color: '#ffffff',
    pads: [
      { name: 'Kick 808', color: '#ffffff', synth: 'kick808' },
      { name: 'Snare',    color: '#a1a1aa', synth: 'snare' },
      { name: 'Hi-Hat C', color: '#ffffff', synth: 'hihatClosed' },
      { name: 'Hi-Hat O', color: '#8d8d95', synth: 'hihatOpen' },
      { name: 'Clap',     color: '#52525b', synth: 'clap' },
      { name: 'Tom Lo',   color: '#a1a1aa', synth: 'tomLo' },
      { name: '808 Bass', color: '#f59e0b', synth: 'bass808' },
      { name: 'Crash',    color: '#ffffff', synth: 'crash' },
    ]
  },
  'Acoustic': {
    color: '#a1a1aa',
    pads: [
      { name: 'Kick',     color: '#e4e4e7', synth: 'kickAcoustic' },
      { name: 'Snare',    color: '#a1a1aa', synth: 'snareAcoustic' },
      { name: 'Hi-Hat C', color: '#ffffff', synth: 'hihatClosed' },
      { name: 'Hi-Hat O', color: '#8d8d95', synth: 'hihatOpen' },
      { name: 'Ride',     color: '#fbbf24', synth: 'ride' },
      { name: 'Tom Hi',   color: '#34d399', synth: 'tomHi' },
      { name: 'Tom Lo',   color: '#a1a1aa', synth: 'tomLo' },
      { name: 'Crash',    color: '#ffffff', synth: 'crash' },
    ]
  },
  'Electronic': {
    color: '#ffffff',
    pads: [
      { name: 'E-Kick',   color: '#ffffff', synth: 'kickElec' },
      { name: 'E-Snare',  color: '#8b5cf6', synth: 'snareElec' },
      { name: 'Hi-Hat',   color: '#ffffff', synth: 'hihatElec' },
      { name: 'Clap',     color: '#52525b', synth: 'clap' },
      { name: 'Cowbell',  color: '#fbbf24', synth: 'cowbell' },
      { name: 'Noise Hit',color: '#94a3b8', synth: 'noiseHit' },
      { name: 'Zap',      color: '#a78bfa', synth: 'zap' },
      { name: 'Shaker',   color: '#6ee7b7', synth: 'shaker' },
    ]
  },
  'Lo-Fi': {
    color: '#f59e0b',
    pads: [
      { name: 'Lo Kick',  color: '#d97706', synth: 'kickLofi' },
      { name: 'Lo Snare', color: '#9333ea', synth: 'snareLofi' },
      { name: 'Hi-Hat',   color: '#0891b2', synth: 'hihatLofi' },
      { name: 'Perc 1',   color: '#059669', synth: 'percLofi1' },
      { name: 'Perc 2',   color: '#7c3aed', synth: 'percLofi2' },
      { name: 'Vinyl',    color: '#78716c', synth: 'vinylCrackle' },
      { name: 'Shaker',   color: '#6ee7b7', synth: 'shaker' },
      { name: 'Tambourine',color: '#fcd34d',synth: 'tambourine' },
    ]
  },
  '808': {
    color: '#ffffff',
    pads: [
      { name: '808 C2',   color: '#dc2626', synth: 'bass808', note: 'C2'  },
      { name: '808 D2',   color: '#ffffff', synth: 'bass808', note: 'D2'  },
      { name: '808 E2',   color: '#a1a1aa', synth: 'bass808', note: 'E2'  },
      { name: '808 G2',   color: '#fca5a5', synth: 'bass808', note: 'G2'  },
      { name: 'Kick 808', color: '#ffffff', synth: 'kick808' },
      { name: 'Snare',    color: '#a1a1aa', synth: 'snare' },
      { name: 'Hi-Hat C', color: '#ffffff', synth: 'hihatClosed' },
      { name: 'Clap',     color: '#52525b', synth: 'clap' },
    ]
  },
};

const NOTE_FREQ = {
  'C1':32.7,'D1':36.7,'E1':41.2,'F1':43.7,'G1':49,'A1':55,'B1':61.7,
  'C2':65.4,'D2':73.4,'E2':82.4,'F2':87.3,'G2':98,'A2':110,'B2':123.5,
  'C3':130.8,'D3':146.8,'E3':164.8,'G3':196,'A3':220,
};

/* ─── Drum Synthesizer ───────────────────────────────────────────────────── */

class DrumSynth {
  constructor(ctx, dest) {
    this.ctx  = ctx;
    this.dest = dest;
  }

  _out(gain = 1) {
    const g = this.ctx.createGain();
    g.gain.value = gain;
    g.connect(this.dest);
    return g;
  }

  play(synthName, velocity = 1.0, noteOverride = null) {
    const fn = this[`_${synthName}`];
    if (fn) fn.call(this, velocity, noteOverride);
  }

  /* ── Kick drums ─────────────────────────────────────── */
  _kick808(vel) {
    const now = this.ctx.currentTime;
    const out  = this._out(vel * 1.2);
    const osc  = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.35);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(1, now);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

    osc.connect(env);
    env.connect(out);
    osc.start(now);
    osc.stop(now + 0.8);
  }

  _kickAcoustic(vel) {
    const now = this.ctx.currentTime;
    const out  = this._out(vel);
    const osc  = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(100, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.1);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(1, now);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc.connect(env); env.connect(out);
    osc.start(now); osc.stop(now + 0.5);

    // click transient
    const buf = this._noise(0.02);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const hpf = this.ctx.createBiquadFilter();
    hpf.type = 'highpass'; hpf.frequency.value = 1000;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(vel * 0.4, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.02);
    src.connect(hpf); hpf.connect(ng); ng.connect(out);
    src.start(now);
  }

  _kickElec(vel) {
    const now = this.ctx.currentTime;
    const out  = this._out(vel);
    const osc  = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(35, now + 0.15);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(1, now);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.connect(env); env.connect(out);
    osc.start(now); osc.stop(now + 0.4);
  }

  _kickLofi(vel) {
    const now = this.ctx.currentTime;
    const out  = this._out(vel * 0.9);
    const osc  = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 0.2);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.8, now);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc.connect(env); env.connect(out);
    osc.start(now); osc.stop(now + 0.6);
  }

  /* ── Snares ─────────────────────────────────────────── */
  _snare(vel) {
    const now = this.ctx.currentTime;
    const out  = this._out(vel);
    // Body tone
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 180;
    const oEnv = this.ctx.createGain();
    oEnv.gain.setValueAtTime(0.8, now);
    oEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(oEnv); oEnv.connect(out);
    osc.start(now); osc.stop(now + 0.2);
    // Snare noise
    const buf = this._noise(0.25);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const hpf = this.ctx.createBiquadFilter();
    hpf.type = 'highpass'; hpf.frequency.value = 1800;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(vel, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    src.connect(hpf); hpf.connect(ng); ng.connect(out);
    src.start(now);
  }

  _snareAcoustic(vel) {
    const now = this.ctx.currentTime;
    const out  = this._out(vel * 0.9);
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 200;
    const oEnv = this.ctx.createGain();
    oEnv.gain.setValueAtTime(0.6, now);
    oEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(oEnv); oEnv.connect(out);
    osc.start(now); osc.stop(now + 0.15);
    const buf = this._noise(0.3);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const bpf = this.ctx.createBiquadFilter();
    bpf.type = 'bandpass'; bpf.frequency.value = 3000; bpf.Q.value = 0.5;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(vel, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    src.connect(bpf); bpf.connect(ng); ng.connect(out);
    src.start(now);
  }

  _snareElec(vel) {
    const now = this.ctx.currentTime;
    const out  = this._out(vel);
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 250;
    const oEnv = this.ctx.createGain();
    oEnv.gain.setValueAtTime(0.5, now);
    oEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(oEnv); oEnv.connect(out);
    osc.start(now); osc.stop(now + 0.1);
    const buf = this._noise(0.2);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const hpf = this.ctx.createBiquadFilter();
    hpf.type = 'highpass'; hpf.frequency.value = 3000;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(vel * 0.8, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    src.connect(hpf); hpf.connect(ng); ng.connect(out);
    src.start(now);
  }

  _snareLofi(vel) {
    const now = this.ctx.currentTime;
    const out  = this._out(vel * 0.7);
    const buf = this._noise(0.3);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const lpf = this.ctx.createBiquadFilter();
    lpf.type = 'lowpass'; lpf.frequency.value = 5000;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(vel, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    src.connect(lpf); lpf.connect(ng); ng.connect(out);
    src.start(now);
  }

  /* ── Hi-Hats ────────────────────────────────────────── */
  _hihatClosed(vel) {
    const now = this.ctx.currentTime;
    const out  = this._out(vel * 0.6);
    const buf = this._noise(0.06);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const hpf = this.ctx.createBiquadFilter();
    hpf.type = 'highpass'; hpf.frequency.value = 7000;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(vel, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    src.connect(hpf); hpf.connect(ng); ng.connect(out);
    src.start(now);
  }

  _hihatOpen(vel) {
    const now = this.ctx.currentTime;
    const out  = this._out(vel * 0.5);
    const buf = this._noise(0.5);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const hpf = this.ctx.createBiquadFilter();
    hpf.type = 'highpass'; hpf.frequency.value = 6000;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(vel, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    src.connect(hpf); hpf.connect(ng); ng.connect(out);
    src.start(now);
  }

  _hihatElec(vel) {
    const now = this.ctx.currentTime;
    const out  = this._out(vel * 0.55);
    // Metallic oscillators
    const freqs = [8000, 9413, 10743, 12869];
    freqs.forEach(f => {
      const osc = this.ctx.createOscillator();
      osc.type = 'square'; osc.frequency.value = f;
      const env = this.ctx.createGain();
      env.gain.setValueAtTime(vel * 0.1, now);
      env.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      osc.connect(env); env.connect(out);
      osc.start(now); osc.stop(now + 0.08);
    });
  }

  _hihatLofi(vel) {
    const now = this.ctx.currentTime;
    const out  = this._out(vel * 0.4);
    const buf = this._noise(0.08);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const bpf = this.ctx.createBiquadFilter();
    bpf.type = 'bandpass'; bpf.frequency.value = 5000; bpf.Q.value = 2;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(vel, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    src.connect(bpf); bpf.connect(ng); ng.connect(out);
    src.start(now);
  }

  /* ── Clap ───────────────────────────────────────────── */
  _clap(vel) {
    const now = this.ctx.currentTime;
    const out  = this._out(vel);
    [0, 0.01, 0.02].forEach(delay => {
      const buf = this._noise(0.05);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const bpf = this.ctx.createBiquadFilter();
      bpf.type = 'bandpass'; bpf.frequency.value = 1400; bpf.Q.value = 0.5;
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(vel, now + delay);
      ng.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.15);
      src.connect(bpf); bpf.connect(ng); ng.connect(out);
      src.start(now + delay);
    });
  }

  /* ── Toms ───────────────────────────────────────────── */
  _tomHi(vel) { this._tom(vel, 350, 120); }
  _tomLo(vel) { this._tom(vel, 200, 60); }
  _tom(vel, startHz, endHz) {
    const now = this.ctx.currentTime;
    const out  = this._out(vel);
    const osc  = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startHz, now);
    osc.frequency.exponentialRampToValueAtTime(endHz, now + 0.25);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(1, now);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.connect(env); env.connect(out);
    osc.start(now); osc.stop(now + 0.35);
  }

  /* ── 808 Bass ───────────────────────────────────────── */
  _bass808(vel, noteOverride) {
    const now = this.ctx.currentTime;
    const out  = this._out(vel);
    const freq = noteOverride ? (NOTE_FREQ[noteOverride] || 65) : 65;
    const osc  = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 2, now);
    osc.frequency.exponentialRampToValueAtTime(freq, now + 0.05);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(1, now);
    env.gain.setValueAtTime(1, now + 0.4);
    env.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
    osc.connect(env); env.connect(out);
    osc.start(now); osc.stop(now + 1.3);
  }

  /* ── Crash ──────────────────────────────────────────── */
  _crash(vel) {
    const now = this.ctx.currentTime;
    const out  = this._out(vel * 0.4);
    const buf = this._noise(1.5);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const hpf = this.ctx.createBiquadFilter();
    hpf.type = 'highpass'; hpf.frequency.value = 5000;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(vel, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 1.4);
    src.connect(hpf); hpf.connect(ng); ng.connect(out);
    src.start(now);
  }

  /* ── Ride ───────────────────────────────────────────── */
  _ride(vel) {
    const now = this.ctx.currentTime;
    const out  = this._out(vel * 0.45);
    const freqs = [6000, 8483, 12869, 16000];
    freqs.forEach(f => {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine'; osc.frequency.value = f;
      const env = this.ctx.createGain();
      env.gain.setValueAtTime(vel * 0.12, now);
      env.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
      osc.connect(env); env.connect(out);
      osc.start(now); osc.stop(now + 0.9);
    });
  }

  /* ── Cowbell ────────────────────────────────────────── */
  _cowbell(vel) {
    const now = this.ctx.currentTime;
    const out  = this._out(vel * 0.5);
    [562, 845].forEach(f => {
      const osc = this.ctx.createOscillator();
      osc.type = 'square'; osc.frequency.value = f;
      const env = this.ctx.createGain();
      env.gain.setValueAtTime(vel * 0.5, now);
      env.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      osc.connect(env); env.connect(out);
      osc.start(now); osc.stop(now + 0.7);
    });
  }

  /* ── Electronic FX ──────────────────────────────────── */
  _noiseHit(vel) {
    const now = this.ctx.currentTime;
    const out  = this._out(vel * 0.6);
    const buf = this._noise(0.1);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(vel, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    src.connect(ng); ng.connect(out);
    src.start(now);
  }

  _zap(vel) {
    const now = this.ctx.currentTime;
    const out  = this._out(vel);
    const osc  = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.15);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(vel * 0.7, now);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(env); env.connect(out);
    osc.start(now); osc.stop(now + 0.2);
  }

  _shaker(vel) {
    const now = this.ctx.currentTime;
    const out  = this._out(vel * 0.4);
    const buf = this._noise(0.06);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const bpf = this.ctx.createBiquadFilter();
    bpf.type = 'bandpass'; bpf.frequency.value = 8000; bpf.Q.value = 1.5;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(vel, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    src.connect(bpf); bpf.connect(ng); ng.connect(out);
    src.start(now);
  }

  _tambourine(vel) {
    const now = this.ctx.currentTime;
    const out  = this._out(vel * 0.4);
    for (let i = 0; i < 3; i++) {
      const delay = i * 0.01;
      const buf = this._noise(0.05);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const hpf = this.ctx.createBiquadFilter();
      hpf.type = 'highpass'; hpf.frequency.value = 6000;
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(vel * 0.7, now + delay);
      ng.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.1);
      src.connect(hpf); hpf.connect(ng); ng.connect(out);
      src.start(now + delay);
    }
  }

  _vinylCrackle(vel) {
    const now = this.ctx.currentTime;
    const out  = this._out(vel * 0.3);
    const buf = this._noise(0.2);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const lpf = this.ctx.createBiquadFilter();
    lpf.type = 'lowpass'; lpf.frequency.value = 3000;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(vel * 0.5, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    src.connect(lpf); lpf.connect(ng); ng.connect(out);
    src.start(now);
  }

  _percLofi1(vel) { this._tom(vel * 0.7, 280, 160); }
  _percLofi2(vel) { this._tom(vel * 0.6, 180, 90); }

  /* ── Utilities ──────────────────────────────────────── */
  _noise(duration) {
    const sampleRate = this.ctx.sampleRate;
    const len = Math.ceil(sampleRate * duration);
    const buf = this.ctx.createBuffer(1, len, sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  _makeDistCurve(amount) {
    const samples = 256;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
  }
}

/* ─── Drum Machine UI ────────────────────────────────────────────────────── */

class DrumMachine {
  constructor(audioEngine) {
    this.ctx       = audioEngine.ctx;
    this.dest      = audioEngine.masterCompressor || audioEngine.ctx.destination;
    this.synth     = new DrumSynth(this.ctx, this.dest);

    this.kitName   = 'Trap';
    this.kit       = DRUM_KITS[this.kitName];
    this.steps     = 16;
    this.bpm       = 140;
    this.swing     = 0;
    this.playing   = false;
    this.currentStep = 0;
    this._timer    = null;

    // pattern[padIdx][stepIdx] = { on, velocity }
    this.pattern = this.kit.pads.map(() =>
      Array.from({ length: 16 }, () => ({ on: false, velocity: 1.0 }))
    );

    this.muted  = new Array(8).fill(false);
    this.soloed = new Array(8).fill(false);

    this._buildUI();
  }

  /* ── Transport ──────────────────────────────────────── */

  start(bpm) {
    if (this.playing) return;
    this.bpm = bpm || this.bpm;
    this.playing = true;
    this.currentStep = 0;
    this._schedule();
  }

  stop() {
    this.playing = false;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    this._highlightStep(-1);
  }

  syncBPM(bpm) { this.bpm = bpm; }

  _schedule() {
    if (!this.playing) return;
    const stepSec = (60 / this.bpm) / 4; // 16th note
    const swingOffset = (this.currentStep % 2 === 1) ? stepSec * (this.swing / 200) : 0;

    this._fireStep(this.currentStep);
    this._highlightStep(this.currentStep);

    const nextStep = (this.currentStep + 1) % this.steps;
    this.currentStep = nextStep;
    this._timer = setTimeout(() => this._schedule(), (stepSec + swingOffset) * 1000);
  }

  _fireStep(step) {
    const anySolo = this.soloed.some(Boolean);
    this.pattern.forEach((padPattern, pi) => {
      const cell = padPattern[step];
      if (!cell.on) return;
      if (this.muted[pi]) return;
      if (anySolo && !this.soloed[pi]) return;
      const pad = this.kit.pads[pi];
      const humanize = (Math.random() - 0.5) * 0.005;
      setTimeout(() => {
        this.synth.play(pad.synth, cell.velocity, pad.note || null);
      }, Math.max(0, humanize * 1000));
    });
  }

  /* ── UI Builder ─────────────────────────────────────── */

  _buildUI() {
    const container = document.getElementById('drum-machine-container');
    if (!container) return;

    container.innerHTML = `
      <div class="dm-root">

        <!-- Header -->
        <div class="dm-header">
          <div class="dm-title">
            <span class="dm-icon"></span>
            <span>Drum Machine</span>
            <span class="dm-kit-badge" id="dm-kit-badge">${this.kitName}</span>
          </div>
          <div class="dm-controls">
            <select class="dm-select" id="dm-kit-select" title="Drum Kit">
              ${Object.keys(DRUM_KITS).map(k => `<option value="${k}" ${k===this.kitName?'selected':''}>${k}</option>`).join('')}
            </select>
            <select class="dm-select" id="dm-steps-select" title="Steps">
              <option value="16" selected>16 Steps</option>
              <option value="32">32 Steps</option>
              <option value="8">8 Steps</option>
            </select>
            <div class="dm-swing-wrap">
              <span class="dm-ctrl-label">Swing</span>
              <input type="range" class="dm-slider" id="dm-swing" min="0" max="75" value="0">
              <span class="dm-swing-val" id="dm-swing-val">0%</span>
            </div>
          </div>
          <div class="dm-transport">
            <button class="dm-btn dm-play" id="dm-play-btn" title="Play">▶</button>
            <button class="dm-btn dm-stop" id="dm-stop-btn" title="Stop">■</button>
            <button class="dm-btn dm-rand" id="dm-rand-btn" title="Randomize">Rand</button>
            <button class="dm-btn dm-clear" id="dm-clr-btn" title="Clear">✕</button>
            <button class="dm-btn dm-human" id="dm-human-btn" title="Humanize">Groove</button>
          </div>
        </div>

        <!-- Step headers -->
        <div class="dm-step-header" id="dm-step-header"></div>

        <!-- Pad rows -->
        <div class="dm-pads" id="dm-pads"></div>

      </div>
    `;

    this._renderStepHeaders();
    this._renderPads();
    this._bindControls();
  }

  _renderStepHeaders() {
    const wrap = document.getElementById('dm-step-header');
    if (!wrap) return;
    const groups = Math.ceil(this.steps / 4);
    let html = '<div class="dm-pad-label-spacer"></div>';
    for (let g = 0; g < groups; g++) {
      for (let s = 0; s < 4; s++) {
        const idx = g * 4 + s;
        if (idx >= this.steps) break;
        html += `<div class="dm-step-num ${s===0?'dm-beat-num':''}">${idx+1}</div>`;
      }
    }
    wrap.innerHTML = html;
  }

  _renderPads() {
    const wrap = document.getElementById('dm-pads');
    if (!wrap) return;
    wrap.innerHTML = '';

    this.kit.pads.forEach((pad, pi) => {
      const row = document.createElement('div');
      row.className = 'dm-row';
      row.dataset.pad = pi;

      // Pad label + controls
      const label = document.createElement('div');
      label.className = 'dm-pad-label';
      label.innerHTML = `
        <div class="dm-pad-color" style="background:${pad.color}"></div>
        <span class="dm-pad-name">${pad.name}</span>
        <div class="dm-pad-buttons">
          <button class="dm-mute-btn ${this.muted[pi]?'active':''}" data-pi="${pi}" title="Mute">M</button>
          <button class="dm-solo-btn ${this.soloed[pi]?'active':''}" data-pi="${pi}" title="Solo">S</button>
        </div>
      `;

      // Step buttons
      const steps = document.createElement('div');
      steps.className = 'dm-steps';

      for (let si = 0; si < this.steps; si++) {
        const cell = document.createElement('button');
        cell.className = `dm-step ${si % 4 === 0 ? 'dm-beat-start' : ''} ${this.pattern[pi][si].on ? 'dm-on' : ''}`;
        cell.dataset.pi = pi;
        cell.dataset.si = si;
        cell.style.setProperty('--pad-color', pad.color);
        cell.title = `${pad.name} step ${si+1} (right-click for velocity)`;

        cell.addEventListener('click', () => this._toggleStep(pi, si, cell));
        cell.addEventListener('contextmenu', (e) => { e.preventDefault(); this._editVelocity(pi, si, cell); });
        steps.appendChild(cell);
      }

      row.appendChild(label);
      row.appendChild(steps);
      wrap.appendChild(row);

      // Audition sound on clicking pad label
      label.addEventListener('click', (e) => {
        if (e.target.closest('.dm-mute-btn') || e.target.closest('.dm-solo-btn')) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();
        this.synth.play(pad.synth, 1.0, pad.note || null);
      });

      // Drag and drop preset onto pad
      label.addEventListener('dragover', (e) => {
        e.preventDefault();
        label.style.outline = '2px dashed #ffffff';
      });
      label.addEventListener('dragleave', () => {
        label.style.outline = 'none';
      });
      label.addEventListener('drop', (e) => {
        e.preventDefault();
        label.style.outline = 'none';
        try {
          const raw = e.dataTransfer.getData('text/plain');
          if (raw) {
            const data = JSON.parse(raw);
            if (data.type === 'beyou-preset-sample') {
              pad.name = data.name;
              if (data.color) pad.color = data.color;
              this._renderPads();
              if (window.showToast) window.showToast(` Loaded "${data.name}" onto Drum Pad ${pi + 1}!`);
            }
          }
        } catch (_) {}
      });

      // Mute/Solo bind
      label.querySelector('.dm-mute-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.muted[pi] = !this.muted[pi];
        e.currentTarget.classList.toggle('active', this.muted[pi]);
      });
      label.querySelector('.dm-solo-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.soloed[pi] = !this.soloed[pi];
        e.currentTarget.classList.toggle('active', this.soloed[pi]);
      });
    });
  }

  _toggleStep(pi, si, el) {
    const cell = this.pattern[pi][si];
    cell.on = !cell.on;
    el.classList.toggle('dm-on', cell.on);
    // Preview sound on enable
    if (cell.on) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.synth.play(this.kit.pads[pi].synth, cell.velocity, this.kit.pads[pi].note || null);
    }
  }

  _editVelocity(pi, si, el) {
    const cell = this.pattern[pi][si];
    const vel = prompt(`Velocity for ${this.kit.pads[pi].name} step ${si+1} (0.1 – 1.0):`, cell.velocity.toFixed(2));
    if (vel !== null) {
      const v = Math.min(1, Math.max(0.05, parseFloat(vel) || 1));
      cell.velocity = v;
      el.style.opacity = 0.3 + v * 0.7;
    }
  }

  _highlightStep(step) {
    document.querySelectorAll('.dm-step.dm-playing').forEach(el => el.classList.remove('dm-playing'));
    if (step >= 0) {
      document.querySelectorAll(`.dm-step[data-si="${step}"]`).forEach(el => el.classList.add('dm-playing'));
    }
  }

  _bindControls() {
    // Kit
    document.getElementById('dm-kit-select')?.addEventListener('change', (e) => {
      this.switchKit(e.target.value);
    });

    // Steps
    document.getElementById('dm-steps-select')?.addEventListener('change', (e) => {
      this.steps = parseInt(e.target.value);
      this.pattern = this.kit.pads.map(() =>
        Array.from({ length: this.steps }, () => ({ on: false, velocity: 1.0 }))
      );
      this._renderStepHeaders();
      this._renderPads();
    });

    // Swing
    document.getElementById('dm-swing')?.addEventListener('input', (e) => {
      this.swing = parseInt(e.target.value);
      document.getElementById('dm-swing-val').textContent = `${this.swing}%`;
    });

    // Transport
    document.getElementById('dm-play-btn')?.addEventListener('click', () => {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.start();
      document.getElementById('dm-play-btn').classList.add('dm-active');
    });
    document.getElementById('dm-stop-btn')?.addEventListener('click', () => {
      this.stop();
      document.getElementById('dm-play-btn').classList.remove('dm-active');
    });

    // Randomize
    document.getElementById('dm-rand-btn')?.addEventListener('click', () => this._randomize());
    document.getElementById('dm-clr-btn')?.addEventListener('click', () => this._clear());
    document.getElementById('dm-human-btn')?.addEventListener('click', () => this._humanize());
  }

  /* ── Kit switching ──────────────────────────────────── */
  switchKit(name) {
    if (!DRUM_KITS[name]) return;
    this.kitName = name;
    this.kit = DRUM_KITS[name];
    this.pattern = this.kit.pads.map(() =>
      Array.from({ length: this.steps }, () => ({ on: false, velocity: 1.0 }))
    );
    document.getElementById('dm-kit-badge').textContent = name;
    this._renderPads();
  }

  /* ── Pattern helpers ────────────────────────────────── */
  _randomize() {
    const densities = [0.25, 0.3, 0.5, 0.4, 0.2, 0.15, 0.35, 0.1];
    this.pattern.forEach((padPat, pi) => {
      padPat.forEach((cell, si) => {
        cell.on = Math.random() < (densities[pi] || 0.25);
        cell.velocity = 0.5 + Math.random() * 0.5;
      });
    });
    this._renderPads();
  }

  _clear() {
    this.pattern.forEach(padPat => padPat.forEach(cell => { cell.on = false; cell.velocity = 1.0; }));
    this._renderPads();
  }

  _humanize() {
    // Randomly toggle some steps and randomize velocities
    this.pattern.forEach(padPat => {
      padPat.forEach(cell => {
        if (cell.on) {
          cell.velocity = Math.max(0.3, Math.min(1.0, cell.velocity + (Math.random() - 0.5) * 0.3));
        }
      });
    });
    this._renderPads();
    if (typeof showToast === 'function') showToast('Humanized! Velocities varied.', 2000);
  }

  /* ── External API ───────────────────────────────────── */
  loadPattern(patternData) {
    // Load a pattern from AI or preset
    if (!patternData || !patternData.pads) return;
    this._clear();
    patternData.pads.forEach((padData, pi) => {
      if (!this.pattern[pi]) return;
      padData.steps.forEach((on, si) => {
        if (si >= this.steps) return;
        this.pattern[pi][si].on = !!on;
        this.pattern[pi][si].velocity = padData.velocity?.[si] ?? 1.0;
      });
    });
    this._renderPads();
  }

  getPattern() {
    return {
      kit: this.kitName,
      bpm: this.bpm,
      swing: this.swing,
      pads: this.pattern.map((padPat, pi) => ({
        name: this.kit.pads[pi].name,
        steps: padPat.map(c => c.on ? 1 : 0),
        velocity: padPat.map(c => c.velocity),
      }))
    };
  }
}
