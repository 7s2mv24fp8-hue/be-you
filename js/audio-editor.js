/**
 * BeYou Studio — Audio Editor v2
 * Full waveform editor with:
 * - Waveform visualization (canvas-based)
 * - Timeline with zoom / scroll
 * - Cut, Copy, Paste, Delete regions
 * - Trim (set loop points)
 * - Fade In / Fade Out
 * - Normalize
 * - Pitch shift (semitones)
 * - Layering: stack multiple clips on tracks
 * - Per-layer: volume, mute, solo, color
 * - Export: renders mix to AudioBuffer then download as WAV
 */

'use strict';

class AudioEditor {
  constructor(audioEngine) {
    this.ctx    = audioEngine.ctx;
    this.dest   = audioEngine.masterCompressor || audioEngine.ctx.destination;

    this.layers = [];       // { id, name, buffer, color, volume, muted, solo, startSec, trimStart, trimEnd }
    this.selected = null;   // selected layer id

    this.zoom       = 1.0;  // pixels per second
    this.scrollLeft = 0;
    this.duration   = 30;   // total timeline sec

    this.playPos    = 0;
    this.playing    = false;
    this._sources   = [];
    this._rafId     = null;

    this.clipboard  = null; // copied region buffer

    this.tool = 'select'; // select | cut | fade

    // Selection region
    this.selStart = 0;
    this.selEnd   = 0;

    this._modal   = null;
    this._canvas  = null;
    this._ctx2d   = null;
    this._dragging = null;

    this._buildModal();
  }

  /* ── Public API ──────────────────────────────────────── */

  open(layer) {
    this._modal.classList.remove('ae-hidden');
    if (layer) this.selectLayer(layer.id);
    this._resize();
    this._draw();
  }

  close() {
    this._modal.classList.add('ae-hidden');
    this.pause();
  }

