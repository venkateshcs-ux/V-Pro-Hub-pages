// app/active-sprint.js — Deterministic active-sprint discovery via branch enumeration (#119, S061)
//
// Eliminates the master-side SPRINTS.md staleness dependency.
//
// Today's problem (pre-#119): UI reads `docs/SPRINTS.md` from default branch + the
// per-sprint `SP-*.md` from default branch. Both depend on the close ceremony having
// run cleanly. Sprint 4's SP-2026-05-10.md lives on sprint/Sprint-4 (per D136 model)
// and is NOT on master — so the UI renders the closed Sprint 3 file as if it were
// current.
//
// Fix (Option 5, ratified S061): List sprint/Sprint-* branches via GitHub REST API,
// read each branch's docs/sprints/SP-*.md frontmatter, return the one with
// `status: active`. Frontmatter is the SoT (D141); branch listing IS the index.
//
// Invariant: exactly 1 branch should have `status: active` at any time.
//   - 0 matches → null + UX state "no_active_sprint"
//   - >1 matches → warning + render newest
//   - API rate-limited → null + UX state "rate_limited" + cached fallback if any
//
// Cache: localStorage 5-min TTL keyed by repo; invalidated by RETRY action.

window.ActiveSprint = (() => {

  const CACHE_KEY     = 'vpro_active_sprint';
  const CACHE_TTL_MS  = 5 * 60 * 1000;
  const BRANCH_PREFIX = 'sprint/Sprint-';

  // Mutable state for UX consumption — read by views/backlog.js to render chips
  const state = {
    lastError: null,    // {type: 'list_failed'|'no_sprint_branches'|'no_active_sprint'|'rate_limited', detail?}
    warning:   null,    // {type: 'multiple_active', branches: [...]}
  };

  // ── Cache ─────────────────────────────────────────────────────

  function _cacheKey(owner, repo) {
    return `${CACHE_KEY}:${owner}/${repo}`;
  }

  function _cacheRead(owner, repo) {
    try {
      const raw = localStorage.getItem(_cacheKey(owner, repo));
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !data.t || (Date.now() - data.t > CACHE_TTL_MS)) return null;
      return data;
    } catch { return null; }
  }

  function _cacheWrite(owner, repo, payload) {
    try {
      localStorage.setItem(_cacheKey(owner, repo), JSON.stringify({ t: Date.now(), ...payload }));
    } catch { /* localStorage full or disabled — ignore */ }
  }

  function invalidateCache(owner, repo) {
    try {
      if (owner && repo) {
        localStorage.removeItem(_cacheKey(owner, repo));
      } else {
        // Nuke all vpro_active_sprint:* entries
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && k.startsWith(CACHE_KEY + ':')) localStorage.removeItem(k);
        }
      }
    } catch {}
  }

  // ── Frontmatter parser (minimal — top-level scalars only) ─────

  function _parseFrontmatter(md) {
    if (!md || typeof md !== 'string') return null;
    if (!md.startsWith('---\n') && !md.startsWith('---\r\n')) return null;
    const headerStart = md.indexOf('\n') + 1;
    const headerEnd   = md.indexOf('\n---', headerStart);
    if (headerEnd < 0) return null;
    const yaml = md.slice(headerStart, headerEnd);
    const out  = {};
    yaml.split(/\r?\n/).forEach(line => {
      // Only top-level (no leading space) scalar key:value pairs
      const m = line.match(/^([a-zA-Z_][\w-]*)\s*:\s*(.*)$/);
      if (!m) return;
      const key = m[1];
      let val = m[2].trim();
      // Strip inline comments
      val = val.replace(/\s+#.*$/, '').trim();
      // Strip surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      // Skip block scalar markers (|, >) and array opens — beyond minimal scope
      if (val === '|' || val === '>' || val === '') return;
      out[key] = val;
    });
    return out;
  }

  // ── Branch enumeration ────────────────────────────────────────

  /**
   * List branches matching sprint/Sprint-N pattern.
   * Returns array of {name, sprintNum} sorted newest-first.
   * Throws on API errors (caller handles rate-limit fallback).
   */
  async function _listSprintBranches(owner, repo) {
    const all = await Repos.listBranches(owner, repo, 100);
    if (!Array.isArray(all)) return [];
    const sprintBranches = [];
    all.forEach(b => {
      if (!b || !b.name) return;
      const m = b.name.match(/^sprint\/Sprint-(\d+)$/);
      if (!m) return;
      sprintBranches.push({ name: b.name, sprintNum: parseInt(m[1], 10) });
    });
    sprintBranches.sort((a, b) => b.sprintNum - a.sprintNum);
    return sprintBranches;
  }

  /**
   * On a given sprint branch, find its SP-YYYY-MM-DD.md file.
   * Strategy: list docs/sprints/ on that branch, pick the SP-*.md file matching the
   * SP-YYYY-MM-DD.md pattern (excludes _input / _retro / candidates variants).
   * Returns the filename string or null.
   */
  async function _findSprintFile(owner, repo, branch) {
    let entries;
    try {
      entries = await Repos.listDirectory(owner, repo, 'docs/sprints', branch);
    } catch {
      return null;
    }
    if (!Array.isArray(entries)) return null;
    const sprintFiles = entries
      .filter(e => e && e.type === 'file' && /^SP-\d{4}-\d{2}-\d{2}\.md$/.test(e.name))
      .sort((a, b) => b.name.localeCompare(a.name));  // newest by ISO date first
    return sprintFiles.length > 0 ? sprintFiles[0].name : null;
  }

  /**
   * Read frontmatter of the sprint file on a specific branch.
   * Returns parsed frontmatter object or null.
   */
  async function _readSprintFrontmatter(owner, repo, branch, sprintFile) {
    let md;
    try {
      md = await Repos.getFile(owner, repo, `docs/sprints/${sprintFile}`, branch);
    } catch {
      return null;
    }
    if (!md) return null;
    return _parseFrontmatter(md);
  }

  // ── Public API ────────────────────────────────────────────────

  /**
   * Discover the active sprint via branch enumeration.
   * Returns { branch, sprintFile, sprintNum, frontmatter, cached: boolean } or null.
   * On null, inspect window.ActiveSprint.lastError for the UX state.
   *
   * @param {string}  owner
   * @param {string}  repo
   * @param {object}  opts  - {force: bool} to bypass cache
   */
  async function getActiveSprintBranch(owner, repo, opts = {}) {
    state.lastError = null;
    state.warning   = null;

    // Cache hit (unless force)
    if (!opts.force) {
      const cached = _cacheRead(owner, repo);
      if (cached && cached.branch) {
        return { ...cached, cached: true };
      }
    }

    // 1. List sprint/Sprint-* branches
    let branches;
    try {
      branches = await _listSprintBranches(owner, repo);
    } catch (err) {
      const msg = String(err && err.message || err);
      const isRateLimit = msg.includes('403') || msg.includes('rate limit');
      state.lastError = { type: isRateLimit ? 'rate_limited' : 'list_failed', detail: msg };
      // Try stale cache as last resort
      const stale = _cacheRead(owner, repo);
      return stale && stale.branch ? { ...stale, cached: true, stale: true } : null;
    }

    if (branches.length === 0) {
      state.lastError = { type: 'no_sprint_branches' };
      return null;
    }

    // 2. For each branch, find its sprint file + read frontmatter + filter status:active
    const actives = [];
    for (const b of branches) {
      const sprintFile = await _findSprintFile(owner, repo, b.name);
      if (!sprintFile) continue;
      const fm = await _readSprintFrontmatter(owner, repo, b.name, sprintFile);
      if (!fm) continue;
      const status = (fm.status || '').toLowerCase();
      if (status === 'active') {
        actives.push({ branch: b.name, sprintFile, sprintNum: b.sprintNum, frontmatter: fm });
      }
    }

    if (actives.length === 0) {
      state.lastError = { type: 'no_active_sprint' };
      return null;
    }

    if (actives.length > 1) {
      const names = actives.map(a => a.branch);
      console.warn(`[ActiveSprint] Invariant violation — multiple sprint/Sprint-* branches with status:active: ${names.join(', ')}. Rendering newest.`);
      state.warning = { type: 'multiple_active', branches: names };
    }

    // _listSprintBranches sorted newest-first; actives preserves order from that pass.
    const pick = actives[0];
    _cacheWrite(owner, repo, { branch: pick.branch, sprintFile: pick.sprintFile, sprintNum: pick.sprintNum });
    return pick;
  }

  /**
   * Enumerate ALL sprint/Sprint-* branches with their lifecycle status (D146).
   * Returns: { planning: [...], active: [...], closed: [...], unknown: [...] }
   * where each entry is { branch, sprintFile, sprintNum, frontmatter }.
   * Buckets are sorted by sprintNum desc (newest first).
   *
   * Used by views/backlog.js Past-filter to surface closed sprint branches as
   * historical snapshots, and to assert invariants (exactly 1 in planning|active).
   *
   * Caching: this function is intentionally NOT cached (callers like the Past
   * filter expect fresh enumeration; if needed, callers may layer their own
   * cache). The single-active fast-path getActiveSprintBranch() remains cached.
   */
  async function listAllSprintBranches(owner, repo) {
    state.lastError = null;
    state.warning   = null;

    const out = { planning: [], active: [], closed: [], unknown: [] };

    let branches;
    try {
      branches = await _listSprintBranches(owner, repo);
    } catch (err) {
      const msg = String(err && err.message || err);
      const isRateLimit = msg.includes('403') || msg.includes('rate limit');
      state.lastError = { type: isRateLimit ? 'rate_limited' : 'list_failed', detail: msg };
      return out;
    }

    if (branches.length === 0) {
      state.lastError = { type: 'no_sprint_branches' };
      return out;
    }

    for (const b of branches) {
      const sprintFile = await _findSprintFile(owner, repo, b.name);
      if (!sprintFile) {
        out.unknown.push({ branch: b.name, sprintFile: null, sprintNum: b.sprintNum, frontmatter: null });
        continue;
      }
      const fm = await _readSprintFrontmatter(owner, repo, b.name, sprintFile);
      if (!fm) {
        out.unknown.push({ branch: b.name, sprintFile, sprintNum: b.sprintNum, frontmatter: null });
        continue;
      }
      const status = (fm.status || '').toLowerCase();
      const entry = { branch: b.name, sprintFile, sprintNum: b.sprintNum, frontmatter: fm };
      if (status === 'planning')   out.planning.push(entry);
      else if (status === 'active') out.active.push(entry);
      else if (status === 'closed') out.closed.push(entry);
      else                          out.unknown.push(entry);
    }

    // Invariant check (D146): exactly 1 in planning OR active at any time.
    // Both buckets together should have size <= 1. If >1, log warning.
    const currentCount = out.planning.length + out.active.length;
    if (currentCount > 1) {
      const names = [...out.planning, ...out.active].map(e => `${e.branch} (${e.frontmatter.status})`);
      console.warn(`[ActiveSprint] D146 invariant violation — multiple branches in planning|active: ${names.join(', ')}. Expected exactly 1.`);
      state.warning = { type: 'multiple_current', branches: names };
    } else if (currentCount === 0) {
      // No current sprint = atomic close+open ceremony incomplete (D146 invariant violation)
      // Note: at fresh project start (pre-Sprint-1) this is also true; tolerated.
      if (out.closed.length > 0) {
        console.warn('[ActiveSprint] D146 invariant violation — no branch in planning|active state, but closed sprints exist. Atomic close+open ceremony likely incomplete.');
        state.warning = { type: 'no_current_post_close' };
      }
    }

    return out;
  }

  return {
    getActiveSprintBranch,
    listAllSprintBranches,
    invalidateCache,
    get lastError() { return state.lastError; },
    get warning()   { return state.warning; },
  };

})();
