/**
 * FL Studio Clone — AI Music Generator (Hugging Face MusicGen)
 *
 * Three components:
 *  1. HuggingFaceMusic  — API client for MusicGen inference
 *  2. PromptBuilder     — context-aware prompt generation from DAW state
 *  3. MusicAI           — orchestrator exposing high-level API
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const MUSICGEN_MODELS = {
  small:  'facebook/musicgen-small',
  medium: 'facebook/musicgen-medium',
};

const GENRE_PROMPT_MAP = {
  'Hip-Hop':    'hip-hop beat, boom bap drums, deep bass, vinyl crackle',
  'Trap':       'trap beat, 808 bass, rapid hi-hats, dark synths',
  'House':      'house music, four-on-the-floor kick, offbeat hi-hats, deep bass',
  'Drum & Bass':'drum and bass, breakbeat, fast tempo, rolling bass',
  'Reggaeton':  'reggaeton dembow rhythm, latin percussion, bass',
  'Afrobeats':  'afrobeats, african percussion, groovy bass, rhythmic',
  'Lo-Fi':      'lo-fi hip hop, mellow piano, vinyl crackle, chill, relaxing',
  'Electronic': 'electronic music, synthesizers, pulsing bass, arpeggios',
  'Classical':  'classical composition, elegant piano, orchestral harmony, expressive dynamics',
  'Soundtrack': 'cinematic soundtrack, emotional strings, felt piano, dramatic build',
  'Piano':      'pure felt piano solo, gentle intimate acoustics, modern classical, warm room',
  'Custom':     'instrumental beat, rhythmic, musical',
  'Unknown':    'instrumental beat, rhythmic percussion, bass',
};

const MOOD_TAGS = [
  'energetic', 'chill', 'dark', 'uplifting', 'melancholic', 'aggressive',
  'dreamy', 'groovy', 'atmospheric', 'funky', 'epic', 'minimal',
  'peaceful', 'hopeful', 'romantic', 'dramatic', 'mysterious', 'nostalgic',
  'playful', 'empowering', 'reflective', 'happy', 'tense'
];

const INSTRUMENT_TAGS = [
  'piano', 'guitar', 'synth', 'strings', 'brass', 'flute', 'organ',
  'bells', 'pad', 'pluck', 'saxophone', 'violin',
];

// ─────────────────────────────────────────────────────────────────────────────
// 1. MUSIC AUDIO CLIENTS (BeYou Built-in, Local Server & Hugging Face Cloud)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * High-performance, client-side procedural multi-track audio synthesizer.
 * Runs 100% offline in pure JavaScript via 16-bit PCM WAV rendering.
 * Provides instant generation (<100ms) with zero API keys or local servers needed.
 */
class BrowserMusicGenerator {
  constructor(sampleRate = 32000) {
    this.sampleRate = sampleRate;
    this._abortCtrl = null;
  }

