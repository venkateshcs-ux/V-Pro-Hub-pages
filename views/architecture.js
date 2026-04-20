// views/architecture.js — Architecture diagram view
// Renders the multi-provider architecture as a visual diagram
// Decision: #19 (D25–D33) — Adapter pattern, Repos facade

window.ArchitectureView = (() => {

  function render(container) {
    container.innerHTML = `
    <div class="arch-view">

      <div class="arch-header">
        <h1 class="arch-title">Multi-Provider Architecture</h1>
        <p class="arch-subtitle">Backlog #19 — Adapter pattern with Repos facade (read-only)</p>
      </div>

      <!-- ── Layer diagram ─────────────────────── -->
      <div class="arch-diagram">

        <!-- Views layer -->
        <div class="arch-layer">
          <div class="arch-layer-label">Views</div>
          <div class="arch-row">
            <div class="arch-box arch-view-box">portfolio.js</div>
            <div class="arch-box arch-view-box">product.js</div>
            <div class="arch-box arch-view-box">session.js</div>
            <div class="arch-box arch-view-box">health.js</div>
            <div class="arch-box arch-view-box">backlog.js</div>
            <div class="arch-box arch-view-box">context.js</div>
            <div class="arch-box arch-view-box">settings.js</div>
          </div>
          <div class="arch-note">All views call <code>Repos.*</code> — never a provider directly</div>
        </div>

        <div class="arch-arrow">
          <div class="arch-arrow-line"></div>
          <div class="arch-arrow-head"></div>
        </div>

        <!-- Repos facade -->
        <div class="arch-layer">
          <div class="arch-layer-label">Facade</div>
          <div class="arch-row">
            <div class="arch-box arch-facade-box">
              <div class="arch-box-title">Repos</div>
              <div class="arch-box-file">app/repos.js</div>
              <div class="arch-box-details">
                <span class="arch-detail">Routes to owning provider</span>
                <span class="arch-detail">Aggregates cross-provider</span>
                <span class="arch-detail">Backward-compat shim</span>
              </div>
            </div>
          </div>
        </div>

        <div class="arch-arrow arch-arrow-fan">
          <div class="arch-fan-lines">
            <div class="arch-fan-line arch-fan-left"></div>
            <div class="arch-fan-line arch-fan-center"></div>
            <div class="arch-fan-line arch-fan-right"></div>
          </div>
        </div>

        <!-- Provider adapters -->
        <div class="arch-layer">
          <div class="arch-layer-label">Adapters</div>
          <div class="arch-row arch-row-adapters">
            <div class="arch-box arch-adapter-box arch-adapter-github">
              <div class="arch-box-title">GitHub Adapter</div>
              <div class="arch-box-file">providers/github.js</div>
              <div class="arch-box-auth">Auth: <code>token {PAT}</code></div>
              <div class="arch-adapter-status arch-status-active">Active</div>
            </div>
            <div class="arch-box arch-adapter-box arch-adapter-gitlab">
              <div class="arch-box-title">GitLab Adapter</div>
              <div class="arch-box-file">providers/gitlab.js</div>
              <div class="arch-box-auth">Auth: <code>Private-Token</code></div>
              <div class="arch-adapter-status arch-status-future">Phase 2b</div>
            </div>
            <div class="arch-box arch-adapter-box arch-adapter-bitbucket">
              <div class="arch-box-title">Bitbucket Adapter</div>
              <div class="arch-box-file">providers/bitbucket.js</div>
              <div class="arch-box-auth">Auth: <code>Basic base64</code></div>
              <div class="arch-adapter-status arch-status-future">Phase 2b</div>
            </div>
          </div>
        </div>

        <div class="arch-arrow arch-arrow-fan">
          <div class="arch-fan-lines">
            <div class="arch-fan-line arch-fan-left"></div>
            <div class="arch-fan-line arch-fan-center"></div>
            <div class="arch-fan-line arch-fan-right"></div>
          </div>
        </div>

        <!-- External APIs -->
        <div class="arch-layer">
          <div class="arch-layer-label">External APIs</div>
          <div class="arch-row arch-row-adapters">
            <div class="arch-box arch-api-box">
              <div class="arch-box-title">GitHub REST v3</div>
              <div class="arch-box-file">api.github.com</div>
            </div>
            <div class="arch-box arch-api-box">
              <div class="arch-box-title">GitLab REST v4</div>
              <div class="arch-box-file">gitlab.com/api/v4</div>
            </div>
            <div class="arch-box arch-api-box">
              <div class="arch-box-title">Bitbucket REST v2</div>
              <div class="arch-box-file">api.bitbucket.org/2.0</div>
            </div>
          </div>
        </div>

      </div>

      <!-- ── Interface contract ────────────────── -->
      <div class="arch-section">
        <h2 class="arch-section-title">Common Interface</h2>
        <p class="arch-section-sub">Every adapter implements these 7 read-only methods</p>
        <div class="arch-interface">
          <div class="arch-method">
            <span class="arch-method-name">verifyAuth()</span>
            <span class="arch-method-arrow">&rarr;</span>
            <span class="arch-method-return">UserInfo</span>
          </div>
          <div class="arch-method">
            <span class="arch-method-name">listRepos()</span>
            <span class="arch-method-arrow">&rarr;</span>
            <span class="arch-method-return">RepoInfo[]</span>
          </div>
          <div class="arch-method">
            <span class="arch-method-name">getRepo(owner, repo)</span>
            <span class="arch-method-arrow">&rarr;</span>
            <span class="arch-method-return">RepoInfo</span>
          </div>
          <div class="arch-method">
            <span class="arch-method-name">getCommits(owner, repo, limit)</span>
            <span class="arch-method-arrow">&rarr;</span>
            <span class="arch-method-return">CommitInfo[]</span>
          </div>
          <div class="arch-method">
            <span class="arch-method-name">getIssues(owner, repo)</span>
            <span class="arch-method-arrow">&rarr;</span>
            <span class="arch-method-return">IssueInfo[]</span>
          </div>
          <div class="arch-method">
            <span class="arch-method-name">getFile(owner, repo, path)</span>
            <span class="arch-method-arrow">&rarr;</span>
            <span class="arch-method-return">string | null</span>
          </div>
          <div class="arch-method">
            <span class="arch-method-name">getRateLimit()</span>
            <span class="arch-method-arrow">&rarr;</span>
            <span class="arch-method-return">RateLimitInfo | null</span>
          </div>
        </div>
      </div>

      <!-- ── Normalised shapes ─────────────────── -->
      <div class="arch-section">
        <h2 class="arch-section-title">Normalised Response Shapes</h2>
        <p class="arch-section-sub">All responses include <code>provider</code> field for badge rendering</p>
        <div class="arch-shapes">
          <div class="arch-shape-card">
            <div class="arch-shape-name">UserInfo</div>
            <code class="arch-shape-fields">{ username, displayName, avatarUrl, provider }</code>
          </div>
          <div class="arch-shape-card">
            <div class="arch-shape-name">RepoInfo</div>
            <code class="arch-shape-fields">{ name, fullName, owner, description, language, defaultBranch, isPrivate, url, updatedAt, createdAt, provider, _raw }</code>
          </div>
          <div class="arch-shape-card">
            <div class="arch-shape-name">CommitInfo</div>
            <code class="arch-shape-fields">{ sha, message, author, date, url, provider }</code>
          </div>
          <div class="arch-shape-card">
            <div class="arch-shape-name">IssueInfo</div>
            <code class="arch-shape-fields">{ number, title, state, createdAt, url, provider }</code>
          </div>
          <div class="arch-shape-card">
            <div class="arch-shape-name">RateLimitInfo</div>
            <code class="arch-shape-fields">{ limit, remaining, resetAt, provider } | null</code>
          </div>
        </div>
      </div>

      <!-- ── Facade routing ────────────────────── -->
      <div class="arch-section">
        <h2 class="arch-section-title">Facade Routing</h2>
        <div class="arch-routing-table">
          <div class="arch-route-row arch-route-header">
            <span class="arch-route-method">Method</span>
            <span class="arch-route-target">Routes to</span>
          </div>
          <div class="arch-route-row">
            <span class="arch-route-method"><code>getUser()</code></span>
            <span class="arch-route-target">Primary provider only</span>
          </div>
          <div class="arch-route-row">
            <span class="arch-route-method"><code>listRepos()</code></span>
            <span class="arch-route-target arch-route-all">ALL providers — merge, sort by updatedAt</span>
          </div>
          <div class="arch-route-row">
            <span class="arch-route-method"><code>getRepo(o, r)</code></span>
            <span class="arch-route-target">Owning provider (username match &rarr; discovery)</span>
          </div>
          <div class="arch-route-row">
            <span class="arch-route-method"><code>getCommits(o, r, n)</code></span>
            <span class="arch-route-target">Owning provider</span>
          </div>
          <div class="arch-route-row">
            <span class="arch-route-method"><code>getIssues(o, r)</code></span>
            <span class="arch-route-target">Owning provider</span>
          </div>
          <div class="arch-route-row">
            <span class="arch-route-method"><code>getFile(o, r, p)</code></span>
            <span class="arch-route-target">Owning provider</span>
          </div>
          <div class="arch-route-row">
            <span class="arch-route-method"><code>getRateLimit()</code></span>
            <span class="arch-route-target">Primary provider</span>
          </div>
        </div>
      </div>

      <!-- ── Migration phases ──────────────────── -->
      <div class="arch-section">
        <h2 class="arch-section-title">Migration Phases</h2>
        <div class="arch-phases">
          <div class="arch-phase-card">
            <div class="arch-phase-badge arch-phase-next">Next</div>
            <div class="arch-phase-label">Phase 2a — Abstraction Layer</div>
            <div class="arch-phase-model">Sonnet &middot; ~45 min</div>
            <ul class="arch-phase-tasks">
              <li>Create providers/github.js adapter</li>
              <li>Create repos.js facade</li>
              <li>Migrate 14 call sites</li>
              <li>Update config + script tags</li>
            </ul>
          </div>
          <div class="arch-phase-card">
            <div class="arch-phase-badge arch-phase-planned">Planned</div>
            <div class="arch-phase-label">Phase 2b — Second Provider</div>
            <div class="arch-phase-model">Sonnet &middot; ~30 min</div>
            <ul class="arch-phase-tasks">
              <li>Create GitLab or Bitbucket adapter</li>
              <li>Cross-provider aggregation</li>
              <li>Settings view — manage providers</li>
              <li>Provider badges in views</li>
            </ul>
          </div>
          <div class="arch-phase-card">
            <div class="arch-phase-badge arch-phase-planned">Planned</div>
            <div class="arch-phase-label">Phase 2c — Scan + AI Suggestions</div>
            <div class="arch-phase-model">Opus + Sonnet &middot; ~60 min</div>
            <ul class="arch-phase-tasks">
              <li>Repo onboarding flow</li>
              <li>Auto-scan: README, structure, issues</li>
              <li>Surface improvement suggestions</li>
              <li>Security flags + test gaps</li>
            </ul>
          </div>
        </div>
      </div>

    </div>`;
  }

  return { render };

})();
