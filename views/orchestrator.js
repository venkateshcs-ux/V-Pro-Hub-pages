// views/orchestrator.js — Multi-tool Project Orchestrator View
// Reads BACKLOG.md for multi_tool:YES items, fetches each project's _FEED.md,
// renders Next Step cards sorted by backlog priority.

window.OrchestratorView = (() => {

  // ── Helpers ────────────────────────────────────

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  const PRIORITY_ORDER = { 'SUPER HIGH': 0, 'HIGH': 1, 'Medium': 2, 'Low': 3 };

  // ── Tool → URL map (#62) ───────────────────────
  // For recognisable web-launchable tools, render "Open {Label} ↗" on the
  // Next Step card. First rule that matches a case-insensitive pattern wins.
  // Local-only tools (CLIs, desktop apps without deep links) are intentionally
  // excluded — no button is shown for them.
  //
  // Rule shape: { test: RegExp (matched against raw "Tool:" value), label, url }
  // Order matters: put more specific rules (e.g. "Claude Design") before
  // broader ones (e.g. "Claude"). Pure local tools like "Claude Code" are
  // omitted so no misleading button appears.
  const TOOL_OPEN_RULES = [
    { test: /claude\s*design/i,      label: 'Claude Design', url: 'https://claude.ai/' },
    { test: /claude\.?ai|claude\s*chat|claude\s*web/i, label: 'Claude.ai',  url: 'https://claude.ai/' },
    { test: /perplexity/i,           label: 'Perplexity',    url: 'https://www.perplexity.ai/' },
    { test: /figma/i,                label: 'Figma',         url: 'https://www.figma.com/' },
    { test: /runway/i,               label: 'Runway',        url: 'https://app.runwayml.com/' },
    { test: /chatgpt|\bgpt[- ]?\d?\b/i, label: 'ChatGPT',    url: 'https://chatgpt.com/' },
    { test: /notion/i,               label: 'Notion',        url: 'https://www.notion.so/' },
    { test: /gemini|google\s*ai/i,   label: 'Gemini',        url: 'https://gemini.google.com/' },
    // Fallback generic Claude LAST — avoids clobbering "Claude Code" (local CLI,
    // no rule → no button) while still matching plain "Claude" references.
    { test: /^\s*claude\s*(?:\(|,|$)/i, label: 'Claude.ai',  url: 'https://claude.ai/' },
  ];

  function resolveToolOpen(toolValue) {
    if (!toolValue) return null;
    for (const rule of TOOL_OPEN_RULES) {
      if (rule.test.test(toolValue)) return { label: rule.label, url: rule.url };
    }
    return null;
  }

  // ── Parse BACKLOG.md ───────────────────────────
  // Returns array of { id, name, priority, status, feedPath }
  // feedPath is null if missing or TBD

  function parseMultiToolItems(md) {
    const items     = [];
    const feedPaths = {}; // id → feedPath string | null

    const lines = md.split('\n');
    let inBacklog = false;
    let inMt      = false;
    let bHeaders  = [];
    let mtHeaders = [];

    for (const line of lines) {
      if (!line.startsWith('|')) {
        if      (/^## Backlog/.test(line))              { inBacklog = true;  bHeaders  = []; inMt = false; }
        else if (/^## Multi-tool projects/.test(line))  { inMt = true;       mtHeaders = []; inBacklog = false; }
        else if (/^## /.test(line))                     { inBacklog = false;  inMt = false; }
        continue;
      }

      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (cells.every(c => /^[-: ]+$/.test(c))) continue; // separator row

      // ── Main backlog table ──
      if (inBacklog) {
        if (cells[0] === '#') {
          bHeaders = cells.map(c => c.toLowerCase().replace(/[()]/g, '').trim());
          continue;
        }
        if (bHeaders.length && /^\d+$/.test(cells[0])) {
          const row = {};
          bHeaders.forEach((h, i) => { if (i < cells.length) row[h] = cells[i]; });
          if ((row['multi_tool'] === 'YES' || row['multi-tool'] === 'YES') && row['name']) {
            items.push({
              id:       cells[0],
              name:     row['name']     || '—',
              priority: row['priority'] || '—',
              status:   row['status']   || 'Open',
              feedPath: null,
            });
          }
        }
      }

      // ── Multi-tool projects table ──
      if (inMt) {
        if (cells[0] === '#') {
          mtHeaders = cells.map(c => c.toLowerCase().replace(/`/g, '').trim());
          continue;
        }
        if (mtHeaders.length && /^\d+$/.test(cells[0])) {
          const id     = cells[0].trim();
          const fpIdx  = mtHeaders.findIndex(h => h.includes('feed'));
          const raw    = fpIdx >= 0 ? (cells[fpIdx] || '') : '';
          const clean  = raw.replace(/`/g, '').trim();
          // Valid if not TBD and not a template placeholder
          const valid  = clean && !clean.includes('TBD') && !clean.includes('{id}') && !clean.includes('{');
          feedPaths[id] = valid ? clean.split(' ')[0] : null; // first token = path
        }
      }
    }

    // Cross-join: fill feedPath from mt table
    items.forEach(item => { item.feedPath = feedPaths[item.id] || null; });
    return items;
  }

  // ── Parse _FEED.md ─────────────────────────────
  // Returns { lastUpdated, purpose, phases[], nextStep{} }

  function parseFeed(md) {
    const result = { lastUpdated: null, purpose: null, phases: [], nextStep: {} };

    // lastUpdated — header line
    const updm = md.match(/^# Last updated:\s*(\d{4}-\d{2}-\d{2})/m);
    if (updm) result.lastUpdated = updm[1];

    // purpose — first non-empty content line after ## Purpose
    const purpm = md.match(/## Purpose\s*\n\s*\n?([^\n#][^\n]+)/);
    if (purpm) result.purpose = purpm[1].trim();

    // phases — fenced code block under ## Current state
    const statem = md.match(/## Current state[\s\S]*?```([\s\S]*?)```/);
    if (statem) {
      result.phases = statem[1].trim().split('\n')
        .filter(l => l.trim())
        .map(l => {
          const m = l.match(/Phase\s+(\d+)\s*[—–-]\s*([^:]+):\s*(.+)/);
          if (!m) return null;
          const raw    = m[3].trim();
          const status = (raw.includes('Done') || raw.includes('✓'))                                     ? 'done'
                       : (raw.includes('▶') || /in progress/i.test(raw) || raw.includes('current'))     ? 'active'
                       : 'pending';
          return { number: m[1], name: m[2].trim(), status };
        })
        .filter(Boolean);
    }

    // nextStep — key-value lines under ## Next step, multi-line values merged
    const nsm = md.match(/## Next step\s*\n([\s\S]*?)(?=\n## |\n---)/);
    if (nsm) {
      let curKey = null;
      let curVal = [];
      const flush = () => {
        if (curKey) result.nextStep[curKey] = curVal.join(' ').replace(/`/g, '').trim();
      };
      for (const line of nsm[1].split('\n')) {
        const km = line.match(/^\*\*([^*]+)\*\*[:\s]+(.*)$/);
        if (km) {
          flush();
          curKey = km[1].replace(/[?:]+$/, '').trim();
          curVal = [km[2].replace(/`/g, '').trim()];
        } else if (curKey && line.trim()) {
          curVal.push(line.replace(/`/g, '').trim());
        }
      }
      flush();
    }

    return result;
  }

  // ── Phase strip ────────────────────────────────

  function renderPhaseStrip(phases) {
    if (!phases.length) return '';
    return `<div class="phase-strip">` +
      phases.map((p, i) => {
        const cls   = p.status === 'done' ? 'ph-done' : p.status === 'active' ? 'ph-active' : 'ph-pending';
        const title = escHtml(`Phase ${p.number} — ${p.name}`);
        const conn  = i < phases.length - 1
          ? `<div class="phase-conn${p.status === 'done' ? ' ph-conn-done' : ''}"></div>`
          : '';
        return `<div class="phase-node ${cls}" title="${title}">
          <div class="phase-dot"></div>
          <span class="phase-num">${escHtml(p.number)}</span>
        </div>${conn}`;
      }).join('') +
    `</div>`;
  }

  // ── Next Step box ──────────────────────────────

  function renderNextStep(ns) {
    const rows = [
      ['Tool',    ns['Tool']],
      ['Action',  ns['Action']],
      ['Read',    ns['Read']],
      ['Produce', ns['Produce']],
    ].filter(([, v]) => v);

    if (!rows.length) {
      return `<p class="pc-purpose" style="color:var(--text-dim)">Next step not found in _FEED.md.</p>`;
    }

    const exception    = ns['Exception'];
    const showException = exception && !/^no\b/i.test(exception);
    const openTool      = resolveToolOpen(ns['Tool']);

    return `<div class="next-step-box">
      <div class="nsb-label">Next Step</div>
      ${rows.map(([k, v]) => `
        <div class="nsb-row">
          <span class="nsb-key">${escHtml(k)}</span>
          <span class="nsb-val">${escHtml(v)}</span>
        </div>`).join('')}
      ${showException ? `
        <div class="nsb-row nsb-exception">
          <span class="nsb-key">Exception</span>
          <span class="nsb-val">${escHtml(exception)}</span>
        </div>` : ''}
      ${openTool ? `
        <div class="nsb-actions">
          <a class="nsb-open-tool" href="${escHtml(openTool.url)}" target="_blank" rel="noopener noreferrer" title="Open ${escHtml(openTool.label)} in a new tab">
            Open ${escHtml(openTool.label)} ↗
          </a>
        </div>` : ''}
    </div>`;
  }

  // ── Badges ─────────────────────────────────────

  function statusBadge(status) {
    const s   = status || '';
    const cls = (s.includes('Done') || s.includes('✓'))         ? 'badge-done'
              : (s.includes('progress') || s.includes('▶'))     ? 'badge-active'
              : s.includes('⏸')                                  ? 'badge-paused'
              : 'badge-open';
    return `<span class="pc-status-badge ${cls}">${escHtml(s)}</span>`;
  }

  function priorityBadge(p) {
    const cls = p === 'SUPER HIGH' ? 'priority-super'
              : p === 'HIGH'       ? 'priority-high'
              : p === 'Medium'     ? 'priority-medium'
              : 'priority-low';
    return `<span class="pc-priority ${cls}">${escHtml(p)}</span>`;
  }

  // ── Project card ───────────────────────────────

  function renderCard(item, feed) {
    const active      = feed.phases.find(p => p.status === 'active');
    const doneCount   = feed.phases.filter(p => p.status === 'done').length;
    const total       = feed.phases.length;
    const phaseInfo   = total > 0 ? `Phase ${active ? active.number : doneCount} of ${total}` : '';
    const feedUrl     = `https://github.com/${encodeURIComponent(CONFIG.username)}/V-Pro-Hub/blob/master/${item.feedPath}`;

    return `<div class="project-card">
      <div class="pc-header">
        <div class="pc-title-row">
          <span class="pc-name">${escHtml(item.name)}</span>
          <span class="pc-id">#${escHtml(item.id)}</span>
        </div>
        <div class="pc-badges">
          ${priorityBadge(item.priority)}
          ${statusBadge(item.status)}
        </div>
      </div>
      ${feed.purpose ? `<p class="pc-purpose">${escHtml(feed.purpose)}</p>` : ''}
      ${renderPhaseStrip(feed.phases)}
      ${renderNextStep(feed.nextStep)}
      <div class="pc-footer">
        ${feed.lastUpdated ? `<span class="pc-updated">Updated ${escHtml(feed.lastUpdated)}</span>` : ''}
        ${phaseInfo ? `<span class="pc-phase-info">${escHtml(phaseInfo)}</span>` : ''}
        <a class="pc-feed-link" href="${feedUrl}" target="_blank" rel="noopener noreferrer">_FEED.md ↗</a>
      </div>
    </div>`;
  }

  // ── Compliance gap card ────────────────────────

  function renderGapCard(item) {
    const reason = !item.feedPath
      ? 'No <code>_FEED.md</code> declared in BACKLOG.md Multi-tool projects section.'
      : 'Declared <code>_FEED.md</code> path not found — file may not exist yet.';
    return `<div class="project-card project-card-gap">
      <div class="pc-header">
        <div class="pc-title-row">
          <span class="pc-name">${escHtml(item.name)}</span>
          <span class="pc-id">#${escHtml(item.id)}</span>
        </div>
        <div class="pc-badges">
          ${priorityBadge(item.priority)}
          <span class="pc-status-badge badge-gap">Missing _FEED.md</span>
        </div>
      </div>
      <p class="pc-gap-msg">${reason}</p>
      <div class="pc-gap-action">
        <span class="pc-gap-action-label">Action</span>
        <span class="pc-gap-action-val">Run <strong>Project Onboarding ritual</strong> → create <code>projects/{id}/_FEED.md</code></span>
      </div>
    </div>`;
  }

  // ── Stats bar ──────────────────────────────────

  function renderStats(activeCount, gapCount) {
    return `<div class="orch-stats">
      <span class="orch-stat orch-stat-active">● ${activeCount} active</span>
      ${gapCount > 0 ? `<span class="orch-stat orch-stat-gap">⚠ ${gapCount} gap${gapCount > 1 ? 's' : ''}</span>` : ''}
    </div>`;
  }

  // ── Skeleton ───────────────────────────────────

  function renderSkeleton() {
    return `<div class="orch-header">
      <h1 class="orch-title">⚡ Orchestrator</h1>
      <p class="muted" style="font-size:13px;margin-top:4px">Loading…</p>
    </div>
    <div class="project-card skeleton" style="margin-top:8px">
      <div class="skel-line" style="width:42%;height:15px"></div>
      <div class="skel-line" style="width:68%;height:11px;margin-top:10px"></div>
      <div class="skel-line" style="width:100%;height:90px;margin-top:16px;border-radius:8px"></div>
    </div>`;
  }

  // ── Main render ────────────────────────────────

  async function render(container) {
    container.innerHTML = renderSkeleton();

    try {
      const backlogMd = await Repos.getFile(CONFIG.username, 'V-Pro-Hub', 'docs/BACKLOG.md');
      if (!backlogMd) throw new Error('BACKLOG.md not found');

      const items = parseMultiToolItems(backlogMd);

      // Sort by backlog priority: SUPER HIGH → HIGH → Medium → Low
      items.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99));

      if (items.length === 0) {
        container.innerHTML = `<div class="orch-header"><h1 class="orch-title">⚡ Orchestrator</h1></div>
          <div class="view-placeholder"><div class="placeholder-inner">
            <span class="placeholder-icon">⚡</span>
            <h2>No multi-tool projects yet</h2>
            <p class="muted">Add <code>multi_tool: YES</code> rows to BACKLOG.md to track projects here.</p>
          </div></div>`;
        return;
      }

      // Fetch all _FEED.md files in parallel
      const resolved = await Promise.all(
        items.map(async item => {
          if (!item.feedPath) return { item, feed: null };
          const md = await Repos.getFile(CONFIG.username, 'V-Pro-Hub', item.feedPath).catch(() => null);
          return { item, feed: md ? parseFeed(md) : null };
        })
      );

      const active = resolved.filter(r => r.feed);
      const gaps   = resolved.filter(r => !r.feed);

      container.innerHTML = `
        <div class="orch-header">
          <h1 class="orch-title">⚡ Orchestrator</h1>
          <p class="muted" style="font-size:13px;margin-top:2px">Multi-tool projects — open the right tool, start the next step</p>
          ${renderStats(active.length, gaps.length)}
        </div>

        ${active.length > 0 ? `
          <div class="orch-section-label">Active projects</div>
          <div class="orch-cards">${active.map(r => renderCard(r.item, r.feed)).join('')}</div>
        ` : ''}

        ${gaps.length > 0 ? `
          <div class="orch-section-label" style="margin-top:32px">Compliance gaps</div>
          <div class="orch-cards">${gaps.map(r => renderGapCard(r.item)).join('')}</div>
        ` : ''}
      `;

    } catch (err) {
      container.innerHTML = `<div class="orch-header"><h1 class="orch-title">⚡ Orchestrator</h1></div>
        <div class="view-placeholder"><div class="placeholder-inner">
          <span class="placeholder-icon" style="color:var(--danger)">✕</span>
          <h2>Failed to load</h2>
          <p class="muted">${escHtml(err.message)}</p>
          <button class="btn-retry" onclick="OrchestratorView.render(document.getElementById('main-content'))">Retry</button>
        </div></div>`;
    }
  }

  return { render };

})();
