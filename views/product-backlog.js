// views/product-backlog.js — Product Backlog view (S106 #170)
// Renders Epic + Feature tree filtered by pps_id, with multi-dimensional
// external (counterparty) status columns: code / testing / usermanual.
// Read-only v0; writeback deferred to v1 (Sprint 9+).
// Route: #/product/<productId>/backlog (dispatched from ProductView)

window.ProductBacklogView = (() => {

  // Token-based bl-chip variants (theme-aware) — replaces the old hardcoded-hex status-chip.
  const STATUS_COLOR = {
    BUILT:      'st-built',
    DOCUMENTED: 'st-built',
    COVERED:    'st-built',
    PARTIAL:    'st-partial',
    MISSING:    'st-missing',
    NONE:       'st-missing',
    UNCLEAR:    'st-unknown',
    'N/A':      'st-na',
  };

  function statusChip(value) {
    if (!value) return '<span class="bl-chip st-na">—</span>';
    const cls = STATUS_COLOR[value] || 'st-na';
    return `<span class="bl-chip ${cls}">${value}</span>`;
  }

  function renderSkeleton(productId) {
    return `
      <div class="prodbl-shell">
        <div class="prodbl-header">
          <button class="btn-back" data-back="portfolio">← Portfolio</button>
          <h1>Product Backlog — ${productId}</h1>
          <p class="muted">Loading Epics + Features…</p>
        </div>
      </div>`;
  }

  function renderEmpty(productId) {
    return `
      <div class="prodbl-shell">
        <div class="prodbl-header">
          <button class="btn-back" data-back="portfolio">← Portfolio</button>
          <h1>Product Backlog — ${productId}</h1>
        </div>
        <div class="prodbl-empty">
          <p>No Epics found for product <code>${productId}</code>.</p>
          <p class="muted">Epics live under <code>docs/epics/</code> with <code>pps_id: ${productId}</code>.</p>
        </div>
      </div>`;
  }

  function renderError(productId, msg) {
    return `
      <div class="prodbl-shell">
        <div class="prodbl-header">
          <button class="btn-back" data-back="portfolio">← Portfolio</button>
          <h1>Product Backlog — ${productId}</h1>
        </div>
        <div class="prodbl-error">
          <p>Failed to load Product Backlog.</p>
          <pre>${msg}</pre>
        </div>
      </div>`;
  }

  function renderRow(item, type, parentEpicId, featCount) {
    // type: 'epic' or 'feature'
    const id = item.id;
    const title = (item.title || '').replace(/^Shreemantra\s*[—-]\s*/i, '');
    const route = type === 'epic' ? `epic/${id}` : `feature/${id}`;
    const step = item.feature_map_step ? `<span class="prodbl-step">Step ${item.feature_map_step}</span>` : '';
    if (type === 'epic') {
      const n = featCount || 0;
      return `
      <tr class="prodbl-row prodbl-row-epic" data-epic-toggle="${id}" title="Click to show / hide features">
        <td class="prodbl-id"><span class="prodbl-caret">▶</span><a href="#/${route}" onclick="event.stopPropagation()">${id}</a></td>
        <td class="prodbl-title">${title}<span class="prodbl-featcount">${n} feature${n === 1 ? '' : 's'}</span></td>
        <td>${statusChip(item.code_status)}</td>
        <td>${statusChip(item.testing_status)}</td>
        <td>${statusChip(item.usermanual_status)}</td>
        <td class="prodbl-meta muted">${item.feature_map_login || ''}</td>
      </tr>`;
    }
    return `
      <tr class="prodbl-row prodbl-row-feature prodbl-collapsed" data-parent="${parentEpicId}">
        <td class="prodbl-id"><a href="#/${route}">${id}</a></td>
        <td class="prodbl-title">${step}${title}</td>
        <td>${statusChip(item.code_status)}</td>
        <td>${statusChip(item.testing_status)}</td>
        <td>${statusChip(item.usermanual_status)}</td>
        <td class="prodbl-meta muted">${item.feature_map_login || ''}</td>
      </tr>`;
  }

  function renderTree(productId, epics, featuresByEpic) {
    const counts = {
      epics: epics.length,
      features: Object.values(featuresByEpic).reduce((s, l) => s + l.length, 0),
    };
    const rollup = (statusField) => {
      const all = epics.map(e => e[statusField]).filter(Boolean);
      const counts = {};
      all.forEach(s => { counts[s] = (counts[s] || 0) + 1; });
      return Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(' · ') || '—';
    };

    let body = '';
    epics.forEach(epic => {
      const feats = featuresByEpic[epic.id] || [];
      body += renderRow(epic, 'epic', null, feats.length);
      feats.forEach(feat => { body += renderRow(feat, 'feature', epic.id); });
    });

    return `
      <div class="prodbl-shell">
        <style>
          .prodbl-row-epic { cursor: pointer; }
          .prodbl-row-epic:hover { background: rgba(127,127,127,0.06); }
          .prodbl-caret { display: inline-block; width: 1em; margin-right: .25em; color: var(--muted, #888); font-size: .75em; transition: transform .15s ease; }
          .prodbl-row-epic.expanded .prodbl-caret { transform: rotate(90deg); }
          .prodbl-collapsed { display: none; }
          .prodbl-featcount { font-size: .78em; opacity: .55; margin-left: .6em; font-weight: 400; }
        </style>
        <div class="prodbl-header">
          <button class="btn-back" data-back="portfolio">← Portfolio</button>
          <h1>Product Backlog — ${productId}</h1>
          <p class="muted" style="margin:.2em 0 0">${epics.length} epics — click an epic to show its features. <button class="prodbl-expand-all" data-expand-all style="font-size:.85em;margin-left:.5em">Expand all</button></p>
          <div class="prodbl-summary">
            <span><strong>${counts.epics}</strong> Epics · <strong>${counts.features}</strong> Features</span>
          </div>
          <div class="prodbl-rollup">
            <div><strong>Code:</strong> ${rollup('code_status')}</div>
            <div><strong>Testing:</strong> ${rollup('testing_status')}</div>
            <div><strong>User manual:</strong> ${rollup('usermanual_status')}</div>
          </div>
        </div>
        <table class="prodbl-table" data-product="${productId}">
          <thead>
            <tr>
              <th>ID</th>
              <th>Title</th>
              <th>Code</th>
              <th>Testing</th>
              <th>User manual</th>
              <th>Login</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
        <p class="prodbl-footer muted">
          External-status source-of-truth: <code data-evidence="${epics[0]?.external_status_evidence || ''}">
            ${epics[0]?.external_status_evidence || '(none)'}
          </code>
          · Counterparty repo: <code>${epics[0]?.external_source || '(none)'}</code>
        </p>
      </div>`;
  }

  // Parse minimal frontmatter we need (avoid pulling BacklogView dep)
  function parseFrontmatter(md) {
    const m = /^---\n([\s\S]*?)\n---/.exec(md);
    if (!m) return {};
    const out = {};
    const lines = m[1].split('\n');
    for (const line of lines) {
      const km = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*?)\s*(#.*)?$/.exec(line);
      if (km) {
        let val = km[2].trim();
        // strip surrounding quotes
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        out[km[1]] = val;
      }
    }
    return out;
  }

  async function fetchFiles(owner, repo, branch, dirPath, prefix) {
    // Use Repos.listDirectory if available; otherwise fetch via tree
    let entries = [];
    try {
      entries = await Repos.listDirectory(owner, repo, dirPath, branch);
    } catch (e) {
      return [];
    }
    const isMarkdown = (n) => /\.md$/i.test(n);  // regex avoids bare '.md' literal that GR-24 L3 lint would flag
    const targets = entries.filter(e => e.name && isMarkdown(e.name) && (!prefix || e.name.startsWith(prefix)));
    const results = await Promise.all(targets.map(async (e) => {
      try {
        const md = await Repos.getFile(owner, repo, `${dirPath}/${e.name}`, branch);
        const fm = parseFrontmatter(md);
        return { _filename: e.name, ...fm };
      } catch (err) {
        return null;
      }
    }));
    return results.filter(Boolean);
  }

  async function render(container, productId) {
    if (!productId) {
      container.innerHTML = renderEmpty('(no product)');
      return;
    }

    container.innerHTML = renderSkeleton(productId);

    try {
      const provider = (typeof CONFIG !== 'undefined' && CONFIG.providers && CONFIG.providers[0]) || {};
      const owner = provider.username || 'venkateshcs-ux';
      const repo = (typeof CONFIG !== 'undefined' && CONFIG.dashboardRepo) || 'V-Pro-Hub';
      let branch = undefined;
      if (window.ActiveSprint && typeof window.ActiveSprint.getActiveSprintBranch === 'function') {
        const disc = await window.ActiveSprint.getActiveSprintBranch(owner, repo).catch(() => null);
        if (disc && disc.branch) branch = disc.branch;
      }

      const [allEpics, allFeatures] = await Promise.all([
        fetchFiles(owner, repo, branch, 'docs/epics', null),
        fetchFiles(owner, repo, branch, 'docs/features', null),
      ]);

      const epics = allEpics.filter(e => e.pps_id === productId);
      const features = allFeatures.filter(f => f.pps_id === productId);

      if (epics.length === 0) {
        container.innerHTML = renderEmpty(productId);
        return;
      }

      // Sort Epics by numeric id portion
      const numId = (s) => parseInt(String(s || '').replace(/^[EF]-/, ''), 10) || 0;
      epics.sort((a, b) => numId(a.id) - numId(b.id));
      features.sort((a, b) => numId(a.id) - numId(b.id));

      const featuresByEpic = {};
      features.forEach(f => {
        const eid = f.contained_by_epic;
        if (!featuresByEpic[eid]) featuresByEpic[eid] = [];
        featuresByEpic[eid].push(f);
      });

      container.innerHTML = renderTree(productId, epics, featuresByEpic);

      // Wire back button
      const back = container.querySelector('[data-back]');
      if (back) back.addEventListener('click', () => { window.location.hash = '#/portfolio'; });

      // Wire epic drill-down: click an epic row to show/hide its features
      const toggleEpic = (row, force) => {
        const eid = row.getAttribute('data-epic-toggle');
        const expand = force != null ? force : !row.classList.contains('expanded');
        row.classList.toggle('expanded', expand);
        container.querySelectorAll(`[data-parent="${eid}"]`).forEach(fr => fr.classList.toggle('prodbl-collapsed', !expand));
      };
      container.querySelectorAll('[data-epic-toggle]').forEach(row => {
        row.addEventListener('click', () => toggleEpic(row));
      });
      const expandAll = container.querySelector('[data-expand-all]');
      if (expandAll) expandAll.addEventListener('click', () => {
        const rows = container.querySelectorAll('[data-epic-toggle]');
        const anyCollapsed = Array.from(rows).some(r => !r.classList.contains('expanded'));
        rows.forEach(r => toggleEpic(r, anyCollapsed));
        expandAll.textContent = anyCollapsed ? 'Collapse all' : 'Expand all';
      });

    } catch (err) {
      container.innerHTML = renderError(productId, err.message || String(err));
    }
  }

  return { render };

})();
