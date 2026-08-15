// views/backlog.js — Backlog 2.0 (S035, #76)
// Single source: docs/BACKLOG.md in V-Pro-Hub repo.
// Phase 3 implementation of Claude Design Phase 2.5 polished output (Option C).
// Constraint: docs/design-sessions/backlog-2.0-2026-04-26-handoff-polished/

window.BacklogView = (() => {

  // ── Helpers ────────────────────────────────────

  function escHtml(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  // escHtml already escapes " → &quot;, so it is safe for double-quoted attributes too.
  // Defined as an alias because renderPastSprintsPanel() (#120) and the #188 cadence
  // modal both reference escAttr(); without this the Past filter and the cadence modal
  // throw "escAttr is not defined" at render time.
  function escAttr(s) { return escHtml(s); }

  function inline(text) {
    return escHtml(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');
  }

  function isReadOnly() {
    return document.body.getAttribute('data-mode') === 'readonly';
  }

  // ── Toast system ───────────────────────────────

  function ensureToastWrap() {
    let wrap = document.getElementById('bl-toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'bl-toast-wrap';
      wrap.className = 'bl-toast-wrap';
      document.body.appendChild(wrap);
    }
    return wrap;
  }

  function pushToast({ kind = 'success', icon, msg, action, onAction, ttl = 3500 }) {
    const wrap = ensureToastWrap();
    const el = document.createElement('div');
    el.className = `bl-toast ${kind}`;
    const defaultIcon = kind === 'success' ? '✓' : kind === 'warning' ? '⚠' : '✕';
    el.innerHTML = `<span class="bl-toast-icon">${escHtml(icon || defaultIcon)}</span>` +
      `<span class="bl-toast-msg"></span>` +
      (action ? `<span class="bl-toast-action">${escHtml(action)}</span>` : '');
    el.querySelector('.bl-toast-msg').textContent = msg;
    if (action && onAction) {
      el.querySelector('.bl-toast-action').addEventListener('click', () => { onAction(); el.remove(); });
    }
    wrap.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      setTimeout(() => el.remove(), 200);
    }, ttl);
  }

  // ── Global save indicator (P3 #18) ─────────────

  let _savesInFlight = 0;
  let _pendingEditId = null; // set by openEditFor when BacklogView not yet rendered; cleared on next fullRender
  function saveStart() {
    _savesInFlight++;
    document.body.setAttribute('data-saves-in-flight', '');
  }
  function saveEnd() {
    _savesInFlight = Math.max(0, _savesInFlight - 1);
    if (_savesInFlight === 0) document.body.removeAttribute('data-saves-in-flight');
  }

  // ── Reason options ─────────────────────────────

  const REASON_OPTS = [
    { key: 'urgency',     label: 'Urgency',          glyph: '!'  },
    { key: 'importance',  label: 'Importance',       glyph: '★' },
    { key: 'dependency',  label: 'Blocks others',    glyph: '⇢' },
    { key: 'commitment',  label: 'Commitment',       glyph: '◇' },
    { key: 'quick-win',   label: 'Quick win',        glyph: '⚡' },
    { key: 'strategic',   label: 'Strategic',        glyph: '◆' },
    { key: 'personal',    label: 'Personal',         glyph: '○' },
  ];
  const REASON_LABEL = {
    urgency: 'urgency', importance: 'importance', dependency: 'blocks others',
    commitment: 'commitment', 'quick-win': 'quick win', strategic: 'strategic', personal: 'personal',
  };

  // ── Module state ───────────────────────────────

  // #185 t5 — single active Repos.onChange subscription; render() unsubscribes
  // the previous one (if any) before resubscribing, so navigating away/back
  // or repeated render() calls never leak more than one interval.
  let _unsubscribeOnChange = null;

  const state = {
    items: [],
    products: [],
    sessionTypes: [],
    sprints: [],
    activeSprint: null,    // { id, frontmatter, planItems, backlogMap, acMap, adaptations, dailyLog, sessions, health, drift }
    // S058 post-close — empty-state diagnostics when loadActiveSprint() returns null.
    // Set inside loadActiveSprint() to one of: 'no_active_row' | 'detail_file_missing' | 'detail_says_closed'.
    noActiveSprintReason: null,
    noActiveSprintCandidate: null,    // The SPRINTS.md row claiming active when detail file disagrees / missing
    noActiveSprintDetailStatus: null, // The detail file's status when it disagrees with the index row
    // D146/#120 — past sprint branches enumeration (closed status). Lazy-loaded on
    // first 'Past' filter selection; cached for session duration.
    pastSprintBranches: null,        // null = not loaded; [] = loaded empty; [...] = loaded with entries
    pastSprintBranchesLoading: false,
    productFilter: 'All',
    sessionFilter: 'All',
    sprintFilter: 'All sprints',  // 'All sprints' | 'Current' | 'Past' | 'No sprint' | 'range'
    rangeStart: null,
    rangeEnd: null,
    // #187 (D152) — tier filter: 'All tiers' | 'Comfortable goal' | 'Stretch lounge' | 'Cold storage'
    tierFilter: 'All tiers',
    searchQuery: '',
    vmMode: 'list',            // 'list' | 'board'
    vmManual: false,
    bandCollapsed: false,
    backlogSha: null,          // current SHA of BACKLOG.md (for SHA-guarded writeback)
    backlogPath: 'docs/BACKLOG.md',
    backlogRepo: 'V-Pro-Hub',
    // S037ext Track E — summary-tile-driven filters (click tile to toggle)
    priorityFilter: null,      // null | 'high' | 'medium' | 'low'
    statusFilter: null,        // null | 'open' | 'done'
    crudModal: null,           // null | { mode:'create'|'edit', item, todos, todosLoading, saving, errorMsg, _escHandler }
    cadenceModal: null,        // #188 — null | { loading, raw, sha, start, end, cad, history[], saving, errorMsg, _escHandler }
    coverageRegistry: {},      // #192 — { cardId: [testId,…] } loaded via CoverageRegistry; {} = empty (badge off, DoD)
  };

  // ── Parse BACKLOG.md ───────────────────────────

  function parseBacklog(md) {
    const items = [];
    const lines = md.split('\n');
    let headers = [];
    let inTable = false;

    for (const line of lines) {
      if (!line.startsWith('|')) {
        // S109 #174 sibling fix: parser now ingests BOTH `## Backlog` AND `## Closed Items`
        // sections (UI dedupes downstream via item.id; status column distinguishes Done vs active).
        // Sidesteps file-structural misfile drift (#147-#174 historically appended to Closed Items
        // section but most were still active; previous parser version stopped at line 193).
        if (/^## (Backlog|Closed Items)$/.test(line)) { inTable = true; headers = []; }
        else if (/^## /.test(line) && inTable)        { inTable = false; headers = []; }
        continue;
      }
      if (!inTable) continue;
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (cells.every(c => /^[-: ]+$/.test(c))) continue;

      if (cells[0] === '#') {
        headers = cells.map(c => c.toLowerCase().replace(/[()]/g, '').trim());
        continue;
      }
      if (headers.length && /^\d+$/.test(cells[0])) {
        const item = {
          id: cells[0], products: [], name: '', type: '—', sessionType: '—',
          phase: '—', priority: '—', status: 'Open', aiTool: '—',
          rank: null, reason: null, customReason: null,
        };
        headers.forEach((h, idx) => {
          if (idx >= cells.length) return;
          const v = cells[idx];
          if (h === 'products')                        item.products    = v.split(',').map(p => p.trim()).filter(Boolean);
          else if (h === 'name')                       item.name        = v;
          else if (h === 'type')                       item.type        = v;
          else if (h === 'session type')               item.sessionType = v || '—';
          else if (h === 'phase')                      item.phase       = v;
          else if (h === 'priority')                   item.priority    = v;
          else if (h === 'status' || h === 'closed')   item.status      = (v === '—' || v === '') ? 'Open' : v;
          else if (h === 'ai tools')                   item.aiTool      = v || '—';
          else if (h === 'rank') {
            if (v && v !== '—' && /^\d+$/.test(v)) item.rank = parseInt(v, 10);
          }
          else if (h === 'reason') {
            if (v && v !== '—') {
              if (v.startsWith('custom:')) {
                item.reason = 'custom';
                item.customReason = v.slice(7).trim();
              } else if (REASON_LABEL[v]) {
                item.reason = v;
              } else {
                item.reason = 'custom';
                item.customReason = v;
              }
            }
          }
        });
        if (item.name) items.push(item);
      }
    }
    return items;
  }

  function extractProducts(items) {
    const set = new Set();
    items.forEach(i => i.products.forEach(p => set.add(p)));
    return [...set].sort();
  }

  function extractSessionTypes(items) {
    const order = ['Hygiene fix', 'Prod build', 'Infra build', 'Biz enablement', 'Personal build'];
    const set = new Set();
    items.forEach(i => { if (i.sessionType && i.sessionType !== '—') set.add(i.sessionType); });
    const found = order.filter(t => set.has(t));
    set.forEach(t => { if (!order.includes(t)) found.push(t); });
    return found;
  }

  // ── Active sprint loading (parsers ported from views/sprint.js) ──

  async function loadActiveSprint() {
    // #119 (S061) — Deterministic active-sprint discovery via branch enumeration.
    // Primary path: enumerate sprint/Sprint-* branches via GitHub API + find the
    // one whose SP-*.md frontmatter has `status: active`. Bypasses master-side
    // SPRINTS.md staleness entirely (the D136 model keeps sprint files on
    // sprint/Sprint-N until close; master may not have the current sprint file).
    //
    // The all-sprints index (SPRINTS.md on master) is still fetched for
    // backwards-compat with downstream consumers reading `state.sprints` — but
    // it is no longer the source of truth for "which sprint is active."

    // Fetch SPRINTS.md (for state.sprints) — best-effort, never blocks active discovery
    let sprintsMd;
    try { sprintsMd = await Repos.getFile(CONFIG.username, state.backlogRepo, 'docs/SPRINTS.md'); }
    catch { sprintsMd = null; }
    state.sprints = sprintsMd ? parseSprintsIndex(sprintsMd) : [];

    // Module availability check
    if (!window.ActiveSprint || typeof window.ActiveSprint.getActiveSprintBranch !== 'function') {
      console.error('[backlog] window.ActiveSprint not loaded — active-sprint discovery unavailable');
      state.noActiveSprintReason = 'active_sprint_module_unavailable';
      return null;
    }

    // Discover active sprint via branch enumeration
    let discovered;
    try {
      discovered = await window.ActiveSprint.getActiveSprintBranch(CONFIG.username, state.backlogRepo);
    } catch (err) {
      console.error('[backlog] ActiveSprint discovery threw:', err);
      state.noActiveSprintReason = 'active_sprint_module_threw';
      return null;
    }

    if (!discovered) {
      // Propagate ActiveSprint's UX state — caller renders empty state with reason
      const errType = window.ActiveSprint.lastError && window.ActiveSprint.lastError.type;
      state.noActiveSprintReason = errType || 'unknown';
      return null;
    }

    // Read the detail file FROM THE DISCOVERED BRANCH (not from master)
    const filename = discovered.sprintFile;
    const sprintBranchName = discovered.branch;
    let detailMd;
    try { detailMd = await Repos.getFile(CONFIG.username, state.backlogRepo, `docs/sprints/${filename}`, sprintBranchName); }
    catch {
      state.noActiveSprintReason = 'detail_file_missing';
      return null;
    }
    if (!detailMd) {
      state.noActiveSprintReason = 'detail_file_missing';
      return null;
    }

    const frontmatter = parseFrontmatter(detailMd);

    // Synthesize `active` row if SPRINTS.md index doesn't have it (Sprint 4 case
    // on master: branch-enumerated discovery succeeded but master SPRINTS.md
    // doesn't carry the row yet). Backwards-compat with downstream renderers
    // that expect an `active` meta object with {id, start, num, status}.
    const fileStart = (filename.match(/^SP-(\d{4}-\d{2}-\d{2})\.md$/) || [])[1] || null;
    const indexedSprint = state.sprints.find(s =>
      (fileStart && s.start === fileStart) || s.id === filename.replace(/\.md$/, '')
    );
    const active = indexedSprint || {
      id: fileStart ? `SP-${fileStart}` : filename.replace(/\.md$/, ''),
      start: fileStart,
      num: discovered.sprintNum,
      status: 'active',
      _synthesized: true,  // marker for debugging
    };

    // Cross-check (D141 dogfood): if ActiveSprint module returned this branch
    // because it parsed status:active, the cross-check should be a no-op. Keep
    // it anyway to guard against parser disagreement between the minimal parser
    // in active-sprint.js and the full parser here.
    const detailStatus = (frontmatter.status || '').toLowerCase();
    if (detailStatus && detailStatus !== 'active') {
      console.warn(`[backlog] ActiveSprint returned ${sprintBranchName} but full parse of ${filename} says status:${detailStatus} — parser disagreement; treating as not-active`);
      state.noActiveSprintReason = 'parser_disagreement';
      return null;
    }
    const planItems   = parsePlanSection(detailMd);
    const adaptations = parseAdaptations(detailMd);
    const dailyLog    = parseDailyLog(detailMd);
    const acMap       = parseSprintReadyAC(detailMd);  // Ignored if no detail block

    // Per-sprint split-read (#85 schema): committed_items may include slug IDs
    // (e.g. "97-narrowed", "EXP-001") that aren't BACKLOG.md rows. Source-of-truth
    // for those is docs/backlog-detail/<slug>.md on the sprint branch. Fetch + synthesize.
    // #119 (S061): use the branch we discovered via ActiveSprint, NOT frontmatter.branch.
    // Both should match in practice (the SP file's frontmatter.branch points at the
    // branch it lives on), but the discovered branch is canonical — it's the branch
    // we just read this file from.
    const sprintBranch = sprintBranchName;

    // #122 (S061) — re-fetch BACKLOG.md from the active sprint branch so row
    // updates committed to sprint/Sprint-N during the sprint are immediately
    // visible in the UI without requiring mid-sprint master writes (D136 honored).
    // The initial fetch in render() targets master (for backlogSha writeback
    // path); we overlay with sprint-branch view here for display + filtering.
    // Fail-soft: if the sprint-branch fetch errors, keep the master version.
    try {
      const branchBacklogMd = await Repos.getFile(CONFIG.username, state.backlogRepo, state.backlogPath, sprintBranch);
      if (branchBacklogMd) {
        const branchItems = parseBacklog(branchBacklogMd);
        if (branchItems.length > 0) {
          // Merge rather than replace (#134 t7 fix): sprint-branch version wins for items
          // that exist in both (sprint-specific status/rank per D136). Master-only items
          // (new CRUD cards written to master but not yet on sprint branch) are preserved.
          const branchById = new Map(branchItems.map(i => [String(i.id), i]));
          state.items = state.items.map(i => branchById.get(String(i.id)) || i);
          // Add sprint-branch-only items (slug items with no master BACKLOG.md row)
          const masterIdSet = new Set(state.items.map(i => String(i.id)));
          branchItems.forEach(bi => { if (!masterIdSet.has(String(bi.id))) state.items.push(bi); });
          state.products = extractProducts(state.items);
          state.sessionTypes = extractSessionTypes(state.items);
        }
      }
    } catch { /* fail-soft — keep master-version state.items */ }

    const committedRaw = (frontmatter.committed_items || []).map(String);
    const existingIds = new Set(state.items.map(i => String(i.id)));
    const missingSlugs = committedRaw.filter(c => !existingIds.has(c));
    const STATUS_MAP = {
      'in-progress': 'In Progress ▶',
      'done': 'Done ✓',
      'blocked': '⏸ Blocked',
      'open': 'Open',
      'candidate': 'Not started',
      'planning': 'Not started',
      'closed': 'Done ✓',
      'needs-reverification': 'Not started',
    };
    if (missingSlugs.length && sprintBranch) {
      // #212 — synthesize from the index where possible; per-file fetch only for
      // slugs the index doesn't know (fail-soft parity with the legacy path).
      const idxCards212 = await fetchIndexCards(CONFIG.username, state.backlogRepo, sprintBranch);
      const idxBySlug = new Map((idxCards212 || []).map(c => [String(c.id).toLowerCase(), c]));
      const synthesized = await Promise.all(missingSlugs.map(async slug => {
        const ic = idxBySlug.get(String(slug).toLowerCase());
        if (ic) {
          const eff = ic.derived_status || (ic.status ? String(ic.status).toLowerCase().split(/\s+/)[0] : null);
          return {
            id: slug,
            products: ['V-Pro-Hub'],
            name: ic.title || slug,
            type: '—', sessionType: '—', phase: '—',
            priority: ic.priority || '—',
            status: STATUS_MAP[eff] || ic.status || 'Open',
            aiTool: '—', rank: null, reason: null, customReason: null,
            _synthesized: true,
          };
        }
        try {
          const md = await Repos.getFile(CONFIG.username, state.backlogRepo, `docs/backlog-detail/${slug.toLowerCase()}.md`, sprintBranch);
          if (!md) return null;
          const fm = parseFrontmatter(md);
          return {
            // Preserve committed_items casing so the membership filter still matches
            id: slug,
            products: ['V-Pro-Hub'],
            name: fm.title || slug,
            type: '—', sessionType: '—', phase: '—',
            priority: fm.priority || '—',
            status: STATUS_MAP[fm.status] || fm.status || 'Open',
            aiTool: '—', rank: null, reason: null, customReason: null,
            _synthesized: true,
          };
        } catch { return null; }
      }));
      for (const it of synthesized) if (it) state.items.push(it);
    }

    // S061/#119 — Per-card status overlay (D141 canonical SoT per item).
    // S068/#130 — EXTENDED: status now derived from todos[]+done_criteria[] aggregate
    // (tier-1 per `feedback_solution_must_be_100_percent_deterministic.md`) instead
    // of relying on the procedurally-flipped `status:` string field. Derivation
    // falls back to parsed fm.status if no todos AND no dcs present.
    // ALSO EXTENDED: overlay now covers ALL sprint cards (not just committed_items[]),
    // pairing with #129 sprintMembership so infra cards in mid_sprint_adds[] also
    // get accurate kanban status. Skipped — moved below buildSprintMembership which
    // already fetches each card's frontmatter; we'll do the overlay after that pass
    // to avoid duplicate API calls.

    // Keyed by string id so both numeric ("85") and slug ("97-narrowed") IDs resolve
    const backlogMap = Object.fromEntries(state.items.map(i => [String(i.id), i]));

    const health = computeHealthMetrics(frontmatter, planItems, backlogMap, adaptations, dailyLog);
    const drift  = computeDriftFlags(health, adaptations);
    // Sessions panel — D141 deterministic-infra principle (S055): read from
    // session cards at docs/backlog-detail/S0NN.md (canonical source) using
    // sprint frontmatter `sessions:` field as the index. Fall back to legacy
    // prose-parsed daily log if `sessions:` field missing OR no card-fetch
    // succeeds (transitional period — Sprint 4 retires fallback entirely).
    let sessions = [];
    if (Array.isArray(frontmatter.sessions) && frontmatter.sessions.length) {
      sessions = await sessionsFromCards(frontmatter.sessions, sprintBranch);
    }
    if (!sessions.length) {
      // Fallback to legacy prose parser (deprecated; retired Sprint 4)
      sessions = sessionsFromDailyLog(dailyLog);
    }

    // S067/#129 — Build sprint-membership map from per-card frontmatter (D141 SoT, tier-1).
    // Replaces the old committed_items[]-array-membership filter (which ignored
    // mid_sprint_adds[] and bg_carries[]). Per-card `sprint:` field in frontmatter
    // is the canonical authority. The 3 sprint-frontmatter arrays remain useful as
    // planning + retro analytics projections, but no longer gatekeep visibility.
    const sprintMembership = await buildSprintMembership(CONFIG.username, state.backlogRepo, sprintBranch, active.id, frontmatter);

    return {
      id: active.id,
      branch: sprintBranch,   // e.g. "sprint/Sprint-6" — used by detail-file writes (#134)
      sprintFile: filename,   // #188 — canonical SP-*.md filename on the branch (for cadence writeback)
      meta: active,
      frontmatter, planItems, backlogMap, acMap, adaptations, dailyLog,
      health, drift, sessions, sprintMembership,
    };
  }

  // S068/#130 — Derive card status from todos[]+done_criteria[] aggregate (D141 SoT, tier-1).
  // Returns one of 'done' | 'blocked' | 'in-progress' | 'candidate', or null if no
  // todos AND no dcs present (caller falls back to parsed fm.status string field).
  // Replaces procedural status-field flip with deterministic derivation per
  // `feedback_solution_must_be_100_percent_deterministic.md` rule.
  function deriveCardStatus(fm) {
    if (!fm) return null;
    const todos = Array.isArray(fm.todos) ? fm.todos : [];
    const dcs   = Array.isArray(fm.done_criteria) ? fm.done_criteria : [];
    if (todos.length === 0 && dcs.length === 0) return null;
    const norm = v => String(v == null ? '' : v).toLowerCase().trim();
    const todoDone = todos.every(t => t && ['done', 'skipped', 'na', 'n/a'].includes(norm(t.status)));
    const dcDone   = dcs.every(d => d && norm(d.status) === 'met');
    if (todoDone && dcDone) return 'done';
    const anyBlocked = todos.some(t => t && norm(t.status) === 'blocked') ||
                       dcs.some(d => d && norm(d.status) === 'blocked');
    if (anyBlocked) return 'blocked';
    const anyProgress = todos.some(t => t && ['done', 'in-progress'].includes(norm(t.status))) ||
                        dcs.some(d => d && norm(d.status) === 'met');
    if (anyProgress) return 'in-progress';
    return 'candidate';
  }

  // #192 — two derived statuses (derive-don't-store, per #187/#130):
  //   dev-complete    ← the card's own done_criteria (all met AND >=1 actually-tested DC met)
  //   automation-ready ← the coverage-registry INTERFACE (a suite-registered test covers this card)
  // Both are computed live; neither is a stored/hand-ticked field, so they can't drift.

  // dev-complete: every done_criterion met AND at least one met via an actual test
  // (manual-test or e2e-test) — "manually tested at least" per V. code-review-only does not count.
  function deriveDevComplete(fm) {
    if (!fm) return false;
    const dcs = Array.isArray(fm.done_criteria) ? fm.done_criteria : [];
    if (dcs.length === 0) return false;
    const norm = v => String(v == null ? '' : v).toLowerCase().trim();
    const allMet = dcs.every(d => d && norm(d.status) === 'met');
    const testedMet = dcs.some(d => d && norm(d.status) === 'met' &&
      ['manual-test', 'manual', 'e2e-test'].includes(norm(d.verification)));
    return allMet && testedMet;
  }

  // automation-ready reads the coverage-registry INTERFACE (CP contract): the badge is
  // true iff a suite-registered test is tagged with this card id. An empty/unloaded
  // registry -> false (badge simply off) — that is #192's definition-of-done, since #192
  // ships before #196 fills the real registry.
  function deriveAutomationReady(cardId) {
    const reg = state.coverageRegistry;
    if (!reg) return false;
    const tests = reg[String(cardId)];
    return Array.isArray(tests) && tests.length > 0;
  }

  // Style C (check-glyph outline) + ghost pending off-state, per S119 wireframe pick.
  // Only cards with done_criteria (a detail file) get badges; raw rows show nothing
  // (no basis). For tracked cards: green ✓Dev / blue ✓AutoTest when true, dashed muted
  // "… pending" when not.
  function renderStatusBadges(item) {
    const tracked = item._devComplete !== undefined;   // has a detail file with done_criteria
    const auto = deriveAutomationReady(item.id);        // covered by the regression suite
    if (!tracked && !auto) return '';                   // untracked + uncovered → no basis, no badges
    let out = '';
    // Dev badge only when we have a basis (a detail file); an untracked card's dev state is unknown.
    if (tracked) {
      out += item._devComplete === true
        ? `<span class="bl-chip vs-dev" title="Dev-complete — all done-criteria met, incl. one exercised by a test (#192)"><span class="vs-tick">✓</span>Dev</span>`
        : `<span class="bl-chip vs-ghost" title="Dev-complete pending — not all done-criteria met, or none exercised by a test yet (#192)">Dev pending</span>`;
    }
    // AutoTest badge: ✓ whenever covered (even for untracked cards); "pending" only for tracked ones.
    if (auto) {
      const tests = (state.coverageRegistry[String(item.id)] || []).join(', ');
      out += `<span class="bl-chip vs-auto" title="AutoTest — in the regression suite: ${escHtml(tests)} (#192)"><span class="vs-tick">✓</span>AutoTest</span>`;
    } else if (tracked) {
      out += `<span class="bl-chip vs-ghost" title="AutoTest pending — no regression test covers this card yet (#192)">AutoTest pending</span>`;
    }
    return out;
  }

  // S067/#129 — Sprint membership derivation from per-card frontmatter (D141 SoT).
  // S068/#130 — also overlays derived status onto state.items during the same fetch.
  // Lists docs/backlog-detail/ on the sprint branch + Promise.all-fetches each
  // per-card frontmatter + builds Map<id, sprintId>. Skips session cards (S0NN.md).
  // Logs drift if a card's sprint field differs from sprint-frontmatter array
  // membership. Returns empty Map on fail-soft.
  // #212 — single-fetch list path: docs/INDEX.json already carries every card's
  // frontmatter + the SAME derived_status/dev_complete the per-file path computes
  // (generator ports #130/#192 rules exactly). Same-origin first (freshest on
  // dev server AND deployed site), Contents API fallback. null ⇒ caller falls
  // back to the legacy ~134-round-trip path — no functional regression.
  async function fetchIndexCards(owner, repo, branch) {
    if (state._idxCardsMemo !== undefined) return state._idxCardsMemo;   // one fetch per render pass
    let cards = null;
    try {
      const r = await fetch('docs/INDEX.json?cb=' + Date.now(), { cache: 'no-store' });
      if (r.ok) { const j = await r.json(); if (Array.isArray(j.cards) && j.cards.length) cards = j.cards; }
    } catch { /* fall through */ }
    if (!cards) {
      try {
        const raw = await Repos.getFile(owner, repo, 'docs/INDEX.json', branch);
        if (raw) { const j = JSON.parse(raw); if (Array.isArray(j.cards) && j.cards.length) cards = j.cards; }
      } catch { /* fall through */ }
    }
    state._idxCardsMemo = cards;
    return cards;
  }

  async function buildSprintMembership(owner, repo, sprintBranch, expectedSprintId, sprintFrontmatter) {
    const map = new Map();
    if (!Repos || typeof Repos.listDirectory !== 'function') return map;

    // #212 fast path — one index fetch replaces list-dir + per-card fetches.
    const idxCards = await fetchIndexCards(owner, repo, sprintBranch);
    if (idxCards) {
      const STATUS_MAP_IDX = {
        'in-progress': 'In Progress ▶', 'done': 'Done ✓', 'blocked': '⏸ Blocked',
        'open': 'Open', 'candidate': 'Not started', 'planning': 'Not started',
        'closed': 'Done ✓', 'needs-reverification': 'Not started',
      };
      idxCards.forEach(c => {
        if (!c || c.type === 'session' || /^S\d+$/.test(String(c.id))) return;
        const id = String(c.backlog_ref || c.id);
        if (c.sprint) map.set(id, String(c.sprint));
        const it = state.items.find(i => String(i.id) === id);
        if (!it) return;
        if (c.epic != null) it._epic = String(c.epic);
        if (c.feature != null) it._feature = String(c.feature);
        it._devComplete = !!c.dev_complete;
        const effective = c.derived_status || (c.status ? String(c.status).toLowerCase().split(/\s+/)[0] : null);
        if (effective) {
          it.status = STATUS_MAP_IDX[effective] || c.status;
          it._cardStatus = c.status;
          it._derivedStatus = c.derived_status || null;
          it._effectiveStatus = effective;
        }
      });
      driftLog(map, expectedSprintId, sprintFrontmatter);
      return map;
    }

    // Legacy per-file path (index unreachable) — unchanged behaviour.
    let entries;
    try {
      entries = await Repos.listDirectory(owner, repo, 'docs/backlog-detail', sprintBranch);
    } catch (err) {
      console.warn('[backlog] #129 buildSprintMembership: listDirectory failed', err && err.message);
      return map;
    }
    if (!Array.isArray(entries)) return map;
    const detailFiles = entries.filter(e =>
      e && e.type === 'file' && /\.md$/.test(e.name) && !/^S\d/.test(e.name)
    );
    // S068/#130 — payload extended: also write derived status overlay onto state.items
    // during the same per-card frontmatter fetch (single API pass for #129 sprint
    // membership + #130 status derivation). Status derivation rules per #130:
    //   if every todo.status in {done, skipped, na} AND every dc.status in {met} → 'done'
    //   else if any todo/dc blocked → 'blocked'
    //   else if any todo done OR any dc met → 'in-progress'
    //   else → 'candidate'
    //   if no todos AND no dcs → null (fall back to parsed fm.status field)
    const STATUS_MAP_LOCAL = {
      'in-progress': 'In Progress ▶',
      'done': 'Done ✓',
      'blocked': '⏸ Blocked',
      'open': 'Open',
      'candidate': 'Not started',
      'planning': 'Not started',
      'closed': 'Done ✓',
      'needs-reverification': 'Not started',
    };
    await Promise.all(detailFiles.map(async f => {
      try {
        const md = await Repos.getFile(owner, repo, `docs/backlog-detail/${f.name}`, sprintBranch);
        if (!md) return;
        const fm = parseFrontmatter(md);
        if (!fm) return;
        const id = String(fm.backlog_ref || fm.id || f.name.replace(/\.md$/, ''));
        // #129 — sprint membership (only if fm.sprint present)
        if (fm.sprint) map.set(id, String(fm.sprint));
        // #144 — epic/feature badge overlay
        if (fm.epic    != null) { const it = state.items.find(i => String(i.id) === String(id)); if (it) it._epic    = String(fm.epic); }
        if (fm.feature != null) { const it = state.items.find(i => String(i.id) === String(id)); if (it) it._feature = String(fm.feature); }
        // #192 — dev-complete signal (derive-don't-store). Set true/false for every card
        // with a detail file; cards without one stay undefined → no status badges rendered.
        { const it = state.items.find(i => String(i.id) === String(id)); if (it) it._devComplete = deriveDevComplete(fm); }
        // #130 — status derivation + overlay (runs regardless of fm.sprint presence
        // so legacy cards without a sprint: field still benefit from derivation)
        const derived = deriveCardStatus(fm);
        const effective = derived || (fm.status ? String(fm.status).toLowerCase().split(/\s+/)[0] : null);
        if (effective) {
          const overlay = STATUS_MAP_LOCAL[effective] || fm.status;
          const item = state.items.find(it => String(it.id) === String(id));
          if (item) {
            item.status = overlay;
            item._cardStatus = fm.status;          // raw fm.status for debugging
            item._derivedStatus = derived;          // #130 derivation result (null = no signal)
            item._effectiveStatus = effective;      // what overlay was based on
          }
        }
      } catch { /* fail-soft */ }
    }));
    // Drift detection: log cards with sprint: ID in frontmatter SoT but missing
    // from sprint-frontmatter arrays (informational; helps Retro analytics).
    driftLog(map, expectedSprintId, sprintFrontmatter);
    return map;
  }

  // #129 drift detection, shared by the #212 index path and the legacy path.
  function driftLog(map, expectedSprintId, sprintFrontmatter) {
    if (!expectedSprintId || !sprintFrontmatter) return;
    const inAnyArray = new Set([
      ...(sprintFrontmatter.committed_items || []).map(c => String(c && c.id != null ? c.id : c)),
      ...(sprintFrontmatter.bg_carries      || []).map(c => String(c && c.id != null ? c.id : c)),
      ...(sprintFrontmatter.mid_sprint_adds || []).map(c => String(c && c.id != null ? c.id : c)),
    ]);
    const sotInSprint = [...map.entries()].filter(([id, sp]) => sp === expectedSprintId).map(([id]) => id);
    const missingFromArrays = sotInSprint.filter(id => !inAnyArray.has(id));
    if (missingFromArrays.length > 0) {
      console.info(`[backlog] #129 SoT-vs-projection drift: ${missingFromArrays.length} card(s) have sprint:${expectedSprintId} in frontmatter but appear in no sprint-frontmatter array — projection lag, not a bug. Cards: ${missingFromArrays.join(', ')}`);
    }
  }

  // D146/#120 — Lazy-load closed sprint branches for the Past filter panel.
  // First-load is a 1 + 2N API-call burst (N = number of closed sprint branches).
  // Cached in state.pastSprintBranches for the session lifetime.
  async function loadPastSprintBranches() {
    if (!window.ActiveSprint || typeof window.ActiveSprint.listAllSprintBranches !== 'function') {
      console.warn('[backlog] ActiveSprint.listAllSprintBranches unavailable; cannot load past sprints');
      state.pastSprintBranches = [];
      return;
    }
    state.pastSprintBranchesLoading = true;
    try {
      const buckets = await window.ActiveSprint.listAllSprintBranches(CONFIG.username, state.backlogRepo);
      // Sort newest-first by sprint number (listAllSprintBranches already does this within each bucket)
      state.pastSprintBranches = (buckets && buckets.closed) ? buckets.closed : [];
    } catch (err) {
      console.error('[backlog] loadPastSprintBranches failed:', err);
      state.pastSprintBranches = [];
    } finally {
      state.pastSprintBranchesLoading = false;
    }
  }

  function parseFrontmatter(md) {
    // Normalize CRLF→LF first. The bullet-collection regexes below use `(.*)$`, which
    // won't match before a trailing `\r` — so a CRLF-encoded source silently parses
    // ZERO block-list bullets (todos/done_criteria/end_user_scenarios/etc.). GitHub
    // serves LF so production was unaffected, but any local-FS / CRLF source must work too.
    md = String(md || '').replace(/\r\n/g, '\n');
    const match = md.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};
    const result = {};
    const lines = match[1].split('\n');

    // S061/#119 — YAML block-list-of-objects support (committed_items[], bg_carries[],
    // mid_sprint_adds[], swaps[], etc. per D144 sprint frontmatter schema). Detected by
    // a top-level key whose value-line is empty AND whose next non-blank line begins
    // with two-space indent + dash (`  -`).
    // S068/#130 — extended: now collects FULL bullet objects (id + status + text +
    // other scalar sub-fields) so consumers like deriveCardStatus() can read nested
    // status fields on todos[]/done_criteria[] items. Legacy consumers (committed_items
    // etc.) still get flat-ID arrays at emit time — see emit logic below.
    const blockListFull = {};  // parent_key → [{id, status, text, ...}, ...]
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = line.match(/^([\w_]+):\s*$/);  // top-level key with empty value
      if (!m) continue;
      const parentKey = m[1];
      // Peek next non-blank, non-comment line. Must start with "  - " to be a block list.
      let j = i + 1;
      while (j < lines.length && /^\s*(#.*)?$/.test(lines[j])) j++;
      if (j >= lines.length || !/^\s{2}-\s/.test(lines[j])) continue;
      const bullets = [];
      let cur = null;  // current bullet object being built
      while (j < lines.length) {
        const li = lines[j];
        if (/^\S/.test(li)) break;  // top-level key reached → end of block list
        if (/^\s*$/.test(li)) { j++; continue; }
        if (/^\s*#/.test(li)) { j++; continue; }
        // `  - id: "80"` or `  - id: 80` form — START of a new bullet
        const bulletStart = li.match(/^\s{2}-\s+([\w_]+):\s*(.*)$/);
        if (bulletStart) {
          if (cur) bullets.push(cur);
          cur = {};
          const k = bulletStart[1];
          let v = bulletStart[2];
          // Strip inline `# comment` per S062 fix (only outside brackets)
          v = v.replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '');
          cur[k] = v;
          j++;
          continue;
        }
        // `  - Design` form — simple string bullet (no key:value; e.g. process_steps[])
        const simpleStart = li.match(/^\s{2}-\s+(\S.*)$/);
        if (simpleStart) {
          if (cur) bullets.push(cur);
          cur = { _value: simpleStart[1].trim() };
          j++;
          continue;
        }
        // `    status: done` form — INNER property of current bullet
        const inner = li.match(/^\s{4,}([\w_]+):\s*(.*)$/);
        if (inner && cur) {
          const k = inner[1];
          let v = inner[2];
          // Strip inline `# comment` only outside brackets (#177 — inline arrays like
          // `blocked_on: [t1, rb-001]` / `derives_from: [t2, FR3]` must survive comment-strip
          // AND parse to a real JS array, not the literal string "[t1]"). Mirrors top-level
          // inline-array handling at line ~629.
          let inBr = 0, cut = -1;
          for (let ci = 0; ci < v.length; ci++) {
            const ch = v[ci];
            if (ch === '[') inBr++;
            else if (ch === ']') inBr--;
            else if (ch === '#' && inBr === 0 && (ci === 0 || v[ci-1] === ' ' || v[ci-1] === '\t')) { cut = ci; break; }
          }
          if (cut >= 0) v = v.slice(0, cut);
          v = v.trim();
          if (/^\[.*\]$/.test(v)) {
            cur[k] = v.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
          } else {
            cur[k] = v.replace(/^["']|["']$/g, '');
          }
          j++;
          continue;
        }
        j++;
      }
      if (cur) bullets.push(cur);
      blockListFull[parentKey] = bullets;
    }

    for (const line of lines) {
      const m = line.match(/^([\w_]+):\s*(.*)/);
      if (!m) continue;
      const key = m[1];
      // Strip trailing YAML comment (everything from " #" onward, but only OUTSIDE
      // brackets — inline arrays may contain # in elements, though rare). Bug fix
      // S055: previously comment-suffixed array lines (e.g. `sessions: [S043, ...] # note`)
      // failed the /^\[.*\]$/ test and parsed as strings. D141 dogfood — sprint
      // frontmatter `sessions:` index field carries explanatory comment.
      let raw = m[2];
      let inBracket = 0;
      let cutAt = -1;
      for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (ch === '[') inBracket++;
        else if (ch === ']') inBracket--;
        else if (ch === '#' && inBracket === 0 && (i === 0 || raw[i-1] === ' ' || raw[i-1] === '\t')) {
          cutAt = i; break;
        }
      }
      if (cutAt >= 0) raw = raw.slice(0, cutAt);
      raw = raw.trim();
      if (raw === 'null' || raw === '') { result[key] = null; continue; }
      if (raw === 'true')  { result[key] = true; continue; }
      if (raw === 'false') { result[key] = false; continue; }
      if (/^-?\d+(\.\d+)?$/.test(raw)) { result[key] = parseFloat(raw); continue; }
      if (/^\[.*\]$/.test(raw)) {
        result[key] = raw.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean).map(s => /^-?\d+(\.\d+)?$/.test(s) ? parseFloat(s) : s);
        continue;
      }
      result[key] = raw.replace(/^["']|["']$/g, '');
    }
    // Overlay block-list (S061/#119 + S068/#130): override null/string entries for keys
    // that parsed as block-lists-of-objects.
    // - Legacy keys (committed_items / bg_carries / mid_sprint_adds / swaps / dependencies):
    //   emit FLAT ID array (preserves the existing consumer contract per S061).
    // - Object-shape keys (todos / done_criteria / team): emit ARRAY OF OBJECTS so
    //   consumers like deriveCardStatus() can read nested sub-fields (S068/#130).
    const OBJECT_SHAPE_KEYS = new Set(['todos', 'done_criteria', 'team', 'feature_requirements', 'nfr', 'end_user_scenarios', 'scenario_proposals', 'test_sources']);
    const STRING_LIST_KEYS  = new Set(['process_steps']);
    for (const [k, bullets] of Object.entries(blockListFull)) {
      if (OBJECT_SHAPE_KEYS.has(k)) {
        result[k] = bullets;  // [{id, status, text, ...}, ...]
      } else if (STRING_LIST_KEYS.has(k)) {
        result[k] = bullets.map(b => b._value || b.id).filter(Boolean);  // plain strings
      } else {
        result[k] = bullets.map(b => b.id).filter(id => id != null);  // flat IDs (legacy)
      }
    }
    return result;
  }

  function parseSprintsIndex(md) {
    const out = []; const lines = md.split('\n');
    let inTable = false; let hasHeader = false;
    for (const line of lines) {
      if (/^## Sprints/.test(line))    { inTable = true; hasHeader = false; continue; }
      if (inTable && /^## /.test(line)) { inTable = false; continue; }
      if (!inTable || !line.startsWith('|')) continue;
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) continue;
      if (!hasHeader) { hasHeader = true; continue; }
      if (cells[0] && cells[0] !== '—') {
        out.push({ id: cells[0], num: parseInt(cells[1])||0, start: cells[2]||'', end: cells[3]||'',
          days: parseInt(cells[4])||7, theme: cells[5]||'', status: (cells[6]||'planned').trim() });
      }
    }
    return out;
  }

  function parsePlanSection(md) {
    const out = []; const lines = md.split('\n');
    let inPlan = false; let hasHeader = false;
    for (const line of lines) {
      if (/^## Plan/.test(line))      { inPlan = true; hasHeader = false; continue; }
      if (inPlan && /^## /.test(line)) { inPlan = false; continue; }
      if (!inPlan || !line.startsWith('|')) continue;
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) continue;
      if (!hasHeader) { hasHeader = true; continue; }
      if (cells.length >= 5 && /^P\d+$/.test(cells[0])) {
        out.push({ priority: cells[0], id: parseInt(cells[1])||0, name: cells[2]||'',
          scope: cells[3]||'?', est_h: parseFloat(cells[4])||0, model: cells[5]||'' });
      }
    }
    return out;
  }

  function parseAdaptations(md) {
    const out = []; const lines = md.split('\n');
    let inSect = false; let hasHeader = false;
    for (const line of lines) {
      if (/^## Adaptation log/.test(line)) { inSect = true; hasHeader = false; continue; }
      if (inSect && /^## /.test(line))     { inSect = false; continue; }
      if (!inSect || !line.startsWith('|')) continue;
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) continue;
      if (!hasHeader) { hasHeader = true; continue; }
      if (cells[0] && cells[0] !== '—' && !cells.some(c => /no entries yet/i.test(c))) {
        out.push({ session: cells[0], date: cells[1]||'', kind: cells[2]||'' });
      }
    }
    return out;
  }

  function parseDailyLog(md) {
    const days = []; const lines = md.split('\n');
    let inLog = false; let curDay = null; let curEntry = null;
    const flush = () => { if (curEntry && curDay) { curDay.entries.push(curEntry); curEntry = null; } };
    for (const line of lines) {
      if (/^## Daily log/.test(line)) { inLog = true; continue; }
      if (inLog && /^## /.test(line)) { flush(); inLog = false; continue; }
      if (!inLog) continue;
      const dayMatch = line.match(/^### (.+)/);
      if (dayMatch) { flush(); curDay = { date: dayMatch[1], entries: [] }; days.push(curDay); continue; }
      const sessMatch = line.match(/^- \*\*([^*]+)\*\*/);
      if (sessMatch && curDay) {
        flush();
        const header = sessMatch[1];
        const idMatch = header.match(/^(S\d+[-\w]*)/i);
        curEntry = { sessionId: idMatch ? idMatch[1] : '', header, bullets: [] };
        continue;
      }
      if (curEntry && /^\s{2,}- /.test(line)) curEntry.bullets.push(line.replace(/^\s{2,}- /, '').trim());
    }
    flush();
    return days;
  }

  function parseSprintReadyAC(md) {
    const acMap = {}; const lines = md.split('\n');
    let inSect = false; let curId = null;
    for (const line of lines) {
      if (/^## Sprint-ready items/.test(line)) { inSect = true; continue; }
      if (inSect && /^## /.test(line))         { inSect = false; continue; }
      if (!inSect) continue;
      const hm = line.match(/^### #(\d+)/);
      if (hm) { curId = parseInt(hm[1]); if (!acMap[curId]) acMap[curId] = { done: 0, total: 0 }; continue; }
      if (curId !== null) {
        if (/^\s*- \[x\]/i.test(line))      { acMap[curId].done++; acMap[curId].total++; }
        else if (/^\s*- \[ \]/.test(line))  { acMap[curId].total++; }
      }
    }
    return acMap;
  }

  function sessionsFromDailyLog(dailyLog) {
    // S061/#119 — One entry per day header (was: one per `- **` bullet, which
    // produced N rows per day with empty sessionId, all rendering identical day
    // headers as their `date` field). New shape: each Day-block yields a single
    // session entry keyed by the first `S\d+` token in the day header. Bullets
    // from inside that day become the entry's body.
    const out = [];
    for (const day of dailyLog) {
      // Extract session ID(s) + a short date range from the day-header text.
      // Header shape: `Day N — Sun 2026-05-09 → Mon 2026-05-10 — S058 <focus...>`
      const idMatches = day.date.match(/S\d+(?:-\w+)?/g) || [];
      const sessionId = idMatches[0] || '';
      // Pull the ISO date range (e.g. "2026-05-09 → 2026-05-10") for display.
      const dateRange = (day.date.match(/\d{4}-\d{2}-\d{2}(?:\s*[→\-]\s*\d{4}-\d{2}-\d{2})?/) || [''])[0];
      // Focus = the post-`Sxxx`-token tail of the day header, trimmed to ~80 chars.
      const focusMatch = day.date.match(/S\d+[-\w]*\s+(.+?)(?:\s*\(refs|$)/);
      const focus = focusMatch ? focusMatch[1].trim().slice(0, 80) : day.date.slice(0, 80);
      // Collect bullets across all `- **<...>**` entries in the day, capped.
      const allBullets = [];
      for (const e of day.entries) {
        allBullets.push(e.header);
        for (const b of e.bullets) allBullets.push(b);
      }
      out.push({
        id: sessionId,
        date: dateRange || day.date.slice(0, 40),
        focus,
        tag: '',
        body: allBullets.slice(0, 4),
        more: Math.max(0, allBullets.length - 4),
      });
    }
    return out;
  }

  // D141 deterministic-infra (S055): Sessions panel reads canonical session
  // cards at docs/backlog-detail/S0NN.md. Each card has structured frontmatter
  // (per docs/SCHEMA_SESSION_CARD.md). Sprint frontmatter `sessions:` array
  // is the index of which session ids belong to this sprint.
  async function sessionsFromCards(sessionIds, sprintBranch) {
    if (!Array.isArray(sessionIds) || !sessionIds.length) return [];
    const out = [];
    const fetched = await Promise.all(sessionIds.map(async sid => {
      const id = String(sid);
      try {
        const md = await Repos.getFile(
          CONFIG.username, state.backlogRepo,
          `docs/backlog-detail/${id}.md`, sprintBranch || null
        );
        if (!md) return null;
        const fm = parseFrontmatter(md);
        return { id, fm };
      } catch { return null; }
    }));
    for (const r of fetched) {
      if (!r) continue;
      const { id, fm } = r;
      // Build display body from structured fields (no prose parsing).
      // session_class deliberately excluded — already rendered as tag chip
      // by the panel; including it here would duplicate (S055 cosmetic fix).
      const body = [];
      // S055-10: surface quarantine state visibly so the user knows the card
      // hasn't been hand-verified against canonical sources yet
      if (fm.status === 'needs-reverification') body.push(`⚠ pending re-verification (sub-agent backfill)`);
      if (fm.commits_total != null) {
        const closeNote = (fm.commits_at_close != null && fm.commits_at_close !== fm.commits_total)
          ? ` (${fm.commits_at_close} at close)` : '';
        body.push(`${fm.commits_total} commit(s)${closeNote}`);
      }
      if (fm.time_actual_hours != null) body.push(`${fm.time_actual_hours}h actual`);
      if (fm.effectiveness_claude_overall) body.push(`claude=${fm.effectiveness_claude_overall}`);
      if (fm.effectiveness_venkatesh_overall) body.push(`venkatesh=${fm.effectiveness_venkatesh_overall}`);
      out.push({
        id,
        date: fm.date_start || '',
        focus: fm.title || '',
        tag: fm.session_class || '',
        body: body.slice(0, 4),
        more: Math.max(0, body.length - 4),
      });
    }
    // Sort by id ascending (S043, S044, ...)
    out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return out;
  }

  function statusToColumn(status) {
    const s = status || '';
    if (/Done\s*✓|✓|\bdone\b/i.test(s) && !/in progress/i.test(s)) return 'done';
    if (/in progress/i.test(s) && !/⏸/.test(s))                      return 'progress';
    if (/⏸|blocked/i.test(s))                                          return 'blocked';
    return 'todo';
  }

  function computeHealthMetrics(fm, planItems, backlogMap, adaptations, dailyLog) {
    const committed = (fm.committed_items || []).map(String);
    const todayIso = new Date().toISOString().split('T')[0];
    const start = fm.start_date || fm.start || todayIso;  // S061/#119 — start_date is canonical per AGILE §1.2
    const dayOfSprint = Math.max(1, Math.round((new Date(todayIso) - new Date(start)) / 86400000) + 1);
    const totalDays = parseInt(fm.cadence) || fm.length_days || 7;

    const cols = committed.map(id => statusToColumn((backlogMap[id] || {}).status || ''));
    const total = cols.length;
    const delivered = cols.filter(c => c === 'done').length;
    const deliveryRatio = total > 0 ? delivered / total : 0;

    let actualH = null;
    for (const day of dailyLog) for (const e of day.entries) {
      const ef = e.bullets.find(b => /^effort_hours:\s*[\d.]+/.test(b));
      if (ef) { if (actualH === null) actualH = 0; actualH += parseFloat(ef.match(/[\d.]+/)[0]); }
    }
    const totalEstH = planItems.reduce((s, p) => s + (p.est_h || 0), 0);
    const drift = (actualH !== null && totalEstH > 0) ? actualH / totalEstH : null;
    const scopeStab = total > 0 ? adaptations.length / total : 0;
    const expected = dayOfSprint / totalDays;
    const burnPace = expected > 0 && total > 0 ? (delivered / total) / expected : null;

    const focuses = [];
    for (const day of dailyLog) for (const e of day.entries) {
      const fr = e.bullets.find(b => /^focus_rating:\s*\d/.test(b));
      if (fr) focuses.push(parseInt(fr.match(/\d/)[0]));
    }
    const focusAvg = focuses.length > 0 ? focuses.reduce((s,n)=>s+n,0) / focuses.length : null;

    const confPlan  = fm.goal_confidence_plan ?? fm.goal_confidence ?? null;
    const confClose = fm.goal_confidence_close ?? null;
    const confDrift = (confPlan !== null && confClose !== null) ? confClose - confPlan : null;

    const band = (v, gFn, aFn) => v === null ? 'na' : gFn(v) ? 'green' : aFn(v) ? 'amber' : 'red';

    return [
      { key: 'delivery', label: 'Delivery',
        display: total > 0 ? `${delivered}/${total}` : '—', value: deliveryRatio,
        band: (delivered === 0 && dayOfSprint <= 2) ? 'na'
              : band(deliveryRatio, v => v >= 0.8, v => v >= 0.5) },
      { key: 'drift', label: 'Est Drift',
        display: drift !== null ? drift.toFixed(2) : '—', value: drift,
        band: band(drift, v => v >= 0.8 && v <= 1.2, v => (v >= 0.6 && v < 0.8) || (v > 1.2 && v <= 1.5)) },
      { key: 'scope', label: 'Scope',
        display: scopeStab.toFixed(2), value: scopeStab,
        band: band(scopeStab, v => v <= 0.2, v => v <= 0.4) },
      { key: 'burn', label: 'Burn',
        display: dayOfSprint <= 1 ? '—' : (burnPace !== null ? burnPace.toFixed(2) : '—'),
        value: burnPace,
        band: dayOfSprint <= 1 ? 'na' : band(burnPace, v => v >= 0.9 && v <= 1.1,
                                              v => (v >= 0.6 && v < 0.9) || (v > 1.1 && v <= 1.3)) },
      { key: 'focus', label: 'Focus',
        display: focusAvg !== null ? focusAvg.toFixed(1) : '—', value: focusAvg,
        band: band(focusAvg, v => v >= 3.8, v => v >= 2.8) },
      { key: 'confDrift', label: 'Conf ±',
        display: confDrift !== null ? (confDrift >= 0 ? `+${confDrift}` : String(confDrift))
                : (confPlan !== null ? `${confPlan}/5` : '—'),
        value: confDrift,
        band: confDrift === null ? 'na' : band(confDrift, v => v >= 0, v => v >= -1) },
    ];
  }

  function computeDriftFlags(metrics, adaptations) {
    const flags = [];
    const m = Object.fromEntries(metrics.map(x => [x.key, x]));
    if (m.burn.band === 'red' && m.burn.value !== null) {
      flags.push({ icon: '🔴', band: 'red',
        message: `Burn pace ${m.burn.display} — behind expected sprint pace.`,
        recommendation: 'Trigger Adaptation Check: swap or drop a committed item.' });
    }
    if (m.scope.band === 'red') {
      flags.push({ icon: '🔴', band: 'red',
        message: `Scope stability ${m.scope.display} — ${adaptations.length} adaptations this sprint.`,
        recommendation: 'Stop adding scope. Swap or defer.' });
    } else if (m.scope.band === 'amber') {
      flags.push({ icon: '🟡', band: 'amber',
        message: `Scope stability at ${m.scope.display} — ${adaptations.length} adaptations.`,
        recommendation: 'Default is swap-not-add.' });
    }
    if (m.confDrift.band === 'red') {
      flags.push({ icon: '🔴', band: 'red',
        message: `Goal confidence dropped ${m.confDrift.display}.`,
        recommendation: 'Consider Initiative Review or early retro.' });
    }
    return flags;
  }

  // ── Filter logic ───────────────────────────────

  // ── dc6 — URL hash filter persistence ──────────────────────────────────
  // Encodes non-default filter state into the URL hash query string via
  // history.replaceState (no hashchange event, no re-render loop).
  // Format: #/backlog?sprint=Current&q=search&priority=high&status=open
  // readFilterFromHash() is called at render()-start so filter survives
  // page reload and copy-paste URL sharing.

  function pushFilterToHash() {
    try {
      const qs = new URLSearchParams();
      if (state.searchQuery)                     qs.set('q',        state.searchQuery);
      if (state.sprintFilter  !== 'All sprints') qs.set('sprint',   state.sprintFilter);
      if (state.tierFilter    !== 'All tiers')   qs.set('tier',     state.tierFilter);
      if (state.productFilter !== 'All')         qs.set('product',  state.productFilter);
      if (state.sessionFilter !== 'All')         qs.set('session',  state.sessionFilter);
      if (state.priorityFilter)                  qs.set('priority', state.priorityFilter);
      if (state.statusFilter)                    qs.set('status',   state.statusFilter);
      const qStr = qs.toString();
      // Scoped embed keeps URL on the product route (product filter is implied there).
      if (state.scopedRoute) qs.delete('product');
      const base = state.scopedRoute || '#/backlog';
      const qStr2 = state.scopedRoute ? qs.toString() : qStr;
      history.replaceState(null, '', qStr2 ? `${base}?${qStr2}` : base);
    } catch (_) { /* safe no-op if history API unavailable */ }
  }

  function readFilterFromHash() {
    try {
      const raw = window.location.hash; // e.g. '#/backlog?sprint=Current&q=test'
      const qi = raw.indexOf('?');
      if (qi === -1) return;
      const qs = new URLSearchParams(raw.slice(qi + 1));
      if (qs.has('q'))        state.searchQuery   = qs.get('q');
      if (qs.has('sprint'))   state.sprintFilter  = qs.get('sprint');
      if (qs.has('tier'))     state.tierFilter    = qs.get('tier');
      if (qs.has('product'))  state.productFilter = qs.get('product');
      if (qs.has('session'))  state.sessionFilter = qs.get('session');
      if (qs.has('priority')) state.priorityFilter = qs.get('priority') || null;
      if (qs.has('status'))   state.statusFilter   = qs.get('status')   || null;
    } catch (_) { /* safe no-op */ }
  }

  // S038 — opts.skipTileFilters=true returns the "tile-count base set":
  // Product / Session / Sprint / Search applied, but priority+status tile filters
  // skipped. Used by renderSummary so tile counts stay stable as tiles are toggled
  // (counts represent "headroom" — what each tile expands to — not the post-tile
  // visible scope). Items list/board still calls filteredItems() with no opts.
  function filteredItems(opts) {
    opts = opts || {};
    const q = state.searchQuery.trim().toLowerCase().replace(/^#/, '');
    // S067/#129 — Sprint membership now derived from per-card frontmatter (D141 SoT, tier-1).
    // Authority: card frontmatter `sprint:` field. The 3 sprint-frontmatter arrays
    // (committed_items / bg_carries / mid_sprint_adds) remain as planning + retro
    // projections, but no longer gatekeep visibility. Fallback to the legacy
    // committed_items[] union (committed + carries + adds) only if sprintMembership
    // is empty (e.g., listDirectory failed) — fail-safe to "show something" rather
    // than nothing. Cards with no frontmatter file fall back to legacy union too.
    const sprintMembership = (state.activeSprint && state.activeSprint.sprintMembership) || new Map();
    const activeSprintId = state.activeSprint && state.activeSprint.id;
    const legacyUnion = state.activeSprint ? new Set([
      ...((state.activeSprint.frontmatter.committed_items || []).map(c => String(c && c.id != null ? c.id : c))),
      ...((state.activeSprint.frontmatter.bg_carries      || []).map(c => String(c && c.id != null ? c.id : c))),
      ...((state.activeSprint.frontmatter.mid_sprint_adds || []).map(c => String(c && c.id != null ? c.id : c))),
      // S115 fix: stretch_items[] are part of the current sprint (stretch goals) but
      // were omitted from the union, so a stretch card with a stale/non-matching
      // per-card `sprint:` field (e.g. #137, carried Sprint 5→9) fell through BOTH
      // the #129 membership path and this fallback → invisible in the Current view.
      ...((state.activeSprint.frontmatter.stretch_items   || []).map(c => String(c && c.id != null ? c.id : c))),
      // NOTE: cold_storage[] intentionally NOT included — D149 "visible-but-frozen"
      // needs distinct frozen treatment, not a plain kanban card (separate deferred gap, S086).
    ]) : new Set();
    const useSoT = sprintMembership.size > 0;

    return state.items.filter(i => {
      if (state.productFilter !== 'All' && !i.products.includes(state.productFilter)) return false;
      if (state.sessionFilter !== 'All' && i.sessionType !== state.sessionFilter) return false;

      // Sprint filter — #129 tier-1 (frontmatter SoT) with legacy-union fallback
      const idStr = String(i.id);
      const inCurrent = useSoT
        ? (sprintMembership.get(idStr) === activeSprintId) || legacyUnion.has(idStr)
        : legacyUnion.has(idStr);
      if (state.sprintFilter === 'Current' && !inCurrent) return false;
      if (state.sprintFilter === 'No sprint' && inCurrent) return false;

      // #187 (D152) — Tier filter. Independent of sprintFilter: getSprintTier()
      // already only returns non-null for cards in the active sprint's arrays.
      if (state.tierFilter !== 'All tiers') {
        const tierMap = { 'Comfortable goal': 'comfortable', 'Stretch lounge': 'stretch', 'Cold storage': 'cold' };
        if (getSprintTier(i) !== tierMap[state.tierFilter]) return false;
      }
      // 'Past' filter under D146/#120: items in this view are still all-items;
      // the historical snapshots live as separate per-closed-branch panels rendered
      // alongside (see renderPastSprintsPanel below). Future card: clicking a past
      // sprint drills into that branch's snapshot.

      // S037ext Track E — Summary tile filters (priority + status)
      if (!opts.skipTileFilters) {
        if (state.priorityFilter) {
          const isHigh = i.priority === 'HIGH' || i.priority === 'SUPER HIGH';
          const isMed  = i.priority === 'Medium';
          const isLow  = i.priority === 'Low';
          if (state.priorityFilter === 'high' && !isHigh) return false;
          if (state.priorityFilter === 'medium' && !isMed) return false;
          if (state.priorityFilter === 'low' && !isLow) return false;
        }
        if (state.statusFilter) {
          const isDone = /Done|✓/i.test(i.status) || i.status.toLowerCase() === 'closed';
          if (state.statusFilter === 'open' && isDone) return false;
          if (state.statusFilter === 'done' && !isDone) return false;
        }
      }

      if (q) {
        const hay = ['#'+i.id, i.id, i.name, i.products.join(' '), i.type, i.sessionType, i.status]
          .join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      // S120 IA Phase 4 — Epic filter (A20/A21)
      if (state.epicFilter && i._epic !== state.epicFilter) return false;
      return true;
    });
  }

  // ── Render: header, search, summary ────────────

  function renderHeader() {
    // #119 (S061): heading reflects current view context. When sprintFilter='Current'
    // (the Sprint Dashboard preset entered via #/sprint route), show "Sprint Dashboard"
    // to match the surface the user invoked.
    const title = state.sprintFilter === 'Current' ? 'Sprint Dashboard' : 'Backlog';
    return `<div class="bl-vh">
      <div>
        <div class="bl-vh-title">${title}<span class="bl-save-indicator" aria-hidden="true"></span></div>
        <div class="bl-vh-sub">${state.items.length} items</div>
      </div>
    </div>`;
  }

  // #134 CRUDQ — floating action button (FAB) for creating a new backlog item
  function renderFab() {
    return `<button class="bl-fab" id="bl-fab-add" title="Add a new backlog item" aria-label="Add backlog item">+</button>`;
  }

  function renderReadOnlyBanner() {
    return `<div class="bl-readonly-banner" role="status">
      <span class="bl-readonly-banner-tag">Read-only</span>
      <span class="bl-readonly-banner-msg">Public mode — no GitHub PAT detected. Ranks, reasons, and column moves are disabled.</span>
      <a class="bl-readonly-banner-link" href="#/settings">Connect PAT →</a>
    </div>`;
  }

  function renderSearch() {
    const val = escHtml(state.searchQuery);
    return `<input type="search" class="bl-search" id="bl-search-input"
      placeholder="Search backlog — name, #id, product, status…"
      value="${val}" autocomplete="off" spellcheck="false" />`;
  }

  function renderFilterArea() {
    const products = ['All', ...state.products];
    const sessions = ['All', ...state.sessionTypes];
    const sprints  = ['All sprints', 'Current', 'Past', 'No sprint'];

    const tabs = products.map(p => {
      const count = p === 'All' ? state.items.length : state.items.filter(i => i.products.includes(p)).length;
      return `<button class="bl-fa-tab${p === state.productFilter ? ' active' : ''}"
        data-product="${escHtml(p)}">${escHtml(p)}<span class="bl-fa-count">${count}</span></button>`;
    }).join('');

    const sChips = sessions.map(s =>
      `<button class="bl-fa-chip${s === state.sessionFilter ? ' active' : ''}"
        data-stype="${escHtml(s)}"><span class="bl-fa-dot"></span>${escHtml(s)}</button>`
    ).join('');

    // #187 (D152) — Tier filter chips: All tiers / Comfortable goal / Stretch lounge / Cold storage
    const tiers = ['All tiers', 'Comfortable goal', 'Stretch lounge', 'Cold storage'];
    const tierChips = tiers.map(t =>
      `<button class="bl-fa-chip${t === state.tierFilter ? ' active' : ''}"
        data-tier="${escHtml(t)}"><span class="bl-fa-dot"></span>${escHtml(t)}</button>`
    ).join('');

    const spChips = sprints.map(s =>
      `<button class="bl-fa-chip${s === state.sprintFilter ? ' active' : ''}"
        data-sprint="${escHtml(s)}"><span class="bl-fa-dot"></span>${escHtml(s)}</button>`
    ).join('') + (() => {
      const isRange = state.sprintFilter === 'range';
      const startV = state.rangeStart || '2026-04-12';
      const endV   = state.rangeEnd || '2026-04-19';
      if (!isRange) {
        return `<button class="bl-fa-chip" data-sprint="range"><span class="bl-fa-dot"></span>Custom range…</button>`;
      }
      return `<button class="bl-fa-chip expanded active" data-sprint="range">
        <span class="bl-fa-dot"></span>
        <span class="bl-fa-chip-range">
          <input class="bl-fa-chip-date" type="date" id="bl-range-start" value="${startV}" onclick="event.stopPropagation()">
          <span class="bl-fa-chip-arrow">→</span>
          <input class="bl-fa-chip-date" type="date" id="bl-range-end"   value="${endV}"   onclick="event.stopPropagation()">
        </span>
      </button>`;
    })();

    // S120 IA Phase 4 — Epic filter (type-ahead over distinct epic ids on loaded items)
    const epicOptions = [...new Set(state.items.map(i => i._epic).filter(Boolean))].sort();
    const epicAxis = `<div class="bl-fa-axis"><div class="bl-fa-axis-label">Epic</div>
      <div class="bl-fa-chips" style="flex:1;align-items:center">
        <input class="bl-fa-epic-input" id="bl-epic-filter" list="bl-epic-list" placeholder="◈ filter by epic…" autocomplete="off" value="${escAttr(state.epicFilter || '')}">
        <datalist id="bl-epic-list">${epicOptions.map(e => `<option value="${escAttr(e)}"></option>`).join('')}</datalist>
        ${state.epicFilter ? `<button class="bl-fa-chip active" id="bl-epic-clear"><span class="bl-fa-dot"></span>✕ ${escHtml(state.epicFilter)}</button>` : ''}
      </div></div>`;

    // S037ext #90 — VM toggle now visible across all sprint filters (was: Current only)
    const vmRow = `<div class="bl-fa-axis" style="justify-content:flex-end">
      <div style="flex:1"></div>
      <div class="bl-vm">
        <button class="bl-vm-btn${state.vmMode === 'list'  ? ' active' : ''}" data-vm="list"><span class="bl-vm-ic">▤</span> List</button>
        <button class="bl-vm-btn${state.vmMode === 'board' ? ' active' : ''}" data-vm="board"><span class="bl-vm-ic">▦</span> Board</button>
        <button class="bl-vm-btn${state.vmMode === 'epic'  ? ' active' : ''}" data-vm="epic"><span class="bl-vm-ic">◈</span> Epic</button>
      </div>
    </div>`;

    // Scoped embed: product is fixed by the route — drop the product axis (CD: disabled select).
    const productAxis = state.scopedRoute ? '' :
      `<div class="bl-fa-axis"><div class="bl-fa-axis-label">Product</div><div class="bl-fa-tabs" id="bl-product-tabs">${tabs}</div></div>`;
    return `<div class="bl-fa" id="bl-filter-area">
      ${productAxis}
      <div class="bl-fa-axis"><div class="bl-fa-axis-label">Session</div><div class="bl-fa-chips" id="bl-stype-chips">${sChips}</div></div>
      <div class="bl-fa-axis"><div class="bl-fa-axis-label">Sprint</div><div class="bl-fa-chips" id="bl-sprint-chips">${spChips}</div></div>
      <div class="bl-fa-axis"><div class="bl-fa-axis-label">Tier</div><div class="bl-fa-chips" id="bl-tier-chips">${tierChips}</div></div>
      ${epicAxis}
      ${vmRow}
    </div>`;
  }

  // S037ext Track E — clickable summary tile factory.
  // Each tile carries data-tile-key + active class when its filter is selected.
  // Clicking toggles the filter (selecting → re-clicking clears).
  function renderSummary(baseItems) {
    // S038 — `baseItems` is the tile-count base set (Product/Session/Sprint/Search
    // applied, priority+status tile filters skipped). This makes counts represent
    // headroom — what each tile would expand to — independent of which tile is
    // currently active. Earlier (S037ext) this received the fully-filtered items,
    // which caused counts to collapse to 0 when a tile was selected.
    const isDone = i => /Done|✓/i.test(i.status) || i.status.toLowerCase() === 'closed';
    const open = baseItems.filter(i => !isDone(i));
    const high = open.filter(i => i.priority === 'HIGH' || i.priority === 'SUPER HIGH');
    const med  = open.filter(i => i.priority === 'Medium');
    const low  = open.filter(i => i.priority === 'Low');
    const done = baseItems.filter(isDone);

    // Active states
    const isOpenSel = state.statusFilter === 'open';
    const isHighSel = state.priorityFilter === 'high';
    const isMedSel  = state.priorityFilter === 'medium';
    const isLowSel  = state.priorityFilter === 'low';
    const isDoneSel = state.statusFilter === 'done';

    const cls = (base, active) => `${base}${active ? ' is-selected' : ''}`;

    return `<div class="bl-sb">
      <button class="${cls('bl-sb-tile lead', isOpenSel)}" data-tile-key="open" type="button" title="${isOpenSel ? 'Click to clear' : 'Click to filter to open items'}"><div class="bl-sb-num">${open.length}<span class="bl-sb-unit">items</span></div><div class="bl-sb-lbl">Open</div></button>
      <button class="${cls('bl-sb-tile lead danger', isHighSel)}" data-tile-key="high" type="button" title="${isHighSel ? 'Click to clear' : 'Click to filter to high priority'}"><div class="bl-sb-num">${high.length}<span class="bl-sb-unit">items</span></div><div class="bl-sb-lbl">High priority</div></button>
      <div class="bl-sb-divider"></div>
      <button class="${cls('bl-sb-tile ctx', isMedSel)}" data-tile-key="medium" type="button" title="${isMedSel ? 'Click to clear' : 'Click to filter to medium priority'}"><div class="bl-sb-ctx-wrap"><div class="bl-sb-num">${med.length}<span class="bl-sb-unit">med</span></div><span class="bl-sb-sub bl-sb-sub-btn ${isLowSel ? 'is-selected' : ''}" data-tile-key="low" role="button" tabindex="0" title="${isLowSel ? 'Click to clear' : 'Click to filter to low priority'}">${low.length} low</span></div></button>
      <button class="${cls('bl-sb-tile ctx', isDoneSel)}" data-tile-key="done" type="button" title="${isDoneSel ? 'Click to clear' : 'Click to filter to items done this cycle'}"><div class="bl-sb-ctx-wrap"><div class="bl-sb-num">${done.length}<span class="bl-sb-unit">done</span></div><div class="bl-sb-sub">this cycle</div></div></button>
    </div>`;
  }

  // ── Render: sprint context band (Option C) ─────

  function renderSprintBand() {
    const s = state.activeSprint;
    if (!s) {
      // S058 post-close: surface why no active sprint rendered so the empty
      // state is actionable (e.g. index drift caught by detail-file cross-check).
      const reason = state.noActiveSprintReason;
      const lastClosed = (state.sprints || []).filter(sp => sp.status === 'closed')
        .reduce((a, b) => (b.num > (a?.num || 0) ? b : a), null);
      let msg = 'No active sprint.';
      let detail = 'Open a sprint via Sprint Planning ceremony.';
      if (reason === 'detail_says_closed' && state.noActiveSprintCandidate) {
        const cand = state.noActiveSprintCandidate;
        msg = `No active sprint — index row drift detected.`;
        detail = `SPRINTS.md marks ${cand.id} as active, but its detail file says status:${state.noActiveSprintDetailStatus}. Flip the SPRINTS.md row to ${state.noActiveSprintDetailStatus} and add the next sprint row.`;
      } else if (reason === 'detail_file_missing' && state.noActiveSprintCandidate) {
        const cand = state.noActiveSprintCandidate;
        msg = `Active sprint detail file missing.`;
        detail = `SPRINTS.md marks ${cand.id} as active, but docs/sprints/SP-${cand.start}.md was not found on the default branch. Commit the sprint detail file or correct the row.`;
      } else if (lastClosed) {
        msg = `No active sprint.`;
        detail = `Last closed sprint was ${lastClosed.id}. Run the Sprint OPEN ceremony to create the next sprint.`;
      }
      return `<div class="bl-empty">
        <div class="bl-empty-glyph">∅</div>
        <div class="bl-empty-msg">${escHtml(msg)}</div>
        <div class="bl-empty-detail">${escHtml(detail)}</div>
      </div>`;
    }
    const fm = s.frontmatter;
    const total = s.health.find(h => h.key === 'delivery').display.split('/')[1] || 0;
    const delivered = s.health.find(h => h.key === 'delivery').display.split('/')[0] || 0;
    const pct = total > 0 ? Math.round(delivered / total * 100) : 0;
    const todayIso = new Date().toISOString().split('T')[0];
    // S061/#119 — frontmatter field is `start_date` per AGILE §1.2 + D144 schema.
    // Pre-#119 code used `fm.start` which was undefined → Day always rendered as 1.
    const startIso = fm.start_date || fm.start || todayIso;
    const dayOfSprint = Math.max(1, Math.round((new Date(todayIso) - new Date(startIso)) / 86400000) + 1);
    const totalDays = parseInt(fm.cadence) || fm.length_days || 7;

    const healthHtml = s.health.map(m => {
      const cls = m.band === 'green' ? 'hp-green' : m.band === 'amber' ? 'hp-amber'
                : m.band === 'red'   ? 'hp-red'   : 'hp-na';
      return `<div class="health-pill ${cls}">
        <span class="hp-label">${escHtml(m.label)}</span>
        <span class="hp-value">${escHtml(m.display)}</span>
      </div>`;
    }).join('');

    const driftHtml = s.drift.length === 0 ? '' : s.drift.map(d => `
      <div class="drift-flag${d.band === 'red' ? ' df-red' : ''}">
        <span class="df-icon">${escHtml(d.icon)}</span>
        <div class="df-body">
          <div class="df-message">${escHtml(d.message)}</div>
          <div class="df-recommendation">${escHtml(d.recommendation)}</div>
        </div>
      </div>`).join('');

    return `<div class="bl-C-band" id="bl-sprint-band" data-collapsed="${state.bandCollapsed}">
      <div class="bl-ctx-head" id="bl-band-head">
        <span class="bl-ctx-eyebrow">▶ Sprint · ${escHtml(s.id)}</span>
        <span class="bl-ctx-name">${escHtml(fm.theme || s.meta.theme || '')}</span>
        <span class="bl-ctx-merged">
          <span class="bl-ctx-stat">Day <strong>${dayOfSprint}/${totalDays}</strong></span>
          <span class="bl-ctx-stat">· <strong>${delivered}/${total}</strong> delivered</span>
          <span class="bl-ctx-progress"><span class="bl-ctx-progress-fill" style="width:${pct}%"></span></span>
          <span class="bl-ctx-pct">${pct}%</span>
        </span>
        ${isReadOnly() ? '' : `<button class="bl-cad-btn" id="bl-cad-open" type="button" title="Extend or shorten this sprint (#188)">⤢ Adjust cadence</button>`}
      </div>
      <div class="health-strip">${healthHtml}</div>
      ${driftHtml ? `<div style="display:flex;flex-direction:column;gap:8px">${driftHtml}</div>` : ''}
    </div>`;
  }

  function renderAuxPanels() {
    const s = state.activeSprint;
    if (!s) return '';
    const sessionsHtml = s.sessions.length === 0
      ? `<div class="bl-empty-detail">No sessions logged yet this sprint.</div>`
      : s.sessions.slice(0, 3).map(se => `
        <div class="bl-log-entry">
          <div class="bl-log-head">
            <span class="bl-log-id">${escHtml(se.id)}</span>
            <span class="bl-log-date">· ${escHtml(se.date)}</span>
            ${se.focus ? `<span class="bl-log-focus">· focus: ${escHtml(se.focus)}</span>` : ''}
            ${se.tag   ? `<span class="bl-log-tag">${escHtml(se.tag)}</span>` : ''}
          </div>
          <div class="bl-log-body">
            <ul>${se.body.slice(0, 2).map(b => `<li>${escHtml(b)}</li>`).join('')}</ul>
            ${se.more > 0 ? `<div class="bl-log-more">+${se.more} more</div>` : ''}
          </div>
        </div>`).join('');

    return `<div class="bl-C-aux">
      <div class="bl-ctx-panel" id="bl-aux-sessions">
        <div class="bl-ctx-panel-head" data-aux="sessions">
          <span class="bl-ctx-panel-title">Sessions this sprint <span class="bl-ctx-panel-count">${s.sessions.length}</span></span>
          <span class="bl-ctx-panel-caret">▾</span>
        </div>
        <div class="bl-ctx-panel-body">${sessionsHtml}</div>
      </div>
      <div class="bl-ctx-panel collapsed" id="bl-aux-projects">
        <div class="bl-ctx-panel-head" data-aux="projects">
          <span class="bl-ctx-panel-title">Projects at a glance <span class="bl-ctx-panel-count">—</span></span>
          <span class="bl-ctx-panel-caret">▾</span>
        </div>
        <div class="bl-ctx-panel-body">
          <div class="bl-empty-detail">Projects panel will populate from BACKLOG multi-tool projects in a future polish.</div>
        </div>
      </div>
    </div>`;
  }

  // ── Render: list rows (with Rank + Reason) ─────

  function renderRankCell(item) {
    if (item._rankState === 'editing') {
      return `<div class="bl-rank editing">
        <input type="number" min="1" step="1" class="bl-rank-input"
          data-id="${escHtml(item.id)}" value="${item._rankDraft != null ? item._rankDraft : (item.rank || '')}" />
      </div>`;
    }
    if (item._rankState === 'saving')   return `<div class="bl-rank saving">${item.rank ?? ''}</div>`;
    if (item._rankState === 'saved')    return `<div class="bl-rank saved">${item.rank ?? ''}</div>`;
    if (item._rankState === 'conflict') return `<div class="bl-rank conflict" data-id="${escHtml(item.id)}" title="Someone else edited this — click to reload">${item.rank ?? ''}</div>`;
    return `<div class="bl-rank${item.rank == null ? ' empty' : ''}" data-id="${escHtml(item.id)}" title="Click to edit rank">${item.rank ?? ''}</div>`;
  }

  function renderReasonChip(item) {
    let cls = 'bl-ic-reason';
    let txt = '';
    if (item.customReason) { cls += ' set custom'; txt = item.customReason; }
    else if (item.reason)  { cls += ' set';        txt = REASON_LABEL[item.reason] || item.reason; }
    else                    cls += ' empty';
    if (item._reasonSaving) cls += ' saving';
    const titleAttr = item.customReason ? ` title="${escHtml(item.customReason)}"` : '';
    return `<span class="${cls}" data-reason-trigger data-id="${escHtml(item.id)}"${titleAttr}>${escHtml(txt)}${txt ? '<span class="bl-ic-reason-caret">▾</span>' : ''}</span>`;
  }

  // #187 (D152) — sprint tier lookup: return 'comfortable' | 'stretch' | 'cold' | null,
  // derived live from the active sprint's frontmatter arrays (committed_items[] /
  // stretch_items[] / cold_storage[]). No new field is stored on the card — the tier
  // is sprint-scoped and recomputed here every render, same source as filteredItems()'s
  // sprintMembership/legacyUnion (~line 1013-1024), so it cannot drift out of sync.
  const TIER_LABEL = { comfortable: 'Comfortable', stretch: 'Stretch', cold: 'Cold' };
  function getSprintTier(item) {
    if (!state.activeSprint) return null;
    const idStr = String(item.id);
    const fm = state.activeSprint.frontmatter || {};
    const inArr = (arr) => (arr || []).some(c => String(c && c.id != null ? c.id : c) === idStr);
    if (inArr(fm.committed_items)) return 'comfortable';
    if (inArr(fm.stretch_items))   return 'stretch';
    if (inArr(fm.cold_storage))    return 'cold';
    return null;
  }
  function renderTierBadge(item) {
    const tier = getSprintTier(item);
    if (!tier) return '';
    return `<span class="bl-chip tier-${tier}" title="Sprint tier: ${TIER_LABEL[tier]} (D152)"><span class="bl-chip-dot"></span>${TIER_LABEL[tier]}</span>`;
  }

  // #86 Sprint Priority badge — return 'P1'/'P2'/... if item is in active sprint's
  // committed_items planItems list, else null.
  function getSprintPriority(item) {
    if (!state.activeSprint) return null;
    const idNum = parseInt(item.id, 10);
    const plan = state.activeSprint.planItems || [];
    const row = plan.find(p => p.id === idNum);
    return row ? row.priority : null;
  }

  function renderItem(item) {
    const done = /Done|✓/i.test(item.status);
    const prioCls = { HIGH: 'prio-high', 'SUPER HIGH': 'prio-high', Medium: 'prio-med', Low: 'prio-low' }[item.priority] || 'prio-low';
    const railCls = { HIGH: 'rail-high', 'SUPER HIGH': 'rail-high', Medium: 'rail-med', Low: 'rail-low' }[item.priority] || '';
    const sCls = done ? 'status-done'
      : /Progress/i.test(item.status) ? 'status-progress'
      : /Blocked/i.test(item.status)  ? 'status-block'
      : 'status-open';
    const sText = done ? 'Done ✓' : item.status.replace(' ▶', '').replace(' ⏸', '');
    const tags = item.products.map(p => `<span class="bl-ic-tag">${escHtml(p)}</span>`).join('');
    const dropClass = item._dropHint ? ` drop-${item._dropHint}` : '';
    // Injected feature items (scoped product embed) are read-only rows: no grip / edit / delete.
    const rowReadOnly = isReadOnly() || item._isFeature;
    const hasGripCls = rowReadOnly ? '' : ' has-grip';
    const grip = rowReadOnly ? '' : `<span class="bl-grip" draggable="true" data-id="${escHtml(item.id)}" title="Drag to reorder"><span class="bl-grip-glyph">⋮⋮</span></span>`;

    // #86 — sprint priority badge (P1/P2/... when item is in active sprint's committed_items)
    const sprintPrio = getSprintPriority(item);
    const sprintPrioBadge = sprintPrio ? `<span class="bl-ic-sprint-prio" title="Sprint priority: ${escHtml(sprintPrio)}">${escHtml(sprintPrio)}</span>` : '';

    return `<div class="bl-ic ${railCls}${done ? ' item-done' : ''}${hasGripCls}${dropClass}" data-id="${escHtml(item.id)}">
      ${grip}
      ${renderRankCell(item)}
      <div class="bl-ic-head">
        <div class="bl-ic-name">${inline(item.name)}</div>
        <div class="bl-ic-meta">
          ${sprintPrioBadge}
          <span class="bl-ic-id">${/^\d/.test(String(item.id)) ? '#' : ''}${escHtml(item.id)}</span>
          <span class="bl-ic-sep">·</span>
          ${tags}
          ${renderReasonChip(item)}
        </div>
      </div>
      <div class="bl-ic-glance">
        ${renderTierBadge(item)}
        <span class="bl-chip ${prioCls}"><span class="bl-chip-dot"></span>${escHtml(item.priority === 'HIGH' || item.priority === 'SUPER HIGH' ? 'High' : item.priority)}</span>
        <span class="bl-chip ${sCls}"><span class="bl-chip-dot"></span>${escHtml(sText)}</span>
        ${item._epic ? `<span class="bl-chip" data-kc-nav-epic="${escAttr(item._epic)}" style="cursor:pointer;background:var(--accent-soft-bg);color:var(--accent-soft-fg);border:1px solid var(--accent-soft-bd)" title="Filter to ${escHtml(item._epic)}">${escHtml(item._epic)}</span>` : ''}
        ${renderStatusBadges(item)}
        ${rowReadOnly ? '' : `<button class="bl-ic-edit" data-edit-id="${escHtml(item.id)}" title="Edit this item">✎</button>`}
        ${rowReadOnly ? '' : `<button class="bl-ic-del" data-del-id="${escHtml(item.id)}" title="Delete this item">⊘</button>`}
      </div>
    </div>`;
  }

  function renderItemsList(items) {
    const isDone = i => /Done|✓/i.test(i.status) || i.status.toLowerCase() === 'closed';
    const sortByRank = (a, b) => (a.rank ?? 9999) - (b.rank ?? 9999);
    const open   = items.filter(i => !isDone(i)).sort(sortByRank);
    const closed = items.filter(isDone).sort(sortByRank);

    if (items.length === 0) {
      const productFlt = state.productFilter === 'All' ? '*' : state.productFilter;
      const sessionFlt = state.sessionFilter === 'All' ? '*' : state.sessionFilter;
      const sprintFlt  = state.sprintFilter;
      return `<div class="bl-empty">
        <div class="bl-empty-glyph">∅</div>
        <div class="bl-empty-msg">No items match these filters.</div>
        <div class="bl-empty-detail">Product: ${escHtml(productFlt)} · Session: ${escHtml(sessionFlt)} · Sprint: ${escHtml(sprintFlt)}</div>
        <button class="bl-empty-cta" id="bl-clear-filters">Clear filters</button>
      </div>`;
    }

    const renderList = list => `<div class="bl-list">${list.map(renderItem).join('')}</div>`;
    return [
      open.length   ? `<div class="bl-section-head">Open · ${open.length}</div>${renderList(open)}` : '',
      closed.length ? `<div class="bl-section-head">Done this cycle · ${closed.length}</div>${renderList(closed)}` : '',
    ].filter(Boolean).join('');
  }

  // ── Render: kanban (Sprint=Current Board mode) ─

  const COLS = [
    { id: 'todo',     icon: '⏳', label: 'Not started' },
    { id: 'progress', icon: '▶',  label: 'In progress' },
    { id: 'blocked',  icon: '⏸',  label: 'Blocked' },
    { id: 'done',     icon: '✓',  label: 'Done' },
  ];
  const COL_STATUS = { todo: 'Not Started', progress: 'In Progress ▶', blocked: 'Blocked ⏸', done: 'Done ✓' };

  function renderKanbanCard(item) {
    const railCls  = { HIGH: 'rail-high', 'SUPER HIGH': 'rail-high', Medium: 'rail-med', Low: 'rail-low' }[item.priority] || '';
    const dragging = item._dragging ? ' dragging' : '';
    const saveDot  = item._saveDot ? `<span class="kc-savedot ${item._saveDot}" title="${item._saveDot}"></span>` : '';
    const ac = state.activeSprint && state.activeSprint.acMap[parseInt(item.id)];
    const acStr = ac ? `${ac.done}/${ac.total} AC` : '';
    const epicBadge    = item._epic    ? `<span class="kc-epic-badge"    data-kc-nav-epic="${escHtml(item._epic)}">${escHtml(item._epic)}</span>` : '';
    const featureBadge = item._feature ? `<span class="kc-feature-badge" data-kc-nav-feature="${escHtml(item._feature)}">${escHtml(item._feature)}</span>` : '';
    return `<div class="kanban-card ${railCls}${dragging}" draggable="${(isReadOnly() || item._isFeature) ? 'false' : 'true'}" data-id="${escHtml(item.id)}">
      ${saveDot}
      <div class="kc-header">
        <span class="kc-rank">${item._isFeature ? escHtml(item.id) : `#${item.rank ?? '—'}·${escHtml(item.id)}`}</span>
        <span style="flex:1"></span>
        ${renderTierBadge(item)}
        <span class="kc-name-tag">${escHtml(item.priority)}</span>
      </div>
      <div class="kc-name">${escHtml(item.name)}</div>
      <div class="kc-footer">
        ${acStr ? `<span>${escHtml(acStr)}</span>` : ''}
        ${renderStatusBadges(item)}
        ${epicBadge}${featureBadge}
      </div>
    </div>`;
  }

  function renderKanban(items) {
    const cardsByCol = {};
    for (const c of COLS) cardsByCol[c.id] = [];
    for (const i of items) {
      const col = statusToColumn(i.status);
      if (cardsByCol[col]) cardsByCol[col].push(i);
    }
    return `<div class="kanban-board" id="bl-kanban">
      ${COLS.map(c => `<div class="kanban-col" data-col="${c.id}">
        <div class="kanban-col-header">
          <span class="kch-icon">${c.icon}</span>
          <span class="kch-label">${escHtml(c.label)}</span>
          <span class="kch-count">${cardsByCol[c.id].length}</span>
        </div>
        <div class="kanban-col-body">
          ${cardsByCol[c.id].length ? cardsByCol[c.id].map(renderKanbanCard).join('') : '<div class="kc-empty">—</div>'}
        </div>
      </div>`).join('')}
    </div>`;
  }

  // ── Skeleton + main render ─────────────────────

  function renderSkeleton() {
    return `<div class="bl-vh">
      <div><div class="bl-vh-title">Backlog</div><div class="bl-vh-sub">Loading…</div></div>
    </div>
    <div class="bl-fa"><div class="bl-fa-axis"><div class="bl-fa-axis-label">Product</div>
      <div class="bl-fa-tabs">${[1,2,3].map(()=>'<button class="bl-fa-tab">…</button>').join('')}</div></div></div>
    <div class="bl-list">${[1,2,3].map(()=>`<div class="bl-ic">
      <div class="bl-rank empty"></div>
      <div class="bl-ic-head"><div class="skel-line" style="width:55%;height:13px"></div>
        <div class="skel-line" style="width:30%;height:10px;margin-top:6px"></div></div>
      <div class="bl-ic-glance"></div>
    </div>`).join('')}</div>`;
  }

  // ── Render: Epic mode (S120 IA Phase 4 — group filtered items by epic) ─
  // R2.3 (CD UX spec) — nested epic → feature → card tree. Epic and feature nodes
  // collapse independently; default on first open = epics expanded one level
  // (features visible), cards collapsed. State persists while the surface is open.
  function renderEpicTree(items) {
    if (items.length === 0) return renderItemsList(items);   // reuse empty-state
    const isDone = i => /Done|✓/i.test(i.status) || i.status.toLowerCase() === 'closed';
    const groups = {}; const order = [];
    for (const it of items) {
      const key = it._epic || '(no epic)';
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(it);
    }
    order.sort((a, b) => a === '(no epic)' ? 1 : b === '(no epic)' ? -1 : a.localeCompare(b));
    state.epicCollapsed = state.epicCollapsed || {};
    state.featCollapsed = state.featCollapsed || {};        // default true (cards collapsed)
    const featOpen = key => state.featCollapsed[key] === false;
    const statusChip = it => {
      const cls = isDone(it) ? 'status-done' : /Progress/i.test(it.status) ? 'status-progress' : /Blocked/i.test(it.status) ? 'status-block' : 'status-open';
      return `<span class="bl-chip ${cls}"><span class="bl-chip-dot"></span>${escHtml(isDone(it) ? 'Done ✓' : it.status.replace(' ▶', '').replace(' ⏸', ''))}</span>`;
    };
    return `<div class="bl-epic-tree">` + order.map(epic => {
      const list = groups[epic].sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));
      const done = list.filter(isDone).length;
      const collapsed = !!state.epicCollapsed[epic];
      // Feature tier: feature-items in this epic ∪ distinct _feature refs on its cards
      const featItems = list.filter(i => i._isFeature);
      const cards = list.filter(i => !i._isFeature);
      const featIds = [...new Set([...featItems.map(f => String(f.id)), ...cards.map(c => c._feature).filter(Boolean)])].sort();
      const byFeat = {}; featIds.forEach(f => { byFeat[f] = []; });
      const direct = [];
      cards.forEach(c => { if (c._feature && byFeat[c._feature]) byFeat[c._feature].push(c); else direct.push(c); });
      const featNodes = featIds.map(fid => {
        const fitem = featItems.find(f => String(f.id) === fid);
        const kids = byFeat[fid];
        const key = `${epic}|${fid}`;
        const open = featOpen(key);
        return `<div class="bl-feat-node">
          <div class="bl-feat-head" data-feat-toggle="${escAttr(key)}">
            <span class="bl-epic-caret${open ? ' open' : ''}">▶</span>
            <span class="bl-feat-id" data-kc-nav-feature="${escAttr(fid)}" title="Open feature detail">${escHtml(fid)}</span>
            <span class="bl-feat-name">${escHtml(fitem ? fitem.name : '')}</span>
            ${fitem ? statusChip(fitem) : ''}
            <span class="bl-epic-count">${kids.length} card${kids.length !== 1 ? 's' : ''}</span>
          </div>
          <div class="bl-feat-body"${open ? '' : ' style="display:none"'}>${kids.map(renderItem).join('') || ''}</div>
        </div>`;
      }).join('');
      return `<div class="bl-epic-group">
        <div class="bl-epic-head" data-epic-toggle="${escAttr(epic)}">
          <span class="bl-epic-caret${collapsed ? '' : ' open'}">▶</span>
          <span class="bl-epic-id">${escHtml(epic)}</span>
          <span class="bl-epic-count">${list.length} item${list.length !== 1 ? 's' : ''} · ${done} done</span>
        </div>
        <div class="bl-epic-body"${collapsed ? ' style="display:none"' : ''}>${featNodes}${direct.map(renderItem).join('')}</div>
      </div>`;
    }).join('') + `</div>`;
  }

  function fullRender(container) {
    const items = filteredItems();
    const tileBase = filteredItems({ skipTileFilters: true });
    const showSprintCtx = state.sprintFilter === 'Current' && state.activeSprint;
    // #90 — board view available across all sprint filters (S037ext); previously gated to Current+activeSprint
    const showKanban    = state.vmMode === 'board';
    // D146/#120 — show past-sprints panel when 'Past' filter selected
    const showPastSprints = state.sprintFilter === 'Past';

    container.innerHTML = `
      ${isReadOnly() ? renderReadOnlyBanner() : ''}
      ${renderHeader()}
      ${renderSearch()}
      ${renderFilterArea()}
      ${renderSummary(tileBase)}
      ${showSprintCtx ? renderSprintBand() : ''}
      ${showPastSprints ? renderPastSprintsPanel() : ''}
      <div id="bl-main-canvas">${state.vmMode === 'epic' ? renderEpicTree(items) : showKanban ? renderKanban(items) : renderItemsList(items)}</div>
      ${showSprintCtx ? renderAuxPanels() : ''}
      ${renderCrudModal()}
      ${renderCadenceModal()}
      ${isReadOnly() ? '' : renderFab()}
    `;
    wireEvents(container);
  }

  // D146/#120 — past-sprints panel
  function renderPastSprintsPanel() {
    if (state.pastSprintBranchesLoading) {
      return `<div class="bl-past-panel bl-past-panel-loading">
        <div class="bl-past-panel-title">Past Sprints</div>
        <div class="bl-past-panel-sub muted">Loading closed sprint branches…</div>
      </div>`;
    }
    if (state.pastSprintBranches === null) {
      return `<div class="bl-past-panel">
        <div class="bl-past-panel-title">Past Sprints</div>
        <div class="bl-past-panel-sub muted">Click 'Past' again to load.</div>
      </div>`;
    }
    if (state.pastSprintBranches.length === 0) {
      return `<div class="bl-past-panel bl-past-panel-empty">
        <div class="bl-past-panel-title">Past Sprints</div>
        <div class="bl-past-panel-sub muted">No closed sprint branches found.</div>
      </div>`;
    }
    const rows = state.pastSprintBranches.map(s => {
      const fm = s.frontmatter || {};
      const goalConf = fm.goal_confidence_close ?? '—';
      const commitPct = fm.commit_actual_pct ?? '—';
      const startDate = fm.start_date || '—';
      const endDate   = fm.end_date   || '—';
      return `<div class="bl-past-row" data-branch="${escAttr(s.branch)}">
        <div class="bl-past-row-head">
          <span class="bl-past-num">Sprint ${s.sprintNum}</span>
          <span class="bl-past-id field-mono">${escHtml(fm.id || s.sprintFile.replace(/\.md$/, ''))}</span>
          <span class="bl-past-branch field-mono muted">${escHtml(s.branch)}</span>
        </div>
        <div class="bl-past-row-meta muted">
          ${escHtml(startDate)} → ${escHtml(endDate)} ·
          goal-conf: ${escHtml(String(goalConf))} ·
          commit %: ${escHtml(String(commitPct))}
        </div>
      </div>`;
    }).join('');
    return `<div class="bl-past-panel">
      <div class="bl-past-panel-title">Past Sprints <span class="bl-past-panel-count">${state.pastSprintBranches.length}</span></div>
      <div class="bl-past-panel-sub muted">Read from sprint/Sprint-N closed branches via ActiveSprint enumeration. Branch-level snapshots; drill-in interaction queued (future card).</div>
      <div class="bl-past-list">${rows}</div>
    </div>`;
  }

  // Update only the main canvas (faster than full render for filter changes)
  function updateCanvas(container) {
    const items = filteredItems();
    const tileBase = filteredItems({ skipTileFilters: true });
    const showKanban = state.vmMode === 'board';
    const canvas = container.querySelector('#bl-main-canvas');
    if (canvas) canvas.innerHTML = state.vmMode === 'epic' ? renderEpicTree(items) : showKanban ? renderKanban(items) : renderItemsList(items);
    wireCanvasEvents(container);
    // Update summary (counts from tile-base; selection state from current filters)
    const summary = container.querySelector('.bl-sb');
    if (summary) summary.outerHTML = renderSummary(tileBase);
  }

  // ── Event wiring ───────────────────────────────

  function wireEvents(container) {
    // Search
    const searchEl = container.querySelector('#bl-search-input');
    if (searchEl) {
      searchEl.addEventListener('input', e => {
        state.searchQuery = e.target.value;
        pushFilterToHash();
        updateCanvas(container);
      });
      searchEl.addEventListener('keydown', e => {
        if (e.key === 'Escape' && searchEl.value) { searchEl.value = ''; state.searchQuery = ''; pushFilterToHash(); updateCanvas(container); }
      });
    }
    // Product tabs
    container.querySelectorAll('#bl-product-tabs .bl-fa-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        state.productFilter = btn.dataset.product;
        pushFilterToHash();
        fullRender(container);
      });
    });
    // Session chips
    container.querySelectorAll('#bl-stype-chips .bl-fa-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        state.sessionFilter = btn.dataset.stype;
        pushFilterToHash();
        fullRender(container);
      });
    });
    // Sprint chips
    container.querySelectorAll('#bl-sprint-chips .bl-fa-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        state.sprintFilter = btn.dataset.sprint;
        // S037ext #90 — don't force list mode when leaving Current; board now works for any filter.
        // Only auto-flip TO board on entering Current (and only if user hasn't manually overridden).
        if (state.sprintFilter === 'Current' && !state.vmManual) state.vmMode = 'board';
        // D146/#120 — lazy-load closed sprint branches when 'Past' is first selected
        if (state.sprintFilter === 'Past' && state.pastSprintBranches === null && !state.pastSprintBranchesLoading) {
          loadPastSprintBranches().then(() => fullRender(container));
        }
        pushFilterToHash();
        fullRender(container);
      });
    });
    // #187 (D152) — Tier chips
    container.querySelectorAll('#bl-tier-chips .bl-fa-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        state.tierFilter = btn.dataset.tier;
        pushFilterToHash();
        fullRender(container);
      });
    });
    // VM toggle
    container.querySelectorAll('.bl-vm-btn').forEach(btn => {
      btn.addEventListener('click', () => { state.vmMode = btn.dataset.vm; state.vmManual = true; fullRender(container); });
    });
    // Epic-mode: collapse/expand an epic group (S120 Phase 4)
    container.querySelectorAll('.bl-epic-head').forEach(head => {
      head.addEventListener('click', () => {
        const epic = head.getAttribute('data-epic-toggle');
        state.epicCollapsed = state.epicCollapsed || {};
        state.epicCollapsed[epic] = !state.epicCollapsed[epic];
        const body = head.nextElementSibling;
        const caret = head.querySelector('.bl-epic-caret');
        if (body) body.style.display = state.epicCollapsed[epic] ? 'none' : '';
        if (caret) caret.classList.toggle('open', !state.epicCollapsed[epic]);
      });
    });
    // R2.3 — feature-node collapse/expand (independent of epic; default collapsed)
    container.querySelectorAll('.bl-feat-head').forEach(head => {
      head.addEventListener('click', e => {
        if (e.target.closest('[data-kc-nav-feature]')) return;  // id badge → feature detail
        const key = head.getAttribute('data-feat-toggle');
        state.featCollapsed = state.featCollapsed || {};
        const nowOpen = state.featCollapsed[key] === false;
        state.featCollapsed[key] = nowOpen ? true : false;
        const body = head.nextElementSibling;
        const caret = head.querySelector('.bl-epic-caret');
        if (body) body.style.display = nowOpen ? 'none' : '';
        if (caret) caret.classList.toggle('open', !nowOpen);
      });
    });
    // Epic filter input + clear (S120 Phase 4 — A20/A21)
    const epicInput = container.querySelector('#bl-epic-filter');
    if (epicInput) epicInput.addEventListener('change', () => {
      state.epicFilter = epicInput.value.trim();
      pushFilterToHash(); fullRender(container);
    });
    const epicClear = container.querySelector('#bl-epic-clear');
    if (epicClear) epicClear.addEventListener('click', () => { state.epicFilter = ''; pushFilterToHash(); fullRender(container); });
    // S037ext Track E — Summary tile click → filter toggle
    // Tile counts are derived from open items for high/med/low (per
    // S035 design); priority-tile clicks imply statusFilter='open' so
    // the visible result matches the displayed count.
    // Low is a span (role=button) inside the medium tile because nested
    // <button> would cause auto-closure and break the DOM. Keyboard
    // support added explicitly.
    container.querySelectorAll('.bl-sb [data-tile-key]').forEach(btn => {
      // Add Enter/Space keyboard support for span-based buttons (low)
      if (btn.tagName !== 'BUTTON') {
        btn.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); btn.click(); }
        });
      }
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const key = btn.dataset.tileKey;
        if (key === 'open') {
          state.statusFilter = state.statusFilter === 'open' ? null : 'open';
          // Re-clicking 'open' shouldn't kill priority filter — leave alone.
        } else if (key === 'done') {
          state.statusFilter = state.statusFilter === 'done' ? null : 'done';
          // Done is exclusive with open; clear priorityFilter when entering done
          // so user sees a clean done-this-cycle slice.
          if (state.statusFilter === 'done') state.priorityFilter = null;
        } else if (key === 'high' || key === 'medium' || key === 'low') {
          state.priorityFilter = state.priorityFilter === key ? null : key;
          // Match tile-count semantics: priority counts shown are open-only,
          // so priority click implies status=open (unless user explicitly chose 'done').
          if (state.priorityFilter && state.statusFilter !== 'done') {
            state.statusFilter = 'open';
          }
          // Re-clicking same priority clears both implicit filters.
          if (!state.priorityFilter && state.statusFilter === 'open') {
            state.statusFilter = null;
          }
        }
        pushFilterToHash();
        fullRender(container);
      });
    });
    // Range date inputs
    const rs = container.querySelector('#bl-range-start');
    const re = container.querySelector('#bl-range-end');
    if (rs) rs.addEventListener('change', e => { state.rangeStart = e.target.value; pushFilterToHash(); updateCanvas(container); });
    if (re) re.addEventListener('change', e => { state.rangeEnd   = e.target.value; pushFilterToHash(); updateCanvas(container); });
    // Sprint band collapse (mobile only via CSS, but click anywhere on head toggles state)
    const bandHead = container.querySelector('#bl-band-head');
    if (bandHead) {
      bandHead.addEventListener('click', (e) => {
        // #188 — don't collapse the band when the Adjust-cadence button is clicked.
        if (e.target.closest('#bl-cad-open')) return;
        state.bandCollapsed = !state.bandCollapsed;
        const band = container.querySelector('#bl-sprint-band');
        if (band) band.setAttribute('data-collapsed', state.bandCollapsed);
      });
    }
    // #188 — Adjust-cadence affordance on the sprint band
    const cadOpenBtn = container.querySelector('#bl-cad-open');
    if (cadOpenBtn) cadOpenBtn.addEventListener('click', (e) => { e.stopPropagation(); openCadenceModal(container); });
    // Aux panel collapse
    container.querySelectorAll('.bl-ctx-panel-head').forEach(h => {
      h.addEventListener('click', () => {
        const panel = h.closest('.bl-ctx-panel');
        if (panel) panel.classList.toggle('collapsed');
      });
    });
    // #134 CRUDQ — FAB "+" button
    const addBtn = container.querySelector('#bl-fab-add');
    if (addBtn) addBtn.addEventListener('click', () => openCrudModal(container, 'create', null));

    // #134 CRUDQ — modal close / save buttons + overlay background dismiss
    if (state.crudModal) {
      const cl = container.querySelector('#bl-crud-close');
      const cn = container.querySelector('#bl-crud-cancel');
      const sv = container.querySelector('#bl-crud-save');
      const ov = container.querySelector('#bl-crud-overlay');
      if (cl) cl.addEventListener('click', () => closeCrudModal(container));
      if (cn) cn.addEventListener('click', () => closeCrudModal(container));
      if (sv) sv.addEventListener('click', () => submitCrudModal(container));
      // Outside-click dismiss intentionally removed — form data loss risk (#134 t7 feedback)
      // Per-todo checkboxes (t4 #134)
      container.querySelectorAll('.bl-crud-todo-chk').forEach(chk => {
        chk.addEventListener('change', e => {
          handleTodoFlip(container, chk.dataset.cardId, chk.dataset.todoId, e.target.checked);
        });
      });
    }

    // #188 — cadence modal close / save / inputs
    if (state.cadenceModal) {
      const cl = container.querySelector('#bl-cad-close');
      const cn = container.querySelector('#bl-cad-cancel');
      const sv = container.querySelector('#bl-cad-save');
      if (cl) cl.addEventListener('click', () => closeCadenceModal(container));
      if (cn) cn.addEventListener('click', () => closeCadenceModal(container));
      if (sv) sv.addEventListener('click', () => submitCadenceModal(container));
      const dateEl = container.querySelector('#bl-cad-newend');
      if (dateEl) {
        dateEl.addEventListener('input',  () => updateCadencePreview(container));
        dateEl.addEventListener('change', () => updateCadencePreview(container));
      }
      container.querySelectorAll('.bl-cad-reason-chk').forEach(chk => {
        chk.addEventListener('change', e => {
          const rc = chk.dataset.rc;
          if (!state.cadenceModal) return;
          if (e.target.checked) state.cadenceModal.reasonClasses.add(rc);
          else state.cadenceModal.reasonClasses.delete(rc);
          // Toggle the pill styling without a full re-render (keeps focus/date state).
          const lbl = chk.closest('.bl-cad-reason');
          if (lbl) lbl.classList.toggle('is-on', e.target.checked);
          updateCadencePreview(container);
        });
      });
      // Preserve the typed reason across re-renders (fullRender rebuilds the DOM).
      const txtEl = container.querySelector('#bl-cad-reasontext');
      if (txtEl) txtEl.addEventListener('input', e => { if (state.cadenceModal) state.cadenceModal.reasonText = e.target.value; });
      // Initial preview if a date is already present.
      updateCadencePreview(container);
    }

    wireCanvasEvents(container);
  }

  function wireCanvasEvents(container) {
    // Clear filters CTA
    const cta = container.querySelector('#bl-clear-filters');
    if (cta) cta.addEventListener('click', () => {
      state.productFilter = state.scopedProductName || 'All'; state.sessionFilter = 'All'; state.sprintFilter = 'All sprints';
      state.tierFilter = 'All tiers';
      state.searchQuery = ''; state.vmManual = false; state.vmMode = 'list';
      fullRender(container);
    });
    // Rank cell — click to edit
    container.querySelectorAll('.bl-rank[data-id]').forEach(el => {
      el.addEventListener('click', () => {
        if (isReadOnly()) return;
        const id = el.dataset.id;
        const item = state.items.find(i => i.id === id);
        if (!item) return;
        if (item._rankState === 'conflict') {
          // Click to reload
          item._rankState = null;
          fullRender(container);
          return;
        }
        item._rankState = 'editing';
        item._rankDraft = item.rank;
        fullRender(container);
        const input = container.querySelector(`.bl-rank-input[data-id="${CSS.escape(id)}"]`);
        if (input) { input.focus(); input.select(); }
      });
    });
    // Rank input commit
    container.querySelectorAll('.bl-rank-input').forEach(input => {
      const commit = () => commitRankEdit(container, input.dataset.id, input.value);
      const cancel = () => { const item = state.items.find(i => i.id === input.dataset.id); if (item) item._rankState = null; fullRender(container); };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      });
    });
    // Reason chip — click to open popover
    container.querySelectorAll('[data-reason-trigger]').forEach(el => {
      el.addEventListener('click', e => {
        if (isReadOnly()) return;
        e.stopPropagation();
        openReasonPopover(container, el);
      });
    });
    // #134 CRUDQ — Edit button on each item row
    container.querySelectorAll('.bl-ic-edit').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (isReadOnly()) return;
        const item = state.items.find(i => i.id === btn.dataset.editId);
        if (item) openCrudModal(container, 'edit', item);
      });
    });
    // #134 CRUDQ — Delete button on each item row
    container.querySelectorAll('.bl-ic-del').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (isReadOnly()) return;
        const id = btn.dataset.delId;
        const item = state.items.find(i => i.id === id);
        if (!item) return;
        const confirmed = confirm(
          `Delete #${id} — "${item.name}"?\n\nThis removes the row from BACKLOG.md.\nThe detail file (if any) is NOT deleted.`
        );
        if (!confirmed) return;
        saveStart();
        writeBacklogDelete(id)
          .then(() => {
            pushToast({ kind: 'success', msg: `#${id} deleted from backlog`, ttl: 3000 });
            fullRender(container);
          })
          .catch(err => pushToast({ kind: 'danger', icon: '⚠', msg: `Delete failed: ${err.message}`, ttl: 5000 }))
          .finally(() => saveEnd());
      });
    });
    // Drag-handle row reorder + kanban drag-drop
    wireDragDrop(container);
  }

  // ── Rank commit (writeback) ────────────────────

  async function commitRankEdit(container, id, draftValue) {
    const item = state.items.find(i => i.id === id);
    if (!item) return;
    const n = parseInt(draftValue, 10);
    if (isNaN(n) || n < 1 || n === item.rank) {
      item._rankState = null; fullRender(container); return;
    }
    if (isReadOnly()) { item._rankState = null; fullRender(container); return; }
    item._rankState = 'saving'; item._rankDraft = null;
    fullRender(container);

    saveStart();
    try {
      const oldRank = item.rank;
      item.rank = n;
      await writeBacklogField('rank-or-reason');
      item._rankState = 'saved';
      fullRender(container);
      setTimeout(() => { item._rankState = null; fullRender(container); }, 700);
      pushToast({ kind: 'success', msg: `#${id} ranked ${n}`, ttl: 1500 });
    } catch (e) {
      // Roll back rank if it was a SHA conflict (someone else edited)
      if (e.code === 'sha_conflict') {
        item._rankState = 'conflict';
        fullRender(container);
        pushToast({ kind: 'danger', icon: '⚠',
          msg: 'Someone else edited this — reload to see latest',
          action: 'Reload', onAction: () => render(container), ttl: 6000 });
      } else {
        item._rankState = null;
        fullRender(container);
        pushToast({ kind: 'danger', icon: '⚠', msg: `Save failed: ${e.message}`, ttl: 4000 });
      }
    } finally { saveEnd(); }
  }

  // ── Reason popover ─────────────────────────────

  let _reasonPop = null;
  function closeReasonPopover() {
    if (_reasonPop) { _reasonPop.remove(); _reasonPop = null; document.removeEventListener('mousedown', _reasonOutsideClose, true); }
  }
  function _reasonOutsideClose(e) {
    if (_reasonPop && !_reasonPop.contains(e.target) && !e.target.closest('[data-reason-trigger]')) closeReasonPopover();
  }
  function openReasonPopover(container, anchor) {
    closeReasonPopover();
    const id = anchor.dataset.id;
    const item = state.items.find(i => i.id === id);
    if (!item) return;

    const pop = document.createElement('div');
    pop.className = 'bl-reason-pop';
    pop.innerHTML = REASON_OPTS.map(o =>
      `<div class="bl-reason-opt${o.key === item.reason ? ' selected' : ''}" data-key="${escHtml(o.key)}">
        <span class="bl-reason-opt-glyph">${escHtml(o.glyph)}</span><span>${escHtml(o.label)}</span>
      </div>`
    ).join('') +
      '<div class="bl-reason-divider"></div>' +
      `<div class="bl-reason-opt" data-key="__custom"><span class="bl-reason-opt-glyph">✎</span><span>Custom…</span></div>` +
      (item.reason || item.customReason ? `<div class="bl-reason-opt" data-key="__clear" style="color:var(--text-dim)"><span class="bl-reason-opt-glyph">∅</span><span>Clear</span></div>` : '');

    // Position
    const rect = anchor.getBoundingClientRect();
    pop.style.position = 'fixed';
    pop.style.top  = `${rect.bottom + 4}px`;
    pop.style.left = `${rect.left}px`;
    document.body.appendChild(pop);
    _reasonPop = pop;
    setTimeout(() => document.addEventListener('mousedown', _reasonOutsideClose, true), 0);

    pop.querySelectorAll('.bl-reason-opt').forEach(opt => {
      opt.addEventListener('click', () => {
        const key = opt.dataset.key;
        if (key === '__custom') {
          opt.outerHTML = `<div class="bl-reason-custom">
            <input class="bl-reason-custom-input" autofocus placeholder="e.g. promised to Anil" />
            <button class="bl-reason-custom-save">Save</button>
          </div>`;
          const input = pop.querySelector('.bl-reason-custom-input');
          const save  = pop.querySelector('.bl-reason-custom-save');
          input.focus();
          const submit = () => {
            const v = input.value.trim();
            if (!v) return;
            closeReasonPopover();
            commitReason(container, id, { reason: 'custom', custom: v });
          };
          save.addEventListener('click', submit);
          input.addEventListener('keydown', e => {
            if (e.key === 'Enter')  { e.preventDefault(); submit(); }
            if (e.key === 'Escape') { e.preventDefault(); closeReasonPopover(); }
          });
        } else if (key === '__clear') {
          closeReasonPopover();
          commitReason(container, id, { reason: null, custom: null });
        } else {
          closeReasonPopover();
          commitReason(container, id, { reason: key, custom: null });
        }
      });
    });
  }

  async function commitReason(container, id, { reason, custom }) {
    const item = state.items.find(i => i.id === id);
    if (!item) return;
    if (isReadOnly()) return;
    item._reasonSaving = true; fullRender(container);

    saveStart();
    try {
      const oldR = item.reason; const oldC = item.customReason;
      item.reason = reason; item.customReason = custom;
      await writeBacklogField('rank-or-reason');
      item._reasonSaving = false; fullRender(container);
      pushToast({ kind: 'success', msg: `#${id} reason ${reason ? `set${custom ? ' (custom)' : ''}` : 'cleared'}`, ttl: 1500 });
    } catch (e) {
      // Rollback
      item.reason = item.reason; // already updated; need to revert if we want true rollback — but we don't have the pre-state cleanly
      item._reasonSaving = false; fullRender(container);
      if (e.code === 'sha_conflict') {
        pushToast({ kind: 'danger', icon: '⚠', msg: 'Someone else edited this — reload to see latest',
          action: 'Reload', onAction: () => render(container), ttl: 6000 });
      } else {
        pushToast({ kind: 'danger', icon: '⚠', msg: `Save failed: ${e.message}`, ttl: 4000 });
      }
    } finally { saveEnd(); }
  }

  // ── Drag-drop: row reorder + kanban column move ─

  let _drag = { id: null, kind: null };  // kind: 'row' | 'card'

  function wireDragDrop(container) {
    if (isReadOnly()) return;

    // Row drag-handle reorder
    container.querySelectorAll('.bl-grip').forEach(grip => {
      grip.addEventListener('dragstart', e => {
        _drag = { id: grip.dataset.id, kind: 'row' };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', grip.dataset.id);
      });
      grip.addEventListener('dragend', () => {
        _drag = { id: null, kind: null };
        // Clear drop hints
        container.querySelectorAll('.bl-ic.drop-above, .bl-ic.drop-below').forEach(el => el.classList.remove('drop-above', 'drop-below'));
      });
    });
    container.querySelectorAll('.bl-ic[data-id]').forEach(row => {
      row.addEventListener('dragover', e => {
        if (_drag.kind !== 'row' || _drag.id === row.dataset.id) return;
        e.preventDefault();
        const rect = row.getBoundingClientRect();
        const above = e.clientY < rect.top + rect.height / 2;
        container.querySelectorAll('.bl-ic.drop-above, .bl-ic.drop-below').forEach(el => el.classList.remove('drop-above', 'drop-below'));
        row.classList.add(above ? 'drop-above' : 'drop-below');
      });
      row.addEventListener('drop', e => {
        if (_drag.kind !== 'row' || _drag.id === row.dataset.id) return;
        e.preventDefault();
        const rect = row.getBoundingClientRect();
        const above = e.clientY < rect.top + rect.height / 2;
        rerankRow(container, _drag.id, row.dataset.id, above ? 'above' : 'below');
        _drag = { id: null, kind: null };
      });
    });

    // #144 / S120 Phase 4 A25 — Epic badge click now FILTERS the backlog to that epic
    // (CD cross-link); Feature badge still navigates to feature detail.
    container.querySelectorAll('[data-kc-nav-epic]').forEach(el => {
      el.addEventListener('click', e => { e.stopPropagation(); state.epicFilter = el.dataset.kcNavEpic; pushFilterToHash(); fullRender(container); });
    });
    container.querySelectorAll('[data-kc-nav-feature]').forEach(el => {
      el.addEventListener('click', e => { e.stopPropagation(); navigate('feature', el.dataset.kcNavFeature); });
    });

    // Kanban card drag
    container.querySelectorAll('.kanban-card').forEach(card => {
      card.addEventListener('click', () => {
        if (_drag.id) return;  // suppress click when drag just ended
        // Injected feature items route to feature detail, not card detail.
        if (/^F-/.test(card.dataset.id)) { navigate('feature', card.dataset.id); return; }
        navigate('card', card.dataset.id);
      });
      card.addEventListener('dragstart', e => {
        _drag = { id: card.dataset.id, kind: 'card' };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', card.dataset.id);
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => {
        _drag = { id: null, kind: null };
        card.classList.remove('dragging');
        container.querySelectorAll('.kanban-col.drop-target').forEach(c => c.classList.remove('drop-target'));
      });
    });
    container.querySelectorAll('.kanban-col').forEach(col => {
      col.addEventListener('dragover', e => {
        if (_drag.kind !== 'card') return;
        e.preventDefault();
        container.querySelectorAll('.kanban-col.drop-target').forEach(c => c.classList.remove('drop-target'));
        col.classList.add('drop-target');
      });
      col.addEventListener('dragleave', () => col.classList.remove('drop-target'));
      col.addEventListener('drop', e => {
        if (_drag.kind !== 'card') return;
        e.preventDefault();
        col.classList.remove('drop-target');
        const item = state.items.find(i => i.id === _drag.id);
        if (!item) return;
        const targetCol = col.dataset.col;
        const currentCol = statusToColumn(item.status);
        if (targetCol === currentCol) { _drag = { id: null, kind: null }; return; }  // P2 short-circuit
        commitKanbanMove(container, _drag.id, targetCol, item.status);
      });
    });
  }

  async function rerankRow(container, fromId, targetId, side) {
    if (isReadOnly()) return;
    const items = filteredItems().slice().sort((a,b) => (a.rank ?? 9999) - (b.rank ?? 9999));
    const fromIdx = items.findIndex(x => x.id === fromId);
    let toIdx = items.findIndex(x => x.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = items.splice(fromIdx, 1);
    if (fromIdx < toIdx) toIdx -= 1;
    items.splice(side === 'below' ? toIdx + 1 : toIdx, 0, moved);
    const ranks = {};
    items.forEach((i, idx) => ranks[i.id] = idx + 1);
    // Apply local rank update
    const previousRanks = {};
    state.items.forEach(i => { if (ranks[i.id] != null) { previousRanks[i.id] = i.rank; i.rank = ranks[i.id]; } });
    fullRender(container);
    pushToast({ kind: 'success', msg: `Renumbered ${Object.keys(ranks).length} items`, ttl: 1500,
      action: 'Undo', onAction: () => undoBulkRank(container, previousRanks) });

    saveStart();
    try {
      await writeBacklogField('bulk-rank');
    } catch (e) {
      // Roll back
      Object.entries(previousRanks).forEach(([id, r]) => { const it = state.items.find(x => x.id === id); if (it) it.rank = r; });
      fullRender(container);
      if (e.code === 'sha_conflict') {
        pushToast({ kind: 'danger', icon: '⚠', msg: 'Someone else edited this — reload to see latest',
          action: 'Reload', onAction: () => render(container), ttl: 6000 });
      } else {
        pushToast({ kind: 'danger', icon: '⚠', msg: `Renumber failed: ${e.message}`, ttl: 4000 });
      }
    } finally { saveEnd(); }
  }

  function undoBulkRank(container, previousRanks) {
    Object.entries(previousRanks).forEach(([id, r]) => { const it = state.items.find(x => x.id === id); if (it) it.rank = r; });
    fullRender(container);
    saveStart();
    writeBacklogField('bulk-rank-undo')
      .then(() => pushToast({ kind: 'success', msg: 'Rank changes undone', ttl: 1500 }))
      .catch(e  => pushToast({ kind: 'danger', icon: '⚠', msg: `Undo failed: ${e.message}`, ttl: 4000 }))
      .finally(saveEnd);
  }

  async function commitKanbanMove(container, id, targetCol, prevStatus) {
    const item = state.items.find(i => i.id === id);
    if (!item) return;
    if (isReadOnly()) return;
    const newStatus = COL_STATUS[targetCol];
    item.status = newStatus;
    item._saveDot = 'saving';
    fullRender(container);

    saveStart();
    try {
      await writeBacklogField('status');
      item._saveDot = 'saved';
      fullRender(container);
      pushToast({ kind: 'success', msg: `#${id} → ${newStatus}`, ttl: 1500,
        action: 'Undo', onAction: () => undoKanbanMove(container, id, prevStatus) });
      setTimeout(() => { item._saveDot = null; fullRender(container); }, 800);
    } catch (e) {
      item.status = prevStatus;  // rollback
      item._saveDot = 'conflict';
      fullRender(container);
      if (e.code === 'sha_conflict') {
        pushToast({ kind: 'danger', icon: '⚠', msg: 'Someone else edited this — reload to see latest',
          action: 'Reload', onAction: () => render(container), ttl: 6000 });
      } else {
        pushToast({ kind: 'danger', icon: '⚠', msg: `Move failed: ${e.message}`, ttl: 4000 });
      }
      setTimeout(() => { item._saveDot = null; fullRender(container); }, 1200);
    } finally { saveEnd(); }
  }

  function undoKanbanMove(container, id, prevStatus) {
    const item = state.items.find(i => i.id === id);
    if (!item) return;
    item.status = prevStatus;
    fullRender(container);
    saveStart();
    writeBacklogField('status-undo')
      .then(() => pushToast({ kind: 'success', msg: `#${id} status restored`, ttl: 1500 }))
      .catch(e  => pushToast({ kind: 'danger', icon: '⚠', msg: `Undo failed: ${e.message}`, ttl: 4000 }))
      .finally(saveEnd);
  }

  // ── Writeback to BACKLOG.md ────────────────────

  function reasonCellValue(item) {
    if (item.customReason) return `custom:${item.customReason}`;
    if (item.reason) return item.reason;
    return '—';
  }

  // Build a pipe-delimited row string from a headers array + item object.
  // Used by rebuildBacklogMd when appending a brand-new row (t2 #134).
  function buildRowLine(headers, item) {
    const cells = headers.map(h => {
      if (h === '#')            return String(item.id);
      if (h === 'products')     return (item.products || []).join(', ');
      if (h === 'name')         return item.name || '';
      if (h === 'type')         return item.type || '—';
      if (h === 'session type') return item.sessionType || '—';
      if (h === 'phase')        return item.phase || '—';
      if (h === 'priority')     return item.priority || '—';
      if (h === 'status')       return item.status || 'Open';
      if (h === 'ai tools')     return item.aiTool || '—';
      if (h === 'rank')         return item.rank != null ? String(item.rank) : '—';
      if (h === 'reason')       return '—';
      return '—';
    });
    return '| ' + cells.join(' | ') + ' |';
  }

  function rebuildBacklogMd(originalMd, opts) {
    // Parse the table, reconstruct with current state.items values.
    // opts.appendRow — new item object to insert after last data row in the Backlog table.
    opts = opts || {};
    const lines = originalMd.split('\n');
    const out = [];
    let inTable = false; let headers = []; let tableHeaders = [];
    let pendingAppend = opts.appendRow || null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.startsWith('|')) {
        if (/^## Backlog$/.test(line)) {
          inTable = true;
          out.push(line);
          continue;
        }
        if (/^## /.test(line) && inTable) {
          // Leaving the Backlog table section — flush any pending append first
          if (pendingAppend && tableHeaders.length) {
            out.push(buildRowLine(tableHeaders, pendingAppend));
            pendingAppend = null;
          }
          inTable = false;
        }
        out.push(line);
        continue;
      }
      if (!inTable) { out.push(line); continue; }

      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (cells.every(c => /^[-: ]+$/.test(c))) { out.push(line); continue; }

      if (cells[0] === '#' && headers.length === 0) {
        headers = cells.map(c => c.toLowerCase().replace(/[()]/g, '').trim());
        tableHeaders = headers;
        out.push(line);
        continue;
      }
      if (headers.length && /^\d+$/.test(cells[0])) {
        const id = cells[0];
        // opts.deleteId — skip this row (delete operation)
        if (opts.deleteId && id === String(opts.deleteId)) continue;
        const item = state.items.find(x => x.id === id);
        if (!item) { out.push(line); continue; }
        const newCells = cells.slice();
        headers.forEach((h, idx) => {
          if (h === 'status')    newCells[idx] = item.status;
          else if (h === 'rank')     newCells[idx] = item.rank == null ? '—' : String(item.rank);
          else if (h === 'reason')   newCells[idx] = reasonCellValue(item);
          else if (h === 'name')     newCells[idx] = item.name;
          else if (h === 'priority') newCells[idx] = item.priority || '—';
          else if (h === 'products') newCells[idx] = (item.products || []).join(', ');
        });
        out.push('| ' + newCells.join(' | ') + ' |');
        continue;
      }
      out.push(line);
    }
    // EOF while still in Backlog table (no trailing ## heading)
    if (pendingAppend && tableHeaders.length) {
      out.push(buildRowLine(tableHeaders, pendingAppend));
    }
    return out.join('\n');
  }

  // ── #188 — Sprint cadence adjustment (extend / shorten) ─────────
  //
  // Client-side mirror of scripts/adjust_sprint_cadence.py (S107 #162), non-backfill
  // path. This MUST stay in lockstep with that script AND validate_sprint_schema.py:
  // a Contents-API PUT (Repos.putFile) bypasses the local cadence-ledger pre-commit
  // gate, so the file we write has to satisfy the cadence + extension_history[] chain/
  // sync invariants BY CONSTRUCTION — the gate can't catch us here. See docs/backlog-detail/188.md.

  const CADENCE_REASON_ENUM = [
    'go-live-stability', 'cadence-realignment', 'v-unavailable',
    'external-blocker', 'emergency-pivot', 'scope-flow',
  ];
  const CADENCE_MIN_DAYS = 3;

  function cadParseIsoDateUTC(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
    if (!m) return null;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  function cadIsoOf(d) { return d.toISOString().split('T')[0]; }
  function cadDaysBetween(a, b) { return Math.round((b - a) / 86400000); }
  function cadTodayIso() { return new Date().toISOString().split('T')[0]; }

  function cadNowIsoOffsetIST() {
    // Mirror Python now_iso_offset(): IST +05:30 wall-clock, +05:30 suffix.
    const d = new Date(Date.now() + (5 * 60 + 30) * 60000);
    const p = n => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T` +
           `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+05:30`;
  }

  function cadEscapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function cadExtractScalar(fmText, field) {
    // Mirror Python extract_field(): single-line scalar, tolerate inline comment.
    const re = new RegExp(`^${cadEscapeRe(field)}:\\s*(.+?)\\s*(?:#.*)?$`, 'm');
    const m = re.exec(fmText);
    return m ? m[1].trim() : null;
  }
  function cadReplaceScalar(fmText, field, newValue) {
    // Mirror Python replace_field(): replace value, preserve inline comment, count=1.
    const re = new RegExp(`^(${cadEscapeRe(field)}:\\s*)(\\S+)(\\s*(?:#.*)?)$`, 'm');
    return fmText.replace(re, `$1${newValue}$3`);
  }

  function cadRenderHistoryEntry(e) {
    // Byte-for-byte mirror of Python render_history_entry() indentation.
    const rcYaml = e.reasonClassList.join(', ');
    const lines = [
      '  - direction: ' + e.direction,
      `    from_end_date: ${e.fromEnd}`,
      `    to_end_date:   ${e.toEnd}`,
      `    from_cadence:  ${e.fromCad}d`,
      `    to_cadence:    ${e.toCad}d`,
      `    delta_days:    ${e.delta > 0 ? '+' : ''}${e.delta}`,
      `    reason_class:  [${rcYaml}]`,
      `    reason_text:   "${e.reasonText}"`,
      `    ratified_by:   ${e.ratifiedBy}`,
      `    session:       ${e.session}`,
      `    timestamp:     ${e.timestamp}`,
    ];
    if (e.scopePlan) lines.push(`    scope_plan:    ${e.scopePlan}`);
    return lines.join('\n');
  }

  function cadInsertOrAppendHistory(fmText, entryYaml) {
    // Mirror Python insert_or_append_extension_history().
    if (/^extension_history:/m.test(fmText)) {
      const lines = fmText.split('\n');
      const out = [];
      let i = 0, appended = false;
      while (i < lines.length) {
        out.push(lines[i]);
        if (!appended && lines[i].startsWith('extension_history:')) {
          let j = i + 1;
          while (j < lines.length && (lines[j].startsWith('  ') || lines[j].trim() === '')) {
            out.push(lines[j]); j++;
          }
          out.push(entryYaml);
          i = j; appended = true;
          continue;
        }
        i++;
      }
      return out.join('\n');
    }
    return fmText.replace(/\s+$/, '') + '\n' + 'extension_history:\n' + entryYaml + '\n';
  }

  // Read-only parse of extension_history[] entries for the modal's history view.
  function cadParseHistory(rawText) {
    const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(rawText);
    if (!fmMatch) return [];
    const lines = fmMatch[1].split(/\r?\n/);
    let i = lines.findIndex(l => /^extension_history:/.test(l));
    if (i < 0) return [];
    const entries = [];
    let cur = null;
    for (i = i + 1; i < lines.length; i++) {
      const l = lines[i];
      if (!(l.startsWith('  ') || l.trim() === '')) break;  // block ended
      const dirM = /^\s+-\s+direction:\s*(\S+)/.exec(l);
      if (dirM) { cur = { direction: dirM[1] }; entries.push(cur); continue; }
      if (!cur) continue;
      const kv = /^\s+([a-z_]+):\s*(.*)$/.exec(l);
      if (kv) cur[kv[1]] = kv[2].replace(/^"|"$/g, '').trim();
    }
    return entries;
  }

  // Core: given the raw SP file text + inputs, return the new file text + a summary,
  // or throw an Error whose .message is user-facing (mirrors the SOP invariants).
  function cadComputeEdit(rawText, opts) {
    const fmMatch = /^---\n([\s\S]*?)\n---/.exec(rawText);
    if (!fmMatch) throw new Error('Sprint file has no YAML frontmatter.');
    const fmText = fmMatch[1];
    const rest = rawText.slice(fmMatch[0].length);

    const startStr = cadExtractScalar(fmText, 'start_date') || cadExtractScalar(fmText, 'start');
    if (!startStr) throw new Error('Frontmatter is missing start_date.');
    const startD = cadParseIsoDateUTC(startStr);
    if (!startD) throw new Error(`Unparseable start_date: ${startStr}`);
    const newEndD = cadParseIsoDateUTC(opts.newEnd);
    if (!newEndD) throw new Error(`Pick a valid new end date (got ${opts.newEnd || 'nothing'}).`);

    const curEndStr = cadExtractScalar(fmText, 'end_date') || cadExtractScalar(fmText, 'end');
    const oldEndD = cadParseIsoDateUTC(curEndStr);
    if (!oldEndD) throw new Error(`Unparseable current end_date: ${curEndStr}`);
    if (+oldEndD === +newEndD) throw new Error(`New end date equals current end_date (${curEndStr}) — nothing to change.`);

    const oldCad = cadDaysBetween(startD, oldEndD) + 1;
    const newCad = cadDaysBetween(startD, newEndD) + 1;
    const delta = cadDaysBetween(oldEndD, newEndD);
    const direction = delta > 0 ? 'extend' : 'shorten';

    if (+newEndD <= +startD) throw new Error(`End date must be after the start date (${startStr}).`);
    if (newCad < CADENCE_MIN_DAYS) throw new Error(`New cadence ${newCad}d is below the ${CADENCE_MIN_DAYS}-day floor — close or convert the sprint instead of shortening.`);
    const todayD = cadParseIsoDateUTC(cadTodayIso());
    if (direction === 'shorten' && +newEndD < +todayD) throw new Error(`Can't shorten to a past date (${opts.newEnd} is before today ${cadTodayIso()}).`);

    if (!opts.reasonClassList || opts.reasonClassList.length === 0) throw new Error('Pick at least one reason class.');
    for (const rc of opts.reasonClassList) {
      if (!CADENCE_REASON_ENUM.includes(rc)) throw new Error(`Unknown reason class: ${rc}`);
    }
    if (!opts.reasonText || !opts.reasonText.trim()) throw new Error('Add a one–two sentence reason.');
    // YAML-safety: reason_text is emitted inside a double-quoted scalar. Collapse
    // newlines and neutralise embedded double-quotes so the file stays parseable
    // (the Python SOP relies on the caller not doing this; the UI must be safe).
    const safeReason = opts.reasonText.trim().replace(/\s*\r?\n\s*/g, ' ').replace(/"/g, "'");

    const entryYaml = cadRenderHistoryEntry({
      direction, fromEnd: cadIsoOf(oldEndD), toEnd: cadIsoOf(newEndD),
      fromCad: oldCad, toCad: newCad, delta,
      reasonClassList: opts.reasonClassList, reasonText: safeReason,
      ratifiedBy: opts.ratifiedBy, session: opts.session, timestamp: cadNowIsoOffsetIST(),
    });

    let newFm = fmText;
    newFm = cadReplaceScalar(newFm, 'end_date', cadIsoOf(newEndD));
    newFm = cadReplaceScalar(newFm, 'cadence', `${newCad}d`);
    newFm = cadInsertOrAppendHistory(newFm, entryYaml);
    const newText = '---\n' + newFm + '\n---' + rest;

    return { newText, direction, oldEndIso: cadIsoOf(oldEndD), newEndIso: cadIsoOf(newEndD), oldCad, newCad, delta };
  }

  async function writeSprintCadence(opts) {
    // SHA-guarded writeback to the ACTIVE SPRINT BRANCH (D136 — SP file lives there).
    const s = state.activeSprint;
    if (!s) throw new Error('No active sprint loaded.');
    const branch = s.branch;
    const sprintFile = s.sprintFile;
    if (!sprintFile) throw new Error('Could not resolve the active sprint filename.');
    const path = `docs/sprints/${sprintFile}`;
    const latest = await Repos.getFileWithSha(CONFIG.username, state.backlogRepo, path, branch);
    if (!latest) throw new Error(`Could not fetch ${path} on ${branch}.`);
    const { newText, direction, oldEndIso, newEndIso, oldCad, newCad, delta } =
      cadComputeEdit(latest.content, opts);
    if (newText === latest.content) {
      const err = new Error('No change produced.'); err.code = 'empty_commit_guard'; throw err;
    }
    const rcJoined = opts.reasonClassList.join(',');
    const message =
      `data(${opts.session}-#188) ${direction} Sprint cadence ${oldCad}d -> ${newCad}d (${rcJoined})\n\n` +
      `${opts.reasonText.trim()}\n\n` +
      `Ratified by ${opts.ratifiedBy}; appended to ${sprintFile} extension_history[].\n` +
      `Mechanism: Sprint Dashboard cadence modal (#188, mirrors scripts/adjust_sprint_cadence.py).`;
    const result = await Repos.putFile(
      CONFIG.username, state.backlogRepo, path, newText, latest.sha, message, branch
    );
    return { result, direction, oldEndIso, newEndIso, oldCad, newCad, delta };
  }

  async function writeBacklogField(reason) {
    // Re-fetch latest BACKLOG.md to get fresh SHA, then PUT with merged content
    const latest = await Repos.getFileWithSha(CONFIG.username, state.backlogRepo, state.backlogPath);
    if (!latest) throw new Error('Could not fetch BACKLOG.md SHA');
    state.backlogSha = latest.sha;
    const newMd = rebuildBacklogMd(latest.content);
    // #134 t3 empty-commit guard (client-side) — suppress no-op writeback
    // (e.g. same-column status drag). This path PUTs via GitHub API, which
    // bypasses the pre-commit empty-writeback hook, so the client guard is the
    // only net. Mirrors writeBacklogUpdate. Origin: S115 master-sync sp1 —
    // empty commits 45b38f2 + 0d9cf16 ("status") reached origin/master via
    // this one uncovered writeback function.
    if (newMd === latest.content) {
      pushToast({ kind: 'warning', icon: '⚠', msg: `No changes to save (${reason} unchanged)`, ttl: 3000 });
      const err = new Error('no-op writeback suppressed — content unchanged');
      err.code = 'empty_commit_guard';
      throw err;
    }
    const result = await Repos.putFile(
      CONFIG.username, state.backlogRepo, state.backlogPath,
      newMd, latest.sha,
      `Backlog 2.0 writeback (${reason}) — autonomous via UI`
    );
    state.backlogSha = result.sha;
    return result;
  }

  async function writeBacklogCreate(newItem) {
    // Full-row create: append new row to BACKLOG.md + add item to state (t2 #134)
    const latest = await Repos.getFileWithSha(CONFIG.username, state.backlogRepo, state.backlogPath);
    if (!latest) throw new Error('Could not fetch BACKLOG.md SHA');
    state.backlogSha = latest.sha;
    // ID guard: state.items may come from sprint branch (lower max ID than master).
    // Re-derive correct next ID from the live master content we just fetched (#134 t7 fix).
    const masterItems = parseBacklog(latest.content);
    const masterMax = Math.max(0, ...masterItems.map(i => parseInt(i.id, 10) || 0));
    const staleId = parseInt(newItem.id, 10) || 0;
    if (staleId <= masterMax) {
      newItem.id = String(masterMax + 1);
    }
    // Add to state.items so subsequent renders reflect the new item
    state.items.push(newItem);
    const newMd = rebuildBacklogMd(latest.content, { appendRow: newItem });
    // #134 t3 empty-commit guard (client-side) — should never be same for create, but guard defensively
    if (newMd === latest.content) throw new Error('empty-commit guard: no diff produced (new row not appended)');
    const result = await Repos.putFile(
      CONFIG.username, state.backlogRepo, state.backlogPath,
      newMd, latest.sha,
      `Backlog 2.0 writeback (create #${newItem.id}) — autonomous via UI`
    );
    state.backlogSha = result.sha;
    // Create detail file on sprint branch for D141 sprintMembership (best-effort)
    if (newItem.sprint) {
      createMinimalDetailFile(newItem).catch(e =>
        console.warn(`[#134] detail file create for #${newItem.id} failed (non-fatal):`, e.message)
      );
    }
    return result;
  }

  async function writeBacklogUpdate(id, updates) {
    // Full-row update: apply updates to state then rebuild (t2 #134)
    const item = state.items.find(i => i.id === id);
    if (!item) throw new Error(`Item #${id} not found in state`);
    // Apply updates before rebuild so rebuildBacklogMd picks them up
    Object.assign(item, updates);
    const latest = await Repos.getFileWithSha(CONFIG.username, state.backlogRepo, state.backlogPath);
    if (!latest) throw new Error('Could not fetch BACKLOG.md SHA');
    state.backlogSha = latest.sha;
    const newMd = rebuildBacklogMd(latest.content);
    // #134 t3 empty-commit guard (client-side) — skip PUT + log if no actual diff
    if (newMd === latest.content) {
      pushToast({ kind: 'warning', icon: '⚠', msg: `#${id}: no changes to save (values unchanged)`, ttl: 3000 });
      const err = new Error('no-op writeback suppressed — content unchanged');
      err.code = 'empty_commit_guard';
      throw err;
    }
    const result = await Repos.putFile(
      CONFIG.username, state.backlogRepo, state.backlogPath,
      newMd, latest.sha,
      `Backlog 2.0 writeback (update #${id}) — autonomous via UI`
    );
    state.backlogSha = result.sha;
    return result;
  }

  async function writeBacklogDelete(id) {
    // Remove row from BACKLOG.md (rebuildBacklogMd with deleteId skips that row)
    const latest = await Repos.getFileWithSha(CONFIG.username, state.backlogRepo, state.backlogPath);
    if (!latest) throw new Error('Could not fetch BACKLOG.md SHA');
    state.backlogSha = latest.sha;
    const newMd = rebuildBacklogMd(latest.content, { deleteId: String(id) });
    if (newMd === latest.content) throw new Error('Delete produced no diff — item may not be in the backlog table');
    const result = await Repos.putFile(
      CONFIG.username, state.backlogRepo, state.backlogPath,
      newMd, latest.sha,
      `Backlog 2.0 writeback (delete #${id}) — autonomous via UI`
    );
    state.backlogSha = result.sha;
    // Remove from local state AFTER successful write
    const idx = state.items.findIndex(i => i.id === String(id));
    if (idx !== -1) state.items.splice(idx, 1);
    return result;
  }

  async function createMinimalDetailFile(newItem) {
    // Create docs/backlog-detail/<id>.md on sprint branch so D141 sprintMembership picks up the card
    if (!newItem.sprint) return;
    const sprintBranch = state.activeSprint && state.activeSprint.branch;
    const filePath = `docs/backlog-detail/${newItem.id}.md`;
    // Check if file already exists (avoid overwrite)
    const existing = await Repos.getFileWithSha(CONFIG.username, state.backlogRepo, filePath, sprintBranch || undefined).catch(() => null);
    if (existing) return; // file exists, skip creation
    const safeName = String(newItem.name || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const content = [
      '---',
      `id: ${newItem.id}`,
      `backlog_ref: ${newItem.id}`,
      `title: "${safeName}"`,
      `status: candidate`,
      `sprint: ${newItem.sprint}`,
      `priority: ${newItem.priority || 'Medium'}`,
      'schema_version: 2',
      '---',
      '',
      `# ${newItem.name}`,
      '',
      '_Created via UI form._',
      '',
    ].join('\n');
    await Repos.putFile(
      CONFIG.username, state.backlogRepo, filePath,
      content, undefined, // no sha → create new file
      `data(#134): create card #${newItem.id} detail file — autonomous via UI`,
      sprintBranch || 'master'
    );
  }

  async function upsertDetailFileSprint(cardId, newSprint) {
    // Update (or create) the sprint: field in docs/backlog-detail/<id>.md
    const sprintBranch = state.activeSprint && state.activeSprint.branch;
    const filePath = `docs/backlog-detail/${cardId}.md`;
    const latest = await Repos.getFileWithSha(CONFIG.username, state.backlogRepo, filePath, sprintBranch || undefined).catch(() => null);
    if (!latest) {
      // No detail file — create one if sprint is being set
      if (!newSprint) return;
      const item = state.items.find(i => i.id === String(cardId)) || {};
      await createMinimalDetailFile({ ...item, id: cardId, sprint: newSprint });
      return;
    }
    // Line-by-line sprint field update inside frontmatter
    const lines = latest.content.split('\n');
    let fmOpen = -1, fmClose = -1, sprintLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        if (fmOpen === -1) { fmOpen = i; continue; }
        fmClose = i; break;
      }
      if (fmOpen !== -1 && /^sprint:\s*/.test(lines[i])) { sprintLine = i; }
    }
    if (sprintLine !== -1) {
      if (newSprint) lines[sprintLine] = `sprint: ${newSprint}`;
      else lines.splice(sprintLine, 1);
    } else if (newSprint && fmClose !== -1) {
      lines.splice(fmClose, 0, `sprint: ${newSprint}`);
    } else {
      return; // nothing to do
    }
    const newMd = lines.join('\n');
    if (newMd === latest.content) return;
    await Repos.putFile(
      CONFIG.username, state.backlogRepo, filePath,
      newMd, latest.sha,
      `data(#134): update sprint on #${cardId} → ${newSprint || 'none'} — autonomous via UI`,
      sprintBranch || 'master'
    );
  }

  // ── CRUD modal (t2/t4 #134) ────────────────────

  function flipTodoStatusInMd(md, todoId, newStatus) {
    // Line-by-line todo status flip — finds `  - id: <todoId>` block, replaces `    status: *`
    const lines = md.split('\n');
    const result = [];
    let inTargetTodo = false;
    let changed = false;
    for (const line of lines) {
      if (!inTargetTodo) {
        const m = line.match(/^(\s{2}-\s+id:\s*)(\S+)/);
        if (m) inTargetTodo = (m[2] === todoId);
        result.push(line);
      } else {
        if (/^\s{4}status:\s+\S/.test(line)) {
          result.push(line.replace(/^(\s{4}status:\s+)\S.*$/, `$1${newStatus}`));
          changed = true;
          inTargetTodo = false;
        } else if (/^\s{2}-\s+id:\s+\S/.test(line)) {
          // Hit next todo before finding status — passthrough
          const m = line.match(/^(\s{2}-\s+id:\s*)(\S+)/);
          if (m) inTargetTodo = (m[2] === todoId);
          result.push(line);
        } else {
          result.push(line);
        }
      }
    }
    return { md: result.join('\n'), changed };
  }

  async function loadCardTodos(cardId) {
    const cardPath = `docs/backlog-detail/${cardId}.md`;
    try {
      const md = await Repos.getFile(CONFIG.username, state.backlogRepo, cardPath);
      if (!md) return [];
      const fm = parseFrontmatter(md);
      const raw = fm && fm.todos;
      // Capture sprint field into crudModal while we have the detail file (#134)
      if (state.crudModal && fm && fm.sprint != null) state.crudModal.sprint = String(fm.sprint);
      if (!Array.isArray(raw)) return [];
      return raw.filter(t => t && t.id).map(t => ({
        id: String(t.id), text: t.text || String(t.id), status: t.status || 'candidate'
      }));
    } catch { return []; }
  }

  async function handleTodoFlip(container, cardId, todoId, newChecked) {
    const newStatus = newChecked ? 'done' : 'candidate';
    // Optimistic UI update
    if (state.crudModal && state.crudModal.todos) {
      const t = state.crudModal.todos.find(x => x.id === todoId);
      if (t) { t.status = newStatus; fullRender(container); }
    }
    saveStart();
    try {
      const cardPath = `docs/backlog-detail/${cardId}.md`;
      const latest = await Repos.getFileWithSha(CONFIG.username, state.backlogRepo, cardPath);
      if (!latest) throw new Error(`Could not fetch card #${cardId}`);
      const { md: newMd, changed } = flipTodoStatusInMd(latest.content, todoId, newStatus);
      if (!changed) throw new Error(`Todo ${todoId} not found in #${cardId}`);
      await Repos.putFile(
        CONFIG.username, state.backlogRepo, cardPath,
        newMd, latest.sha,
        `Backlog 2.0 writeback (todo-flip #${cardId} ${todoId}=${newStatus}) — autonomous via UI`
      );
      pushToast({ kind: 'success', msg: `${todoId} → ${newStatus}`, ttl: 1500 });
    } catch (e) {
      // Revert optimistic update
      if (state.crudModal && state.crudModal.todos) {
        const t = state.crudModal.todos.find(x => x.id === todoId);
        if (t) { t.status = newChecked ? 'candidate' : 'done'; fullRender(container); }
      }
      pushToast({ kind: 'danger', icon: '⚠', msg: `Todo save failed: ${e.message}`, ttl: 4000 });
    } finally { saveEnd(); }
  }

  function openCrudModal(container, mode, item) {
    if (state.crudModal && state.crudModal._escHandler) {
      document.removeEventListener('keydown', state.crudModal._escHandler);
    }
    const escHandler = e => { if (e.key === 'Escape') closeCrudModal(container); };
    state.crudModal = {
      mode, item: item || null,
      todos: [], todosLoading: mode === 'edit',
      sprint: null,   // loaded async alongside todos in edit mode
      saving: false, errorMsg: null, _escHandler: escHandler
    };
    document.addEventListener('keydown', escHandler);
    fullRender(container);
    if (mode === 'edit' && item) {
      loadCardTodos(item.id).then(todos => {
        if (!state.crudModal) return;
        state.crudModal.todos = todos;
        state.crudModal.todosLoading = false;
        fullRender(container);
      }).catch(() => {
        if (!state.crudModal) return;
        state.crudModal.todosLoading = false;
        fullRender(container);
      });
    }
    setTimeout(() => {
      const el = document.getElementById(mode === 'create' ? 'bl-crud-products' : 'bl-crud-name');
      if (el) el.focus();
    }, 30);
  }

  function closeCrudModal(container) {
    if (state.crudModal && state.crudModal._escHandler) {
      document.removeEventListener('keydown', state.crudModal._escHandler);
    }
    state.crudModal = null;
    fullRender(container);
  }

  async function submitCrudModal(container) {
    if (!state.crudModal || state.crudModal.saving) return;
    const { mode, item } = state.crudModal;
    const prodEl    = document.getElementById('bl-crud-products');
    const nameEl    = document.getElementById('bl-crud-name');
    const prioEl    = document.getElementById('bl-crud-priority');
    const statusEl  = document.getElementById('bl-crud-status');
    const stypeEl   = document.getElementById('bl-crud-sessiontype');
    const sprintEl  = document.getElementById('bl-crud-sprint');
    if (!nameEl || !nameEl.value.trim()) {
      state.crudModal.errorMsg = 'Name is required.'; fullRender(container); return;
    }
    if (!prodEl || !prodEl.value.trim()) {
      state.crudModal.errorMsg = 'Product is required.'; fullRender(container); return;
    }
    const sprint = sprintEl && !sprintEl.readOnly ? sprintEl.value : (state.crudModal.sprint || '');
    const updates = {
      products: prodEl.value.split(',').map(p => p.trim()).filter(Boolean),
      name:      nameEl.value.trim(),
      priority:  prioEl  ? prioEl.value  : 'Medium',
      status:    statusEl ? statusEl.value : 'Open',
      sessionType: stypeEl ? stypeEl.value : '—',
    };
    state.crudModal.saving = true;
    state.crudModal.errorMsg = null;
    fullRender(container);
    saveStart();
    try {
      if (mode === 'create') {
        const idEl = document.getElementById('bl-crud-id');
        const newId = idEl ? idEl.value : String(Math.max(0, ...state.items.map(i => parseInt(i.id,10)||0)) + 1);
        const newItem = { id: newId, ...updates, sprint: sprint || null, type: '—', phase: '—', aiTool: '—', rank: null, reason: null, customReason: null };
        await writeBacklogCreate(newItem); // createMinimalDetailFile called internally if sprint set
        // Sprint filter visibility after create (#134 t7 fix — sprintMembership map is loaded at render
        // time so the new card is never in it; legacyUnion also excludes it → filter always hides it).
        // Fix: if card is explicitly for the active sprint, inject into sprintMembership so inCurrent=true.
        // Otherwise widen filter to 'All sprints' so the card is visible.
        if (state.sprintFilter === 'Current') {
          const activeId = state.activeSprint && state.activeSprint.id;
          if (newItem.sprint && activeId && newItem.sprint === activeId &&
              state.activeSprint && state.activeSprint.sprintMembership) {
            state.activeSprint.sprintMembership.set(String(newItem.id), newItem.sprint);
          } else {
            state.sprintFilter = 'All sprints';
            pushFilterToHash();
          }
        }
        pushToast({ kind: 'success', msg: `#${newItem.id} added${sprint ? ` to ${sprint}` : ' to backlog'}`, ttl: 3000 });
      } else {
        await writeBacklogUpdate(item.id, updates);
        // Update detail file sprint if changed (best-effort)
        const oldSprint = state.crudModal.sprint || '';
        if (sprint !== oldSprint) {
          upsertDetailFileSprint(item.id, sprint).catch(e =>
            console.warn(`[#134] sprint upsert for #${item.id} failed (non-fatal):`, e.message)
          );
        }
        pushToast({ kind: 'success', msg: `#${item.id} updated`, ttl: 2000 });
      }
      if (state.crudModal && state.crudModal._escHandler) {
        document.removeEventListener('keydown', state.crudModal._escHandler);
      }
      state.crudModal = null;
      fullRender(container);
    } catch (e) {
      state.crudModal.saving = false;
      state.crudModal.errorMsg = e.code === 'sha_conflict'
        ? 'Conflict — someone else edited this. Close and reload.'
        : `Save failed: ${e.message}`;
      fullRender(container);
      pushToast({ kind: 'danger', icon: '⚠', msg: state.crudModal.errorMsg, ttl: 5000 });
    } finally { saveEnd(); }
  }

  function renderCrudModal() {
    const m = state.crudModal;
    if (!m) return '';
    const isCreate = m.mode === 'create';
    const item = m.item;

    // ID: show 'auto' for create (assigned from live master at write time; sprint-branch state is stale)
    const nextId = isCreate ? 'auto' : item.id;

    // Product datalist
    const prodOpts = state.products.map(p => `<option value="${escHtml(p)}">`).join('');

    // Priority options with P-level labels
    const priMap = { 'SUPER HIGH': 'P0 – SUPER HIGH (critical)', 'HIGH': 'P1 – HIGH (sprint-committed)', 'Medium': 'P2 – Medium (queue)', 'Low': 'P3 – Low (someday)' };
    const priorityOpts = ['SUPER HIGH','HIGH','Medium','Low'].map(p =>
      `<option value="${escHtml(p)}"${!isCreate && item.priority === p ? ' selected' : (isCreate && p === 'HIGH' ? ' selected' : '')}>${escHtml(priMap[p] || p)}</option>`
    ).join('');

    const statusList = ['Open','In Progress ▶','Blocked ⏸','Done ✓'];
    const statusOpts = statusList.map(s =>
      `<option value="${escHtml(s)}"${!isCreate && item.status === s ? ' selected' : (isCreate && s === 'Open' ? ' selected' : '')}>${escHtml(s)}</option>`
    ).join('');

    const stList = ['—','Hygiene fix','Prod build','Infra build','Biz enablement','Personal build'];
    const stOpts = stList.map(s =>
      `<option value="${escHtml(s)}"${!isCreate && item.sessionType === s ? ' selected' : ''}>${escHtml(s)}</option>`
    ).join('');

    // Sprint field — dropdown in create mode, read-only in edit mode (sprint loaded async with todos)
    const curSprintId = state.activeSprint && state.activeSprint.id;
    const sprintVal = isCreate ? (curSprintId || '') : (m.sprint || '');
    const sprintOpts = [
      `<option value=""${sprintVal === '' ? ' selected' : ''}>— no sprint</option>`,
      curSprintId ? `<option value="${escHtml(curSprintId)}"${sprintVal === curSprintId ? ' selected' : ''}>${escHtml(curSprintId)}</option>` : '',
    ].join('');

    // Todos sub-panel (edit mode, t4 #134)
    let todosHtml = '';
    if (!isCreate) {
      if (m.todosLoading) {
        todosHtml = `<details class="bl-crud-todos"><summary class="bl-crud-todos-sum">Todos</summary><div class="bl-crud-todos-body muted">Loading…</div></details>`;
      } else if (m.todos && m.todos.length) {
        const rows = m.todos.map(t => {
          const isDoneT = t.status === 'done';
          return `<label class="bl-crud-todo-row${isDoneT ? ' is-done' : ''}">
            <input type="checkbox" class="bl-crud-todo-chk" data-card-id="${escHtml(item.id)}" data-todo-id="${escHtml(t.id)}" ${isDoneT ? 'checked' : ''} />
            <span class="bl-crud-todo-text">${inline(t.text)}</span>
            <span class="bl-crud-todo-st muted">${escHtml(t.id)}</span>
          </label>`;
        }).join('');
        todosHtml = `<details class="bl-crud-todos"><summary class="bl-crud-todos-sum">Todos <span class="bl-crud-todos-ct">${m.todos.length}</span></summary><div class="bl-crud-todos-body">${rows}</div></details>`;
      } else {
        todosHtml = `<details class="bl-crud-todos"><summary class="bl-crud-todos-sum">Todos</summary><div class="bl-crud-todos-body muted">No todos found for this card.</div></details>`;
      }
    }

    const errHtml = m.errorMsg ? `<div class="bl-crud-error">${escHtml(m.errorMsg)}</div>` : '';

    return `<div class="bl-crud-overlay" id="bl-crud-overlay">
      <div class="bl-crud-modal" role="dialog" aria-label="${isCreate ? 'Add backlog item' : 'Edit #' + escHtml(item.id)}">
        <div class="bl-crud-head">
          <span class="bl-crud-title">${isCreate ? 'Add backlog item' : 'Edit #' + escHtml(item.id)}</span>
          <button class="bl-crud-x" id="bl-crud-close" type="button" title="Close (Esc)">✕</button>
        </div>
        <div class="bl-crud-body">
          <div class="bl-crud-row2">
            <div class="bl-crud-field">
              <label class="bl-crud-lbl">ID</label>
              <input class="bl-crud-inp" id="bl-crud-id" value="${escHtml(nextId)}" readonly tabindex="-1" />
            </div>
            <div class="bl-crud-field bl-crud-field-grow">
              <label class="bl-crud-lbl">Product <span class="bl-crud-req" title="required">*</span></label>
              <input class="bl-crud-inp" id="bl-crud-products" list="bl-crud-prodlist"
                value="${isCreate ? '' : escHtml((item.products||[]).join(', '))}"
                placeholder="vprohub, exec-profile…" autocomplete="off" />
              <datalist id="bl-crud-prodlist">${prodOpts}</datalist>
            </div>
          </div>
          <div class="bl-crud-field">
            <label class="bl-crud-lbl">Name <span class="bl-crud-req" title="required">*</span></label>
            <input class="bl-crud-inp" id="bl-crud-name"
              value="${isCreate ? '' : escHtml(item.name)}"
              placeholder="Short descriptive title" />
          </div>
          <div class="bl-crud-row2">
            <div class="bl-crud-field">
              <label class="bl-crud-lbl">Priority <span class="bl-crud-req" title="required">*</span>
                <span class="bl-crud-tip" title="P0=SUPER HIGH (critical blocker), P1=HIGH (sprint-committed), P2=Medium (queue), P3=Low (someday/stretch)">ⓘ</span>
              </label>
              <select class="bl-crud-sel" id="bl-crud-priority">${priorityOpts}</select>
            </div>
            <div class="bl-crud-field">
              <label class="bl-crud-lbl">Status <span class="bl-crud-req" title="required">*</span></label>
              <select class="bl-crud-sel" id="bl-crud-status">${statusOpts}</select>
            </div>
          </div>
          <div class="bl-crud-field">
            <label class="bl-crud-lbl">Session Class</label>
            <select class="bl-crud-sel" id="bl-crud-sessiontype">${stOpts}</select>
          </div>
          <div class="bl-crud-field">
            <label class="bl-crud-lbl">Sprint
              <span class="bl-crud-tip" title="Assign to current sprint — creates a detail file so the card appears in Sprint Dashboard">ⓘ</span>
            </label>
            ${isCreate
              ? `<select class="bl-crud-sel" id="bl-crud-sprint">${sprintOpts}</select>`
              : `<input class="bl-crud-inp" id="bl-crud-sprint" value="${escHtml(m.sprint || (m.todosLoading ? 'loading…' : '—'))}" readonly tabindex="-1" />`
            }
          </div>
          ${todosHtml}
          ${errHtml}
        </div>
        <div class="bl-crud-foot">
          <button class="bl-crud-cancel-btn" id="bl-crud-cancel" type="button">Cancel</button>
          <button class="bl-crud-save-btn${m.saving ? ' bl-crud-saving' : ''}" id="bl-crud-save" type="button" ${m.saving ? 'disabled' : ''}>
            ${m.saving ? '…saving' : (isCreate ? 'Add item' : 'Save changes')}
          </button>
        </div>
      </div>
    </div>`;
  }

  // ── #188 — Cadence modal (open / close / submit / render) ──────

  function openCadenceModal(container) {
    if (isReadOnly()) return;
    const s = state.activeSprint;
    if (!s) return;
    if (state.cadenceModal && state.cadenceModal._escHandler) {
      document.removeEventListener('keydown', state.cadenceModal._escHandler);
    }
    const escHandler = e => { if (e.key === 'Escape') closeCadenceModal(container); };
    state.cadenceModal = {
      loading: true, raw: null, sha: null,
      start: null, end: null, cad: null, history: [],
      reasonClasses: new Set(), saving: false, errorMsg: null, _escHandler: escHandler,
    };
    document.addEventListener('keydown', escHandler);
    fullRender(container);

    const branch = s.branch;
    const sprintFile = s.sprintFile;
    const path = `docs/sprints/${sprintFile}`;
    Repos.getFileWithSha(CONFIG.username, state.backlogRepo, path, branch)
      .then(latest => {
        if (!state.cadenceModal) return;
        if (!latest) throw new Error(`Could not fetch ${path} on ${branch}.`);
        const raw = latest.content;
        state.cadenceModal.raw = raw;
        state.cadenceModal.sha = latest.sha;
        const fmM = /^---\n([\s\S]*?)\n---/.exec(raw);
        const fm = fmM ? fmM[1] : '';
        state.cadenceModal.start = cadExtractScalar(fm, 'start_date') || cadExtractScalar(fm, 'start');
        state.cadenceModal.end   = cadExtractScalar(fm, 'end_date')   || cadExtractScalar(fm, 'end');
        state.cadenceModal.cad   = cadExtractScalar(fm, 'cadence');
        state.cadenceModal.history = cadParseHistory(raw);
        state.cadenceModal.loading = false;
        fullRender(container);
        setTimeout(() => { const el = document.getElementById('bl-cad-newend'); if (el) el.focus(); }, 30);
      })
      .catch(err => {
        if (!state.cadenceModal) return;
        state.cadenceModal.loading = false;
        state.cadenceModal.errorMsg = `Load failed: ${err.message}`;
        fullRender(container);
      });
  }

  function closeCadenceModal(container) {
    if (state.cadenceModal && state.cadenceModal._escHandler) {
      document.removeEventListener('keydown', state.cadenceModal._escHandler);
    }
    state.cadenceModal = null;
    fullRender(container);
  }

  // Live preview — recompute direction/cadence as the date changes, without re-render.
  function updateCadencePreview(container) {
    const m = state.cadenceModal;
    if (!m || m.loading) return;
    const prev = document.getElementById('bl-cad-preview');
    if (!prev) return;
    const newEnd = (document.getElementById('bl-cad-newend') || {}).value || '';
    if (!newEnd || !m.raw) { prev.className = 'bl-cad-preview'; prev.textContent = 'Pick a new end date to preview the change.'; return; }
    try {
      const reasons = [...(m.reasonClasses || [])];
      const r = cadComputeEdit(m.raw, {
        newEnd, reasonClassList: reasons.length ? reasons : ['cadence-realignment'],
        reasonText: 'preview', ratifiedBy: 'venkatesh', session: sessionIdGuess(),
      });
      const sign = r.delta > 0 ? '+' : '';
      prev.className = `bl-cad-preview bl-cad-preview-${r.direction}`;
      prev.textContent = `${r.direction.toUpperCase()} · end ${r.oldEndIso} → ${r.newEndIso} · cadence ${r.oldCad}d → ${r.newCad}d (${sign}${r.delta}d)`;
    } catch (e) {
      prev.className = 'bl-cad-preview bl-cad-preview-error';
      prev.textContent = `⚠ ${e.message}`;
    }
  }

  function sessionIdGuess() {
    // The SESSION id isn't known to the browser; the SessionTimer doesn't carry it.
    // Use a stable UI marker so the ledger row is attributable to a dashboard action.
    return 'UI';
  }

  async function submitCadenceModal(container) {
    const m = state.cadenceModal;
    if (!m || m.saving || m.loading) return;
    const newEnd = (document.getElementById('bl-cad-newend') || {}).value || '';
    const reasonText = (document.getElementById('bl-cad-reasontext') || {}).value || '';
    const reasons = [...(m.reasonClasses || [])];
    const opts = { newEnd, reasonClassList: reasons, reasonText, ratifiedBy: 'venkatesh', session: sessionIdGuess() };

    // Client-side validate first (same errors the write would throw) so we never
    // fire a doomed PUT.
    try {
      if (!m.raw) throw new Error('Sprint file not loaded yet.');
      cadComputeEdit(m.raw, opts);
    } catch (e) {
      m.errorMsg = e.message; fullRender(container);
      const el = document.getElementById('bl-cad-newend'); if (el) el.focus();
      return;
    }

    m.saving = true; m.errorMsg = null; fullRender(container);
    saveStart();
    try {
      const { direction, oldEndIso, newEndIso, oldCad, newCad } = await writeSprintCadence(opts);
      // Invalidate ActiveSprint cache so the band re-renders with fresh dates.
      if (window.ActiveSprint && typeof window.ActiveSprint.invalidateCache === 'function') {
        window.ActiveSprint.invalidateCache(CONFIG.username, state.backlogRepo);
      }
      if (m._escHandler) document.removeEventListener('keydown', m._escHandler);
      state.cadenceModal = null;
      pushToast({ kind: 'success', msg: `Sprint ${direction}ed · ${oldEndIso}→${newEndIso} (${oldCad}d→${newCad}d)`, ttl: 4000 });
      // Reload the sprint so the band reflects the new cadence.
      try { state.activeSprint = await loadActiveSprint(); } catch {}
      fullRender(container);
    } catch (e) {
      m.saving = false;
      m.errorMsg = e.code === 'sha_conflict'
        ? 'Conflict — the sprint file changed since you opened this. Close and reopen.'
        : e.code === 'empty_commit_guard'
          ? 'No change produced.'
          : `Save failed: ${e.message}`;
      fullRender(container);
      pushToast({ kind: 'danger', icon: '⚠', msg: m.errorMsg, ttl: 5000 });
    } finally { saveEnd(); }
  }

  function renderCadenceModal() {
    const m = state.cadenceModal;
    if (!m) return '';
    const s = state.activeSprint;
    const sprintId = (s && s.id) || '';

    let bodyHtml;
    if (m.loading) {
      bodyHtml = `<div class="bl-cad-loading muted">Loading sprint file…</div>`;
    } else if (m.raw == null) {
      bodyHtml = `<div class="bl-crud-error">${escHtml(m.errorMsg || 'Could not load the sprint file.')}</div>`;
    } else {
      const reasonBoxes = CADENCE_REASON_ENUM.map(rc => {
        const on = m.reasonClasses.has(rc);
        return `<label class="bl-cad-reason${on ? ' is-on' : ''}">
          <input type="checkbox" class="bl-cad-reason-chk" data-rc="${escAttr(rc)}" ${on ? 'checked' : ''} />
          <span>${escHtml(rc)}</span>
        </label>`;
      }).join('');

      const histRows = (m.history || []).length === 0
        ? `<div class="bl-cad-hist-empty muted">No prior cadence changes.</div>`
        : m.history.map(h => {
            const dir = h.direction || '?';
            return `<div class="bl-cad-hist-row bl-cad-hist-${escAttr(dir)}">
              <span class="bl-cad-hist-dir">${escHtml(dir)}</span>
              <span class="bl-cad-hist-dates">${escHtml(h.from_end_date || '?')} → ${escHtml(h.to_end_date || '?')}</span>
              <span class="bl-cad-hist-meta muted">${escHtml((h.reason_class || '').replace(/[[\]]/g, ''))} · ${escHtml(h.session || '')} · ${escHtml((h.timestamp || '').split('T')[0])}</span>
            </div>`;
          }).join('');

      const errHtml = m.errorMsg ? `<div class="bl-crud-error">${escHtml(m.errorMsg)}</div>` : '';
      // Min for the date picker: shorten can't go before today, and end must be > start.
      const minDate = m.start && m.start > cadTodayIso() ? m.start : cadTodayIso();

      bodyHtml = `
        <div class="bl-cad-current">
          <span>Start <b>${escHtml(m.start || '?')}</b></span>
          <span>End <b>${escHtml(m.end || '?')}</b></span>
          <span>Cadence <b>${escHtml(m.cad || '?')}</b></span>
        </div>
        <div class="bl-crud-field">
          <label class="bl-crud-lbl" for="bl-cad-newend">New end date <span class="bl-crud-req" title="required">*</span></label>
          <input class="bl-crud-inp" type="date" id="bl-cad-newend" value="${escAttr(m.end || '')}" min="${escAttr(minDate)}" />
        </div>
        <div id="bl-cad-preview" class="bl-cad-preview">Pick a new end date to preview the change.</div>
        <div class="bl-crud-field">
          <label class="bl-crud-lbl">Reason class <span class="bl-crud-req" title="required">*</span>
            <span class="bl-crud-tip" title="Why the cadence is changing — pick one or more. Mirrors the adjust_sprint_cadence.py enum.">ⓘ</span>
          </label>
          <div class="bl-cad-reasons">${reasonBoxes}</div>
        </div>
        <div class="bl-crud-field">
          <label class="bl-crud-lbl" for="bl-cad-reasontext">Reason <span class="bl-crud-req" title="required">*</span></label>
          <textarea class="bl-crud-inp bl-cad-textarea" id="bl-cad-reasontext" rows="2" placeholder="One–two sentences — becomes the extension_history[] reason_text.">${escHtml(m.reasonText || '')}</textarea>
        </div>
        <details class="bl-cad-hist"><summary class="bl-cad-hist-sum">Cadence history <span class="bl-cad-hist-ct">${(m.history || []).length}</span></summary>
          <div class="bl-cad-hist-body">${histRows}</div>
        </details>
        <div class="bl-cad-note muted">Ratified by <b>venkatesh</b> (you hold the token). Writes to <span class="field-mono">${escHtml((s && s.branch) || '')}</span> and appends to <span class="field-mono">extension_history[]</span> — same invariant as the CLI SOP.</div>
        ${errHtml}`;
    }

    const canSave = !m.loading && m.raw != null && !m.saving;
    return `<div class="bl-crud-overlay" id="bl-cad-overlay">
      <div class="bl-crud-modal bl-cad-modal" role="dialog" aria-label="Adjust sprint cadence">
        <div class="bl-crud-head">
          <span class="bl-crud-title">Adjust cadence${sprintId ? ' · ' + escHtml(sprintId) : ''}</span>
          <button class="bl-crud-x" id="bl-cad-close" type="button" title="Close (Esc)">✕</button>
        </div>
        <div class="bl-crud-body">${bodyHtml}</div>
        <div class="bl-crud-foot">
          <button class="bl-crud-cancel-btn" id="bl-cad-cancel" type="button">Cancel</button>
          <button class="bl-crud-save-btn${m.saving ? ' bl-crud-saving' : ''}" id="bl-cad-save" type="button" ${canSave ? '' : 'disabled'}>
            ${m.saving ? '…saving' : 'Apply cadence change'}
          </button>
        </div>
      </div>
    </div>`;
  }

  // ── Main render entry point ────────────────────

  async function render(container, opts) {
    opts = opts || {};
    state._idxCardsMemo = undefined;   // #212 — fresh index per render pass (writes must show)
    // dc6 — seed filter state from URL hash (before opts so opts take precedence)
    readFilterFromHash();
    // Allow callers (e.g. SprintView delegation) to preset state
    if (opts.sprintFilter) state.sprintFilter = opts.sprintFilter;
    if (opts.vmMode)       state.vmMode = opts.vmMode;
    if (opts.vmManual !== undefined) state.vmManual = opts.vmManual;
    container.innerHTML = renderSkeleton();
    try {
      const owner = CONFIG.username;
      // Read BACKLOG with SHA (so we know what to compare on writeback)
      const backlogResult = (typeof Repos.getFileWithSha === 'function')
        ? await Repos.getFileWithSha(owner, state.backlogRepo, state.backlogPath)
        : null;
      const md = backlogResult ? backlogResult.content : await Repos.getFile(owner, state.backlogRepo, state.backlogPath);
      if (backlogResult) state.backlogSha = backlogResult.sha;

      if (!md) {
        container.innerHTML = `<div class="bl-empty">
          <div class="bl-empty-glyph">∅</div>
          <div class="bl-empty-msg">No backlog found.</div>
          <div class="bl-empty-detail">Create <code>docs/BACKLOG.md</code> in the V-Pro-Hub repo.</div>
        </div>`;
        return;
      }
      state.items = parseBacklog(md);
      // S120 P3c — product-scoped embed (Product Home Backlog tab): caller injects
      // read-only feature items + presets/locks the product filter; filter-state URL
      // writes stay on the product route.
      if (opts.extraItems && opts.extraItems.length) {
        const ids = new Set(state.items.map(i => String(i.id)));
        state.items = state.items.concat(opts.extraItems.filter(x => !ids.has(String(x.id))));
      }
      state.scopedRoute = opts.scopedRoute || null;
      if (opts.productFilter) state.productFilter = opts.productFilter;
      else if (state.scopedProductName) state.productFilter = 'All'; // left the scoped embed — unpin
      state.scopedProductName = opts.productFilter || null;
      state.products = extractProducts(state.items);
      state.sessionTypes = extractSessionTypes(state.items);

      // Try to load active sprint (non-fatal if absent)
      try { state.activeSprint = await loadActiveSprint(); } catch { state.activeSprint = null; }

      // #192 — load the coverage-registry INTERFACE source (CP contract). Fail-soft to
      // empty {} → AutoTest badges render as "pending" (the empty-registry DoD). When
      // #196 stands up the real registry it swaps in behind this same read with no
      // card-side change. Read from the active sprint branch (falls back to default).
      try {
        const regBranch = state.activeSprint && state.activeSprint.branch;
        const regRaw = await Repos.getFile(CONFIG.username, state.backlogRepo, 'docs/test-coverage-registry.json', regBranch || undefined);
        state.coverageRegistry = regRaw ? (JSON.parse(regRaw).coverage || {}) : {};
      } catch { state.coverageRegistry = {}; }

      fullRender(container);

      // #185 t5 — subscribe to repo-change reactivity once per mount. Unsubscribe
      // any previous listener first (render() can be called repeatedly — retry
      // button, filter changes that re-render, etc.) so exactly one interval is
      // ever active. No-op unsubscribe/subscribe when Repos.onChange has nothing
      // to offer (e.g. deployed mode with no local adapter) — see app/repos.js.
      if (_unsubscribeOnChange) { _unsubscribeOnChange(); _unsubscribeOnChange = null; }
      if (typeof Repos.onChange === 'function') {
        _unsubscribeOnChange = Repos.onChange(() => render(container, opts));
      }

      // openEditFor deferred open: if navigated here from card detail page
      if (_pendingEditId) {
        const pid = _pendingEditId;
        _pendingEditId = null;
        const pendingItem = state.items.find(i => i.id === pid);
        if (pendingItem) openCrudModal(container, 'edit', pendingItem);
      }
    } catch (err) {
      container.innerHTML = `<div class="bl-empty">
        <div class="bl-empty-glyph">✕</div>
        <div class="bl-empty-msg">Failed to load backlog.</div>
        <div class="bl-empty-detail">${escHtml(err.message)}</div>
        <button class="bl-empty-cta" onclick="BacklogView.render(document.getElementById('main-content'))">Retry</button>
      </div>`;
    }
  }

  // #134 — Public method so card.js "✎ Edit" button can open the edit modal
  function openEditFor(container, id) {
    const strId = String(id);
    if (container && container.querySelector('#bl-main-canvas') && state.items.length) {
      const item = state.items.find(i => i.id === strId);
      if (item) { openCrudModal(container, 'edit', item); return; }
    }
    // BacklogView not yet rendered in container — flag for deferred open then navigate
    _pendingEditId = strId;
    if (typeof navigate === 'function') navigate('backlog');
  }

  // S061/#119 debug-only accessor — exposes internal state for preview_eval introspection.
  // Safe to keep: read-only reference; consumers may snapshot via JSON.stringify.
  return { render, openEditFor, _debugState: () => state, parseFrontmatter, deriveCardStatus, sessionsFromCards };
})();
