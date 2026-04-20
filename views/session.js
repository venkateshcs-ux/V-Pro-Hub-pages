// views/session.js — F3 Session Log View
// Shows commits across all repos grouped by date (each date = one session)

window.SessionView = (() => {

  // ── Helpers ────────────────────────────────────

  function dateKey(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
  }

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

  function timeOfDay(dateStr) {
    return new Date(dateStr).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  function shortSha(sha) { return sha ? sha.substring(0, 7) : '—'; }

  // ── Group commits by calendar date ─────────────

  function groupByDate(allCommits) {
    const groups = {};
    allCommits.forEach(({ commit, sha, repo }) => {
      const key = dateKey(commit.author.date);
      if (!groups[key]) groups[key] = { date: commit.author.date, entries: [] };
      groups[key].entries.push({ commit, sha, repo });
    });
    // Sort entries within each group newest first
    Object.values(groups).forEach(g =>
      g.entries.sort((a, b) => new Date(b.commit.author.date) - new Date(a.commit.author.date))
    );
    // Return groups sorted newest first
    return Object.entries(groups)
      .sort(([, a], [, b]) => new Date(b.date) - new Date(a.date));
  }

  // ── Render a single commit entry ───────────────

  function renderEntry({ commit, sha, repo }) {
    const msg = commit.message.split('\n')[0];
    const truncated = msg.length > 72 ? msg.substring(0, 69) + '…' : msg;
    return `
    <div class="session-entry">
      <span class="entry-time">${timeOfDay(commit.author.date)}</span>
      <span class="entry-sha">${shortSha(sha)}</span>
      <span class="entry-repo">${repo}</span>
      <span class="entry-msg" title="${msg.replace(/"/g, '&quot;')}">${truncated}</span>
    </div>`;
  }

  // ── Render a session group (one date) ──────────

  function renderGroup([dateLabel, { date, entries }]) {
    return `
    <div class="session-group">
      <div class="session-date-header">
        <span class="session-date-label">${dateLabel}</span>
        <span class="session-date-rel">${relativeTime(date)}</span>
        <span class="session-entry-count">${entries.length} commit${entries.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="session-entries">
        ${entries.map(renderEntry).join('')}
      </div>
    </div>`;
  }

  // ── Filter bar ─────────────────────────────────

  function renderFilterBar(repos, activeFilter) {
    const pills = ['all', ...repos].map(r => `
      <button class="filter-pill ${r === activeFilter ? 'active' : ''}" data-repo="${r}">
        ${r === 'all' ? 'All repos' : r}
      </button>`).join('');
    return `<div class="filter-bar">${pills}</div>`;
  }

  // ── Skeleton ───────────────────────────────────

  function renderSkeleton() {
    return `
    <div class="session-header">
      <h1 class="session-title">Session Log</h1>
      <p class="session-sub muted">Loading commits…</p>
    </div>
    <div class="filter-bar">
      <div class="skel-line" style="width:70px;height:28px;border-radius:20px"></div>
      <div class="skel-line" style="width:90px;height:28px;border-radius:20px"></div>
    </div>
    ${[1,2].map(() => `
      <div class="session-group">
        <div class="session-date-header"><div class="skel-line" style="width:200px;height:14px"></div></div>
        <div class="session-entries">
          ${[1,2,3].map(() => `<div class="session-entry skeleton">
            <div class="skel-line" style="width:35px;height:12px"></div>
            <div class="skel-line" style="width:50px;height:12px"></div>
            <div class="skel-line" style="width:80px;height:12px"></div>
            <div class="skel-line" style="width:60%;height:12px"></div>
          </div>`).join('')}
        </div>
      </div>`).join('')}`;
  }

  // ── State ──────────────────────────────────────

  let _allCommits = [];
  let _repos      = [];
  let _filter     = 'all';
  let _container  = null;

  function applyFilter() {
    const filtered = _filter === 'all'
      ? _allCommits
      : _allCommits.filter(c => c.repo === _filter);

    const groups = groupByDate(filtered);

    const body = groups.length === 0
      ? `<div class="section-empty">No commits found for "${_filter}".</div>`
      : groups.map(renderGroup).join('');

    const header = `
      <div class="session-header">
        <h1 class="session-title">Session Log</h1>
        <p class="session-sub muted">${filtered.length} commit${filtered.length !== 1 ? 's' : ''} across ${groups.length} session${groups.length !== 1 ? 's' : ''}</p>
      </div>`;

    _container.innerHTML = header + renderFilterBar(_repos, _filter) + body;

    // Wire filter pills
    _container.querySelectorAll('.filter-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        _filter = pill.dataset.repo;
        applyFilter();
      });
    });
  }

  // ── Main render ────────────────────────────────

  async function render(container) {
    _container = container;
    _filter    = 'all';
    container.innerHTML = renderSkeleton();

    try {
      // Fetch commits from all repos in parallel
      const repos = await Repos.listRepos();
      _repos = repos.map(r => r.name);

      const commitsByRepo = await Promise.all(
        repos.map(async repo => {
          try {
            const commits = await Repos.getCommits(CONFIG.username, repo.name, 30);
            return commits.map(c => ({ ...c, repo: repo.name }));
          } catch {
            return []; // skip repos with no commits
          }
        })
      );

      _allCommits = commitsByRepo.flat()
        .sort((a, b) => new Date(b.commit.author.date) - new Date(a.commit.author.date));

      applyFilter();

    } catch (err) {
      container.innerHTML = `<div class="view-placeholder">
        <div class="placeholder-inner">
          <span class="placeholder-icon" style="color:var(--danger)">✕</span>
          <h2>Failed to load session log</h2>
          <p class="muted">${err.message}</p>
          <button class="btn-retry" onclick="SessionView.render(document.getElementById('main-content'))">Retry</button>
        </div>
      </div>`;
    }
  }

  return { render };

})();
