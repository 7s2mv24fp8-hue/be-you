/**
 * BeYou Studio — Max AI Floating Copilot & Writing Portal
 * =========================================================
 * - Draggable anywhere on screen (mouse + touch)
 * - Ultra-responsive AI execution engine (Drums, Bass, Chords, BPM, Mix)
 * - Premium UI writing portal console with real-time DAW feedback
 */

class MaxStudioBuddy {
  constructor() {
    this.portalOpen = false;
    this.widgetEl = null;
    this.bubbleTimer = null;
    this.tipIndex = 0;

    // Drag state
    this.isDown     = false;  // true only while avatar is pressed
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.initialLeft = 0;
    this.initialTop = 0;
    this.hasMoved = false;

    this.tips = [
      "Drag Max anywhere on screen! Touch Max to open the AI Portal.",
      "Pro Tip: Press F4 to open the Graph Editor and tweak per-step pitch & velocity!",
      "Write 'make a 140 BPM trap beat' in the AI Portal to generate drums & bass!",
      "Pro Tip: Use Alt+S in Piano Roll to strum chords like a real guitar!",
      "Pro Tip: Use Alt+A in Piano Roll to split hi-hats into 1/32 trap rolls!",
      "Drag & drop any WAV or MP3 audio file anywhere on screen to import it!",
      "Press F9 or Ctrl+M to open the Mixer and adjust volumes & Parametric EQ!",
    ];

    this._initBuddy();
    this._disableOldAIOptions();
  }

  _disableOldAIOptions() {
    const oldAiBtn = document.getElementById('btn-ai-toggle');
    if (oldAiBtn) oldAiBtn.style.display = 'none';

    const aiTab1 = document.querySelector('[data-tab="ai-music"]');
    const aiTab2 = document.querySelector('[data-tab="ai-producer"]');
    if (aiTab1) aiTab1.style.display = 'none';
    if (aiTab2) aiTab2.style.display = 'none';
  }

  _initBuddy() {
    let container = document.getElementById('max-buddy-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'max-buddy-container';
      container.className = 'max-buddy-container';
      document.body.appendChild(container);
    }

    container.innerHTML = `
      <!-- Speech Bubble floating above Max -->
      <div id="max-speech-bubble" class="max-speech-bubble visible">
        <span id="max-speech-text">Drag Max anywhere on screen! Touch Max to open the AI Portal.</span>
        <button id="max-bubble-close" class="max-bubble-close">✕</button>
      </div>

      <!-- Main Avatar Trigger -->
      <div id="max-buddy-avatar" class="max-buddy-avatar" title="Drag Max anywhere · Touch for AI Portal">
        <!-- 3D Canvas mounted dynamically by Max3DAvatarEngine -->
      </div>

      <!-- Ultra-Premium AI Writing Portal Window -->
      <div id="max-portal-window" class="max-portal-window hidden">
        <div class="max-portal-header">
          <div class="max-portal-title">
            <span class="max-portal-icon-dot"></span>
            <span>MAX AI STUDIO PORTAL</span>
          </div>
          <button id="max-portal-close" class="max-portal-close">✕</button>
        </div>

        <div class="max-portal-body">

          <!-- Live Output Terminal Log -->
          <div id="max-portal-log" class="max-portal-log">
            <div class="max-log-line ai">
              <strong>Max:</strong> Studio AI Online. Write any instruction below (e.g. "make a 140 BPM drill beat", "add sub bass", "auto mix session") or touch a quick action chip.
            </div>
          </div>

          <!-- Quick Action Portal Chips -->
          <div class="max-portal-chips">
            <button class="max-portal-chip" data-action="drums">Generate Drum Beat</button>
            <button class="max-portal-chip" data-action="bass">Add Sub Bassline</button>
            <button class="max-portal-chip" data-action="chords">Strum Piano Chords</button>
            <button class="max-portal-chip" data-action="automix">Auto-Mix Session</button>
            <button class="max-portal-chip" data-action="humanize">Humanize Groove</button>
          </div>

          <!-- Writing Console Input Area -->
          <div class="max-portal-input-area">
            <div class="max-input-header">
              <span class="max-input-label">PROMPT CONSOLE</span>
              <span id="max-prompt-hint" class="max-prompt-hint">Ready for input</span>
            </div>
            <textarea id="max-portal-textarea" class="max-portal-textarea" rows="2" placeholder="Write instruction... e.g. Make a dark trap beat at 140 BPM with heavy 808s"></textarea>
            <button id="max-portal-submit" class="max-portal-submit-btn">EXECUTE COMMAND</button>
          </div>

        </div>
      </div>
    `;

    this.widgetEl = container;
    this._attachEvents();
    this._makeDraggable();
    this._startTipRotation();

    if (typeof Max3DAvatarEngine !== 'undefined') {
      window.max3DAvatarEngine = new Max3DAvatarEngine();
    }
  }

