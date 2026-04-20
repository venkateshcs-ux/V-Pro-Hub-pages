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

  async function render(container, repoName) {
    if (!repoName) {
      container.innerHTML = renderEmpty();
      wireBack(container);
      return;
    }

    container.innerHTML = renderSkeleton(repoName);
    wireBack(container);

    try {
      const [repo, commits] = await Promise.all([
        Repos.getRepo(CONFIG.username, repoName),
        Repos.getCommits(CONFIG.username, repoName, 15),
      ]);

      container.innerHTML = renderHeader(repo) + renderCommits(commits);
      wireBack(container);

    } catch (err) {
      container.innerHTML = renderError(err.message, repoName);
      wireBack(container);
    }
  }

  return { render };

})();