  static parsePromptIntent(prompt, currentBpm = 120) {
    const p = (prompt || '').toLowerCase();
    const bpmMatch = p.match(/(\d{2,3})\s*(?:bpm|tempo)/);
    const explicitBpm = bpmMatch ? parseInt(bpmMatch[1], 10) : null;

    // Deterministic hash of prompt for consistent, distinct variety
    let seed = 0;
    const cleanPrompt = (prompt || 'music beat').trim().toLowerCase();
    for (let i = 0; i < cleanPrompt.length; i++) {
      seed = ((seed << 5) - seed) + cleanPrompt.charCodeAt(i);
      seed |= 0;
    }
    const promptHash = Math.abs(seed) || 12345;

    let genre = 'lofi';
    if (/(drill|uk drill|ny drill)/.test(p)) genre = 'drill';
    else if (/(trap|808|metro|banger|dark beat)/.test(p)) genre = 'trap';
    else if (/(phonk|drift|cowbell|memphis)/.test(p)) genre = 'phonk';
    else if (/(synthwave|retrowave|80s|outrun|neon)/.test(p)) genre = 'synthwave';
    else if (/(techno|acid|industrial|rave|berlin)/.test(p)) genre = 'techno';
    else if (/(dnb|drum and bass|breakbeat|jungle|liquid)/.test(p)) genre = 'dnb';
    else if (/(house|deep house|tech house|club|dance|edm)/.test(p)) genre = 'house';
    else if (/(reggaeton|dembow|latin)/.test(p)) genre = 'reggaeton';
    else if (/(afrobeats|afro|amapiano)/.test(p)) genre = 'afrobeats';
    else if (/(classical|mozart|liszt|orchestral|symphony|allegro)/.test(p)) genre = 'classical';
    else if (/(soundtrack|cinematic|film score|epic score)/.test(p)) genre = 'soundtrack';
    else if (/(felt piano|pure felt|soft piano|romantic piano)/.test(p)) genre = 'piano';
    else if (/(minimalism|minimalist|chamber|contemporary classical)/.test(p)) genre = 'minimalism';
    else if (/(ambient|space|meditation|calm|relaxing|drone|ethereal|new age)/.test(p)) genre = 'ambient';
    else if (/(acoustic|guitar|folk)/.test(p)) genre = 'acoustic';
    else if (/(piano)/.test(p)) genre = 'piano';
    else if (/(lo-fi|lofi|chill|study|mellow|jazz)/.test(p)) genre = 'lofi';
    else if (/(hip hop|hip-hop|boom bap|rap)/.test(p)) genre = 'lofi';

    // Rhythmic density conditioning
    let rhythmicDensity = 0.50;
    if (/(sparse|minimal|slow|space|chill|ambient|peaceful)/.test(p)) rhythmicDensity = 0.25;
    else if (/(dense|busy|fast|intense|complex|rolls|crazy|heavy)/.test(p)) rhythmicDensity = 0.85;

    // Generational settings: increased temperature, nucleus top-p, repetition penalty
    const temperature = 1.15;
    const topP = 0.90;
    const repetitionPenalty = 1.35;
    let instrument = 'synth';
    if (/(flute|pipe|whistle|wind)/.test(p)) instrument = 'flute';
    else if (/(guitar|acoustic|pluck|fingerstyle|folk)/.test(p)) instrument = 'guitar';
    else if (/(piano|rhodes|felt piano|keys|grand piano)/.test(p)) instrument = 'piano';
    else if (/(strings|violin|cello|orchestra|orchestral|symphony)/.test(p)) instrument = 'strings';
    else if (/(brass|horn|trumpet|saw lead|lead synth)/.test(p)) instrument = 'brass';
    else if (/(bell|glockenspiel|celesta|music box|vibes)/.test(p)) instrument = 'bell';
    else if (['trap', 'drill', 'phonk'].includes(genre)) instrument = '808_synth';
    else if (['lofi', 'piano', 'acoustic'].includes(genre)) instrument = 'piano';
    else if (['synthwave', 'techno', 'house'].includes(genre)) instrument = 'synth';

    // Lead melody style detection
    let leadStyle = 'lyrical';
    if (/(arp|arpeggio|arpeggiated|fast run|rolling|trance)/.test(p)) leadStyle = 'arpeggio';
    else if (/(staccato|stab|riff|chops|bounce|syncopated)/.test(p)) leadStyle = 'staccato';
    else if (/(ambient|swell|drone|pad|space|calm|meditation)/.test(p)) leadStyle = 'ambient_swell';
    else if (/(melody|solo|emotional|vocal|hook|lyrical|singing)/.test(p)) leadStyle = 'lyrical';
    else {
      const styles = ['lyrical', 'arpeggio', 'staccato'];
      leadStyle = styles[promptHash % styles.length];
    }

    const GENRES = {
      lofi: {
        bpm: 78,
        progressions: [
          [[50, 53, 57, 60, 64], [45, 48, 52, 55, 59], [48, 52, 55, 59, 62], [43, 47, 50, 53, 57]], // Dm9 - Am9 - Cmaj9 - G7
          [[48, 52, 55, 59, 62], [45, 48, 52, 55, 59], [41, 45, 48, 52, 55], [43, 47, 50, 53, 57]], // Cmaj9 - Am7 - Fmaj7 - G9
          [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [45, 48, 52, 55]],             // Fmaj7 - Em7 - Dm7 - Am7
          [[45, 48, 52, 55, 59], [50, 53, 57, 60], [43, 47, 50, 55], [48, 52, 55, 59]]            // Am9 - Dm7 - Gsus - Cmaj7
        ],
        chords: [[50, 53, 57, 60, 64], [45, 48, 52, 55, 59], [48, 52, 55, 59, 62], [43, 47, 50, 53, 57]],
        kick:  [1, 0, 0, 0,  0, 0, 1, 0,  0, 1, 0, 0,  0, 0, 0, 0],
        snare: [0, 0, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0,  1, 0, 0, 0],
        hihat: [1, 0, 1, 0,  1, 0, 1, 0,  1, 0, 1, 0,  1, 0, 1, 0],
        vinylNoise: 0.035,
        bassType: 'sub_warm',
      },
      trap: {
        bpm: 140,
        progressions: [
          [[48, 51, 55], [44, 48, 51], [46, 50, 53], [43, 47, 50]], // Cm - Ab - Bb - Gm
          [[48, 51, 55], [49, 53, 56], [48, 51, 55], [46, 50, 53]], // Cm - Db - Cm - Bb (Phrygian Dark)
          [[48, 51, 55], [44, 48, 51], [41, 44, 48], [43, 47, 50]], // Cm - Ab - Fm - G
          [[45, 48, 52], [41, 45, 48], [43, 47, 50], [40, 43, 47]]  // Am - F - G - Em (Melodic Trap)
        ],
        chords: [[48, 51, 55], [44, 48, 51], [46, 50, 53], [43, 47, 50]],
        kick:  [1, 0, 0, 0,  0, 0, 0, 0,  1, 0, 1, 0,  0, 0, 0, 0],
        snare: [0, 0, 0, 0,  0, 0, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0],
        hihat: [1, 1, 1, 1,  1, 1, 1, 1,  1, 1, 1, 1,  1, 1, 1, 1],
        vinylNoise: 0.0,
        bassType: '808_glide',
      },
      drill: {
        bpm: 142,
        progressions: [
          [[41, 44, 48], [42, 46, 49], [41, 44, 48], [40, 43, 47]], // Fm - F# - Fm - Em
          [[45, 48, 52], [46, 50, 53], [45, 48, 52], [43, 47, 50]], // Am - Bb - Am - Gm
          [[41, 44, 48], [44, 48, 51], [42, 46, 49], [41, 44, 48]], // Fm - Ab - F# - Fm
          [[38, 41, 45], [40, 43, 47], [38, 41, 45], [37, 40, 44]]  // Dm - Em - Dm - C#m
        ],
        chords: [[41, 44, 48], [42, 46, 49], [41, 44, 48], [40, 43, 47]],
        kick:  [1, 0, 0, 0,  0, 0, 1, 0,  0, 0, 1, 0,  0, 0, 0, 0],
        snare: [0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 1, 0,  0, 0, 0, 0],
        hihat: [1, 0, 1, 1,  1, 0, 1, 1,  1, 0, 1, 1,  1, 1, 1, 1],
        vinylNoise: 0.0,
        bassType: '808_slide_distorted',
      },
      synthwave: {
        bpm: 122,
        progressions: [
          [[45, 48, 52], [41, 45, 48], [43, 47, 50], [40, 43, 47]], // Am - F - G - Em
          [[41, 45, 48], [43, 47, 50], [45, 48, 52], [48, 52, 55]], // F - G - Am - C
          [[45, 48, 52], [48, 52, 55], [43, 47, 50], [41, 45, 48]], // Am - C - G - F
          [[40, 43, 47], [41, 45, 48], [43, 47, 50], [45, 48, 52]]  // Em - F - G - Am
        ],
        chords: [[45, 48, 52], [41, 45, 48], [43, 47, 50], [40, 43, 47]],
        kick:  [1, 0, 0, 0,  1, 0, 0, 0,  1, 0, 0, 0,  1, 0, 0, 0],
        snare: [0, 0, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0,  1, 0, 0, 0],
        hihat: [0, 0, 1, 0,  0, 0, 1, 0,  0, 0, 1, 0,  0, 0, 1, 0],
        vinylNoise: 0.0,
        bassType: 'rolling_saw_arp',
      },
      house: {
        bpm: 126,
        progressions: [
          [[43, 46, 50, 53], [41, 45, 48, 52], [38, 41, 45, 48], [43, 46, 50, 53]],
          [[48, 52, 55, 59], [45, 48, 52, 55], [41, 45, 48, 52], [43, 47, 50, 53]],
          [[40, 43, 47, 50], [45, 48, 52, 55], [41, 45, 48, 52], [43, 47, 50, 53]],
          [[45, 48, 52, 55], [43, 46, 50, 53], [41, 45, 48, 52], [40, 43, 47, 50]]
        ],
        chords: [[43, 46, 50, 53], [41, 45, 48, 52], [38, 41, 45, 48], [43, 46, 50, 53]],
        kick:  [1, 0, 0, 0,  1, 0, 0, 0,  1, 0, 0, 0,  1, 0, 0, 0],
        snare: [0, 0, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0,  1, 0, 0, 0],
        hihat: [0, 0, 1, 0,  0, 0, 1, 0,  0, 0, 1, 0,  0, 0, 1, 0],
        vinylNoise: 0.0,
        bassType: 'bouncy_organ',
      },
      techno: {
        bpm: 135,
        progressions: [
          [[41, 44, 48], [41, 44, 48], [42, 45, 49], [41, 44, 48]],
          [[36, 40, 43], [36, 40, 43], [38, 41, 45], [36, 40, 43]],
          [[43, 46, 50], [42, 45, 49], [43, 46, 50], [45, 48, 52]],
          [[40, 43, 47], [40, 43, 47], [41, 44, 48], [40, 43, 47]]
        ],
        chords: [[41, 44, 48], [41, 44, 48], [42, 45, 49], [41, 44, 48]],
        kick:  [1, 0, 0, 0,  1, 0, 0, 0,  1, 0, 0, 0,  1, 0, 0, 0],
        snare: [0, 0, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0,  1, 0, 0, 0],
        hihat: [1, 0, 1, 0,  1, 0, 1, 0,  1, 0, 1, 0,  1, 0, 1, 0],
        vinylNoise: 0.0,
        bassType: 'acid_resonant',
      },
      dnb: {
        bpm: 174,
        progressions: [
          [[40, 43, 47], [36, 40, 43], [38, 41, 45], [35, 39, 42]],
          [[45, 48, 52], [41, 45, 48], [43, 47, 50], [40, 43, 47]],
          [[38, 41, 45], [36, 40, 43], [40, 43, 47], [41, 45, 48]],
          [[43, 47, 50], [40, 43, 47], [36, 40, 43], [38, 41, 45]]
        ],
        chords: [[40, 43, 47], [36, 40, 43], [38, 41, 45], [35, 39, 42]],
        kick:  [1, 0, 0, 0,  0, 0, 0, 0,  0, 0, 1, 0,  0, 0, 0, 0],
        snare: [0, 0, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0,  1, 0, 0, 0],
        hihat: [1, 1, 1, 1,  1, 1, 1, 1,  1, 1, 1, 1,  1, 1, 1, 1],
        vinylNoise: 0.0,
        bassType: 'reese_lfo',
      },
      reggaeton: {
        bpm: 96,
        progressions: [
          [[45, 48, 52], [41, 45, 48], [43, 47, 50], [45, 48, 52]],
          [[48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50]],
          [[43, 47, 50], [40, 43, 47], [36, 40, 43], [38, 42, 45]],
          [[41, 45, 48], [43, 47, 50], [45, 48, 52], [40, 43, 47]]
        ],
        chords: [[45, 48, 52], [41, 45, 48], [43, 47, 50], [45, 48, 52]],
        kick:  [1, 0, 0, 0,  1, 0, 0, 0,  1, 0, 0, 0,  1, 0, 0, 0],
        snare: [0, 0, 0, 1,  0, 0, 1, 0,  0, 0, 0, 1,  0, 0, 1, 0],
        hihat: [1, 0, 1, 0,  1, 0, 1, 0,  1, 0, 1, 0,  1, 0, 1, 0],
        vinylNoise: 0.0,
        bassType: 'sub_deep',
      },
      afrobeats: {
        bpm: 106,
        progressions: [
          [[43, 47, 50], [40, 43, 47], [36, 40, 43], [38, 42, 45]],
          [[48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50]],
          [[45, 48, 52], [43, 47, 50], [41, 45, 48], [43, 47, 50]],
          [[40, 43, 47], [43, 47, 50], [36, 40, 43], [38, 42, 45]]
        ],
        chords: [[43, 47, 50], [40, 43, 47], [36, 40, 43], [38, 42, 45]],
        kick:  [1, 0, 0, 0,  0, 0, 1, 0,  0, 0, 0, 0,  1, 0, 0, 0],
        snare: [0, 0, 0, 1,  0, 0, 1, 0,  0, 1, 0, 0,  0, 0, 1, 0],
        hihat: [1, 0, 1, 1,  0, 1, 1, 0,  1, 0, 1, 1,  0, 1, 1, 0],
        vinylNoise: 0.0,
        bassType: 'warm_pluck',
      },
      phonk: {
        bpm: 148,
        progressions: [
          [[49, 52, 56], [50, 53, 57], [49, 52, 56], [45, 48, 52]],
          [[46, 49, 53], [47, 50, 54], [46, 49, 53], [42, 45, 49]],
          [[42, 45, 49], [43, 46, 50], [42, 45, 49], [38, 41, 45]],
          [[50, 53, 57], [49, 52, 56], [46, 49, 53], [45, 48, 52]]
        ],
        chords: [[49, 52, 56], [50, 53, 57], [49, 52, 56], [45, 48, 52]],
        kick:  [1, 0, 0, 0,  0, 0, 0, 0,  1, 0, 1, 0,  0, 0, 0, 0],
        snare: [0, 0, 0, 0,  0, 0, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0],
        hihat: [1, 1, 1, 1,  1, 1, 1, 1,  1, 1, 1, 1,  1, 1, 1, 1],
        vinylNoise: 0.02,
        bassType: 'saturated_808',
      },
      ambient: {
        bpm: 72,
        progressions: [
          [[41, 45, 48, 52], [43, 47, 50, 53], [40, 43, 47, 50], [45, 48, 52, 55]],
          [[48, 52, 55, 62], [45, 48, 52, 59], [41, 45, 48, 55], [43, 47, 50, 57]],
          [[50, 53, 57, 64], [46, 50, 53, 60], [48, 52, 55, 62], [43, 47, 50, 57]],
          [[45, 48, 52, 59], [40, 43, 47, 55], [41, 45, 48, 55], [43, 47, 50, 57]]
        ],
        chords: [[41, 45, 48, 52], [43, 47, 50, 53], [40, 43, 47, 50], [45, 48, 52, 55]],
        kick:  [1, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0],
        snare: [0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0],
        hihat: [0, 0, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0,  1, 0, 0, 0],
        vinylNoise: 0.015,
        bassType: 'deep_sub_swell',
      },
      acoustic: {
        bpm: 90,
        progressions: [
          [[43, 47, 50], [40, 43, 47], [36, 40, 43], [38, 42, 45]],
          [[48, 52, 55], [43, 47, 50], [45, 48, 52], [41, 45, 48]],
          [[45, 48, 52], [41, 45, 48], [48, 52, 55], [43, 47, 50]],
          [[36, 40, 43], [38, 42, 45], [40, 43, 47], [43, 47, 50]]
        ],
        chords: [[43, 47, 50], [40, 43, 47], [36, 40, 43], [38, 42, 45]],
        kick:  [1, 0, 0, 0,  0, 0, 1, 0,  0, 0, 0, 0,  1, 0, 0, 0],
        snare: [0, 0, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0,  1, 0, 0, 0],
        hihat: [1, 0, 1, 0,  1, 0, 1, 0,  1, 0, 1, 0,  1, 0, 1, 0],
        vinylNoise: 0.01,
        bassType: 'sub_warm',
      },
      piano: {
        bpm: 84,
        progressions: [
          [[48, 55, 60, 64, 67], [45, 52, 57, 60, 64], [41, 48, 53, 57, 60], [43, 50, 55, 59, 62]],
          [[45, 52, 57, 60, 64], [41, 48, 53, 57, 60], [48, 55, 60, 64, 67], [43, 50, 55, 59, 62]],
          [[41, 48, 53, 57, 60], [43, 50, 55, 59, 62], [45, 52, 57, 60, 64], [40, 47, 52, 55, 59]],
          [[50, 57, 62, 65, 69], [45, 52, 57, 60, 64], [43, 50, 55, 59, 62], [48, 55, 60, 64, 67]]
        ],
        chords: [[48, 55, 60, 64, 67], [45, 52, 57, 60, 64], [41, 48, 53, 57, 60], [43, 50, 55, 59, 62]],
        kick:  [0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0],
        snare: [0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0],
        hihat: [0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0],
        vinylNoise: 0.006,
        bassType: 'sub_warm',
      },
      classical: {
        bpm: 118,
        progressions: [
          [[43, 50, 55, 58, 62], [41, 48, 53, 57, 60], [40, 46, 52, 55, 58], [43, 50, 55, 59, 62]],
          [[48, 55, 60, 63, 67], [45, 52, 57, 60, 64], [46, 53, 58, 62, 65], [43, 50, 55, 59, 62]],
          [[45, 52, 57, 60, 64], [41, 48, 53, 57, 60], [43, 50, 55, 59, 62], [40, 47, 52, 55, 59]],
          [[38, 45, 50, 53, 57], [43, 50, 55, 58, 62], [41, 48, 53, 57, 60], [40, 46, 52, 55, 58]]
        ],
        chords: [[43, 50, 55, 58, 62], [41, 48, 53, 57, 60], [40, 46, 52, 55, 58], [43, 50, 55, 59, 62]],
        kick:  [1, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0],
        snare: [0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0],
        hihat: [0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0],
        vinylNoise: 0.005,
        bassType: 'sub_warm',
      },
      soundtrack: {
        bpm: 84,
        progressions: [
          [[41, 48, 53, 57, 60], [45, 52, 57, 60, 64], [43, 50, 55, 59, 62], [40, 47, 52, 55, 59]],
          [[45, 52, 57, 60, 64], [41, 48, 53, 57, 60], [48, 55, 60, 64, 67], [43, 50, 55, 59, 62]],
          [[40, 47, 52, 55, 59], [41, 48, 53, 57, 60], [45, 52, 57, 60, 64], [43, 50, 55, 59, 62]],
          [[38, 45, 50, 53, 57], [41, 48, 53, 57, 60], [43, 50, 55, 59, 62], [45, 52, 57, 60, 64]]
        ],
        chords: [[41, 48, 53, 57, 60], [45, 52, 57, 60, 64], [43, 50, 55, 59, 62], [40, 47, 52, 55, 59]],
        kick:  [1, 0, 0, 0,  0, 0, 0, 0,  0, 0, 1, 0,  0, 0, 0, 0],
        snare: [0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0],
        hihat: [0, 0, 1, 0,  0, 0, 1, 0,  0, 0, 1, 0,  0, 0, 1, 0],
        vinylNoise: 0.008,
        bassType: 'deep_sub_swell',
      },
      minimalism: {
        bpm: 108,
        progressions: [
          [[45, 52, 57, 60, 64], [41, 48, 53, 57, 60], [45, 52, 57, 60, 64], [43, 50, 55, 59, 62]],
          [[48, 55, 60, 64, 67], [45, 52, 57, 60, 64], [48, 55, 60, 64, 67], [43, 50, 55, 59, 62]],
          [[41, 48, 53, 57, 60], [45, 52, 57, 60, 64], [41, 48, 53, 57, 60], [43, 50, 55, 59, 62]],
          [[40, 47, 52, 55, 59], [43, 50, 55, 59, 62], [40, 47, 52, 55, 59], [45, 52, 57, 60, 64]]
        ],
        chords: [[45, 52, 57, 60, 64], [41, 48, 53, 57, 60], [45, 52, 57, 60, 64], [43, 50, 55, 59, 62]],
        kick:  [1, 0, 0, 0,  0, 0, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0],
        snare: [0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0],
        hihat: [1, 0, 1, 0,  1, 0, 1, 0,  1, 0, 1, 0,  1, 0, 1, 0],
        vinylNoise: 0.005,
        bassType: 'sub_warm',
      }
    };

    const cfgTemplate = GENRES[genre] || GENRES.lofi;
    const cfg = Object.assign({}, cfgTemplate);

    // Pick one of the 4 diverse chord progressions dynamically
    const progIndex = cfg.progressions ? (promptHash % cfg.progressions.length) : 0;
    cfg.progressionIdx = progIndex;
    cfg.chords = (cfg.progressions && cfg.progressions[progIndex]) || cfg.chords;

    // Optional transposition based on prompt key or prompt hash
    const keyRoots = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    const keyMatch = p.match(/\b([cdefgab][#b]?)\b/i);
    let keyOffset = 0;
    if (keyMatch) {
      const parsedNote = keyMatch[1].toUpperCase();
      const idx = keyRoots.findIndex(r => r.toUpperCase() === parsedNote);
      if (idx >= 0) keyOffset = (idx - 0); // offset from C
    } else {
      // Deterministic chromatic key shifting based on prompt hash
      keyOffset = (promptHash % 7) - 3;
    }

    if (keyOffset !== 0) {
      cfg.chords = cfg.chords.map(chord => chord.map(midi => Math.max(30, Math.min(84, midi + keyOffset))));
    }

    cfg.instrument = instrument;
    cfg.leadStyle = leadStyle;
    cfg.promptHash = promptHash;
    cfg.rhythmicDensity = rhythmicDensity;
    cfg.temperature = temperature;
    cfg.topP = topP;
    cfg.repetitionPenalty = repetitionPenalty;

    const bpm = (explicitBpm && explicitBpm >= 50 && explicitBpm <= 220) ? explicitBpm : (cfg.bpm || currentBpm || 120);

    return { genre, bpm, cfg };
  }

  cancel() {
    if (this._abortCtrl) {
      this._abortCtrl.abort();
      this._abortCtrl = null;
    }
  }

  async generate(prompt, { duration = 8, onStatus = () => {} } = {}) {
    if (this._abortCtrl) this._abortCtrl.abort();
    this._abortCtrl = new AbortController();

    onStatus('generating');
    await new Promise(r => setTimeout(r, 16));
    if (this._abortCtrl?.signal.aborted) throw new Error('Generation cancelled');

    onStatus('synthesizing');
    const res = this.renderWavBuffer(prompt, duration);
    const blob = new Blob([res.view], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);

    onStatus('done');
    this._abortCtrl = null;
    return {
      blob,
      url,
      metadata: res.metadata,
      engine: 'BeYou Built-in Procedural AI'
    };
  }

  renderWavBuffer(prompt, duration = 8) {
    const currentDAWBpm = (typeof window !== 'undefined' && window.app?.sequencer?.bpm) ? window.app.sequencer.bpm : 120;
    const { genre, bpm, cfg } = BrowserMusicGenerator.parsePromptIntent(prompt, currentDAWBpm);

    const sr = this.sampleRate;
    const totalSamples = Math.floor(duration * sr);
    const samplesPerBeat = (60.0 / bpm) * sr;
    const samplesPerStep = samplesPerBeat / 4.0;
    const stepsPerChord = 8;
    const chordProg = cfg.chords;
    const numChords = chordProg.length;

    // Seeded deterministic PRNG for prompt
    let seed = 0;
    const cleanPrompt = (prompt || 'music beat').trim();
    for (let i = 0; i < cleanPrompt.length; i++) {
      seed = ((seed << 5) - seed) + cleanPrompt.charCodeAt(i);
      seed |= 0;
    }
    seed = Math.abs(seed) || 12345;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed >>> 0) / 4294967296;
    };

    const midiToFreq = m => 440.0 * Math.pow(2.0, (m - 69.0) / 12.0);

    const headerSize = 44;
    const dataSize = totalSamples * 4; // 2 channels * 2 bytes
    const arrayBuffer = new ArrayBuffer(headerSize + dataSize);
    const view = new DataView(arrayBuffer);

    // RIFF header
    const writeString = (offset, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 2, true); // Stereo
    view.setUint32(24, sr, true);
    view.setUint32(28, sr * 4, true); // Byte rate
    view.setUint16(32, 4, true); // Block align
    view.setUint16(34, 16, true); // 16 bits
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = 44;
    let reesePhase1 = 0.0;
    let reesePhase2 = 0.0;

    // High quality Schroeder Stereo Reverb network (4 parallel combs + 2 allpasses)
    const combLengthsL = [1116, 1188, 1277, 1356];
    const combLengthsR = [1138, 1210, 1293, 1378];
    const combsL = combLengthsL.map(len => new Float32Array(len));
    const combsR = combLengthsR.map(len => new Float32Array(len));
    const combIndicesL = [0, 0, 0, 0];
    const combIndicesR = [0, 0, 0, 0];
    const combFeedback = 0.72;

    const allpassLenL = [556, 441];
    const allpassLenR = [572, 453];
    const allpassL = allpassLenL.map(len => new Float32Array(len));
    const allpassR = allpassLenR.map(len => new Float32Array(len));
    const allpassIndicesL = [0, 0];
    const allpassIndicesR = [0, 0];
    const allpassFeedback = 0.5;

    // Ping-pong delay buffer for leads (3/16th tempo synced)
    const delaySamples = Math.floor(samplesPerStep * 3);
    const delayBufL = new Float32Array(delaySamples);
    const delayBufR = new Float32Array(delaySamples);
    let delayIdx = 0;

    for (let i = 0; i < totalSamples; i++) {
      const t = i / sr;
      const stepIdx = Math.floor(i / samplesPerStep);
      const stepMod16 = stepIdx % 16;
      const barIdx = Math.floor(stepIdx / 16);
      const timeInStep = (i % Math.floor(samplesPerStep)) / sr;

      const chordIdx = Math.floor(stepIdx / stepsPerChord) % numChords;
      const currentChord = chordProg[chordIdx];
      const rootMidi = currentChord[0] - 12;

      // ── 1. DRUMS ──
      let drumL = 0, drumR = 0;
      const rDensity = cfg.rhythmicDensity !== undefined ? cfg.rhythmicDensity : 0.50;
      const isHighDensity = rDensity > 0.70;
      const isLowDensity = rDensity < 0.35;

      // Realistic 3-layer Kick (Transient Click + Pitch Drop + Sub Weight + Saturation)
      const playKick = cfg.kick[stepMod16] || (isHighDensity && (stepMod16 === 10 || (barIdx % 2 === 1 && stepMod16 === 14)));
      if (playKick && timeInStep < 0.35) {
        // Layer 1: Transient click (0-6ms spike for punch through any speaker)
        const clickEnv = Math.exp(-timeInStep * 700.0);
        const click = (rng() * 2.0 - 1.0) * clickEnv * 0.45;

        // Layer 2: Pitch drop body
        const pitchEnv = 160.0 * Math.exp(-timeInStep * 32.0) + 48.0;
        const ampEnv = Math.exp(-timeInStep * 9.5);
        const bodySine = Math.sin(2 * Math.PI * pitchEnv * timeInStep) * ampEnv;

        // Layer 3: Sub bass punch (harmonic saturation)
        const subSine = Math.sin(2 * Math.PI * (pitchEnv * 0.5) * timeInStep) * ampEnv * 0.4;
        const kVal = Math.tanh((bodySine * 1.6 + click + subSine) * 1.25) * 0.88;
        drumL += kVal;
        drumR += kVal;
      }

      // Realistic Snare / Clap (185Hz Body Tone + 2.4kHz Bandpass Noise + Stereo Sizzle)
      if (cfg.snare[stepMod16] && timeInStep < 0.28) {
        const toneEnv = Math.exp(-timeInStep * 26.0);
        const sTone = Math.sin(2 * Math.PI * 185.0 * timeInStep) * toneEnv * 0.42;

        const noiseEnv = Math.exp(-timeInStep * 16.0);
        const rawNoise = (rng() * 2.0 - 1.0);
        // Simple bandpass filter approximation around 2.2kHz
        const bpFilter = Math.sin(2 * Math.PI * 2200.0 * timeInStep) * rawNoise * noiseEnv * 0.65;

        const snapEnv = Math.exp(-timeInStep * 120.0);
        const snap = (rng() * 2.0 - 1.0) * snapEnv * 0.3;

        const sValL = sTone + bpFilter + snap + (rng() * 0.08);
        const sValR = sTone + bpFilter + snap - (rng() * 0.08);
        drumL += sValL * 0.72;
        drumR += sValR * 0.72;
      }

      // Dynamic drum variations across bars
      const isTurnaroundBar = (barIdx % 4 === 3);

      // Drum fill snare rolls on steps 12-15 of turnaround bar
      if (isTurnaroundBar && stepMod16 >= 12 && timeInStep < 0.14) {
        const rollVelocity = 0.5 + (stepMod16 - 12) * 0.15; // Crescendo
        const toneEnv = Math.exp(-timeInStep * 32.0);
        const sTone = Math.sin(2 * Math.PI * 210.0 * timeInStep) * toneEnv * 0.45;
        const noiseEnv = Math.exp(-timeInStep * 20.0);
        const rawNoise = (rng() * 2.0 - 1.0) * noiseEnv * 0.65;
        const sVal = (sTone + rawNoise) * rollVelocity * 0.75;
        drumL += sVal;
        drumR += sVal;
      }

      // Realistic Hi-Hat (Metallic 6-Oscillator Cluster + Highpass Noise Burst)
      const hihatRollStep = isTurnaroundBar && (stepMod16 === 7 || stepMod16 === 15);
      let playHihat = cfg.hihat[stepMod16] || hihatRollStep;
      if (isLowDensity && stepMod16 % 2 !== 0) playHihat = false; // Thin out hihats in sparse mode
      if (isHighDensity && (stepMod16 % 4 === 1 || stepMod16 % 4 === 3)) playHihat = true; // Extra 16th hats
      if (playHihat && timeInStep < 0.09) {
        const hEnv = Math.exp(-timeInStep * 65.0);
        // Inharmonic metallic square clusters
        const m1 = Math.sign(Math.sin(2 * Math.PI * 3420.0 * t));
        const m2 = Math.sign(Math.sin(2 * Math.PI * 4780.0 * t));
        const m3 = Math.sign(Math.sin(2 * Math.PI * 6150.0 * t));
        const metalRing = (m1 + m2 + m3) * 0.18;
        const hNoise = (rng() * 2.0 - 1.0) * 0.45;
        const accent = (stepMod16 % 4 === 2 || hihatRollStep) ? 1.25 : 0.85;

        const hatSignal = (metalRing + hNoise) * hEnv * 0.26 * accent;
        drumL += hatSignal * 0.75;
        drumR += hatSignal * 1.15; // Natural stereo offset
      }

      // ── 2. BASS & 808 ──
      let bassL = 0, bassR = 0;
      const bassType = cfg.bassType || 'sub_warm';
      if (bassType.includes('808')) {
        const freq = midiToFreq(rootMidi);
        const glideSteps = [0, 8, 10];
        if (barIdx % 2 === 1) glideSteps.push(14); // Bass variation on alternate bars
        const glide = (glideSteps.includes(stepMod16)) ? Math.exp(-timeInStep * 6.0) * 20.0 : 0.0;
        const bFreq = freq + glide;

        // Sub fundamental + 2nd harmonic for audibility on smaller speakers
        const sub = Math.sin(2 * Math.PI * bFreq * t);
        const harm2 = Math.sin(2 * Math.PI * bFreq * 2.0 * t) * 0.35;
        let bVal = sub + harm2;

        if (bassType.includes('distorted')) {
          bVal = Math.tanh(bVal * 2.2) * 0.75;
        } else {
          bVal = Math.tanh(bVal * 1.4) * 0.80;
        }
        bassL += bVal;
        bassR += bVal;
      } else if (bassType === 'rolling_saw_arp') {
        const arpNotes = [rootMidi, rootMidi + 7, rootMidi + 12, rootMidi + 7];
        const currNote = arpNotes[stepMod16 % 4];
        const freq = midiToFreq(currNote);
        const saw = 2.0 * ((t * freq) % 1.0) - 1.0;
        const sub = Math.sin(2 * Math.PI * (freq * 0.5) * t) * 0.5;
        const env = Math.exp(-timeInStep * 12.0);
        const bVal = Math.tanh((saw * 0.5 + sub) * 1.3) * env * 0.65;
        bassL += bVal;
        bassR += bVal;
      } else if (bassType === 'reese_lfo') {
        const freq1 = midiToFreq(rootMidi);
        const freq2 = midiToFreq(rootMidi) + 1.2;
        reesePhase1 += (2 * Math.PI * freq1) / sr;
        reesePhase2 += (2 * Math.PI * freq2) / sr;
        const lfo = 0.5 + 0.5 * Math.sin(2 * Math.PI * 1.8 * t);
        const saw1 = 2.0 * ((reesePhase1 / (2 * Math.PI)) % 1.0) - 1.0;
        const saw2 = 2.0 * ((reesePhase2 / (2 * Math.PI)) % 1.0) - 1.0;
        const bVal = Math.tanh((saw1 * 0.5 + saw2 * 0.5) * (0.8 + 0.6 * lfo)) * 0.55;
        bassL += bVal * 1.1;
        bassR += bVal * 0.9;
      } else {
        const freq = midiToFreq(rootMidi);
        const sub = Math.sin(2 * Math.PI * freq * t);
        const harm = Math.sin(2 * Math.PI * freq * 2.0 * t) * 0.25;
        const bVal = Math.tanh((sub + harm) * 1.2) * 0.65;
        bassL += bVal;
        bassR += bVal;
      }

      // ── 3. CHORDS & HARMONY (Lush Analog Pads / Keys with Chorus) ──
      let chordL = 0, chordR = 0;
      const timeInChord = ((stepIdx % stepsPerChord) * samplesPerStep + (i % Math.floor(samplesPerStep))) / sr;
      const chordEnv = (1.0 - Math.exp(-timeInChord * 14.0)) * Math.exp(-timeInChord * 0.45) * 0.30;

      for (let idx = 0; idx < currentChord.length; idx++) {
        const cFreq = midiToFreq(currentChord[idx]);
        // Dual detuned oscillators for lush analog chorus
        const phaseA = (t * cFreq) % 1.0;
        const phaseB = (t * (cFreq * 1.0035)) % 1.0;
        // Warm band-limited triangle / soft saw
        const voiceA = 4.0 * Math.abs(phaseA - 0.5) - 1.0;
        const voiceB = 2.0 * phaseB - 1.0;
        const voice = (voiceA * 0.75 + voiceB * 0.25);

        // Wide stereo panning per voice
        const panL = 0.6 + 0.5 * (idx % 2 === 0 ? 1 : 0);
        const panR = 0.6 + 0.5 * (idx % 2 === 1 ? 1 : 0);
        chordL += voice * chordEnv * panL;
        chordR += voice * chordEnv * panR;
      }

      // Crash Cymbal on Intro & 4-bar section drop (Step 0)
      if ((stepIdx === 0 || (barIdx % 4 === 0 && stepMod16 === 0)) && timeInStep < 0.65) {
        const crashEnv = Math.exp(-timeInStep * 7.5);
        const cNoise = (rng() * 2.0 - 1.0) * crashEnv * 0.28;
        const cRing = Math.sin(2 * Math.PI * 5200.0 * t) * crashEnv * 0.12;
        drumL += (cNoise + cRing) * 0.9;
        drumR += (cNoise - cRing) * 1.1;
      }

      // ── 4. MELODIC LEAD / MOTIF with Expressive Phrasing & Dynamic Song Structure ──
      let dryLeadL = 0, dryLeadR = 0;
      let shouldPlayLead = false;
      let leadMidi = currentChord[0] + 12;
      let leadDur = 0.28;

      const leadStyle = cfg.leadStyle || 'lyrical';
      const instrument = cfg.instrument || 'synth';

      // 4-Bar Song Phrasing Structure
      const barInPhrase = barIdx % 4;
      const rootM = currentChord[0];
      const isMinor = (currentChord.length > 1 && (currentChord[1] - currentChord[0] === 3));
      const third = isMinor ? 3 : 4;
      const fifth = 7;
      const seventh = isMinor ? 10 : 11;
      const ninth = 14;

      if (leadStyle === 'arpeggio') {
        // Musical arpeggiator with dynamic phrasing and breath on beat 4
        if (stepMod16 < 14) {
          shouldPlayLead = true;
          const arpPatterns = [
            [0, 2, 4, 7,  2, 4, 7, 9,  4, 7, 9, 12,  7, 4],
            [0, 4, 7, 12, 4, 7, 12, 9, 7, 12, 9, 7,  4, 2],
            [12, 9, 7, 4, 9, 7, 4, 2,  7, 4, 2, 0,   2, 4]
          ];
          const pattern = arpPatterns[(barInPhrase + (cfg.promptHash || 0)) % arpPatterns.length];
          const semitone = pattern[stepMod16 % pattern.length];
          leadMidi = rootM + 12 + semitone;
          leadDur = 0.16;
        }
      } else if (leadStyle === 'staccato') {
        const stabSteps = [0, 3, 6, 8, 11, 14];
        if (stabSteps.includes(stepMod16)) {
          shouldPlayLead = true;
          const stabNotes = (barInPhrase < 2)
            ? [seventh, fifth, third, fifth, seventh, ninth]
            : [ninth, 12, 12 + third, 12, seventh, fifth];
          const noteOffset = stabNotes[stabSteps.indexOf(stepMod16)];
          leadMidi = rootM + 12 + noteOffset;
          leadDur = 0.18;
        }
      } else if (leadStyle === 'ambient_swell') {
        if (stepMod16 === 0 || stepMod16 === 8) {
          shouldPlayLead = true;
          const swellNotes = [third, fifth, seventh, ninth];
          leadMidi = rootM + 12 + swellNotes[(barInPhrase * 2 + (stepMod16 === 8 ? 1 : 0)) % swellNotes.length];
          leadDur = 0.65;
        }
      } else {
        // Lyrical 4-Bar Call-and-Response:
        // Bar 0: Hook theme statement
        // Bar 1: Answering counter-phrase
        // Bar 2: Climax with upper extensions (9th / 11th)
        // Bar 3: Cadential descent resolving to tonic before turnaround fill
        let motifMap = null;
        if (barInPhrase === 0) {
          motifMap = { 0: 0, 2: 2, 6: third, 8: fifth, 11: seventh };
        } else if (barInPhrase === 1) {
          motifMap = { 2: seventh, 4: fifth, 7: third, 10: fifth, 13: 2 };
        } else if (barInPhrase === 2) {
          motifMap = { 0: fifth, 3: seventh, 6: ninth, 8: 12 + third, 11: 12, 14: ninth };
        } else {
          motifMap = { 0: 12, 2: seventh, 6: fifth, 8: third, 11: 2, 13: 0 };
        }

        if (motifMap[stepMod16] !== undefined) {
          shouldPlayLead = true;
          leadMidi = rootM + 12 + motifMap[stepMod16];
          leadDur = (stepMod16 === 0 || stepMod16 === 8) ? 0.38 : 0.24;
        }
      }

      if (shouldPlayLead && timeInStep < leadDur) {
        const lFreq = midiToFreq(leadMidi);
        const vibSpeed = (instrument === 'flute') ? 5.2 : 5.8;
        const vibDepth = (instrument === 'flute') ? 3.5 : 2.0;
        const vibrato = Math.sin(2 * Math.PI * vibSpeed * t) * vibDepth;
        const freqW = lFreq + vibrato;

        let leadSig = 0;
        if (instrument === 'flute') {
          // Breathy sine core + filtered breath turbulence + smooth portamento vibrato
          const breathNoise = (rng() * 2.0 - 1.0) * Math.sin(2 * Math.PI * 2600.0 * t) * 0.16;
          const sineCore = Math.sin(2 * Math.PI * freqW * t);
          const fEnv = (1.0 - Math.exp(-timeInStep * 28.0)) * Math.exp(-timeInStep * (3.8 / leadDur));
          leadSig = (sineCore + breathNoise) * fEnv * 0.34;
        } else if (instrument === 'guitar') {
          // Plucked string transient + metallic Karplus-Strong resonant harmonics
          const pEnv = Math.exp(-timeInStep * 20.0);
          const s1 = Math.sin(2 * Math.PI * freqW * t);
          const s2 = Math.sin(2 * Math.PI * freqW * 2.0 * t) * 0.42;
          const s3 = Math.sin(2 * Math.PI * freqW * 3.0 * t) * 0.20;
          const pClick = (rng() * 2.0 - 1.0) * Math.exp(-timeInStep * 400.0) * 0.28;
          leadSig = Math.tanh((s1 + s2 + s3 + pClick) * 1.3) * pEnv * 0.32;
        } else if (instrument === 'piano') {
          // Hammer transient + acoustic multi-harmonic decay
          const hammer = (rng() * 2.0 - 1.0) * Math.exp(-timeInStep * 600.0) * 0.22;
          const h1 = Math.sin(2 * Math.PI * freqW * t);
          const h2 = Math.sin(2 * Math.PI * freqW * 2.001 * t) * 0.38;
          const h3 = Math.sin(2 * Math.PI * freqW * 3.003 * t) * 0.16;
          const piEnv = Math.exp(-timeInStep * (5.5 / leadDur));
          leadSig = (h1 + h2 + h3 + hammer) * piEnv * 0.30;
        } else if (instrument === 'strings') {
          // Slow bow envelope + dual detuned saw voices
          const bowEnv = (1.0 - Math.exp(-timeInStep * 18.0)) * Math.exp(-timeInStep * (2.0 / leadDur));
          const sawA = 2.0 * ((t * freqW) % 1.0) - 1.0;
          const sawB = 2.0 * ((t * (freqW * 1.006)) % 1.0) - 1.0;
          leadSig = (sawA * 0.5 + sawB * 0.5) * bowEnv * 0.26;
        } else if (instrument === 'brass') {
          // Bright saw swell with resonant bite
          const bEnv = (1.0 - Math.exp(-timeInStep * 50.0)) * Math.exp(-timeInStep * 12.0);
          const saw = 2.0 * ((t * freqW) % 1.0) - 1.0;
          leadSig = Math.tanh(saw * 1.6) * bEnv * 0.28;
        } else if (instrument === 'bell') {
          // FM metallic chime
          const bEnv = Math.exp(-timeInStep * 10.0);
          const mod = Math.sin(2 * Math.PI * (freqW * 2.76) * t) * 2.0;
          leadSig = Math.sin(2 * Math.PI * freqW * t + mod) * bEnv * 0.26;
        } else {
          // Default expressive analog lead
          const lEnv = (1.0 - Math.exp(-timeInStep * 40.0)) * Math.exp(-timeInStep * 10.0);
          const leadWave = Math.sin(2 * Math.PI * freqW * t);
          const leadSaw = (2.0 * ((t * freqW) % 1.0) - 1.0) * 0.3;
          leadSig = (leadWave + leadSaw) * lEnv * 0.28;
        }

        dryLeadL += leadSig * 0.85;
        dryLeadR += leadSig * 1.15;
      }

      // Ping-pong delay tap
      const echoL = delayBufR[delayIdx] * 0.38;
      const echoR = delayBufL[delayIdx] * 0.38;
      delayBufL[delayIdx] = dryLeadL + echoL * 0.3;
      delayBufR[delayIdx] = dryLeadR + echoR * 0.3;
      delayIdx = (delayIdx + 1) % delaySamples;

      const leadL = dryLeadL + echoL;
      const leadR = dryLeadR + echoR;

      // ── 5. VINYL CRACKLE & TEXTURE ──
      if (cfg.vinylNoise > 0) {
        const vCrack = (rng() * 2.0 - 1.0) * cfg.vinylNoise * (rng() > 0.96 ? 0.9 : 0.15);
        drumL += vCrack;
        drumR += vCrack;
      }

      // ── 6. STEREO SCHROEDER REVERB BUS ──
      // Send chords and lead through reverb network for studio space
      const revInL = (chordL + leadL) * 0.35;
      const revInR = (chordR + leadR) * 0.35;

      let revOutL = 0;
      let revOutR = 0;
      for (let c = 0; c < 4; c++) {
        const idxL = combIndicesL[c];
        const outL = combsL[c][idxL];
        combsL[c][idxL] = revInL + outL * combFeedback;
        combIndicesL[c] = (idxL + 1) % combLengthsL[c];
        revOutL += outL;

        const idxR = combIndicesR[c];
        const outR = combsR[c][idxR];
        combsR[c][idxR] = revInR + outR * combFeedback;
        combIndicesR[c] = (idxR + 1) % combLengthsR[c];
        revOutR += outR;
      }
      revOutL *= 0.25;
      revOutR *= 0.25;

      // Allpass diffusers
      for (let a = 0; a < 2; a++) {
        const idxL = allpassIndicesL[a];
        const bufValL = allpassL[a][idxL];
        const inL = revOutL;
        revOutL = -allpassFeedback * inL + bufValL;
        allpassL[a][idxL] = inL + allpassFeedback * revOutL;
        allpassIndicesL[a] = (idxL + 1) % allpassLenL[a];

        const idxR = allpassIndicesR[a];
        const bufValR = allpassR[a][idxR];
        const inR = revOutR;
        revOutR = -allpassFeedback * inR + bufValR;
        allpassR[a][idxR] = inR + allpassFeedback * revOutR;
        allpassIndicesR[a] = (idxR + 1) % allpassLenR[a];
      }

      // ── 7. MASTER BUS & ANALOG SATURATION LIMITER ──
      const mixL = drumL + bassL + chordL + leadL + revOutL * 0.42;
      const mixR = drumR + bassR + chordR + leadR + revOutR * 0.42;

      // Smooth soft-knee saturation
      const finalL = Math.tanh(mixL * 1.10);
      const finalR = Math.tanh(mixR * 1.10);

      const sL = Math.floor(Math.max(-1.0, Math.min(1.0, finalL)) * 30000);
      const sR = Math.floor(Math.max(-1.0, Math.min(1.0, finalR)) * 30000);

      view.setInt16(offset, sL, true);
      view.setInt16(offset + 2, sR, true);
      offset += 4;
    }

    return {
      view,
      arrayBuffer,
      metadata: {
        genre,
        bpm,
        duration,
        sampleRate: sr,
        temperature: cfg.temperature,
        topP: cfg.topP,
        repetitionPenalty: cfg.repetitionPenalty,
        rhythmicDensity: cfg.rhythmicDensity
      }
    };
  }
}

class LocalMusicClient {
  constructor() {
    const defaultOrigin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : 'http://localhost:8000';
    this.baseUrl = localStorage.getItem('fl-studio-local-audio-url') || defaultOrigin;
    this._abortCtrl = null;
  }

