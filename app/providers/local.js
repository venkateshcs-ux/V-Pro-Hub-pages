// app/providers/local.js — #185 t2: same-origin static-server read adapter.
//
// Purpose: when the dashboard is served from the same machine that holds the
// working tree (the common local-dev case), read files directly off the
// static server already serving this directory (#121 V-Pro-Hub-live) instead
// of round-tripping to a remote provider's API. This closes the "committed
// but not yet pushed is invisible" gap — a plain static-file fetch reflects
// whatever's on disk right now, no push required.
//
// Deliberately READ-ONLY: implements only getFile(). getFileWithSha() and
// putFile() are not implemented here — SHA-guarded writeback must always
// target the real remote provider, since a locally-served "sha" would be
// meaningless to that provider's conflict-detection. Repos.js only ever
// consults this adapter for getFile(); every other call goes straight to
// the configured remote adapter unchanged.
//
// Branch-aware: reads whatever is currently checked out (per
// .local-repo-state.json, written by .githooks/post-commit + post-checkout —
// see #185 t1). If the caller asks for a specific `branch` that doesn't match
// what's actually checked out here, this adapter declines (returns null) so
// the caller falls back to the remote adapter for that one call — e.g. the
// Backlog view's "Past sprints" filter, which reads other sprint branches
// that aren't checked out in this worktree.

class LocalAdapter {

  /** Cheap synchronous gate — no marker-file round trip needed to decide this. */
  static isAvailable() {
    try {
      return typeof location !== 'undefined' &&
        (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
    } catch {
      return false;
    }
  }

  constructor() {
    this._stateUrl = '/.local-repo-state.json';
  }

  /** Reads the marker file fresh every call — tiny file, cache:'no-store' avoids
   *  browser HTTP caching. No in-memory caching here; #185 t4's onChange poll
   *  owns "did anything change" — this method just needs the current truth. */
  async _getState() {
    try {
      const res = await fetch(this._stateUrl, { cache: 'no-store' });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  /** Public read of current sync/branch state (#185 t9 — UI badge reads this
   *  for its initial render; onChange, below, covers subsequent updates). */
  async getState() {
    return this._getState();
  }

  /** Get raw file content from the static server (returns string or null).
   *  `owner`/`repo` are accepted for interface parity with the remote adapters
   *  but unused — this adapter only ever serves the one repo it's running from. */
  async getFile(owner, repo, path, branch) {
    const state = await this._getState();
    if (!state || !state.branch) return null;           // no marker -> caller falls back to remote
    if (branch && branch !== state.branch) return null;  // wrong branch -> caller falls back to remote

    try {
      const res = await fetch('/' + path.replace(/^\/+/, ''), { cache: 'no-store' });
      if (!res.ok) return null;
      const text = await res.text();
      // Normalize CRLF -> LF. The working tree (checked out with Windows
      // core.autocrlf) has CRLF line endings on disk; the actual git blob
      // (and what the remote GitHub adapter always returns) is LF-only.
      // This adapter's contract is to be a drop-in for the remote adapter,
      // so callers doing line-ending-sensitive parsing (e.g. views/backlog.js
      // parseBacklog's `/^## Backlog$/` heading match) see identical content
      // regardless of which adapter served it. Found via a real bug: #185
      // itself failed to render because this normalization was missing.
      return text.replace(/\r\n/g, '\n');
    } catch {
      return null;
    }
  }

  /** Facade-level reactivity contract (#185 t4/t9). Polls the marker file and
   *  fires `cb` whenever anything the UI displays changes — not just a new
   *  commit (headSha), but also dirty/originSha flips that a git operation
   *  (checkout, fetch, push) can produce without headSha itself changing.
   *  Returns an unsubscribe function. */
  onChange(cb, { intervalMs = 3000 } = {}) {
    // `undefined` = no baseline established yet (distinct from `null`, which
    // is a real observed state meaning "marker unreachable" — e.g. deployed
    // mode, or a local adapter that stops working mid-session). This lets a
    // present->unreachable transition fire cb(null) so a UI badge can hide
    // itself, rather than freezing on stale data forever.
    let lastFingerprint = undefined;
    let stopped = false;

    const fingerprint = (state) =>
      state ? `${state.headSha}|${state.originSha}|${state.dirty}` : null;

    const tick = async () => {
      if (stopped) return;
      const state = await this._getState();
      const fp = fingerprint(state);
      if (fp !== lastFingerprint) {
        const isFirstRead = lastFingerprint === undefined;
        lastFingerprint = fp;
        if (!isFirstRead) cb(state);  // don't fire on the initial read, only on subsequent changes
      }
    };

    const handle = setInterval(tick, intervalMs);
    tick();  // establish baseline immediately, don't wait a full interval

    return () => {
      stopped = true;
      clearInterval(handle);
    };
  }
}

// Register globally so repos.js can instantiate it
window.LocalAdapter = LocalAdapter;
