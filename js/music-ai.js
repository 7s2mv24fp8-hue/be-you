/**
 * FL Studio Clone — AI Music Generator (Hugging Face MusicGen)
 *
 * Three components:
 *  1. HuggingFaceMusic  — API client for MusicGen inference
 *  2. PromptBuilder     — context-aware prompt generation from DAW state
 *  3. MusicAI           — orchestrator exposing high-level API
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const MUSICGEN_MODELS = {
  small:  'facebook/musicgen-small',
  medium: 'facebook/musicgen-medium',
};

const GENRE_PROMPT_MAP = {
  'Hip-Hop':    'hip-hop beat, boom bap drums, deep bass, vinyl crackle',
  'Trap':       'trap beat, 808 bass, rapid hi-hats, dark synths',
  'House':      'house music, four-on-the-floor kick, offbeat hi-hats, deep bass',
  'Drum & Bass':'drum and bass, breakbeat, fast tempo, rolling bass',
  'Reggaeton':  'reggaeton dembow rhythm, latin percussion, bass',
  'Afrobeats':  'afrobeats, african percussion, groovy bass, rhythmic',
  'Lo-Fi':      'lo-fi hip hop, mellow piano, vinyl crackle, chill, relaxing',
  'Electronic': 'electronic music, synthesizers, pulsing bass, arpeggios',
  'Custom':     'instrumental beat, rhythmic, musical',
  'Unknown':    'instrumental beat, rhythmic percussion, bass',
};

const MOOD_TAGS = [
  'energetic', 'chill', 'dark', 'uplifting', 'melancholic', 'aggressive',
  'dreamy', 'groovy', 'atmospheric', 'funky', 'epic', 'minimal',
];

const INSTRUMENT_TAGS = [
  'piano', 'guitar', 'synth', 'strings', 'brass', 'flute', 'organ',
  'bells', 'pad', 'pluck', 'saxophone', 'violin',
];

// ─────────────────────────────────────────────────────────────────────────────
// 1. MUSIC AUDIO CLIENTS (BeYou Built-in, Local Server & Hugging Face Cloud)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * High-performance, client-side procedural multi-track audio synthesizer.
 * Runs 100% offline in pure JavaScript via 16-bit PCM WAV rendering.
 * Provides instant generation (<100ms) with zero API keys or local servers needed.
 */
class BrowserMusicGenerator {
  constructor(sampleRate = 32000) {
    this.sampleRate = sampleRate;
    this._abortCtrl = null;
  }