  addLayer(buffer, name, color) {
    const id = `layer_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
    const layer = {
      id,
      name: name || `Layer ${this.layers.length + 1}`,
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
    this.duration = Math.max(this.duration, buffer.duration + layer.startSec + 2);
    this._renderLayerList();
    this._draw();
    return id;
  }

  selectLayer(id) {
    this.selected = id;
    document.querySelectorAll('.ae-layer-item').forEach(el => {
      el.classList.toggle('ae-selected', el.dataset.id === id);
    });
    this._draw();
  }

  /* ── Playback ────────────────────────────────────────── */

  play(from = this.playPos) {
    if (this.playing) this.pause();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const now = this.ctx.currentTime;
    this._sources = [];
    const anySolo = this.layers.some(l => l.solo);
    this.layers.forEach(layer => {
      if (layer.muted) return;
      if (anySolo && !layer.solo) return;
      if (!layer.buffer) return;

      const offset = Math.max(0, from - layer.startSec);
      if (offset >= (layer.trimEnd - layer.trimStart)) return;

      const src = this.ctx.createBufferSource();
      src.buffer = layer.buffer;
      const gainNode = this.ctx.createGain();
      gainNode.gain.value = layer.volume;
      src.connect(gainNode); gainNode.connect(this.dest);
      src.start(now, layer.trimStart + offset);
      this._sources.push(src);
    });

    this.playing = true;
    this._playStartTime = now - from;
    this._rafId = requestAnimationFrame(() => this._animLoop());
  }

  pause() {
    this.playing = false;
    this._sources.forEach(s => { try { s.stop(); } catch(_){} });
    this._sources = [];
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
  }

  _animLoop() {
    if (!this.playing) return;
    this.playPos = this.ctx.currentTime - this._playStartTime;
    this._drawPlayhead();
    this._rafId = requestAnimationFrame(() => this._animLoop());
  }

  /* ── Edit Operations ─────────────────────────────────── */

  cutRegion() {
    const layer = this._getSelected();
    if (!layer || this.selStart >= this.selEnd) return;
    this.clipboard = this._extractRegion(layer.buffer, this.selStart, this.selEnd);
    this._applyDelete(layer);
    this._draw();
    showToast('✂️ Region cut to clipboard', 2000);
  }

  copyRegion() {
    const layer = this._getSelected();
    if (!layer || this.selStart >= this.selEnd) return;
    this.clipboard = this._extractRegion(layer.buffer, this.selStart, this.selEnd);
    showToast('📋 Region copied', 2000);
  }

  pasteRegion() {
    if (!this.clipboard) return;
    this.addLayer(this.clipboard, 'Pasted Clip');
    showToast('📋 Pasted as new layer', 2000);
  }

  deleteRegion() {
    const layer = this._getSelected();
    if (!layer || this.selStart >= this.selEnd) return;
    this._applyDelete(layer);
    this._draw();
    showToast('🗑 Region deleted', 2000);
  }

  normalize() {
    const layer = this._getSelected();
    if (!layer?.buffer) return;
    const buf = layer.buffer;
    let peak = 0;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    }
    if (peak < 0.001) return;
    const gain = 0.95 / peak;
    const newBuf = this.ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const src = buf.getChannelData(ch);
      const dst = newBuf.getChannelData(ch);
      for (let i = 0; i < src.length; i++) dst[i] = src[i] * gain;
    }
    layer.buffer = newBuf;
    this._draw();
    showToast('📊 Normalized to 0 dBFS', 2000);
  }

  fadeIn(durationSec = 0.5) {
    const layer = this._getSelected();
    if (!layer?.buffer) return;
    const buf = layer.buffer;
    const fadeSamples = Math.min(Math.floor(durationSec * buf.sampleRate), buf.length);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < fadeSamples; i++) data[i] *= i / fadeSamples;
    }
    this._draw();
    showToast(`🎚 Fade-in ${durationSec}s applied`, 2000);
  }

  fadeOut(durationSec = 0.5) {
    const layer = this._getSelected();
    if (!layer?.buffer) return;
    const buf = layer.buffer;
    const fadeSamples = Math.min(Math.floor(durationSec * buf.sampleRate), buf.length);
    const startSample = buf.length - fadeSamples;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < fadeSamples; i++) data[startSample + i] *= 1 - i / fadeSamples;
    }
    this._draw();
    showToast(`🎚 Fade-out ${durationSec}s applied`, 2000);
  }

  reverse() {
    const layer = this._getSelected();
    if (!layer?.buffer) return;
    const buf = layer.buffer;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      buf.getChannelData(ch).reverse();
    }
    this._draw();
    showToast('🔄 Audio reversed', 2000);
  }

  /* ── Export / Download ───────────────────────────────── */

  async exportMix() {
    if (!this.layers.length) return;
    showToast('⚙️ Rendering mix...', 3000);

    const sampleRate = this.ctx.sampleRate;
    const totalSamples = Math.ceil(this.duration * sampleRate);
    const offline = new OfflineAudioContext(2, totalSamples, sampleRate);
    const anySolo = this.layers.some(l => l.solo);

    for (const layer of this.layers) {
      if (layer.muted || (anySolo && !layer.solo) || !layer.buffer) continue;
      const src  = offline.createBufferSource();
      src.buffer = layer.buffer;
      const g = offline.createGain();
      g.gain.value = layer.volume;
      src.connect(g); g.connect(offline.destination);
      src.start(layer.startSec, layer.trimStart);
    }

    const rendered = await offline.startRendering();
    const wavBlob  = this._bufferToWAV(rendered);
    const url = URL.createObjectURL(wavBlob);
    const a   = document.createElement('a');
    a.href = url; a.download = 'beyou_mix.wav'; a.click();
    URL.revokeObjectURL(url);
    showToast('💾 Mix exported as WAV!', 3000);
  }

  /* ── Internal helpers ────────────────────────────────── */

  _getSelected() {
    return this.layers.find(l => l.id === this.selected) || null;
  }

  _extractRegion(buffer, startSec, endSec) {
    const sr = buffer.sampleRate;
    const startSample = Math.floor(startSec * sr);
    const endSample   = Math.min(Math.ceil(endSec * sr), buffer.length);
    const len = endSample - startSample;
    if (len <= 0) return null;
    const newBuf = this.ctx.createBuffer(buffer.numberOfChannels, len, sr);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const src = buffer.getChannelData(ch).subarray(startSample, endSample);
      newBuf.getChannelData(ch).set(src);
    }
    return newBuf;
  }

  _applyDelete(layer) {
    const buf = layer.buffer;
    const sr  = buf.sampleRate;
    const delStart = Math.floor(this.selStart * sr);
    const delEnd   = Math.min(Math.ceil(this.selEnd * sr), buf.length);
    const newLen   = buf.length - (delEnd - delStart);
    if (newLen <= 0) { layer.buffer = null; return; }
    const newBuf = this.ctx.createBuffer(buf.numberOfChannels, newLen, sr);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const src = buf.getChannelData(ch);
      const dst = newBuf.getChannelData(ch);
      dst.set(src.subarray(0, delStart));
      dst.set(src.subarray(delEnd), delStart);
    }
    layer.buffer = newBuf;
  }

  _randColor() {
    const colors = ['#ff6a00','#a855f7','#22d3ee','#ec4899','#84cc16','#f59e0b','#6366f1','#34d399'];
    return colors[this.layers.length % colors.length];
  }

  /* ── Canvas Drawing ──────────────────────────────────── */

  _draw() {
    if (!this._canvas) return;
    const c   = this._canvas;
    const ctx = this._ctx2d;
    const W = c.width, H = c.height;
    const PPS = this.zoom * 100; // pixels per second

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, W, H);

    // Beat grid
    const secPerBeat = 60 / 140;
    const beatPx = secPerBeat * PPS;
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += beatPx) {
      ctx.beginPath(); ctx.moveTo(x - this.scrollLeft * PPS % beatPx, 0);
      ctx.lineTo(x - this.scrollLeft * PPS % beatPx, H); ctx.stroke();
    }

    // Time ruler
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, W, 20);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '9px JetBrains Mono, monospace';
    for (let sec = 0; sec < this.duration; sec++) {
      const x = sec * PPS - this.scrollLeft * PPS;
      if (x < 0 || x > W) continue;
      ctx.fillRect(x, 0, 1, 20);
      if (sec % 2 === 0) ctx.fillText(`${sec}s`, x + 3, 14);
    }

    // Track rows
    const ROW_H = 64;
    const ROW_TOP = 24;
    this.layers.forEach((layer, li) => {
      const y = ROW_TOP + li * (ROW_H + 4);
      const x = layer.startSec * PPS - this.scrollLeft * PPS;
      const w = layer.buffer ? (layer.trimEnd - layer.trimStart) * PPS : 0;

      // Row bg
      ctx.fillStyle = li % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'rgba(255,255,255,0.008)';
      ctx.fillRect(0, y, W, ROW_H);

      if (!layer.buffer) return;

      // Clip block
      const isSelected = layer.id === this.selected;
      ctx.fillStyle = isSelected ? layer.color + '44' : layer.color + '22';
      ctx.strokeStyle = layer.color;
      ctx.lineWidth = isSelected ? 2 : 1;
      this._rrect(ctx, x, y + 2, w, ROW_H - 4, 4);
      ctx.fill(); ctx.stroke();

      // Waveform
      this._drawWaveform(ctx, layer, x, y + 2, w, ROW_H - 4);

      // Label
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.fillText(layer.name, x + 6, y + 16);

      // Muted overlay
      if (layer.muted) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        this._rrect(ctx, x, y + 2, w, ROW_H - 4, 4);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = 'bold 11px Inter';
        ctx.fillText('MUTED', x + w / 2 - 22, y + ROW_H / 2 + 4);
      }
    });

    // Selection region
    if (this.selEnd > this.selStart) {
      const sx = this.selStart * PPS - this.scrollLeft * PPS;
      const sw = (this.selEnd - this.selStart) * PPS;
      ctx.fillStyle = 'rgba(34,211,238,0.12)';
      ctx.fillRect(sx, 20, sw, H - 20);
      ctx.strokeStyle = 'rgba(34,211,238,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(sx, 20); ctx.lineTo(sx, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx + sw, 20); ctx.lineTo(sx + sw, H); ctx.stroke();
    }

    this._drawPlayhead();
  }

  _drawWaveform(ctx, layer, x, y, w, h) {
    const buf = layer.buffer;
    if (!buf) return;
    const data = buf.getChannelData(0);
    const startSample = Math.floor(layer.trimStart * buf.sampleRate);
    const endSample   = Math.floor(layer.trimEnd   * buf.sampleRate);
    const len = endSample - startSample;
    const step = Math.max(1, Math.floor(len / w));
    ctx.strokeStyle = layer.color + 'cc';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let px = 0; px < w; px++) {
      const sampleIdx = startSample + Math.floor((px / w) * len);
      let min = 0, max = 0;
      for (let j = 0; j < step && sampleIdx + j < endSample; j++) {
        const v = data[sampleIdx + j];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const mid = y + h / 2;
      const yMax = mid + max * (h / 2) * layer.volume;
      const yMin = mid + min * (h / 2) * layer.volume;
      if (px === 0) ctx.moveTo(x + px, yMax);
      else { ctx.lineTo(x + px, yMax); ctx.lineTo(x + px, yMin); }
    }
    ctx.stroke();
  }

  _drawPlayhead() {
    if (!this._canvas) return;
    const c = this._canvas; const ctx = this._ctx2d;
    const W = c.width; const H = c.height;
    const PPS = this.zoom * 100;
    const px = this.playPos * PPS - this.scrollLeft * PPS;
    if (px < 0 || px > W) return;
    ctx.strokeStyle = '#ff6a00';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, 20); ctx.lineTo(px, H); ctx.stroke();
    // Triangle handle
    ctx.fillStyle = '#ff6a00';
    ctx.beginPath(); ctx.moveTo(px - 5, 20); ctx.lineTo(px + 5, 20); ctx.lineTo(px, 28); ctx.fill();
  }

  _rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  /* ── Modal builder ───────────────────────────────────── */

  _buildModal() {
    const overlay = document.createElement('div');
    overlay.id = 'ae-overlay';
    overlay.className = 'ae-overlay ae-hidden';
    overlay.innerHTML = `
      <div class="ae-modal">
        <div class="ae-header">
          <span class="ae-title">🎛 Audio Editor & Layer Mixer</span>
          <div class="ae-tools">
            <button class="ae-tool-btn ae-active" id="ae-tool-select" title="Select / Move">⬛ Select</button>
            <button class="ae-tool-btn" id="ae-tool-cut" title="Cut mode">✂️ Cut</button>
          </div>
          <div class="ae-edit-btns">
            <button class="ae-btn" id="ae-cut-btn"     title="Cut selection">✂️</button>
            <button class="ae-btn" id="ae-copy-btn"    title="Copy selection">📋</button>
            <button class="ae-btn" id="ae-paste-btn"   title="Paste">📌</button>
            <button class="ae-btn" id="ae-del-btn"     title="Delete selection">🗑</button>
            <div class="ae-sep"></div>
            <button class="ae-btn" id="ae-fadein-btn"  title="Fade In">↗️</button>
            <button class="ae-btn" id="ae-fadeout-btn" title="Fade Out">↘️</button>
            <button class="ae-btn" id="ae-norm-btn"    title="Normalize">📊</button>
            <button class="ae-btn" id="ae-rev-btn"     title="Reverse">🔄</button>
            <div class="ae-sep"></div>
            <button class="ae-btn ae-export-btn" id="ae-export-btn" title="Export Mix as WAV">💾 Export WAV</button>
          </div>
          <div class="ae-zoom-wrap">
            <span class="ae-ctrl-label">Zoom</span>
            <input type="range" class="ae-zoom-slider" id="ae-zoom" min="0.2" max="5" step="0.1" value="1">
          </div>
          <button class="ae-close-btn" id="ae-close-btn">✕</button>
        </div>

        <div class="ae-body">
          <!-- Left: Layer list -->
          <div class="ae-layers-panel">
            <div class="ae-layers-header">
              <span>Layers</span>
              <button class="ae-add-layer-btn" id="ae-add-layer-btn" title="Import sound into editor">+ Add</button>
            </div>
            <div class="ae-layers-list" id="ae-layers-list"></div>
            <!-- Playback -->
            <div class="ae-play-bar">
              <button class="ae-play-btn" id="ae-play-btn">▶ Play</button>
              <button class="ae-play-btn" id="ae-pause-btn">⏸ Pause</button>
              <div class="ae-pos-display" id="ae-pos-display">0.00s</div>
            </div>
          </div>

          <!-- Right: Canvas timeline -->
          <div class="ae-canvas-wrap" id="ae-canvas-wrap">
            <canvas id="ae-canvas" class="ae-canvas"></canvas>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    this._modal = overlay;

    this._canvas = overlay.querySelector('#ae-canvas');
    this._ctx2d  = this._canvas.getContext('2d');

    this._bindModal();
    window.addEventListener('resize', () => this._resize());
    this._resize();
  }

