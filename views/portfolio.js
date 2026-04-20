// views/portfolio.js — F1 Portfolio View
// Renders all GitHub repos as cards in the main content area

// Assigned to window so router can look it up by name via window[route.viewModule]
window.PortfolioView = (() => {

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

  const LANG_COLORS = {
    JavaScript: '#f7df1e', TypeScript: '#3178c6', Python:  '#3572a5',
    HTML:       '#e34c26', CSS:        '#563d7c',  Shell:   '#89e051',
    Go:         '#00add8', Rust:       '#dea584',  Java:    '#b07219',
    'C#':       '#178600', Ruby:       '#701516',  Swift:   '#f05138',
  };

  function langBadge(lang) {
    if (!lang) return '';
    const color = LANG_COLORS[lang] || '#64748b';
    return `<span class="lang-badge">
      <span class="lang-dot" style="background:${color}"></span>
      ${lang}
    </span>`;
  }

  function visibilityBadge(isPrivate) {
    return isPrivate
      ? `<span class="vis-badge private">Private</span>`
      : `<span class="vis-badge public">Public</span>`;
  }

  const PROVIDER_META = {
    github:    { label: 'GH',  title: 'GitHub',    cls: 'provider-gh' },
    bitbucket: { label: 'BB',  title: 'Bitbucket', cls: 'provider-bb' },
    gitlab:    { label: 'GL',  title: 'GitLab',    cls: 'provider-gl' },
  };

  function _isMultiProvider() {
    try {
      const providers = Array.isArray(CONFIG.providers) ? CONFIG.providers : [];
      const hasBB = CONFIG.bitbucket && CONFIG.bitbucket.workspace;
      return providers.length > 1 || (providers.length === 1 && hasBB);
    } catch { return false; }
  }

  function providerBadge(provider) {
    if (!provider || !_isMultiProvider()) return '';
    const meta = PROVIDER_META[provider];
    if (!meta) return '';
    return `<span class="provider-badge ${meta.cls}" title="${meta.title}">${meta.label}</span>`;
  }

  // ── Card ───────────────────────────────────────

  function renderCard(repo) {
    const desc = repo.description
      ? `<p class="card-desc">${repo.description}</p>`
      : `<p class="card-desc muted">No description</p>`;

    const topics = (repo.topics || []).slice(0, 3).map(t =>
      `<span class="topic-tag">${t}</span>`
    ).join('');

    return `
    <div class="repo-card" data-repo="${repo.name}" role="button" tabindex="0">
      <div class="card-header">
        <div class="card-title-row">
          <span class="card-name">${repo.name}</span>
          ${visibilityBadge(repo.private)}
          ${providerBadge(repo.provider)}
        </div>
        ${desc}
        ${topics ? `<div class="card-topics">${topics}</div>` : ''}
      </div>
      <div class="card-footer">
        <div class="card-meta">
          ${langBadge(repo.language)}
          <span class="meta-item">
            <span class="meta-icon">↑</span>
            ${relativeTime(repo.pushed_at)}
          </span>
        </div>
        <div class="card-stats">
          <span class="stat-item" title="Stars">★ ${repo.stargazers_count}</span>
          <span class="stat-item ${repo.open_issues_count > 0 ? 'has-issues' : ''}" title="Open issues">
            ◎ ${repo.open_issues_count}
          </span>
        </div>
      </div>
    </div>`;
  }

  // ── Skeleton loader ────────────────────────────

  function renderSkeleton() {
    const card = `<div class="repo-card skeleton">
      <div class="card-header">
        <div class="skel-line wide"></div>
        <div class="skel-line medium"></div>
        <div class="skel-line narrow"></div>
      </div>
      <div class="card-footer">
        <div class="skel-line short"></div>
      </div>
    </div>`;
    return `<div class="portfolio-header">
        <h1 class="portfolio-title">Portfolio</h1>
        <p class="portfolio-sub muted">Loading repos…</p>
      </div>
      <div class="portfolio-grid">${card.repeat(6)}</div>`;
  }

  // ── Error state ────────────────────────────────

  function renderError(msg) {
    return `<div class="view-placeholder">
      <div class="placeholder-inner">
        <span class="placeholder-icon" style="color:var(--danger)">✕</span>
        <h2>Failed to load portfolio</h2>
        <p class="muted">${msg}</p>
        <button class="btn-retry" onclick="PortfolioView.render(document.getElementById('main-content'))">
          Retry
        </button>
      </div>
    </div>`;
  }

  // ── Main render ────────────────────────────────

  async function render(container) {
    container.innerHTML = renderSkeleton();

    try {
      const repos = await Repos.listRepos();

      // Sort: most recently pushed first
      repos.sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at));

      const header = `<div class="portfolio-header">
        <h1 class="portfolio-title">Portfolio</h1>
        <p class="portfolio-sub muted">${repos.length} repo${repos.length !== 1 ? 's' : ''} · updated just now</p>
      </div>`;

      const grid = `<div class="portfolio-grid">
        ${repos.map(renderCard).join('')}
      </div>`;

      container.innerHTML = header + grid;

      // Wire up card clicks → navigate to product view
      container.querySelectorAll('.repo-card').forEach(card => {
        card.addEventListener('click', () => {
          window.location.hash = `#/product/${card.dataset.repo}`;
        });
        card.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') card.click();
        });
      });

    } catch (err) {
      container.innerHTML = renderError(err.message);
    }
  }

  return { render };

})();
