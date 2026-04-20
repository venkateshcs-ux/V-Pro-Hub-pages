// views/settings.js — F7 Settings View
// Manages PAT, username, health check interval.
// Also handles guided PAT rotation flow.
// Changes saved to localStorage and applied to CONFIG in memory.
// config.js remains the base; localStorage overrides on load.

window.SettingsView = (() => {

  const STORAGE_KEY    = 'vpro_settings';
  const ROTATION_KEY   = 'vpro_pat_rotated';   // 'true' once rotation confirmed

  // ── Read / write overrides ─────────────────────

  function loadOverrides() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch { return {}; }
  }

  function saveOverrides(overrides) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    Object.assign(CONFIG, overrides);
  }

  function clearOverrides() {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  }

  // ── PAT rotation state ─────────────────────────

  function isRotationDone() {
    return localStorage.getItem(ROTATION_KEY) === 'true';
  }

  function markRotationDone() {
    localStorage.setItem(ROTATION_KEY, 'true');
  }

  // ── Mask PAT for display ───────────────────────

  function maskPat(pat) {
    if (!pat || pat.length < 8) return '••••••••';
    return pat.substring(0, 4) + '••••••••' + pat.slice(-4);
  }

  // ── Rotation banner ────────────────────────────

  function renderRotationBanner() {
    if (isRotationDone()) return '';
    return `
    <div class="rotation-banner" id="rotation-banner">
      <span class="rotation-banner-icon">⚠</span>
      <div class="rotation-banner-body">
        <strong>PAT rotation required</strong>
        <span class="rotation-banner-sub">Your token was exposed during bootstrap. Rotate it below before continuing.</span>
      </div>
      <button class="rotation-banner-goto" id="btn-goto-rotation">Rotate now ↓</button>
    </div>`;
  }

  // ── Rotation panel ─────────────────────────────

  function renderRotationPanel() {
    const done = isRotationDone();
    return `
    <div class="settings-section rotation-section" id="rotation-section">
      <div class="settings-section-title">
        PAT Rotation
        ${done
          ? '<span class="rotation-done-badge">✓ Rotated</span>'
          : '<span class="rotation-warn-badge">⚠ Action required</span>'}
      </div>

      ${done ? `
        <div class="rotation-complete">
          <p class="field-hint">PAT has been rotated. Connection is using the new token.</p>
          <button class="btn-reopen-rotation" id="btn-reopen-rotation">Rotate again</button>
        </div>
      ` : `
        <div class="rotation-steps" id="rotation-steps">

          <div class="rotation-step">
            <div class="rotation-step-num">1</div>
            <div class="rotation-step-body">
              <div class="rotation-step-title">Revoke the old token</div>
              <p class="field-hint">Open GitHub PAT settings, find the current token and click <strong>Delete</strong>.</p>
              <a class="btn-gh-link" href="https://github.com/settings/tokens" target="_blank" rel="noopener">
                Open GitHub PAT settings ↗
              </a>
            </div>
          </div>

          <div class="rotation-step">
            <div class="rotation-step-num">2</div>
            <div class="rotation-step-body">
              <div class="rotation-step-title">Generate a new token</div>
              <p class="field-hint">
                Click <strong>Generate new token (classic)</strong>. Set scopes to
                <code class="md-inline-code">repo</code> only — remove <code class="md-inline-code">gist</code>
                and <code class="md-inline-code">workflow</code> if present.
                Copy the new token before closing.
              </p>
              <a class="btn-gh-link" href="https://github.com/settings/tokens/new" target="_blank" rel="noopener">
                Create new token ↗
              </a>
            </div>
          </div>

          <div class="rotation-step">
            <div class="rotation-step-num">3</div>
            <div class="rotation-step-body">
              <div class="rotation-step-title">Paste and verify</div>
              <p class="field-hint">Paste the new token below. Click <strong>Test &amp; Save</strong> — the app will verify it connects, then save it.</p>
              <div class="field-row" style="margin-top:10px">
                <input
                  type="password"
                  id="input-new-pat"
                  class="field-input"
                  placeholder="ghp_••••••••••••  or  github_pat_••••"
                  autocomplete="new-password"
                >
                <button class="btn-toggle-pat field-btn" data-target="input-new-pat">Show</button>
              </div>
              <div style="margin-top:10px;display:flex;gap:8px;align-items:center">
                <button class="btn-test-save" id="btn-test-save">Test &amp; Save</button>
                <span class="rotation-test-status" id="rotation-test-status"></span>
              </div>
              <p class="field-hint" style="margin-top:8px">
                After saving: update <code class="md-inline-code">config.js</code> with the new token so it survives page reload.
                Your next <code class="md-inline-code">git push</code> will update Windows Credential Manager automatically.
              </p>
            </div>
          </div>

        </div>
      `}
    </div>`;
  }

  // ── Bitbucket section ─────────────────────────

  function renderBitbucketSection() {
    const bb = CONFIG.bitbucket;
    if (!bb || !bb.workspace || !bb.tokens) {
      return `
      <div class="settings-section">
        <div class="settings-section-title">Bitbucket</div>
        <p class="field-hint muted">No Bitbucket configuration found in config.js.
          Add a <code class="md-inline-code">bitbucket</code> block or a Bitbucket entry in
          <code class="md-inline-code">providers[]</code> to enable.</p>
      </div>`;
    }

    const slugs = Object.keys(bb.tokens);
    const rows  = slugs.map(slug => `
      <div class="bb-repo-row" id="bb-row-${CSS.escape(slug)}">
        <span class="bb-repo-slug field-mono">${slug}</span>
        <span class="bb-repo-token field-mono">${maskPat(bb.tokens[slug])}</span>
        <button class="btn-bb-test field-btn" data-slug="${escAttr(slug)}">Test</button>
        <span class="bb-test-status" id="bb-status-${CSS.escape(slug)}"></span>
      </div>`).join('');

    return `
    <div class="settings-section">
      <div class="settings-section-title">Bitbucket</div>
      <div class="settings-field">
        <label class="field-label">Workspace</label>
        <p class="field-current"><span class="field-mono">${bb.workspace}</span>
          <span class="source-badge">from config.js</span></p>
      </div>
      <div class="settings-field">
        <label class="field-label">Configured repos (${slugs.length})</label>
        <p class="field-hint">Tier 3 per-repo tokens — Bearer auth. Click Test to verify each token.</p>
        <div class="bb-repo-list">${rows}</div>
      </div>
    </div>`;
  }

  // ── Main render ────────────────────────────────

  function render(container) {
    const overrides = loadOverrides();
    const effective = { ...CONFIG, ...overrides };

    container.innerHTML = `
    ${renderRotationBanner()}

    <div class="settings-header">
      <h1 class="settings-title">Settings</h1>
      <p class="settings-sub muted">Changes are saved to localStorage and applied immediately. config.js remains unchanged.</p>
    </div>

    <div class="settings-sections">

      <!-- Auth -->
      <div class="settings-section">
        <div class="settings-section-title">Authentication</div>

        <div class="settings-field">
          <label class="field-label">GitHub PAT</label>
          <p class="field-hint">Personal Access Token — requires <code class="md-inline-code">repo</code> scope.</p>
          <div class="field-row">
            <input
              type="password"
              id="input-pat"
              class="field-input"
              placeholder="ghp_••••••••••••"
              value="${escAttr(effective.pat || '')}"
              autocomplete="new-password"
            >
            <button class="btn-toggle-pat field-btn" data-target="input-pat">Show</button>
          </div>
          <p class="field-current">Current: <span class="field-mono">${maskPat(effective.pat)}</span>
            ${overrides.pat ? '<span class="override-badge">overridden</span>' : '<span class="source-badge">from config.js</span>'}
          </p>
        </div>

        <div class="settings-field">
          <label class="field-label">GitHub Username</label>
          <input
            type="text"
            id="input-username"
            class="field-input"
            placeholder="venkateshcs-ux"
            value="${escAttr(effective.username || '')}"
          >
          <p class="field-current">Current: <span class="field-mono">${effective.username || '—'}</span>
            ${overrides.username ? '<span class="override-badge">overridden</span>' : '<span class="source-badge">from config.js</span>'}
          </p>
        </div>
      </div>

      <!-- Dashboard -->
      <div class="settings-section">
        <div class="settings-section-title">Dashboard</div>

        <div class="settings-field">
          <label class="field-label">Health Check Interval (minutes)</label>
          <p class="field-hint">How often the dashboard refreshes repo status.</p>
          <input
            type="number"
            id="input-interval"
            class="field-input field-input-sm"
            min="1" max="60"
            value="${escAttr(String(effective.healthCheckInterval || 15))}"
          >
          <p class="field-current">Current: <span class="field-mono">${effective.healthCheckInterval || 15} min</span>
            ${overrides.healthCheckInterval ? '<span class="override-badge">overridden</span>' : '<span class="source-badge">from config.js</span>'}
          </p>
        </div>
      </div>

      <!-- Bitbucket -->
      ${renderBitbucketSection()}

      <!-- PAT Rotation -->
      ${renderRotationPanel()}

      <!-- Actions -->
      <div class="settings-actions">
        <button class="btn-save" id="btn-save-settings">Save changes</button>
        <button class="btn-reset" id="btn-reset-settings">Reset to config.js defaults</button>
      </div>

      <!-- Status message -->
      <div class="settings-status" id="settings-status"></div>

      <!-- Info -->
      <div class="settings-info">
        <div class="info-row"><span class="info-label">config.js PAT</span><span class="info-value field-mono">${maskPat(CONFIG.pat)}</span></div>
        <div class="info-row"><span class="info-label">localStorage overrides</span><span class="info-value field-mono">${Object.keys(overrides).length > 0 ? Object.keys(overrides).join(', ') : 'none'}</span></div>
        <div class="info-row"><span class="info-label">PAT scopes</span><span class="info-value field-mono">repo (target — rotate to fix)</span></div>
      </div>

    </div>`;

    wireEvents(container);
  }

  // ── Wire all events ────────────────────────────

  function wireEvents(container) {

    // Bitbucket per-repo connection test
    container.querySelectorAll('.btn-bb-test').forEach(btn => {
      btn.addEventListener('click', async function () {
        const slug     = this.dataset.slug;
        const statusEl = container.querySelector(`#bb-status-${CSS.escape(slug)}`);
        this.disabled  = true;
        this.textContent = 'Testing…';
        if (statusEl) { statusEl.textContent = ''; statusEl.className = 'bb-test-status'; }

        try {
          const bb = CONFIG.bitbucket;
          const adapter = new BitbucketAdapter({ workspace: bb.workspace, tokens: bb.tokens });
          await adapter.getRepo(bb.workspace, slug);
          if (statusEl) { statusEl.textContent = '✓ Connected'; statusEl.className = 'bb-test-status bb-test-ok'; }
        } catch (err) {
          if (statusEl) { statusEl.textContent = `✕ ${err.message}`; statusEl.className = 'bb-test-status bb-test-err'; }
        } finally {
          this.disabled    = false;
          this.textContent = 'Test';
        }
      });
    });

    // Toggle PAT visibility (main input)
    container.querySelectorAll('.btn-toggle-pat').forEach(btn => {
      btn.addEventListener('click', function() {
        const input = container.querySelector(`#${this.dataset.target}`);
        const show  = input.type === 'password';
        input.type  = show ? 'text' : 'password';
        this.textContent = show ? 'Hide' : 'Show';
      });
    });

    // Save settings
    container.querySelector('#btn-save-settings').addEventListener('click', () => {
      const pat      = container.querySelector('#input-pat').value.trim();
      const username = container.querySelector('#input-username').value.trim();
      const interval = parseInt(container.querySelector('#input-interval').value, 10);

      const errors = [];
      if (!pat)                                                  errors.push('PAT cannot be empty');
      if (!username)                                             errors.push('Username cannot be empty');
      if (isNaN(interval) || interval < 1 || interval > 60)     errors.push('Interval must be 1–60 minutes');

      if (errors.length) { showStatus(container, errors.join(' · '), 'error'); return; }

      const overrides = loadOverrides();
      if (pat !== CONFIG.pat)                        overrides.pat = pat;
      else                                           delete overrides.pat;
      if (username !== CONFIG.username)              overrides.username = username;
      else                                           delete overrides.username;
      if (interval !== CONFIG.healthCheckInterval)   overrides.healthCheckInterval = interval;
      else                                           delete overrides.healthCheckInterval;

      saveOverrides(overrides);
      showStatus(container, 'Saved. Reload the page to apply all changes.', 'success');
      setTimeout(() => render(container), 1200);
    });

    // Reset
    container.querySelector('#btn-reset-settings').addEventListener('click', () => {
      if (confirm('Clear all localStorage overrides and reload from config.js?')) clearOverrides();
    });

    // Scroll to rotation section
    const gotoBtn = container.querySelector('#btn-goto-rotation');
    if (gotoBtn) {
      gotoBtn.addEventListener('click', () => {
        container.querySelector('#rotation-section')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    // Re-open rotation after it's been marked done
    const reopenBtn = container.querySelector('#btn-reopen-rotation');
    if (reopenBtn) {
      reopenBtn.addEventListener('click', () => {
        localStorage.removeItem(ROTATION_KEY);
        render(container);
      });
    }

    // Test & Save new PAT
    const testSaveBtn = container.querySelector('#btn-test-save');
    if (testSaveBtn) {
      testSaveBtn.addEventListener('click', () => testAndSave(container));
    }
  }

  // ── Test & Save new PAT ────────────────────────

  async function testAndSave(container) {
    const input    = container.querySelector('#input-new-pat');
    const statusEl = container.querySelector('#rotation-test-status');
    const btn      = container.querySelector('#btn-test-save');
    const newPat   = input ? input.value.trim() : '';

    if (!newPat) {
      setRotationStatus(statusEl, 'Paste your new token first.', 'error');
      return;
    }

    btn.disabled    = true;
    btn.textContent = 'Testing…';
    setRotationStatus(statusEl, '', '');

    const oldPat = CONFIG.pat;
    CONFIG.pat   = newPat;   // temporarily set for the test call

    try {
      const user = await Repos.getUser();
      if (!user || !user.login) throw new Error('Unexpected response — token may lack repo scope.');

      // Test passed — save
      const overrides = loadOverrides();
      overrides.pat   = newPat;
      saveOverrides(overrides);
      markRotationDone();

      setRotationStatus(statusEl, `✓ Connected as ${user.login} — saved.`, 'success');
      btn.textContent = 'Saved ✓';

      // Re-render after short delay to show completed state
      setTimeout(() => render(container), 1800);

    } catch (err) {
      CONFIG.pat      = oldPat;   // restore
      btn.disabled    = false;
      btn.textContent = 'Test & Save';
      setRotationStatus(statusEl, `✕ ${err.message}`, 'error');
    }
  }

  function setRotationStatus(el, msg, type) {
    if (!el) return;
    el.textContent  = msg;
    el.className    = `rotation-test-status rotation-test-${type}`;
  }

  function showStatus(container, msg, type) {
    const el = container.querySelector('#settings-status');
    if (!el) return;
    el.textContent = msg;
    el.className   = `settings-status settings-status-${type}`;
    setTimeout(() => { el.textContent = ''; el.className = 'settings-status'; }, 4000);
  }

  function escAttr(s) {
    return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  }

  return { render, loadOverrides, saveOverrides };

})();

// Apply any localStorage overrides immediately on script load
(function applyStoredOverrides() {
  try {
    const overrides = JSON.parse(localStorage.getItem('vpro_settings') || '{}');
    if (typeof CONFIG !== 'undefined' && Object.keys(overrides).length > 0) {
      Object.assign(CONFIG, overrides);
    }
  } catch {}
})();
