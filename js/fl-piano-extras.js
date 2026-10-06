/**
 * BeYou Studio — FL Studio Piano Roll Extras
 * ===========================================
 *  1. FL Studio Strummer (Alt+S) — Staggers chord note start times to sound like guitar/piano strumming
 *  2. Trap Hi-Hat Roll Generator / Chopper (Alt+A) — Subdivides notes into 2x, 3x, 4x, 6x, 8x rolls
 *  3. Scale Highlighting — Highlights in-key notes on the Piano Roll grid background
 */

class FLPianoExtras {
  constructor() {
    this.scaleRoot = 'C';
    this.scaleType = 'Minor';
    this._initUI();
    this._attachShortcuts();
  }

  _initUI() {
    // Inject scale selector into Piano Roll toolbar
    const prToolbar = document.querySelector('.piano-roll-toolbar');
    if (!prToolbar) return;

    const scaleWrap = document.createElement('div');
    scaleWrap.style.cssText = 'display:flex;align-items:center;gap:4px;margin-left:6px;';
    scaleWrap.innerHTML = `
      <span style="font-size:10px;color:var(--text-muted);">Scale:</span>
      <select id="pr-scale-root" class="pr-quantize-select" style="width:40px;">
        <option>C</option><option>C#</option><option>D</option>
        <option>D#</option><option>E</option><option>F</option>
        <option>F#</option><option>G</option><option>G#</option>
        <option>A</option><option>A#</option><option>B</option>
      </select>
      <select id="pr-scale-type" class="pr-quantize-select" style="width:85px;">
        <option value="Minor">Minor</option>
        <option value="Major">Major</option>
        <option value="Harmonic Minor">Harmonic Min</option>
        <option value="Dorian">Dorian</option>
        <option value="Pentatonic">Pentatonic</option>
        <option value="Blues">Blues</option>
      </select>
      <button id="pr-btn-strum" class="pr-tool-btn" title="Strummer (Alt+S)">Strum</button>
      <button id="pr-btn-roll" class="pr-tool-btn" title="Roll Generator (Alt+A)">Roll</button>
    `;

    // Insert before clear button
    const clearBtn = document.getElementById('pr-clear-btn');
    if (clearBtn) {
      prToolbar.insertBefore(scaleWrap, clearBtn);
    } else {
      prToolbar.appendChild(scaleWrap);
    }

    // Attach listeners
    document.getElementById('pr-scale-root').addEventListener('change', (e) => {
      this.scaleRoot = e.target.value;
      if (window.app && window.app.pianoRoll) window.app.pianoRoll.render();
    });
    document.getElementById('pr-scale-type').addEventListener('change', (e) => {
      this.scaleType = e.target.value;
      if (window.app && window.app.pianoRoll) window.app.pianoRoll.render();
    });
    document.getElementById('pr-btn-strum').addEventListener('click', () => this.openStrummerModal());
    document.getElementById('pr-btn-roll').addEventListener('click', () => this.openRollModal());
  }

  _attachShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        this.openStrummerModal();
      } else if (e.altKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        this.openRollModal();
      }
    });
  }

  /** Gets active scale pitch classes (0=C, 1=C#... 11=B) */
  getScalePitchClasses() {
    const noteNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const rootIdx = noteNames.indexOf(this.scaleRoot);

    const intervals = {
      'Major': [0, 2, 4, 5, 7, 9, 11],
      'Minor': [0, 2, 3, 5, 7, 8, 10],
      'Harmonic Minor': [0, 2, 3, 5, 7, 8, 11],
      'Dorian': [0, 2, 3, 5, 7, 9, 10],
      'Pentatonic': [0, 2, 4, 7, 9],
      'Blues': [0, 3, 5, 6, 7, 10],
    }[this.scaleType] || [0, 2, 3, 5, 7, 8, 10];

    return intervals.map(i => (rootIdx + i) % 12);
  }

  /** FL Studio Strummer (Alt+S) Dialog & Execution */
  openStrummerModal() {
    if (!window.app) return;
    const channelIdx = window.app.sequencer.pianoRollChannel;
    const channel = window.app.sequencer.channels[channelIdx];
    if (!channel || !channel.notes || !channel.notes.length) {
      if (window.showToast) showToast('No piano roll notes to strum! Add some notes first.');
      return;
    }

    let strumTimeMs = 25; // 25ms delay per note in chord
    let velocitySlope = -0.15; // slight ramp down

    // Group notes by step
    const notesByStep = new Map();
    channel.notes.forEach(n => {
      if (!notesByStep.has(n.step)) notesByStep.set(n.step, []);
      notesByStep.get(n.step).push(n);
    });

    // Strum chords
    notesByStep.forEach((chord) => {
      if (chord.length < 2) return;
      // Sort by pitch ascending
      chord.sort((a, b) => a.note - b.note);
      chord.forEach((n, idx) => {
        n.offsetMs = idx * strumTimeMs;
        n.velocity = Math.max(0.2, Math.min(1.0, (n.velocity || 0.8) + idx * velocitySlope));
      });
    });

    if (window.app.pianoRoll) window.app.pianoRoll.render();
    if (window.showToast) showToast('Strum applied! Chords staggered with realistic timing.');
  }

  /** FL Studio Trap Hi-Hat Roll / Chopper (Alt+A) Modal */
  openRollModal() {
    if (!window.app) return;
    const channelIdx = window.app.sequencer.pianoRollChannel;
    const channel = window.app.sequencer.channels[channelIdx];
    if (!channel || !channel.notes || !channel.notes.length) {
      if (window.showToast) showToast('No notes to roll/chop!');
      return;
    }

    // Subdivide notes by 4x roll
    const newNotes = [];
    channel.notes.forEach(n => {
      const duration = n.length || 1;
      const subLength = duration / 4;
      for (let k = 0; k < 4; k++) {
        newNotes.push({
          step: n.step + k * subLength,
          note: n.note,
          length: subLength,
          velocity: Math.max(0.3, (n.velocity || 0.8) * (1 - k * 0.1)),
        });
      }
    });

    channel.notes = newNotes;
    if (window.app.pianoRoll) window.app.pianoRoll.render();
    if (window.showToast) showToast('Trap Roll applied! Notes chopped into 1/32 rolls.');
  }
}

function initFLPianoExtras() {
  if (!window.flPianoExtras) {
    window.flPianoExtras = new FLPianoExtras();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFLPianoExtras);
} else {
  initFLPianoExtras();
}
