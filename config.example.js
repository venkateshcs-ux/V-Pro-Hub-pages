// config.example.js
// Copy to config.js and fill in your values.
// config.js is gitignored — NEVER committed.

const CONFIG = {

  // ── Provider configuration (#19 multi-provider) ──
  // Repos facade reads this array. Add one entry per git provider.
  // The entry with primary:true is used for getUser() and getRateLimit().
  providers: [
    {
      id:       'github',           // must match a key in repos.js ADAPTER_REGISTRY
      label:    'GitHub',
      baseUrl:  'https://api.github.com',  // override for GitHub Enterprise
      auth:     { type: 'pat', token: 'ghp_your_token_here' },
      username: 'your-github-username',
      primary:  true,
    },
    // Bitbucket — add when onboarding Bitbucket repos (e.g. DLMS, #20).
    // Tier 3 Repository Access Tokens: per-repo Bearer auth (app passwords deprecated 2026-06-09).
    // Scope required: `repository` (read). Optional: `pullrequest` (read).
    // The repos.js facade also auto-promotes a flat CONFIG.bitbucket block (back-compat).
    // {
    //   id:        'bitbucket',
    //   label:     'Bitbucket',
    //   workspace: 'your-workspace-slug',
    //   tokens: {
    //     // key = exact repo slug from Bitbucket URL (case-sensitive)
    //     'repo-slug-1': 'BBDC-...',
    //     'repo-slug-2': 'BBDC-...',
    //   },
    // },

    // Future — uncomment when adding GitLab:
    // {
    //   id:       'gitlab',
    //   label:    'GitLab (work)',
    //   baseUrl:  'https://gitlab.com/api/v4',
    //   auth:     { type: 'pat', token: 'glpat-your_token_here' },
    //   username: 'your-gitlab-username',
    // },
  ],

  // ── Bitbucket — flat back-compat shape (#27) ──────────────────────
  // If you prefer not to edit the providers[] array, you can keep the flat shape here.
  // repos.js will auto-promote it to providers[] at runtime.
  // Remove this block once you've moved to the providers[] shape above.
  // bitbucket: {
  //   workspace: 'your-workspace-slug',
  //   tokens: {
  //     'repo-slug-1': 'BBDC-...',
  //     'repo-slug-2': 'BBDC-...',
  //   },
  // },

  // ── Dashboard settings ────────────────────────
  dashboardRepo:       'V-Pro-Hub',   // repo where USAGE_LOG.md lives
  healthCheckInterval: 15,            // minutes between auto-refresh

  // ── Reserved ports (future Invest proxy) ─────
  ports: { nseProxy: 7001, bseProxy: 7002 },

  // ── Invest data sources (future) ─────────────
  primarySource:  'nse',
  fallbackSource: 'yahoo-proxy',
  cryptoSource:   'yahoo',
};
