// views/product.js — F2 Product Detail View
// Renders commits, metadata, and stats for a single repo

window.ProductView = (() => {

  // ── Helpers ────────────────────────────────────

  function relativeTime(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins  = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days  = Math.floor(diff / 86400000);
    if (mins  < 60)  return `${mins}m ago`;
    if (hours < 24)  return `${hours}h ago`;
    if (days  < 30)  return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function shortSha(sha) {
    return sha ? sha.substring(0, 7) : '—';
  }

  const LANG_COLORS = {
    JavaScript: '#f7df1e', TypeScript: '#3178c6', Python:  '#3572a5',
    HTML:       '#e34c26', CSS:        '#563d7c',  Shell:   '#89e051',
    Go:         '#00add8', Rust:       '#dea584',  Java:    '#b07219',
  };

  // ── Repo header ────────────────────────────────

  function renderHeader(repo) {
    const langColor = LANG_COLORS[repo.language] || '#64748b';
    const vis = repo.private
      ? `<span class="vis-badge private">Private</span>`
      : `<span class="vis-badge public">Public</span>`;

    return `
    <div class="product-header">
      <div class="product-back" id="btn-back">
        <span class="back-arrow">←</span> Portfolio
      </div>

      <div class="product-title-row">
        <h1 class="product-name">${repo.name}</h1>
        ${vis}
      </div>

      ${repo.description ? `<p class="product-desc">${repo.description}</p>` : ''}

      <div class="product-stats-bar">
        ${repo.language ? `
        <div class="stat-pill">
          <span class="lang-dot" style="background:${langColor}"></span>
          ${repo.language}
        </div>` : ''}
        <div class="stat-pill">★ ${repo.stargazers_count} stars</div>
        <div class="stat-pill">⑂ ${repo.forks_count} forks</div>
        <div class="stat-pill ${repo.open_issues_count > 0 ? 'pill-warn' : ''}">
          ◎ ${repo.open_issues_count} issue${repo.open_issues_count !== 1 ? 's' : ''}
        </div>
        <div class="stat-pill">↑ pushed ${relativeTime(repo.pushed_at)}</div>
        <a class="stat-pill pill-link" href="${repo.html_url}" target="_blank" rel="noopener">
          GitHub ↗
        </a>
      </div>
    </div>`;
  }

  // ── Commits ────────────────────────────────────

  function renderCommit(commit) {
    const author = commit.commit.author;
    const avatar = commit.author?.avatar_url
      ? `<img class="commit-avatar" src="${commit.author.avatar_url}&s=32" alt="${author.name}" loading="lazy">`
      : `<div class="commit-avatar-fallback">${(author.name || '?')[0].toUpperCase()}</div>`;

    const message = commit.commit.message.split('\n')[0]; // first line only
    const truncated = message.length > 80 ? message.substring(0, 77) + '…' : message;

    return `
    <div class="commit-row">
      ${avatar}
      <div class="commit-body">
        <span class="commit-message" title="${message.replace(/"/g, '&quot;')}">${truncated}</span>
        <div class="commit-meta">
          <span class="commit-sha">${shortSha(commit.sha)}</span>
          <span class="commit-author">${author.name}</span>
          <span class="commit-date">${relativeTime(author.date)}</span>
        </div>
      </div>
    </div>`;
  }

  function renderCommits(commits) {
    if (!commits || commits.length === 0) {
      return `<div class="section-empty">No commits found.</div>`;
    }
    return `
    <div class="product-section">
      <div class="section-header">
        <span class="section-title">Recent Commits</span>
        <span class="section-count">${commits.length}</span>
      </div>
      <div class="commit-list">
        ${commits.map(renderCommit).join('')}
      </div>
    </div>`;
  }

  // ── Skeleton ───────────────────────────────────

  function renderSkeleton(repoName) {
    const rows = Array(8).fill(`
      <div class="commit-row skeleton">
        <div class="commit-avatar-fallback skel-block"></div>
        <div class="commit-body">
          <div class="skel-line wide"></div>
          <div class="skel-line short" style="margin-top:6px"></div>
        </div>
      </div>`).join('');

    return `
    <div class="product-header">
      <div class="product-back" id="btn-back"><span class="back-arrow">←</span> Portfolio</div>
      <div class="product-title-row">
        <h1 class="product-name">${repoName}</h1>
      </div>
      <div class="skel-line medium" style="margin-top:8px;height:14px"></div>
      <div class="product-stats-bar" style="margin-top:16px">
        <div class="skel-line" style="width:80px;height:28px;border-radius:20px"></div>
        <div class="skel-line" style="width:60px;height:28px;border-radius:20px"></div>
        <div class="skel-line" style="width:70px;height:28px;border-radius:20px"></div>
      </div>
    </div>
    <div class="product-section">
      <div class="section-header">
        <span class="section-title">Recent Commits</span>
      </div>
      <div class="commit-list">${rows}</div>
    </div>`;
  }

  // ── No repo selected ───────────────────────────

  function renderEmpty() {
    return `<div class="view-placeholder">
      <div class="placeholder-inner">
        <span class="placeholder-icon">◉</span>
        <h2>No product selected</h2>
        <p class="muted">Click a repo card in the Portfolio view.</p>
        <div class="product-back" id="btn-back" style="margin-top:8px;cursor:pointer">
          <span class="back-arrow">←</span> Go to Portfolio
        </div>
      </div>
    </div>`;
  }

  // ── Error ──────────────────────────────────────

  function renderError(msg, repoName) {
    return `<div class="product-header">
      <div class="product-back" id="btn-back"><span class="back-arrow">←</span> Portfolio</div>
    </div>
    <div class="view-placeholder">
      <div class="placeholder-inner">
        <span class="placeholder-icon" style="color:var(--danger)">✕</span>
        <h2>Failed to load ${repoName}</h2>
        <p class="muted">${msg}</p>
        <button class="btn-retry" onclick="window.location.hash='#/product/${repoName}'">Retry</button>
      </div>
    </div>`;
  }

  // ── Back button wiring ─────────────────────────

  function wireBack(container) {
    const btn = container.querySelector('#btn-back');
    if (btn) btn.addEventListener('click', () => { window.location.hash = '#/portfolio'; });
  }

  // ── Main render ────────────────────────────────

  // ── S120 IA Phase 3 — Product Home (tabbed hub) ──
  // Meta mirrors views/portfolio.js PRODUCT_META; backlogNames joins BACKLOG.md's
  // free-text Product(s) column to the pps_id; scenarioCard = card owning the
  // product's end_user_scenarios[] suite.
  const PRODUCT_META = {
    vprohub:    { name: 'V-Pro-Hub',        tag: 'The infra / orchestration product',      repo: 'V-Pro-Hub', client: false, backlogNames: ['V-Pro-Hub'] },
    shreemantra:{ name: 'Shreemantra',      tag: 'Heraizen B2B2C healing platform (PM)',    repo: null,        client: true,  backlogNames: ['Shreemantra'], scenarioCard: '170', project: 'shreemantra',
                  surfaces: [{ key: 'delivery', label: 'Delivery', file: 'delivery-topology.html', title: 'Delivery topology', height: 780, probe: true }] },
    cu:         { name: 'CU — Christ Univ.', tag: 'IJS scholarly publishing engagement',    repo: null,        client: true,  backlogNames: ['CU'] },
    heraizen:   { name: 'Heraizen',         tag: 'Counterparty platform',                   repo: null,        client: true,  backlogNames: [] },
    exec:       { name: 'Executive Bridge', tag: 'AI executive activation (24-month plan)',  repo: null,        client: false, backlogNames: ['ExecBridge'], project: 'exec-profile',
                  surfaces: [{ key: 'gate', label: 'Doc System', file: 'doc-system-gate.html', title: 'Doc-system gate', height: 900 }] },
    'ref-impl': { name: 'Reference Impl',   tag: 'Reference implementations',               repo: null,        client: false, backlogNames: ['PAV (Ref Impl)'] },
  };
  const PRODUCT_NAMES = Object.fromEntries(Object.entries(PRODUCT_META).map(([k, v]) => [k, v.name]));
  const STAT = { BUILT: 'st-built', COVERED: 'st-built', DOCUMENTED: 'st-built', PARTIAL: 'st-partial', MISSING: 'st-missing', NONE: 'st-missing', 'N/A': 'st-na', 'N-A': 'st-na' };
  function chip(v) { return v ? `<span class="bl-chip ${STAT[String(v).toUpperCase()] || 'st-unknown'}">${v}</span>` : '<span class="bl-chip st-na">—</span>'; }
  function withTimeout(p, ms, fb) { return Promise.race([p, new Promise(r => setTimeout(() => r(fb), ms))]); }
  async function getFileSafe(owner, repo, branch, path) { try { return await withTimeout(Repos.getFile(owner, repo, path, branch), 7000, null); } catch { return null; } }
  function parseFm(md) { const o = {}; const m = /^---\n([\s\S]*?)\n---/.exec(md || ''); if (!m) return o; for (const l of m[1].split('\n')) { const km = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(l); if (km) { let v = km[2].trim(); if ((v[0] === '"' && v.slice(-1) === '"') || (v[0] === "'" && v.slice(-1) === "'")) v = v.slice(1, -1); o[km[1]] = v; } } return o; }

  async function repoCoords() {
    const provider = (typeof CONFIG !== 'undefined' && CONFIG.providers && CONFIG.providers[0]) || {};
    const owner = provider.username || 'venkateshcs-ux';
    const repo = (typeof CONFIG !== 'undefined' && CONFIG.dashboardRepo) || 'V-Pro-Hub';
    let branch;
    if (window.ActiveSprint && typeof window.ActiveSprint.getActiveSprintBranch === 'function') {
      const d = await withTimeout(window.ActiveSprint.getActiveSprintBranch(owner, repo).catch(() => null), 2500, null);
      if (d && d.branch) branch = d.branch;
    }
    return { owner, repo, branch };
  }

  async function fetchProductEpics(productId, coords) {
    const { owner, repo, branch } = coords;
    const idx = await getFileSafe(owner, repo, branch, 'docs/EPICS.md');
    const paths = new Set(); const re = /\(epics\/(E-\d+[A-Za-z0-9._-]*?\.md)\)/g; let m;
    while ((m = re.exec(idx || ''))) paths.add('docs/epics/' + m[1]);
    const fms = (await Promise.all([...paths].map(async p => { const md = await getFileSafe(owner, repo, branch, p); return md ? parseFm(md) : null; }))).filter(Boolean);
    const epics = fms.filter(e => e.pps_id === productId);
    // #211 phase-0 — merge status_verified blame stamps from INDEX.json (the
    // stamps are derived per-line by the generator; epic files never carry them).
    try {
      // same-origin first (dev server + deployed site serve docs/ directly and
      // reflect the freshest generated index); GitHub branch read as fallback.
      let parsed = null;
      try {
        const r = await fetch('docs/INDEX.json?cb=' + Date.now(), { cache: 'no-store' });
        if (r.ok) parsed = await r.json();
      } catch (_) { /* fall through */ }
      if (!parsed) {
        const raw = await getFileSafe(owner, repo, branch, 'docs/INDEX.json');
        if (raw) parsed = JSON.parse(raw);
      }
      if (parsed) {
        const byId = {};
        (parsed.epics || []).forEach(e => { if (e.status_verified) byId[e.id] = e.status_verified; });
        epics.forEach(e => { if (byId[e.id]) e.status_verified = byId[e.id]; });
      }
    } catch (_) { /* stamps unavailable → epistemic note falls back to 'unknown' */ }
    return epics;
  }

  // BACKLOG.md rows for this product → { id, name, status } with status normalised
  // to CD's snapshot buckets: open | progress | blocked | done.
  function normStatus(s) {
    const t = (s || '').trim().toLowerCase();
    if (/^(done|✅|closed)/.test(t)) return 'done';
    if (/^(in\b|in-progress|mid-sprint)/.test(t)) return 'progress';
    if (/^blocked/.test(t)) return 'blocked';
    return 'open';
  }
  async function fetchProductItems(productId, coords) {
    const names = (PRODUCT_META[productId] || {}).backlogNames || [];
    if (!names.length) return [];
    const md = await getFileSafe(coords.owner, coords.repo, coords.branch, 'docs/BACKLOG.md');
    const items = [];
    (md || '').split('\n').forEach(line => {
      if (!/^\|\s*#?\d+\s*\|/.test(line)) return;
      const c = line.split('|').map(x => x.trim());
      // c[1]=#, c[2]=Product(s), c[3]=Name, c[8]=Status
      if (!names.some(n => (c[2] || '').split(',').map(x => x.trim()).includes(n))) return;
      // Name cells can carry long markdown annotations — keep the title only.
      let name = (c[3] || '').replace(/\*\*/g, '').replace(/`/g, '');
      name = name.split(' — ')[0].trim();
      if (name.length > 90) name = name.slice(0, 87) + '…';
      items.push({ id: c[1].replace(/^#/, ''), name, status: normStatus(c[8]) });
    });
    return items;
  }

  // FEATURES.md rows whose contained-by epic belongs to this product → read-only
  // backlog items (Item = Feature OR Card, CD A26) for the scoped backlog embed.
  function featureStatus(line, statusCell) {
    const codem = /code=([A-Za-z-]+)/.exec(line);
    const code = codem ? codem[1].toUpperCase() : null;
    const st = (statusCell || '').toLowerCase();
    if (code === 'BUILT' || st === 'done') return 'Done ✓';
    if (code === 'PARTIAL' || st === 'active') return 'In Progress ▶';
    return 'Not started';
  }
  async function fetchProductFeatureItems(productId, coords, epics, productName) {
    const md = await getFileSafe(coords.owner, coords.repo, coords.branch, 'docs/FEATURES.md');
    const epicIds = new Set(epics.map(e => e.id));
    const items = [];
    (md || '').split('\n').forEach(line => {
      if (!/^\|\s*\[F-/.test(line)) return;
      const c = line.split('|').map(x => x.trim());
      const idm = /\[(F-\d+)\]/.exec(c[1] || ''); if (!idm) return;
      const em = /\bE-\d+\b/.exec(c[7] || ''); if (!em || !epicIds.has(em[0])) return;
      items.push({ id: idm[1], products: [productName], name: c[2] || idm[1], type: 'Feature',
        sessionType: '—', phase: '—', priority: '—', status: featureStatus(line, c[4]), aiTool: '—',
        rank: null, reason: null, customReason: null, _epic: em[0], _isFeature: true });
    });
    return items;
  }

  // end_user_scenarios[] from the product's scenario-suite card, grouped by journey.
  async function fetchProductScenarios(productId, coords) {
    const cardId = (PRODUCT_META[productId] || {}).scenarioCard;
    if (!cardId) return null;
    const md = await getFileSafe(coords.owner, coords.repo, coords.branch, `docs/backlog-detail/${cardId}.md`);
    if (!md) return null;
    const block = /end_user_scenarios:\n([\s\S]*?)(?=\n[A-Za-z0-9_]+:|\n---)/.exec(md);
    if (!block) return null;
    const scenarios = [];
    let cur = null;
    for (const line of block[1].split('\n')) {
      const nm = /^  - id:\s*(\S+)/.exec(line);
      if (nm) { cur = { id: nm[1] }; scenarios.push(cur); continue; }
      const kv = cur && /^    ([a-z_]+):\s*(.*)$/.exec(line);
      if (kv) { let v = kv[2].trim().replace(/^"(.*)"$/, '$1'); cur[kv[1]] = v; }
    }
    const groups = new Map();
    scenarios.forEach(sc => {
      const j = sc.journey || 'Other';
      if (!groups.has(j)) groups.set(j, []);
      groups.get(j).push(sc);
    });
    return { cardId, groups: [...groups.entries()] };
  }

  function tabBar(productId, active, itemCount) {
    // #211 phase-0: Health tab DELETED (CP sequence item 4 — removed before its
    // replacement exists, deliberately, as the collapse-thesis test; git revert
    // restores it if missed). Epic status rows live on in the Map drill panel.
    const tabs = [['overview', 'Overview'], ['backlog', 'Backlog'], ['scenarios', 'Scenarios']];
    // S129 — Delivery tab for products whose implementation project carries a
    // delivery-topology.html (product page is the canonical landing surface;
    // placement per V: product tab, NOT a left-nav DELIVER entry).
    // #215 — one tab per declared surface (was a single hardcoded Delivery tab).
    // Declared, not discovered: the tab must exist before the fetch, and a project
    // folder is not a drop-box — a surface is registered, named and reviewed.
    ((PRODUCT_META[productId] || {}).surfaces || []).forEach(sf => tabs.push([sf.key, sf.label]));
    tabs.push(['map', 'Map']);   // #211 Feature Map — any pps product, index-driven
    return `<div class="ph-tabs">${tabs.map(([k, label]) => {
      const count = (k === 'backlog' && itemCount) ? `<span class="ph-tab-count">${itemCount}</span>` : '';
      return `<a class="ph-tab${k === active ? ' active' : ''}" href="#/product/${productId}${k === 'overview' ? '' : '/' + k}">${label}${count}</a>`;
    }).join('')}</div>`;
  }

  // CD-faithful product header: name + repo chip + CLIENT chip, then tag · pps_id.
  function productHead(productId, tab, itemCount) {
    const meta = PRODUCT_META[productId] || { name: productId, tag: '' };
    const repoChip = meta.repo
      ? `<span class="bl-chip st-unknown" style="border-color:var(--gh-bd);background:var(--gh-bg);color:var(--gh-fg)">GH · ${meta.repo}</span>`
      : `<span class="bl-chip st-na">pps_id only</span>`;
    const clientChip = meta.client ? `<span class="bl-chip" style="background:var(--accent3-soft-bg);color:var(--accent3-soft-fg);border:1px solid var(--accent3-soft-bd)">CLIENT</span>` : '';
    return `<div class="ph-head">
      <h1 class="ph-name">${meta.name}</h1>${repoChip}${clientChip}
    </div>
    <p class="ph-tag">${meta.tag ? meta.tag + ' · ' : ''}<span class="ph-id">pps_id=${productId}</span></p>
    ${tabBar(productId, tab, itemCount)}`;
  }

  // #211 phase-0 item 3: aggregation delegated to the single HealthCore module.
  function healthCounts(epics) {
    return window.HealthCore.counts(epics, 'code_status');
  }

  function renderProductHome(productId, tab, epics, items, scen, topologyHtml) {
    // #215 — resolve the declared surface for this tab, if any. Derived here rather
    // than threaded through the signature so the existing call sites are untouched.
    const SURFACE = ((PRODUCT_META[productId] || {}).surfaces || []).find(sf => sf.key === tab) || null;
    const hc = healthCounts(epics); const tot = hc.BUILT + hc.PARTIAL + hc.MISSING;
    const pct = n => tot ? `${Math.round(n / tot * 100)}%` : '0%';
    items = items || [];
    const head = productHead(productId, tab, items.length);

    let body = '';
    if (tab === 'overview') {
      // #211 phase-0 item 1: epistemic render — code_status has no probe, so the
      // rollup is HATCHED with its derived blame-stamp age, never solid green.
      const codeStamp = window.HealthCore.latestStamp(epics, 'code_status');
      const bar = tot ? `<div class="ph-bar ph-hatched" title="last known values — no probe exists for code_status"><span style="width:${pct(hc.BUILT)};background:var(--success)"></span><span style="width:${pct(hc.PARTIAL)};background:var(--warning)"></span><span style="width:${pct(hc.MISSING)};background:var(--danger)"></span></div>
        <div class="ph-legend"><span><span style="color:var(--success-soft-fg)">●</span> ${hc.BUILT} built</span> <span><span style="color:var(--warning-soft-fg)">●</span> ${hc.PARTIAL} partial</span> <span><span style="color:var(--danger-soft-fg)">●</span> ${hc.MISSING} missing</span></div>
        <div class="ph-epistemic">⚠ hand-set values · not verified since ${codeStamp || 'unknown'} · no probe exists yet</div>`
        : `<div class="muted" style="font-family:var(--font-mono);font-size:12px">Internal epics — no counterparty status.</div>`;
      const epicChips = epics.map(e => `<a href="#/epic/${e.id}"><span class="bl-chip" style="background:var(--accent-soft-bg);color:var(--accent-soft-fg);border:1px solid var(--accent-soft-bd);cursor:pointer">${e.id}</span></a>`).join(' ');
      // CD snapshot tiles: not started / in progress / blocked / done from BACKLOG.md.
      const sc = { open: 0, progress: 0, blocked: 0, done: 0 };
      items.forEach(i => sc[i.status]++);
      const tiles = [
        [sc.open, 'not started', 'var(--text-muted)'],
        [sc.progress, 'in progress', 'var(--accent-soft-fg)'],
        [sc.blocked, 'blocked', 'var(--danger-soft-fg)'],
        [sc.done, 'done', 'var(--success-soft-fg)'],
      ].map(([n, l, c]) => `<div class="ph-stat"><div class="ph-stat-n" style="color:${c}">${n}</div><div class="ph-stat-l">${l}</div></div>`).join('');
      // #211 phase-0 item 5: honest label. This is first-in-progress-else-first-
      // not-started in ARRAY ORDER — not a priority verdict. Relabelled "oldest
      // open item"; real prioritization rules arrive with the phase-4 attention
      // column, which replaces this slot.
      const nextIt = items.find(i => i.status === 'progress') || items.find(i => i.status === 'open');
      const nextAction = nextIt ? `<span class="ph-id">#${nextIt.id}</span> ${nextIt.name}` : (epics.find(e => (e.code_status || '').toUpperCase() !== 'BUILT') ? 'Close remaining epic gaps' : 'No open items');
      body = `<div class="ph-grid">
        <div class="ph-card"><div class="ph-card-head"><h3>Backlog snapshot</h3><a class="ph-link" href="#/product/${productId}/backlog">Open Backlog →</a></div>
          <div class="ph-stats">${tiles}</div>
          <div class="ph-epics-label">EPICS IN THIS PRODUCT</div><div class="ph-epics">${epicChips || '<span class="muted">none</span>'}</div>
        </div>
        <div class="ph-col">
          <div class="ph-card"><h3>Health rollup</h3>${bar}</div>
          <div class="ph-card"><div class="ph-epics-label" title="first open card in array order — not a priority ranking">OLDEST OPEN ITEM</div><div class="ph-next">${nextAction}</div></div>
        </div>
      </div>`;
    } else if (SURFACE) {
      if (topologyHtml) {
        const src = String(topologyHtml).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const meta = PRODUCT_META[productId] || {};
        body = `<div class="ph-card" style="padding:0;overflow:hidden">
          <iframe id="ph-topo-frame" title="${SURFACE.title}" loading="lazy" sandbox="allow-scripts" srcdoc="${src}"
            style="width:100%;height:${SURFACE.height || 780}px;border:0;background:#fff;display:block"></iframe>
        </div>
        <p class="muted" style="font:500 11px/1.5 var(--font-mono);margin-top:8px">Source: projects/${meta.project}/${SURFACE.file} — shared with the project page embed.</p>`;
        // #204 t4 — live probe overlay. #215: scoped to surfaces declaring probe:true;
        // it posts Shreemantra prod-endpoint results and is meaningless elsewhere.
        if (SURFACE.probe)
        // parent checks the CORS-reachable
        // subset NOW and posts fresher results into the sandboxed map (postMessage;
        // the map's applier marks them "live-checked"). Artifact surface has no
        // parent — it stays a stamped snapshot by design.
        setTimeout(async () => {
          const frame = document.getElementById('ph-topo-frame');
          if (!frame || !frame.contentWindow) return;
          const probes = {};
          try {
            await fetch('https://hsm.dhi-edu.com/', { mode: 'no-cors', cache: 'no-store' });
            probes.prod_site = { status: 'live' };   // opaque fetch resolved ⇒ server answered
          } catch { probes.prod_site = { status: 'unreachable' }; }
          frame.contentWindow.postMessage({ __topo_probes: {
            generated_at: new Date().toISOString().slice(0, 19),
            probes,
          } }, '*');
        }, 1200);
      } else {
        body = `<div class="ph-card"><h3>${SURFACE.label}</h3>
          <p class="muted" style="font-size:13px;line-height:1.5">No <code>${SURFACE.file}</code> found in this product's project folder.</p></div>`;
      }
    } else if (tab === 'scenarios') {
      if (scen && scen.groups.length) {
        const covChip = st => {
          const t = (st || '').toLowerCase();
          if (/pass|covered/.test(t)) return chip('COVERED');
          if (/partial|api/.test(t)) return chip('PARTIAL');
          return chip('NONE');
        };
        body = `<div class="ph-scen-head"><span class="muted" style="font-size:12.5px">End-user scenario suite · <a class="ph-link" href="#/scenarios/${scen.cardId}">full suite view →</a></span></div>` +
          scen.groups.map(([journey, scs]) => `<div class="ph-card" style="margin-bottom:12px">
            <div class="ph-scen-group"><span class="ph-id">${scs[0].id}–${scs[scs.length - 1].id}</span><span class="ph-scen-title">${journey}</span></div>
            ${scs.map(s => `<div class="ph-scen-row"><span class="ph-id" style="color:var(--accent2-soft-fg)">${s.id}</span><span class="ph-scen-name">${s.scenario || ''}</span>${covChip(s.status_overall)}</div>`).join('')}
          </div>`).join('');
      } else {
        body = `<div class="ph-card"><h3>Scenarios</h3>
          <p class="muted" style="font-size:13px;line-height:1.5">No end-user scenario suite is registered for this product yet.</p>
          <a class="ph-link" href="#/product/${productId}/backlog">→ Product backlog</a></div>`;
      }
    }
    return `<div class="ph-shell">${head}${body}</div>`;
  }

  async function render(container, param) {
    if (!param) { container.innerHTML = renderEmpty(); wireBack(container); return; }
    const parts = param.split('/');
    const productId = parts[0];
    const subRoute = parts[1] || null;

    // Backlog sub-route → the SHARED backlog surface (List/Board/Epic + filters),
    // scoped to this product, under the Product Home tab bar (CD: one surface,
    // scoped = product filter locked). Items = the product's cards + features.
    if (subRoute === 'backlog') {
      const meta = PRODUCT_META[productId];
      if (meta && window.BacklogView && typeof window.BacklogView.render === 'function') {
        const pname = (meta.backlogNames && meta.backlogNames[0]) || meta.name;
        container.innerHTML = `<div class="ph-shell">${productHead(productId, 'backlog')}<div id="ph-backlog-host"></div></div>`;
        const coords = await repoCoords();
        const epics = await fetchProductEpics(productId, coords);
        const extraItems = await fetchProductFeatureItems(productId, coords, epics, pname);
        window.BacklogView.render(container.querySelector('#ph-backlog-host'), {
          productFilter: pname,
          scopedRoute: `#/product/${productId}/backlog`,
          extraItems,
        });
        return;
      }
      if (window.ProductBacklogView && typeof window.ProductBacklogView.render === 'function') {
        window.ProductBacklogView.render(container, productId);
        return;
      }
    }

    // Product Home tabbed hub for pps_id products (Phase 3). Repos without pps_id epics
    // fall back to the legacy repo+commits detail.
    // #211 — Feature Map tab: index-driven, skips the epic/item fetches entirely.
    if (subRoute === 'map' && PRODUCT_META[productId]) {
      container.innerHTML = `<div class="ph-shell">${productHead(productId, 'map')}<div id="ph-map-host"><p class="muted">Loading…</p></div></div>`;
      const coords = await repoCoords();
      if (window.FeatureMapView && typeof window.FeatureMapView.render === 'function') {
        window.FeatureMapView.render(container.querySelector('#ph-map-host'), productId,
          { owner: coords.owner, repo: coords.repo, branch: coords.branch });
      }
      return;
    }

    // 'health' route removed (#211 phase-0 item 4) — old #/product/<id>/health
    // deep links fall through to the overview tab rather than 404ing.
    const PH_SURFACE_KEYS = Object.values(PRODUCT_META).flatMap(m => (m.surfaces || []).map(sf => sf.key));
    const PH_TABS = [null, 'overview', 'scenarios', ...PH_SURFACE_KEYS];
    if (PH_TABS.includes(subRoute)) {
      const tab = subRoute || 'overview';
      container.innerHTML = `<div class="ph-shell">${productHead(productId, tab)}<p class="muted">Loading…</p></div>`;
      const coords = await repoCoords();
      const projectId = (PRODUCT_META[productId] || {}).project;
      const surface = ((PRODUCT_META[productId] || {}).surfaces || []).find(sf => sf.key === tab) || null;
      const [epics, items, scen, topologyHtml] = await Promise.all([
        fetchProductEpics(productId, coords),
        fetchProductItems(productId, coords),
        tab === 'scenarios' ? fetchProductScenarios(productId, coords) : Promise.resolve(null),
        (surface && projectId) ? getFileSafe(coords.owner, coords.repo, coords.branch, `projects/${projectId}/${surface.file}`) : Promise.resolve(null),
      ]);
      if (epics.length === 0 && !PRODUCT_META[productId]) {
        // Not a pps_id product — legacy repo detail.
        try {
          const [repo, commits] = await Promise.all([Repos.getRepo(CONFIG.username, productId), Repos.getCommits(CONFIG.username, productId, 15)]);
          container.innerHTML = renderHeader(repo) + renderCommits(commits); wireBack(container);
        } catch (err) { container.innerHTML = renderError(err.message, productId); wireBack(container); }
        return;
      }
      container.innerHTML = renderProductHome(productId, tab, epics, items, scen, topologyHtml);
      wireBack(container);
      return;
    }

    // Any other sub-route: legacy repo detail.
    container.innerHTML = renderSkeleton(productId);
    wireBack(container);
    try {
      const [repo, commits] = await Promise.all([Repos.getRepo(CONFIG.username, productId), Repos.getCommits(CONFIG.username, productId, 15)]);
      container.innerHTML = renderHeader(repo) + renderCommits(commits); wireBack(container);
    } catch (err) { container.innerHTML = renderError(err.message, productId); wireBack(container); }
  }

  return { render };

})();