  setUrl(url) {
    if (url) {
      this.baseUrl = url.trim().replace(/\/+$/, '');
      localStorage.setItem('fl-studio-local-audio-url', this.baseUrl);
    }
  }

  async testConnection() {
    const urlsToTry = [
      this.baseUrl,
      'http://localhost:8000',
      'http://127.0.0.1:8000'
    ];
    const uniqueUrls = [...new Set(urlsToTry.map(u => (u || '').trim().replace(/\/+$/, '')).filter(Boolean))];

    for (const testUrl of uniqueUrls) {
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 3500);
        const resp = await fetch(`${testUrl}/health`, { method: 'GET', signal: ctrl.signal });
        clearTimeout(tid);
        if (resp.ok) {
          const data = await resp.json().catch(() => ({}));
          this.setUrl(testUrl);
          return {
            ok: true,
            message: `Connected to Local Server at ${testUrl}! Engine: ${data.engine || 'MusicGen / Algorithmic Synth'}`,
            data,
            url: testUrl
          };
        }
      } catch (_) {}
    }

    return {
      ok: false,
      message: `Cannot connect to ${this.baseUrl}. Run "python server.py" on port 8000 or switch to BeYou Built-in engine.`,
    };
  }

  async generate(prompt, { onStatus = () => {}, duration = 8 } = {}) {
    if (this._abortCtrl) this._abortCtrl.abort();
    this._abortCtrl = new AbortController();

    onStatus('generating');

    const endpoints = [
      `${this.baseUrl}/generate`,
      `${this.baseUrl}/api/music/generate`,
    ];
    if (!this.baseUrl.includes(':8000')) {
      endpoints.push('http://localhost:8000/generate');
      endpoints.push('http://127.0.0.1:8000/generate');
    }

    let lastErr = null;
    for (const ep of endpoints) {
      try {
        const resp = await fetch(ep, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, duration }),
          signal: this._abortCtrl.signal,
        });

        if (resp.ok) {
          const blob = await resp.blob();
          const url  = URL.createObjectURL(blob);
          onStatus('done');
          this._abortCtrl = null;
          return { blob, url, engine: 'Local Audio Server' };
        } else {
          lastErr = new Error(`Local server returned HTTP ${resp.status}`);
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          onStatus('cancelled');
          this._abortCtrl = null;
          throw new Error('Generation cancelled');
        }
        lastErr = err;
      }
    }

    onStatus('error');
    this._abortCtrl = null;
    throw lastErr || new Error(`Cannot connect to local music server at ${this.baseUrl}`);
  }

  cancel() {
    if (this._abortCtrl) {
      this._abortCtrl.abort();
      this._abortCtrl = null;
    }
  }
}

