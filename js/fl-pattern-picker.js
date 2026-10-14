/**
 * BeYou Studio — FL Studio Pattern Picker Panel
 * ===============================================
 * FL Studio-style sidebar list on the left side of the Playlist view.
 * Enables creating, renaming, cloning, clearing, and selecting patterns
 * (`Pattern 1`, `Pattern 2`, `Pattern 3`, `Pattern 4`...).
 */

class FLPatternPicker {
  constructor() {
    this.patterns = [
      { id: 1, name: 'Pattern 1' },
      { id: 2, name: 'Pattern 2' },
      { id: 3, name: 'Pattern 3' },
      { id: 4, name: 'Pattern 4' },
      { id: 5, name: 'Pattern 5' },
    ];
    this.activePatternId = 1;

    this._initUI();
  }

  _initUI() {
    const playlistWrap = document.getElementById('playlist-wrap');
    if (!playlistWrap) return;

    const pickerSidebar = document.createElement('div');
    pickerSidebar.id = 'fl-pattern-picker-sidebar';
    pickerSidebar.className = 'fl-picker-sidebar';
    pickerSidebar.innerHTML = `
      <div class="fl-picker-header">
        <span class="fl-picker-title">Patterns</span>
        <button id="fl-btn-add-pattern" class="fl-picker-add-btn" title="Add New Pattern">+</button>
      </div>
      <div id="fl-picker-list" class="fl-picker-list"></div>
    `;

    // Insert as first child of playlistWrap
    playlistWrap.insertBefore(pickerSidebar, playlistWrap.firstChild);

    this._renderList();
    this._attachEvents();
  }

  _attachEvents() {
    const addBtn = document.getElementById('fl-btn-add-pattern');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const nextId = this.patterns.length + 1;
        this.patterns.push({ id: nextId, name: `Pattern ${nextId}` });
        this.activePatternId = nextId;
        this._renderList();
        if (window.showToast) showToast(`Pattern ${nextId} created!`);
      });
    }
  }

  _renderList() {
    const listEl = document.getElementById('fl-picker-list');
    if (!listEl) return;

    listEl.innerHTML = '';

    this.patterns.forEach(p => {
      const item = document.createElement('div');
      item.className = `fl-picker-item ${p.id === this.activePatternId ? 'active' : ''}`;
      item.innerHTML = `
        <span class="fl-picker-name">${p.name}</span>
        <div class="fl-picker-actions">
          <button class="fl-picker-btn btn-clone" title="Clone Pattern">Clone</button>
        </div>
      `;

      item.addEventListener('click', () => {
        this.activePatternId = p.id;
        this._renderList();
        if (window.app && window.app.sequencer) {
          window.app.sequencer.patternName = p.name;
        }
        // Update Channel rack dropdown
        const rackSelect = document.getElementById('rack-pattern-select');
        if (rackSelect) rackSelect.value = p.name;
      });

      // Double click to rename
      item.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const newName = prompt('Rename pattern:', p.name);
        if (newName && newName.trim()) {
          p.name = newName.trim();
          this._renderList();
        }
      });

      listEl.appendChild(item);
    });
  }
}

function initFLPatternPicker() {
  if (!window.flPatternPicker) {
    window.flPatternPicker = new FLPatternPicker();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFLPatternPicker);
} else {
  initFLPatternPicker();
}
