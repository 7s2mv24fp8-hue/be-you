/**
 * BeYou Studio — FL Studio Graph Editor (F4 / Per-step Parameter Fine-Tuning)
 * =========================================================================
 * Provides FL Studio's signature per-step parameter tweaking panel underneath
 * the Channel Rack.
 *
 * Parameters per step:
 *  - Velocity  (0% – 100%)
 *  - Pitch     (-12 st to +12 st)
 *  - Pan       (L100% to R100%)
 *  - Cutoff    (100 Hz to 20,000 Hz)
 */

class FLGraphEditor {
  constructor() {
    this.visible = false;
    this.currentMode = 'velocity'; // 'velocity' | 'pitch' | 'pan' | 'cutoff'
    this.selectedChannel = 0;
    this.canvas = null;
    this.ctx = null;
    this.container = null;
    this.isDragging = false;

    this._initUI();
  }

  _initUI() {
    // Inject graph editor container under channel rack if not present
    const channelRack = document.getElementById('channel-rack');
    if (!channelRack) return;

    const geWrap = document.createElement('div');
    geWrap.id = 'fl-graph-editor-wrap';
    geWrap.className = 'fl-ge-wrap hidden';
    geWrap.innerHTML = `
      <div class="fl-ge-header">
        <span class="fl-ge-title">Graph Editor</span>
        <select id="fl-ge-channel-select" class="fl-ge-channel-select" style="background:#18181b;color:#e4e4e7;border:1px solid #3f3f46;border-radius:4px;font-size:10px;padding:2px 6px;margin-left:6px;cursor:pointer;">
        </select>
        <div class="fl-ge-tabs">
          <button class="fl-ge-tab active" data-mode="velocity">Velocity</button>
          <button class="fl-ge-tab" data-mode="pitch">Pitch</button>
          <button class="fl-ge-tab" data-mode="pan">Pan</button>
          <button class="fl-ge-tab" data-mode="cutoff">Cutoff</button>
        </div>
        <button class="fl-ge-close" id="fl-ge-close-btn" title="Close Graph Editor (F4)">✕</button>
      </div>
      <div class="fl-ge-body">
        <canvas id="fl-ge-canvas" height="90"></canvas>
      </div>
    `;

    channelRack.appendChild(geWrap);

    this.container = geWrap;
    this.canvas = document.getElementById('fl-ge-canvas');
    if (this.canvas) this.ctx = this.canvas.getContext('2d');

    // Add toggle button to channel rack controls header
    const rackControls = channelRack.querySelector('.rack-controls');
    if (rackControls) {
      const geToggleBtn = document.createElement('button');
      geToggleBtn.className = 'ch-btn';
      geToggleBtn.title = 'Graph Editor (F4) — Tweak step Velocity, Pitch, Pan, Cutoff';
      geToggleBtn.style.cssText = 'width:auto;padding:0 8px;font-size:10px;font-weight:700;margin-left:4px;';
      geToggleBtn.textContent = 'Graph Editor';
      geToggleBtn.addEventListener('click', () => this.toggle());
      rackControls.appendChild(geToggleBtn);
    }

    this._attachEvents();
  }

  toggle() {
    this.visible = !this.visible;
    if (this.container) {
      this.container.classList.toggle('hidden', !this.visible);
      if (this.visible) this.render();
    }
  }

