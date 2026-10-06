/**
 * BeYou Studio — Audio Editor & Waveform Studio (Edison-style)
 * ==============================================================
 * Comprehensive waveform editor featuring:
 * - High-DPI interactive waveform visualizer (in-tab & fullscreen modal)
 * - Timeline scrub ruler (seconds + beats) with animated playhead
 * - Region selection (drag to highlight, double-click select all)
 * - Complete toolset: Cut, Copy, Paste, Delete, Trim to Selection
 * - DSP Processing: Normalize (0 dBFS), Fade In, Fade Out, Reverse, Silence, Gain Boost/Attenuate, Pitch Shift
 * - Send to Channel Rack (creates custom sampler channel from edited buffer)
 * - Built-in demo sound generators (808 Sub, Trap Snare, Hi-Hat, Vocal Formant) so editor is NEVER empty
 * - Multi-layer mixing stack with per-layer volume, mute, solo, and WAV export
 */

'use strict';

class AudioEditor {
  constructor(audioEngine) {
    this.engine = audioEngine;

    this.layers = [];       // { id, name, buffer, color, volume, muted, solo, startSec, trimStart, trimEnd }
    this.selected = null;   // selected layer id

    this.zoom       = 1.0;
    this.scrollLeft = 0;
    this.duration   = 10;   // timeline seconds

    this.playPos    = 0;
    this.playing    = false;
    this._sources   = [];
    this._rafId     = null;

    this.clipboard  = null;

    // Selection range (in seconds)
    this.selStart   = 0;
    this.selEnd     = 0;
    this.isSelecting= false;
    this.dragAnchor = 0;

    // Canvases
    this._tabCanvas = null;

    this._bindTabElements();

    // Auto-load demo 808 sound so editor is instantly active and alive on open
    setTimeout(() => {
      if (!this.layers.length) {
        this.loadDemo808(false);
      }
    }, 300);
  }

  get audioCtx() {
    if (!this.engine.initialized) this.engine.init();
    return this.engine.ctx;
  }

  get audioDest() {
    return this.engine.masterCompressor || this.engine.masterGain || this.audioCtx.destination;
  }

  /* ── Tab & Modal Bindings ──────────────────────────────── */

