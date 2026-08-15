// app/repos.js — Repos facade
// Single entry point for all provider calls.
// Views call Repos.* — never a provider adapter directly.
// Phase 2b: listRepos() merges across all configured providers.

const Repos = (() => {

  // ── Adapter factory registry ───────────────────
  // Add an entry here when a new provider adapter is created.
  const ADAPTER_REGISTRY = {
    github:    cfg => new GitHubAdapter(cfg),
    bitbucket: cfg => new BitbucketAdapter(cfg),
    // gitlab: cfg => new GitLabAdapter(cfg),  // future
  };

  // ── Build adapter instances from CONFIG ────────

  function _buildAdapters() {
    // Backward compat: old flat CONFIG.pat → auto-wrap as single GitHub provider
    let providers = Array.isArray(CONFIG.providers) ? [...CONFIG.providers] : [];
    if (providers.length === 0) {
      if (typeof CONFIG.pat !== 'string' || !CONFIG.pat) {
        throw new Error('[Repos] No providers configured and no legacy CONFIG.pat found — check config.js');
      }
      providers = [{
        id:       'github',
        label:    'GitHub',
        baseUrl:  'https://api.github.com',
        auth:     { type: 'pat', token: CONFIG.pat },
        username: CONFIG.username || '',
        primary:  true,
      }];
    }

    // Back-compat: promote flat CONFIG.bitbucket → providers[] if not already declared
    if (CONFIG.bitbucket && CONFIG.bitbucket.workspace && CONFIG.bitbucket.tokens) {
      const alreadyDeclared = providers.some(p => p.id === 'bitbucket');
      if (!alreadyDeclared) {
        providers.push({
          id:        'bitbucket',
          label:     'Bitbucket',
          workspace: CONFIG.bitbucket.workspace,
          tokens:    CONFIG.bitbucket.tokens,
        });
      }
    }

    const instances = [];
    for (const cfg of providers) {
      const factory = ADAPTER_REGISTRY[cfg.id];
      if (!factory) {
        console.warn(`[Repos] Unknown provider id "${cfg.id}" — skipped`);
        continue;
      }
      instances.push({ cfg, adapter: factory(cfg) });
    }

    if (instances.length === 0) {
      throw new Error('[Repos] No valid provider adapters could be initialised — check config.js');
    }
    return instances;
  }

  // ── Lazy init ──────────────────────────────────

  let _adapters = null;

  function _init() {
    if (!_adapters) _adapters = _buildAdapters();
    return _adapters;
  }

  // ── Local read-path (#185) ──────────────────────
  // Not part of ADAPTER_REGISTRY / owner-routing (_adapterFor) — it isn't
  // owner-scoped, it's a transport preference for whichever repo this app
  // happens to be running against locally. Read-only: only getFile() consults
  // it, and only for the calls it actually serves (it returns null for a
  // branch mismatch or when no marker file is reachable, which falls through
  // to the normal remote-adapter path below unchanged). getFileWithSha()/
  // putFile() never consult it — a locally-served "sha" would be meaningless
  // to a remote provider's conflict-detection.
  let _localAdapter = undefined;  // undefined = not yet probed; null = probed, unavailable

  function _getLocalAdapter() {
    if (_localAdapter === undefined) {
      _localAdapter = (typeof LocalAdapter !== 'undefined' && LocalAdapter.isAvailable())
        ? new LocalAdapter()
        : null;
    }
    return _localAdapter;
  }

  function _primary() {
    const adapters = _init();
    return (adapters.find(a => a.cfg.primary) || adapters[0]).adapter;
  }

  // Route to the adapter whose workspace or username matches the owner param.
  // Falls back to the primary provider if no explicit match is found.
  function _adapterFor(owner) {
    const adapters = _init();
    const match = adapters.find(a =>
      a.cfg.username  === owner ||
      a.cfg.workspace === owner ||
      a.cfg.namespace === owner
    );
    return (match || adapters.find(a => a.cfg.primary) || adapters[0]).adapter;
  }

  // ── Public API — 7 methods ─────────────────────

  /** Verify auth and return user info from the primary provider */
  async function getUser() {
    return _primary().verifyAuth();
  }

  /**
   * List repos from all configured providers — merges results, logs partial failures.
   */
  async function listRepos() {
    const adapters = _init();
    const settled  = await Promise.allSettled(adapters.map(a => a.adapter.listRepos()));
    const all = [];
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        all.push(...(Array.isArray(r.value) ? r.value : []));
      } else {
        console.warn('[Repos] listRepos partial failure:', r.reason?.message);
      }
    }
    return all;
  }

  /** Get a single repo — routes by owner (workspace / username match) */
  async function getRepo(owner, repo) {
    return _adapterFor(owner).getRepo(owner, repo);
  }

  /** Get recent commits — routes by owner */
  async function getCommits(owner, repo, perPage = 20) {
    return _adapterFor(owner).getCommits(owner, repo, perPage);
  }

  /** Get open issues — routes by owner */
  async function getIssues(owner, repo) {
    return _adapterFor(owner).getIssues(owner, repo);
  }

  /** Get file content — prefers the local adapter (#185) when available and the
   *  requested branch matches what's actually checked out; otherwise routes by
   *  owner to the configured remote adapter exactly as before. */
  async function getFile(owner, repo, path, branch) {
    const local = _getLocalAdapter();
    if (local) {
      const result = await local.getFile(owner, repo, path, branch);
      if (result !== null) return result;
      // null = no marker reachable, or branch mismatch — fall through to remote.
    }
    return _adapterFor(owner).getFile(owner, repo, path, branch);
  }

  /** Subscribe to "the repo changed" (#185). Prefers the local adapter's
   *  filesystem-backed signal when available; otherwise a documented no-op
   *  (remote-provider reactivity — e.g. polling getCommits — is a future
   *  extension, not implemented in this pass). Returns an unsubscribe fn. */
  function onChange(cb, opts) {
    const local = _getLocalAdapter();
    if (local && typeof local.onChange === 'function') {
      return local.onChange(cb, opts);
    }
    return () => {};  // no-op unsubscribe — nothing was subscribed
  }

  /** Read current sync state (#185 t9) for an initial UI render — returns
   *  {branch, headSha, originSha, dirty, syncState, updatedAt} or null when
   *  no local adapter is available (deployed mode — no sync-state concept
   *  exists there today, so the UI badge simply doesn't render). */
  async function getSyncState() {
    const local = _getLocalAdapter();
    if (local && typeof local.getState === 'function') {
      return local.getState();
    }
    return null;
  }


  /** Get file content + sha (for SHA-guarded writeback) — routes by owner */
  async function getFileWithSha(owner, repo, path, branch) {
    const adapter = _adapterFor(owner);
    if (typeof adapter.getFileWithSha !== 'function') {
      throw new Error(`Adapter for ${owner} does not support getFileWithSha (writeback)`);
    }
    return adapter.getFileWithSha(owner, repo, path, branch);
  }

  /** PUT file content — routes by owner. Throws 409-equivalent on SHA conflict. */
  async function putFile(owner, repo, path, content, sha, message, branch) {
    const adapter = _adapterFor(owner);
    if (typeof adapter.putFile !== 'function') {
      throw new Error(`Adapter for ${owner} does not support putFile (writeback)`);
    }
    return adapter.putFile(owner, repo, path, content, sha, message, branch);
  }

  /** Get rate limit from the primary provider */
  async function getRateLimit() {
    return _primary().getRateLimit();
  }

  /** List branches — routes by owner. Used by ActiveSprint for sprint/Sprint-* enumeration (#119). */
  async function listBranches(owner, repo, perPage = 100) {
    const adapter = _adapterFor(owner);
    if (typeof adapter.listBranches !== 'function') {
      throw new Error(`Adapter for ${owner} does not support listBranches`);
    }
    return adapter.listBranches(owner, repo, perPage);
  }

  /** List directory contents at a specific branch — routes by owner. Used by ActiveSprint
   *  to discover SP-*.md file on each sprint branch (#119). */
  async function listDirectory(owner, repo, path, branch) {
    const adapter = _adapterFor(owner);
    if (typeof adapter.listDirectory !== 'function') {
      throw new Error(`Adapter for ${owner} does not support listDirectory`);
    }
    return adapter.listDirectory(owner, repo, path, branch);
  }

  return { getUser, listRepos, getRepo, getCommits, getIssues, getFile, getFileWithSha, putFile, getRateLimit, listBranches, listDirectory, onChange, getSyncState };

})();
