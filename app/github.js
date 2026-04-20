// app/github.js — GitHub REST API v3 wrapper
// Phase 1 — read-only, PAT auth via config.js

const GitHub = (() => {

  const BASE = 'https://api.github.com';

  /** Decode base64 string as UTF-8 (atob alone breaks multi-byte chars like —, …) */
  function decodeBase64Utf8(base64) {
    const binary = atob(base64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  function headers() {
    if (typeof CONFIG === 'undefined' || !CONFIG.pat) {
      throw new Error('CONFIG not loaded or PAT missing — check config.js');
    }
    return {
      'Authorization': `token ${CONFIG.pat}`,
      'Accept': 'application/vnd.github.v3+json',
    };
  }

  async function request(path) {
    const res = await fetch(`${BASE}${path}`, { headers: headers() });

    if (res.status === 401) throw new Error('GitHub 401 — PAT invalid or expired');
    if (res.status === 403) throw new Error('GitHub 403 — rate limit or insufficient scopes');
    if (res.status === 404) throw new Error(`GitHub 404 — not found: ${path}`);
    if (!res.ok)            throw new Error(`GitHub ${res.status} — ${path}`);

    // Expose rate limit info on the response object
    const data = await res.json();
    data._rateLimit = {
      limit:     parseInt(res.headers.get('X-RateLimit-Limit') || '0'),
      remaining: parseInt(res.headers.get('X-RateLimit-Remaining') || '0'),
      reset:     parseInt(res.headers.get('X-RateLimit-Reset') || '0'),
    };
    return data;
  }

  // ── Public API ──────────────────────────────────

  /** Verify PAT and return the authenticated user */
  async function getUser() {
    return request('/user');
  }

  /** List all repos for the authenticated user */
  async function getRepos() {
    return request(`/user/repos?per_page=100&sort=updated`);
  }

  /** Get a single repo by owner/name */
  async function getRepo(owner, repo) {
    return request(`/repos/${owner}/${repo}`);
  }

  /** Get recent commits for a repo */
  async function getCommits(owner, repo, perPage = 20) {
    return request(`/repos/${owner}/${repo}/commits?per_page=${perPage}`);
  }

  /** Get open issues count for a repo */
  async function getIssues(owner, repo) {
    return request(`/repos/${owner}/${repo}/issues?state=open&per_page=1`);
  }

  /** Get raw file content from a repo (returns decoded string or null) */
  async function getFile(owner, repo, path) {
    try {
      // First try: /contents/ endpoint
      const data = await request(`/repos/${owner}/${repo}/contents/${path}`);
      if (data.encoding === 'base64') {
        return decodeBase64Utf8(data.content.replace(/\n/g, ''));
      }
      // Fallback: resolve via git tree + blob
      return await _getFileViaTree(owner, repo, path);
    } catch (e) {
      if (e.message.includes('404')) {
        // /contents/ returned 404 — try tree approach before giving up
        try { return await _getFileViaTree(owner, repo, path); }
        catch { return null; }
      }
      throw e;
    }
  }

  /** Check current rate limit status */
  async function getRateLimit() {
    return request('/rate_limit');
  }

  /** Resolve a file via the git tree + blob (fallback for /contents/ 404s) */
  async function _getFileViaTree(owner, repo, path) {
    // Try branches in order: API default_branch, then master, then main
    const repoData = await request(`/repos/${owner}/${repo}`);
    const candidates = [repoData.default_branch, 'master', 'main'].filter(Boolean);
    const seen = new Set();

    for (const branch of candidates) {
      if (seen.has(branch)) continue;
      seen.add(branch);
      try {
        const tree = await request(`/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
        const entry = tree.tree?.find(f => f.path === path);
        if (!entry) continue; // file not in this tree
        const blob = await request(`/repos/${owner}/${repo}/git/blobs/${entry.sha}`);
        if (blob.encoding === 'base64') {
          return decodeBase64Utf8(blob.content.replace(/\n/g, ''));
        }
      } catch { /* try next branch */ }
    }
    return null;
  }

  return { getUser, getRepos, getRepo, getCommits, getIssues, getFile, getRateLimit };

})();
