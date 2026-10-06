/**
 * BeYou Studio — Max 3D Standalone AI Avatar Engine
 * =================================================
 * 100% Offline, Zero-Dependency 3D Canvas Matrix Engine.
 * Renders a 3D metallic producer avatar with 3D rotating rings, glowing visor,
 * 3D specular lighting, mouse tracking, levitation bobbing, and beat pulsing.
 */

class Max3DAvatarEngine {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.width = 90;
    this.height = 90;

    // 3D Mouse tracking
    this.targetMouseX = 0;
    this.targetMouseY = 0;
    this.mouseX = 0;
    this.mouseY = 0;

    this.animId = null;

    // 3D Particles
    this.particles = [];
    for (let i = 0; i < 20; i++) {
      this.particles.push({
        x: (Math.random() - 0.5) * 64,
        y: (Math.random() - 0.5) * 64,
        z: (Math.random() - 0.5) * 64,
        speed: 0.02 + Math.random() * 0.025,
      });
    }

    this._mountUI();
  }

  _mountUI() {
    const avatarBox = document.getElementById('max-buddy-avatar');
    if (!avatarBox) return;

    // Clear any previous canvas/badge
    avatarBox.innerHTML = '';
    avatarBox.style.width = '90px';
    avatarBox.style.height = '90px';
    avatarBox.style.background = 'transparent';
    avatarBox.style.boxShadow = 'none';
    avatarBox.style.borderRadius = '0';
    avatarBox.style.overflow = 'visible';
    avatarBox.style.position = 'relative';
    avatarBox.style.cursor = 'grab';

    // Create 3D canvas with Retina backing
    this.canvas = document.createElement('canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.canvas.style.width = '90px';
    this.canvas.style.height = '90px';
    this.canvas.style.display = 'block';
    this.canvas.style.pointerEvents = 'none';
    avatarBox.appendChild(this.canvas);

    this.ctx = this.canvas.getContext('2d');

    // Add status tag badge under 3D avatar
    const tag = document.createElement('div');
    tag.style.cssText = 'position:absolute;bottom:-6px;left:50%;transform:translateX(-50%);background:#ffffff;color:#000000;font-size:8px;font-weight:900;padding:1px 6px;border-radius:4px;letter-spacing:0.5px;box-shadow:0 2px 8px rgba(0,0,0,0.8);white-space:nowrap;pointer-events:none;user-select:none;';
    tag.textContent = 'MAX 3D';
    avatarBox.appendChild(tag);

    // Track mouse movement across window safely
    window.addEventListener('mousemove', (e) => {
      const w = window.innerWidth || 1000;
      const h = window.innerHeight || 800;
      this.targetMouseX = Math.max(-1, Math.min(1, (e.clientX / w - 0.5) * 2));
      this.targetMouseY = Math.max(-1, Math.min(1, (e.clientY / h - 0.5) * 2));
    });

    this._startRenderLoop();
  }

  _startRenderLoop() {
    if (this.animId) cancelAnimationFrame(this.animId);
    const render = () => {
      this._drawFrame();
      this.animId = requestAnimationFrame(render);
    };
    render();
  }

  _drawFrame() {
    if (!this.ctx || !this.canvas) return;

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const time = Date.now() * 0.003;

    ctx.clearRect(0, 0, w, h);

    // Smooth mouse lerping
    if (!isNaN(this.targetMouseX)) {
      this.mouseX += (this.targetMouseX - this.mouseX) * 0.08;
    }
    if (!isNaN(this.targetMouseY)) {
      this.mouseY += (this.targetMouseY - this.mouseY) * 0.08;
    }

    // Levitation bobbing & beat pulsing
    const bobY = Math.sin(time * 2) * 8;
    const isPlaying = window.app && window.app.sequencer && window.app.sequencer.isPlaying;
    const beatScale = isPlaying ? (1 + Math.sin(time * 14) * 0.09) : 1.0;

    const headRadius = (w * 0.28) * beatScale;

    // ── 1. Draw Orbiting 3D Particles (Background depth) ────────
    this.particles.forEach((p, idx) => {
      p.x += Math.cos(time + p.z) * 0.35;
      p.y += Math.sin(time + p.z) * 0.35;
      const px = cx + p.x * (w / 180);
      const py = cy + bobY + p.y * (h / 180);
      const opacity = 0.3 + Math.sin(time + idx) * 0.35;

      ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0.1, Math.min(0.9, opacity))})`;
      ctx.beginPath();
      ctx.arc(px, py, 1.8, 0, Math.PI * 2);
      ctx.fill();
    });

    // ── 2. Draw 3D Orbiting Gyroscopic Ring 1 (X-axis tilt) ──────
    ctx.save();
    ctx.translate(cx, cy + bobY);
    ctx.rotate(time * 0.85);
    ctx.scale(1, 0.36);
    ctx.beginPath();
    ctx.arc(0, 0, headRadius * 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = 3.5;
    ctx.stroke();
    // Inner glow line
    ctx.strokeStyle = 'rgba(228, 228, 231, 0.3)';
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.restore();

    // ── 3. Draw 3D Orbiting Gyroscopic Ring 2 (Y-axis tilt) ──────
    ctx.save();
    ctx.translate(cx, cy + bobY);
    ctx.rotate(-time * 1.15);
    ctx.scale(0.36, 1);
    ctx.beginPath();
    ctx.arc(0, 0, headRadius * 1.7, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(161, 161, 170, 0.65)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();

    // ── 4. Draw 3D Metallic Cyber Head with Specular Gradient ────
    const headX = cx + this.mouseX * (w * 0.08);
    const headY = cy + bobY + this.mouseY * (h * 0.07);

    // Dynamic 3D specular highlight tracking light & mouse
    const lightX = headX - headRadius * 0.35 - this.mouseX * (headRadius * 0.2);
    const lightY = headY - headRadius * 0.35 - this.mouseY * (headRadius * 0.2);

    const grad = ctx.createRadialGradient(
      lightX,
      lightY,
      Math.max(1, headRadius * 0.08),
      headX,
      headY,
      Math.max(2, headRadius)
    );
    grad.addColorStop(0, '#ffffff');    // Bright specular glint
    grad.addColorStop(0.2, '#e4e4e7');  // Polished chrome
    grad.addColorStop(0.55, '#27272a'); // Metallic dark steel
    grad.addColorStop(0.9, '#121215');  // Charcoal shadow
    grad.addColorStop(1, '#09090b');    // Deep ambient rim

    ctx.beginPath();
    ctx.arc(headX, headY, headRadius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Outer sharp rim
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // ── 5. Cyber Earcups (Left & Right Headphone nodes) ──────────
    const earRadius = headRadius * 0.26;
    [-1, 1].forEach(side => {
      const earX = headX + side * (headRadius * 0.95);
      const earY = headY + this.mouseY * 2;
      ctx.beginPath();
      ctx.arc(earX, earY, earRadius, 0, Math.PI * 2);
      ctx.fillStyle = '#18181b';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Inner LED dot
      ctx.beginPath();
      ctx.arc(earX, earY, earRadius * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    });

    // ── 6. Glowing Cyber Visor HUD ───────────────────────────────
    const visorW = headRadius * 1.25;
    const visorH = Math.max(8, headRadius * 0.38);
    const visorX = headX - visorW / 2 + this.mouseX * 6;
    const visorY = headY - visorH / 2 + this.mouseY * 4;

    // Visor dark obsidian base
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    this._drawRoundedRect(ctx, visorX, visorY, visorW, visorH, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Visor glowing scanner LED lightbar
    const eyeH = Math.max(3, visorH * 0.4);
    const eyeY = visorY + (visorH - eyeH) / 2;
    const eyePad = 4;
    const eyeW = visorW - eyePad * 2;

    ctx.save();
    ctx.shadowColor = 'rgba(255, 255, 255, 0.95)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    this._drawRoundedRect(ctx, visorX + eyePad, eyeY, eyeW, eyeH, 2);
    ctx.fill();
    ctx.restore();

    // Scanner beam highlight sweeping across visor
    const sweep = (Math.sin(time * 4) + 1) * 0.5;
    const beamX = visorX + eyePad + sweep * (eyeW - 8);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 12;
    ctx.fillRect(beamX, eyeY - 1, 8, eyeH + 2);
    ctx.shadowBlur = 0;
  }

  _drawRoundedRect(ctx, x, y, w, h, r) {
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.arcTo(x + w, y, x + w, y + r, r);
      ctx.lineTo(x + w, y + h - r);
      ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
      ctx.lineTo(x + r, y + h);
      ctx.arcTo(x, y + h, x, y + h - r, r);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.closePath();
    }
  }
}

// Global bootstrap with safe readyState handling
function initMax3DAvatar() {
  const mount = () => {
    if (document.getElementById('max-buddy-avatar')) {
      if (!window.max3DAvatarEngine) {
        window.max3DAvatarEngine = new Max3DAvatarEngine();
      }
    } else {
      setTimeout(mount, 100);
    }
  };
  mount();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMax3DAvatar);
} else {
  initMax3DAvatar();
}

window.Max3DAvatarEngine = Max3DAvatarEngine;
