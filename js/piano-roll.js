/**
 * FL Studio Clone — Piano Roll
 * Advanced Canvas-based MIDI note editor with:
 * - Real-time note drawing, moving, and edge length resizing
 * - Expressive per-instrument audio preview on click & typing keyboard
 * - Interactive 3D Piano Keys with glissando drag and live playing LEDs
 * - Ghost Notes from other channels for harmonic alignment (Alt+V)
 * - Scale & key highlighting integration with FLPianoExtras
 * - Note name labeling inside note bars
 * - Transpose octaves, quantization, and smooth zoom in/out
 */

class PianoRoll {
  constructor(canvasEl, keysCanvasEl, sequencer) {
    this.canvas = canvasEl;
    this.keysCanvas = keysCanvasEl;
    this.ctx = canvasEl ? canvasEl.getContext('2d') : null;
    this.keysCtx = keysCanvasEl ? keysCanvasEl.getContext('2d') : null;
    this.sequencer = sequencer;

    // View config
    this.cellW = 48;   // pixels per step
    this.cellH = 14;   // pixels per semitone
    this.steps = (sequencer && sequencer.steps) ? sequencer.steps : 16;
    this.octaves = 8;  // C0–C8
    this.totalNotes = this.octaves * 12; // 96

    // Canvas sizing
    this.totalW = this.cellW * this.steps;
    this.totalH = this.cellH * this.totalNotes;

    // State
    this.tool = 'draw'; // 'draw' | 'erase' | 'select'
    this.quantize = 1;  // steps per note (1=1 step)
    this.chordStamp = 'none';
    this.isDragging = false;
    this.dragMode = null; // 'draw' | 'resize' | 'move' | 'erase'
    this.dragNote = null;
    this.resizingNote = null;
    this.movingNote = null;
    this.moveStartStep = 0;
    this.moveStartMidi = 0;
    this.playhead = 0; // current step playback position

    // Key audition state
    this.isKeysDragging = false;
    this.activeKeyMidi = null;
    this.activePlayingMidis = [];
    this.showGhostNotes = true;
    this.foldedToScale = false;
    this._keyHighlightTimer = null;

    // Which channel we're editing
    this.channelIdx = (sequencer && sequencer.pianoRollChannel !== undefined) ? sequencer.pianoRollChannel : 6;

    // Colors
    this.colors = {
      bg: '#09090b',
      bgAlt: '#121215',
      gridLine: '#27272a',
      gridLineBeat: '#3f3f46',
      blackKey: '#000000',
      whiteKey: '#18181b',
      note: '#ffffff',
      noteSelected: '#e4e4e7',
      noteOutline: 'rgba(0,0,0,0.8)',
      playhead: '#ffffff',
      cLine: '#27272a',
    };

    this._initCanvas();
    this._attachEvents();
    this.render();
  }

  _initCanvas() {
    if (!this.canvas || !this.keysCanvas) return;
    this.canvas.width = this.totalW;
    this.canvas.height = this.totalH;
    this.keysCanvas.width = 48;
    this.keysCanvas.height = this.totalH;
    this._renderKeys();
  }

  setChannel(idx) {
    if (idx === undefined || idx === null || !this.sequencer.channels[idx]) return;
    this.channelIdx = idx;
    this.sequencer.pianoRollChannel = idx;
    const ch = this.sequencer.channels[idx];
    this.colors.note = ch ? (ch.color || '#ff8800') : '#ffffff';
    this.render();
  }

  getVisibleMidis() {
    const scalePitches = (window.flPianoExtras && typeof window.flPianoExtras.getScalePitchClasses === 'function')
      ? window.flPianoExtras.getScalePitchClasses()
      : null;

    if (!this.foldedToScale || !scalePitches || scalePitches.length === 0) {
      return Array.from({ length: this.totalNotes }, (_, i) => i);
    }
    const list = [];
    for (let m = 0; m < this.totalNotes; m++) {
      if (scalePitches.includes(m % 12)) list.push(m);
    }
    return list.length > 0 ? list : Array.from({ length: this.totalNotes }, (_, i) => i);
  }