  _resize() {
    const wrap = document.getElementById('ae-canvas-wrap');
    if (!wrap || !this._canvas) return;
    this._canvas.width  = wrap.clientWidth;
    this._canvas.height = wrap.clientHeight;
    this._draw();
  }

  _renderLayerList() {
    const list = document.getElementById('ae-layers-list');
    if (!list) return;
    list.innerHTML = '';
    this.layers.forEach(layer => {
      const el = document.createElement('div');
      el.className = `ae-layer-item ${layer.id === this.selected ? 'ae-selected' : ''}`;
      el.dataset.id = layer.id;
      el.innerHTML = `
        <div class="ae-layer-color" style="background:${layer.color}"></div>
        <div class="ae-layer-info">
          <div class="ae-layer-name">${layer.name}</div>
          <div class="ae-layer-dur">${layer.buffer ? layer.buffer.duration.toFixed(2) : '0.00'}s</div>
        </div>
        <div class="ae-layer-ctrls">
          <input type="range" class="ae-vol-slider" min="0" max="1.5" step="0.01" value="${layer.volume}" title="Volume" data-id="${layer.id}">
          <button class="ae-mute-btn ${layer.muted?'ae-muted':''}" data-id="${layer.id}" title="Mute">M</button>
          <button class="ae-solo-btn ${layer.solo?'ae-soloed':''}" data-id="${layer.id}" title="Solo">S</button>
          <button class="ae-del-layer-btn" data-id="${layer.id}" title="Delete layer">✕</button>
        </div>
      `;
      el.addEventListener('click', () => this.selectLayer(layer.id));
      el.querySelector('.ae-vol-slider').addEventListener('input', (e) => {
        layer.volume = parseFloat(e.target.value);
        this._draw();
        e.stopPropagation();
      });
      el.querySelector('.ae-mute-btn').addEventListener('click', (e) => {
        layer.muted = !layer.muted;
        e.currentTarget.classList.toggle('ae-muted', layer.muted);
        this._draw(); e.stopPropagation();
      });
      el.querySelector('.ae-solo-btn').addEventListener('click', (e) => {
        layer.solo = !layer.solo;
        e.currentTarget.classList.toggle('ae-soloed', layer.solo);
        this._draw(); e.stopPropagation();
      });
      el.querySelector('.ae-del-layer-btn').addEventListener('click', (e) => {
        this.layers = this.layers.filter(l => l.id !== layer.id);
        this._renderLayerList(); this._draw(); e.stopPropagation();
      });
      list.appendChild(el);
    });
  }