class HuggingFaceMusic {
  constructor() {
    this.apiKey    = localStorage.getItem('fl-studio-hf-key') || '';
    this.modelId   = MUSICGEN_MODELS.small; // Use free serverless-supported small model by default
    this.baseUrl   = 'https://router.huggingface.co/hf-inference/models';
    this.fallbackBaseUrl = 'https://api-inference.huggingface.co/models';
    this._abortCtrl = null;
  }

  setApiKey(key) {
    this.apiKey = key.trim();
    localStorage.setItem('fl-studio-hf-key', this.apiKey);
  }

  hasKey() { return this.apiKey.length > 0; }

  setModel(size) {
    this.modelId = MUSICGEN_MODELS[size] || MUSICGEN_MODELS.small;
  }

  setModelSize(size) {
    this.setModel(size);
  }

  /**
   * Generate music audio from a text prompt.
   * @param {string} prompt - Text description of the music to generate
   * @param {object} opts - Options
   * @param {Function} opts.onStatus - Status callback ('loading' | 'generating' | 'done' | 'error')
   * @returns {Promise<{blob: Blob, url: string, engine: string}>} Generated audio blob + object URL
   */
  async generate(prompt, { onStatus = () => {} } = {}) {
    if (!this.hasKey()) {
      throw new Error('No Hugging Face API key set. Please click Audio Setup to enter your token, or use BeYou Built-in.');
    }

    if (this._abortCtrl) {
      this._abortCtrl.abort();
    }
    this._abortCtrl = new AbortController();

    const urls = [
      `${this.baseUrl}/${this.modelId}`,
      `${this.fallbackBaseUrl}/${this.modelId}`
    ];
    const maxRetries = 2;
    let lastError = null;

    for (const url of urls) {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          onStatus(attempt === 0 ? 'generating' : 'loading');

          const resp = await fetch(url, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type':  'application/json',
            },
            body: JSON.stringify({ inputs: prompt }),
            signal: this._abortCtrl.signal,
          });