  static parsePromptIntent(prompt, currentBpm = 120) {
    const p = (prompt || '').toLowerCase();
    const bpmMatch = p.match(/(\d{2,3})\s*(?:bpm|tempo)/);
    const explicitBpm = bpmMatch ? parseInt(bpmMatch[1], 10) : null;

    let genre = 'lofi';
    if (/(drill|uk drill|ny drill)/.test(p)) genre = 'drill';
    else if (/(trap|808|metro|banger|dark beat)/.test(p)) genre = 'trap';
    else if (/(phonk|drift|cowbell|memphis)/.test(p)) genre = 'phonk';
    else if (/(synthwave|retrowave|80s|outrun|neon)/.test(p)) genre = 'synthwave';
    else if (/(techno|acid|industrial|rave|berlin)/.test(p)) genre = 'techno';
    else if (/(dnb|drum and bass|breakbeat|jungle|liquid)/.test(p)) genre = 'dnb';
    else if (/(house|deep house|tech house|club|dance|edm)/.test(p)) genre = 'house';
    else if (/(reggaeton|dembow|latin)/.test(p)) genre = 'reggaeton';
    else if (/(afrobeats|afro|amapiano)/.test(p)) genre = 'afrobeats';
    else if (/(ambient|space|meditation|calm|relaxing|drone|ethereal)/.test(p)) genre = 'ambient';
    else if (/(acoustic|guitar|folk)/.test(p)) genre = 'acoustic';
    else if (/(lo-fi|lofi|chill|study|mellow|jazz)/.test(p)) genre = 'lofi';
    else if (/(hip hop|hip-hop|boom bap|rap)/.test(p)) genre = 'lofi';

    const GENRES = {
      lofi: {
        bpm: 78,
        chords: [[50, 53, 57, 60, 64], [45, 48, 52, 55, 59], [48, 52, 55, 59, 62], [43, 47, 50, 53, 57]],
        kick:  [1, 0, 0, 0,  0, 0, 1, 0,  0, 1, 0, 0,  0, 0, 0, 0],
        snare: [0, 0, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0,  1, 0, 0, 0],
        hihat: [1, 0, 1, 0,  1, 0, 1, 0,  1, 0, 1, 0,  1, 0, 1, 0],
        vinylNoise: 0.035,
        bassType: 'sub_warm',
      },
      trap: {
        bpm: 140,
        chords: [[48, 51, 55], [44, 48, 51], [46, 50, 53], [43, 47, 50]],
        kick:  [1, 0, 0, 0,  0, 0, 0, 0,  1, 0, 1, 0,  0, 0, 0, 0],
        snare: [0, 0, 0, 0,  0, 0, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0],
        hihat: [1, 1, 1, 1,  1, 1, 1, 1,  1, 1, 1, 1,  1, 1, 1, 1],
        vinylNoise: 0.0,
        bassType: '808_glide',
      },
      drill: {
        bpm: 142,
        chords: [[41, 44, 48], [42, 46, 49], [41, 44, 48], [40, 43, 47]],
        kick:  [1, 0, 0, 0,  0, 0, 1, 0,  0, 0, 1, 0,  0, 0, 0, 0],
        snare: [0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 1, 0,  0, 0, 0, 0],
        hihat: [1, 0, 1, 1,  1, 0, 1, 1,  1, 0, 1, 1,  1, 1, 1, 1],
        vinylNoise: 0.0,
        bassType: '808_slide_distorted',
      },
      synthwave: {
        bpm: 122,
        chords: [[45, 48, 52], [41, 45, 48], [43, 47, 50], [40, 43, 47]],
        kick:  [1, 0, 0, 0,  1, 0, 0, 0,  1, 0, 0, 0,  1, 0, 0, 0],
        snare: [0, 0, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0,  1, 0, 0, 0],
        hihat: [0, 0, 1, 0,  0, 0, 1, 0,  0, 0, 1, 0,  0, 0, 1, 0],
        vinylNoise: 0.0,
        bassType: 'rolling_saw_arp',
      },
      house: {
        bpm: 126,
        chords: [[43, 46, 50, 53], [41, 45, 48, 52], [38, 41, 45, 48], [43, 46, 50, 53]],
        kick:  [1, 0, 0, 0,  1, 0, 0, 0,  1, 0, 0, 0,  1, 0, 0, 0],
        snare: [0, 0, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0,  1, 0, 0, 0],
        hihat: [0, 0, 1, 0,  0, 0, 1, 0,  0, 0, 1, 0,  0, 0, 1, 0],
        vinylNoise: 0.0,
        bassType: 'bouncy_organ',
      },
      techno: {
        bpm: 135,
        chords: [[41, 44, 48], [41, 44, 48], [42, 45, 49], [41, 44, 48]],
        kick:  [1, 0, 0, 0,  1, 0, 0, 0,  1, 0, 0, 0,  1, 0, 0, 0],
        snare: [0, 0, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0,  1, 0, 0, 0],
        hihat: [1, 0, 1, 0,  1, 0, 1, 0,  1, 0, 1, 0,  1, 0, 1, 0],
        vinylNoise: 0.0,
        bassType: 'acid_resonant',
      },
      dnb: {
        bpm: 174,
        chords: [[40, 43, 47], [36, 40, 43], [38, 41, 45], [35, 39, 42]],
        kick:  [1, 0, 0, 0,  0, 0, 0, 0,  0, 0, 1, 0,  0, 0, 0, 0],
        snare: [0, 0, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0,  1, 0, 0, 0],
        hihat: [1, 1, 1, 1,  1, 1, 1, 1,  1, 1, 1, 1,  1, 1, 1, 1],
        vinylNoise: 0.0,
        bassType: 'reese_lfo',
      },
      reggaeton: {
        bpm: 96,
        chords: [[45, 48, 52], [41, 45, 48], [43, 47, 50], [45, 48, 52]],
        kick:  [1, 0, 0, 0,  1, 0, 0, 0,  1, 0, 0, 0,  1, 0, 0, 0],
        snare: [0, 0, 0, 1,  0, 0, 1, 0,  0, 0, 0, 1,  0, 0, 1, 0],
        hihat: [1, 0, 1, 0,  1, 0, 1, 0,  1, 0, 1, 0,  1, 0, 1, 0],
        vinylNoise: 0.0,
        bassType: 'sub_deep',
      },
      afrobeats: {
        bpm: 106,
        chords: [[43, 47, 50], [40, 43, 47], [36, 40, 43], [38, 42, 45]],
        kick:  [1, 0, 0, 0,  0, 0, 1, 0,  0, 0, 0, 0,  1, 0, 0, 0],
        snare: [0, 0, 0, 1,  0, 0, 1, 0,  0, 1, 0, 0,  0, 0, 1, 0],
        hihat: [1, 0, 1, 1,  0, 1, 1, 0,  1, 0, 1, 1,  0, 1, 1, 0],
        vinylNoise: 0.0,
        bassType: 'warm_pluck',
      },
      phonk: {
        bpm: 148,
        chords: [[49, 52, 56], [50, 53, 57], [49, 52, 56], [45, 48, 52]],
        kick:  [1, 0, 0, 0,  0, 0, 0, 0,  1, 0, 1, 0,  0, 0, 0, 0],
        snare: [0, 0, 0, 0,  0, 0, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0],
        hihat: [1, 1, 1, 1,  1, 1, 1, 1,  1, 1, 1, 1,  1, 1, 1, 1],
        vinylNoise: 0.02,
        bassType: 'saturated_808',
      },
      ambient: {
        bpm: 72,
        chords: [[41, 45, 48, 52], [43, 47, 50, 53], [40, 43, 47, 50], [45, 48, 52, 55]],
        kick:  [1, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0],
        snare: [0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0],
        hihat: [0, 0, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0,  1, 0, 0, 0],
        vinylNoise: 0.015,
        bassType: 'deep_sub_swell',
      },
      acoustic: {
        bpm: 90,
        chords: [[43, 47, 50], [40, 43, 47], [36, 40, 43], [38, 42, 45]],
        kick:  [1, 0, 0, 0,  0, 0, 1, 0,  0, 0, 0, 0,  1, 0, 0, 0],
        snare: [0, 0, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0,  1, 0, 0, 0],
        hihat: [1, 0, 1, 0,  1, 0, 1, 0,  1, 0, 1, 0,  1, 0, 1, 0],
        vinylNoise: 0.01,
        bassType: 'sub_warm',
      }
    };

    const cfg = GENRES[genre] || GENRES.lofi;
    const bpm = (explicitBpm && explicitBpm >= 50 && explicitBpm <= 220) ? explicitBpm : (cfg.bpm || currentBpm || 120);

    return { genre, bpm, cfg };
  }

