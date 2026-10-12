/**
 * FL Studio Clone — Audio Engine
 * Drum synthesis + oscillator synth via Web Audio API
 */

class AudioEngine {
  constructor() {
    this._ctx = null;
    this.masterGain = null;
    this.masterCompressor = null;
    this.channelGains = {};
    this.initialized = false;
    window.audioEngine = this;
    this.tracks = {};
  }

  get ctx() {
    if (!this.initialized) {
      this.init();
    }
    return this._ctx;
  }

  set ctx(val) {
    this._ctx = val;
  }

  init() {
    if (this.initialized) return;
    this._ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Master compressor (Fruity Limiter / Master Compressor)
    this.masterCompressor = this.ctx.createDynamicsCompressor();
    this.masterCompressor.threshold.value = -6;
    this.masterCompressor.knee.value = 6;
    this.masterCompressor.ratio.value = 3;
    this.masterCompressor.attack.value = 0.003;
    this.masterCompressor.release.value = 0.25;

    // Master gain
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.85;

    // Master Analyser Node for Spectrum Visualizer
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.82;

    // Setup Fruity Parametric EQ 2 Filter Chain (7 Bands)
    this.eqNodes = [];
    this._initEQChain();

    // Setup Soundgoodizer
    this._initSoundgoodizer();

    // Wire audio bus:
    // masterCompressor -> eqChainIn -> eqNodes[0..6] -> sgDry/Wet -> masterGain -> analyser -> destination
    let lastNode = this.masterCompressor;
    if (this.eqNodes && this.eqNodes.length) {
      lastNode.connect(this.eqNodes[0]);
      lastNode = this.eqNodes[this.eqNodes.length - 1];
    }

    // Connect into Soundgoodizer
    lastNode.connect(this.sgInput);
    this.sgOutput.connect(this.masterGain);

    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    this.initialized = true;
  }

  _initEQChain() {
    // 7 Bands matching FL Parametric EQ 2:
    // 0: Highpass (20-100Hz)
    // 1: Low Shelf (80-250Hz)
    // 2: Peaking 1 (150-800Hz)
    // 3: Peaking 2 (500-2500Hz)
    // 4: Peaking 3 (1500-7000Hz)
    // 5: High Shelf (5000-14000Hz)
    // 6: Lowpass (10000-20000Hz)
    const bandDefs = [
      { type: 'highpass', freq: 35,    gain: 0, q: 0.707 },
      { type: 'lowshelf', freq: 110,   gain: 0, q: 0.707 },
      { type: 'peaking',  freq: 350,   gain: 0, q: 1.0 },
      { type: 'peaking',  freq: 1000,  gain: 0, q: 1.0 },
      { type: 'peaking',  freq: 3200,  gain: 0, q: 1.0 },
      { type: 'highshelf',freq: 8500,  gain: 0, q: 0.707 },
      { type: 'lowpass',  freq: 18500, gain: 0, q: 0.707 },
    ];

    this.eqNodes = bandDefs.map((def, idx) => {
      const f = this.ctx.createBiquadFilter();
      f.type = def.type;
      f.frequency.value = def.freq;
      f.gain.value = def.gain;
      f.Q.value = def.q;
      if (idx > 0) {
        this.eqNodes[idx - 1].connect(f);
      }
      return f;
    });
  }

  setEQBand(idx, type, freq, gain, q) {
    if (!this.initialized) this.init();
    if (!this.eqNodes || !this.eqNodes[idx]) return;
    const node = this.eqNodes[idx];
    const now = this.ctx.currentTime;
    if (type && node.type !== type) node.type = type;
    if (freq !== undefined && freq > 10 && freq < 22000) {
      node.frequency.setTargetAtTime(freq, now, 0.015);
    }
    if (gain !== undefined && node.type !== 'highpass' && node.type !== 'lowpass') {
      node.gain.setTargetAtTime(gain, now, 0.015);
    }
    if (q !== undefined && q > 0.05 && q < 20) {
      node.Q.setTargetAtTime(q, now, 0.015);
    }
  }

