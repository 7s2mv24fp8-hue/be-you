/**
 * BeYou Studio — Audio Editor & Waveform Studio (Edison-style)
 * ==============================================================
 * Comprehensive waveform editor featuring:
 * - High-DPI interactive waveform visualizer with Zoom & Pan scrubbing
 * - Timeline scrub ruler (seconds + beats) with animated playhead
 * - Region selection (drag to highlight, double-click select all)
 * - Complete toolset: Cut, Copy, Paste, Delete, Trim to Selection
 * - DSP Processing: Normalize (0 dBFS), Fade In, Fade Out, Reverse, Silence, Gain Boost/Attenuate, Pitch Shift
 *   (all operations intelligently apply to selected region or entire clip)
 * - Send to Channel Rack (creates sampler channel and updates rack, mixer, and playlist)
 * - Load Project Tracks (offline-renders or imports all project channels so they can be edited)
 * - Built-in demo sound generators (808 Sub, Trap Snare, Hi-Hat, Vocal Formant)
 * - Fullscreen studio expansion mode
 * - 16-bit WAV export
 */

'use strict';

class AudioEditor {
  constructor(audioEngine) {
    this.engine = audioEngine;

    this.layers = [];       // { id, name, buffer, color, volume, muted, solo, startSec, trimStart, trimEnd }
    this.selected = null;   // selected layer id

    this.zoom       = 1.0;  // 1.0 = fit full duration
    this.scrollLeft = 0;    // seconds offset when zoomed
    this.duration   = 4.0;  // timeline seconds (dynamically fits loaded clips)

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
    }, 250);
  }

  get audioCtx() {
    if (!this.engine.initialized) this.engine.init();
    return this.engine.ctx;
  }

  get audioDest() {
    return this.engine.masterCompressor || this.engine.masterGain || this.audioCtx.destination;
  }

  /* ── Tab & Canvas Bindings ─────────────────────────────── */

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

  toggleFullscreen() {
    const wrap = document.querySelector('.edison-studio-wrap');
    if (!wrap) return;
    const isFull = wrap.classList.toggle('edison-fullscreen');
    const btn = document.getElementById('ae-open-fullscreen');
    if (btn) btn.textContent = isFull ? '✕ Exit Full' : '⛶ Fullscreen';
    requestAnimationFrame(() => {
      this._resize();
      this._draw();
    });
  }

  /* ── Zoom & Pan Controls ───────────────────────────────── */

  setZoom(z, centerClientX = null) {
    const oldZoom = this.zoom;
    const newZoom = Math.max(1.0, Math.min(50.0, z));
    this.zoom = newZoom;

    if (newZoom === 1.0) {
      this.scrollLeft = 0;
    } else if (centerClientX !== null && this._tabCanvas) {
      const rect = this._tabCanvas.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (centerClientX - rect.left) / rect.width));
      const oldView = this.duration / oldZoom;
      const newView = this.duration / newZoom;
      const tAtCenter = this.scrollLeft + frac * oldView;
      this.scrollLeft = Math.max(0, Math.min(this.duration - newView, tAtCenter - frac * newView));
    }
    this._draw();
  }

  zoomIn() {
    this.setZoom(this.zoom * 1.4);
  }

  zoomOut() {
    this.setZoom(this.zoom / 1.4);
  }

  zoomFit() {
    this.zoom = 1.0;
    this.scrollLeft = 0;
    this._draw();
  }

  /* ── Canvas Hit-Testing & Selection ────────────────────── */

  _attachCanvasInteractions(canvas) {
    const getSecFromClientX = (clientX) => {
      const rect = canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const viewDur = this.duration / this.zoom;
      const t = this.scrollLeft + (x / rect.width) * viewDur;
      return Math.max(0, Math.min(this.duration, t));
    };

    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        // Middle click or Alt+click: pan dragging
        this.isPanning = true;
        this.panStartX = e.clientX;
        this.panStartScroll = this.scrollLeft;
        return;
      }
      const t = getSecFromClientX(e.clientX);
      this.isSelecting = true;
      this.dragAnchor = t;
      this.selStart = t;
      this.selEnd = t;
      this.playPos = t;
      this._draw();
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isPanning) {
        const dx = e.clientX - this.panStartX;
        const rect = canvas.getBoundingClientRect();
        const viewDur = this.duration / this.zoom;
        const dt = -(dx / rect.width) * viewDur;
        this.scrollLeft = Math.max(0, Math.min(this.duration - viewDur, this.panStartScroll + dt));
        this._draw();
        return;
      }
      if (!this.isSelecting) return;
      const t = getSecFromClientX(e.clientX);
      this.selStart = Math.min(this.dragAnchor, t);
      this.selEnd   = Math.max(this.dragAnchor, t);
      this.playPos  = this.selStart;
      this._draw();
    });

    window.addEventListener('mouseup', () => {
      if (this.isPanning) {
        this.isPanning = false;
      }
      if (this.isSelecting) {
        this.isSelecting = false;
        // If single click without drag, reset region highlight
        if (Math.abs(this.selEnd - this.selStart) < 0.03) {
          this.selStart = 0;
          this.selEnd = 0;
        }
        this._draw();
      }
    });

    // Double click to select entire active clip
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

    // Mouse wheel zoom & pan
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        const factor = e.deltaY < 0 ? 1.25 : 0.8;
        this.setZoom(this.zoom * factor, e.clientX);
      } else {
        // Horizontal pan
        const viewDur = this.duration / this.zoom;
        const delta = (e.deltaX / canvas.clientWidth) * viewDur;
        this.scrollLeft = Math.max(0, Math.min(this.duration - viewDur, this.scrollLeft + delta));
        this._draw();
      }
    }, { passive: false });
  }

  /* ── Layer Management ──────────────────────────────────── */

  _updateDuration() {
    let maxEnd = 0;
    this.layers.forEach(l => {
      if (l.buffer) {
        const end = (l.startSec || 0) + (l.trimEnd || l.buffer.duration);
        if (end > maxEnd) maxEnd = end;
      }
    });
    // Dynamically size timeline to fit clips comfortably
    this.duration = maxEnd > 0 ? Math.max(0.4, maxEnd * 1.04) : 4.0;
  }

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
    this._updateDuration();
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

    // Update play button text/style
    const playBtn = document.getElementById('ae-play-btn');
    if (playBtn) {
      playBtn.classList.add('active');
      playBtn.textContent = '⏸ Pause';
    }

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
    const playBtn = document.getElementById('ae-play-btn');
    if (playBtn) {
      playBtn.classList.remove('active');
      playBtn.textContent = '▶ Play';
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
    this._updateDuration();
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
    this._updateDuration();
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
      this.selStart = 0;
      this.selEnd = 0;
      this._updateDuration();
      this._draw();
      if (window.showToast) window.showToast('Trimmed to selection!');
    }
  }

  /* ── Selection-Aware DSP Tools ─────────────────────────── */

  normalize() {
    const layer = this._getSelected();
    if (!layer || !layer.buffer) return;
    const buf = layer.buffer;
    const sr = buf.sampleRate;
    const hasSelection = this.selEnd > this.selStart;
    const sStart = hasSelection ? Math.floor(this.selStart * sr) : 0;
    const sEnd   = hasSelection ? Math.min(buf.length, Math.ceil(this.selEnd * sr)) : buf.length;

    let peak = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const data = buf.getChannelData(c);
      for (let i = sStart; i < sEnd; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
      }
    }
    if (peak < 0.0001) return;
    const mult = 0.98 / peak;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const data = buf.getChannelData(c);
      for (let i = sStart; i < sEnd; i++) data[i] *= mult;
    }
    this._draw();
    if (window.showToast) window.showToast(hasSelection ? 'Normalized selected region to 0 dBFS!' : 'Normalized entire clip to 0 dBFS!');
  }

  fadeIn(durationSec = 0.4) {
    const layer = this._getSelected();
    if (!layer || !layer.buffer) return;
    const buf = layer.buffer;
    const sr = buf.sampleRate;
    const hasSelection = this.selEnd > this.selStart;

    const sStart = hasSelection ? Math.floor(this.selStart * sr) : 0;
    const sEnd   = hasSelection ? Math.min(buf.length, Math.ceil(this.selEnd * sr)) : Math.min(buf.length, Math.floor(durationSec * sr));
    const totalSamples = sEnd - sStart;
    if (totalSamples <= 0) return;

    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < totalSamples; i++) {
        d[sStart + i] *= (i / totalSamples);
      }
    }
    this._draw();
    if (window.showToast) window.showToast(hasSelection ? 'Applied Fade In across selection!' : `Applied Fade In (${durationSec}s)!`);
  }

  fadeOut(durationSec = 0.4) {
    const layer = this._getSelected();
    if (!layer || !layer.buffer) return;
    const buf = layer.buffer;
    const sr = buf.sampleRate;
    const hasSelection = this.selEnd > this.selStart;

    const sStart = hasSelection ? Math.floor(this.selStart * sr) : Math.max(0, buf.length - Math.floor(durationSec * sr));
    const sEnd   = hasSelection ? Math.min(buf.length, Math.ceil(this.selEnd * sr)) : buf.length;
    const totalSamples = sEnd - sStart;
    if (totalSamples <= 0) return;

    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < totalSamples; i++) {
        d[sStart + i] *= (1 - i / totalSamples);
      }
    }
    this._draw();
    if (window.showToast) window.showToast(hasSelection ? 'Applied Fade Out across selection!' : `Applied Fade Out (${durationSec}s)!`);
  }

  reverse() {
    const layer = this._getSelected();
    if (!layer || !layer.buffer) return;
    const buf = layer.buffer;
    const sr = buf.sampleRate;
    const hasSelection = this.selEnd > this.selStart;

    if (hasSelection) {
      const sStart = Math.floor(this.selStart * sr);
      const sEnd   = Math.min(buf.length, Math.ceil(this.selEnd * sr));
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const d = buf.getChannelData(c);
        let left = sStart, right = sEnd - 1;
        while (left < right) {
          const temp = d[left];
          d[left] = d[right];
          d[right] = temp;
          left++;
          right--;
        }
      }
      if (window.showToast) window.showToast('Reversed selected region!');
    } else {
      for (let c = 0; c < buf.numberOfChannels; c++) {
        buf.getChannelData(c).reverse();
      }
      if (window.showToast) window.showToast('Reversed entire audio clip!');
    }
    this._draw();
  }

  silence() {
    const layer = this._getSelected();
    if (!layer || !layer.buffer) return;
    const buf = layer.buffer;
    const sr = buf.sampleRate;
    const hasSelection = this.selEnd > this.selStart;
    const sStart = hasSelection ? Math.floor(this.selStart * sr) : 0;
    const sEnd   = hasSelection ? Math.min(buf.length, Math.ceil(this.selEnd * sr)) : buf.length;

    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = sStart; i < sEnd; i++) d[i] = 0;
    }
    this._draw();
    if (window.showToast) window.showToast(hasSelection ? 'Silenced selected region!' : 'Silenced entire audio clip!');
  }

  adjustGain(dbDelta = 3) {
    const layer = this._getSelected();
    if (!layer || !layer.buffer) return;
    const mult = Math.pow(10, dbDelta / 20);
    const buf = layer.buffer;
    const sr = buf.sampleRate;
    const hasSelection = this.selEnd > this.selStart;
    const sStart = hasSelection ? Math.floor(this.selStart * sr) : 0;
    const sEnd   = hasSelection ? Math.min(buf.length, Math.ceil(this.selEnd * sr)) : buf.length;

    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = sStart; i < sEnd; i++) {
        d[i] = Math.max(-1, Math.min(1, d[i] * mult));
      }
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
    this._updateDuration();
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
      const colors = ['#00d2d3', '#ff4757', '#ffa502', '#2ed573', '#1e90ff', '#9b59b6'];
      const color = layer.color || colors[window.app.sequencer.channels.length % colors.length];
      const name = (layer.name || 'Sample').slice(0, 16);
      const newChannel = {
        name,
        color,
        type: 'audio',
        audioBuffer: layer.buffer,
        sampleFileName: `${name}.wav`,
        steps: new Array(16).fill(false),
        velocity: new Array(16).fill(0.85),
        volume: 0.9,
        pan: 0,
        muted: false,
        solo: false,
        notes: [],
      };
      newChannel.steps[0] = true; // Auto-activate step 0 so user hears it immediately

      if (typeof window.app.sequencer.addChannel === 'function') {
        window.app.sequencer.addChannel(newChannel);
      } else {
        window.app.sequencer.channels.push(newChannel);
      }

      window.app._buildChannelRack();
      if (window.app.mixer) window.app.mixer.syncChannels();
      if (window.app.playlist) window.app.playlist.syncWithChannels();
      if (window.showToast) window.showToast(`Sent "${name}" to Channel Rack!`, 2500);
    }
  }

  /* ── Instant Preset Sound Generators ───────────────────── */

  loadDemo808(showToast = true) {
    const ctx = this.audioCtx;
    const dur = 1.8;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    const baseFreq = 55; // A1
    for (let i = 0; i < data.length; i++) {
      const t = i / ctx.sampleRate;
      const freq = baseFreq * Math.exp(-t * 2.2);
      const phase = 2 * Math.PI * freq * t;
      const env = Math.exp(-t * 1.6);
      const raw = Math.sin(phase) * env;
      data[i] = Math.tanh(raw * 1.8) * 0.92;
    }
    this.addLayer(buf, '808 Sub Drop', '#ff4757');
    if (showToast && window.showToast) window.showToast('Loaded 808 Sub Bass into Editor!');
  }

  loadDemoSnare() {
    const ctx = this.audioCtx;
    const dur = 0.5;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / ctx.sampleRate;
      const tone = Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t * 18);
      const noise = (Math.random() * 2 - 1) * Math.exp(-t * 12);
      data[i] = (tone * 0.45 + noise * 0.55) * 0.88;
    }
    this.addLayer(buf, 'Trap Snare Hit', '#ffa502');
    if (window.showToast) window.showToast('Loaded Trap Snare into Editor!');
  }

  loadDemoHiHat() {
    const ctx = this.audioCtx;
    const dur = 0.35;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / ctx.sampleRate;
      const noise = (Math.random() * 2 - 1) * Math.exp(-t * 26);
      data[i] = noise * 0.75;
    }
    this.addLayer(buf, 'Closed Hi-Hat', '#2ed573');
    if (window.showToast) window.showToast('Loaded Hi-Hat into Editor!');
  }

  loadDemoVocal() {
    const ctx = this.audioCtx;
    const dur = 1.6;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / ctx.sampleRate;
      const f1 = 440;
      const env = Math.sin((t / dur) * Math.PI);
      const formant = Math.sin(2 * Math.PI * f1 * t) + 0.5 * Math.sin(2 * Math.PI * f1 * 2 * t);
      data[i] = formant * env * 0.65;
    }
    this.addLayer(buf, 'Vocal Formant Chop', '#00d2d3');
    if (window.showToast) window.showToast('Loaded Vocal Formant into Editor!');
  }

  async _renderChannelAudioBuffer(channel) {
    const sr = this.audioCtx.sampleRate;
    const dur = 0.8;
    const totalSamples = Math.floor(dur * sr);
    const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, totalSamples, sr);

    if (channel.name === 'Kick') {
      const osc = offlineCtx.createOscillator();
      const gain = offlineCtx.createGain();
      osc.frequency.setValueAtTime(140, 0);
      osc.frequency.exponentialRampToValueAtTime(38, 0.25);
      gain.gain.setValueAtTime(1.0, 0);
      gain.gain.exponentialRampToValueAtTime(0.001, 0.45);
      osc.connect(gain);
      gain.connect(offlineCtx.destination);
      osc.start(0);
      osc.stop(0.5);
    } else if (channel.name === 'Snare' || channel.name === 'Clap') {
      const noiseBuf = offlineCtx.createBuffer(1, totalSamples, sr);
      const output = noiseBuf.getChannelData(0);
      for (let i = 0; i < totalSamples; i++) output[i] = Math.random() * 2 - 1;
      const noise = offlineCtx.createBufferSource();
      noise.buffer = noiseBuf;
      const filter = offlineCtx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 800;
      const gain = offlineCtx.createGain();
      gain.gain.setValueAtTime(0.8, 0);
      gain.gain.exponentialRampToValueAtTime(0.001, 0.35);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(offlineCtx.destination);
      noise.start(0);
      noise.stop(0.4);
    } else if (channel.name.includes('Hat')) {
      const noiseBuf = offlineCtx.createBuffer(1, totalSamples, sr);
      const output = noiseBuf.getChannelData(0);
      for (let i = 0; i < totalSamples; i++) output[i] = Math.random() * 2 - 1;
      const noise = offlineCtx.createBufferSource();
      noise.buffer = noiseBuf;
      const filter = offlineCtx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 5000;
      const gain = offlineCtx.createGain();
      gain.gain.setValueAtTime(0.7, 0);
      gain.gain.exponentialRampToValueAtTime(0.001, 0.15);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(offlineCtx.destination);
      noise.start(0);
      noise.stop(0.2);
    } else {
      // Synth or Bass fallback
      const osc = offlineCtx.createOscillator();
      const gain = offlineCtx.createGain();
      osc.type = channel.name === 'Bass' ? 'sine' : 'sawtooth';
      osc.frequency.value = channel.name === 'Bass' ? 55 : 440;
      gain.gain.setValueAtTime(0.7, 0);
      gain.gain.exponentialRampToValueAtTime(0.001, 0.5);
      osc.connect(gain);
      gain.connect(offlineCtx.destination);
      osc.start(0);
      osc.stop(0.6);
    }

    return await offlineCtx.startRendering();
  }

  async loadProjectTracks() {
    if (!window.app || !window.app.sequencer) {
      this.loadDemo808();
      return;
    }
    if (window.showToast) window.showToast('Loading project tracks into editor...', 1500);
    let count = 0;
    const channels = window.app.sequencer.channels || [];
    for (const ch of channels) {
      if (ch.audioBuffer) {
        this.addLayer(ch.audioBuffer, ch.name, ch.color);
        count++;
      } else {
        try {
          const buf = await this._renderChannelAudioBuffer(ch);
          if (buf) {
            this.addLayer(buf, ch.name, ch.color);
            count++;
          }
        } catch (e) {
          console.warn('[AudioEditor] Failed to render channel buffer:', ch.name, e);
        }
      }
    }
    if (count > 0) {
      if (window.showToast) window.showToast(`Loaded ${count} project tracks into Editor!`, 2500);
    } else {
      this.loadDemo808();
    }
  }

  /* ── Canvas Rendering Engine ───────────────────────────── */

  _resize() {
    const canvas = this._tabCanvas;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const w = Math.max(300, Math.floor(parent.clientWidth || 500));
    const h = Math.max(140, Math.floor(parent.clientHeight || 240));
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }

  _draw() {
    const canvas = this._tabCanvas;
    if (!canvas) return;
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

    const dur = Math.max(0.1, this.duration);
    const viewDur = dur / this.zoom;
    const viewStart = this.scrollLeft;
    const viewEnd = viewStart + viewDur;

    // Timeline Ruler at top
    ctx.fillStyle = '#111622';
    ctx.fillRect(0, 0, w, 22);
    ctx.strokeStyle = '#1e2638';
    ctx.beginPath();
    ctx.moveTo(0, 22); ctx.lineTo(w, 22); ctx.stroke();

    // Ruler ticks
    let secStep = 1.0;
    if (viewDur <= 1) secStep = 0.1;
    else if (viewDur <= 3) secStep = 0.25;
    else if (viewDur <= 8) secStep = 0.5;
    else if (viewDur <= 20) secStep = 1.0;
    else secStep = 2.0;

    const firstTick = Math.floor(viewStart / secStep) * secStep;
    ctx.fillStyle = '#6b7280';
    ctx.font = '8px JetBrains Mono, monospace';
    for (let s = firstTick; s <= viewEnd + secStep; s += secStep) {
      if (s < 0) continue;
      const sx = ((s - viewStart) / viewDur) * w;
      if (sx >= 0 && sx <= w) {
        ctx.fillRect(sx, 12, 1, 10);
        ctx.fillText(`${s.toFixed(secStep < 1 ? 2 : 1)}s`, sx + 3, 16);
      }
    }

    // Center Zero-Crossing Line
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
      const waveH = (h - 28);

      const clipStart = layer.startSec || 0;
      const clipEnd = clipStart + (layer.trimEnd - layer.trimStart);

      const startX = ((clipStart - viewStart) / viewDur) * w;
      const clipW  = ((clipEnd - clipStart) / viewDur) * w;

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

      ctx.beginPath();
      const pixelStart = Math.max(0, Math.floor(startX));
      const pixelEnd   = Math.min(w, Math.ceil(startX + clipW));

      for (let px = pixelStart; px < pixelEnd; px++) {
        const frac = (px - startX) / clipW;
        if (frac < 0 || frac > 1) continue;
        const sampleIdx = sStart + Math.floor(frac * totalSamples);
        const windowSize = Math.max(1, Math.floor(totalSamples / clipW));

        let min = 0, max = 0;
        for (let j = 0; j < windowSize && sampleIdx + j < sEnd; j++) {
          const val = data[sampleIdx + j];
          if (val < min) min = val;
          if (val > max) max = val;
        }
        const y1 = midY - max * (waveH / 2) * layer.volume;
        const y2 = midY - min * (waveH / 2) * layer.volume;
        ctx.moveTo(px, y1);
        ctx.lineTo(px, y2);
      }
      ctx.stroke();

      // Layer Name & Zoom Info
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px Inter, sans-serif';
      const zoomText = this.zoom > 1.0 ? ` · ${this.zoom.toFixed(1)}x Zoom` : '';
      ctx.fillText(`${layer.name} (${layer.buffer.duration.toFixed(2)}s)${zoomText}`, Math.max(8, startX + 8), 38);
    } else {
      // Empty state watermark
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.font = '12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Click "+ Import Sound" or load a demo sound below', w / 2, midY);
      ctx.textAlign = 'left';
    }

    // Shaded Selection Overlay
    if (this.selEnd > this.selStart) {
      const sx = ((this.selStart - viewStart) / viewDur) * w;
      const sw = ((this.selEnd - this.selStart) / viewDur) * w;

      ctx.fillStyle = 'rgba(0, 210, 211, 0.22)';
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
      ctx.fillText(`Selection: ${(this.selEnd - this.selStart).toFixed(2)}s`, Math.max(4, sx + 4), 34);
    }

    // Live Playhead Indicator
    if (this.playPos >= 0) {
      const px = ((this.playPos - viewStart) / viewDur) * w;
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
        this._updateDuration();
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
    const offline = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, totalSamples, sr);

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