  cancel() {
    if (this._abortCtrl) {
      this._abortCtrl.abort();
      this._abortCtrl = null;
    }
  }

  async generate(prompt, { duration = 8, onStatus = () => {} } = {}) {
    if (this._abortCtrl) this._abortCtrl.abort();
    this._abortCtrl = new AbortController();

    onStatus('generating');
    await new Promise(r => setTimeout(r, 16));
    if (this._abortCtrl?.signal.aborted) throw new Error('Generation cancelled');

    onStatus('synthesizing');
    const res = this.renderWavBuffer(prompt, duration);
    const blob = new Blob([res.view], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);

    onStatus('done');
    this._abortCtrl = null;
    return {
      blob,
      url,
      metadata: res.metadata,
      engine: 'BeYou Built-in Procedural AI'
    };
  }

  renderWavBuffer(prompt, duration = 8) {
    const currentDAWBpm = (typeof window !== 'undefined' && window.app?.sequencer?.bpm) ? window.app.sequencer.bpm : 120;
    const { genre, bpm, cfg } = BrowserMusicGenerator.parsePromptIntent(prompt, currentDAWBpm);

    const sr = this.sampleRate;
    const totalSamples = Math.floor(duration * sr);
    const samplesPerBeat = (60.0 / bpm) * sr;
    const samplesPerStep = samplesPerBeat / 4.0;
    const stepsPerChord = 8;
    const chordProg = cfg.chords;
    const numChords = chordProg.length;

    // Seeded deterministic PRNG for prompt
    let seed = 0;
    const cleanPrompt = (prompt || 'music beat').trim();
    for (let i = 0; i < cleanPrompt.length; i++) {
      seed = ((seed << 5) - seed) + cleanPrompt.charCodeAt(i);
      seed |= 0;
    }
    seed = Math.abs(seed) || 12345;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed >>> 0) / 4294967296;
    };

    const midiToFreq = m => 440.0 * Math.pow(2.0, (m - 69.0) / 12.0);

    const headerSize = 44;
    const dataSize = totalSamples * 4; // 2 channels * 2 bytes
    const arrayBuffer = new ArrayBuffer(headerSize + dataSize);
    const view = new DataView(arrayBuffer);

    // RIFF header
    const writeString = (offset, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 2, true); // Stereo
    view.setUint32(24, sr, true);
    view.setUint32(28, sr * 4, true); // Byte rate
    view.setUint16(32, 4, true); // Block align
    view.setUint16(34, 16, true); // 16 bits
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = 44;
    let reesePhase1 = 0.0;
    let reesePhase2 = 0.0;

    for (let i = 0; i < totalSamples; i++) {
      const t = i / sr;
      const stepIdx = Math.floor(i / samplesPerStep);
      const stepMod16 = stepIdx % 16;
      const timeInStep = (i % Math.floor(samplesPerStep)) / sr;

      const chordIdx = Math.floor(stepIdx / stepsPerChord) % numChords;
      const currentChord = chordProg[chordIdx];
      const rootMidi = currentChord[0] - 12;

      // ── 1. DRUMS ──
      let drumL = 0, drumR = 0;
      if (cfg.kick[stepMod16] && timeInStep < 0.28) {
        const pitchEnv = 145.0 * Math.exp(-timeInStep * 38.0) + 48.0;
        const ampEnv = Math.exp(-timeInStep * 13.0);
        const kVal = Math.tanh(Math.sin(2 * Math.PI * pitchEnv * timeInStep) * ampEnv * 1.5) * 0.75;
        drumL += kVal;
        drumR += kVal;
      }
      if (cfg.snare[stepMod16] && timeInStep < 0.24) {
        const toneEnv = Math.exp(-timeInStep * 28.0);
        const noiseEnv = Math.exp(-timeInStep * 18.0);
        const sTone = Math.sin(2 * Math.PI * 185.0 * timeInStep) * toneEnv * 0.4;
        const sNoise = (rng() * 2.0 - 1.0) * noiseEnv * 0.55;
        const sVal = sTone + sNoise;
        drumL += sVal * 0.6;
        drumR += sVal * 0.6;
      }
      if (cfg.hihat[stepMod16] && timeInStep < 0.065) {
        const hEnv = Math.exp(-timeInStep * 75.0);
        const hNoise = (rng() * 2.0 - 1.0) * hEnv * 0.26;
        drumL += hNoise * 0.18;
        drumR += hNoise * 0.26;
      }

      // ── 2. BASS ──
      let bassL = 0, bassR = 0;
      const bassType = cfg.bassType || 'sub_warm';
      if (bassType.includes('808')) {
        const freq = midiToFreq(rootMidi);
        const glide = ([0, 8, 10].includes(stepMod16)) ? Math.exp(-timeInStep * 8.0) * 16.0 : 0.0;
        let bVal = Math.sin(2 * Math.PI * (freq + glide) * t);
        if (bassType.includes('distorted')) bVal = Math.tanh(bVal * 1.8) * 0.65;
        bassL += bVal * 0.65;
        bassR += bVal * 0.65;
      } else if (bassType === 'rolling_saw_arp') {
        const arpNotes = [rootMidi, rootMidi + 7, rootMidi + 12, rootMidi + 7];
        const currNote = arpNotes[stepMod16 % 4];
        const freq = midiToFreq(currNote);
        const saw = 2.0 * ((t * freq) % 1.0) - 1.0;
        const env = Math.exp(-timeInStep * 14.0);
        const bVal = saw * env * 0.45;
        bassL += bVal;
        bassR += bVal;
      } else if (bassType === 'reese_lfo') {
        const freq1 = midiToFreq(rootMidi);
        const freq2 = midiToFreq(rootMidi) + 1.2;
        reesePhase1 += (2 * Math.PI * freq1) / sr;
        reesePhase2 += (2 * Math.PI * freq2) / sr;
        const lfo = 0.5 + 0.5 * Math.sin(2 * Math.PI * 1.5 * t);
        const bVal = (Math.sin(reesePhase1) + Math.sin(reesePhase2) * 0.8) * 0.3 * (0.6 + 0.4 * lfo);
        bassL += bVal * 1.1;
        bassR += bVal * 0.9;
      } else {
        const freq = midiToFreq(rootMidi);
        const bVal = Math.sin(2 * Math.PI * freq * t) * 0.55;
        bassL += bVal;
        bassR += bVal;
      }

      // ── 3. CHORDS & HARMONY ──
      let chordL = 0, chordR = 0;
      const timeInChord = ((stepIdx % stepsPerChord) * samplesPerStep + (i % Math.floor(samplesPerStep))) / sr;
      const chordEnv = Math.exp(-timeInChord * 0.65) * 0.26;
      for (let idx = 0; idx < currentChord.length; idx++) {
        const cFreq = midiToFreq(currentChord[idx]);
        const phase = (t * cFreq) % 1.0;
        const voice = 4.0 * Math.abs(phase - 0.5) - 1.0;
        const panMult = 0.8 + 0.4 * (idx % 2);
        chordL += voice * chordEnv * panMult;
        chordR += voice * chordEnv * (2.0 - panMult);
      }

      // ── 4. MELODIC LEAD / MOTIF ──
      let leadL = 0, leadR = 0;
      if ([2, 6, 8, 11, 14].includes(stepMod16)) {
        const motifIdx = (stepMod16 * 3) % currentChord.length;
        const leadMidi = currentChord[motifIdx] + 12;
        const lFreq = midiToFreq(leadMidi);
        const lEnv = Math.exp(-timeInStep * 12.0);
        const leadWave = Math.sin(2 * Math.PI * lFreq * t);
        leadL += leadWave * lEnv * 0.22;
        leadR += leadWave * lEnv * 0.15;
      }

      // ── 5. VINYL CRACKLE & TEXTURE ──
      if (cfg.vinylNoise > 0) {
        const vCrack = (rng() * 2.0 - 1.0) * cfg.vinylNoise * (rng() > 0.96 ? 0.9 : 0.2);
        drumL += vCrack;
        drumR += vCrack;
      }

      // ── 6. MASTER MIX & STEREO LIMITER ──
      const mixL = drumL + bassL + chordL + leadL;
      const mixR = drumR + bassR + chordR + leadR;

      const finalL = Math.tanh(mixL * 1.15);
      const finalR = Math.tanh(mixR * 1.15);

      const sL = Math.floor(Math.max(-1.0, Math.min(1.0, finalL)) * 30000);
      const sR = Math.floor(Math.max(-1.0, Math.min(1.0, finalR)) * 30000);

      view.setInt16(offset, sL, true);
      view.setInt16(offset + 2, sR, true);
      offset += 4;
    }

    return {
      view,
      arrayBuffer,
      metadata: { genre, bpm, duration, sampleRate: sr }
    };
  }
}