  yToMidi(y) {
    const v = this.getVisibleMidis();
    const row = Math.floor(y / this.cellH);
    const clampedRow = Math.max(0, Math.min(v.length - 1, row));
    return v[v.length - 1 - clampedRow];
  }

  midiToY(midi) {
    const v = this.getVisibleMidis();
    let idx = v.indexOf(midi);
    if (idx === -1) {
      let bestDiff = 999;
      let bestIdx = 0;
      v.forEach((vm, i) => {
        const d = Math.abs(vm - midi);
        if (d < bestDiff) { bestDiff = d; bestIdx = i; }
      });
      idx = bestIdx;
    }
    const row = v.length - 1 - idx;
    return row * this.cellH;
  }

  toggleFoldScale(forceState) {
    this.foldedToScale = (forceState !== undefined) ? !!forceState : !this.foldedToScale;
    const btn = document.getElementById('pr-btn-fold-scale');
    if (btn) {
      btn.classList.toggle('active', this.foldedToScale);
      btn.textContent = this.foldedToScale ? 'Fold Scale [ON]' : 'Fold Scale';
    }
    const visibleMidis = this.getVisibleMidis();
    this.totalH = visibleMidis.length * this.cellH;
    if (this.canvas) this.canvas.height = this.totalH;
    if (this.keysCanvas) this.keysCanvas.height = this.totalH;
    this._renderKeys();
    this.render();
    if (window.showToast) {
      window.showToast(this.foldedToScale ? 'Fold Scale ON: Out-of-key rows hidden' : 'Fold Scale OFF: Chromatic grid visible');
    }
  }

  stampProgression(progressionKey = 'i-VI-III-VII') {
    const ch = this.sequencer.channels[this.channelIdx];
    if (!ch) return;

    const extras = window.flPianoExtras || {};
    const rootName = extras.scaleRoot || 'C';
    const scaleType = extras.scaleType || 'Minor';
    const noteNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const rootPitchClass = noteNames.indexOf(rootName);

    const isMajor = (scaleType || '').toLowerCase().includes('major');
    const scaleIntervals = isMajor
      ? [0, 2, 4, 5, 7, 9, 11]
      : [0, 2, 3, 5, 7, 8, 10];

    const progressionDegrees = {
      'i-VI-III-VII': [0, 5, 2, 6],
      'i-iv-v-i':     [0, 3, 4, 0],
      'I-V-vi-IV':    [0, 4, 5, 3],
      'ii-V-I-vi':    [1, 4, 0, 5],
      'i-iv-VII-III': [0, 3, 6, 2],
    };

    const degrees = progressionDegrees[progressionKey] || progressionDegrees['i-VI-III-VII'];
    const baseOctave = (ch.name === 'Bass') ? 2 : 4;
    const baseRootMidi = baseOctave * 12 + (rootPitchClass >= 0 ? rootPitchClass : 0);

    ch.notes = [];
    const totalSteps = this.sequencer.steps || 16;
    const chordStepLen = Math.floor(totalSteps / 4);

    degrees.forEach((deg, chordIdx) => {
      const stepOffset = chordIdx * chordStepLen;
      const deg0 = deg;
      const deg1 = (deg + 2) % 7;
      const deg2 = (deg + 4) % 7;

      const oct0 = Math.floor(deg / 7);
      const oct1 = Math.floor((deg + 2) / 7);
      const oct2 = Math.floor((deg + 4) / 7);

      const m0 = baseRootMidi + scaleIntervals[deg0 % 7] + oct0 * 12;
      const m1 = baseRootMidi + scaleIntervals[deg1] + oct1 * 12;
      const m2 = baseRootMidi + scaleIntervals[deg2] + oct2 * 12;

      const notesToAdd = (ch.name === 'Bass') ? [m0 - 12] : [m0, m1, m2];
      notesToAdd.forEach(midi => {
        ch.notes.push({
          step: stepOffset,
          midi: Math.max(12, Math.min(84, midi)),
          length: Math.max(1, chordStepLen - 0.25),
          velocity: 0.85
        });
      });
    });

    this.sequencer.syncChannelStepsFromNotes(this.channelIdx);
    this.render();
    if (window.showToast) window.showToast(`Stamped ${progressionKey} progression in ${rootName} ${scaleType}`);
  }

