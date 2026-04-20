// views/health.js — F5 Health Check View
// Shows per-product health cards: phase, last commit, backlog pulse, activity.
// Auto-refreshes every CONFIG.healthCheckInterval minutes.

window.HealthView = (() => {

  let _refreshTimer = null;
  let _lastRefresh  = null;

  // ── Helpers ────────────────────────────────────

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function relTime(dateStr) {
    if (!dateStr) return '—';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    const hrs  = Math.floor(mins / 60);
    const days = Math.floor(hrs / 24);
    if (mins < 2)   return 'just now';
    if (mins < 60)  return `${mins}m ago`;
    if (hrs  < 24)  return `${hrs}h ago`;
    if (days < 30)  return `${days}d ago`;
    return `${Math.floor(days/30)}mo ago`;
  }

  // ── Activity status from last commit date ──────
  // Green: commit in last 7 days
  // Amber: commit in last 30 days
  // Red:   no commit in 30+ days
  // Unknown: no commits found

  function activityStatus(lastPushDate) {
    if (!lastPushDate) return 'unknown';
    const days = (Date.now() - new Date(lastPushDate).getTime()) / 86400000;
    if (days <= 7)  return 'green';
    if (days <= 30) return 'amber';
    return 'red';
  }

  function statusLabel(s) {
    if (s === 'green')   return 'Active';
    if (s === 'amber')   return 'Quiet';
    if (s === 'red')     return 'Stale';
    return 'Unknown';
  }

  // ── Activity bar (7 days) ──────────────────────
  // One column per day, filled if any commits that day

  function buildActivityBar(commits) {
    const days = 7;
    const buckets = Array(days).fill(0);
    const now = Date.now();

    commits.forEach(c => {
      const date = new Date(c.commit.author.date);
      const daysAgo = Math.floor((now - date.getTime()) / 86400000);
      if (daysAgo >= 0 && daysAgo < days) buckets[days - 1 - daysAgo]++;
    });

    return `<div class="health-activity-bar" title="Commits last 7 days">
      ${buckets.map(n => `<div class="activity-day ${n > 0 ? 'has-commits' : ''}" title="${n} commit${n !== 1 ? 's' : ''}"></div>`).join('')}
    </div>`;
  }

  // ── Backlog pulse from parsed items ───────────

  function backlogPulse(items, productName) {
    const mine   = items.filter(i => i.products.includes(productName));
    const isDone = i => i.status.includes('Done') || i.status.includes('✓');
    const open   = mine.filter(i => !isDone(i));
    const high   = open.filter(i => i.priority === 'HIGH');
    return { total: mine.length, open: open.length, high: high.length };
  }

  // ── Parse BACKLOG.md (minimal — reuse logic) ──

  function parseBacklog(md) {
    const items = [];
    const lines = md.split('\n');
    let headers = [], inTable = false;

    for (const line of lines) {
      if (!line.startsWith('|')) {
        if (/^## Backlog/.test(line)) { inTable = true; headers = []; }
        else if (/^## /.test(line) && inTable) inTable = false;
        continue;
      }
      if (!inTable) continue;
      const cells = line.split('|').slice(1,-1).map(c=>c.trim());
      if (cells.every(c=>/^[-: ]+$/.test(c))) continue;
      if (cells[0]==='#') { headers = cells.map(c=>c.toLowerCase().replace(/[()]/g,'').trim()); continue; }
      if (headers.length && /^\d+$/.test(cells[0])) {
        const item = { products: [], status: 'Open', priority: '—' };
        headers.forEach((h,i) => {
          if (i >= cells.length) return;
          const v = cells[i];
          if (h==='products') item.products = v.split(',').map(p=>p.trim()).filter(Boolean);
          else if (h==='priority') item.priority = v;
          else if (h==='status' || h==='closed') item.status = (v==='—'||v==='') ? 'Open' : v;
          else if (h==='name') item.name = v;
        });
        if (item.name) items.push(item);
      }
    }
    return items;
  }

  // ── Render Backlog meta-product card ──────────

  function renderBacklogCard(items) {
    const isDone  = i => i.status.includes('Done') || i.status.includes('✓');
    const open    = items.filter(i => !isDone(i));
    const high    = open.filter(i => i.priority === 'HIGH');
    const closed  = items.filter(isDone);
    const status  = high.length >= 3 ? 'red' : high.length >= 1 ? 'amber' : 'green';

    const openClass  = high.length > 0 ? 'danger' : open.length > 0 ? 'warning' : 'success';
    const highClass  = high.length > 0 ? 'danger' : 'success';

    return `
    <div class="health-card status-${status}">
      <div class="health-card-header">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="health-status-dot ${status}"></span>
          <span class="health-product-name">Backlog</span>
        </div>
        <span class="health-phase-badge">Meta-product</span>
      </div>

      <div class="health-card-body">

        <div class="health-row">
          <span class="health-row-label">Open items</span>
          <span class="health-row-value ${openClass}">
            ${open.length} open
            <span style="color:var(--text-muted)"> / ${items.length} total</span>
          </span>
        </div>

        <div class="health-row">
          <span class="health-row-label">HIGH priority</span>
          <span class="health-row-value ${highClass}">${high.length} item${high.length !== 1 ? 's' : ''}</span>
        </div>

        <div class="health-row">
          <span class="health-row-label">Closed</span>
          <span class="health-row-value success">${closed.length} item${closed.length !== 1 ? 's' : ''}</span>
        </div>

        <div class="health-row">
          <span class="health-row-label">Source</span>
          <span class="health-row-value accent">docs/BACKLOG.md</span>
        </div>

      </div>

      <div class="health-card-footer">
        <span class="health-status-dot ${status}" style="width:6px;height:6px"></span>
        <span class="health-status-label ${status}">${high.length === 0 ? 'Healthy' : high.length >= 3 ? 'Critical' : 'Attention'}</span>
        <span style="margin-left:auto;color:var(--text-muted)">V-Pro-Hub / docs</span>
      </div>
    </div>`;
  }

  // ── Render one product card ────────────────────

  function renderCard(productName, repo, commits, backlogItems) {
    const lastPush  = repo ? repo.pushed_at : null;
    const status    = activityStatus(lastPush);
    const pulse     = backlogPulse(backlogItems, productName);
    const lastCommit = commits[0];

    const commitMsg  = lastCommit
      ? escHtml(lastCommit.commit.message.split('\n')[0].slice(0, 60))
      : '—';
    const commitTime = lastCommit ? relTime(lastCommit.commit.author.date) : '—';
    const commitAuthor = lastCommit ? escHtml(lastCommit.commit.author.name) : '—';

    const openClass = pulse.high > 0 ? 'danger' : pulse.open > 0 ? 'warning' : 'success';

    return `
    <div class="health-card status-${status}">
      <div class="health-card-header">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="health-status-dot ${status}"></span>
          <span class="health-product-name">${escHtml(productName)}</span>
        </div>
        <span class="health-phase-badge">Phase ${repo ? escHtml(String(repo._phase || 1)) : '?'}</span>
      </div>

      <div class="health-card-body">

        <div class="health-row">
          <span class="health-row-label">Last commit</span>
          <span class="health-row-value" title="${commitMsg}">${commitTime} — ${commitMsg.slice(0,40)}${commitMsg.length>40?'…':''}</span>
        </div>

        <div class="health-row">
          <span class="health-row-label">Author</span>
          <span class="health-row-value">${commitAuthor}</span>
        </div>

        <div class="health-row">
          <span class="health-row-label">Backlog</span>
          <span class="health-row-value ${openClass}">
            ${pulse.open} open${pulse.high > 0 ? ` · ${pulse.high} HIGH` : ''}
            <span style="color:var(--text-muted)"> / ${pulse.total} total</span>
          </span>
        </div>

        <div class="health-row">
          <span class="health-row-label">Activity (7d)</span>
          ${buildActivityBar(commits)}
        </div>

      </div>

      <div class="health-card-footer">
        <span class="health-status-dot ${status}" style="width:6px;height:6px"></span>
        <span class="health-status-label ${status}">${statusLabel(status)}</span>
        <span style="margin-left:auto;color:var(--text-muted)">${repo ? escHtml(repo.full_name) : productName}</span>
      </div>
    </div>`;
  }

  // ── Skeleton ───────────────────────────────────

  function renderSkeleton() {
    return `
    <div class="health-header">
      <h1 class="health-title">Health Check</h1>
      <p class="muted" style="font-size:13px">Loading…</p>
    </div>
    <div class="health-grid">
      ${[1,2].map(() => `
        <div class="health-card status-unknown">
          <div class="health-card-header">
            <div class="skel-line" style="width:120px;height:14px"></div>
            <div class="skel-line" style="width:50px;height:14px"></div>
          </div>
          <div class="health-card-body">
            ${[1,2,3].map(()=>`<div class="health-row"><div class="skel-line" style="width:100%;height:11px"></div></div>`).join('')}
          </div>
          <div class="health-card-footer"><div class="skel-line" style="width:80px;height:10px"></div></div>
        </div>`).join('')}
    </div>`;
  }

  // ── Auto-refresh wiring ────────────────────────

  function scheduleRefresh(container) {
    if (_refreshTimer) clearInterval(_refreshTimer);
    const intervalMs = (CONFIG.healthCheckInterval || 15) * 60 * 1000;
    _refreshTimer = setInterval(() => render(container), intervalMs);
  }

  // ── Main render ────────────────────────────────

  async function render(container) {
    container.innerHTML = renderSkeleton();
    scheduleRefresh(container);

    try {
      // Products map — name → repo name
      // Only include products with a dedicated repo — cards with no repo add no value.
      // Backlog is excluded until it has its own repo (future product).
      const PRODUCTS = {
        'V-Pro-Hub':  'V-Pro-Hub',
        'Invest': 'invest',
      };

      // Fetch all repos, backlog, and commits in parallel
      const [repos, backlogMd] = await Promise.all([
        Repos.listRepos(),
        Repos.getFile(CONFIG.username, 'V-Pro-Hub', 'docs/BACKLOG.md').catch(() => ''),
      ]);

      const repoMap = {};
      repos.forEach(r => { repoMap[r.name.toLowerCase()] = r; });

      const backlogItems = backlogMd ? parseBacklog(backlogMd) : [];

      // Fetch commits only for products with repos
      const productEntries = Object.entries(PRODUCTS);
      const commitResults  = await Promise.all(
        productEntries.map(([, repoName]) =>
          repoName
            ? Repos.getCommits(CONFIG.username, repoName, 30).catch(() => [])
            : Promise.resolve([])
        )
      );

      _lastRefresh = new Date();
      const intervalMin = CONFIG.healthCheckInterval || 15;
      const nextRefresh = new Date(_lastRefresh.getTime() + intervalMin * 60000);
      const nextStr = nextRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      const cards = productEntries.map(([productName, repoName], idx) => {
        const repo    = repoMap[repoName.toLowerCase()] || null;
        if (repo) repo._phase = 1;
        const commits = commitResults[idx] || [];
        return renderCard(productName, repo, commits, backlogItems);
      }).join('');

      container.innerHTML = `
        <div class="health-header">
          <h1 class="health-title">Health Check</h1>
          <div class="health-refresh-row">
            <span class="health-refresh-info">Updated ${_lastRefresh.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} · next at ${nextStr}</span>
            <button class="btn-refresh-now" id="btn-health-refresh">Refresh now</button>
          </div>
        </div>
        <div class="health-grid">${cards}</div>`;

      container.querySelector('#btn-health-refresh')
        ?.addEventListener('click', () => render(container));

    } catch (err) {
      container.innerHTML = `<div class="view-placeholder">
        <div class="placeholder-inner">
          <span class="placeholder-icon" style="color:var(--danger)">✕</span>
          <h2>Failed to load health data</h2>
          <p class="muted">${escHtml(err.message)}</p>
          <button class="btn-retry" onclick="HealthView.render(document.getElementById('main-content'))">Retry</button>
        </div>
      </div>`;
    }
  }

  return { render };

})();