class LocalMusicClient {
  constructor() {
    const defaultOrigin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : 'http://localhost:8000';
    this.baseUrl = localStorage.getItem('fl-studio-local-audio-url') || defaultOrigin;
    this._abortCtrl = null;
  }

  setUrl(url) {
    if (url) {
      this.baseUrl = url.trim().replace(/\/+$/, '');
      localStorage.setItem('fl-studio-local-audio-url', this.baseUrl);
    }
  }

  async testConnection() {
    const urlsToTry = [
      this.baseUrl,
      'http://localhost:8000',
      'http://127.0.0.1:8000'
    ];
    const uniqueUrls = [...new Set(urlsToTry.map(u => (u || '').trim().replace(/\/+$/, '')).filter(Boolean))];

    for (const testUrl of uniqueUrls) {
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 3500);
        const resp = await fetch(`${testUrl}/health`, { method: 'GET', signal: ctrl.signal });
        clearTimeout(tid);
        if (resp.ok) {
          const data = await resp.json().catch(() => ({}));
          this.setUrl(testUrl);
          return {
            ok: true,
            message: `Connected to Local Server at ${testUrl}! Engine: ${data.engine || 'MusicGen / Algorithmic Synth'}`,
            data,
            url: testUrl
          };
        }
      } catch (_) {}
    }

    return {
      ok: false,
      message: `Cannot connect to ${this.baseUrl}. Run "python server.py" on port 8000 or switch to BeYou Built-in engine.`,
    };
  }

  async generate(prompt, { onStatus = () => {}, duration = 8 } = {}) {
    if (this._abortCtrl) this._abortCtrl.abort();
    this._abortCtrl = new AbortController();

    onStatus('generating');

    const endpoints = [
      `${this.baseUrl}/generate`,
      `${this.baseUrl}/api/music/generate`,
    ];
    if (!this.baseUrl.includes(':8000')) {
      endpoints.push('http://localhost:8000/generate');
      endpoints.push('http://127.0.0.1:8000/generate');
    }

    let lastErr = null;
    for (const ep of endpoints) {
      try {
        const resp = await fetch(ep, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, duration }),
          signal: this._abortCtrl.signal,
        });

        if (resp.ok) {
          const blob = await resp.blob();
          const url  = URL.createObjectURL(blob);
          onStatus('done');
          this._abortCtrl = null;
          return { blob, url, engine: 'Local Audio Server' };
        } else {
          lastErr = new Error(`Local server returned HTTP ${resp.status}`);
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          onStatus('cancelled');
          this._abortCtrl = null;
          throw new Error('Generation cancelled');
        }
        lastErr = err;
      }
    }

    onStatus('error');
    this._abortCtrl = null;
    throw lastErr || new Error(`Cannot connect to local music server at ${this.baseUrl}`);
  }

  cancel() {
    if (this._abortCtrl) {
      this._abortCtrl.abort();
      this._abortCtrl = null;
    }
  }
}

