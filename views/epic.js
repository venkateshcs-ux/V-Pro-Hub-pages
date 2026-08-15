// views/epic.js — Epic detail view (#144 t1)
// Deep-linkable at #/epic/<E-id> (e.g. #/epic/E-001).
// Reads docs/EPICS.md to resolve the per-Epic file path, fetches
// docs/epics/E-<id>-<slug>.md from the active sprint branch, then
// fetches per-card frontmatter (parallel) for status + title display.

window.EpicView = (() => {

  // ── Helpers ────────────────────────────────────

  function escHtml(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  // ── Frontmatter parser (lightweight, epic-schema aware) ────

  // parseFrontmatter in backlog.js emits flat-ID arrays via b.id for block-lists,
  // but Epic cards are simple-string bullets ({_value: '138 # ...'}) so b.id = undefined.
  // Extract IDs directly from the raw YAML block list instead.
  function extractBlockList(yamlStr, key) {
    const lines = yamlStr.split('\n');
    const out = [];
    let inBlock = false;
    for (const line of lines) {
      if (new RegExp(`^${key}:\\s*$`).test(line)) { inBlock = true; continue; }
      if (inBlock && /^\S/.test(line)) break;
      if (inBlock && /^\s{2}-\s/.test(line)) {
        const m = line.match(/^\s{2}-\s+(\S+)/);
        if (m) out.push(m[1]);
      }
    }
    return out;
  }

  function parseEpicFm(md) {
    const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return {};
    const yaml = m[1];
    const result = {};
    for (const line of yaml.split('\n')) {
      const kv = line.match(/^([\w_]+):\s+(.*)/);
      if (!kv) continue;
      let v = kv[2].replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '');
      if (v === 'null' || v === '~') v = null;
      result[kv[1]] = v;
    }
    result.cards             = extractBlockList(yaml, 'cards');
    result.contains_features = extractBlockList(yaml, 'contains_features');
    return result;
  }

  // ── Path resolution ────────────────────────────

  function resolveEpicPath(epicsMd, epicId) {
    const rx = new RegExp(`\\[${epicId}\\]\\(([^)]+)\\)`);
    const m = epicsMd.match(rx);
    return m ? `docs/${m[1]}` : null;
  }

  // ── Status badges ──────────────────────────────

  const EPIC_STATUS = {
    done:        { cls: 'cs-done',        icon: '✓', label: 'Done'     },
    active:      { cls: 'cs-in-progress', icon: '▶', label: 'Active'   },
    planning:    { cls: 'cs-candidate',   icon: '⏳', label: 'Planning' },
    dormant:     { cls: 'cs-blocked',     icon: '⏸', label: 'Dormant'  },
  };
  const CARD_STATUS = {
    done:        { cls: 'cs-done',        icon: '✓', label: 'Done'        },
    'in-progress':{ cls: 'cs-in-progress',icon: '▶', label: 'In Progress' },
    candidate:   { cls: 'cs-candidate',   icon: '⏳', label: 'Candidate'   },
    blocked:     { cls: 'cs-blocked',     icon: '⏸', label: 'Blocked'     },
  };

  function epicBadge(status) {
    const s = EPIC_STATUS[status] || { cls: 'cs-candidate', icon: '?', label: escHtml(status || '?') };
    return `<span class="cs-badge ${s.cls}">${s.icon} ${escHtml(s.label)}</span>`;
  }

  function cardBadge(status) {
    const s = CARD_STATUS[status] || { cls: 'cs-candidate', icon: '⏳', label: escHtml(status || '?') };
    return `<span class="cs-badge ${s.cls}" style="font-size:11px">${s.icon} ${escHtml(s.label)}</span>`;
  }

  // ── Sub-section renderers ──────────────────────

  function renderProgressBar(done, total) {
    const pct = total ? Math.round(done / total * 100) : 0;
    return `<div class="ep-progress-wrap">
      <div class="ep-progress-track"><div class="ep-progress-fill" style="width:${pct}%"></div></div>
      <span class="ep-progress-label">${done} / ${total} done (${pct}%)</span>
    </div>`;
  }

  function renderCardsList(cardIds, cardData) {
    if (!cardIds.length) return '<div class="ep-empty">No cards assigned.</div>';
    return cardIds.map(rawId => {
      const id = String(rawId).replace(/^#/, '');
      const d  = cardData[id] || {};
      const sprint = d.sprint ? `<span class="ep-card-sprint">${escHtml(d.sprint)}</span>` : '';
      return `<div class="ep-card-row" data-card-id="${escHtml(id)}">
        <span class="ep-card-id">#${escHtml(id)}</span>
        <span class="ep-card-title">${escHtml(d.title || id)}</span>
        <span class="ep-card-status">${cardBadge(d.status || 'candidate')}</span>
        ${sprint}
      </div>`;
    }).join('');
  }

  function renderChips(ids, type) {
    return ids.map(id =>
      `<span class="ep-chip ep-chip-${escHtml(type)}" data-nav-${escHtml(type)}="${escHtml(id)}">${escHtml(id)}</span>`
    ).join('');
  }

  // ── Public render ──────────────────────────────

  async function render(container, epicId) {
    if (!epicId) {
      container.innerHTML = '<div class="proj-empty"><div class="proj-empty-glyph">◈</div><div class="proj-empty-msg">No Epic ID</div></div>';
      return;
    }

    container.innerHTML = `<div class="view-loading">Loading ${escHtml(epicId)}…</div>`;

    try {
      const owner = CONFIG.username;
      const repo  = 'V-Pro-Hub';

      let branch = null;
      if (window.ActiveSprint && typeof window.ActiveSprint.getActiveSprintBranch === 'function') {
        const disc = await window.ActiveSprint.getActiveSprintBranch(owner, repo).catch(() => null);
        branch = (disc && disc.branch) || null;
      }

      // Resolve path from index
      const epicsMd = await Repos.getFile(owner, repo, 'docs/EPICS.md', branch || undefined);
      if (!epicsMd) throw new Error('Epic index not found');
      const epicPath = resolveEpicPath(epicsMd, epicId);
      if (!epicPath) throw new Error(`${epicId} not found in Epic index`);

      // Fetch epic detail
      const epicMd = await Repos.getFile(owner, repo, epicPath, branch || undefined);
      if (!epicMd) throw new Error(`Epic file not found: ${epicPath}`);
      const fm = parseEpicFm(epicMd);
      const cardIds = fm.cards || [];

      // Fetch per-card data (parallel)
      const cardData = {};
      if (cardIds.length && branch) {
        await Promise.all(cardIds.map(async rawId => {
          const id = String(rawId).replace(/^#/, '');
          try {
            const md = await Repos.getFile(owner, repo, `docs/backlog-detail/${id}.md`, branch);
            if (!md) return;
            const cfm = window.BacklogView && window.BacklogView.parseFrontmatter
              ? window.BacklogView.parseFrontmatter(md) : {};
            const derived = window.BacklogView && window.BacklogView.deriveCardStatus
              ? window.BacklogView.deriveCardStatus(cfm) : null;
            cardData[id] = {
              title:  cfm.title || id,
              status: derived || (cfm.status ? String(cfm.status).toLowerCase().split(/\s+/)[0] : 'candidate'),
              sprint: cfm.sprint || null,
            };
          } catch { /* fail-soft */ }
        }));
      }

      const doneCount = Object.values(cardData).filter(c => c.status === 'done').length;
      const features  = fm.contains_features || [];
      const containedBy = fm.contained_by_feature && fm.contained_by_feature !== 'null'
        ? fm.contained_by_feature : null;

      container.innerHTML = `
        <div class="proj-back-link" id="ep-back">← Backlog</div>

        <div class="proj-header">
          <div class="proj-h-row">
            <div>
              <span class="proj-card-id">${escHtml(epicId)}</span>
              ${epicBadge(fm.status)}
              <h1 class="proj-h-title" style="margin-top:8px">${escHtml(fm.title || epicId)}</h1>
              ${fm.theme ? `<p class="proj-h-sub">${escHtml(fm.theme)}</p>` : ''}
            </div>
          </div>
          <div class="proj-facts-strip">
            ${fm.start_sprint  ? `<div class="proj-fact"><div class="proj-fact-label">Start</div><div class="proj-fact-value">${escHtml(fm.start_sprint)}</div></div>` : ''}
            ${fm.target_sprint ? `<div class="proj-fact"><div class="proj-fact-label">Target</div><div class="proj-fact-value">${escHtml(fm.target_sprint)}</div></div>` : ''}
            <div class="proj-fact"><div class="proj-fact-label">Cards</div><div class="proj-fact-value">${cardIds.length}</div></div>
          </div>
          ${renderProgressBar(doneCount, cardIds.length)}
        </div>

        <div class="proj-card">
          <div class="proj-card-title">Cards <span class="proj-card-count">${cardIds.length}</span></div>
          <div class="ep-cards-list">${renderCardsList(cardIds, cardData)}</div>
        </div>

        ${features.length ? `<div class="proj-card">
          <div class="proj-card-title">Contains Features</div>
          <div class="ep-chips">${renderChips(features, 'feature')}</div>
        </div>` : ''}

        ${containedBy ? `<div class="proj-card">
          <div class="proj-card-title">Contained by Feature</div>
          <div class="ep-chips"><span class="ep-chip ep-chip-feature" data-nav-feature="${escHtml(containedBy)}">${escHtml(containedBy)}</span></div>
        </div>` : ''}

        ${epicId === 'E-012' ? `<div class="proj-card">
          <div class="proj-card-title">COLLAB-INFRA Readiness</div>
          <div id="collab-readiness-mount">Loading readiness view…</div>
        </div>` : ''}
      `;

      // Wire back button
      container.querySelector('#ep-back').addEventListener('click', () => navigate('backlog'));

      // Wire card row clicks
      container.querySelectorAll('.ep-card-row[data-card-id]').forEach(el => {
        el.addEventListener('click', () => navigate('card', el.dataset.cardId));
      });

      // Wire feature chip clicks
      container.querySelectorAll('[data-nav-feature]').forEach(el => {
        el.addEventListener('click', e => { e.stopPropagation(); navigate('feature', el.dataset.navFeature); });
      });

      // E-012 only — mount COLLAB-INFRA readiness view (port of CP-authored prototype; card #172).
      if (epicId === 'E-012' && window.CollabReadinessView && typeof window.CollabReadinessView.render === 'function') {
        const mount = container.querySelector('#collab-readiness-mount');
        if (mount) {
          // fire-and-forget; readiness view handles its own loading + error UI internally
          window.CollabReadinessView.render(mount, branch || undefined);
        }
      }

    } catch (err) {
      container.innerHTML = `<div class="proj-error">
        <strong>Error loading ${escHtml(epicId)}</strong><br>${escHtml(err.message)}<br><br>
        <button onclick="navigate('backlog')" style="margin-top:8px;padding:6px 14px;cursor:pointer">← Back</button>
      </div>`;
    }
  }

  return { render };
})();
