/**
 * BeYou Studio — Soundgoodizer Plugin
 * =====================================
 * The legendary FL Studio one-knob multiband enhancer / exciter.
 * Features:
 * - Iconic giant central rotary knob (0% to 100%) with glowing LED indicator ring.
 * - 4 Classic Maximus Modes: A (Punchy), B (Warm Tube), C (Air/Sparkle), D (Heavy Loud).
 * - Real-time Web Audio waveshaper saturation + multiband excitation DSP.
 * - Floating plugin window with draggable header and preset buttons.
 */

class FLSoundgoodizer {
  constructor() {
    this.amount = 0.50; // default 50%
    this.mode = 'A';
    this.isOpen = false;
    this.container = null;
    this.knobCanvas = null;
    this.isDragging = false;
    this.startY = 0;
    this.startVal = 0.50;

    this._initUI();
    this._syncDSP();
  }

  _initUI() {
    let el = document.getElementById('fl-soundgoodizer-window');
    if (!el) {
      el = document.createElement('div');
      el.id = 'fl-soundgoodizer-window';
      el.className = 'fl-plugin-window fl-sg-window hidden';
      el.innerHTML = `
        <div class="fl-plugin-header">
          <div class="fl-plugin-title">
            <span class="fl-sg-led"></span>
            <span>SOUNDGOODIZER</span>
          </div>
          <button id="fl-sg-close-btn" class="fl-plugin-close">✕</button>
        </div>
        <div class="fl-sg-body">
          <!-- 4 Mode Buttons: A, B, C, D -->
          <div class="fl-sg-modes">
            <button class="fl-sg-mode-btn active" data-mode="A" title="Punchy Highs &amp; Lows">A</button>
            <button class="fl-sg-mode-btn" data-mode="B" title="Warm Analog Tube">B</button>
            <button class="fl-sg-mode-btn" data-mode="C" title="Sparkle &amp; Stereo Air">C</button>
            <button class="fl-sg-mode-btn" data-mode="D" title="Heavy Bass &amp; Loud Saturation">D</button>
          </div>

          <!-- Giant Glowing Soundgoodizer Rotary Knob -->
          <div class="fl-sg-knob-wrap" title="Drag up/down or scroll wheel to adjust Soundgoodizer amount">
            <canvas id="fl-sg-knob-canvas" width="140" height="140"></canvas>
            <div id="fl-sg-val-display" class="fl-sg-val-display">50%</div>
          </div>

          <div class="fl-sg-footer">
            <span class="fl-sg-hint">Master Bus Maximus Enhancer</span>
            <button id="fl-sg-toggle-btn" class="fl-sg-power-btn active" title="Power On/Off">POWER</button>
          </div>
        </div>
      `;
      document.body.appendChild(el);
    }

    this.container = el;
    this.knobCanvas = document.getElementById('fl-sg-knob-canvas');

    this._attachEvents();
    this._renderKnob();
  }