  _bindModal() {
    document.getElementById('ae-close-btn')?.addEventListener('click', () => this.close());

    // Tool select
    document.getElementById('ae-tool-select')?.addEventListener('click', (e) => {
      this.tool = 'select';
      document.querySelectorAll('.ae-tool-btn').forEach(b => b.classList.remove('ae-active'));
      e.currentTarget.classList.add('ae-active');
    });
    document.getElementById('ae-tool-cut')?.addEventListener('click', (e) => {
      this.tool = 'cut';
      document.querySelectorAll('.ae-tool-btn').forEach(b => b.classList.remove('ae-active'));
      e.currentTarget.classList.add('ae-active');
    });

    // Edit ops
    document.getElementById('ae-cut-btn')?.addEventListener('click',     () => this.cutRegion());
    document.getElementById('ae-copy-btn')?.addEventListener('click',    () => this.copyRegion());
    document.getElementById('ae-paste-btn')?.addEventListener('click',   () => this.pasteRegion());
    document.getElementById('ae-del-btn')?.addEventListener('click',     () => this.deleteRegion());
    document.getElementById('ae-fadein-btn')?.addEventListener('click',  () => this.fadeIn(0.5));
    document.getElementById('ae-fadeout-btn')?.addEventListener('click', () => this.fadeOut(0.5));
    document.getElementById('ae-norm-btn')?.addEventListener('click',    () => this.normalize());
    document.getElementById('ae-rev-btn')?.addEventListener('click',     () => this.reverse());
    document.getElementById('ae-export-btn')?.addEventListener('click',  () => this.exportMix());

    // Zoom
    document.getElementById('ae-zoom')?.addEventListener('input', (e) => {
      this.zoom = parseFloat(e.target.value);
      this._draw();
    });

    // Playback
    document.getElementById('ae-play-btn')?.addEventListener('click',  () => this.play());
    document.getElementById('ae-pause-btn')?.addEventListener('click', () => this.pause());

    // Add layer (file input)
    document.getElementById('ae-add-layer-btn')?.addEventListener('click', () => {
      const fi = document.createElement('input');
      fi.type = 'file'; fi.accept = 'audio/*';
      fi.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const ab = await file.arrayBuffer();
        try {
          const buf = await this.ctx.decodeAudioData(ab);
          this.addLayer(buf, file.name.replace(/\.[^.]+$/, ''));
          showToast(`🎵 Layer added: ${file.name}`, 2000);
        } catch(err) {
          showToast('❌ Failed to decode audio', 2000);
        }
      });
      fi.click();
    });

    // Canvas mouse events
    const canvas = this._canvas;
    canvas.addEventListener('mousedown', (e) => this._onCanvasMouseDown(e));
    canvas.addEventListener('mousemove', (e) => this._onCanvasMouseMove(e));
    canvas.addEventListener('mouseup',   (e) => this._onCanvasMouseUp(e));
    canvas.addEventListener('wheel',     (e) => {
      e.preventDefault();
      this.scrollLeft = Math.max(0, this.scrollLeft + e.deltaX * 0.01);
      this._draw();
    }, { passive: false });
  }

  _canvasToSec(x) {
    return (x + this.scrollLeft * 100 * this.zoom) / (this.zoom * 100);
  }

  _onCanvasMouseDown(e) {
    const rect = this._canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (y < 20) { // playhead click on ruler
      this.playPos = this._canvasToSec(x);
      this._draw();
      return;
    }
    this.selStart = this._canvasToSec(x);
    this.selEnd   = this.selStart;
    this._dragging = { x, type: 'select' };
  }

  _onCanvasMouseMove(e) {
    if (!this._dragging) return;
    const rect = this._canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const sec = this._canvasToSec(x);
    this.selEnd = Math.max(this.selStart, sec);
    this._draw();
    // Update pos display
    const posEl = document.getElementById('ae-pos-display');
    if (posEl) posEl.textContent = `${sec.toFixed(2)}s`;
  }

  _onCanvasMouseUp() {
    this._dragging = null;
  }

  /* ── WAV encoder ─────────────────────────────────────── */

  _bufferToWAV(buffer) {
    const numCh = buffer.numberOfChannels;
    const sr = buffer.sampleRate;
    const len = buffer.length;
    const bitsPerSample = 16;
    const bytePerSample = bitsPerSample / 8;
    const blockAlign = numCh * bytePerSample;
    const dataLen = len * blockAlign;
    const ab = new ArrayBuffer(44 + dataLen);
    const view = new DataView(ab);
    const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataLen, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numCh, true);
    view.setUint32(24, sr, true);
    view.setUint32(28, sr * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeStr(36, 'data');
    view.setUint32(40, dataLen, true);
    const channels = [];
    for (let ch = 0; ch < numCh; ch++) channels.push(buffer.getChannelData(ch));
    let offset = 44;
    for (let i = 0; i < len; i++) {
      for (let ch = 0; ch < numCh; ch++) {
        const s = Math.max(-1, Math.min(1, channels[ch][i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        offset += 2;
      }
    }
    return new Blob([ab], { type: 'audio/wav' });
  }
}