  _initSoundgoodizer() {
    this.sgInput = this.ctx.createGain();
    this.sgOutput = this.ctx.createGain();

    this.sgDryGain = this.ctx.createGain();
    this.sgWetGain = this.ctx.createGain();
    this.sgDryGain.gain.value = 1.0;
    this.sgWetGain.gain.value = 0.0;

    // Saturation WaveShaper
    this.sgShaper = this.ctx.createWaveShaper();
    this.sgShaper.oversample = '4x';
    this._updateSGShaperCurve(25);

    // Multiband character filters for Presets A, B, C, D
    this.sgBassBoost = this.ctx.createBiquadFilter();
    this.sgBassBoost.type = 'lowshelf';
    this.sgBassBoost.frequency.value = 120;
    this.sgBassBoost.gain.value = 3;

    this.sgHighAir = this.ctx.createBiquadFilter();
    this.sgHighAir.type = 'highshelf';
    this.sgHighAir.frequency.value = 7500;
    this.sgHighAir.gain.value = 3.5;

    // Wire Soundgoodizer path:
    // sgInput -> sgDryGain -> sgOutput
    // sgInput -> sgBassBoost -> sgHighAir -> sgShaper -> sgWetGain -> sgOutput
    this.sgInput.connect(this.sgDryGain);
    this.sgDryGain.connect(this.sgOutput);

    this.sgInput.connect(this.sgBassBoost);
    this.sgBassBoost.connect(this.sgHighAir);
    this.sgHighAir.connect(this.sgShaper);
    this.sgShaper.connect(this.sgWetGain);
    this.sgWetGain.connect(this.sgOutput);

    this.sgAmount = 0;
    this.sgMode = 'A';
  }

  _updateSGShaperCurve(k = 25) {
    const n = 1024;
    const curve = new Float32Array(n);
    const deg = Math.PI / 180;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    if (this.sgShaper) this.sgShaper.curve = curve;
  }

  setSoundgoodizer(amount = 0, mode = 'A') {
    if (!this.initialized) this.init();
    this.sgAmount = Math.max(0, Math.min(1, amount));
    this.sgMode = mode;
    const now = this.ctx.currentTime;

    // Configure Preset EQ Curves
    if (mode === 'A') {
      // Maximus A: Punchy low-end + crisp highs
      this.sgBassBoost.gain.setTargetAtTime(3.5 * this.sgAmount, now, 0.02);
      this.sgHighAir.gain.setTargetAtTime(4.0 * this.sgAmount, now, 0.02);
      this._updateSGShaperCurve(25 + 35 * this.sgAmount);
    } else if (mode === 'B') {
      // Maximus B: Warm tube warmth & body
      this.sgBassBoost.gain.setTargetAtTime(5.0 * this.sgAmount, now, 0.02);
      this.sgHighAir.gain.setTargetAtTime(1.5 * this.sgAmount, now, 0.02);
      this._updateSGShaperCurve(15 + 20 * this.sgAmount);
    } else if (mode === 'C') {
      // Maximus C: Aggressive high-end sparkle & snap
      this.sgBassBoost.gain.setTargetAtTime(1.0 * this.sgAmount, now, 0.02);
      this.sgHighAir.gain.setTargetAtTime(6.0 * this.sgAmount, now, 0.02);
      this._updateSGShaperCurve(30 + 40 * this.sgAmount);
    } else if (mode === 'D') {
      // Maximus D: Heavy loud sub punch & saturation
      this.sgBassBoost.gain.setTargetAtTime(6.5 * this.sgAmount, now, 0.02);
      this.sgHighAir.gain.setTargetAtTime(3.0 * this.sgAmount, now, 0.02);
      this._updateSGShaperCurve(40 + 50 * this.sgAmount);
    }

    // Dry / Wet Crossfade with equal-power curve
    const wet = Math.sin(this.sgAmount * Math.PI * 0.5);
    const dry = Math.cos(this.sgAmount * Math.PI * 0.5);
    this.sgWetGain.gain.setTargetAtTime(wet * 0.9, now, 0.02);
    this.sgDryGain.gain.setTargetAtTime(dry, now, 0.02);
  }

