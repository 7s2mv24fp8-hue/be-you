/**
 * BeYou Studio — Sequencer
 * BPM step sequencer with Web Audio lookahead scheduling, dynamic pattern length & swing
 */

class Sequencer {
  constructor(audioEngine) {
    this.engine = audioEngine;

    // Playback state
    this.isPlaying = false;
    this.playbackMode = 'pattern'; // 'pattern' | 'song'
    this.bpm = 140;
    this.steps = 16;
    this.swing = 0; // 0.0 to 0.75 groove swing
    this.currentStep = 0;
    this.songStep = 0;

    // Scheduling config
    this.scheduleAheadTime = 0.12; // seconds to look ahead
    this.lookahead = 20;           // ms timer interval
    this._nextStepTime = 0;
    this._schedulerTimer = null;

    // Optional reference to Playlist for Song Mode arrangement playback
    this.playlist = null;

    // Channel data: array of channels
    // Each channel: { name, color, steps: bool[16], velocity: num[16], volume: 1, pan: 0, muted: false, solo: false, type: 'drum'|'synth', notes: [] }
    this.channels = this._buildDefaultChannels();

    // Pattern name
    this.patternName = 'Pattern 1';
    this.metronomeEnabled = false;

    // Callbacks
    this.onStep = null;       // (stepIndex) => void
    this.onStop = null;       // () => void
    this.onPatternChange = null;

    // Piano roll channel index (which channel piano roll edits)
    this.pianoRollChannel = 6; // Bass by default
  }

  _buildDefaultChannels() {
    const make = (name, color, type = 'drum', defaults = []) => {
      const steps = Array(this.steps || 16).fill(false);
      const velocity = Array(this.steps || 16).fill(0.8);
      defaults.forEach(i => { if (i < steps.length) steps[i] = true; });
      return { name, color, steps, velocity, volume: 1, pan: 0, muted: false, solo: false, type, notes: [], filterFreq: 2000, filterRes: 1 };
    };

    return [
      make('Kick',     '#ff4757', 'drum',  [0, 4, 8, 12]),
      make('Clap',     '#ffa502', 'drum',  [4, 12]),
      make('Hi-Hat C', '#2ed573', 'drum',  [0,2,4,6,8,10,12,14]),
      make('Hi-Hat O', '#1e90ff', 'drum',  [6, 14]),
      make('Snare',    '#ff6b81', 'drum',  [4, 12]),
      make('Tom',      '#9b59b6', 'drum',  [10, 15]),
      make('Bass',     '#00d2d3', 'synth', [0, 4, 8]),
      make('Lead',     '#ff9f43', 'synth', [0, 2, 5, 9, 12]),
    ];
  }

  // ── Step time calculation ──────────────────────────────────────
  get stepDuration() {
    return (60 / this.bpm) / 4; // 16th note duration in seconds
  }

  setSwing(val) {
    this.swing = Math.max(0, Math.min(0.75, parseFloat(val) || 0));
  }

  setStepCount(newSteps) {
    newSteps = Math.max(8, Math.min(128, parseInt(newSteps, 10) || 16));
    this.steps = newSteps;

    this.channels.forEach(ch => {
      const oldSteps = ch.steps || [];
      const oldVel = ch.velocity || [];
      const oldPitch = ch.stepPitch || [];
      const oldPan = ch.stepPan || [];
      const oldCutoff = ch.stepCutoff || [];

      ch.steps = new Array(newSteps).fill(false);
      ch.velocity = new Array(newSteps).fill(0.8);
      ch.stepPitch = new Array(newSteps).fill(0);
      ch.stepPan = new Array(newSteps).fill(0);
      ch.stepCutoff = new Array(newSteps).fill(2000);

      for (let i = 0; i < Math.min(oldSteps.length, newSteps); i++) {
        ch.steps[i] = oldSteps[i];
        ch.velocity[i] = oldVel[i] !== undefined ? oldVel[i] : 0.8;
        ch.stepPitch[i] = oldPitch[i] !== undefined ? oldPitch[i] : 0;
        ch.stepPan[i] = oldPan[i] !== undefined ? oldPan[i] : 0;
        ch.stepCutoff[i] = oldCutoff[i] !== undefined ? oldCutoff[i] : 2000;
      }
    });

    if (this.currentStep >= newSteps) {
      this.currentStep = 0;
    }

    if (window.app) {
      if (typeof window.app._renderStepHeaders === 'function') {
        window.app._renderStepHeaders(newSteps);
      }
      if (typeof window.app._buildChannelRack === 'function') {
        window.app._buildChannelRack();
      }
      if (window.app.pianoRoll && typeof window.app.pianoRoll.setSteps === 'function') {
        window.app.pianoRoll.setSteps(newSteps);
      }
      if (window.flGraphEditor && window.flGraphEditor.visible) {
        window.flGraphEditor.render();
      }
    }
  }

