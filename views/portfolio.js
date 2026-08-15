// views/portfolio.js — F1 Portfolio View (S120 IA redesign, Phase 1)
// Renders PRODUCTS (pps_id), not raw repos — per the CD-designed target IA.
// A product is a pps_id; a repo is metadata on it. Every product (incl. ones with
// no repo, like Shreemantra) gets a card and is reachable → #/product/<id>/backlog.
// Derived from docs/epics/*.md (pps_id + code_status). Repo metadata joined where present.

window.PortfolioView = (() => {

  // Friendly names + classification for known products (pps_id → meta).
  const PRODUCT_META = {
    vprohub:    { name: 'V-Pro-Hub',        tag: 'The infra / orchestration product',      repo: 'V-Pro-Hub', client: false },
    shreemantra:{ name: 'Shreemantra',      tag: 'Heraizen B2B2C healing platform (PM)',    repo: null,        client: true  },
    cu:         { name: 'CU — Christ Univ.', tag: 'IJS scholarly publishing engagement',    repo: null,        client: true  },
    heraizen:   { name: 'Heraizen',         tag: 'Counterparty platform',                   repo: null,        client: true  },
    exec:       { name: 'Executive Bridge', tag: 'AI executive activation (24-month plan)',  repo: null,        client: false },
    'ref-impl': { name: 'Reference Impl',   tag: 'Reference implementations',               repo: null,        client: false },
  };

  const STATUS_CHIP = { BUILT: 'st-built', COVERED: 'st-built', DOCUMENTED: 'st-built',
    PARTIAL: 'st-partial', MISSING: 'st-missing', NONE: 'st-missing', UNCLEAR: 'st-unknown' };

  // ── Frontmatter parse (minimal, mirrors product-backlog.js) ──
  function parseFrontmatter(md) {
    const out = {};
    const m = /^---\n([\s\S]*?)\n---/.exec(md || '');
    if (!m) return out;
    for (const line of m[1].split('\n')) {
      const km = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
      if (km) { let v = km[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); out[km[1]] = v; }
    }
    return out;
  }

  // NOTE: we deliberately avoid Repos.listDirectory — it always hits the REMOTE
  // adapter (the local file adapter is getFile-only), so it hangs when the network
  // is degraded. getFile() consults the local adapter first, so we drive everything
  // off the getFile-able index files (EPICS.md / FEATURES.md) instead. Robust + local.
  // Timeout wrapper — a hanging getFile (local adapter falling through to a
  // degraded remote) resolves to null instead of stalling the whole render.
  function withTimeout(promise, ms, fallback) {
    return Promise.race([promise, new Promise(r => setTimeout(() => r(fallback), ms))]);
  }
  async function getFileSafe(owner, repo, branch, path) {
    try { return await withTimeout(Repos.getFile(owner, repo, path, branch), 7000, null); }
    catch { return null; }
  }

  function epicPathsFromIndex(md) {
    const paths = new Set(); const re = /\(epics\/(E-\d+[A-Za-z0-9._-]*?\.md)\)/g; let m;
    while ((m = re.exec(md || ''))) paths.add('docs/epics/' + m[1]);
    return [...paths];
  }

  // Count features per pps_id by mapping each FEATURES.md row's "contained-by Epic"
  // (E-NN) to that epic's pps_id — no per-feature fetch needed.
  function featureCountsByPps(featuresMd, epicIdToPps) {
    const counts = {};
    (featuresMd || '').split('\n').forEach(line => {
      if (!/^\|\s*\[F-/.test(line)) return;
      const em = /\bE-\d+\b/.exec(line);
      if (!em) return;
      const pps = epicIdToPps[em[0]];
      if (pps) counts[pps] = (counts[pps] || 0) + 1;
    });
    return counts;
  }

  function pct(n, total) { return total ? `${Math.round((n / total) * 100)}%` : '0%'; }

  // ── Product card (token-based, matches CD design) ──
  function renderCard(p) {
    const total = p.built + p.partial + p.missing;
    const repoChip = p.repo
      ? `<span class="bl-chip st-unknown" style="border-color:var(--gh-bd);background:var(--gh-bg);color:var(--gh-fg)">GH · ${p.repo}</span>`
      : `<span class="bl-chip st-na">pps_id only</span>`;
    const client = p.client ? `<span class="bl-chip" style="background:var(--accent3-soft-bg);color:var(--accent3-soft-fg);border:1px solid var(--accent3-soft-bd)">CLIENT</span>` : '';
    const healthBar = total
      ? `<div style="display:flex;height:7px;border-radius:5px;overflow:hidden;background:var(--surface-raised);border:1px solid var(--border)">
           <span style="width:${pct(p.built, total)};background:var(--success)"></span>
           <span style="width:${pct(p.partial, total)};background:var(--warning)"></span>
           <span style="width:${pct(p.missing, total)};background:var(--danger)"></span>
         </div>
         <div style="display:flex;gap:14px;margin-top:7px;font-family:var(--font-mono);font-size:10.5px;color:var(--text-muted)">
           <span><span style="color:var(--success-soft-fg)">●</span> ${p.built} built</span>
           <span><span style="color:var(--warning-soft-fg)">●</span> ${p.partial} partial</span>
           <span><span style="color:var(--danger-soft-fg)">●</span> ${p.missing} missing</span>
         </div>`
      : `<div style="font-family:var(--font-mono);font-size:11px;color:var(--text-dim)">internal epics — no counterparty status</div>`;
    return `
    <div class="product-card" data-pid="${p.id}" role="button" tabindex="0"
         style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px 16px 14px;cursor:pointer;transition:border-color var(--transition),transform var(--transition);display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
        <div style="min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <h3 style="font-family:var(--font-ui);font-size:16px;font-weight:600;margin:0;letter-spacing:-.01em">${p.name}</h3>
            ${client}
          </div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:3px">${p.tag}</div>
        </div>
        ${repoChip}
      </div>
      <div>${healthBar}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding-top:11px;border-top:1px solid var(--border)">
        <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted)">${p.epicCount} epic${p.epicCount !== 1 ? 's' : ''} · ${p.featureCount} feature${p.featureCount !== 1 ? 's' : ''}</div>
        <div style="text-align:right;flex:none">
          <div style="font-family:var(--font-ui);font-size:19px;font-weight:700;line-height:1;color:var(--accent-soft-fg)">${total || p.epicCount}</div>
          <div style="font-family:var(--font-mono);font-size:9.5px;color:var(--text-dim)">${total ? 'tracked' : 'epics'}</div>
        </div>
      </div>
    </div>`;
  }

  function renderSkeleton() {
    return `<div class="portfolio-header"><h1 class="portfolio-title">Portfolio</h1>
      <p class="portfolio-sub muted">Loading products…</p></div>`;
  }

  function renderError(msg) {
    return `<div class="view-placeholder"><div class="placeholder-inner">
      <span class="placeholder-icon" style="color:var(--danger)">✕</span>
      <h2>Failed to load portfolio</h2><p class="muted">${msg}</p>
      <button class="btn-retry" onclick="PortfolioView.render(document.getElementById('main-content'))">Retry</button>
    </div></div>`;
  }

  async function render(container) {
    container.innerHTML = renderSkeleton();
    try {
      const provider = (typeof CONFIG !== 'undefined' && CONFIG.providers && CONFIG.providers[0]) || {};
      const owner = provider.username || 'venkateshcs-ux';
      const repo = (typeof CONFIG !== 'undefined' && CONFIG.dashboardRepo) || 'V-Pro-Hub';
      // Branch discovery hits the remote — cap it so a degraded network can't stall
      // the view. getFile falls back to the local adapter with branch=undefined anyway.
      let branch;
      if (window.ActiveSprint && typeof window.ActiveSprint.getActiveSprintBranch === 'function') {
        const disc = await withTimeout(
          window.ActiveSprint.getActiveSprintBranch(owner, repo).catch(() => null), 2500, null);
        if (disc && disc.branch) branch = disc.branch;
      }

      const [epicsIndex, featuresIndex] = await Promise.all([
        getFileSafe(owner, repo, branch, 'docs/EPICS.md'),
        getFileSafe(owner, repo, branch, 'docs/FEATURES.md'),
      ]);
      const epicPaths = epicPathsFromIndex(epicsIndex);
      const epicFms = (await Promise.all(epicPaths.map(async p => {
        const md = await getFileSafe(owner, repo, branch, p);
        return md ? parseFrontmatter(md) : null;
      }))).filter(Boolean);

      // Group by pps_id → product
      const byId = {};
      const epicIdToPps = {};
      epicFms.forEach(e => {
        const id = e.pps_id; if (!id) return;
        if (e.id) epicIdToPps[e.id] = id;
        const p = byId[id] || (byId[id] = { id, epicCount: 0, featureCount: 0, built: 0, partial: 0, missing: 0 });
        p.epicCount++;
        const s = (e.code_status || '').toUpperCase();
        if (s === 'BUILT') p.built++; else if (s === 'PARTIAL') p.partial++; else if (s === 'MISSING' || s === 'NONE') p.missing++;
      });
      const fc = featureCountsByPps(featuresIndex, epicIdToPps);
      Object.keys(fc).forEach(pps => { if (byId[pps]) byId[pps].featureCount = fc[pps]; });

      const products = Object.values(byId).map(p => {
        const meta = PRODUCT_META[p.id] || { name: p.id, tag: '', repo: null, client: false };
        return { ...p, ...meta };
      }).sort((a, b) => (b.built + b.partial + b.missing) - (a.built + a.partial + a.missing) || a.name.localeCompare(b.name));

      const noRepo = products.filter(p => !p.repo).length;
      const header = `<div class="portfolio-header" style="max-width:1180px;margin:0 auto">
        <h1 class="portfolio-title">Portfolio</h1>
        <p class="portfolio-sub muted">${products.length} products · a product is a <span style="font-family:var(--font-mono);color:var(--accent-soft-fg)">pps_id</span> — repo is metadata</p>
        <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-muted);background:var(--accent-soft-bg);border:1px solid var(--accent-soft-bd);border-radius:8px;padding:9px 12px;margin:12px 0 4px">
          <span style="font-family:var(--font-mono);font-size:10px;font-weight:600;color:var(--accent-soft-fg);background:var(--surface);border:1px solid var(--accent-soft-bd);padding:2px 6px;border-radius:5px">FIX</span>
          <span>Every product now has a card — including the ${noRepo} that exist only as a <span style="font-family:var(--font-mono)">pps_id</span> (no repo), like <strong style="color:var(--text)">Shreemantra</strong>. Previously unreachable.</span>
        </div>
      </div>`;
      const grid = `<div class="portfolio-grid" style="max-width:1180px;margin:14px auto 0;display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px">
        ${products.map(renderCard).join('')}
      </div>`;
      container.innerHTML = header + grid;

      container.querySelectorAll('.product-card').forEach(card => {
        const go = () => { window.location.hash = `#/product/${card.dataset.pid}`; };
        card.addEventListener('click', go);
        card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
        card.addEventListener('mouseenter', () => { card.style.borderColor = 'var(--accent)'; card.style.transform = 'translateY(-2px)'; });
        card.addEventListener('mouseleave', () => { card.style.borderColor = 'var(--border)'; card.style.transform = 'none'; });
      });
    } catch (err) {
      container.innerHTML = renderError(err.message || String(err));
    }
  }

  return { render };

})();
