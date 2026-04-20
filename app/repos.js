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

  /** Get file content — routes by owner */
  async function getFile(owner, repo, path) {
    return _adapterFor(owner).getFile(owner, repo, path);
  }

  /** Get rate limit from the primary provider */
  async function getRateLimit() {
    return _primary().getRateLimit();
  }

  return { getUser, listRepos, getRepo, getCommits, getIssues, getFile, getRateLimit };

})();