          // Model loading — wait and retry
          if (resp.status === 503) {
            const body = await resp.json().catch(() => ({}));
            const waitTime = body.estimated_time
              ? Math.min(body.estimated_time * 1000, 20000)
              : 8000;
            onStatus('loading');
            await this._sleep(waitTime);
            continue;
          }

          // Rate limit
          if (resp.status === 429) {
            throw new Error('Hugging Face rate limit reached. Please wait or switch to BeYou Built-in engine.');
          }

          // Auth error
          if (resp.status === 401 || resp.status === 403) {
            throw new Error('Invalid or expired Hugging Face API key. Please verify your token in Audio Setup.');
          }

          if (!resp.ok) {
            const errBody = await resp.json().catch(() => ({}));
            throw new Error(errBody.error || `Hugging Face returned HTTP ${resp.status}`);
          }

          // Success — response is audio binary
          const blob = await resp.blob();
          const audioUrl = URL.createObjectURL(blob);
          onStatus('done');
          this._abortCtrl = null;
          return { blob, url: audioUrl, engine: `Hugging Face (${this.modelId})` };

        } catch (err) {
          if (err.name === 'AbortError') {
            onStatus('cancelled');
            this._abortCtrl = null;
            throw new Error('Generation cancelled');
          }
          lastError = err;
          if (err.message.includes('API key')) break;
          if (attempt < maxRetries - 1 && err.message.includes('503')) {
            await this._sleep(4000);
          }
        }
      }
      if (lastError && lastError.message.includes('API key')) break;
    }

    onStatus('error');
    this._abortCtrl = null;
    throw lastError || new Error('Failed to generate music via Hugging Face after retries');
  }

  cancel() {
    if (this._abortCtrl) {
      this._abortCtrl.abort();
      this._abortCtrl = null;
    }
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. PROMPT BUILDER
// ─────────────────────────────────────────────────────────────────────────────

class PromptBuilder {
  /**
   * Build a music generation prompt from DAW context.
   */
  static build({ bpm = 120, genre = 'Hip-Hop', density = 50, syncopation = 30,
                  moods = [], instruments = [], userText = '' } = {}) {
    // If trained MusicTagEngine is loaded, use its statistical Qwen prompt synthesis
    if (typeof window !== 'undefined' && window.musicTagEngine && window.musicTagEngine.loaded) {
      return window.musicTagEngine.synthesizePrompt({ genre, bpm, moods, instruments, userText });
    }

    const parts = [];

    // Genre base
    const genreDesc = GENRE_PROMPT_MAP[genre] || GENRE_PROMPT_MAP['Unknown'];
    parts.push(genreDesc);

    // BPM context
    if (bpm < 90) parts.push('slow tempo');
    else if (bpm > 150) parts.push('fast tempo, high energy');
    else if (bpm > 120) parts.push('medium-fast tempo');

    // Density context
    if (density > 70) parts.push('dense, layered');
    else if (density < 30) parts.push('sparse, minimal');

    // Syncopation
    if (syncopation > 60) parts.push('syncopated, off-beat accents');

    // Moods
    if (moods.length > 0) parts.push(moods.join(', '));

    // Instruments
    if (instruments.length > 0) parts.push(instruments.join(', '));

    // User text
    if (userText.trim()) parts.push(userText.trim());

    // Quality suffix
    parts.push('high quality, studio production');

    return parts.join(', ');
  }

  /**
   * Generate a prompt from current AISuggester analysis.
   */
  static fromAnalysis(analysis, bpm, moods = [], instruments = [], userText = '') {
    return PromptBuilder.build({
      bpm,
      genre: analysis.genre || 'Unknown',
      density: analysis.density || 50,
      syncopation: analysis.syncopation || 30,
      moods,
      instruments,
      userText,
    });
  }

  /**
   * Quick preset prompts.
   */
  static presets() {
    return [
      { label: 'Pure Felt Piano (CVAE)', prompt: 'pure felt piano solo, intimate gentle acoustics, modern classical, warm room, high quality' },
      { label: 'Cinematic Score (CVAE)', prompt: 'cinematic soundtrack, emotional strings, felt piano, dramatic crescendo, orchestral, studio quality' },
      { label: 'Music Video Score (Vis)', prompt: 'cinematic music video soundtrack, building energy, epic drums, emotional strings, modern production, visual score' },
      { label: 'Lo-Fi Chill',        prompt: 'lo-fi hip hop, mellow piano, vinyl crackle, chill, relaxing, rainy day, high quality' },
      { label: 'Trap Banger',         prompt: 'trap beat, heavy 808 bass, rapid hi-hats, dark synths, aggressive, high energy, studio quality' },
      { label: 'Deep House',           prompt: 'deep house music, four-on-the-floor kick, warm bass, atmospheric pads, groovy, high quality' },
      { label: 'Acoustic Vibes',       prompt: 'acoustic guitar, warm fingerpicking, gentle percussion, folk, intimate, high quality' },
      { label: 'Ambient Space',        prompt: 'ambient music, ethereal pads, reverb, atmospheric, dreamy, space, cinematic, high quality' },
      { label: 'Drum & Bass Energy',   prompt: 'drum and bass, fast breakbeat, rolling bass, energetic, jungle, high quality' },
      { label: 'Jazz Lounge',          prompt: 'jazz, smooth saxophone, piano chords, upright bass, relaxed, lounge, high quality' },
      { label: 'Retro Synthwave',      prompt: 'synthwave, 80s retro, arpeggiated synth, driving bass, neon, cinematic, high quality' },
    ];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. GENERATION HISTORY
// ─────────────────────────────────────────────────────────────────────────────

class GenerationHistory {
  constructor() {
    this._storageKey = 'fl-studio-music-ai-history';
    this.items = this._load();
    this._blobUrls = new Map();
    this._blobs = new Map();
  }

  add(prompt, blob, url) {
    const id = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const entry = {
      id,
      prompt,
      timestamp: Date.now(),
      size: blob ? blob.size : 0,
      type: blob ? blob.type : 'audio/wav',
    };
    this.items.unshift(entry);
    if (this.items.length > 20) this.items.pop();
    if (url) this._blobUrls.set(id, url);
    if (blob) this._blobs.set(id, blob);
    this._save();
    return entry;
  }

  getUrl(id) {
    return this._blobUrls.get(id) || null;
  }

  getBlob(id) {
    return this._blobs.get(id) || null;
  }

  remove(id) {
    const url = this._blobUrls.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      this._blobUrls.delete(id);
    }
    this._blobs.delete(id);
    this.items = this.items.filter(i => i.id !== id);
    this._save();
  }

  clear() {
    this._blobUrls.forEach(url => URL.revokeObjectURL(url));
    this._blobUrls.clear();
    this._blobs.clear();
    this.items = [];
    this._save();
  }

  _save() {
    try {
      localStorage.setItem(this._storageKey, JSON.stringify(this.items));
    } catch (e) { /* quota exceeded */ }
  }

  _load() {
    try {
      const raw = localStorage.getItem(this._storageKey);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  /**
   * Get a history entry by its ID.
   * @param {string} id - Entry ID.
   * @returns {object|null} Entry object or null if not found.
   */
  getEntry(id) {
    return this.items.find(i => i.id === id) || null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. MUSIC AI (orchestrator)
// ─────────────────────────────────────────────────────────────────────────────

class MusicAI {
  constructor() {
    this.hf           = new HuggingFaceMusic();
    this.localAudio   = new LocalMusicClient();
    this.browserAudio = new BrowserMusicGenerator(32000);
    this.history      = new GenerationHistory();

    const savedProvider = localStorage.getItem('fl-studio-music-audio-provider');
    if (savedProvider && ['beyou', 'local', 'hf'].includes(savedProvider)) {
      this.provider = savedProvider;
    } else {
      // Default to BeYou Built-in engine for zero-setup, instant offline generation
      this.provider = 'beyou';
    }

    this.isGenerating = false;
    this.currentAudio = null;
    this.selectedMoods = [];
    this.selectedInstruments = [];

    // Tag & Prompt Engine (trained on wanghappy/Music-tag-generation dataset)
    this.tagEngine = typeof MusicTagEngine !== 'undefined' ? new MusicTagEngine() : null;
    if (this.tagEngine) {
      this.tagEngine.load().then(ok => {
        if (ok && typeof window !== 'undefined') {
          window.musicTagEngine = this.tagEngine;
        }
      });
    }
  }

  setProvider(p) {
    if (['beyou', 'local', 'hf'].includes(p)) {
      this.provider = p;
      localStorage.setItem('fl-studio-music-audio-provider', p);
    }
  }

  getProvider() { return this.provider; }

  getActiveClient() {
    if (this.provider === 'hf') return this.hf;
    if (this.provider === 'local') return this.localAudio;
    return this.browserAudio;
  }

  setApiKey(key) { this.hf.setApiKey(key); }
  hasApiKey() {
    if (this.provider === 'beyou') return true;
    if (this.provider === 'local') return true;
    return this.hf.hasKey();
  }
  getApiKey()    { return this.hf.apiKey; }

  async generate(prompt, { onStatus = () => {}, duration = 8, allowFallback = true, addToHistory = true } = {}) {
    if (this.isGenerating) {
      this.cancel();
      await new Promise(r => setTimeout(r, 60));
    }

    this.isGenerating = true;

    // Direct path for BeYou Built-in engine (instant offline)
    if (this.provider === 'beyou') {
      try {
        const result = await this.browserAudio.generate(prompt, { duration, onStatus });
        const entry = addToHistory ? this.history.add(prompt, result.blob, result.url) : null;
        this.isGenerating = false;
        return { ...result, entry, fallbackUsed: false };
      } catch (err) {
        this.isGenerating = false;
        throw err;
      }
    }

    // External / Local client path with automated built-in fallback
    const client = this.getActiveClient();
    try {
      const result = await client.generate(prompt, { onStatus, duration });
      const entry = addToHistory ? this.history.add(prompt, result.blob, result.url) : null;
      this.isGenerating = false;
      return { ...result, entry, fallbackUsed: false };
    } catch (err) {
      if (err.name === 'AbortError' || err.message === 'Request cancelled' || err.message === 'Generation cancelled') {
        this.isGenerating = false;
        throw err;
      }

      console.warn(`[MusicAI] ${this.provider.toUpperCase()} provider failed:`, err.message);

      if (allowFallback) {
        try {
          if (typeof onStatus === 'function') onStatus('fallback');
          const fallbackRes = await this.browserAudio.generate(prompt, { duration, onStatus });
          const entry = addToHistory ? this.history.add(prompt, fallbackRes.blob, fallbackRes.url) : null;
          this.isGenerating = false;
          return {
            ...fallbackRes,
            entry,
            fallbackUsed: true,
            fallbackReason: `${this.provider.toUpperCase()} unavailable (${err.message})`,
            originalError: err.message,
          };
        } catch (fbErr) {
          this.isGenerating = false;
          throw fbErr;
        }
      }

      this.isGenerating = false;
      throw err;
    }
  }

  async generateFromContext(analysis, bpm, userText = '', { onStatus = () => {} } = {}) {
    const prompt = PromptBuilder.fromAnalysis(
      analysis, bpm, this.selectedMoods, this.selectedInstruments, userText
    );
    return this.generate(prompt, { onStatus });
  }

  /**
   * Convert an AudioBuffer to a standard 16-bit PCM WAV Blob.
   * @param {AudioBuffer} buffer
   * @returns {Blob}
   */
  audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const length = buffer.length * numChannels * 2 + 44;
    const arrayBuffer = new ArrayBuffer(length);
    const view = new DataView(arrayBuffer);

    function writeString(offset, string) {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    }

    // RIFF identifier
    writeString(0, 'RIFF');
    view.setUint32(4, length - 8, true);
    writeString(8, 'WAVE');
    // fmt subchunk
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // PCM chunk size
    view.setUint16(20, 1, true);  // linear PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true); // byte rate
    view.setUint16(32, numChannels * 2, true); // block align
    view.setUint16(34, 16, true); // bits per sample
    // data subchunk
    writeString(36, 'data');
    view.setUint32(40, length - 44, true);

    const channels = [];
    for (let i = 0; i < numChannels; i++) {
      channels.push(buffer.getChannelData(i));
    }

    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        let sample = Math.max(-1, Math.min(1, channels[ch][i]));
        sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset, sample, true);
        offset += 2;
      }
    }

    return new Blob([view], { type: 'audio/wav' });
  }

  /**
   * Extend an existing generation pattern by generating continuation audio with the prompt and concatenating audio.
   * @param {string} entryId - ID of the existing generation entry to extend.
   * @param {object} options - Options object.
   * @param {Function} options.onStatus - Status callback.
   * @returns {Promise<object>} New generation result with combined audio URL and entry.
   */
  async extendPattern(entryId, { onStatus = () => {} } = {}) {
    const entry = this.history.getEntry(entryId);
    if (!entry) throw new Error('History entry not found');

    // Retrieve original blob or regenerate base audio if from past session
    let origBlob = this.history.getBlob(entryId);
    if (!origBlob) {
      const url = this.history.getUrl(entryId);
      if (url) {
        origBlob = await fetch(url).then(r => r.blob()).catch(() => null);
      }
    }
    if (!origBlob) {
      onStatus('regenerating');
      const baseResult = await this.browserAudio.generate(entry.prompt, { duration: 8, onStatus });
      origBlob = baseResult.blob;
      if (baseResult.url) this.history._blobUrls.set(entryId, baseResult.url);
      if (origBlob) this.history._blobs.set(entryId, origBlob);
    }

    // Generate continuation audio
    onStatus('extending');
    const newResult = await this.generate(entry.prompt, { onStatus, addToHistory: false });

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') {
      try { await audioCtx.resume(); } catch (_) {}
    }

    try {
      const [buf1, buf2] = await Promise.all([
        this.toAudioBuffer(origBlob, audioCtx),
        this.toAudioBuffer(newResult.blob, audioCtx)
      ]);

      const numberOfChannels = Math.max(buf1.numberOfChannels, buf2.numberOfChannels);
      const length = buf1.length + buf2.length;
      const combined = audioCtx.createBuffer(numberOfChannels, length, buf1.sampleRate);

      for (let ch = 0; ch < numberOfChannels; ch++) {
        const channelData = combined.getChannelData(ch);
        if (ch < buf1.numberOfChannels) {
          channelData.set(buf1.getChannelData(ch), 0);
        }
        if (ch < buf2.numberOfChannels) {
          channelData.set(buf2.getChannelData(ch), buf1.length);
        }
      }

      const wavBlob = this.audioBufferToWav(combined);
      const combinedUrl = URL.createObjectURL(wavBlob);
      const combinedEntry = this.history.add(`${entry.prompt} (Extended)`, wavBlob, combinedUrl);
      return { blob: wavBlob, url: combinedUrl, entry: combinedEntry, buffer: combined };
    } finally {
      if (audioCtx.state !== 'closed' && typeof audioCtx.close === 'function') {
        try {
          const res = audioCtx.close();
          if (res && typeof res.catch === 'function') res.catch(() => {});
        } catch (_) {}
      }
    }
  }

  play(url) {
    this.stop();
    this.currentAudio = new Audio(url);
    this.currentAudio.play().catch(() => {});
    return this.currentAudio;
  }

  stop() {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
  }

  download(url, filename = 'ai-generated-music.wav') {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async toAudioBuffer(blob, audioContext) {
    if (window.audioEngine && typeof window.audioEngine.decodeAudio === 'function') {
      try {
        const decoded = await window.audioEngine.decodeAudio(blob);
        if (decoded && decoded.duration > 0) return decoded;
      } catch (e) {
        console.warn('[MusicAI] audioEngine.decodeAudio failed, trying Web Audio API:', e);
      }
    }
    const ctx = audioContext || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch (_) {}
    }
    const arrayBuffer = await blob.arrayBuffer();
    return new Promise((resolve, reject) => {
      let settled = false;
      const _resolve = (v) => { if (!settled) { settled = true; resolve(v); } };
      const _reject  = (e) => { if (!settled) { settled = true; reject(e); } };

      try {
        const res = ctx.decodeAudioData(
          arrayBuffer.slice(0),
          decoded => _resolve(decoded),
          err => _reject(err || new Error('Audio decoding failed'))
        );
        if (res && typeof res.then === 'function') {
          res.then(_resolve).catch(_reject);
        }
      } catch (err) {
        _reject(err);
      }
    });
  }

  cancel() {
    this.getActiveClient().cancel();
    this.isGenerating = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Expose
// ─────────────────────────────────────────────────────────────────────────────
if (typeof window !== 'undefined') {
  window.MusicAI                = MusicAI;
  window.BrowserMusicGenerator  = BrowserMusicGenerator;
  window.LocalMusicClient       = LocalMusicClient;
  window.HuggingFaceMusic       = HuggingFaceMusic;
  window.PromptBuilder          = PromptBuilder;
  window.GenerationHistory      = GenerationHistory;
  window.MOOD_TAGS              = MOOD_TAGS;
  window.INSTRUMENT_TAGS        = INSTRUMENT_TAGS;
}