class HuggingFaceMusic {
  constructor() {
    this.apiKey    = localStorage.getItem('fl-studio-hf-key') || '';
    this.modelId   = MUSICGEN_MODELS.small; // Use free serverless-supported small model by default
    this.baseUrl   = 'https://router.huggingface.co/hf-inference/models';
    this.fallbackBaseUrl = 'https://api-inference.huggingface.co/models';
    this._abortCtrl = null;
  }

  setApiKey(key) {
    this.apiKey = key.trim();
    localStorage.setItem('fl-studio-hf-key', this.apiKey);
  }

  hasKey() { return this.apiKey.length > 0; }

  setModel(size) {
    this.modelId = MUSICGEN_MODELS[size] || MUSICGEN_MODELS.small;
  }

  setModelSize(size) {
    this.setModel(size);
  }

  /**
   * Generate music audio from a text prompt.
   * @param {string} prompt - Text description of the music to generate
   * @param {object} opts - Options
   * @param {Function} opts.onStatus - Status callback ('loading' | 'generating' | 'done' | 'error')
   * @returns {Promise<{blob: Blob, url: string, engine: string}>} Generated audio blob + object URL
   */
  async generate(prompt, { onStatus = () => {} } = {}) {
    if (!this.hasKey()) {
      throw new Error('No Hugging Face API key set. Please click Audio Setup to enter your token, or use BeYou Built-in.');
    }

    if (this._abortCtrl) {
      this._abortCtrl.abort();
    }
    this._abortCtrl = new AbortController();

    const urls = [
      `${this.baseUrl}/${this.modelId}`,
      `${this.fallbackBaseUrl}/${this.modelId}`
    ];
    const maxRetries = 2;
    let lastError = null;

    for (const url of urls) {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          onStatus(attempt === 0 ? 'generating' : 'loading');

          const resp = await fetch(url, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type':  'application/json',
            },
            body: JSON.stringify({ inputs: prompt }),
            signal: this._abortCtrl.signal,
          });

          // Model loading — wait and retry
          if (resp.status === 503) {
            const body = await resp.json().catch(() => ({}));
            const waitTime = body.estimated_time
              ? Math.min(body.estimated_time * 1000, 20000)
              : 8000;
            onStatus('loading');
            await this._sleep(waitTime);
            continue;
          }

          // Rate limit
          if (resp.status === 429) {
            throw new Error('Hugging Face rate limit reached. Please wait or switch to BeYou Built-in engine.');
          }

          // Auth error
          if (resp.status === 401 || resp.status === 403) {
            throw new Error('Invalid or expired Hugging Face API key. Please verify your token in Audio Setup.');
          }

          if (!resp.ok) {
            const errBody = await resp.json().catch(() => ({}));
            throw new Error(errBody.error || `Hugging Face returned HTTP ${resp.status}`);
          }

