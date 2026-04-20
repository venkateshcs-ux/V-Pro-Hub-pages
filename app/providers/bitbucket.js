// app/providers/bitbucket.js — Bitbucket REST API v2 adapter
// Implements the 7-method common interface.
// Auth model: Tier 3 Repository Access Tokens — Bearer, one token per repo slug.
// Constraint: no workspace-wide call possible — adapter iterates the token map.

class BitbucketAdapter {

  /**
   * @param {object} cfg              — one entry from CONFIG.providers[] (promoted from CONFIG.bitbucket)
   * @param {string} cfg.workspace    — Bitbucket workspace slug (e.g. 'dhiheraizen')
   * @param {object} cfg.tokens       — map of { repoSlug: bearerToken }
   */
  constructor(cfg) {
    this._workspace = cfg.workspace || '';
    this._tokens    = cfg.tokens    || {};
    this._base      = 'https://api.bitbucket.org/2.0';
  }

  // ── Internal helpers ────────────────────────────

  _token(repoSlug) {
    const t = this._tokens[repoSlug];
    if (!t) throw new Error(`Bitbucket adapter: no token configured for repo "${repoSlug}"`);
    return t;
  }

  _headers(repoSlug) {
    return { 'Authorization': `Bearer ${this._token(repoSlug)}` };
  }

  async _request(repoSlug, path, raw = false) {
    const res = await fetch(`${this._base}${path}`, { headers: this._headers(repoSlug) });

    if (res.status === 401) throw new Error(`Bitbucket 401 — token invalid or expired for "${repoSlug}"`);
    if (res.status === 403) throw new Error(`Bitbucket 403 — insufficient scope for "${repoSlug}"`);
    if (res.status === 404) throw new Error(`Bitbucket 404 — not found: ${path}`);
    if (!res.ok)            throw new Error(`Bitbucket ${res.status} — ${path}`);

    return raw ? res.text() : res.json();
  }

  // ── Field normalisation ─────────────────────────
  // Maps Bitbucket v2 field names to the common display fields expected by views.

  _normaliseRepo(data) {
    data.provider         = 'bitbucket';
    data.private          = data.is_private ?? data.private ?? false;
    data.pushed_at        = data.updated_on  || data.pushed_at  || null;
    data.html_url         = data.links?.html?.href || '';
    data.default_branch   = data.mainbranch?.name  || 'master';
    data.stargazers_count = 0;          // Bitbucket has no stars concept
    data.open_issues_count= 0;          // requires extra call — not fetched here
    data.topics           = [];         // Bitbucket uses project tags, not repo topics
    // Capitalise language for consistent display (Bitbucket returns lowercase)
    if (data.language && typeof data.language === 'string') {
      data.language = data.language.charAt(0).toUpperCase() + data.language.slice(1);
    }
    return data;
  }

  // ── Common interface — 7 methods ────────────────

  /**
   * Verify auth — tests the first configured token by calling getRepo().
   * Returns a pseudo-user object (Bitbucket repo tokens have no /user endpoint).
   */
  async verifyAuth() {
    const slugs = Object.keys(this._tokens);
    if (slugs.length === 0) throw new Error('Bitbucket adapter: no repos configured in tokens map');

    const repo = await this.getRepo(this._workspace, slugs[0]);
    return {
      provider:  'bitbucket',
      login:     this._workspace,
      workspace: this._workspace,
      repoCount: slugs.length,
      sampleRepo: repo.name || slugs[0],
    };
  }

  /**
   * List all configured repos (one API call per slug — Tier 3 constraint).
   * Failures on individual slugs are logged and skipped (partial-success model).
   */
  async listRepos() {
    const slugs = Object.keys(this._tokens);
    const settled = await Promise.allSettled(
      slugs.map(slug => this.getRepo(this._workspace, slug))
    );
    const repos = [];
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        repos.push(r.value);
      } else {
        console.warn('[BitbucketAdapter] listRepos partial failure:', r.reason?.message);
      }
    }
    return repos;
  }

  /** Get a single repo — owner = workspace slug, repo = repo slug */
  async getRepo(owner, repo) {
    const data = await this._request(repo, `/repositories/${owner}/${repo}`);
    return this._normaliseRepo(data);
  }

  /** Get recent commits for a repo */
  async getCommits(owner, repo, perPage = 20) {
    const data  = await this._request(repo, `/repositories/${owner}/${repo}/commits?pagelen=${perPage}`);
    const items = data.values || [];
    items.forEach(c => { c.provider = 'bitbucket'; });
    return items;
  }

  /**
   * Get open issues for a repo.
   * Returns an empty array if the issue tracker is not enabled (404).
   */
  async getIssues(owner, repo) {
    try {
      const data  = await this._request(repo, `/repositories/${owner}/${repo}/issues?q=state%3D%22open%22&pagelen=50`);
      const items = data.values || [];
      items.forEach(i => { i.provider = 'bitbucket'; });
      return items;
    } catch (e) {
      if (e.message.includes('404')) return [];
      throw e;
    }
  }

  /**
   * Get raw file content from a repo.
   * Bitbucket /src endpoint returns raw text directly (not base64-encoded).
   */
  async getFile(owner, repo, path) {
    try {
      return await this._request(repo, `/repositories/${owner}/${repo}/src/HEAD/${path}`, true);
    } catch (e) {
      if (e.message.includes('404')) return null;
      throw e;
    }
  }

  /** Bitbucket REST API v2 does not expose a rate-limit endpoint — return a stub */
  async getRateLimit() {
    return {
      provider:  'bitbucket',
      note:      'Bitbucket does not expose rate limits via REST API v2',
      limit:     null,
      remaining: null,
      reset:     null,
    };
  }
}

window.BitbucketAdapter = BitbucketAdapter;