  _bindTabElements() {
    this._tabCanvas = document.getElementById('ae-tab-waveform-canvas');
    if (this._tabCanvas) {
      this._attachCanvasInteractions(this._tabCanvas);
    }
    const tabWrap = document.getElementById('edison-canvas-wrap');
    if (tabWrap) {
      tabWrap.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        tabWrap.classList.add('ae-drag-over');
      });
      tabWrap.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        tabWrap.classList.remove('ae-drag-over');
      });
      tabWrap.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        tabWrap.classList.remove('ae-drag-over');
        const file = e.dataTransfer?.files?.[0];
        if (file) {
          if (window.app && typeof window.app._importFileToApp === 'function') {
            await window.app._importFileToApp(file);
          } else {
            await this.importAudioFile(file);
          }
        }
      });
    }
    window.addEventListener('resize', () => {
      this._resize();
      this._draw();
    });

    // Remove any leftover duplicate floating modal from DOM
    const oldModal = document.getElementById('ae-modal');
    if (oldModal) oldModal.remove();
  }

  open(layer) {
    if (window.app && typeof window.app._switchTab === 'function') {
      window.app._switchTab('audio-editor');
    }
    if (layer) this.selectLayer(layer.id || layer);
    requestAnimationFrame(() => {
      this._resize();
      this._draw();
    });
  }

  close() {
    this.pause();
  }

  /* ── Canvas Hit-Testing & Selection ────────────────────── */

  _attachCanvasInteractions(canvas) {
    const getSecFromClientX = (clientX) => {
      const rect = canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const dur = Math.max(1, this.duration);
      return (x / rect.width) * dur;
    };

    canvas.addEventListener('mousedown', (e) => {
      const t = getSecFromClientX(e.clientX);
      this.isSelecting = true;
      this.dragAnchor = t;
      this.selStart = t;
      this.selEnd = t;
      this.playPos = t;
      this._draw();
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isSelecting) return;
      const t = getSecFromClientX(e.clientX);
      this.selStart = Math.min(this.dragAnchor, t);
      this.selEnd   = Math.max(this.dragAnchor, t);
      this.playPos  = this.selStart;
      this._draw();
    });

    window.addEventListener('mouseup', () => {
      if (this.isSelecting) {
        this.isSelecting = false;
        // If single click without drag, reset selection
        if (Math.abs(this.selEnd - this.selStart) < 0.05) {
          this.selStart = 0;
          this.selEnd = 0;
        }
        this._draw();
      }
    });

    // Double click to select whole active clip
    canvas.addEventListener('dblclick', () => {
      const sel = this._getSelected();
      if (sel && sel.buffer) {
        this.selStart = sel.trimStart;
        this.selEnd   = sel.trimEnd;
      } else {
        this.selStart = 0;
        this.selEnd   = this.duration;
      }
      this._draw();
    });
  }

  /* ── Layer Management ──────────────────────────────────── */

  addLayer(buffer, name, color) {
    if (!buffer) return null;
    const id = `layer_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const layer = {
      id,
      name: name || `Audio Clip ${this.layers.length + 1}`,
      buffer,
      color: color || this._randColor(),
      volume: 1.0,
      muted: false,
      solo: false,
      startSec: 0,
      trimStart: 0,
      trimEnd: buffer.duration,
    };
    this.layers.push(layer);
    this.selected = id;
    this.duration = Math.max(10, buffer.duration + 1.5);
    this._renderLayerList();
    this._draw();
    return id;
  }

  async importAudioFile(file) {
    if (!file) return null;
    try {
      const buf = await this.engine.decodeAudio(file);
      const name = file.name.replace(/\.[^.]+$/, '');
      const id = this.addLayer(buf, name);
      if (window.app && typeof window.app._updateInlineLayerList === 'function') {
        window.app._updateInlineLayerList();
      }
      if (typeof showToast === 'function') {
        showToast(`Loaded ${file.name} (${buf.duration.toFixed(2)}s)`, 2500);
      }
      return id;
    } catch (err) {
      console.error('[AudioEditor] Failed to import audio:', err);
      if (typeof showToast === 'function') {
        showToast(`Could not decode ${file.name}: ${err.message}`, 3500);
      }
      return null;
    }
  }

  selectLayer(id) {
    this.selected = id;
    document.querySelectorAll('.ae-layer-item, .ae-inline-layer-card').forEach(el => {
      el.classList.toggle('ae-selected', el.dataset.id === id);
    });
    this._draw();
  }

  _getSelected() {
    return this.layers.find(l => l.id === this.selected) || (this.layers.length ? this.layers[0] : null);
  }

  /* ── Playback Engine ───────────────────────────────────── */

  play(from = null) {
    if (this.playing) this.pause();
    const ctx = this.audioCtx;
    if (ctx.state === 'suspended') ctx.resume();

    const startFrom = (from !== null) ? from : (this.selStart > 0 ? this.selStart : this.playPos);
    const now = ctx.currentTime;
    this._sources = [];

    const anySolo = this.layers.some(l => l.solo);
    this.layers.forEach(layer => {
      if (layer.muted || (anySolo && !layer.solo) || !layer.buffer) return;

      const offset = Math.max(0, startFrom - layer.startSec);
      const clipLen = layer.trimEnd - layer.trimStart;
      if (offset >= clipLen) return;

      const src = ctx.createBufferSource();
      src.buffer = layer.buffer;
      const gainNode = ctx.createGain();
      gainNode.gain.value = layer.volume;
      src.connect(gainNode);
      gainNode.connect(this.audioDest);

      const playDuration = (this.selEnd > this.selStart) ? (this.selEnd - startFrom) : undefined;
      src.start(now, layer.trimStart + offset, playDuration);
      this._sources.push(src);
    });

    this.playing = true;
    this._playStartTime = now - startFrom;
    this._rafId = requestAnimationFrame(() => this._animLoop());
  }

  pause() {
    this.playing = false;
    this._sources.forEach(s => { try { s.stop(); } catch (_) {} });
    this._sources = [];
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._draw();
  }

  togglePlay() {
    this.playing ? this.pause() : this.play();
  }

  _animLoop() {
    if (!this.playing) return;
    const now = this.audioCtx.currentTime;
    this.playPos = now - this._playStartTime;

    // Loop selection or auto-stop at end
    if (this.selEnd > this.selStart && this.playPos >= this.selEnd) {
      this.play(this.selStart);
      return;
    } else if (this.playPos >= this.duration) {
      this.pause();
      this.playPos = 0;
      return;
    }

    this._draw();
    this._rafId = requestAnimationFrame(() => this._animLoop());
  }

  /* ── Core Waveform Editing Tools ───────────────────────── */

  cutRegion() {
    const layer = this._getSelected();
    if (!layer || !layer.buffer || this.selStart >= this.selEnd) {
      if (window.showToast) window.showToast('Select a region first to cut!');
      return;
    }
    this.clipboard = this._extractRegion(layer.buffer, this.selStart, this.selEnd);
    this._applyDelete(layer);
    this.selStart = 0; this.selEnd = 0;
    this._draw();
    if (window.showToast) window.showToast('Region cut to clipboard!');
  }

  copyRegion() {
    const layer = this._getSelected();
    if (!layer || !layer.buffer || this.selStart >= this.selEnd) {
      if (window.showToast) window.showToast('Select a region first to copy!');
      return;
    }
    this.clipboard = this._extractRegion(layer.buffer, this.selStart, this.selEnd);
    if (window.showToast) window.showToast('Region copied to clipboard!');
  }

  pasteRegion() {
    if (!this.clipboard) {
      if (window.showToast) window.showToast('Clipboard is empty!');
      return;
    }
    this.addLayer(this.clipboard, 'Pasted Audio Sample');
    if (window.showToast) window.showToast('Pasted into new audio track!');
  }

  deleteRegion() {
    const layer = this._getSelected();
    if (!layer || !layer.buffer || this.selStart >= this.selEnd) {
      if (window.showToast) window.showToast('Select a region first to delete!');
      return;
    }
    this._applyDelete(layer);
    this.selStart = 0; this.selEnd = 0;
    this._draw();
    if (window.showToast) window.showToast('Region deleted!');
  }

  trimRegion() {
    const layer = this._getSelected();
    if (!layer || !layer.buffer || this.selStart >= this.selEnd) {
      if (window.showToast) window.showToast('Select a region first to trim!');
      return;
    }
    const trimmed = this._extractRegion(layer.buffer, this.selStart, this.selEnd);
    if (trimmed) {
      layer.buffer = trimmed;
      layer.trimStart = 0;
      layer.trimEnd = trimmed.duration;
      this.duration = Math.max(8, trimmed.duration + 1);
      this.selStart = 0;
      this.selEnd = 0;
      this._draw();
      if (window.showToast) window.showToast('Trimmed to selection!');
    }
  }

  normalize() {
    const layer = this._getSelected();
    if (!layer || !layer.buffer) return;
    const buf = layer.buffer;
    let peak = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const data = buf.getChannelData(c);
      for (let i = 0; i < data.length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
      }
    }
    if (peak < 0.0001) return;
    const mult = 0.98 / peak;
    const newBuf = this.audioCtx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const src = buf.getChannelData(c);
      const dst = newBuf.getChannelData(c);
      for (let i = 0; i < src.length; i++) dst[i] = src[i] * mult;
    }
    layer.buffer = newBuf;
    this._draw();
    if (window.showToast) window.showToast('Normalized peak to 0 dBFS!');
  }

  fadeIn(durationSec = 0.4) {
    const layer = this._getSelected();
    if (!layer || !layer.buffer) return;
    const buf = layer.buffer;
    const fadeSamples = Math.min(Math.floor(durationSec * buf.sampleRate), buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < fadeSamples; i++) {
        d[i] *= (i / fadeSamples);
      }
    }
    this._draw();
    if (window.showToast) window.showToast(`Applied Fade In (${durationSec}s)!`);
  }

  fadeOut(durationSec = 0.4) {
    const layer = this._getSelected();
    if (!layer || !layer.buffer) return;
    const buf = layer.buffer;
    const fadeSamples = Math.min(Math.floor(durationSec * buf.sampleRate), buf.length);
    const startSample = buf.length - fadeSamples;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < fadeSamples; i++) {
        d[startSample + i] *= (1 - i / fadeSamples);
      }
    }
    this._draw();
    if (window.showToast) window.showToast(`Applied Fade Out (${durationSec}s)!`);
  }

  reverse() {
    const layer = this._getSelected();
    if (!layer || !layer.buffer) return;
    for (let c = 0; c < layer.buffer.numberOfChannels; c++) {
      layer.buffer.getChannelData(c).reverse();
    }
    this._draw();
    if (window.showToast) window.showToast('Audio reversed!');
  }

  silence() {
    const layer = this._getSelected();
    if (!layer || !layer.buffer || this.selStart >= this.selEnd) return;
    const buf = layer.buffer;
    const sStart = Math.floor(this.selStart * buf.sampleRate);
    const sEnd = Math.min(buf.length, Math.ceil(this.selEnd * buf.sampleRate));
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = sStart; i < sEnd; i++) d[i] = 0;
    }
    this._draw();
    if (window.showToast) window.showToast('Silenced selected region!');
  }

  adjustGain(dbDelta = 3) {
    const layer = this._getSelected();
    if (!layer || !layer.buffer) return;
    const mult = Math.pow(10, dbDelta / 20);
    const buf = layer.buffer;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] = Math.max(-1, Math.min(1, d[i] * mult));
    }
    this._draw();
    if (window.showToast) window.showToast(`Gain adjusted: ${dbDelta > 0 ? '+' : ''}${dbDelta} dB!`);
  }

  pitchShift(semitones = 1) {
    const layer = this._getSelected();
    if (!layer || !layer.buffer) return;
    const srcBuf = layer.buffer;
    const ratio = Math.pow(2, semitones / 12);
    const newLen = Math.floor(srcBuf.length / ratio);
    const newBuf = this.audioCtx.createBuffer(srcBuf.numberOfChannels, newLen, srcBuf.sampleRate);

    for (let c = 0; c < srcBuf.numberOfChannels; c++) {
      const src = srcBuf.getChannelData(c);
      const dst = newBuf.getChannelData(c);
      for (let i = 0; i < newLen; i++) {
        const srcPos = i * ratio;
        const i0 = Math.floor(srcPos);
        const i1 = Math.min(srcBuf.length - 1, i0 + 1);
        const frac = srcPos - i0;
        dst[i] = src[i0] * (1 - frac) + src[i1] * frac;
      }
    }
    layer.buffer = newBuf;
    layer.trimEnd = newBuf.duration;
    this._draw();
    if (window.showToast) window.showToast(`Pitch shifted by ${semitones > 0 ? '+' : ''}${semitones} st!`);
  }

  sendToChannelRack() {
    const layer = this._getSelected();
    if (!layer || !layer.buffer) {
      if (window.showToast) window.showToast('No audio sample to send!');
      return;
    }
    if (window.app && window.app.sequencer) {
      const newIdx = window.app.sequencer.channels.length;
      window.app.sequencer.channels.push({
        name: layer.name.slice(0, 12),
        color: layer.color || '#2ed573',
        type: 'audio',
        audioBuffer: layer.buffer,
        sampleFileName: `${layer.name}.wav`,
        steps: [true, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
        velocity: Array(16).fill(0.85),
        volume: 0.9,
        pan: 0,
        muted: false,
        solo: false,
        notes: [],
      });
      if (window.app._refreshChannelRack) window.app._refreshChannelRack();
      if (window.showToast) window.showToast(`Sent "${layer.name}" to Channel Rack as Track ${newIdx + 1}!`);
    }
  }

  /* ── Instant Preset Sound Generators ───────────────────── */

  loadDemo808(showToast = true) {
    const ctx = this.audioCtx;
    const dur = 2.0;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = buf.getChannelData(0);
    const baseFreq = 55; // A1
    for (let i = 0; i < data.length; i++) {
      const t = i / ctx.sampleRate;
      const freq = baseFreq * Math.exp(-t * 2.5);
      const phase = 2 * Math.PI * freq * t;
      const env = Math.exp(-t * 1.5);
      // Soft saturation
      const raw = Math.sin(phase) * env;
      data[i] = Math.tanh(raw * 1.8) * 0.9;
    }
    this.addLayer(buf, '808 Sub Drop', '#ff4757');
    if (showToast && window.showToast) window.showToast('Loaded 808 Sub Bass into Editor!');
  }

  loadDemoSnare() {
    const ctx = this.audioCtx;
    const dur = 0.5;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / ctx.sampleRate;
      const tone = Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t * 18);
      const noise = (Math.random() * 2 - 1) * Math.exp(-t * 12);
      data[i] = (tone * 0.5 + noise * 0.5) * 0.85;
    }
    this.addLayer(buf, 'Trap Snare Hit', '#ffa502');
    if (window.showToast) window.showToast('Loaded Trap Snare into Editor!');
  }

  loadDemoHiHat() {
    const ctx = this.audioCtx;
    const dur = 0.35;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / ctx.sampleRate;
      const noise = (Math.random() * 2 - 1) * Math.exp(-t * 25);
      data[i] = noise * 0.7;
    }
    this.addLayer(buf, 'Closed Hi-Hat', '#2ed573');
    if (window.showToast) window.showToast('Loaded Hi-Hat into Editor!');
  }

  loadDemoVocal() {
    const ctx = this.audioCtx;
    const dur = 1.8;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / ctx.sampleRate;
      const f1 = 440;
      const env = Math.sin((t / dur) * Math.PI);
      const formant = Math.sin(2 * Math.PI * f1 * t) + 0.5 * Math.sin(2 * Math.PI * f1 * 2 * t);
      data[i] = formant * env * 0.6;
    }
    this.addLayer(buf, 'Vocal Formant Chop', '#00d2d3');
    if (window.showToast) window.showToast('Loaded Vocal Formant into Editor!');
  }

  loadProjectTracks() {
    let count = 0;
    if (window.app && window.app.sequencer && window.app.sequencer.channels) {
      window.app.sequencer.channels.forEach(ch => {
        if (ch.audioBuffer) {
          this.addLayer(ch.audioBuffer, ch.name, ch.color);
          count++;
        }
      });
    }
    if (count > 0) {
      if (window.showToast) window.showToast(`Imported ${count} project audio tracks!`);
    } else {
      this.loadDemo808();
    }
  }

  /* ── Canvas Rendering Engine ───────────────────────────── */

  _resize() {
    const canvases = [this._tabCanvas, this._modalCanvas].filter(Boolean);
    canvases.forEach(c => {
      const parent = c.parentElement;
      if (!parent) return;
      const w = Math.max(300, Math.floor(parent.clientWidth || 500));
      const h = Math.max(140, Math.floor(parent.clientHeight || 220));
      const dpr = window.devicePixelRatio || 1;
      c.width  = w * dpr;
      c.height = h * dpr;
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    });
  }

  _draw() {
    const canvases = [this._tabCanvas, this._modalCanvas].filter(Boolean);
    canvases.forEach(canvas => {
      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);

      // Dark FL Studio Edison Background
      ctx.fillStyle = '#0a0d14';
      ctx.fillRect(0, 0, w, h);

      // Timeline Ruler at top
      ctx.fillStyle = '#111622';
      ctx.fillRect(0, 0, w, 22);
      ctx.strokeStyle = '#1e2638';
      ctx.beginPath();
      ctx.moveTo(0, 22); ctx.lineTo(w, 22); ctx.stroke();

      const dur = Math.max(1, this.duration);
      const secStep = dur > 15 ? 2 : 0.5;

      ctx.fillStyle = '#6b7280';
      ctx.font = '8px JetBrains Mono, monospace';
      for (let s = 0; s <= dur; s += secStep) {
        const sx = (s / dur) * w;
        ctx.fillRect(sx, 12, 1, 10);
        if (s % 1 === 0) {
          ctx.fillText(`${s.toFixed(1)}s`, sx + 3, 16);
        }
      }

      // Draw Center Zero-Crossing Line
      const midY = 22 + (h - 22) / 2;
      ctx.strokeStyle = '#1b2230';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, midY); ctx.lineTo(w, midY); ctx.stroke();

      // Render Selected Audio Layer Waveform
      const layer = this._getSelected();
      if (layer && layer.buffer) {
        const buf = layer.buffer;
        const data = buf.getChannelData(0);
        const waveH = (h - 26);
        const startX = (layer.startSec / dur) * w;
        const clipW  = ((layer.trimEnd - layer.trimStart) / dur) * w;

        // Waveform gradient
        const waveGrad = ctx.createLinearGradient(0, 22, 0, h);
        waveGrad.addColorStop(0, '#00d2d3');
        waveGrad.addColorStop(0.5, '#1e90ff');
        waveGrad.addColorStop(1, '#ff4757');
        ctx.strokeStyle = waveGrad;
        ctx.lineWidth = 1.2;

        const sStart = Math.floor(layer.trimStart * buf.sampleRate);
        const sEnd   = Math.floor(layer.trimEnd   * buf.sampleRate);
        const totalSamples = sEnd - sStart;
        const step = Math.max(1, Math.floor(totalSamples / clipW));

        ctx.beginPath();
        for (let px = 0; px < clipW; px++) {
          const sampleIdx = sStart + Math.floor((px / clipW) * totalSamples);
          let min = 0, max = 0;
          for (let j = 0; j < step && sampleIdx + j < sEnd; j++) {
            const val = data[sampleIdx + j];
            if (val < min) min = val;
            if (val > max) max = val;
          }
          const y1 = midY - max * (waveH / 2) * layer.volume;
          const y2 = midY - min * (waveH / 2) * layer.volume;
          ctx.moveTo(startX + px, y1);
          ctx.lineTo(startX + px, y2);
        }
        ctx.stroke();

        // Layer Name Label in corner
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px Inter, sans-serif';
        ctx.fillText(`${layer.name} (${layer.buffer.duration.toFixed(2)}s)`, startX + 8, 38);
      } else {
        // Empty state watermark
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Click "+ Import Sound" or load a demo sound below', w / 2, midY);
        ctx.textAlign = 'left';
      }

      // Shaded Selection Overlay
      if (this.selEnd > this.selStart) {
        const sx = (this.selStart / dur) * w;
        const sw = ((this.selEnd - this.selStart) / dur) * w;

        ctx.fillStyle = 'rgba(0, 210, 211, 0.2)';
        ctx.fillRect(sx, 22, sw, h - 22);

        ctx.strokeStyle = '#00d2d3';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx, 22); ctx.lineTo(sx, h);
        ctx.moveTo(sx + sw, 22); ctx.lineTo(sx + sw, h);
        ctx.stroke();

        // Selection duration label
        ctx.fillStyle = '#00d2d3';
        ctx.font = '9px JetBrains Mono, monospace';
        ctx.fillText(`Selection: ${(this.selEnd - this.selStart).toFixed(2)}s`, sx + 4, 34);
      }

      // Live Playhead Indicator
      if (this.playPos > 0) {
        const px = (this.playPos / dur) * w;
        if (px >= 0 && px <= w) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(px, 0); ctx.lineTo(px, h);
          ctx.stroke();

          ctx.fillStyle = '#ff4757';
          ctx.beginPath();
          ctx.moveTo(px - 4, 0); ctx.lineTo(px + 4, 0); ctx.lineTo(px, 8);
          ctx.fill();
        }
      }

      ctx.restore();
    });
  }

  _renderLayerList() {
    const listEl = document.getElementById('ae-inline-layers');
    const emptyEl = document.getElementById('ae-inline-empty');
    if (!listEl) return;

    if (!this.layers.length) {
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    listEl.querySelectorAll('.ae-inline-layer-card').forEach(c => c.remove());

    this.layers.forEach(layer => {
      const card = document.createElement('div');
      card.className = `ae-inline-layer-card ${layer.id === this.selected ? 'ae-selected' : ''}`;
      card.dataset.id = layer.id;
      card.style.cssText = `
        display:flex;align-items:center;gap:8px;padding:6px 10px;
        background:#111622;border:1px solid #1e2638;border-left:3px solid ${layer.color};
        border-radius:6px;margin-bottom:4px;cursor:pointer;
      `;
      card.innerHTML = `
        <span style="font-size:11px;font-weight:700;color:#fff;flex:1;">${layer.name}</span>
        <span style="font-size:9px;color:#9ca3af;font-family:monospace;">${layer.buffer.duration.toFixed(2)}s</span>
        <button class="ae-card-del-btn" style="background:#ef444422;border:1px solid #ef444455;color:#ef4444;border-radius:4px;padding:1px 6px;cursor:pointer;font-size:10px;">✕</button>
      `;

      card.addEventListener('click', () => {
        this.selectLayer(layer.id);
        this._draw();
      });

      card.querySelector('.ae-card-del-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.layers = this.layers.filter(l => l.id !== layer.id);
        if (this.selected === layer.id) {
          this.selected = this.layers.length ? this.layers[0].id : null;
        }
        this._renderLayerList();
        this._draw();
      });

      listEl.appendChild(card);
    });
  }

  /* ── Internal Buffer Utilities ─────────────────────────── */

  _extractRegion(buffer, startSec, endSec) {
    const sr = buffer.sampleRate;
    const startSample = Math.floor(startSec * sr);
    const endSample   = Math.min(Math.ceil(endSec * sr), buffer.length);
    const len = endSample - startSample;
    if (len <= 0) return null;
    const newBuf = this.audioCtx.createBuffer(buffer.numberOfChannels, len, sr);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const src = buffer.getChannelData(c).subarray(startSample, endSample);
      newBuf.getChannelData(c).set(src);
    }
    return newBuf;
  }

  _applyDelete(layer) {
    const buf = layer.buffer;
    const sr = buf.sampleRate;
    const delStart = Math.floor(this.selStart * sr);
    const delEnd   = Math.min(Math.ceil(this.selEnd * sr), buf.length);
    const newLen   = buf.length - (delEnd - delStart);
    if (newLen <= 0) {
      layer.buffer = null;
      return;
    }
    const newBuf = this.audioCtx.createBuffer(buf.numberOfChannels, newLen, sr);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const src = buf.getChannelData(c);
      const dst = newBuf.getChannelData(c);
      dst.set(src.subarray(0, delStart));
      dst.set(src.subarray(delEnd), delStart);
    }
    layer.buffer = newBuf;
    layer.trimEnd = newBuf.duration;
  }

  _randColor() {
    const palette = ['#00d2d3', '#ff4757', '#ffa502', '#2ed573', '#1e90ff', '#9b59b6'];
    return palette[this.layers.length % palette.length];
  }

  async exportMix() {
    if (!this.layers.length) {
      if (window.showToast) window.showToast('No audio layers to export!');
      return;
    }
    if (window.showToast) window.showToast('Rendering mix to WAV...', 2000);

    const sr = this.audioCtx.sampleRate;
    const totalSamples = Math.ceil(this.duration * sr);
    const offline = new OfflineAudioContext(2, totalSamples, sr);

    this.layers.forEach(l => {
      if (l.muted || !l.buffer) return;
      const src = offline.createBufferSource();
      src.buffer = l.buffer;
      const gain = offline.createGain();
      gain.gain.value = l.volume;
      src.connect(gain);
      gain.connect(offline.destination);
      src.start(l.startSec, l.trimStart);
    });

    const rendered = await offline.startRendering();
    const wavBlob = this._bufferToWAV(rendered);
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `edison_export_${Date.now()}.wav`;
    a.click();
    URL.revokeObjectURL(url);
    if (window.showToast) window.showToast('WAV file downloaded successfully!');
  }

  _bufferToWAV(ab) {
    const numChannels = ab.numberOfChannels;
    const sampleRate = ab.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const numSamples = ab.length;
    const dataSize = numSamples * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    const writeString = (offset, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    const channels = [];
    for (let c = 0; c < numChannels; c++) channels.push(ab.getChannelData(c));

    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
      for (let c = 0; c < numChannels; c++) {
        const sample = Math.max(-1, Math.min(1, channels[c][i]));
        const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset, int16, true);
        offset += 2;
      }
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }
}

window.AudioEditor = AudioEditor;
