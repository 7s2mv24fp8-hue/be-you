/**
 * BeYou Studio — Fruity Parametric EQ 2
 * =====================================
 * Professional 7-band interactive parametric equalizer plugin modeled after FL Studio.
 * - Interactive multi-touch & mouse frequency curve canvas with logarithmic grid (20Hz–20kHz).
 * - Real-time FFT audio spectrum analyzer background reflecting live DAW audio output.
 * - Real Web Audio BiquadFilterNode DSP processing connected to master bus.
 * - Per-band parameter controls (Type, Freq, Gain, Q, Bypass) + mouse wheel Q control.
 * - 7 Pro mastering presets (Default Flat, Vocal Air, Bass Boost, Warm Master, Telephone, etc.).
 * - Dockable in Mixer rack AND openable as floating FL Studio plugin window.
 */

class FLParametricEQ {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.container = null;
    this.floatingModal = null;
    this.activePointIdx = -1;
    this.hoverPointIdx = -1;
    this.isBypassed = false;
    this.spectrumData = null;
    this._rafId = null;

    // 7 Bands matching Fruity Parametric EQ 2
    this.bands = [
      { id: 1, type: 'highpass', freq: 35,    gain: 0, q: 0.707, color: '#ff4757', enabled: true },
      { id: 2, type: 'lowshelf', freq: 110,   gain: 0, q: 0.707, color: '#ffa502', enabled: true },
      { id: 3, type: 'peaking',  freq: 350,   gain: 0, q: 1.0,   color: '#eccc68', enabled: true },
      { id: 4, type: 'peaking',  freq: 1000,  gain: 0, q: 1.0,   color: '#2ed573', enabled: true },
      { id: 5, type: 'peaking',  freq: 3200,  gain: 0, q: 1.0,   color: '#1e90ff', enabled: true },
      { id: 6, type: 'highshelf',freq: 8500,  gain: 0, q: 0.707, color: '#9b59b6', enabled: true },
      { id: 7, type: 'lowpass',  freq: 18500, gain: 0, q: 0.707, color: '#ff6b81', enabled: true },
    ];

