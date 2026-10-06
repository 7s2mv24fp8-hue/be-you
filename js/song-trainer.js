/**
 * BeYou Studio — Song Audio Analyzer & Max AI Trainer
 * ====================================================
 * Decodes song audio files (MP3/WAV/OGG/FLAC/M4A) via Web Audio API,
 * detects tempo/BPM, extracts 16-step rhythm patterns across 8 drum channels,
 * and feeds the learned pattern directly into Max's AI brain.
 */

'use strict';

window.SongTrainer = class SongTrainer {
  constructor() {
    this.audioCtx = null;
    this.currentAnalysis = null;
  }

  _getAudioContext() {
    if (!this.audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioCtx();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  /**
   * Main entry: Analyze an audio file and extract BPM + 16-step rhythm grid
   * @param {File} file 
   * @param {Object} options { genreHint }
   */
  async analyzeAudioFile(file, options = {}) {
    let audioBuffer;
    if (window.audioEngine && typeof window.audioEngine.decodeAudio === 'function') {
      audioBuffer = await window.audioEngine.decodeAudio(file);
    } else {
      const ctx = this._getAudioContext();
      const arrayBuffer = await file.arrayBuffer();
      audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    }

    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const duration = audioBuffer.duration;

    // Use left channel or mix to mono
    const channelData = audioBuffer.getChannelData(0);

    // 1. Detect BPM
    const bpm = this._estimateBPM(channelData, sampleRate, duration);

    // 2. Extract 16-step rhythm grid across 8 channels
    const channelsPattern = this._extract16StepGrid(channelData, sampleRate, bpm, duration);

    // 3. Estimate Genre if not specified
    const genre = options.genreHint || this._guessGenreFromBPM(bpm);

    // 4. Downsample waveform for visualizer preview (200 points)
    const waveform = this._downsampleWaveform(channelData, 200);

    const songName = file.name.replace(/\.[^/.]+$/, '');

    this.currentAnalysis = {
      songName,
      bpm,
      genre,
      duration: Math.round(duration),
      channels: channelsPattern,
      waveform,
      file,
    };

    return this.currentAnalysis;
  }

  /**
   * Estimate BPM using autocorrelation and peak interval histogram
   */
  _estimateBPM(pcm, sampleRate, duration) {
    // Window length: analyze first 30 seconds for speed & accuracy
    const maxSamples = Math.min(pcm.length, Math.floor(sampleRate * 30));
    const stepSize = Math.floor(sampleRate / 100); // 10ms hop
    const energy = [];

    // Calculate energy onset envelope
    for (let i = 0; i < maxSamples - stepSize; i += stepSize) {
      let sum = 0;
      for (let j = 0; j < stepSize; j += 4) {
        const val = pcm[i + j];
        sum += val * val;
      }
      energy.push(Math.sqrt(sum / (stepSize / 4)));
    }

    // Differentiate energy (onset detection)
    const onsets = new Float32Array(energy.length);
    for (let i = 1; i < energy.length; i++) {
      const diff = energy[i] - energy[i - 1];
      onsets[i] = diff > 0 ? diff : 0;
    }

    // Autocorrelation over lag range (60 BPM to 180 BPM)
    // 60 BPM -> 1 beat = 1s = 100 energy frames
    // 180 BPM -> 1 beat = 0.33s = 33.3 energy frames
    const minLag = Math.floor(1000 / (180 / 60)); // ~33
    const maxLag = Math.floor(1000 / (60 / 60));  // ~100

    let bestLag = 60;
    let maxCorr = -1;

    for (let lag = minLag; lag <= maxLag; lag++) {
      let corr = 0;
      for (let i = 0; i < onsets.length - lag; i++) {
        corr += onsets[i] * onsets[i + lag];
      }
      if (corr > maxCorr) {
        maxCorr = corr;
        bestLag = lag;
      }
    }

    // Convert lag (in 10ms units) back to BPM
    const beatSec = bestLag / 100;
    let bpm = Math.round(60 / beatSec);

    // Normalize BPM into standard music range (70 - 160 BPM)
    if (bpm < 70) bpm *= 2;
    if (bpm > 170) bpm = Math.round(bpm / 2);

    return Math.max(60, Math.min(180, bpm));
  }

  /**
   * Extract 16-step grid by analyzing multi-band energy across 1 bar duration
   */
  _extract16StepGrid(pcm, sampleRate, bpm, duration) {
    const beatSec = 60 / bpm;
    const barSec = beatSec * 4; // 1 bar = 4 beats = 16 sixteenth notes
    const stepSec = barSec / 16;
    const stepSamples = Math.floor(stepSec * sampleRate);

    // Analyze first 4 bars (or as many as available) and average energy per step
    const numBars = Math.max(1, Math.floor(Math.min(duration, 32) / barSec));

    const grid = {
      'Kick':     new Array(16).fill(0),
      'Clap':     new Array(16).fill(0),
      'Hi-Hat C': new Array(16).fill(0),
      'Hi-Hat O': new Array(16).fill(0),
      'Snare':    new Array(16).fill(0),
      'Tom':      new Array(16).fill(0),
      'Bass':     new Array(16).fill(0),
      'Lead':     new Array(16).fill(0),
    };

    // Sub-band energy accumulators (Low, Mid, High)
    const stepLow  = new Float32Array(16);
    const stepMid  = new Float32Array(16);
    const stepHigh = new Float32Array(16);

    for (let b = 0; b < numBars; b++) {
      const barStart = Math.floor(b * barSec * sampleRate);

      for (let s = 0; s < 16; s++) {
        const start = barStart + s * stepSamples;
        const end = Math.min(pcm.length, start + stepSamples);

        let lowE = 0, midE = 0, highE = 0;

        // Simple 3-band energy approximation using zero-crossing + sample diffs
        for (let i = start; i < end - 1; i += 2) {
          const sample = pcm[i];
          const diff = Math.abs(pcm[i + 1] - sample); // High frequency indicator

          if (diff > 0.15) {
            highE += diff;
          } else if (Math.abs(sample) > 0.2) {
            lowE += Math.abs(sample);
          } else {
            midE += Math.abs(sample);
          }
        }

        stepLow[s]  += lowE;
        stepMid[s]  += midE;
        stepHigh[s] += highE;
      }
    }

    // Find max energies for scaling
    const maxLow  = Math.max(...stepLow)  || 1;
    const maxMid  = Math.max(...stepMid)  || 1;
    const maxHigh = Math.max(...stepHigh) || 1;

    // Thresholds & channel pattern assignment
    for (let s = 0; s < 16; s++) {
      const nLow  = stepLow[s]  / maxLow;
      const nMid  = stepMid[s]  / maxMid;
      const nHigh = stepHigh[s] / maxHigh;

      // Kick: strong low energy on downbeats or syncopations
      if (nLow > 0.55 || (s % 4 === 0 && nLow > 0.3)) {
        grid['Kick'][s] = 1;
      }

      // Snare / Clap: strong mid energy, especially on backbeats 4 and 12 (beat 2 and 4)
      if (s === 4 || s === 12 || (nMid > 0.6 && s % 2 === 0)) {
        if (s === 4 || s === 12) {
          grid['Snare'][s] = 1;
          if (nMid > 0.7) grid['Clap'][s] = 1;
        } else if (nMid > 0.65) {
          grid['Snare'][s] = 1;
        }
      }

      // Hi-Hats: high frequency energy
      if (nHigh > 0.35) {
        if (s % 2 === 1 && nHigh > 0.6) {
          grid['Hi-Hat O'][s] = 1; // Off-beat open hat
        } else {
          grid['Hi-Hat C'][s] = 1; // Closed hat
        }
      } else if (s % 2 === 0) {
        // Fallback steady hi-hats
        grid['Hi-Hat C'][s] = 1;
      }

      // Tom: occasional mid-low fills at end of bar (steps 14, 15)
      if ((s === 14 || s === 15) && nMid > 0.5 && !grid['Snare'][s]) {
        grid['Tom'][s] = 1;
      }

      // Bass: tracks Kick rhythm with slight melodic sustain
      if (grid['Kick'][s] || (nLow > 0.45 && s % 4 !== 0)) {
        grid['Bass'][s] = 1;
      }

      // Lead: subtle melodic accents on step 2, 8, or 10
      if ((s === 2 || s === 8 || s === 10) && nMid > 0.5) {
        grid['Lead'][s] = 1;
      }
    }

    return grid;
  }

  /**
   * Downsample audio channel PCM for visual waveform preview
   */
  _downsampleWaveform(pcm, targetPoints = 200) {
    const blockSize = Math.floor(pcm.length / targetPoints);
    const sampled = new Float32Array(targetPoints);
    for (let i = 0; i < targetPoints; i++) {
      let max = 0;
      const start = i * blockSize;
      for (let j = 0; j < blockSize; j += 4) {
        const val = Math.abs(pcm[start + j] || 0);
        if (val > max) max = val;
      }
      sampled[i] = max;
    }
    return sampled;
  }

  /**
   * Simple BPM to Genre mapping helper
   */
  _guessGenreFromBPM(bpm) {
    if (bpm >= 135 && bpm <= 155) return 'trap';
    if (bpm >= 120 && bpm <= 130) return 'house';
    if (bpm >= 80  && bpm <= 95)  return 'hip-hop';
    if (bpm >= 70  && bpm < 80)   return 'lo-fi';
    if (bpm >= 165 && bpm <= 180) return 'dnb';
    if (bpm >= 96  && bpm <= 110) return 'afrobeats';
    if (bpm >= 111 && bpm <= 125) return 'pop';
    return 'hip-hop';
  }

  /**
   * Submit analyzed song to Max backend API
   */
  async trainMaxWithSong(analysisData) {
    if (!analysisData || !analysisData.channels) {
      throw new Error('No song pattern available to train');
    }

    const payload = {
      song_name: analysisData.songName,
      genre: analysisData.genre,
      bpm: analysisData.bpm,
      pattern_json: JSON.stringify(analysisData.channels),
      auto_approve: true,
    };

    const token = localStorage.getItem('bs_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch('/api/train/song', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }

    const data = await res.json();
    return data;
  }
};

window.songTrainer = new window.SongTrainer();
