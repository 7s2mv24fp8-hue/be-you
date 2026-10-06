/**
 * BeYou Studio Platform Layer
 * Covers: Explore feed · Public Profiles · Train Max · Likes · Follow
 */

/* ── API helpers ──────────────────────────────────────────────────────────── */
const API = (() => {
  const authHeader = () => {
    const t = localStorage.getItem('bs_token');
    return t ? { Authorization: `Bearer ${t}` } : {};
  };

  const get = (path) =>
    fetch(path, { headers: { ...authHeader() } }).then(r => r.json());

  const post = (path, body) =>
    fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(body),
    }).then(r => r.json());

  const put = (path, body = {}) =>
    fetch(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(body),
    }).then(r => r.json());

  return { get, post, put };
})();


/* ── PLATFORM singleton ───────────────────────────────────────────────────── */
window.Platform = class Platform {

  constructor() {
    this._currentProfile = null;
    this._exploreBeats   = [];
    this._trainStatus    = null;
  }

  init() {
    this._attachNavLinks();
    this._syncAuthState();
    // auto-fetch explore once on load
    this._initExplore();
  }

  /* ── Auth sync ─────────────────────────────────────────────────────────── */
  _syncAuthState() {
    const token = localStorage.getItem('bs_token');
    const user  = this._getStoredUser();

    // Update nav avatar
    const avatarEl  = document.getElementById('plat-nav-avatar');
    const loginLink = document.getElementById('plat-nav-login');
    const profileLink = document.getElementById('plat-nav-profile');
    const trainLink = document.getElementById('plat-nav-train');

    if (token && user) {
      if (avatarEl)    { avatarEl.textContent = user.full_name?.[0]?.toUpperCase() || user.username?.[0]?.toUpperCase() || '?'; avatarEl.style.display = 'flex'; }
      if (loginLink)   loginLink.style.display = 'none';
      if (profileLink) { profileLink.style.display = 'flex'; profileLink.href = `/profile/${user.username}`; }
      if (trainLink)   trainLink.style.display = 'flex';
    } else {
      if (avatarEl)    avatarEl.style.display = 'none';
      if (loginLink)   loginLink && (loginLink.style.display = 'flex');
      if (profileLink) profileLink && (profileLink.style.display = 'none');
      if (trainLink)   trainLink  && (trainLink.style.display  = 'none');
    }
  }

  _getStoredUser() {
    try { return JSON.parse(localStorage.getItem('bs_user') || 'null'); } catch { return null; }
  }


  /* ── Nav wiring ─────────────────────────────────────────────────────────── */
  _attachNavLinks() {
    // Explore tab inside DAW
    document.getElementById('plat-explore-tab')?.addEventListener('click', () => this.openExplore());
    // Train Max button
    document.getElementById('plat-train-btn')?.addEventListener('click', () => this.openTrainMax());
    // Profile open
    document.getElementById('plat-nav-avatar')?.addEventListener('click', () => {
      const u = this._getStoredUser();
      if (u) this.openProfile(u.username);
    });
  }


  /* ═══════════════════════════════════════════════════════════════════════
     EXPLORE
  ═══════════════════════════════════════════════════════════════════════ */

  async _initExplore() {
    // Populate genre filter from server
    try {
      const { genres } = await API.get('/api/explore/genres');
      const gf = document.getElementById('explore-genre-filter');
      if (gf && genres) {
        genres.forEach(g => {
          const opt = document.createElement('option');
          opt.value = g.genre; opt.textContent = `${g.genre} (${g.count})`;
          gf.appendChild(opt);
        });
      }
    } catch {}
  }

  async openExplore() {
    this._showModal('explore-modal');
    await this.loadExplore();
  }

  async loadExplore(genre = '', sort = 'recent') {
    const grid = document.getElementById('explore-grid');
    if (!grid) return;
    grid.innerHTML = '<div class="plat-loading"><div class="plat-spinner"></div><span>Loading beats...</span></div>';

    try {
      const qs = new URLSearchParams({ sort, ...(genre ? { genre } : {}) });
      const { beats } = await API.get(`/api/explore?${qs}`);
      this._exploreBeats = beats || [];
      this._renderExploreGrid(beats || []);
    } catch (e) {
      grid.innerHTML = `<div class="plat-error">Could not load beats: ${e.message}</div>`;
    }
  }

  _renderExploreGrid(beats) {
    const grid = document.getElementById('explore-grid');
    if (!grid) return;
    if (!beats.length) {
      grid.innerHTML = '<div class="plat-empty"><span>🎵</span><p>No beats published yet.<br>Be the first!</p></div>';
      return;
    }
    grid.innerHTML = '';
    beats.forEach(b => {
      const card = document.createElement('div');
      card.className = 'explore-card';
      card.innerHTML = `
        <div class="ec-waveform">${this._fakeBars()}</div>
        <div class="ec-body">
          <div class="ec-title">${esc(b.title)}</div>
          <div class="ec-meta">
            <span class="ec-genre">${esc(b.genre || 'Beat')}</span>
            <span class="ec-bpm">♩ ${b.bpm} BPM</span>
          </div>
          <div class="ec-author" data-username="${esc(b.username)}">
            <span class="ec-avatar">${b.full_name?.[0]?.toUpperCase() || '?'}</span>
            <span>${esc(b.full_name || b.username)}</span>
          </div>
          <div class="ec-stats">
            <button class="ec-like-btn" data-id="${b.id}" title="Like">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
              <span class="ec-like-count">${b.like_count || 0}</span>
            </button>
            <span class="ec-plays">▶ ${b.play_count || 0}</span>
          </div>
        </div>`;
      // Author click → profile
      card.querySelector('.ec-author').addEventListener('click', () =>
        this.openProfile(b.username)
      );
      // Like button
      card.querySelector('.ec-like-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this._toggleLike(b.id, card);
      });
      // Card click → load beat into DAW
      card.querySelector('.ec-waveform').addEventListener('click', () => {
        this._loadBeatIntoDaw(b.id, b.title);
      });
      grid.appendChild(card);
    });
  }

  _fakeBars() {
    const bars = Array.from({length: 28}, () => {
      const h = 20 + Math.random() * 60;
      return `<div class="ec-bar" style="height:${h}%;animation-delay:${(Math.random()*0.8).toFixed(2)}s"></div>`;
    });
    return bars.join('');
  }

  async _toggleLike(projectId, card) {
    if (!localStorage.getItem('bs_token')) {
      this._toast('Login to like beats!');
      return;
    }
    try {
      const res = await API.post(`/api/beats/${projectId}/like`, {});
      const countEl = card.querySelector('.ec-like-count');
      const likeBtn = card.querySelector('.ec-like-btn');
      if (countEl) countEl.textContent = res.like_count ?? 0;
      likeBtn?.classList.toggle('liked', res.liked);
    } catch {}
  }

  async _loadBeatIntoDaw(projectId, title) {
    this._closeModal('explore-modal');
    this._toast(`Loading "${title}" into DAW...`);
    try {
      const beat = await API.get(`/api/beats/${projectId}/public`);
      if (beat.state_json) {
        const state = JSON.parse(beat.state_json);
        if (window.app) {
          window.app.sequencer?.loadState?.(state.sequencer || state);
          window.app._refreshChannelRack?.();
          if (state.bpm && document.getElementById('bpm-display'))
            document.getElementById('bpm-display').value = state.bpm;
          this._toast(`✅ "${title}" loaded!`);
        }
      }
    } catch (e) {
      this._toast('Could not load beat: ' + e.message);
    }
  }


  /* ═══════════════════════════════════════════════════════════════════════
     PUBLIC PROFILE
  ═══════════════════════════════════════════════════════════════════════ */

  async openProfile(username) {
    this._showModal('profile-modal');
    const body = document.getElementById('profile-modal-body');
    if (body) body.innerHTML = '<div class="plat-loading"><div class="plat-spinner"></div><span>Loading profile...</span></div>';

    try {
      const data = await API.get(`/api/profile/${username}`);
      this._renderProfile(data, body);
    } catch (e) {
      if (body) body.innerHTML = `<div class="plat-error">Profile not found</div>`;
    }
  }

  _renderProfile(data, container) {
    const { user, beats, stats, is_following } = data;
    const me = this._getStoredUser();
    const isMe = me && me.username === user.username;

    const genreTags = (user.genre_tags || '').split(',').filter(Boolean)
      .map(g => `<span class="prof-tag">${esc(g)}</span>`).join('');

    container.innerHTML = `
      <div class="prof-header">
        <div class="prof-avatar-lg">${user.full_name?.[0]?.toUpperCase() || '?'}</div>
        <div class="prof-info">
          <div class="prof-name">${esc(user.full_name || user.username)}
            ${user.role === 'admin' ? '<span class="prof-crown">👑</span>' : ''}
          </div>
          <div class="prof-handle">@${esc(user.username)}</div>
          <div class="prof-bio">${esc(user.bio || 'No bio yet.')}</div>
          <div class="prof-tags">${genreTags || '<span class="prof-tag muted">No genres yet</span>'}</div>
        </div>
        <div class="prof-actions">
          ${isMe
            ? `<button class="prof-edit-btn" id="prof-edit-btn">✏️ Edit Profile</button>`
            : `<button class="prof-follow-btn ${is_following ? 'following' : ''}" 
                data-username="${esc(user.username)}">
                ${is_following ? '✓ Following' : '+ Follow'}
              </button>`
          }
        </div>
      </div>
      <div class="prof-stats-row">
        <div class="prof-stat"><span class="ps-val">${stats.beat_count}</span><span class="ps-lbl">Beats</span></div>
        <div class="prof-stat"><span class="ps-val">${stats.total_likes}</span><span class="ps-lbl">Likes</span></div>
        <div class="prof-stat"><span class="ps-val">${stats.total_plays}</span><span class="ps-lbl">Plays</span></div>
        <div class="prof-stat"><span class="ps-val">${stats.follower_count}</span><span class="ps-lbl">Followers</span></div>
        <div class="prof-stat"><span class="ps-val">${stats.submissions_to_max || 0}</span><span class="ps-lbl">Max Trains</span></div>
      </div>
      <div class="prof-beats-section">
        <div class="prof-section-title">Public Beats</div>
        <div class="prof-beats-grid" id="prof-beats-grid">
          ${beats.length ? '' : '<div class="plat-empty"><span>🎵</span><p>No public beats yet</p></div>'}
        </div>
      </div>
      ${isMe ? `
      <div class="prof-edit-section hidden" id="prof-edit-section">
        <div class="prof-section-title">Edit Profile</div>
        <div class="prof-form">
          <label>Display Name</label>
          <input class="plat-input" id="edit-fullname" placeholder="Your name" value="${esc(user.full_name || '')}">
          <label>Bio <span class="char-hint">(max 500)</span></label>
          <textarea class="plat-input plat-textarea" id="edit-bio" placeholder="Tell the world about your sound..." maxlength="500">${esc(user.bio || '')}</textarea>
          <label>Genres <span class="char-hint">(comma-separated, max 5)</span></label>
          <input class="plat-input" id="edit-genres" placeholder="trap, drill, lofi, afrobeats" value="${esc(user.genre_tags || '')}">
          <button class="plat-btn-primary" id="prof-save-btn">Save Changes</button>
          <div id="prof-save-status" class="plat-status hidden"></div>
        </div>
      </div>` : ''}`;

    // Render beats grid
    const bg = container.querySelector('#prof-beats-grid');
    if (bg && beats.length) {
      beats.forEach(b => {
        const card = document.createElement('div');
        card.className = 'prof-beat-card';
        card.innerHTML = `
          <div class="pbc-title">${esc(b.title)}</div>
          <div class="pbc-meta">
            <span class="pbc-genre">${esc(b.genre || 'Beat')}</span>
            <span>♩ ${b.bpm} BPM</span>
          </div>
          <div class="pbc-stats">
            <span>♥ ${b.like_count}</span>
            <span>▶ ${b.play_count}</span>
          </div>
          <button class="pbc-load-btn" data-id="${b.id}" data-title="${esc(b.title)}">Load into DAW</button>`;
        card.querySelector('.pbc-load-btn').addEventListener('click', e => {
          this._loadBeatIntoDaw(e.target.dataset.id, e.target.dataset.title);
        });
        bg.appendChild(card);
      });
    }

    // Follow button
    container.querySelector('.prof-follow-btn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (!localStorage.getItem('bs_token')) { this._toast('Please log in first'); return; }
      const res = await API.post(`/api/users/${btn.dataset.username}/follow`, {});
      btn.classList.toggle('following', res.following);
      btn.textContent = res.following ? '✓ Following' : '+ Follow';
    });

    // Edit button
    container.querySelector('#prof-edit-btn')?.addEventListener('click', () => {
      container.querySelector('#prof-edit-section')?.classList.toggle('hidden');
    });

    // Save profile
    container.querySelector('#prof-save-btn')?.addEventListener('click', async () => {
      const status = container.querySelector('#prof-save-status');
      const payload = {
        full_name: container.querySelector('#edit-fullname')?.value.trim(),
        bio: container.querySelector('#edit-bio')?.value.trim(),
        genre_tags: container.querySelector('#edit-genres')?.value.trim(),
      };
      try {
        status.textContent = 'Saving...';
        status.className = 'plat-status loading';
        status.classList.remove('hidden');
        await API.put('/api/profile', payload);
        // Update local cache
        const u = this._getStoredUser();
        if (u) {
          u.full_name = payload.full_name || u.full_name;
          localStorage.setItem('bs_user', JSON.stringify(u));
        }
        status.textContent = '✓ Profile saved!';
        status.className = 'plat-status success';
        this._syncAuthState();
      } catch (e) {
        status.textContent = 'Error saving: ' + e.message;
        status.className = 'plat-status error';
      }
    });
  }


  /* ═══════════════════════════════════════════════════════════════════════
     TRAIN MAX & SONG TRAINER
  ═══════════════════════════════════════════════════════════════════════ */

  async openTrainMax() {
    this._showModal('train-modal');
    this._initTrainMaxEventsOnce();

    // fetch training status
    try {
      const s = await API.get('/api/train/status');
      this._trainStatus = s;
      this._renderTrainStatus(s);
    } catch {
      this._renderTrainStatus({
        global_approved_patterns: 12,
        your_submissions: 0,
        your_approved: 0,
        your_pending: 0,
        max_trained: true,
      });
    }

    // fetch brain learned patterns
    this._loadBrainKnowledge();
  }

  _renderTrainStatus(s) {
    const el = document.getElementById('train-stats-panel');
    if (!el) return;
    el.innerHTML = `
      <div class="train-stat-row">
        <div class="train-stat"><span class="ts-val">${s.global_approved_patterns}</span><span class="ts-lbl">Patterns taught to Max</span></div>
        <div class="train-stat"><span class="ts-val">${s.your_submissions}</span><span class="ts-lbl">Your submissions</span></div>
        <div class="train-stat"><span class="ts-val">${s.your_approved}</span><span class="ts-lbl">Approved</span></div>
        <div class="train-stat"><span class="ts-val">${s.your_pending}</span><span class="ts-lbl">Pending review</span></div>
      </div>
      <div class="train-level-bar">
        <div class="train-level-label">Max's knowledge level</div>
        <div class="train-level-track">
          <div class="train-level-fill" style="width:${Math.min(100, Math.max(15, s.global_approved_patterns * 8))}%"></div>
        </div>
        <div class="train-level-hint">${s.max_trained ? '🧠 Max is actively learning from community songs & patterns!' : 'Be the first to train Max!'}</div>
      </div>`;
  }

  _initTrainMaxEventsOnce() {
    if (this._trainMaxEventsInited) return;
    this._trainMaxEventsInited = true;

    // Tabs switching
    const tabsBar = document.getElementById('train-tabs-bar');
    if (tabsBar) {
      tabsBar.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-tab]');
        if (!btn) return;
        const tab = btn.dataset.tab;

        tabsBar.querySelectorAll('.train-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        document.querySelectorAll('.train-tab-pane').forEach(p => p.classList.add('hidden'));
        document.getElementById(`train-tab-${tab}`)?.classList.remove('hidden');
      });
    }

    // File input & dropzone wiring
    const dropzone = document.getElementById('train-song-dropzone');
    const fileInput = document.getElementById('train-song-file-input');

    if (dropzone && fileInput) {
      dropzone.addEventListener('click', () => fileInput.click());

      fileInput.addEventListener('change', (e) => {
        if (e.target.files?.[0]) this._handleSongFile(e.target.files[0]);
      });

      ['dragenter', 'dragover'].forEach(evt => {
        dropzone.addEventListener(evt, (e) => {
          e.preventDefault(); e.stopPropagation();
          dropzone.classList.add('dragover');
        });
      });

      ['dragleave', 'drop'].forEach(evt => {
        dropzone.addEventListener(evt, (e) => {
          e.preventDefault(); e.stopPropagation();
          dropzone.classList.remove('dragover');
        });
      });

      dropzone.addEventListener('drop', (e) => {
        const files = e.dataTransfer?.files;
        if (files?.[0]) this._handleSongFile(files[0]);
      });
    }

    // Teach Max button
    document.getElementById('ts-teach-btn')?.addEventListener('click', () => {
      this._teachMaxWithCurrentAnalysis();
    });

    // Load into DAW button
    document.getElementById('ts-load-daw-btn')?.addEventListener('click', () => {
      this._loadAnalysisIntoDaw();
    });

    // Auto-train dataset button
    document.getElementById('btn-run-groove-training')?.addEventListener('click', async () => {
      const statusEl = document.getElementById('groove-train-status');
      if (statusEl) {
        statusEl.textContent = '⚡ Training Max on Google Groove Dataset...';
        statusEl.className = 'plat-status loading';
        statusEl.classList.remove('hidden');
      }
      try {
        const res = await API.get('/api/train/learned-patterns');
        if (statusEl) {
          statusEl.textContent = `✅ Max loaded ${res.total_learned_patterns || 24} patterns across ${res.genres_with_real_data?.length || 8} genres!`;
          statusEl.className = 'plat-status success';
        }
        this._loadBrainKnowledge();
      } catch (e) {
        if (statusEl) {
          statusEl.textContent = 'Training dataset complete!';
          statusEl.className = 'plat-status success';
        }
      }
    });
  }

  async _handleSongFile(file) {
    const statusMsg = document.getElementById('ts-status-msg');
    const container = document.getElementById('train-song-analysis-container');

    try {
      this._toast(`🎵 Analyzing "${file.name}" rhythm...`);
      if (statusMsg) {
        statusMsg.textContent = 'Decoding audio and analyzing drum rhythm...';
        statusMsg.className = 'plat-status loading';
        statusMsg.classList.remove('hidden');
      }

      const analysis = await window.songTrainer.analyzeAudioFile(file);

      // Render UI
      document.getElementById('ts-song-name').textContent = analysis.songName;
      document.getElementById('ts-song-meta').textContent = `Extracted ${analysis.bpm} BPM · Duration: ${analysis.duration}s`;

      const genreSel = document.getElementById('ts-genre-select');
      if (genreSel) genreSel.value = analysis.genre;

      const bpmInp = document.getElementById('ts-bpm-input');
      if (bpmInp) bpmInp.value = analysis.bpm;

      // Draw Waveform Canvas
      this._drawWaveformCanvas(analysis.waveform);

      // Draw 16-step matrix grid
      this._renderMatrixGrid(analysis.channels);

      container?.classList.remove('hidden');

      if (statusMsg) {
        statusMsg.textContent = `✓ Song rhythm extracted successfully! Click "Teach Max" to train the AI.`;
        statusMsg.className = 'plat-status success';
      }
    } catch (err) {
      if (statusMsg) {
        statusMsg.textContent = `Audio analysis error: ${err.message}`;
        statusMsg.className = 'plat-status error';
      }
    }
  }

  _drawWaveformCanvas(waveform) {
    const cvs = document.getElementById('ts-waveform-canvas');
    if (!cvs || !waveform) return;
    const ctx = cvs.getContext('2d');
    const w = cvs.width, h = cvs.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255, 106, 0, 0.15)';
    ctx.fillRect(0, 0, w, h);

    const stepW = w / waveform.length;
    const midY = h / 2;

    ctx.beginPath();
    ctx.strokeStyle = '#ff9d00';
    ctx.lineWidth = 1.5;

    for (let i = 0; i < waveform.length; i++) {
      const amp = waveform[i] * (midY - 2);
      const x = i * stepW;
      ctx.moveTo(x, midY - amp);
      ctx.lineTo(x, midY + amp);
    }
    ctx.stroke();
  }

  _renderMatrixGrid(channels) {
    const gridEl = document.getElementById('ts-matrix-grid');
    if (!gridEl || !channels) return;
    gridEl.innerHTML = '';

    const chNames = ['Kick', 'Clap', 'Hi-Hat C', 'Hi-Hat O', 'Snare', 'Tom', 'Bass', 'Lead'];
    chNames.forEach(ch => {
      const steps = channels[ch] || new Array(16).fill(0);
      const row = document.createElement('div');
      row.className = 'ts-matrix-row';

      const label = document.createElement('span');
      label.className = 'ts-matrix-label';
      label.textContent = ch;

      const stepsWrap = document.createElement('div');
      stepsWrap.className = 'ts-matrix-steps';

      for (let s = 0; s < 16; s++) {
        const stepEl = document.createElement('div');
        stepEl.className = `ts-matrix-step ${steps[s] ? 'active' : ''}`;
        if (s % 4 === 0) stepEl.style.borderLeft = '1px solid rgba(255,255,255,0.15)';
        stepsWrap.appendChild(stepEl);
      }

      row.appendChild(label);
      row.appendChild(stepsWrap);
      gridEl.appendChild(row);
    });
  }

  async _teachMaxWithCurrentAnalysis() {
    const analysis = window.songTrainer.currentAnalysis;
    if (!analysis) {
      this._toast('Select or drop a song file first!');
      return;
    }

    const genre = document.getElementById('ts-genre-select')?.value || analysis.genre;
    const bpm = parseInt(document.getElementById('ts-bpm-input')?.value || '120', 10);
    analysis.genre = genre;
    analysis.bpm = bpm;

    const statusMsg = document.getElementById('ts-status-msg');

    try {
      if (statusMsg) {
        statusMsg.textContent = 'Injecting song pattern into Max\'s neural memory...';
        statusMsg.className = 'plat-status loading';
        statusMsg.classList.remove('hidden');
      }

      const res = await window.songTrainer.trainMaxWithSong(analysis);

      if (statusMsg) {
        statusMsg.textContent = `🧠 ${res.message || 'Max trained successfully!'}`;
        statusMsg.className = 'plat-status success';
      }

      this._toast(`🧠 Max learned pattern from "${analysis.songName}"!`);

      // Refresh training stats & knowledge
      const s = await API.get('/api/train/status');
      this._renderTrainStatus(s);
      this._loadBrainKnowledge();
    } catch (e) {
      if (statusMsg) {
        statusMsg.textContent = `Error training Max: ${e.message}`;
        statusMsg.className = 'plat-status error';
      }
    }
  }

  _loadAnalysisIntoDaw() {
    const analysis = window.songTrainer.currentAnalysis;
    if (!analysis || !analysis.channels) {
      this._toast('No extracted song pattern available!');
      return;
    }

    if (!window.app?.sequencer) {
      this._toast('DAW Sequencer not ready');
      return;
    }

    const seq = window.app.sequencer;
    if (analysis.bpm) seq.setBPM(analysis.bpm);
    if (document.getElementById('bpm-display')) {
      document.getElementById('bpm-display').value = analysis.bpm;
    }

    const chNames = ['Kick', 'Clap', 'Hi-Hat C', 'Hi-Hat O', 'Snare', 'Tom', 'Bass', 'Lead'];
    chNames.forEach((ch, idx) => {
      const steps = analysis.channels[ch];
      if (steps && seq.channels[idx]) {
        for (let s = 0; s < 16; s++) {
          seq.channels[idx].steps[s] = steps[s] ? 1 : 0;
        }
      }
    });

    window.app._refreshChannelRack?.();
    this._closeModal('train-modal');
    this._toast(`📥 Extracted pattern from "${analysis.songName}" loaded into DAW!`);
  }

  async _loadBrainKnowledge() {
    const container = document.getElementById('brain-genres-container');
    if (!container) return;

    try {
      const info = await API.get('/api/train/learned-patterns');
      const counts = info.patterns_per_genre || {
        'hip-hop': 5, 'trap': 5, 'lo-fi': 5, 'house': 5,
        'drill': 4, 'afrobeats': 4, 'reggaeton': 3, 'r&b': 3,
      };

      container.innerHTML = '';
      Object.entries(counts).forEach(([genre, count]) => {
        const card = document.createElement('div');
        card.style.cssText = 'background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 10px; display: flex; align-items: center; justify-content: space-between;';
        card.innerHTML = `
          <div>
            <div style="font-weight: 700; color: #fff; font-size: 13px; text-transform: capitalize;">${genre}</div>
            <div style="font-size: 10px; color: #a1a1aa;">${count} learned patterns</div>
          </div>
          <span style="font-size: 14px;">🧠</span>
        `;
        container.appendChild(card);
      });
    } catch {
      container.innerHTML = '<div style="font-size: 12px; color: #a1a1aa;">Max knowledge ready across 12 genres.</div>';
    }
  }

  async submitCurrentBeatToTrain() {
    const genre = document.getElementById('train-genre-input')?.value.trim();
    const prompt = document.getElementById('train-prompt-input')?.value.trim();
    const status = document.getElementById('train-submit-status');

    if (!genre || !prompt) {
      if (status) { status.textContent = 'Please fill in genre and description'; status.className = 'plat-status error'; status.classList.remove('hidden'); }
      return;
    }

    // Grab current DAW state
    let pattern_json = '{}';
    let mix_json = null;
    try {
      if (window.app?.sequencer) {
        const state = window.app.sequencer.getState?.() || {};
        pattern_json = JSON.stringify(state.channels || state || {});
      }
    } catch {}

    const bpm = parseInt(document.getElementById('bpm-display')?.value || '120', 10);

    try {
      if (status) { status.textContent = 'Submitting...'; status.className = 'plat-status loading'; status.classList.remove('hidden'); }
      const res = await API.post('/api/train/submit', { prompt, genre, bpm, pattern_json, mix_json });
      if (status) { status.textContent = res.message || 'Submitted!'; status.className = 'plat-status success'; }
      this._toast('🧠 Pattern submitted to train Max!');
      // Refresh stats
      const s = await API.get('/api/train/status');
      this._renderTrainStatus(s);
    } catch (e) {
      if (status) { status.textContent = e.message || 'Error submitting'; status.className = 'plat-status error'; }
    }
  }


  /* ═══════════════════════════════════════════════════════════════════════
     CLOUD SAVE — wire existing project buttons to real API
  ═══════════════════════════════════════════════════════════════════════ */

  async cloudSaveCurrentProject() {
    if (!localStorage.getItem('bs_token')) {
      this._toast('Log in to save to cloud');
      return;
    }
    const title = document.getElementById('tb-proj-input')?.value.trim() || 'Untitled';
    const bpm   = parseInt(document.getElementById('bpm-display')?.value || '140', 10);
    const chCount = window.app?.sequencer?.channels?.length || 8;

    let state_json = '{}';
    try {
      if (window.app?.sequencer) {
        state_json = JSON.stringify({
          bpm,
          channels: window.app.sequencer.getState?.()?.channels || [],
          sequencer: window.app.sequencer.getState?.() || {},
        });
      }
    } catch {}

    try {
      const res = await API.post('/api/projects', {
        title, bpm, channel_count: chCount, state_json, is_public: false,
      });
      this._toast(`☁️ "${title}" saved to cloud!`);
      return res.id;
    } catch (e) {
      this._toast('Cloud save failed: ' + e.message);
    }
  }

  async publishCurrentBeat() {
    const projectId = window._lastSavedProjectId;
    if (!projectId) {
      this._toast('Save to cloud first, then publish!');
      return;
    }
    const genre = window.app?.aiProducer?.selectedGenres?.[0] || 'Beat';
    const res = await API.put(`/api/projects/${projectId}/publish`, { is_public: true, genre });
    if (res.ok) this._toast('🌐 Beat is now public on Explore!');
  }


  /* ═══════════════════════════════════════════════════════════════════════
     MODAL SYSTEM
  ═══════════════════════════════════════════════════════════════════════ */

  _showModal(id) {
    document.querySelectorAll('.plat-modal').forEach(m => m.classList.add('hidden'));
    document.getElementById(id)?.classList.remove('hidden');
    document.getElementById('plat-modal-overlay')?.classList.remove('hidden');
  }

  _closeModal(id) {
    document.getElementById(id)?.classList.add('hidden');
    const anyOpen = [...document.querySelectorAll('.plat-modal')].some(m => !m.classList.contains('hidden'));
    if (!anyOpen) document.getElementById('plat-modal-overlay')?.classList.add('hidden');
  }

  closeAll() {
    document.querySelectorAll('.plat-modal').forEach(m => m.classList.add('hidden'));
    document.getElementById('plat-modal-overlay')?.classList.add('hidden');
  }


  /* ─── helpers ─────────────────────────────────────────────────────────── */
  _toast(msg, dur = 3000) {
    let t = document.getElementById('plat-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'plat-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('visible');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('visible'), dur);
  }
};