    this._initUI();
    this._syncAllFiltersToAudioEngine();
    this._startSpectrumLoop();
  }

  _initUI() {
    // 1. Inject or update docked panel in Mixer tab view
    const mixerView = document.getElementById('mixer-view');
    let eqWrap = document.getElementById('fl-param-eq-wrap');
    if (!eqWrap && mixerView) {
      eqWrap = document.createElement('div');
      eqWrap.id = 'fl-param-eq-wrap';
      eqWrap.className = 'fl-eq-wrap';
      mixerView.appendChild(eqWrap);
    }

    if (eqWrap) {
      this.container = eqWrap;
      eqWrap.innerHTML = `
        <div class="fl-eq-header">
          <div class="fl-eq-title-wrap">
            <span class="fl-eq-led"></span>
            <span class="fl-eq-title">Fruity Parametric EQ 2</span>
          </div>
          <div class="fl-eq-header-actions">
            <select id="fl-eq-preset-select" class="fl-eq-preset-select" title="EQ Presets">
              <option value="flat">Preset: Flat (Reset)</option>
              <option value="vocal">Preset: Vocal Air &amp; Clarity</option>
              <option value="bass">Preset: 808 &amp; Bass Boost</option>
              <option value="warm">Preset: Warm Master Polish</option>
              <option value="demud">Preset: De-Mud Mid Cut</option>
              <option value="radio">Preset: Telephone / Lo-Fi</option>
              <option value="punch">Preset: Drum Punch</option>
            </select>
            <button id="fl-eq-popout-btn" class="fl-eq-head-btn" title="Open Floating Window">⛶ Pop Out</button>
            <button id="fl-eq-bypass-btn" class="fl-eq-head-btn" title="Toggle EQ Bypass">ON</button>
          </div>
        </div>

        <div class="fl-eq-body">
          <canvas id="fl-eq-canvas"></canvas>
          <div id="fl-eq-tooltip" class="fl-eq-tooltip"></div>
        </div>

        <!-- 7 Band Parameter Sliders / Knobs Bar -->
        <div class="fl-eq-bands-rack" id="fl-eq-bands-rack">
          <!-- Rendered dynamically -->
        </div>
      `;

      this.canvas = document.getElementById('fl-eq-canvas');
      if (this.canvas) this.ctx = this.canvas.getContext('2d');
      this._renderBandControls();
      this._attachEvents();
    }

    // 2. Setup Floating Window Modal (for popping out)
    this._buildFloatingModal();
  }

  _buildFloatingModal() {
    let modal = document.getElementById('fl-eq-floating-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'fl-eq-floating-modal';
      modal.className = 'fl-eq-modal-overlay hidden';
      modal.innerHTML = `
        <div class="fl-eq-floating-window">
          <div class="fl-eq-win-header">
            <div class="fl-eq-win-title">
              <span class="fl-eq-led"></span>
              <span>FRUITY PARAMETRIC EQ 2 — MASTER INSERT</span>
            </div>
            <button id="fl-eq-win-close" class="fl-eq-win-close">✕</button>
          </div>
          <div class="fl-eq-win-body" id="fl-eq-modal-body-mount">
            <!-- Canvas clones / moves here when popped out -->
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelector('#fl-eq-win-close').addEventListener('click', () => {
        this.closeFloating();
      });
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeFloating();
      });
    }
    this.floatingModal = modal;
  }

  toggleFloating() {
    if (!this.floatingModal) return;
    if (this.floatingModal.classList.contains('hidden')) {
      this.openFloating();
    } else {
      this.closeFloating();
    }
  }

  openFloating() {
    if (!this.floatingModal) return;
    this.floatingModal.classList.remove('hidden');
    const mount = document.getElementById('fl-eq-modal-body-mount');
    if (mount && this.container && !mount.contains(this.container)) {
      mount.appendChild(this.container);
      this._resizeCanvas();
      this.render();
    }
  }

  closeFloating() {
    if (!this.floatingModal) return;
    this.floatingModal.classList.add('hidden');
    const mixerView = document.getElementById('mixer-view');
    if (mixerView && this.container && !mixerView.contains(this.container)) {
      mixerView.appendChild(this.container);
      this._resizeCanvas();
      this.render();
    }
  }

  _renderBandControls() {
    const rack = document.getElementById('fl-eq-bands-rack');
    if (!rack) return;
    rack.innerHTML = '';

    this.bands.forEach((b, i) => {
      const col = document.createElement('div');
      col.className = `fl-eq-band-col ${b.enabled ? '' : 'bypassed'}`;
      col.dataset.bandIdx = i;

      const freqStr = b.freq >= 1000 ? `${(b.freq / 1000).toFixed(1)}k` : `${Math.round(b.freq)}`;
      const gainStr = b.gain > 0 ? `+${b.gain.toFixed(1)}` : `${b.gain.toFixed(1)}`;

      col.innerHTML = `
        <div class="fl-eq-band-num" style="color:${b.color}">
          <button class="fl-eq-band-solo" data-idx="${i}" title="Toggle band">${i + 1}</button>
          <span class="fl-eq-band-type">${b.type.slice(0, 4).toUpperCase()}</span>
        </div>
        <div class="fl-eq-band-val" id="fl-eq-fval-${i}">${freqStr}Hz</div>
        <input type="range" class="fl-eq-slider fl-eq-freq-slider" min="20" max="20000" value="${b.freq}" data-idx="${i}" title="Frequency">
        <div class="fl-eq-band-val" id="fl-eq-gval-${i}">${b.type === 'highpass' || b.type === 'lowpass' ? 'CUT' : gainStr + 'dB'}</div>
        <input type="range" class="fl-eq-slider fl-eq-gain-slider" min="-18" max="18" step="0.5" value="${b.gain}" data-idx="${i}" ${b.type === 'highpass' || b.type === 'lowpass' ? 'disabled' : ''} title="Gain (dB)">
      `;

      // Sliders listeners
      const freqSlider = col.querySelector('.fl-eq-freq-slider');
      const gainSlider = col.querySelector('.fl-eq-gain-slider');
      const bandSoloBtn = col.querySelector('.fl-eq-band-solo');

      freqSlider.addEventListener('input', (e) => {
        b.freq = parseFloat(e.target.value);
        this._syncBandFilter(i);
        this._updateBandColDisplays(i);
        this.render();
      });

      gainSlider.addEventListener('input', (e) => {
        b.gain = parseFloat(e.target.value);
        this._syncBandFilter(i);
        this._updateBandColDisplays(i);
        this.render();
      });

      bandSoloBtn.addEventListener('click', () => {
        b.enabled = !b.enabled;
        col.classList.toggle('bypassed', !b.enabled);
        this._syncBandFilter(i);
        this.render();
      });

      rack.appendChild(col);
    });
  }

  _updateBandColDisplays(idx) {
    const b = this.bands[idx];
    const fval = document.getElementById(`fl-eq-fval-${idx}`);
    const gval = document.getElementById(`fl-eq-gval-${idx}`);
    if (fval) fval.textContent = b.freq >= 1000 ? `${(b.freq / 1000).toFixed(1)}kHz` : `${Math.round(b.freq)}Hz`;
    if (gval) gval.textContent = (b.type === 'highpass' || b.type === 'lowpass') ? 'CUT' : `${b.gain > 0 ? '+' : ''}${b.gain.toFixed(1)}dB`;
  }

  _attachEvents() {
    if (!this.canvas) return;

    const popoutBtn = document.getElementById('fl-eq-popout-btn');
    if (popoutBtn) {
      popoutBtn.addEventListener('click', () => {
        if (this.floatingModal && !this.floatingModal.classList.contains('hidden')) {
          this.closeFloating();
        } else {
          this.openFloating();
        }
      });
    }

    const bypassBtn = document.getElementById('fl-eq-bypass-btn');
    if (bypassBtn) {
      bypassBtn.addEventListener('click', () => {
        this.isBypassed = !this.isBypassed;
        bypassBtn.textContent = this.isBypassed ? 'BYPASS' : 'ON';
        bypassBtn.classList.toggle('bypassed', this.isBypassed);
        this._syncAllFiltersToAudioEngine();
        this.render();
      });
    }

    const presetSelect = document.getElementById('fl-eq-preset-select');
    if (presetSelect) {
      presetSelect.addEventListener('change', (e) => {
        this.loadPreset(e.target.value);
      });
    }

    // Canvas Mouse & Touch Dragging
    const onDown = (e) => {
      const pt = this._getCanvasPos(e);
      this.activePointIdx = this._findNearestPoint(pt.x, pt.y);
      if (this.activePointIdx >= 0) {
        this._showTooltip(this.activePointIdx, pt.x, pt.y);
      }
    };

    const onMove = (e) => {
      const pt = this._getCanvasPos(e);
      if (this.activePointIdx >= 0 && this.canvas) {
        this._updateBandFromPos(this.activePointIdx, pt.x, pt.y);
        this._showTooltip(this.activePointIdx, pt.x, pt.y);
        this.render();
      } else {
        const nearest = this._findNearestPoint(pt.x, pt.y);
        if (nearest !== this.hoverPointIdx) {
          this.hoverPointIdx = nearest;
          this.canvas.style.cursor = nearest >= 0 ? 'grab' : 'crosshair';
          this.render();
        }
      }
    };

    const onUp = () => {
      if (this.activePointIdx >= 0) {
        this._hideTooltip();
        this.activePointIdx = -1;
        this.render();
      }
    };

    this.canvas.addEventListener('mousedown', onDown);
    this.canvas.addEventListener('touchstart', onDown, { passive: true });

    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: true });

    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);

    // Mouse wheel Q adjustment
    this.canvas.addEventListener('wheel', (e) => {
      const pt = this._getCanvasPos(e);
      const idx = this._findNearestPoint(pt.x, pt.y);
      if (idx >= 0) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        this.bands[idx].q = Math.max(0.1, Math.min(10.0, Math.round((this.bands[idx].q + delta) * 10) / 10));
        this._syncBandFilter(idx);
        this._showTooltip(idx, pt.x, pt.y);
        this.render();
      }
    }, { passive: false });

    // Double click to reset band gain to 0
    this.canvas.addEventListener('dblclick', (e) => {
      const pt = this._getCanvasPos(e);
      const idx = this._findNearestPoint(pt.x, pt.y);
      if (idx >= 0) {
        this.bands[idx].gain = 0;
        this._syncBandFilter(idx);
        this._updateBandColDisplays(idx);
        this.render();
      }
    });

    window.addEventListener('resize', () => {
      this._resizeCanvas();
      this.render();
    });

    this._resizeCanvas();
  }

  _resizeCanvas() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const w = Math.max(300, Math.floor(rect.width));
    const h = Math.max(160, Math.floor(rect.height || 180));
    const dpr = window.devicePixelRatio || 1;

    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;

    if (this.ctx) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.scale(dpr, dpr);
    }
    this.cssWidth = w;
    this.cssHeight = h;
  }

  _getCanvasPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: Math.max(0, Math.min(this.cssWidth || 320, clientX - rect.left)),
      y: Math.max(0, Math.min(this.cssHeight || 180, clientY - rect.top)),
    };
  }

  _findNearestPoint(cx, cy) {
    const w = this.cssWidth || 320;
    const h = this.cssHeight || 180;
    let minDist = 28; // comfortable click radius in CSS pixels
    let found = -1;

    this.bands.forEach((b, i) => {
      const px = this._freqToX(b.freq, w);
      const py = this._gainToY(b.gain, h);
      const dist = Math.hypot(cx - px, cy - py);
      if (dist < minDist) {
        minDist = dist;
        found = i;
      }
    });

    return found;
  }

  _freqToX(freq, w) {
    const minLog = Math.log(20);
    const maxLog = Math.log(20000);
    const clamped = Math.max(20, Math.min(20000, freq));
    return ((Math.log(clamped) - minLog) / (maxLog - minLog)) * w;
  }

  _xToFreq(x, w) {
    const minLog = Math.log(20);
    const maxLog = Math.log(20000);
    const norm = Math.max(0, Math.min(1, x / w));
    return Math.exp(minLog + norm * (maxLog - minLog));
  }

  _gainToY(gain, h) {
    // Map -18dB..+18dB to h..0
    const norm = (gain + 18) / 36;
    return h - (norm * h);
  }

  _yToGain(y, h) {
    const norm = Math.max(0, Math.min(1, 1 - y / h));
    return Math.round((norm * 36 - 18) * 10) / 10;
  }

  _updateBandFromPos(idx, x, y) {
    const w = this.cssWidth || 320;
    const h = this.cssHeight || 180;
    const b = this.bands[idx];

    b.freq = Math.round(this._xToFreq(x, w));
    if (b.type !== 'highpass' && b.type !== 'lowpass') {
      b.gain = this._yToGain(y, h);
    }

    this._syncBandFilter(idx);
    this._updateBandColDisplays(idx);

    // Update corresponding range inputs
    const freqInput = document.querySelector(`.fl-eq-freq-slider[data-idx="${idx}"]`);
    const gainInput = document.querySelector(`.fl-eq-gain-slider[data-idx="${idx}"]`);
    if (freqInput) freqInput.value = b.freq;
    if (gainInput) gainInput.value = b.gain;
  }

  _showTooltip(idx, x, y) {
    const tt = document.getElementById('fl-eq-tooltip');
    if (!tt) return;
    const b = this.bands[idx];
    const freqStr = b.freq >= 1000 ? `${(b.freq / 1000).toFixed(2)} kHz` : `${b.freq} Hz`;
    const gainStr = b.gain > 0 ? `+${b.gain.toFixed(1)} dB` : `${b.gain.toFixed(1)} dB`;

    tt.innerHTML = `<strong>Band ${idx + 1} (${b.type.toUpperCase()})</strong><br>Freq: ${freqStr} | Gain: ${gainStr} | Q: ${b.q}`;
    tt.style.left = `${Math.min(x + 12, (this.cssWidth || 320) - 150)}px`;
    tt.style.top = `${Math.max(10, y - 45)}px`;
    tt.style.display = 'block';
  }

  _hideTooltip() {
    const tt = document.getElementById('fl-eq-tooltip');
    if (tt) tt.style.display = 'none';
  }

  _syncBandFilter(idx) {
    const b = this.bands[idx];
    const effectiveGain = (this.isBypassed || !b.enabled) ? 0 : b.gain;
    if (window.app && window.app.audioEngine && window.app.audioEngine.setEQBand) {
      window.app.audioEngine.setEQBand(idx, b.type, b.freq, effectiveGain, b.q);
    }
  }

  _syncAllFiltersToAudioEngine() {
    this.bands.forEach((_, idx) => this._syncBandFilter(idx));
  }

  loadPreset(presetName) {
    switch (presetName) {
      case 'vocal':
        this.bands[0].freq = 90;   this.bands[0].gain = 0;
        this.bands[1].freq = 180;  this.bands[1].gain = -1.5;
        this.bands[2].freq = 450;  this.bands[2].gain = -3.0;
        this.bands[3].freq = 1200; this.bands[3].gain = 0.5;
        this.bands[4].freq = 3500; this.bands[4].gain = 2.5;
        this.bands[5].freq = 9500; this.bands[5].gain = 4.0;
        this.bands[6].freq = 19000;this.bands[6].gain = 0;
        break;
      case 'bass':
        this.bands[0].freq = 30;   this.bands[0].gain = 0;
        this.bands[1].freq = 65;   this.bands[1].gain = 5.0;
        this.bands[2].freq = 250;  this.bands[2].gain = -2.0;
        this.bands[3].freq = 800;  this.bands[3].gain = -3.5;
        this.bands[4].freq = 2500; this.bands[4].gain = 0;
        this.bands[5].freq = 6000; this.bands[5].gain = -2.0;
        this.bands[6].freq = 12000;this.bands[6].gain = 0;
        break;
      case 'warm':
        this.bands[0].freq = 30;   this.bands[0].gain = 0;
        this.bands[1].freq = 120;  this.bands[1].gain = 2.0;
        this.bands[2].freq = 350;  this.bands[2].gain = -1.0;
        this.bands[3].freq = 1000; this.bands[3].gain = 0;
        this.bands[4].freq = 3000; this.bands[4].gain = 1.0;
        this.bands[5].freq = 8000; this.bands[5].gain = 2.5;
        this.bands[6].freq = 19000;this.bands[6].gain = 0;
        break;
      case 'demud':
        this.bands[0].freq = 40;   this.bands[0].gain = 0;
        this.bands[1].freq = 100;  this.bands[1].gain = 0;
        this.bands[2].freq = 320;  this.bands[2].gain = -4.5;
        this.bands[3].freq = 600;  this.bands[3].gain = -2.0;
        this.bands[4].freq = 3500; this.bands[4].gain = 2.0;
        this.bands[5].freq = 8500; this.bands[5].gain = 1.5;
        this.bands[6].freq = 18000;this.bands[6].gain = 0;
        break;
      case 'radio':
        this.bands[0].freq = 480;  this.bands[0].gain = 0;
        this.bands[1].freq = 600;  this.bands[1].gain = -6.0;
        this.bands[2].freq = 1200; this.bands[2].gain = 4.5;
        this.bands[3].freq = 2000; this.bands[3].gain = 3.0;
        this.bands[4].freq = 3200; this.bands[4].gain = 1.0;
        this.bands[5].freq = 4500; this.bands[5].gain = -8.0;
        this.bands[6].freq = 4800; this.bands[6].gain = 0;
        break;
      case 'punch':
        this.bands[0].freq = 40;   this.bands[0].gain = 0;
        this.bands[1].freq = 90;   this.bands[1].gain = 4.0;
        this.bands[2].freq = 400;  this.bands[2].gain = -3.5;
        this.bands[3].freq = 1500; this.bands[3].gain = 1.0;
        this.bands[4].freq = 4500; this.bands[4].gain = 3.5;
        this.bands[5].freq = 10000;this.bands[5].gain = 1.5;
        this.bands[6].freq = 18000;this.bands[6].gain = 0;
        break;
      case 'flat':
      default:
        this.bands[0].freq = 35;    this.bands[0].gain = 0;
        this.bands[1].freq = 110;   this.bands[1].gain = 0;
        this.bands[2].freq = 350;   this.bands[2].gain = 0;
        this.bands[3].freq = 1000;  this.bands[3].gain = 0;
        this.bands[4].freq = 3200;  this.bands[4].gain = 0;
        this.bands[5].freq = 8500;  this.bands[5].gain = 0;
        this.bands[6].freq = 18500; this.bands[6].gain = 0;
        break;
    }

    this._syncAllFiltersToAudioEngine();
    this._renderBandControls();
    this.render();
    if (window.showToast) window.showToast(`Parametric EQ 2: Applied preset "${presetName}"`, 2000);
  }

  _startSpectrumLoop() {
    const loop = () => {
      // Check if sequencer is playing to animate spectrum
      if (window.app && window.app.audioEngine && window.app.audioEngine.analyser) {
        if (!this.spectrumData) {
          this.spectrumData = new Uint8Array(window.app.audioEngine.analyser.frequencyBinCount);
        }
        window.app.audioEngine.analyser.getByteFrequencyData(this.spectrumData);
      }
      this.render();
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  render() {
    if (!this.canvas || !this.ctx) return;
    const w = this.cssWidth || 320;
    const h = this.cssHeight || 180;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, w, h);

    // 1. Sleek FL Studio dark gradient background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#0c0e12');
    bgGrad.addColorStop(1, '#050608');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // 2. Real-time Live Spectrum Analyzer Glow (behind curve)
    if (this.spectrumData) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(0, h);
      const binCount = this.spectrumData.length;
      for (let px = 0; px <= w; px += 3) {
        const freq = this._xToFreq(px, w);
        // Map freq to FFT bin index: bin = freq / (sampleRate / 2) * binCount
        const binIdx = Math.min(binCount - 1, Math.floor((freq / 22050) * binCount));
        const mag = (this.spectrumData[binIdx] || 0) / 255.0;
        const specY = h - (mag * (h - 20));
        ctx.lineTo(px, specY);
      }
      ctx.lineTo(w, h);
      ctx.closePath();

      const specGrad = ctx.createLinearGradient(0, 0, 0, h);
      specGrad.addColorStop(0, 'rgba(0, 210, 211, 0.25)');
      specGrad.addColorStop(0.5, 'rgba(30, 144, 255, 0.15)');
      specGrad.addColorStop(1, 'rgba(15, 20, 25, 0.0)');
      ctx.fillStyle = specGrad;
      ctx.fill();
      ctx.restore();
    }

    // 3. Logarithmic Frequency Grid Lines
    const freqs = [30, 60, 100, 250, 500, 1000, 2500, 5000, 10000, 16000];
    freqs.forEach(f => {
      const gx = this._freqToX(f, w);
      ctx.strokeStyle = '#181b22';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, h);
      ctx.stroke();

      ctx.fillStyle = '#4b5563';
      ctx.font = '8px JetBrains Mono, monospace';
      ctx.fillText(f >= 1000 ? `${f / 1000}k` : f, gx + 2, h - 5);
    });

    // 4. dB Reference Horizontal Grid Lines (+12, +6, 0, -6, -12 dB)
    const dBs = [12, 6, 0, -6, -12];
    dBs.forEach(db => {
      const gy = this._gainToY(db, h);
      ctx.strokeStyle = (db === 0) ? '#2d3748' : '#141820';
      ctx.lineWidth = (db === 0) ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
      ctx.stroke();

      ctx.fillStyle = (db === 0) ? '#9ca3af' : '#374151';
      ctx.font = '8px JetBrains Mono, monospace';
      ctx.fillText(`${db > 0 ? '+' : ''}${db}dB`, 4, gy - 2);
    });

    // 5. Draw Composite Frequency Response Curve with Gradient Fill
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, h / 2);

    for (let px = 0; px <= w; px += 2) {
      const freq = this._xToFreq(px, w);
      let totalGain = 0;

      if (!this.isBypassed) {
        this.bands.forEach(b => {
          if (!b.enabled) return;
          if (b.type === 'peaking') {
            const octDiff = Math.abs(Math.log2(freq / b.freq));
            if (octDiff < 3) {
              totalGain += b.gain * Math.exp(-octDiff * 1.5 * b.q);
            }
          } else if (b.type === 'lowshelf') {
            if (freq < b.freq * 2) {
              totalGain += b.gain / (1 + Math.pow(freq / b.freq, 2));
            }
          } else if (b.type === 'highshelf') {
            if (freq > b.freq * 0.5) {
              totalGain += b.gain / (1 + Math.pow(b.freq / freq, 2));
            }
          } else if (b.type === 'highpass') {
            if (freq < b.freq) {
              const octBelow = Math.log2(b.freq / Math.max(10, freq));
              totalGain -= octBelow * 18 * b.q;
            }
          } else if (b.type === 'lowpass') {
            if (freq > b.freq) {
              const octAbove = Math.log2(freq / b.freq);
              totalGain -= octAbove * 18 * b.q;
            }
          }
        });
      }

      totalGain = Math.max(-24, Math.min(24, totalGain));
      const py = this._gainToY(totalGain, h);
      if (px === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }

    // Stroke the glow curve
    ctx.strokeStyle = this.isBypassed ? '#6b7280' : '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = this.isBypassed ? 'transparent' : 'rgba(255, 255, 255, 0.4)';
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.restore();

    // 6. Draw 7 Interactive Band Nodes
    this.bands.forEach((b, i) => {
      const nx = this._freqToX(b.freq, w);
      const ny = this._gainToY(b.gain, h);
      const isHovered = (i === this.hoverPointIdx);
      const isActive = (i === this.activePointIdx);
      const radius = isActive ? 8 : (isHovered ? 7 : 5.5);

      // Node ring showing Q bandwidth
      if (isHovered || isActive) {
        ctx.beginPath();
        ctx.arc(nx, ny, radius + 5 + (1 / b.q) * 6, 0, Math.PI * 2);
        ctx.strokeStyle = `${b.color}44`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Outer outline
      ctx.beginPath();
      ctx.arc(nx, ny, radius, 0, Math.PI * 2);
      ctx.fillStyle = b.enabled ? b.color : '#4b5563';
      ctx.fill();
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Node number inside / above
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 8px JetBrains Mono, monospace';
      ctx.fillText(i + 1, nx - 2.5, ny - radius - 4);
    });
  }
}

// Safe bootstrap
function initFLParametricEQ() {
  if (!window.flParametricEQ) {
    try {
      window.flParametricEQ = new FLParametricEQ();
    } catch (err) {
      console.warn('Failed to initialize FLParametricEQ:', err);
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFLParametricEQ);
} else {
  initFLParametricEQ();
}

window.FLParametricEQ = FLParametricEQ;