          // Success — response is audio binary
          const blob = await resp.blob();
          const audioUrl = URL.createObjectURL(blob);
          onStatus('done');
          this._abortCtrl = null;
          return { blob, url: audioUrl, engine: `Hugging Face (${this.modelId})` };

        } catch (err) {
          if (err.name === 'AbortError') {
            onStatus('cancelled');
            this._abortCtrl = null;
            throw new Error('Generation cancelled');
          }
          lastError = err;
          if (err.message.includes('API key')) break;
          if (attempt < maxRetries - 1 && err.message.includes('503')) {
            await this._sleep(4000);
          }
        }
      }
      if (lastError && lastError.message.includes('API key')) break;
    }

    onStatus('error');
    this._abortCtrl = null;
    throw lastError || new Error('Failed to generate music via Hugging Face after retries');
  }

  cancel() {
    if (this._abortCtrl) {
      this._abortCtrl.abort();
      this._abortCtrl = null;
    }
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. PROMPT BUILDER
// ─────────────────────────────────────────────────────────────────────────────

class PromptBuilder {
  /**
   * Build a music generation prompt from DAW context.
   */
  static build({ bpm = 120, genre = 'Hip-Hop', density = 50, syncopation = 30,
                  moods = [], instruments = [], userText = '' } = {}) {
    // If trained MusicTagEngine is loaded, use its statistical Qwen prompt synthesis
    if (typeof window !== 'undefined' && window.musicTagEngine && window.musicTagEngine.loaded) {
      return window.musicTagEngine.synthesizePrompt({ genre, bpm, moods, instruments, userText });
    }

    const parts = [];

    // Genre base
    const genreDesc = GENRE_PROMPT_MAP[genre] || GENRE_PROMPT_MAP['Unknown'];
    parts.push(genreDesc);

    // BPM context
    if (bpm < 90) parts.push('slow tempo');
    else if (bpm > 150) parts.push('fast tempo, high energy');
    else if (bpm > 120) parts.push('medium-fast tempo');

    // Density context
    if (density > 70) parts.push('dense, layered');
    else if (density < 30) parts.push('sparse, minimal');

    // Syncopation
    if (syncopation > 60) parts.push('syncopated, off-beat accents');

    // Moods
    if (moods.length > 0) parts.push(moods.join(', '));

    // Instruments
    if (instruments.length > 0) parts.push(instruments.join(', '));

    // User text
    if (userText.trim()) parts.push(userText.trim());

    // Quality suffix
    parts.push('high quality, studio production');

    return parts.join(', ');
  }

  /**
   * Generate a prompt from current AISuggester analysis.
   */
  static fromAnalysis(analysis, bpm, moods = [], instruments = [], userText = '') {
    return PromptBuilder.build({
      bpm,
      genre: analysis.genre || 'Unknown',
      density: analysis.density || 50,
      syncopation: analysis.syncopation || 30,
      moods,
      instruments,
      userText,
    });
  }

  /**
   * Quick preset prompts.
   */
  static presets() {
    return [
      { label: ' Lo-Fi Chill',        prompt: 'lo-fi hip hop, mellow piano, vinyl crackle, chill, relaxing, rainy day, high quality' },
      { label: ' Trap Banger',         prompt: 'trap beat, heavy 808 bass, rapid hi-hats, dark synths, aggressive, high energy, studio quality' },
      { label: ' Deep House',           prompt: 'deep house music, four-on-the-floor kick, warm bass, atmospheric pads, groovy, high quality' },
      { label: ' Acoustic Vibes',       prompt: 'acoustic guitar, warm fingerpicking, gentle percussion, folk, intimate, high quality' },
      { label: ' Ambient Space',        prompt: 'ambient music, ethereal pads, reverb, atmospheric, dreamy, space, cinematic, high quality' },
      { label: ' Drum & Bass Energy',   prompt: 'drum and bass, fast breakbeat, rolling bass, energetic, jungle, high quality' },
      { label: ' Jazz Lounge',          prompt: 'jazz, smooth saxophone, piano chords, upright bass, relaxed, lounge, high quality' },
      { label: ' Retro Synthwave',      prompt: 'synthwave, 80s retro, arpeggiated synth, driving bass, neon, cinematic, high quality' },
    ];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. GENERATION HISTORY
// ─────────────────────────────────────────────────────────────────────────────

class GenerationHistory {
  constructor() {
    this._storageKey = 'fl-studio-music-ai-history';
    this.items = this._load();
    this._blobUrls = new Map();
    this._blobs = new Map();
  }

  add(prompt, blob, url) {
    const id = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const entry = {
      id,
      prompt,
      timestamp: Date.now(),
      size: blob ? blob.size : 0,
      type: blob ? blob.type : 'audio/wav',
    };
    this.items.unshift(entry);
    if (this.items.length > 20) this.items.pop();
    if (url) this._blobUrls.set(id, url);
    if (blob) this._blobs.set(id, blob);
    this._save();
    return entry;
  }

  getUrl(id) {
    return this._blobUrls.get(id) || null;
  }

  getBlob(id) {
    return this._blobs.get(id) || null;
  }

  remove(id) {
    const url = this._blobUrls.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      this._blobUrls.delete(id);
    }
    this._blobs.delete(id);
    this.items = this.items.filter(i => i.id !== id);
    this._save();
  }

  clear() {
    this._blobUrls.forEach(url => URL.revokeObjectURL(url));
    this._blobUrls.clear();
    this._blobs.clear();
    this.items = [];
    this._save();
  }

  _save() {
    try {
      localStorage.setItem(this._storageKey, JSON.stringify(this.items));
    } catch (e) { /* quota exceeded */ }
  }

  _load() {
    try {
      const raw = localStorage.getItem(this._storageKey);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  /**
   * Get a history entry by its ID.
   * @param {string} id - Entry ID.
   * @returns {object|null} Entry object or null if not found.
   */
  getEntry(id) {
    return this.items.find(i => i.id === id) || null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. MUSIC AI (orchestrator)
// ─────────────────────────────────────────────────────────────────────────────

class MusicAI {
  constructor() {
    this.hf           = new HuggingFaceMusic();
    this.localAudio   = new LocalMusicClient();
    this.browserAudio = new BrowserMusicGenerator(32000);
    this.history      = new GenerationHistory();

    const savedProvider = localStorage.getItem('fl-studio-music-audio-provider');
    if (savedProvider && ['beyou', 'local', 'hf'].includes(savedProvider)) {
      this.provider = savedProvider;
    } else {
      // Default to BeYou Built-in engine for zero-setup, instant offline generation
      this.provider = 'beyou';
    }

    this.isGenerating = false;
    this.currentAudio = null;
    this.selectedMoods = [];
    this.selectedInstruments = [];

    // Tag & Prompt Engine (trained on wanghappy/Music-tag-generation dataset)
    this.tagEngine = typeof MusicTagEngine !== 'undefined' ? new MusicTagEngine() : null;
    if (this.tagEngine) {
      this.tagEngine.load().then(ok => {
        if (ok && typeof window !== 'undefined') {
          window.musicTagEngine = this.tagEngine;
        }
      });
    }
  }

  setProvider(p) {
    if (['beyou', 'local', 'hf'].includes(p)) {
      this.provider = p;
      localStorage.setItem('fl-studio-music-audio-provider', p);
    }
  }

  getProvider() { return this.provider; }

  getActiveClient() {
    if (this.provider === 'hf') return this.hf;
    if (this.provider === 'local') return this.localAudio;
    return this.browserAudio;
  }

  setApiKey(key) { this.hf.setApiKey(key); }
  hasApiKey() {
    if (this.provider === 'beyou') return true;
    if (this.provider === 'local') return true;
    return this.hf.hasKey();
  }
  getApiKey()    { return this.hf.apiKey; }

  async generate(prompt, { onStatus = () => {}, duration = 8, allowFallback = true, addToHistory = true } = {}) {
    if (this.isGenerating) {
      this.cancel();
      await new Promise(r => setTimeout(r, 60));
    }

    this.isGenerating = true;

    // Direct path for BeYou Built-in engine (instant offline)
    if (this.provider === 'beyou') {
      try {
        const result = await this.browserAudio.generate(prompt, { duration, onStatus });
        const entry = addToHistory ? this.history.add(prompt, result.blob, result.url) : null;
        this.isGenerating = false;
        return { ...result, entry, fallbackUsed: false };
      } catch (err) {
        this.isGenerating = false;
        throw err;
      }
    }

    // External / Local client path with automated built-in fallback
    const client = this.getActiveClient();
    try {
      const result = await client.generate(prompt, { onStatus, duration });
      const entry = addToHistory ? this.history.add(prompt, result.blob, result.url) : null;
      this.isGenerating = false;
      return { ...result, entry, fallbackUsed: false };
    } catch (err) {
      if (err.name === 'AbortError' || err.message === 'Request cancelled' || err.message === 'Generation cancelled') {
        this.isGenerating = false;
        throw err;
      }

      console.warn(`[MusicAI] ${this.provider.toUpperCase()} provider failed:`, err.message);

      if (allowFallback) {
        try {
          if (typeof onStatus === 'function') onStatus('fallback');
          const fallbackRes = await this.browserAudio.generate(prompt, { duration, onStatus });
          const entry = addToHistory ? this.history.add(prompt, fallbackRes.blob, fallbackRes.url) : null;
          this.isGenerating = false;
          return {
            ...fallbackRes,
            entry,
            fallbackUsed: true,
            fallbackReason: `${this.provider.toUpperCase()} unavailable (${err.message})`,
            originalError: err.message,
          };
        } catch (fbErr) {
          this.isGenerating = false;
          throw fbErr;
        }
      }

      this.isGenerating = false;
      throw err;
    }
  }

  async generateFromContext(analysis, bpm, userText = '', { onStatus = () => {} } = {}) {
    const prompt = PromptBuilder.fromAnalysis(
      analysis, bpm, this.selectedMoods, this.selectedInstruments, userText
    );
    return this.generate(prompt, { onStatus });
  }

  /**
   * Convert an AudioBuffer to a standard 16-bit PCM WAV Blob.
   * @param {AudioBuffer} buffer
   * @returns {Blob}
   */
  audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const length = buffer.length * numChannels * 2 + 44;
    const arrayBuffer = new ArrayBuffer(length);
    const view = new DataView(arrayBuffer);

    function writeString(offset, string) {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    }

    // RIFF identifier
    writeString(0, 'RIFF');
    view.setUint32(4, length - 8, true);
    writeString(8, 'WAVE');
    // fmt subchunk
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // PCM chunk size
    view.setUint16(20, 1, true);  // linear PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true); // byte rate
    view.setUint16(32, numChannels * 2, true); // block align
    view.setUint16(34, 16, true); // bits per sample
    // data subchunk
    writeString(36, 'data');
    view.setUint32(40, length - 44, true);

    const channels = [];
    for (let i = 0; i < numChannels; i++) {
      channels.push(buffer.getChannelData(i));
    }

    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        let sample = Math.max(-1, Math.min(1, channels[ch][i]));
        sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset, sample, true);
        offset += 2;
      }
    }

    return new Blob([view], { type: 'audio/wav' });
  }

  /**
   * Extend an existing generation pattern by generating continuation audio with the prompt and concatenating audio.
   * @param {string} entryId - ID of the existing generation entry to extend.
   * @param {object} options - Options object.
   * @param {Function} options.onStatus - Status callback.
   * @returns {Promise<object>} New generation result with combined audio URL and entry.
   */
  async extendPattern(entryId, { onStatus = () => {} } = {}) {
    const entry = this.history.getEntry(entryId);
    if (!entry) throw new Error('History entry not found');

    // Retrieve original blob or regenerate base audio if from past session
    let origBlob = this.history.getBlob(entryId);
    if (!origBlob) {
      const url = this.history.getUrl(entryId);
      if (url) {
        origBlob = await fetch(url).then(r => r.blob()).catch(() => null);
      }
    }
    if (!origBlob) {
      onStatus('regenerating');
      const baseResult = await this.browserAudio.generate(entry.prompt, { duration: 8, onStatus });
      origBlob = baseResult.blob;
      if (baseResult.url) this.history._blobUrls.set(entryId, baseResult.url);
      if (origBlob) this.history._blobs.set(entryId, origBlob);
    }

    // Generate continuation audio
    onStatus('extending');
    const newResult = await this.generate(entry.prompt, { onStatus, addToHistory: false });

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') {
      try { await audioCtx.resume(); } catch (_) {}
    }

    try {
      const [buf1, buf2] = await Promise.all([
        this.toAudioBuffer(origBlob, audioCtx),
        this.toAudioBuffer(newResult.blob, audioCtx)
      ]);

      const numberOfChannels = Math.max(buf1.numberOfChannels, buf2.numberOfChannels);
      const length = buf1.length + buf2.length;
      const combined = audioCtx.createBuffer(numberOfChannels, length, buf1.sampleRate);

      for (let ch = 0; ch < numberOfChannels; ch++) {
        const channelData = combined.getChannelData(ch);
        if (ch < buf1.numberOfChannels) {
          channelData.set(buf1.getChannelData(ch), 0);
        }
        if (ch < buf2.numberOfChannels) {
          channelData.set(buf2.getChannelData(ch), buf1.length);
        }
      }

      const wavBlob = this.audioBufferToWav(combined);
      const combinedUrl = URL.createObjectURL(wavBlob);
      const combinedEntry = this.history.add(`${entry.prompt} (Extended)`, wavBlob, combinedUrl);
      return { blob: wavBlob, url: combinedUrl, entry: combinedEntry, buffer: combined };
    } finally {
      if (audioCtx.state !== 'closed' && typeof audioCtx.close === 'function') {
        try {
          const res = audioCtx.close();
          if (res && typeof res.catch === 'function') res.catch(() => {});
        } catch (_) {}
      }
    }
  }

  play(url) {
    this.stop();
    this.currentAudio = new Audio(url);
    this.currentAudio.play().catch(() => {});
    return this.currentAudio;
  }

  stop() {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
  }

  download(url, filename = 'ai-generated-music.wav') {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async toAudioBuffer(blob, audioContext) {
    if (window.audioEngine && typeof window.audioEngine.decodeAudio === 'function') {
      try {
        const decoded = await window.audioEngine.decodeAudio(blob);
        if (decoded && decoded.duration > 0) return decoded;
      } catch (e) {
        console.warn('[MusicAI] audioEngine.decodeAudio failed, trying Web Audio API:', e);
      }
    }
    const ctx = audioContext || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch (_) {}
    }
    const arrayBuffer = await blob.arrayBuffer();
    return new Promise((resolve, reject) => {
      let settled = false;
      const _resolve = (v) => { if (!settled) { settled = true; resolve(v); } };
      const _reject  = (e) => { if (!settled) { settled = true; reject(e); } };

      try {
        const res = ctx.decodeAudioData(
          arrayBuffer.slice(0),
          decoded => _resolve(decoded),
          err => _reject(err || new Error('Audio decoding failed'))
        );
        if (res && typeof res.then === 'function') {
          res.then(_resolve).catch(_reject);
        }
      } catch (err) {
        _reject(err);
      }
    });
  }

  cancel() {
    this.getActiveClient().cancel();
    this.isGenerating = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Expose
// ─────────────────────────────────────────────────────────────────────────────
if (typeof window !== 'undefined') {
  window.MusicAI                = MusicAI;
  window.BrowserMusicGenerator  = BrowserMusicGenerator;
  window.LocalMusicClient       = LocalMusicClient;
  window.HuggingFaceMusic       = HuggingFaceMusic;
  window.PromptBuilder          = PromptBuilder;
  window.GenerationHistory      = GenerationHistory;
  window.MOOD_TAGS              = MOOD_TAGS;
  window.INSTRUMENT_TAGS        = INSTRUMENT_TAGS;
}