  // ── Piano key rendering ────────────────────────────────────────
  _renderKeys() {
    if (!this.keysCtx) return;
    const ctx = this.keysCtx;
    const visibleMidis = this.getVisibleMidis();
    const numRows = visibleMidis.length;
    this.totalH = numRows * this.cellH;
    if (this.keysCanvas.height !== this.totalH) this.keysCanvas.height = this.totalH;
    ctx.clearRect(0, 0, 48, this.totalH);

    const noteNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const isBlack = [false,true,false,true,false,false,true,false,true,false,true,false];

    const currentCh = this.sequencer.channels[this.channelIdx];
    const chColor = (currentCh && currentCh.color) ? currentCh.color : '#00d2d3';

    for (let i = 0; i < numRows; i++) {
      const noteIdx = visibleMidis[numRows - 1 - i]; // top = highest note
      const noteName = noteNames[noteIdx % 12];
      const isB = isBlack[noteIdx % 12];
      const octave = Math.floor(noteIdx / 12);
      const y = i * this.cellH;
      const h = this.cellH;

      const isPressed = (this.activeKeyMidi === noteIdx) || (this.activePlayingMidis.includes(noteIdx));

      if (isPressed) {
        // Glowing key highlight in channel color
        ctx.fillStyle = chColor;
        ctx.fillRect(0, y, 48, h);
      } else {
        ctx.fillStyle = isB ? this.colors.blackKey : this.colors.whiteKey;
        ctx.fillRect(0, y, 48, h);

        // Highlight gradient on white keys
        if (!isB) {
          const grad = ctx.createLinearGradient(0, y, 48, y);
          grad.addColorStop(0, 'rgba(255,255,255,0.07)');
          grad.addColorStop(1, 'rgba(0,0,0,0.15)');
          ctx.fillStyle = grad;
          ctx.fillRect(0, y, 48, h);
        } else {
          // Black key depth bevel
          ctx.fillStyle = 'rgba(0,0,0,0.4)';
          ctx.fillRect(0, y, 32, h);
        }
      }

      // Key bottom border
      ctx.strokeStyle = '#111114';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(0, y, 48, h);

      // Label C notes with bold octave
      if (noteName === 'C') {
        ctx.fillStyle = isPressed ? '#ffffff' : '#888888';
        ctx.font = 'bold 9px JetBrains Mono, monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`C${octave}`, 44, y + h - 3);
        if (octave === 5 || octave === 4) {
          ctx.fillStyle = isPressed ? '#ffffff' : chColor;
          ctx.fillRect(4, y + h / 2 - 1.5, 3, 3);
        }
      } else {
        ctx.fillStyle = isPressed ? '#ffffff' : (isB ? '#888888' : '#444444');
        ctx.font = '8px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(noteName, 42, y + h - 3);
      }
    }
  }

  // ── Note grid rendering ────────────────────────────────────────
  render() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const visibleMidis = this.getVisibleMidis();
    const numRows = visibleMidis.length;
    this.totalH = numRows * this.cellH;
    if (this.canvas.height !== this.totalH) this.canvas.height = this.totalH;
    const { totalW, totalH, cellW, cellH, steps } = this;

    ctx.clearRect(0, 0, totalW, totalH);

    const isBlack = [false,true,false,true,false,false,true,false,true,false,true,false];

    // Check active scale highlighting from FLPianoExtras
    const scalePitches = (window.flPianoExtras && typeof window.flPianoExtras.getScalePitchClasses === 'function')
      ? window.flPianoExtras.getScalePitchClasses()
      : null;

