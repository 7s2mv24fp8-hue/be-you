/**
 * BeYou Studio — Max Knowledge Engine
 * ====================================
 * Loads the CoT Music Production DAW dataset (7,000 Q&A pairs) and provides
 * fast fuzzy search so Max can answer music production questions intelligently.
 *
 * Dataset: mattwesney/CoT_Music_Production_DAW (Hugging Face)
 * Topics: FL Studio, Ableton Live, Mixing, Sound Design, Synthesis, MIDI, etc.
 */

'use strict';

class MaxKnowledgeEngine {
  constructor() {
    this.entries = [];          // {q, a, t} — question, answer, topic
    this.index = {};            // keyword → [entry indices]
    this.loaded = false;
    this.loading = false;
    this._loadPromise = null;
  }

  /**
   * Load the knowledge base JSON from the server.
   * Safe to call multiple times — only loads once.
   */
  async load() {
    if (this.loaded) return true;
    if (this._loadPromise) return this._loadPromise;

    this._loadPromise = (async () => {
      this.loading = true;
      try {
        const resp = await fetch('/data/max_knowledge.json');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const kb = await resp.json();
        this.entries = kb.entries || [];
        this.index = kb.index || {};
        this.loaded = true;
        this.loading = false;
        console.log(`[MaxKB] Loaded ${this.entries.length} knowledge entries, ${Object.keys(this.index).length} index terms`);
        return true;
      } catch (err) {
        console.warn('[MaxKB] Failed to load knowledge base:', err.message);
        this.loading = false;
        this._loadPromise = null;
        return false;
      }
    })();

    return this._loadPromise;
  }

  /**
   * Search the knowledge base for the best matching Q&A entries.
   * Uses TF-IDF-like keyword scoring against the inverted index.
   *
   * @param {string} query - User's question text
   * @param {number} topK - Number of results to return (default 3)
   * @returns {Array<{question: string, answer: string, topic: string, score: number}>}
   */
  search(query, topK = 3) {
    if (!this.loaded || this.entries.length === 0) return [];

    const queryWords = this._tokenize(query);
    if (queryWords.length === 0) return [];

    // Score each entry by how many query keywords match via the index
    const scores = new Map();

    for (const word of queryWords) {
      const matchingIndices = this.index[word];
      if (!matchingIndices) continue;

      // IDF-like weight: rarer words score higher
      const idf = Math.log(this.entries.length / (matchingIndices.length + 1));

      for (const idx of matchingIndices) {
        const prev = scores.get(idx) || 0;
        scores.set(idx, prev + idf);
      }
    }

    if (scores.size === 0) return [];

    // Sort by score descending and take top K
    const sorted = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK);

    return sorted.map(([idx, score]) => {
      const entry = this.entries[idx];
      return {
        question: entry.q,
        answer: entry.a,
        topic: entry.t,
        score: Math.round(score * 100) / 100,
      };
    });
  }

  /**
   * Get a natural-language answer for a user question.
   * Returns the best matching answer formatted for display, or null if no match.
   *
   * @param {string} query - User's question
   * @returns {string|null} Formatted answer or null
   */
  getAnswer(query) {
    const results = this.search(query, 3);
    if (results.length === 0) return null;

    const best = results[0];

    // Only return if the match is reasonably strong
    // (at least 2 keyword matches worth of score)
    if (best.score < 3) return null;

    let response = '';

    // Format the best answer
    response += `<div class="max-kb-answer">`;
    response += `<div class="max-kb-topic">📚 ${this._escapeHtml(best.topic)}</div>`;
    response += `<div class="max-kb-text">${this._formatAnswer(best.answer)}</div>`;

    // If there are other good matches, mention them
    if (results.length > 1 && results[1].score > 3) {
      response += `<div class="max-kb-related">`;
      response += `<strong>Related:</strong> `;
      response += results.slice(1).filter(r => r.score > 3)
        .map(r => `<span class="max-kb-related-topic">${this._escapeHtml(r.topic)}</span>`)
        .join(' · ');
      response += `</div>`;
    }

    response += `</div>`;
    return response;
  }

  /**
   * Check if the user's text looks like a question Max can answer from the KB.
   * Returns true if it's a knowledge query rather than a DAW command.
   */
  isKnowledgeQuery(text) {
    const lower = text.toLowerCase().trim();

    // Explicit question patterns
    if (/^(how|what|why|when|where|can|does|is|are|should|which|explain|tell me|help me|teach|describe|difference|compare)\b/.test(lower)) {
      return true;
    }

    // Question mark at end
    if (lower.endsWith('?')) return true;

    // Asking about concepts
    if (/\b(tutorial|guide|tip|advice|help with|learn|understand|meaning|definition)\b/.test(lower)) {
      return true;
    }

    return false;
  }

  // ─── Private helpers ──────────────────────────────────────────────────

  _tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2)
      .filter(w => !this._isStopword(w));
  }

  _isStopword(word) {
    const stops = new Set([
      'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can',
      'had', 'her', 'was', 'one', 'our', 'out', 'has', 'its', 'how',
      'did', 'get', 'has', 'him', 'his', 'she', 'let', 'may', 'say',
      'who', 'why', 'too', 'use', 'way', 'each', 'make', 'like',
      'does', 'just', 'over', 'such', 'take', 'than', 'them', 'very',
      'when', 'what', 'with', 'from', 'this', 'that', 'they', 'been',
      'have', 'many', 'some', 'will', 'more', 'into', 'also', 'your',
      'would', 'could', 'should', 'about', 'which', 'their', 'there',
      'these', 'those', 'being', 'other', 'after', 'before',
    ]);
    return stops.has(word);
  }

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  _formatAnswer(text) {
    // Convert markdown-like formatting to HTML
    let html = this._escapeHtml(text);

    // Bold: **text**
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Code: `text`
    html = html.replace(/`(.+?)`/g, '<code>$1</code>');

    // List items: - text or * text
    html = html.replace(/^[\-\*]\s+(.+)$/gm, '<li>$1</li>');

    // Headers: ### text
    html = html.replace(/^###\s+(.+)$/gm, '<div class="max-kb-heading">$1</div>');

    // Line breaks
    html = html.replace(/\n/g, '<br>');

    // Wrap consecutive <li> in <ul>
    html = html.replace(/((?:<li>.*?<\/li>\s*<br>?)+)/g, '<ul>$1</ul>');

    return html;
  }

  /**
   * Get stats about the loaded knowledge base.
   */
  getStats() {
    return {
      loaded: this.loaded,
      entries: this.entries.length,
      indexTerms: Object.keys(this.index).length,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Expose
// ─────────────────────────────────────────────────────────────────────────────
window.MaxKnowledgeEngine = MaxKnowledgeEngine;
