/**
 * BeYou Studio — Music Tag & Prompt Engine
 * =========================================
 * Trained on: wanghappy/Music-tag-generation (53,053 Qwen-Audio 2.0 captions)
 * Provides:
 *   - Probabilistic tag recommendation (instruments, moods, BPM for any genre)
 *   - Qwen-grade natural language prompt synthesis for MusicGen / AI Music
 *   - DAW-context auto-tagging
 */

'use strict';

class MusicTagEngine {
  constructor() {
    this.model = null;
    this.loaded = false;
    this._loadPromise = null;
  }

  /**
   * Load the precomputed tag & prompt model from /data/music_tag_model.json
   */
  async load() {
    if (this.loaded) return true;
    if (this._loadPromise) return this._loadPromise;

    this._loadPromise = (async () => {
      try {
        const resp = await fetch('/data/music_tag_model.json');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        this.model = await resp.json();
        this.loaded = true;
        console.log(`[MusicTagEngine] Loaded model trained on ${this.model.metadata.trainedSamples.toLocaleString()} compositions.`);
        return true;
      } catch (err) {
        console.warn('[MusicTagEngine] Failed to load tag model:', err.message);
        this._loadPromise = null;
        return false;
      }
    })();

    return this._loadPromise;
  }

  /**
   * Get all supported genres.
   */
  getGenres() {
    if (!this.loaded || !this.model) return [];
    return Object.keys(this.model.genres).sort();
  }

  /**
   * Get recommendations (instruments, moods, tempos, BPM) for a specific genre or tag selection.
   * @param {string} genre
   * @returns {object|null}
   */
  getRecommendations(genre) {
    if (!this.loaded || !this.model) return null;
    const gKey = this._normalizeGenre(genre);
    const gData = this.model.genres[gKey];
    if (!gData) return null;

    return {
      genre: gKey,
      count: gData.count,
      recommendedBpm: gData.recommendedBpm,
      topInstruments: gData.instruments,
      topMoods: gData.moods,
      tempos: gData.tempos,
      exemplars: gData.exemplars || []
    };
  }

  /**
   * Suggest compatible instruments based on currently selected instruments.
   * @param {Array<string>} selectedInstruments
   * @returns {Array<{name: string, count: number}>}
   */
  getCompatibleInstruments(selectedInstruments = []) {
    if (!this.loaded || !this.model) return [];
    const suggestions = new Map();

    selectedInstruments.forEach(inst => {
      const norm = inst.toLowerCase().trim();
      const data = this.model.instruments[norm];
      if (data && data.compatibleInstruments) {
        data.compatibleInstruments.forEach(compat => {
          if (!selectedInstruments.map(s => s.toLowerCase()).includes(compat)) {
            suggestions.set(compat, (suggestions.get(compat) || 0) + 1);
          }
        });
      }
    });

    return [...suggestions.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, score]) => ({ name, score }));
  }

  /**
   * Synthesize an authentic, high-quality MusicGen prompt based on the Qwen-Audio 2.0 dataset distribution.
   * @param {object} params
   * @param {string} params.genre
   * @param {number} params.bpm
   * @param {Array<string>} params.moods
   * @param {Array<string>} params.instruments
   * @param {string} params.userText
   * @returns {string} Formatted prompt string
   */
  synthesizePrompt({ genre = 'electronic', bpm = 120, moods = [], instruments = [], userText = '' } = {}) {
    const gKey = this._normalizeGenre(genre);
    const recs = this.getRecommendations(gKey);

    // Determine tempo descriptor based on BPM and genre
    let tempoDesc = 'medium';
    if (recs && recs.recommendedBpm) {
      if (bpm >= recs.recommendedBpm.fast - 5) tempoDesc = 'fast';
      else if (bpm <= recs.recommendedBpm.slow + 5) tempoDesc = 'slow';
      else tempoDesc = 'medium';
    } else {
      if (bpm >= 135) tempoDesc = 'fast';
      else if (bpm <= 85) tempoDesc = 'slow';
    }

    // Determine instruments (user selection or top recommendations from training)
    let instList = [...instruments];
    if (instList.length === 0 && recs && recs.topInstruments) {
      instList = recs.topInstruments.slice(0, 3).map(i => i.name);
    }
    if (instList.length === 0) instList = ['synthesizer', 'bass', 'drums'];

    // Format instruments string
    let instStr = '';
    if (instList.length === 1) {
      instStr = instList[0];
    } else if (instList.length === 2) {
      instStr = `${instList[0]} and ${instList[1]}`;
    } else {
      instStr = `${instList.slice(0, -1).join(', ')}, and ${instList[instList.length - 1]}`;
    }

    // Determine moods (user selection or top recommendations from training)
    let moodList = [...moods];
    if (moodList.length === 0 && recs && recs.topMoods) {
      moodList = recs.topMoods.slice(0, 2).map(m => m.name);
    }
    if (moodList.length === 0) moodList = ['energetic'];

    let moodStr = moodList.length > 1
      ? `${moodList.slice(0, -1).join(', ')} and ${moodList[moodList.length - 1]}`
      : moodList[0];

    // Build sentence following the dataset's proven prompt pattern
    let prompt = `The genre of the music piece is ${genre}. It is performed with ${instStr}. The tempo is ${tempoDesc} (${bpm} BPM) with a ${moodStr} mood.`;

    if (userText && userText.trim()) {
      prompt += ` ${userText.trim()}`;
    }

    prompt += ` Studio quality, clean mix.`;

    return prompt;
  }

  /**
   * Internal helper to normalize genre strings against known keys.
   */
  _normalizeGenre(raw = '') {
    const clean = raw.toLowerCase().trim();
    if (!this.model || !this.model.genres) return clean;
    if (this.model.genres[clean]) return clean;

    for (const key of Object.keys(this.model.genres)) {
      if (clean.includes(key) || key.includes(clean)) {
        return key;
      }
    }
    return 'electronic';
  }
}

// Expose globally
if (typeof window !== 'undefined') {
  window.MusicTagEngine = MusicTagEngine;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MusicTagEngine };
}