  // ── Playback mode control ──────────────────────────────────────
  setPlaybackMode(mode) {
    if (mode !== 'pattern' && mode !== 'song') return;
    this.playbackMode = mode;
    if (!this.isPlaying) {
      this.currentStep = 0;
      this.songStep = 0;
    }
  }

  // ── Playback control ───────────────────────────────────────────
  play() {
    if (!this.engine.initialized) this.engine.init();
    this.engine.resume();

    if (this.isPlaying) return;
    this.isPlaying = true;
    if (this.playbackMode === 'song') {
      const totalBars = (this.playlist && this.playlist.bars) ? this.playlist.bars : 32;
      const maxSteps = totalBars * 16;
      if (this.songStep >= maxSteps) {
        this.songStep = 0;
      }
      this.currentStep = this.songStep % this.steps;
    } else {
      this.currentStep = 0;
    }
    this._nextStepTime = this.engine.currentTime + 0.05;
    this._schedulerTimer = setInterval(() => this._scheduler(), this.lookahead);
  }

  stop() {
    this.isPlaying = false;
    clearInterval(this._schedulerTimer);
    this._schedulerTimer = null;
    this.currentStep = 0;
    this.songStep = 0;
    if (this.playlist && typeof this.playlist.updatePlayhead === 'function') {
      this.playlist.updatePlayhead(0);
    }
    if (this.onStop) this.onStop();
  }

  toggle() {
    this.isPlaying ? this.stop() : this.play();
  }

  // ── Lookahead scheduler ────────────────────────────────────────
  _scheduler() {
    const now = this.engine.currentTime;
    while (this._nextStepTime < now + this.scheduleAheadTime) {
      const stepIndex = this.playbackMode === 'song' ? this.songStep : this.currentStep;
      this._scheduleStep(stepIndex, this._nextStepTime);
      this._advanceStep();
    }
  }