  _attachEvents() {
    const portalClose = document.getElementById('max-portal-close');
    const bubbleClose = document.getElementById('max-bubble-close');
    const submitBtn = document.getElementById('max-portal-submit');
    const textarea = document.getElementById('max-portal-textarea');

    if (portalClose) {
      portalClose.addEventListener('click', () => this.togglePortal(false));
    }

    if (bubbleClose) {
      bubbleClose.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hideSpeechBubble();
      });
    }

    if (submitBtn && textarea) {
      const handleExecute = () => {
        const cmd = textarea.value.trim();
        if (!cmd) return;
        textarea.value = '';
        this.executeWrittenCommand(cmd);
      };

      submitBtn.addEventListener('click', handleExecute);
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleExecute();
        }
      });
    }

    // Portal Action Chips
    const chips = this.widgetEl.querySelectorAll('.max-portal-chip');
    chips.forEach(chip => {
      chip.addEventListener('click', (e) => {
        const action = e.currentTarget.dataset.action;
        this.executeChipAction(action);
      });
    });
  }

  _makeDraggable() {
    const avatar = document.getElementById('max-buddy-avatar');
    if (!avatar || !this.widgetEl) return;

    const onPointerDown = (e) => {
      this.isDown     = true;   // avatar is pressed — allow drag tracking
      this.isDragging = false;  // don't set yet — wait for movement
      this.hasMoved   = false;

      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      this.dragStartX = clientX;
      this.dragStartY = clientY;

      const rect = this.widgetEl.getBoundingClientRect();
      this.initialLeft = rect.left;
      this.initialTop  = rect.top;
    };

    const onPointerMove = (e) => {
      // CRITICAL: only run drag logic when avatar is actually pressed
      if (!this.isDown) return;

      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      const dx = clientX - this.dragStartX;
      const dy = clientY - this.dragStartY;

      // Raised threshold to 8px to absorb natural finger jitter on first touch
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        if (!this.hasMoved) {
          // Confirmed drag — now switch to pixel positioning
          this.hasMoved   = true;
          this.isDragging = true;
          this.widgetEl.style.bottom = 'auto';
          this.widgetEl.style.right  = 'auto';
          this.widgetEl.style.left   = `${this.initialLeft}px`;
          this.widgetEl.style.top    = `${this.initialTop}px`;
        }
      }

      if (!this.isDragging) return;

      // Constrain within viewport bounds
      const maxL = window.innerWidth - 90;
      const maxT = window.innerHeight - 90;
      const newL = Math.max(10, Math.min(maxL, this.initialLeft + dx));
      const newT = Math.max(10, Math.min(maxT, this.initialTop + dy));

      this.widgetEl.style.left = `${newL}px`;
      this.widgetEl.style.top  = `${newT}px`;
    };

    const onPointerUp = () => {
      if (!this.isDown) return;   // ignore spurious global mouseup events
      this.isDown     = false;    // release the gate
      this.isDragging = false;

      // If user did NOT move/drag Max, treat as a TOUCH / CLICK → toggle portal!
      if (!this.hasMoved) {
        this.togglePortal();
      }

      this.hasMoved = false;
    };

    avatar.addEventListener('mousedown', onPointerDown);
    avatar.addEventListener('touchstart', onPointerDown, { passive: true });

    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('touchmove', onPointerMove, { passive: true });

    window.addEventListener('mouseup', onPointerUp);
    window.addEventListener('touchend', onPointerUp);
  }

  togglePortal(show = null) {
    this.portalOpen = (show !== null) ? show : !this.portalOpen;
    const portalWin = document.getElementById('max-portal-window');
    if (portalWin) {
      portalWin.classList.toggle('hidden', !this.portalOpen);
      if (this.portalOpen) {
        const textarea = document.getElementById('max-portal-textarea');
        if (textarea) setTimeout(() => textarea.focus(), 100);
      }
    }
  }

  speak(text, durationMs = 6000) {
    const bubble = document.getElementById('max-speech-bubble');
    const speechText = document.getElementById('max-speech-text');
    if (bubble && speechText) {
      speechText.textContent = text;
      bubble.classList.remove('hidden');
      bubble.classList.add('visible');

      clearTimeout(this.bubbleTimer);
      this.bubbleTimer = setTimeout(() => {
        this.hideSpeechBubble();
      }, durationMs);
    }
  }

  hideSpeechBubble() {
    const bubble = document.getElementById('max-speech-bubble');
    if (bubble) bubble.classList.add('hidden');
  }

  logPortalMessage(sender, message) {
    const logEl = document.getElementById('max-portal-log');
    if (!logEl) return;

    const line = document.createElement('div');
    line.className = `max-log-line ${sender.toLowerCase()}`;
    line.innerHTML = `<strong>${sender}:</strong> ${message}`;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  _ensureEngineReady() {
    if (!window.app || !window.app.sequencer) {
      if (typeof window.bootstrapFLStudioApp === 'function') {
        window.bootstrapFLStudioApp();
      } else if (typeof FLStudioApp !== 'undefined') {
        window.app = new FLStudioApp();
      }
    }
    if (window.app && window.app.audioEngine) {
      if (!window.app.audioEngine.initialized) {
        window.app.audioEngine.init();
      }
      if (window.app.audioEngine.ctx && window.app.audioEngine.ctx.state === 'suspended') {
        window.app.audioEngine.ctx.resume();
      }
    }
    return !!(window.app && window.app.sequencer);
  }

  executeWrittenCommand(cmdText) {
    this.logPortalMessage('You', cmdText);

    if (!this._ensureEngineReady()) {
      this.logPortalMessage('Max', 'DAW engine ready now! Executing command...');
    }

    const app = window.app;
    const seq = app.sequencer;
    const lower = cmdText.toLowerCase();

    // Play feedback chime
    if (app.audioEngine && app.audioEngine.playChime) {
      app.audioEngine.playChime(true);
    }

    let responseMsg = '';

    // 1. BPM / Tempo command
    const bpmMatch = lower.match(/(?:bpm|tempo)\s*(\d{2,3})|(\d{2,3})\s*(?:bpm|tempo)/);
    if (bpmMatch) {
      const newBpm = parseInt(bpmMatch[1] || bpmMatch[2], 10);
      if (newBpm >= 40 && newBpm <= 280) {
        seq.bpm = newBpm;
        const bpmDisplay = document.getElementById('bpm-display');
        if (bpmDisplay) bpmDisplay.value = newBpm;
        responseMsg += `Set project tempo to ${newBpm} BPM. `;
      }
    }

    // 2. Transport Commands (Play, Stop)
    if (lower.includes('play') || lower.includes('start') || lower.includes('audition') || lower.includes('listen')) {
      if (!seq.isPlaying) seq.play();
      responseMsg += `Started sequencer playback. `;
    } else if (lower.includes('stop') || lower.includes('pause')) {
      if (seq.isPlaying) seq.stop();
      responseMsg += `Stopped playback. `;
    }

    // 3. View / Tab switching
    if (lower.includes('open mixer') || lower.includes('show mixer')) {
      app._switchTab('mixer');
      responseMsg += `Opened Mixer window. `;
    } else if (lower.includes('open editor') || lower.includes('audio editor') || lower.includes('edison')) {
      app._switchTab('audio-editor');
      responseMsg += `Opened Audio Editor & Layer Studio. `;
    } else if (lower.includes('open piano') || lower.includes('piano roll')) {
      app._switchTab('piano-roll');
      responseMsg += `Opened Piano Roll. `;
    } else if (lower.includes('open eq') || lower.includes('parametric eq') || lower.includes('fruity eq')) {
      app._switchTab('mixer');
      if (window.flParametricEQ) window.flParametricEQ.openFloating();
      responseMsg += `Opened Fruity Parametric EQ 2. `;
    } else if (lower.includes('soundgoodizer') || lower.includes('maximizer')) {
      if (window.flSoundgoodizer) {
        window.flSoundgoodizer.open();
        window.flSoundgoodizer.setAmount(0.65);
      }
      responseMsg += `Activated Soundgoodizer at 65% on Master Bus! `;
    }

    // 4. Genre Beat Generation
    if (lower.includes('drill')) {
      seq.bpm = 142;
      seq.channels[0].steps = [true, false, false, false, false, false, true, false, true, false, false, false, false, false, true, false]; // Kick
      seq.channels[1].steps = [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false]; // Clap
      seq.channels[2].steps = [true, false, true, true, false, true, true, false, true, false, true, true, false, true, true, false]; // Sliding hats
      seq.channels[6].steps = [true, false, false, true, false, false, true, false, false, true, false, false, true, false, false, false]; // 808
      responseMsg += `Generated UK/NY Drill beat at 142 BPM with sliding 808s and syncopated snare. `;
    } else if (lower.includes('trap')) {
      seq.bpm = 140;
      seq.channels[0].steps = [true, false, false, false, false, false, true, false, false, false, true, false, false, false, false, false];
      seq.channels[1].steps = [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false];
      seq.channels[2].steps = [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true];
      seq.channels[6].steps = [true, false, false, false, true, false, false, false, false, false, true, false, false, false, true, false];
      responseMsg += `Injected Hard Trap beat at 140 BPM with rolling hi-hats & heavy 808 sub. `;
    } else if (lower.includes('lofi') || lower.includes('chill') || lower.includes('lo-fi')) {
      seq.bpm = 84;
      seq.channels[0].steps = [true, false, false, false, false, false, true, false, false, false, false, false, false, false, true, false];
      seq.channels[4].steps = [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false];
      seq.channels[2].steps = [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false];
      seq.channels[6].steps = [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false];
      responseMsg += `Created relaxed Lo-Fi groove at 84 BPM with swung hats and warm sub bass. `;
    } else if (lower.includes('house') || lower.includes('techno') || lower.includes('4/4') || lower.includes('four on the floor')) {
      seq.bpm = 126;
      seq.channels[0].steps = [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false];
      seq.channels[1].steps = [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false];
      seq.channels[3].steps = [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false];
      seq.channels[6].steps = [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false];
      responseMsg += `Created driving 4/4 Club House groove at 126 BPM with offbeat open hats. `;
    } else if (lower.includes('afro') || lower.includes('afrobeats')) {
      seq.bpm = 104;
      seq.channels[0].steps = [true, false, false, true, false, false, true, false, false, true, false, false, true, false, false, false];
      seq.channels[1].steps = [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false];
      seq.channels[5].steps = [false, false, true, false, false, true, false, false, true, false, false, true, false, false, true, false];
      responseMsg += `Generated rhythmic Afrobeats polyrhythm at 104 BPM with percussion bounce. `;
    } else if (lower.includes('chord') || lower.includes('piano') || lower.includes('strum')) {
      if (window.flPianoExtras) window.flPianoExtras.openStrummerModal();
      responseMsg += `Applied Piano Roll Chord Strummer with natural humanized velocity! `;
    } else if (lower.includes('bass') || lower.includes('808')) {
      const bassCh = seq.channels[6] || seq.channels[0];
      bassCh.steps = [true, false, false, true, false, false, true, false, true, false, false, true, false, false, true, false];
      responseMsg += `Programmed heavy sub bassline on Channel 7! `;
    } else if (lower.includes('roll') || lower.includes('hat roll')) {
      if (window.flPianoExtras) window.flPianoExtras.openRollModal();
      responseMsg += `Generated trap 1/32 hi-hat rolls! `;
    } else if (lower.includes('automix') || lower.includes('mix')) {
      seq.channels.forEach((ch, idx) => {
        ch.volume = 0.75 + (idx % 3) * 0.08;
        ch.pan = (idx % 2 === 0 ? -0.15 : 0.15);
      });
      responseMsg += `Auto-mixed session: Balanced levels, stereo panned channels, and optimized headroom. `;
    } else if (lower.includes('humanize')) {
      seq.channels.forEach(ch => {
        if (ch.velocity) {
          ch.velocity = ch.velocity.map(v => Math.max(0.35, Math.min(1.0, v + (Math.random() * 0.2 - 0.1))));
        }
      });
      responseMsg += `Humanized groove: injected subtle velocity dynamics across all channels. `;
    } else if (lower.includes('clear') || lower.includes('reset')) {
      seq.channels.forEach(ch => { ch.steps = Array(16).fill(false); });
      responseMsg += `Cleared all channel patterns. Ready for new composition. `;
    } else {
      // General groove generation
      if (typeof window.sequencerRandomizeAll === 'function') {
        window.sequencerRandomizeAll();
      } else {
        seq.channels.forEach((_, i) => seq.randomizeChannel(i));
      }
      responseMsg += `Injected custom groove & rhythm pattern into your Channel Rack. `;
    }

    // Refresh UI
    if (app._refreshChannelRack) app._refreshChannelRack();
    const bpmDisplay = document.getElementById('bpm-display');
    if (bpmDisplay) bpmDisplay.value = seq.bpm;

    this.logPortalMessage('Max', responseMsg || 'Command executed successfully!');
    this.speak(responseMsg || 'Command executed!', 5000);
  }

  executeChipAction(action) {
    if (!this._ensureEngineReady()) return;
    const app = window.app;
    const seq = app.sequencer;

    if (app.audioEngine && app.audioEngine.playChime) {
      app.audioEngine.playChime(true);
    }

    if (action === 'drums') {
      if (typeof window.sequencerRandomizeAll === 'function') {
        window.sequencerRandomizeAll();
      } else {
        seq.channels.forEach((_, i) => seq.randomizeChannel(i));
      }
      if (app._refreshChannelRack) app._refreshChannelRack();
      this.logPortalMessage('Max', 'Generated fresh drum pattern across Kick, Clap, Hi-Hats & Snare!');
      this.speak('Fresh drum beat generated in Channel Rack!', 4500);
    } else if (action === 'bass') {
      const bassCh = seq.channels[6] || seq.channels[0];
      bassCh.steps = [true, false, false, true, false, false, true, false, true, false, false, true, false, false, true, false];
      if (app._refreshChannelRack) app._refreshChannelRack();
      this.logPortalMessage('Max', 'Injected rolling 808 sub bassline on Channel 7!');
      this.speak('Sub bassline pattern added!', 4500);
    } else if (action === 'chords') {
      if (window.flPianoExtras) window.flPianoExtras.openStrummerModal();
      this.logPortalMessage('Max', 'Strummed Piano Roll chords with realistic timing dynamics!');
      this.speak('Strummed Piano Roll chords ready!', 4500);
    } else if (action === 'automix') {
      seq.channels.forEach((ch, idx) => {
        ch.volume = 0.75 + (idx % 3) * 0.08;
        ch.pan = (idx % 2 === 0 ? -0.15 : 0.15);
      });
      if (app._refreshChannelRack) app._refreshChannelRack();
      this.logPortalMessage('Max', 'Auto-mixed session: Balanced gain levels and stereo panned channels.');
      this.speak('Session auto-mixed!', 4500);
    } else if (action === 'humanize') {
      seq.channels.forEach(ch => {
        if (ch.velocity) {
          ch.velocity = ch.velocity.map(v => Math.max(0.35, Math.min(1.0, v + (Math.random() * 0.2 - 0.1))));
        }
      });
      if (app._refreshChannelRack) app._refreshChannelRack();
      this.logPortalMessage('Max', 'Humanized pattern! Applied subtle per-step velocity dynamics.');
      this.speak('Groove humanized with natural velocity!', 4500);
    }
  }

  _startTipRotation() {
    setInterval(() => {
      if (!this.portalOpen) {
        this.tipIndex = (this.tipIndex + 1) % this.tips.length;
        this.speak(this.tips[this.tipIndex], 5000);
      }
    }, 25000);
  }
}

function initMaxStudioBuddy() {
  if (!window.maxStudioBuddy) {
    window.maxStudioBuddy = new MaxStudioBuddy();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMaxStudioBuddy);
} else {
  initMaxStudioBuddy();
}

window.MaxStudioBuddy = MaxStudioBuddy;