    // Draw rows with scale and black key guidance
    for (let i = 0; i < numRows; i++) {
      const noteIdx = visibleMidis[numRows - 1 - i];
      const pitchClass = noteIdx % 12;
      const isB = isBlack[pitchClass];
      const inScale = scalePitches ? scalePitches.includes(pitchClass) : true;
      const y = i * cellH;

      if (scalePitches && !this.foldedToScale) {
        ctx.fillStyle = inScale
          ? (isB ? '#151c28' : '#1c2436')
          : (isB ? '#0d0f13' : '#111317');
      } else {
        ctx.fillStyle = isB ? '#131418' : '#18191f';
      }
      ctx.fillRect(0, y, totalW, cellH);

      // C note horizontal lane highlight
      if (pitchClass === 0) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.fillRect(0, y, totalW, cellH);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(totalW, y);
        ctx.stroke();
      }
    }

    // Vertical grid lines (beats & 16th steps)
    for (let s = 0; s <= steps; s++) {
      const x = s * cellW;
      const isBar = (s % 16 === 0);
      const isBeat = (s % 4 === 0);

      ctx.strokeStyle = isBar ? '#4f5666' : (isBeat ? '#2f3440' : '#1d212a');
      ctx.lineWidth = isBar ? 1.5 : (isBeat ? 1 : 0.5);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, totalH);
      ctx.stroke();

      // Beat / Bar header number
      if (s < steps && isBeat) {
        ctx.fillStyle = isBar ? '#ff7700' : '#555f73';
        ctx.font = 'bold 9px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`${s / 4 + 1}`, x + 3, 11);
      }
    }

    // Horizontal grid lines
    for (let i = 0; i <= numRows; i++) {
      const y = i * cellH;
      ctx.strokeStyle = '#12141a';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(totalW, y);
      ctx.stroke();
    }

    // ── GHOST NOTES (Notes from other channels in the background) ──
    if (this.showGhostNotes && this.sequencer && this.sequencer.channels) {
      this.sequencer.channels.forEach((otherCh, ci) => {
        if (ci === this.channelIdx || !otherCh.notes || !otherCh.notes.length) return;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
        ctx.lineWidth = 0.5;

        otherCh.notes.forEach(gn => {
          const gy = this.midiToY(gn.midi) + 1;
          const gx = gn.step * cellW + 1;
          const gw = Math.max(4, (gn.length || 1) * cellW - 2);
          const gh = cellH - 2;

          ctx.beginPath();
          ctx.roundRect(gx, gy, gw, gh, 2);
          ctx.fill();
          ctx.stroke();
        });
      });
    }

    // ── ACTIVE CHANNEL NOTES ──
    const noteNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const ch = this.sequencer.channels[this.channelIdx];
    if (ch && ch.notes) {
      const noteColor = ch.color || '#00d2d3';

      ch.notes.forEach(note => {
        const { step, midi, length = 1, velocity = 0.8 } = note;
        const x = step * cellW + 1;
        const y = this.midiToY(midi) + 1;
        const w = Math.max(6, length * cellW - 2);
        const h = cellH - 2;

        // Note shadow glow
        ctx.shadowColor = noteColor;
        ctx.shadowBlur = 7;

        // Note body base
        ctx.fillStyle = noteColor;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 3);
        ctx.fill();

        // Velocity overlay darkening
        const velOpacity = Math.max(0, 0.45 - velocity * 0.35);
        ctx.fillStyle = `rgba(0,0,0,${velOpacity})`;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 3);
        ctx.fill();

        // 3D Glass highlight top edge
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillRect(x + 1, y, w - 2, 2);

        // Note outline border
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 0.75;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 3);
        ctx.stroke();

        // Resize handle grip on right edge
        if (w >= 14) {
          ctx.fillStyle = 'rgba(255,255,255,0.3)';
          ctx.fillRect(x + w - 4, y + 2, 2, h - 4);
        }

        // Note name label (e.g. C5, F#4) if wide enough
        if (w >= 28) {
          const nName = noteNames[midi % 12];
          const oct = Math.floor(midi / 12);
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 8px JetBrains Mono, monospace';
          ctx.textAlign = 'left';
          ctx.fillText(`${nName}${oct}`, x + 4, y + h - 2);
        }
      });
    }

    // ── PLAYHEAD INDICATOR ──
    if (this.sequencer.isPlaying) {
      const px = this.playhead * cellW;
      const grad = ctx.createLinearGradient(px, 0, px + 4, 0);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.3, 'rgba(255, 119, 0, 0.85)');
      grad.addColorStop(1, 'rgba(255, 119, 0, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(px, 0, 4, totalH);
    }
  }

  // ── Note Preview Sound Engine (Authentic Per-Instrument Timbre) ──
  _previewNote(midi, duration = 0.32, velocity = 0.8) {
    if (!this.sequencer || !this.sequencer.engine) return;
    const eng = this.sequencer.engine;
    if (!eng.initialized) eng.init();
    if (eng.ctx && eng.ctx.state === 'suspended') {
      try { eng.ctx.resume(); } catch (_) {}
    }

    const ch = this.sequencer.channels[this.channelIdx];
    if (!ch) return;

    const freq = this.sequencer._midiToFreq(midi);
    const n = (ch.name || '').toLowerCase();

    // Trigger visual key light on keysCanvas
    this.activeKeyMidi = midi;
    this._renderKeys();
    clearTimeout(this._keyHighlightTimer);
    this._keyHighlightTimer = setTimeout(() => {
      this.activeKeyMidi = null;
      this._renderKeys();
    }, duration * 1000);

    if (ch.type === 'audio' && ch.audioBuffer) {
      try {
        const src = eng.ctx.createBufferSource();
        src.buffer = ch.audioBuffer;
        src.playbackRate.value = Math.pow(2, (midi - 60) / 12);
        const g = eng.ctx.createGain();
        g.gain.value = 0.75 * (ch.volume || 1) * velocity;
        src.connect(g);
        g.connect(eng.masterCompressor || eng.masterGain || eng.ctx.destination);
        src.start(0);
      } catch (_) {}
    } else if (n.includes('bass') || n.includes('sub')) {
      eng.playBass(0, { freq, gain: 0.5 * (ch.volume || 1) * velocity, duration });
    } else if (n.includes('kick') || n.includes('808')) {
      const pitchOffset = midi - 36;
      eng.playKick(0, { pitch: Math.pow(2, pitchOffset / 12), gain: 0.9 * (ch.volume || 1) * velocity });
    } else if (n.includes('snare') || n.includes('sd')) {
      const pitchOffset = midi - 38;
      eng.playSnare(0, { pitchOffset, gain: 0.75 * (ch.volume || 1) * velocity });
    } else if (n.includes('clap') || n.includes('cp')) {
      eng.playClap(0, { gain: 0.75 * (ch.volume || 1) * velocity });
    } else if (n.includes('hat') || n.includes('hh')) {
      const open = n.includes('open') || n.includes(' o');
      eng.playHihat(0, { open, gain: 0.55 * (ch.volume || 1) * velocity });
    } else if (n.includes('tom')) {
      eng.playTom(0, { gain: 0.75 * (ch.volume || 1) * velocity });
    } else {
      // Synth / Lead / Piano / Keys
      eng.playSynth(0, { freq, type: 'sawtooth', gain: 0.35 * (ch.volume || 1) * velocity, duration });
    }
  }

  // ── Event handling ─────────────────────────────────────────────
  _attachEvents() {
    if (!this.canvas || !this.keysCanvas) return;

    // Keys Canvas: Click & Drag glissando audition
    const handleKeyPointer = (e) => {
      const rect = this.keysCanvas.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const midi = this.yToMidi(y);
      if (midi >= 0 && midi < this.totalNotes && midi !== this.activeKeyMidi) {
        this._previewNote(midi, 0.35, 0.85);
      }
    };

    this.keysCanvas.addEventListener('mousedown', e => {
      this.isKeysDragging = true;
      handleKeyPointer(e);
    });

    window.addEventListener('mousemove', e => {
      if (this.isKeysDragging) {
        handleKeyPointer(e);
      }
    });

    window.addEventListener('mouseup', () => {
      if (this.isKeysDragging) {
        this.isKeysDragging = false;
        this.activeKeyMidi = null;
        this._renderKeys();
      }
    });

    // Piano Roll Toolbar Extra Controls (Fold Scale, Stamp Progression, AI Melody)
    const foldBtn = document.getElementById('pr-btn-fold-scale');
    if (foldBtn && !foldBtn._bound) {
      foldBtn._bound = true;
      foldBtn.addEventListener('click', () => this.toggleFoldScale());
    }

    const stampBtn = document.getElementById('pr-btn-stamp-prog');
    if (stampBtn && !stampBtn._bound) {
      stampBtn._bound = true;
      stampBtn.addEventListener('click', () => {
        const sel = document.getElementById('pr-progression-select');
        const key = sel ? sel.value : 'i-VI-III-VII';
        this.stampProgression(key);
      });
    }

    const aiMelodyBtn = document.getElementById('pr-btn-ai-melody');
    if (aiMelodyBtn && !aiMelodyBtn._bound) {
      aiMelodyBtn._bound = true;
      aiMelodyBtn.addEventListener('click', () => {
        if (window.flApp && typeof window.flApp.generateCounterMelody === 'function') {
          window.flApp.generateCounterMelody();
        } else if (window.app && typeof window.app.generateCounterMelody === 'function') {
          window.app.generateCounterMelody();
        } else if (window.showToast) {
          window.showToast('AI Counter-Melody generating...');
        }
      });
    }

    // Piano Roll Grid interactions
    this.canvas.addEventListener('mousedown', e => this._onMouseDown(e));
    this.canvas.addEventListener('mousemove', e => this._onMouseMove(e));
    this.canvas.addEventListener('mouseup',   e => this._onMouseUp(e));
    this.canvas.addEventListener('contextmenu', e => {
      e.preventDefault();
      this._eraseAt(e);
    });
    this.canvas.addEventListener('mouseleave', () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.dragMode = null;
        this.resizingNote = null;
        this.movingNote = null;
      }
    });
  }

  _getGridPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const step = Math.floor(x / this.cellW);
    const midi = this.yToMidi(y);
    return { step, midi, x, y };
  }

  _findNoteAt(gridPos) {
    const ch = this.sequencer.channels[this.channelIdx];
    if (!ch || !ch.notes) return null;
    for (let i = ch.notes.length - 1; i >= 0; i--) {
      const n = ch.notes[i];
      if (n.midi === gridPos.midi && gridPos.step >= n.step && gridPos.step < (n.step + (n.length || 1))) {
        const notePixelX = n.step * this.cellW;
        const notePixelW = Math.max(6, (n.length || 1) * this.cellW);
        const isResizeEdge = (gridPos.x >= (notePixelX + notePixelW - 8));
        return { note: n, index: i, isResizeEdge };
      }
    }
    return null;
  }

  _onMouseDown(e) {
    e.preventDefault();
    this.isDragging = true;

    // Right-click = Erase note
    if (e.button === 2) {
      this._eraseAt(e);
      return;
    }

    const pos = this._getGridPos(e);
    if (pos.step < 0 || pos.step >= this.steps) return;
    if (pos.midi < 0 || pos.midi >= this.totalNotes) return;

    if (this.tool === 'erase') {
      this._eraseAt(e);
      return;
    }

    const ch = this.sequencer.channels[this.channelIdx];
    if (!ch) return;
    if (!ch.notes) ch.notes = [];

    const hit = this._findNoteAt(pos);

    // 1. Resizing existing note by right edge
    if (hit && hit.isResizeEdge) {
      this.dragMode = 'resize';
      this.resizingNote = hit.note;
      this._previewNote(hit.note.midi, 0.25, hit.note.velocity || 0.8);
      return;
    }

    // 2. Clicked on existing note body
    if (hit && !hit.isResizeEdge) {
      if (this.chordStamp === 'none') {
        // Toggle note off
        this.sequencer.removeNote(this.channelIdx, hit.note.step, hit.note.midi);
        this.sequencer.syncChannelStepsFromNotes(this.channelIdx);
        this.render();
        return;
      }
    }

    // 3. Drawing new note or chord stamp
    const chordOffsets = {
      none: [0],
      major: [0, 4, 7],
      minor: [0, 3, 7],
      maj7: [0, 4, 7, 11],
      min7: [0, 3, 7, 10],
      dom7: [0, 4, 7, 10],
      sus4: [0, 5, 7],
      power: [0, 7]
    };
    const offsets = chordOffsets[this.chordStamp] || [0];
    const noteLen = Math.max(1, this.quantize || 1);

    offsets.forEach(offset => {
      const noteMidi = pos.midi + offset;
      if (noteMidi >= 0 && noteMidi < this.totalNotes) {
        this.sequencer.addNote(this.channelIdx, pos.step, noteMidi, noteLen, 0.85);
        this._previewNote(noteMidi, 0.35, 0.85);
      }
    });

    this.dragMode = 'draw';
    this.dragNote = { step: pos.step, midi: pos.midi };
    this.sequencer.syncChannelStepsFromNotes(this.channelIdx);
    this.render();
  }

  _onMouseMove(e) {
    const pos = this._getGridPos(e);

    // Dynamic hover cursor when not dragging
    if (!this.isDragging) {
      if (this.tool === 'erase') {
        this.canvas.style.cursor = 'cell';
        return;
      }
      const hit = this._findNoteAt(pos);
      if (hit && hit.isResizeEdge) {
        this.canvas.style.cursor = 'ew-resize';
      } else if (hit) {
        this.canvas.style.cursor = 'pointer';
      } else {
        this.canvas.style.cursor = 'crosshair';
      }
      return;
    }

    if (pos.step < 0 || pos.step >= this.steps) return;
    if (pos.midi < 0 || pos.midi >= this.totalNotes) return;

    // Handle Note Length Resize Drag
    if (this.dragMode === 'resize' && this.resizingNote) {
      const newLen = Math.max(1, pos.step - this.resizingNote.step + 1);
      if (this.resizingNote.length !== newLen) {
        this.resizingNote.length = Math.max(1, Math.min(this.steps - this.resizingNote.step, newLen));
        this.render();
      }
      return;
    }

    // Handle Drawing stroke across steps
    if (this.dragMode === 'draw' && this.tool === 'draw') {
      const ch = this.sequencer.channels[this.channelIdx];
      const existing = ch.notes.find(n => n.step === pos.step && n.midi === pos.midi);
      if (!existing) {
        const noteLen = Math.max(1, this.quantize || 1);
        this.sequencer.addNote(this.channelIdx, pos.step, pos.midi, noteLen, 0.85);
        this._previewNote(pos.midi, 0.25, 0.85);
        this.render();
      }
    }
  }

  _onMouseUp() {
    if (this.isDragging) {
      this.isDragging = false;
      this.dragMode = null;
      this.resizingNote = null;
      this.movingNote = null;
      this.dragNote = null;
      this.sequencer.syncChannelStepsFromNotes(this.channelIdx);
    }
  }

  _eraseAt(e) {
    const pos = this._getGridPos(e);
    if (pos.step < 0 || pos.step >= this.steps) return;
    if (pos.midi < 0 || pos.midi >= this.totalNotes) return;
    const hit = this._findNoteAt(pos);
    if (hit) {
      this.sequencer.removeNote(this.channelIdx, hit.note.step, hit.note.midi);
    } else {
      this.sequencer.removeNote(this.channelIdx, pos.step, pos.midi);
    }
    this.sequencer.syncChannelStepsFromNotes(this.channelIdx);
    this.render();
  }

  setTool(tool) {
    this.tool = tool;
    this.canvas.style.cursor = tool === 'erase' ? 'cell' : 'crosshair';
  }

  setQuantize(q) {
    this.quantize = Math.max(1, parseInt(q, 10) || 1);
  }

  setChordStamp(stamp) {
    this.chordStamp = stamp || 'none';
  }

  setScale(scaleKey) {
    if (window.flPianoExtras && typeof window.flPianoExtras.setScale === 'function') {
      window.flPianoExtras.setScale(scaleKey);
    }
    this.render();
  }

  // ── Octave Shift Transpose Tool ────────────────────────────────
  shiftOctave(deltaOctaves = 1) {
    const ch = this.sequencer.channels[this.channelIdx];
    if (!ch || !ch.notes || !ch.notes.length) {
      if (window.showToast) window.showToast('No notes in channel to transpose', 1500);
      return;
    }
    const shift = deltaOctaves * 12;
    ch.notes.forEach(n => {
      n.midi = Math.max(0, Math.min(this.totalNotes - 1, n.midi + shift));
    });
    this.render();
    if (ch.notes.length > 0) this._previewNote(ch.notes[0].midi, 0.35, 0.8);
    if (window.showToast) window.showToast(`Shifted ${ch.name} by ${deltaOctaves > 0 ? '+' : ''}${deltaOctaves} Octave`, 1500);
  }

  // ── Quantize Notes Tool ────────────────────────────────────────
  quantizeNotes() {
    const ch = this.sequencer.channels[this.channelIdx];
    if (!ch || !ch.notes || !ch.notes.length) return;
    const q = Math.max(1, this.quantize || 1);
    ch.notes.forEach(n => {
      n.step = Math.round(n.step / q) * q;
      n.length = Math.max(1, Math.round((n.length || 1) / q) * q);
    });
    this.sequencer.syncChannelStepsFromNotes(this.channelIdx);
    this.render();
    if (window.showToast) window.showToast(`Quantized notes to 1/${16 / q}`, 1500);
  }

  // ── Zoom In / Zoom Out Tool ────────────────────────────────────
  zoom(factor = 1.25) {
    this.cellW = Math.max(20, Math.min(120, Math.round(this.cellW * factor)));
    this.cellH = Math.max(10, Math.min(30, Math.round(this.cellH * factor)));
    this.totalW = this.cellW * this.steps;
    this.totalH = this.cellH * this.totalNotes;
    this._initCanvas();
    this.render();
  }

  toggleGhostNotes() {
    this.showGhostNotes = !this.showGhostNotes;
    this.render();
    if (window.showToast) window.showToast(`Ghost Notes: ${this.showGhostNotes ? 'ON' : 'OFF'}`, 1200);
  }

  updatePlayhead(step) {
    this.playhead = step;

    // Detect currently playing notes to light up piano keys
    const ch = this.sequencer.channels[this.channelIdx];
    if (ch && ch.notes) {
      this.activePlayingMidis = ch.notes
        .filter(n => Math.floor(n.step) <= step && (n.step + (n.length || 1)) > step)
        .map(n => n.midi);
    } else {
      this.activePlayingMidis = [];
    }
    this._renderKeys();
    this.render();
  }

  setSteps(newSteps) {
    this.steps = Math.max(8, parseInt(newSteps, 10) || 16);
    this.totalW = this.cellW * this.steps;
    if (this.canvas) {
      this.canvas.width = this.totalW;
    }
    this.render();
  }

  clear() {
    const ch = this.sequencer.channels[this.channelIdx];
    if (ch) {
      ch.notes = [];
      ch.steps.fill(false);
      this.sequencer.syncChannelStepsFromNotes(this.channelIdx);
    }
    this.render();
  }
}

window.PianoRoll = PianoRoll;