  _scheduleStep(step, time) {
    const isSongMode = this.playbackMode === 'song';
    const patternStep = isSongMode ? (step % this.steps) : step;
    const currentBar = isSongMode ? Math.floor(step / 16) : 0;

    // Humanized groove swing offset for 16th offbeats (odd steps)
    const swingDelay = (patternStep % 2 === 1) ? (this.swing * this.stepDuration * 0.55) : 0;
    const playTime = time + swingDelay;

    // Metronome click on beats 1, 2, 3, 4 (steps 0, 4, 8, 12, 16...)
    if (this.metronomeEnabled && patternStep % 4 === 0 && this.engine.playMetronome) {
      this.engine.playMetronome(patternStep, time);
    }

    const hasSolo = this.channels.some(c => c.solo);

    this.channels.forEach((ch, idx) => {
      if (ch.muted) return;
      if (hasSolo && !ch.solo) return;

      // In Song Mode, check if channel has an active block on this bar in the playlist arrangement
      if (isSongMode && this.playlist && this.playlist.tracks) {
        const track = this.playlist.tracks[idx] || this.playlist.tracks.find(t => t.name === ch.name);
        const hasBlock = track && track.blocks && track.blocks.some(b => currentBar >= b.bar && currentBar < (b.bar + b.length));
        if (!hasBlock) return; // Muted for this bar in the song arrangement
      }

      if (!ch.steps[patternStep]) return;

      const vel = (ch.velocity[patternStep] !== undefined ? ch.velocity[patternStep] : 0.8) * ch.volume;

      const stepPitch = (ch.stepPitch && ch.stepPitch[patternStep] !== undefined) ? ch.stepPitch[patternStep] : 0;
      const stepPan   = (ch.stepPan && ch.stepPan[patternStep] !== undefined) ? ch.stepPan[patternStep] : (ch.pan || 0);
      const stepCutoff = (ch.stepCutoff && ch.stepCutoff[patternStep] !== undefined) ? ch.stepCutoff[patternStep] : (ch.filterFreq || 2000);

      if (ch.type === 'drum') {
        this.engine.triggerChannel(ch.name, playTime, vel, { pitchOffset: stepPitch, pan: stepPan, cutoff: stepCutoff });
      } else if (ch.type === 'audio' && ch.audioBuffer) {
        // Play recorded vocal / audio clip with pitch & pan
        try {
          const src = this.engine.ctx.createBufferSource();
          src.buffer = ch.audioBuffer;
          if (stepPitch !== 0) {
            src.playbackRate.value = Math.pow(2, stepPitch / 12);
          }
          const gainNode = this.engine.ctx.createGain();
          gainNode.gain.setValueAtTime(vel * (ch.volume || 1), playTime);

          let lastNode = gainNode;
          if (stepPan !== 0 && this.engine.ctx.createStereoPanner) {
            const panner = this.engine.ctx.createStereoPanner();
            panner.pan.value = stepPan;
            gainNode.connect(panner);
            lastNode = panner;
          }

          src.connect(gainNode);
          lastNode.connect(this.engine.masterCompressor || this.engine.ctx.destination);
          src.start(playTime);
        } catch (e) {
          console.warn('Audio clip playback failed:', e);
        }
      } else {
        // Synth: find notes for this step from piano roll
        const stepNotes = ch.notes.filter(n => Math.floor(n.step) === patternStep);
        if (stepNotes.length > 0) {
          stepNotes.forEach(n => {
            let freq = this._midiToFreq(n.midi);
            if (stepPitch !== 0) freq *= Math.pow(2, stepPitch / 12);
            const dur = (n.length || 1) * this.stepDuration;
            if (ch.name === 'Bass') {
              this.engine.playBass(playTime, { freq, gain: vel * 0.5, duration: dur, filterFreq: stepCutoff });
            } else {
              this.engine.playSynth(playTime, { freq, gain: vel * 0.35, duration: dur, filterFreq: stepCutoff });
            }
          });
        } else {
          // Default synth note if no piano roll notes
          const defaultFreqs = { 'Bass': 110, 'Lead': 440 };
          let freq = (defaultFreqs[ch.name] || 220) * Math.pow(2, stepPitch / 12);
          const dur = this.stepDuration;
          if (ch.name === 'Bass') {
            this.engine.playBass(playTime, { freq, gain: vel * 0.4, duration: dur, filterFreq: stepCutoff });
          } else {
            this.engine.playSynth(playTime, { freq, gain: vel * 0.25, duration: dur, filterFreq: stepCutoff });
          }
        }
      }
    });

    // Notify UI on the step being played
    const stepCopy = patternStep;
    const songStepCopy = step;
    const delay = (time - this.engine.currentTime) * 1000;
    setTimeout(() => {
      if (this.onStep) this.onStep(stepCopy, songStepCopy);
    }, Math.max(0, delay));
  }

  _advanceStep() {
    this._nextStepTime += this.stepDuration;
    if (this.playbackMode === 'song') {
      const totalBars = (this.playlist && this.playlist.bars) ? this.playlist.bars : 32;
      const maxSteps = totalBars * 16;
      if (this.playlist && this.playlist.isLooping) {
        const loopStartStep = Math.max(0, Math.floor(this.playlist.loopStart * 16));
        const loopEndStep = Math.min(maxSteps, Math.floor(this.playlist.loopEnd * 16));
        this.songStep++;
        if (this.songStep >= loopEndStep || this.songStep < loopStartStep) {
          this.songStep = loopStartStep;
        }
      } else {
        this.songStep = (this.songStep + 1) % maxSteps;
      }
      this.currentStep = this.songStep % this.steps;
    } else {
      this.currentStep = (this.currentStep + 1) % this.steps;
    }
  }