  _attachEvents() {
    if (!this.container) return;

    // Close button
    const closeBtn = document.getElementById('fl-ge-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => this.toggle());

    // Channel dropdown
    const chSelect = document.getElementById('fl-ge-channel-select');
    if (chSelect) {
      chSelect.addEventListener('change', (e) => {
        this.selectedChannel = parseInt(e.target.value, 10) || 0;
        this.render();
      });
    }

    // Mode tabs
    const tabs = this.container.querySelectorAll('.fl-ge-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        tabs.forEach(t => t.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.currentMode = e.currentTarget.dataset.mode;
        this.render();
      });
    });

    // F4 keyboard shortcut
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F4') {
        e.preventDefault();
        this.toggle();
      }
    });

    // Canvas interactivity
    if (this.canvas) {
      this.canvas.addEventListener('mousedown', (e) => {
        this.isDragging = true;
        this._handleCanvasPointer(e);
      });
      window.addEventListener('mousemove', (e) => {
        if (this.isDragging) this._handleCanvasPointer(e);
      });
      window.addEventListener('mouseup', () => {
        this.isDragging = false;
      });
    }

    // Resize observer
    if (window.ResizeObserver && this.canvas) {
      const ro = new ResizeObserver(() => this.render());
      ro.observe(this.canvas.parentElement);
    }
  }

  _handleCanvasPointer(e) {
    if (!window.app || !this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const channel = window.app.sequencer.channels[this.selectedChannel];
    if (!channel) return;

    const stepCount = channel.steps.length || 16;
    const barWidth = rect.width / stepCount;
    const stepIdx = Math.floor(x / barWidth);

    if (stepIdx < 0 || stepIdx >= stepCount) return;

    // Calculate normalized value from Y pointer position (top=1.0, bottom=0.0)
    const norm = Math.max(0, Math.min(1, 1 - y / rect.height));

    if (this.currentMode === 'velocity') {
      if (!channel.velocity) channel.velocity = Array(stepCount).fill(0.8);
      channel.velocity[stepIdx] = Math.round(norm * 100) / 100;
      // Enable step if velocity set > 0
      if (norm > 0.05) channel.steps[stepIdx] = true;
    } else if (this.currentMode === 'pitch') {
      if (!channel.stepPitch) channel.stepPitch = Array(stepCount).fill(0);
      // Map norm 0..1 to -12..+12 semitones
      channel.stepPitch[stepIdx] = Math.round((norm - 0.5) * 24);
    } else if (this.currentMode === 'pan') {
      if (!channel.stepPan) channel.stepPan = Array(stepCount).fill(0);
      // Map norm 0..1 to -1..+1 pan
      channel.stepPan[stepIdx] = Math.round((norm * 2 - 1) * 100) / 100;
    } else if (this.currentMode === 'cutoff') {
      if (!channel.stepCutoff) channel.stepCutoff = Array(stepCount).fill(2000);
      // Logarithmic cutoff 100Hz to 20000Hz
      const minLog = Math.log(100);
      const maxLog = Math.log(20000);
      channel.stepCutoff[stepIdx] = Math.round(Math.exp(minLog + norm * (maxLog - minLog)));
    }

    if (window.app._refreshChannelRack) window.app._refreshChannelRack();
    this.render();
  }

  render() {
    if (!this.visible || !this.canvas || !this.ctx || !window.app) return;

    const parent = this.canvas.parentElement;
    if (parent) {
      this.canvas.width = parent.clientWidth || 300;
      this.canvas.height = 90;
    }

    const w = this.canvas.width;
    const h = this.canvas.height;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, w, h);

    // Update channel select dropdown
    const chSelect = document.getElementById('fl-ge-channel-select');
    if (chSelect && window.app.sequencer && window.app.sequencer.channels) {
      const channels = window.app.sequencer.channels;
      if (chSelect.options.length !== channels.length) {
        chSelect.innerHTML = '';
        channels.forEach((c, idx) => {
          const opt = document.createElement('option');
          opt.value = idx;
          opt.textContent = `${idx + 1}. ${c.name}`;
          chSelect.appendChild(opt);
        });
      }
      chSelect.value = this.selectedChannel;
    }

    const channel = window.app.sequencer.channels[this.selectedChannel] || window.app.sequencer.channels[0];
    if (!channel) return;

    const stepCount = channel.steps.length || 16;
    const barWidth = w / stepCount;

    // Grid lines & step numbers
    for (let i = 0; i < stepCount; i++) {
      const bx = i * barWidth;
      ctx.strokeStyle = i % 4 === 0 ? '#27272a' : '#18181b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bx, 0);
      ctx.lineTo(bx, h);
      ctx.stroke();
    }

    // Midline for pan and pitch modes
    if (this.currentMode === 'pitch' || this.currentMode === 'pan') {
      ctx.strokeStyle = '#3f3f46';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
    }

    // Render bars for each step
    for (let i = 0; i < stepCount; i++) {
      const bx = i * barWidth;
      const bw = barWidth - 4;
      const active = channel.steps[i];

      let norm = 0.8;
      if (this.currentMode === 'velocity') {
        norm = (channel.velocity && channel.velocity[i] !== undefined) ? channel.velocity[i] : (active ? 0.8 : 0);
      } else if (this.currentMode === 'pitch') {
        const st = (channel.stepPitch && channel.stepPitch[i] !== undefined) ? channel.stepPitch[i] : 0;
        norm = 0.5 + (st / 24);
      } else if (this.currentMode === 'pan') {
        const p = (channel.stepPan && channel.stepPan[i] !== undefined) ? channel.stepPan[i] : 0;
        norm = (p + 1) / 2;
      } else if (this.currentMode === 'cutoff') {
        const freq = (channel.stepCutoff && channel.stepCutoff[i] !== undefined) ? channel.stepCutoff[i] : 2000;
        norm = (Math.log(freq) - Math.log(100)) / (Math.log(20000) - Math.log(100));
      }

      const barH = norm * h;

      if (this.currentMode === 'pitch' || this.currentMode === 'pan') {
        const midY = h / 2;
        const targetY = h - barH;
        ctx.fillStyle = active ? '#ffffff' : '#3f3f46';
        ctx.fillRect(bx + 2, Math.min(midY, targetY), bw, Math.abs(midY - targetY) || 2);
      } else {
        ctx.fillStyle = active ? '#ffffff' : '#27272a';
        ctx.fillRect(bx + 2, h - barH, bw, barH);
      }

      // Top bar cap handle
      ctx.fillStyle = active ? '#ffffff' : '#52525b';
      ctx.fillRect(bx + 2, h - barH - 2, bw, 3);
    }
  }
}

function initFLGraphEditor() {
  if (!window.flGraphEditor) {
    window.flGraphEditor = new FLGraphEditor();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFLGraphEditor);
} else {
  initFLGraphEditor();
}