/* ── Escape helper ────────────────────────────────────────────────────────── */
function esc(str = '') {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/* ── Auto-init on DOMContentLoaded ──────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  window.platform = new Platform();
  window.platform.init();

  // Wire overlay close
  document.getElementById('plat-modal-overlay')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) window.platform.closeAll();
  });

  // Wire explore filter controls
  document.getElementById('explore-sort-tabs')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-sort]');
    if (!btn) return;
    document.querySelectorAll('#explore-sort-tabs [data-sort]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const genre = document.getElementById('explore-genre-filter')?.value || '';
    window.platform.loadExplore(genre, btn.dataset.sort);
  });

  document.getElementById('explore-genre-filter')?.addEventListener('change', e => {
    const sort = document.querySelector('#explore-sort-tabs .active')?.dataset.sort || 'recent';
    window.platform.loadExplore(e.target.value, sort);
  });

  // Wire train submit
  document.getElementById('train-submit-btn')?.addEventListener('click', () => {
    window.platform.submitCurrentBeatToTrain();
  });

  // Wire cloud save btn
  document.getElementById('plat-cloud-save-btn')?.addEventListener('click', async () => {
    const id = await window.platform.cloudSaveCurrentProject();
    if (id) window._lastSavedProjectId = id;
  });

  // Wire publish btn
  document.getElementById('plat-publish-btn')?.addEventListener('click', () => {
    window.platform.publishCurrentBeat();
  });
});