  // ── Step manipulation ──────────────────────────────────────────
  toggleStep(channelIdx, stepIdx) {
    const ch = this.channels[channelIdx];
    ch.steps[stepIdx] = !ch.steps[stepIdx];
    if (this.onPatternChange) this.onPatternChange();
  }

  setStepVelocity(channelIdx, stepIdx, vel) {
    this.channels[channelIdx].velocity[stepIdx] = Math.max(0.01, Math.min(1, vel));
  }

  setChannelVolume(idx, vol) {
    this.channels[idx].volume = Math.max(0, Math.min(1.5, vol));
  }

  setChannelMute(idx, val) {
    this.channels[idx].muted = val;
  }

  setChannelSolo(idx, val) {
    // Toggle solo — only one channel soloed at a time
    this.channels.forEach((c, i) => { c.solo = i === idx ? val : false; });
  }

  setBPM(bpm) {
    this.bpm = Math.max(20, Math.min(300, bpm));
  }

  // ── Piano roll note integration ────────────────────────────────
  addNote(channelIdx, step, midi, length = 1, velocity = 0.8) {
    const ch = this.channels[channelIdx];
    // Remove existing note at same step/midi
    ch.notes = ch.notes.filter(n => !(n.step === step && n.midi === midi));
    ch.notes.push({ step, midi, length, velocity });
    ch.steps[step] = true;
  }

  removeNote(channelIdx, step, midi) {
    const ch = this.channels[channelIdx];
    ch.notes = ch.notes.filter(n => !(n.step === step && n.midi === midi));
    const hasNotes = ch.notes.some(n => n.step === step);
    if (!hasNotes) ch.steps[step] = false;
  }

  // ── Util ───────────────────────────────────────────────────────
  _midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // ── Randomize pattern ──────────────────────────────────────────
  randomizeChannel(idx) {
    const ch = this.channels[idx];
    ch.steps = ch.steps.map(() => Math.random() > 0.65);
    ch.velocity = ch.velocity.map(() => 0.4 + Math.random() * 0.6);
    if (this.onPatternChange) this.onPatternChange();
  }

  // ── Clear channel ──────────────────────────────────────────────
  clearChannel(idx) {
    const ch = this.channels[idx];
    ch.steps.fill(false);
    if (this.onPatternChange) this.onPatternChange();
  }

  // ── Serialize / restore ────────────────────────────────────────
  toJSON() {
    return {
      bpm: this.bpm,
      steps: this.steps,
      channels: this.channels.map(c => ({
        name: c.name,
        color: c.color,
        steps: [...c.steps],
        velocity: [...c.velocity],
        volume: c.volume,
        pan: c.pan,
        muted: c.muted,
        type: c.type,
        notes: [...c.notes],
      })),
    };
  }

  fromJSON(data) {
    this.bpm = data.bpm || 140;
    this.steps = data.steps || 16;
    this.channels = data.channels.map(c => ({
      ...c,
      steps: [...c.steps],
      velocity: [...c.velocity],
      notes: [...(c.notes || [])],
      solo: false,
    }));
    if (this.onPatternChange) this.onPatternChange();
  }

  // ── Add a new channel (e.g. imported audio) ────────────────────
  addChannel(channelData) {
    const defaults = {
      name: 'New Track',
      color: '#ffffff',
      type: 'audio',
      steps: new Array(this.steps).fill(false),
      velocity: new Array(this.steps).fill(1.0),
      volume: 0.9,
      pan: 0,
      muted: false,
      solo: false,
      notes: [],
      filterFreq: 2000,
      filterRes: 1,
      audioBuffer: null,
      sampleFileName: null,
    };
    const ch = { ...defaults, ...channelData };
    // Normalize steps array length
    while (ch.steps.length < this.steps)    ch.steps.push(false);
    while (ch.velocity.length < this.steps) ch.velocity.push(1.0);
    this.channels.push(ch);
    if (this.onPatternChange) this.onPatternChange();
    return this.channels.length - 1;
  }
}

window.Sequencer = Sequencer;