  _attachEvents() {
    const closeBtn = document.getElementById('fl-sg-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => this.close());

    // Mode buttons A, B, C, D
    const modeBtns = this.container.querySelectorAll('.fl-sg-mode-btn');
    modeBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const m = e.currentTarget.dataset.mode;
        this.setMode(m);
      });
    });

    // Power toggle button
    const powerBtn = document.getElementById('fl-sg-toggle-btn');
    if (powerBtn) {
      powerBtn.addEventListener('click', () => {
        const isOff = powerBtn.classList.contains('active');
        powerBtn.classList.toggle('active', !isOff);
        this.setAmount(isOff ? 0 : 0.5);
      });
    }

    // Knob drag handling
    if (this.knobCanvas) {
      this.knobCanvas.addEventListener('mousedown', (e) => {
        this.isDragging = true;
        this.startY = e.clientY;
        this.startVal = this.amount;
        e.preventDefault();
      });

      window.addEventListener('mousemove', (e) => {
        if (!this.isDragging) return;
        const dy = this.startY - e.clientY;
        const newVal = Math.max(0, Math.min(1, this.startVal + dy * 0.006));
        this.setAmount(newVal);
      });

      window.addEventListener('mouseup', () => {
        this.isDragging = false;
      });

      // Mouse wheel control
      this.knobCanvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.05 : 0.05;
        this.setAmount(Math.max(0, Math.min(1, this.amount + delta)));
      }, { passive: false });
    }

    // Draggable header
    const header = this.container.querySelector('.fl-plugin-header');
    if (header) {
      let isWinDrag = false, wStartX = 0, wStartY = 0, initL = 0, initT = 0;
      header.addEventListener('mousedown', (e) => {
        if (e.target.id === 'fl-sg-close-btn') return;
        isWinDrag = true;
        wStartX = e.clientX;
        wStartY = e.clientY;
        const rect = this.container.getBoundingClientRect();
        initL = rect.left;
        initT = rect.top;
        e.preventDefault();
      });
      window.addEventListener('mousemove', (e) => {
        if (!isWinDrag) return;
        this.container.style.left = `${initL + (e.clientX - wStartX)}px`;
        this.container.style.top  = `${initT + (e.clientY - wStartY)}px`;
        this.container.style.right = 'auto';
        this.container.style.bottom = 'auto';
      });
      window.addEventListener('mouseup', () => { isWinDrag = false; });
    }
  }

  open() {
    this.isOpen = true;
    if (this.container) {
      this.container.classList.remove('hidden');
      this._renderKnob();
    }
  }

  close() {
    this.isOpen = false;
    if (this.container) this.container.classList.add('hidden');
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  setAmount(val) {
    this.amount = Math.max(0, Math.min(1, val));
    this._renderKnob();
    this._syncDSP();

    const valEl = document.getElementById('fl-sg-val-display');
    if (valEl) valEl.textContent = `${Math.round(this.amount * 100)}%`;

    const powerBtn = document.getElementById('fl-sg-toggle-btn');
    if (powerBtn) powerBtn.classList.toggle('active', this.amount > 0);
  }

  setMode(mode) {
    this.mode = mode;
    this.container.querySelectorAll('.fl-sg-mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    this._syncDSP();
    if (window.showToast) window.showToast(`Soundgoodizer Mode: Preset ${mode}`, 1500);
  }

  _syncDSP() {
    if (window.app && window.app.audioEngine && window.app.audioEngine.setSoundgoodizer) {
      window.app.audioEngine.setSoundgoodizer(this.amount, this.mode);
    }
  }

  _renderKnob() {
    if (!this.knobCanvas) return;
    const ctx = this.knobCanvas.getContext('2d');
    const w = this.knobCanvas.width;
    const h = this.knobCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const r = cx - 12;

    ctx.clearRect(0, 0, w, h);

    const startAngle = Math.PI * 0.75;
    const endAngle   = Math.PI * 2.25;
    const currentAngle = startAngle + this.amount * (endAngle - startAngle);

    // Outer background track arc
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, endAngle);
    ctx.strokeStyle = '#181b22';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Glowing active arc
    if (this.amount > 0.01) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, startAngle, currentAngle);
      ctx.strokeStyle = this.mode === 'B' ? '#ffa502' : (this.mode === 'C' ? '#9b59b6' : (this.mode === 'D' ? '#ff4757' : '#00d2d3'));
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.restore();
    }

    // Central metallic knob body
    const grad = ctx.createRadialGradient(cx - 10, cy - 10, 5, cx, cy, r - 12);
    grad.addColorStop(0, '#374151');
    grad.addColorStop(0.7, '#1f2937');
    grad.addColorStop(1, '#111827');
    ctx.beginPath();
    ctx.arc(cx, cy, r - 12, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = '#4b5563';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Indicator needle notch
    const notchLen = r - 18;
    const nx = cx + Math.cos(currentAngle) * notchLen;
    const ny = cy + Math.sin(currentAngle) * notchLen;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(nx, ny);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}

function initFLSoundgoodizer() {
  if (!window.flSoundgoodizer) {
    try {
      window.flSoundgoodizer = new FLSoundgoodizer();
    } catch (e) {
      console.warn('Could not init Soundgoodizer:', e);
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFLSoundgoodizer);
} else {
  initFLSoundgoodizer();
}

window.FLSoundgoodizer = FLSoundgoodizer;
