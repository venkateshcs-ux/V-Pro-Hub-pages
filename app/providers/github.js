// app/providers/github.js — GitHub REST API v3 adapter
// Implements the 7-method common interface.
// Phase 2a: passes raw GitHub responses through (field normalisation in Phase 2b).

class GitHubAdapter {

  /**
   * @param {object} cfg  — one entry from CONFIG.providers[]
   * @param {string} cfg.baseUrl   — e.g. 'https://api.github.com' (or GHE URL)
   * @param {object} cfg.auth      — { type: 'pat', token: 'ghp_…' }
   * @param {string} cfg.username  — authenticated user's login
   */
  constructor(cfg) {
    this._base     = (cfg.baseUrl || 'https://api.github.com').replace(/\/$/, '');
    this._auth     = cfg.auth  || {};
    this._username = cfg.username || '';
  }

  // ── Internal helpers ────────────────────────────

  _headers() {
    const h = { 'Accept': 'application/vnd.github.v3+json' };
    if (this._auth.token) h['Authorization'] = `token ${this._auth.token}`;
    return h;
  }

  async _request(path) {
    const res = await fetch(`${this._base}${path}`, { headers: this._headers() });

    if (res.status === 401) throw new Error('GitHub 401 — PAT invalid or expired');
    if (res.status === 403) throw new Error('GitHub 403 — rate limit or insufficient scopes');
    if (res.status === 404) throw new Error(`GitHub 404 — not found: ${path}`);
    if (!res.ok)            throw new Error(`GitHub ${res.status} — ${path}`);

    const data = await res.json();
    // Attach rate-limit info (consumed by dashboard and repos facade)
    data._rateLimit = {
      limit:     parseInt(res.headers.get('X-RateLimit-Limit')     || '0'),
      remaining: parseInt(res.headers.get('X-RateLimit-Remaining') || '0'),
      reset:     parseInt(res.headers.get('X-RateLimit-Reset')     || '0'),
    };
    return data;
  }

  /** Decode base64 string as UTF-8 (atob alone breaks multi-byte chars like —, …) */
  static _decodeBase64Utf8(base64) {
    const binary = atob(base64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  // ── Common interface — 7 methods ────────────────

  /** Verify auth and return user info (raw GitHub response + provider tag) */
  async verifyAuth() {
    const data = await this._request('/user');
    data.provider = 'github';
    return data;
  }

  /** List all repos for the authenticated user (raw GitHub response array) */
  async listRepos() {
    const data = await this._request(`/user/repos?per_page=100&sort=updated`);
    if (Array.isArray(data)) data.forEach(r => { r.provider = 'github'; });
    return data;
  }

  /** Get a single repo by owner/name */
  async getRepo(owner, repo) {
    const data = await this._request(`/repos/${owner}/${repo}`);
    data.provider = 'github';
    return data;
  }

  /** Get recent commits for a repo */
  async getCommits(owner, repo, perPage = 20) {
    const data = await this._request(`/repos/${owner}/${repo}/commits?per_page=${perPage}`);
    if (Array.isArray(data)) data.forEach(c => { c.provider = 'github'; });
    return data;
  }

  /** Get open issues for a repo */
  async getIssues(owner, repo) {
    const data = await this._request(`/repos/${owner}/${repo}/issues?state=open&per_page=1`);
    if (Array.isArray(data)) data.forEach(i => { i.provider = 'github'; });
    return data;
  }

  /** Get raw file content from a repo (returns decoded string or null) */
  async getFile(owner, repo, path) {
    try {
      const data = await this._request(`/repos/${owner}/${repo}/contents/${path}`);
      if (data.encoding === 'base64') {
        return GitHubAdapter._decodeBase64Utf8(data.content.replace(/\n/g, ''));
      }
      return await this._getFileViaTree(owner, repo, path);
    } catch (e) {
      if (e.message.includes('404')) {
        try { return await this._getFileViaTree(owner, repo, path); }
        catch { return null; }
      }
      throw e;
    }
  }


  /** Get file content + sha (for SHA-guarded writeback) */
  async getFileWithSha(owner, repo, path) {
    try {
      const data = await this._request(`/repos/${owner}/${repo}/contents/${path}`);
      if (data.encoding === 'base64') {
        return {
          content: GitHubAdapter._decodeBase64Utf8(data.content.replace(/\n/g, '')),
          sha: data.sha,
        };
      }
      return null;
    } catch (e) {
      if (e.message.includes('404')) return null;
      throw e;
    }
  }

  /** PUT file content (Contents API) — requires sha for updates; omit for new files.
      Throws on 409 SHA conflict (someone else edited). */
  async putFile(owner, repo, path, content, sha, message) {
    const url = `${this._base}/repos/${owner}/${repo}/contents/${path}`;
    const body = {
      message: message || `Update ${path}`,
      content: btoa(unescape(encodeURIComponent(content))),  // utf-8 → base64
      branch: 'master',
    };
    if (sha) body.sha = sha;

    const res = await fetch(url, {
      method: 'PUT',
      headers: { ...this._headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.status === 409) {
      const e = new Error(`SHA conflict on ${path} — someone else edited this`);
      e.code = 'sha_conflict';
      e.status = 409;
      throw e;
    }
    if (res.status === 401) throw new Error('GitHub 401 — PAT invalid or expired');
    if (res.status === 403) throw new Error('GitHub 403 — rate limit or insufficient scopes (need `repo` write)');
    if (res.status === 404) throw new Error(`GitHub 404 — not found: ${path}`);
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).message || ''; } catch {}
      throw new Error(`GitHub ${res.status} — putFile ${path}${detail ? ': ' + detail : ''}`);
    }

    const data = await res.json();
    return {
      sha: data.content.sha,
      commitSha: data.commit.sha,
    };
  }

  /** Check current rate limit status */
  async getRateLimit() {
    const data = await this._request('/rate_limit');
    data.provider = 'github';
    return data;
  }

  // ── Private fallback ────────────────────────────

  /** Resolve a file via the git tree + blob (fallback for /contents/ 404s) */
  async _getFileViaTree(owner, repo, path) {
    const repoData  = await this._request(`/repos/${owner}/${repo}`);
    const candidates = [repoData.default_branch, 'master', 'main'].filter(Boolean);
    const seen = new Set();

    for (const branch of candidates) {
      if (seen.has(branch)) continue;
      seen.add(branch);
      try {
        const tree  = await this._request(`/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
        const entry = tree.tree?.find(f => f.path === path);
        if (!entry) continue;
        const blob  = await this._request(`/repos/${owner}/${repo}/git/blobs/${entry.sha}`);
        if (blob.encoding === 'base64') {
          return GitHubAdapter._decodeBase64Utf8(blob.content.replace(/\n/g, ''));
        }
      } catch { /* try next branch */ }
    }
    return null;
  }
}

// Register globally so repos.js can instantiate it
window.GitHubAdapter = GitHubAdapter;