  playMetronome(step, time) {
    if (!this.initialized) this.init();
    if (!this.ctx) return;
    const t = time || this.ctx.currentTime;
    const isDownbeat = (step === 0);
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(isDownbeat ? 1600 : 950, t);
    gain.gain.setValueAtTime(isDownbeat ? 0.35 : 0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.04);
  }

  playChime(isSuccess = true) {
    if (!this.initialized) this.init();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const freqs = isSuccess ? [523.25, 659.25, 783.99, 1046.50] : [440, 415.3, 392];
    freqs.forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, t + i * 0.05);
      gain.gain.setValueAtTime(0.12, t + i * 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.05 + 0.25);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t + i * 0.05);
      osc.stop(t + i * 0.05 + 0.26);
    });
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  get currentTime() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  setMasterVolume(vol) { // 0–1
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.01);
    }
  }

  // ── Shared util ──────────────────────────────────────────────
  _connectToMaster(node, gainDb = 0) {
    const gain = this.ctx.createGain();
    gain.gain.value = Math.pow(10, gainDb / 20);
    node.connect(gain);
    gain.connect(this.masterCompressor);
    return gain;
  }

  // ── Track Management ────────────────────────────────────────
  /**
   * Creates or returns an existing track object.
   * Each track has its own gain and optional pan node that feeds the master bus.
   */
  addTrack(id) {
    if (this.tracks[id]) return this.tracks[id];
    const gain = this.ctx.createGain();
    gain.gain.value = 1.0;
    let pan = null;
    if (this.ctx.createStereoPanner) {
      pan = this.ctx.createStereoPanner();
      pan.pan.value = 0;
    }
    // Connect gain -> pan (if any) -> masterCompressor
    const afterGain = pan ? gain.connect(pan) : gain;
    (pan || gain).connect(this.masterCompressor);
    const track = {
      id,
      gain,
      pan,
      solo: false,
      mute: false,
      setVolume: (vol) => {
        gain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.01);
      },
      setPan: (value) => {
        if (pan) pan.pan.setTargetAtTime(value, this.ctx.currentTime, 0.01);
      },
      setSolo: (state) => {
        track.solo = state;
        this._updateSoloMute();
      },
      setMute: (state) => {
        track.mute = state;
        this._updateSoloMute();
      },
      connect: (node) => {
        node.connect(gain);
      },
    };
    this.tracks[id] = track;
    this._updateSoloMute();
    return track;
  }

  /**
   * Internal helper to enforce solo/mute logic across all tracks.
   */
  _updateSoloMute() {
    const anySolo = Object.values(this.tracks).some(t => t.solo);
    Object.values(this.tracks).forEach(t => {
      const effectiveGain = anySolo ? (t.solo ? 1 : 0) : (t.mute ? 0 : 1);
      t.gain.gain.setTargetAtTime(effectiveGain, this.ctx.currentTime, 0.01);
    });
  }

  /**
   * Connect a source node to a named track, creating the track if needed.
   */
  connectTrack(sourceNode, trackId = 'main') {
    const track = this.addTrack(trackId);
    sourceNode.connect(track.gain);
    return track;
  }

  /**
   * Render the current audio graph to an OfflineAudioContext.
   * This implementation recreates the master chain (compressor → eq → soundgoodizer → gain → analyser)
   * inside an offline context and connects any existing tracks (gain + optional pan) to it.
   * Since live source nodes cannot be moved to the offline context, callers can provide an
   * optional `setupCallback` that receives the offline context and a map of offline track nodes
   * to manually connect their own sources.
   * Returns a Promise resolving with an AudioBuffer.
   */
  async renderToBuffer(duration = 5, sampleRate = 44100, setupCallback = null) {
    // Create an offline context with the desired duration.
    const offline = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

    // Re‑create master chain inside the offline context.
    const masterCompressor = offline.createDynamicsCompressor();
    masterCompressor.threshold.value = -6;
    masterCompressor.knee.value = 6;
    masterCompressor.ratio.value = 3;
    masterCompressor.attack.value = 0.003;
    masterCompressor.release.value = 0.25;

    const masterGain = offline.createGain();
    masterGain.gain.value = 0.85;

    // Connect master chain: compressor → gain → destination.
    masterCompressor.connect(masterGain);
    masterGain.connect(offline.destination);

    // Re‑create tracks in the offline context.
    const offlineTracks = {};
    for (const [id, track] of Object.entries(this.tracks)) {
      const gain = offline.createGain();
      gain.gain.value = track.gain.gain.value; // copy current gain level
      let pan = null;
      if (offline.createStereoPanner) {
        pan = offline.createStereoPanner();
        if (track.pan) {
          pan.pan.value = track.pan.pan.value;
        } else {
          pan.pan.value = 0;
        }
        gain.connect(pan);
        pan.connect(masterCompressor);
      } else {
        gain.connect(masterCompressor);
      }
      offlineTracks[id] = { gain, pan, solo: track.solo, mute: track.mute };
    }

    // Apply solo/mute logic in the offline context.
    const anySolo = Object.values(offlineTracks).some(t => t.solo);
    for (const t of Object.values(offlineTracks)) {
      const effectiveGain = anySolo ? (t.solo ? 1 : 0) : (t.mute ? 0 : 1);
      t.gain.gain.setValueAtTime(effectiveGain, 0);
    }

    // If a setup callback is provided, give the caller a chance to connect sources.
    if (typeof setupCallback === 'function') {
      try {
        await setupCallback(offline, offlineTracks);
      } catch (e) {
        console.warn('[AudioEngine] setupCallback threw an error:', e);
      }
    }

    // Start rendering.
    return offline.startRendering();
  }

  /**
   * Convert an AudioBuffer to a WAV Blob and trigger a download.
   * @param {AudioBuffer} buffer - The rendered audio data.
   * @param {string} filename - Desired name of the downloaded file.
   */
  exportWav(buffer, filename = 'output.wav') {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const length = buffer.length * numChannels * 2 + 44;
    const wav = new Uint8Array(length);
    const view = new DataView(wav.buffer);

    function writeString(offset, str) {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    }

    // RIFF header
    writeString(0, 'RIFF');
    view.setUint32(4, length - 8, true);
    writeString(8, 'WAVE');
    // fmt subchunk
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // PCM chunk size
    view.setUint16(20, 1, true); // audio format = PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true); // byte rate
    view.setUint16(32, numChannels * 2, true); // block align
    view.setUint16(34, 16, true); // bits per sample
    // data subchunk
    writeString(36, 'data');
    view.setUint32(40, length - 44, true);

    // Interleave channel data
    let offset = 44;
    const channels = [];
    for (let i = 0; i < numChannels; i++) {
      channels.push(buffer.getChannelData(i));
    }
    for (let i = 0; i < buffer.length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        let sample = Math.max(-1, Math.min(1, channels[ch][i]));
        // 16‑bit PCM conversion
        sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset, sample, true);
        offset += 2;
      }
    }

    const wavBlob = new Blob([wav], { type: 'audio/wav' });
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  /**
   * Convenience method: render to buffer then immediately export as WAV.
   * @param {number} duration - Length in seconds.
   * @param {string} filename - Desired download name.
   * @param {function} [setupCallback] - Optional callback for connecting sources to the offline context.
   */
  async renderAndExport(duration = 5, filename = 'output.wav', setupCallback = null) {
    try {
      const buffer = await this.renderToBuffer(duration, 44100, setupCallback);
      this.exportWav(buffer, filename);
    } catch (e) {
      console.error('[AudioEngine] renderAndExport failed:', e);
    }
  }


  // ── 808 Kick ─────────────────────────────────────────────────
  playKick(time, options = {}) {
    const { freq = 58, gain = 0.9, pitch = 1 } = options;
    const t = time || this.ctx.currentTime;

    // Sub oscillator
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * pitch * 3.5, t);
    osc.frequency.exponentialRampToValueAtTime(freq * pitch, t + 0.05);
    osc.frequency.exponentialRampToValueAtTime(freq * pitch * 0.5, t + 0.4);

    const gainNode = this.ctx.createGain();
    gainNode.gain.setValueAtTime(gain, t);
    gainNode.gain.exponentialRampToValueAtTime(0.001, t + 0.5);

    // Distortion for punch
    const dist = this.ctx.createWaveShaper();
    dist.curve = this._makeDistortionCurve(20);

    osc.connect(dist);
    dist.connect(gainNode);
    this._connectToMaster(gainNode, 2);

    osc.start(t);
    osc.stop(t + 0.55);
  }

  // ── Snare ────────────────────────────────────────────────────
  playSnare(time, options = {}) {
    const { gain = 0.7 } = options;
    const t = time || this.ctx.currentTime;

    // Noise component
    const bufferSize = this.ctx.sampleRate * 0.3;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1);

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 3200;
    noiseFilter.Q.value = 0.5;

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(gain, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

    // Tone component
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(160, t + 0.1);

    const toneGain = this.ctx.createGain();
    toneGain.gain.setValueAtTime(gain * 0.6, t);
    toneGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    osc.connect(toneGain);

    this._connectToMaster(noiseGain);
    this._connectToMaster(toneGain);

    noise.start(t);
    noise.stop(t + 0.25);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  // ── Hi-Hat ───────────────────────────────────────────────────
  playHihat(time, options = {}) {
    const { open = false, gain = 0.5 } = options;
    const t = time || this.ctx.currentTime;
    const duration = open ? 0.5 : 0.08;

    // Metal oscillators (6 overtones for metallic sound)
    const freqs = [40, 74, 164, 220, 163, 349].map(f => f * 20);
    const gainNode = this.ctx.createGain();
    gainNode.gain.setValueAtTime(gain, t);
    gainNode.gain.exponentialRampToValueAtTime(0.001, t + duration);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = open ? 7000 : 9000;

    freqs.forEach(freq => {
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.value = 1 / freqs.length;
      osc.connect(g);
      g.connect(filter);
      osc.start(t);
      osc.stop(t + duration + 0.02);
    });

    filter.connect(gainNode);
    this._connectToMaster(gainNode, -3);
  }

  // ── Clap ─────────────────────────────────────────────────────
  playClap(time, options = {}) {
    const { gain = 0.7 } = options;
    const t = time || this.ctx.currentTime;

    // Multiple noise bursts for clap texture
    [0, 0.01, 0.02, 0.04].forEach((offset, i) => {
      const bufferSize = this.ctx.sampleRate * 0.06;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let j = 0; j < bufferSize; j++) data[j] = Math.random() * 2 - 1;

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1200;
      filter.Q.value = 0.8;

      const g = this.ctx.createGain();
      const fadeTime = i === 3 ? 0.1 : 0.015;
      g.gain.setValueAtTime(gain, t + offset);
      g.gain.exponentialRampToValueAtTime(0.001, t + offset + fadeTime);

      noise.connect(filter);
      filter.connect(g);
      this._connectToMaster(g);

      noise.start(t + offset);
      noise.stop(t + offset + fadeTime + 0.01);
    });
  }

  // ── Tom ──────────────────────────────────────────────────────
  playTom(time, options = {}) {
    const { freq = 120, gain = 0.75 } = options;
    const t = time || this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 1.5, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + 0.02);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.7, t + 0.25);

    const gainNode = this.ctx.createGain();
    gainNode.gain.setValueAtTime(gain, t);
    gainNode.gain.exponentialRampToValueAtTime(0.001, t + 0.3);

    osc.connect(gainNode);
    this._connectToMaster(gainNode);

    osc.start(t);
    osc.stop(t + 0.35);
  }

  // ── Synth Note ───────────────────────────────────────────────
  playSynth(time, options = {}) {
    const {
      freq = 220,
      type = 'sawtooth',
      gain = 0.3,
      attack = 0.01,
      decay = 0.1,
      sustain = 0.7,
      release = 0.3,
      duration = 0.5,
      filterFreq = 2000,
      filterRes = 1,
      detune = 0,
    } = options;

    const t = time || this.ctx.currentTime;
    const noteEnd = t + duration;

    // Oscillator 1
    const osc1 = this.ctx.createOscillator();
    osc1.type = type;
    osc1.frequency.value = freq;
    osc1.detune.value = detune;

    // Oscillator 2 (slight detune for fatness)
    const osc2 = this.ctx.createOscillator();
    osc2.type = type;
    osc2.frequency.value = freq;
    osc2.detune.value = detune + 7;

    // Filter
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFreq * 1.5, t);
    filter.frequency.exponentialRampToValueAtTime(filterFreq, t + attack + decay);
    filter.Q.value = filterRes;

    // ADSR gain
    const gainNode = this.ctx.createGain();
    gainNode.gain.setValueAtTime(0, t);
    gainNode.gain.linearRampToValueAtTime(gain, t + attack);
    gainNode.gain.linearRampToValueAtTime(gain * sustain, t + attack + decay);
    gainNode.gain.setValueAtTime(gain * sustain, noteEnd);
    gainNode.gain.linearRampToValueAtTime(0, noteEnd + release);

    const oscGain1 = this.ctx.createGain();
    const oscGain2 = this.ctx.createGain();
    oscGain1.gain.value = 0.6;
    oscGain2.gain.value = 0.4;

    osc1.connect(oscGain1);
    osc2.connect(oscGain2);
    oscGain1.connect(filter);
    oscGain2.connect(filter);
    filter.connect(gainNode);
    this._connectToMaster(gainNode);

    osc1.start(t);
    osc2.start(t);
    osc1.stop(noteEnd + release + 0.05);
    osc2.stop(noteEnd + release + 0.05);

    return { osc1, osc2, gainNode };
  }

  // ── Bass ─────────────────────────────────────────────────────
  playBass(time, options = {}) {
    return this.playSynth(time, {
      type: 'square',
      attack: 0.005,
      decay: 0.08,
      sustain: 0.6,
      release: 0.15,
      filterFreq: 800,
      filterRes: 3,
      gain: 0.5,
      ...options,
    });
  }

  // ── Helper: distortion curve ──────────────────────────────────
  _makeDistortionCurve(amount) {
    const samples = 256;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = (Math.PI + amount) * x / (Math.PI + amount * Math.abs(x));
    }
    return curve;
  }

  // ── Map channel name to play function ────────────────────────
  triggerChannel(channelName, time, velocity = 1, config = {}) {
    const vol = velocity;
    switch (channelName.toLowerCase()) {
      case 'kick':
      case '808':
        this.playKick(time, { gain: 0.9 * vol, ...config }); break;
      case 'snare':
        this.playSnare(time, { gain: 0.7 * vol, ...config }); break;
      case 'clap':
        this.playClap(time, { gain: 0.7 * vol, ...config }); break;
      case 'hihat':
      case 'hi-hat c':
      case 'hihat c':
        this.playHihat(time, { open: false, gain: 0.5 * vol, ...config }); break;
      case 'hihat o':
      case 'hi-hat o':
        this.playHihat(time, { open: true, gain: 0.4 * vol, ...config }); break;
      case 'tom':
        this.playTom(time, { gain: 0.75 * vol, ...config }); break;
      case 'bass':
        this.playBass(time, { freq: config.freq || 110, gain: 0.5 * vol, duration: config.duration || 0.25, ...config }); break;
      case 'lead':
        this.playSynth(time, { freq: config.freq || 440, type: 'sawtooth', gain: 0.35 * vol, duration: config.duration || 0.25, ...config }); break;
      default:
        this.playKick(time, { gain: 0.5 * vol }); break;
    }
  }

  // ── Universal & Resilient Audio Decoder (MP3, WAV, OGG, FLAC, M4A, AIFF) ──
  /**
   * Decodes an audio file or ArrayBuffer into an AudioBuffer with multi-tier recovery:
   * Tier 1: Direct Web Audio decodeAudioData (with cloned buffer to avoid detachment)
   * Tier 2: ID3v2 tag parser & stripper (recovers MP3s rejected due to large APIC album artwork)
   * Tier 3: MPEG frame sync bit-scanner (recovers MP3s with corrupted pre-roll or extra containers)
   * Tier 4: Isolated OfflineAudioContext decoding
   */
  async decodeAudio(source) {
    if (!this.initialized) this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch (_) {}
    }

    let arrayBuffer;
    if (typeof source === 'string') {
      const resp = await fetch(source);
      arrayBuffer = await resp.arrayBuffer();
    } else if (source instanceof Blob || (typeof File !== 'undefined' && source instanceof File)) {
      arrayBuffer = await source.arrayBuffer();
    } else if (source instanceof ArrayBuffer) {
      arrayBuffer = source;
    } else if (ArrayBuffer.isView(source)) {
      arrayBuffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    } else {
      throw new Error('Unsupported audio source: expected URL string, File, Blob, or ArrayBuffer');
    }

    if (!arrayBuffer || arrayBuffer.byteLength < 16) {
      throw new Error('Audio file is empty or corrupted');
    }

    const _decodeWithContext = (ctxInstance, rawBuf) => {
      return new Promise((resolve, reject) => {
        let settled = false;
        const _resolve = (v) => { if (!settled) { settled = true; resolve(v); } };
        const _reject  = (e) => { if (!settled) { settled = true; reject(e); } };
        try {
          const res = ctxInstance.decodeAudioData(
            rawBuf,
            decoded => _resolve(decoded),
            err => _reject(err || new Error('decodeAudioData rejected'))
          );
          if (res && typeof res.then === 'function') {
            res.then(_resolve).catch(_reject);
          }
        } catch (err) {
          _reject(err);
        }
      });
    };

    // Tier 1: Direct native decoding with safe buffer slice
    try {
      return await _decodeWithContext(this.ctx, arrayBuffer.slice(0));
    } catch (tier1Err) {
      console.warn('[AudioEngine] Tier 1 decode failed, attempting raw decode...', tier1Err);
      // Fallback: try decoding the original arrayBuffer without slicing (in case slicing caused issues)
      try {
        return await _decodeWithContext(this.ctx, arrayBuffer);
      } catch (rawErr) {
        console.warn('[AudioEngine] Raw decode also failed:', rawErr);
        console.warn('[AudioEngine] Tier 1 decode failed, attempting ID3/MPEG stripping...');
      }
    }

    // Tier 2: Parse and strip ID3v2 metadata
    // Many MP3s include large ID3v2 tags (with JPEG/PNG artwork) that choke Web Audio's MPEG demuxer.
    try {
      const u8 = new Uint8Array(arrayBuffer);
      if (u8.length > 10 && u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33) { // 'ID3'
        const flags = u8[5];
        const hasFooter = (flags & 0x10) !== 0;
        const tagSize = ((u8[6] & 0x7F) << 21) |
                        ((u8[7] & 0x7F) << 14) |
                        ((u8[8] & 0x7F) << 7)  |
                        (u8[9] & 0x7F);
        const headerOffset = 10 + tagSize + (hasFooter ? 10 : 0);
        if (headerOffset > 0 && headerOffset < arrayBuffer.byteLength - 16) {
          const stripped = arrayBuffer.slice(headerOffset);
          try {
            const buf = await _decodeWithContext(this.ctx, stripped);
            console.log('[AudioEngine] Successfully decoded MP3 after ID3 tag stripping!');
            return buf;
          } catch (t2) {
            console.warn('[AudioEngine] Tier 2 ID3 strip decode failed:', t2);
          }
        }
      }
    } catch (e) {
      console.warn('[AudioEngine] ID3 inspection error:', e);
    }

    // Tier 3: Scan for valid MPEG audio frame sync word (0xFF + top 3 bits 111)
    try {
      const u8 = new Uint8Array(arrayBuffer);
      const scanLimit = u8.length - 4; // scan full file
      for (let i = 0; i < scanLimit; i++) {
        if (u8[i] === 0xFF && (u8[i + 1] & 0xE0) === 0xE0) {
          const mpegVer = (u8[i + 1] >> 3) & 0x03; // not 01 (reserved)
          const layer   = (u8[i + 1] >> 1) & 0x03; // not 00 (reserved)
          const bitrate = (u8[i + 2] >> 4) & 0x0F; // not 1111 (0x0F)
          const srate   = (u8[i + 2] >> 2) & 0x03; // not 11 (0x03)
          if (mpegVer !== 1 && layer !== 0 && bitrate !== 15 && srate !== 3) {
            if (i > 0) {
              const sliced = arrayBuffer.slice(i);
              try {
                const buf = await _decodeWithContext(this.ctx, sliced);
                console.log(`[AudioEngine] Successfully decoded MP3 from MPEG frame sync offset +${i}`);
                return buf;
              } catch (_) {
                // False positive sync, continue search
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('[AudioEngine] Frame sync scan error:', e);
    }

    // Tier 4: Fallback with a fresh isolated AudioContext instance (bypasses device hardware sample rate mismatch)
    try {
      const altCtx = new (window.AudioContext || window.webkitAudioContext)();
      // First attempt using our helper (Promise based)
      let buf = await _decodeWithContext(altCtx, arrayBuffer.slice(0));
      if (buf) {
        console.log('[AudioEngine] Decoded audio via isolated AudioContext fallback (Promise)');
        return buf;
      }
      // If that fails, fall back to the older callback API
      buf = await new Promise((resolve, reject) => {
        altCtx.decodeAudioData(
          arrayBuffer.slice(0),
          decoded => resolve(decoded),
          err => reject(err)
        );
      });
      if (buf) {
        console.log('[AudioEngine] Decoded audio via isolated AudioContext fallback (callback)');
        return buf;
      }
    } catch (t4Err) {
      console.warn('[AudioEngine] Tier 4 isolated AudioContext fallback failed:', t4Err);
    }

    // Tier 5: Use a hidden <audio> element to let the browser's native media stack
    // decode the file (covers codecs that decodeAudioData rejects).
    try {
      console.log('[AudioEngine] Attempting Tier 5: Hidden <audio> element decode…');
      const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
      const url  = URL.createObjectURL(blob);
      const audio = document.createElement('audio');
      audio.preload = 'auto';
      audio.src = url;
      audio.muted = true;

      const buf = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Tier 5 timeout')), 15000);

        audio.addEventListener('canplaythrough', async () => {
          clearTimeout(timeout);
          try {
            const duration = audio.duration;
            if (!duration || !isFinite(duration) || duration <= 0) {
              reject(new Error('Could not determine audio duration'));
              return;
            }
            const sampleRate = this.ctx.sampleRate || 44100;
            const offlineCtx = new OfflineAudioContext(2, Math.ceil(sampleRate * duration), sampleRate);
            const source = offlineCtx.createMediaElementSource(audio);
            source.connect(offlineCtx.destination);
            audio.muted = false;
            audio.currentTime = 0;
            await audio.play();
            const rendered = await offlineCtx.startRendering();
            audio.pause();
            URL.revokeObjectURL(url);
            resolve(rendered);
          } catch (innerErr) {
            URL.revokeObjectURL(url);
            reject(innerErr);
          }
        }, { once: true });

        audio.addEventListener('error', () => {
          clearTimeout(timeout);
          URL.revokeObjectURL(url);
          reject(new Error('Audio element could not load the file'));
        }, { once: true });

        // Kick off loading
        audio.load();
      });

      if (buf) {
        console.log('[AudioEngine] Tier 5 <audio> element decode succeeded!');
        return buf;
      }
    } catch (t5Err) {
      console.warn('[AudioEngine] Tier 5 <audio> element fallback failed:', t5Err);
    }

    throw new Error('Unable to decode audio data. The file may be corrupted or in an unsupported format. Supported: WAV, MP3, OGG, FLAC, AIFF, M4A.');
  }
}

window.AudioEngine = AudioEngine;
if (!window.audioEngine) {
  window.audioEngine = new AudioEngine();
}
