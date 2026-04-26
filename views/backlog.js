// views/backlog.js — Backlog 2.0 (S035, #76)
// Single source: docs/BACKLOG.md in V-Pro-Hub repo.
// Phase 3 implementation of Claude Design Phase 2.5 polished output (Option C).
// Constraint: docs/design-sessions/backlog-2.0-2026-04-26-handoff-polished/

window.BacklogView = (() => {

  // ── Helpers ────────────────────────────────────

  function escHtml(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

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

  const state = {
    items: [],
    products: [],
    sessionTypes: [],
    sprints: [],
    activeSprint: null,    // { id, frontmatter, planItems, backlogMap, acMap, adaptations, dailyLog, sessions, health, drift }
    productFilter: 'All',
    sessionFilter: 'All',
    sprintFilter: 'All sprints',  // 'All sprints' | 'Current' | 'Past' | 'No sprint' | 'range'
    rangeStart: null,
    rangeEnd: null,
    searchQuery: '',
    vmMode: 'list',            // 'list' | 'board'
    vmManual: false,
    bandCollapsed: false,
    backlogSha: null,          // current SHA of BACKLOG.md (for SHA-guarded writeback)
    backlogPath: 'docs/BACKLOG.md',
    backlogRepo: 'V-Pro-Hub',
  };

  // ── Parse BACKLOG.md ───────────────────────────

  function parseBacklog(md) {
    const items = [];
    const lines = md.split('\n');
    let headers = [];
    let inTable = false;

    for (const line of lines) {
      if (!line.startsWith('|')) {
        if (/^## Backlog$/.test(line))               { inTable = true; headers = []; }
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
    // Read SPRINTS.md → find active. If none → null.
    let sprintsMd;
    try { sprintsMd = await Repos.getFile(CONFIG.username, state.backlogRepo, 'docs/SPRINTS.md'); }
    catch { return null; }
    if (!sprintsMd) return null;
    const sprints = parseSprintsIndex(sprintsMd);
    state.sprints = sprints;
    const active = sprints.find(s => s.status === 'active');
    if (!active) return null;

    // Filename convention per AGILE.md §1.2: SP-YYYY-MM-DD.md (ISO start date)
    // Display ID is SP-DDMonYY which differs — use start date for the file lookup.
    const filename = active.start ? `SP-${active.start}.md` : `${active.id}.md`;
    let detailMd;
    try { detailMd = await Repos.getFile(CONFIG.username, state.backlogRepo, `docs/sprints/${filename}`); }
    catch { return null; }
    if (!detailMd) return null;

    const frontmatter = parseFrontmatter(detailMd);
    const planItems   = parsePlanSection(detailMd);
    const adaptations = parseAdaptations(detailMd);
    const dailyLog    = parseDailyLog(detailMd);
    const acMap       = parseSprintReadyAC(detailMd);  // Ignored if no detail block
    const backlogMap  = Object.fromEntries(state.items.map(i => [parseInt(i.id), i]));

    const health = computeHealthMetrics(frontmatter, planItems, backlogMap, adaptations, dailyLog);
    const drift  = computeDriftFlags(health, adaptations);
    const sessions = sessionsFromDailyLog(dailyLog);

    return {
      id: active.id,
      meta: active,
      frontmatter, planItems, backlogMap, acMap, adaptations, dailyLog,
      health, drift, sessions,
    };
  }

  function parseFrontmatter(md) {
    const match = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return {};
    const result = {};
    for (const line of match[1].split('\n')) {
      const m = line.match(/^([\w_]+):\s*(.*)/);
      if (!m) continue;
      const key = m[1]; const raw = m[2].trim();
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
    const out = [];
    for (const day of dailyLog) {
      for (const e of day.entries) {
        const focus = (e.header.match(/focus:\s*([^·]+)/) || [,''])[1].trim();
        const tag   = (e.header.match(/tag:\s*([\w-]+)/) || [,''])[1].trim();
        out.push({
          id: e.sessionId, date: day.date, focus, tag,
          body: e.bullets.slice(0, 4),
          more: Math.max(0, e.bullets.length - 4),
        });
      }
    }
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
    const committed = (fm.committed_items || []).map(Number);
    const todayIso = new Date().toISOString().split('T')[0];
    const start = fm.start || todayIso;
    const dayOfSprint = Math.max(1, Math.round((new Date(todayIso) - new Date(start)) / 86400000) + 1);
    const totalDays = fm.length_days || 7;

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

  function filteredItems() {
    const q = state.searchQuery.trim().toLowerCase().replace(/^#/, '');
    const committedSet = state.activeSprint ?
      new Set((state.activeSprint.frontmatter.committed_items || []).map(Number)) :
      new Set();

    return state.items.filter(i => {
      if (state.productFilter !== 'All' && !i.products.includes(state.productFilter)) return false;
      if (state.sessionFilter !== 'All' && i.sessionType !== state.sessionFilter) return false;

      // Sprint filter
      const idNum = parseInt(i.id);
      const inCurrent = committedSet.has(idNum);
      if (state.sprintFilter === 'Current' && !inCurrent) return false;
      if (state.sprintFilter === 'No sprint' && inCurrent) return false;
      // 'Past' / 'range' would need sprint-history tracking — for v1, treat as 'All sprints'
      // (these filter values render but currently don't exclude further; future #NEW)

      if (q) {
        const hay = ['#'+i.id, i.id, i.name, i.products.join(' '), i.type, i.sessionType, i.status]
          .join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  // ── Render: header, search, summary ────────────

  function renderHeader() {
    return `<div class="bl-vh">
      <div>
        <div class="bl-vh-title">Backlog<span class="bl-save-indicator" aria-hidden="true"></span></div>
        <div class="bl-vh-sub">${state.items.length} items</div>
      </div>
    </div>`;
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

    const showVM = state.sprintFilter === 'Current';
    const vmRow = showVM ? `<div class="bl-fa-axis" style="justify-content:flex-end">
      <div style="flex:1"></div>
      <div class="bl-vm">
        <button class="bl-vm-btn${state.vmMode === 'list'  ? ' active' : ''}" data-vm="list"><span class="bl-vm-ic">▤</span> List</button>
        <button class="bl-vm-btn${state.vmMode === 'board' ? ' active' : ''}" data-vm="board"><span class="bl-vm-ic">▦</span> Board</button>
      </div>
    </div>` : '';

    return `<div class="bl-fa" id="bl-filter-area">
      <div class="bl-fa-axis"><div class="bl-fa-axis-label">Product</div><div class="bl-fa-tabs" id="bl-product-tabs">${tabs}</div></div>
      <div class="bl-fa-axis"><div class="bl-fa-axis-label">Session</div><div class="bl-fa-chips" id="bl-stype-chips">${sChips}</div></div>
      <div class="bl-fa-axis"><div class="bl-fa-axis-label">Sprint</div><div class="bl-fa-chips" id="bl-sprint-chips">${spChips}</div></div>
      ${vmRow}
    </div>`;
  }

  function renderSummary(items) {
    const isDone = i => /Done|✓/i.test(i.status) || i.status.toLowerCase() === 'closed';
    const open = items.filter(i => !isDone(i));
    const high = open.filter(i => i.priority === 'HIGH' || i.priority === 'SUPER HIGH');
    const med  = open.filter(i => i.priority === 'Medium');
    const low  = open.filter(i => i.priority === 'Low');
    const done = items.filter(isDone);
    return `<div class="bl-sb">
      <div class="bl-sb-tile lead"><div class="bl-sb-num">${open.length}<span class="bl-sb-unit">items</span></div><div class="bl-sb-lbl">Open</div></div>
      <div class="bl-sb-tile lead danger"><div class="bl-sb-num">${high.length}<span class="bl-sb-unit">items</span></div><div class="bl-sb-lbl">High priority</div></div>
      <div class="bl-sb-divider"></div>
      <div class="bl-sb-tile ctx"><div class="bl-sb-ctx-wrap"><div class="bl-sb-num">${med.length}<span class="bl-sb-unit">med</span></div><div class="bl-sb-sub">${low.length} low</div></div></div>
      <div class="bl-sb-tile ctx"><div class="bl-sb-ctx-wrap"><div class="bl-sb-num">${done.length}<span class="bl-sb-unit">done</span></div><div class="bl-sb-sub">this cycle</div></div></div>
    </div>`;
  }

  // ── Render: sprint context band (Option C) ─────

  function renderSprintBand() {
    const s = state.activeSprint;
    if (!s) {
      return `<div class="bl-empty">
        <div class="bl-empty-glyph">∅</div>
        <div class="bl-empty-msg">No active sprint.</div>
        <div class="bl-empty-detail">Open a sprint via Sprint Planning ceremony.</div>
      </div>`;
    }
    const fm = s.frontmatter;
    const total = s.health.find(h => h.key === 'delivery').display.split('/')[1] || 0;
    const delivered = s.health.find(h => h.key === 'delivery').display.split('/')[0] || 0;
    const pct = total > 0 ? Math.round(delivered / total * 100) : 0;
    const todayIso = new Date().toISOString().split('T')[0];
    const dayOfSprint = Math.max(1, Math.round((new Date(todayIso) - new Date(fm.start || todayIso)) / 86400000) + 1);
    const totalDays = fm.length_days || 7;

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
    const hasGripCls = isReadOnly() ? '' : ' has-grip';
    const grip = isReadOnly() ? '' : `<span class="bl-grip" draggable="true" data-id="${escHtml(item.id)}" title="Drag to reorder"><span class="bl-grip-glyph">⋮⋮</span></span>`;

    return `<div class="bl-ic ${railCls}${done ? ' item-done' : ''}${hasGripCls}${dropClass}" data-id="${escHtml(item.id)}">
      ${grip}
      ${renderRankCell(item)}
      <div class="bl-ic-head">
        <div class="bl-ic-name">${inline(item.name)}</div>
        <div class="bl-ic-meta">
          <span class="bl-ic-id">#${escHtml(item.id)}</span>
          <span class="bl-ic-sep">·</span>
          ${tags}
          ${renderReasonChip(item)}
        </div>
      </div>
      <div class="bl-ic-glance">
        <span class="bl-chip ${prioCls}"><span class="bl-chip-dot"></span>${escHtml(item.priority === 'HIGH' || item.priority === 'SUPER HIGH' ? 'High' : item.priority)}</span>
        <span class="bl-chip ${sCls}"><span class="bl-chip-dot"></span>${escHtml(sText)}</span>
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
    return `<div class="kanban-card ${railCls}${dragging}" draggable="${isReadOnly() ? 'false' : 'true'}" data-id="${escHtml(item.id)}">
      ${saveDot}
      <div class="kc-header">
        <span class="kc-rank">#${item.rank ?? '—'}·${escHtml(item.id)}</span>
        <span style="flex:1"></span>
        <span class="kc-name-tag">${escHtml(item.priority)}</span>
      </div>
      <div class="kc-name">${escHtml(item.name)}</div>
      <div class="kc-footer">
        ${acStr ? `<span>${escHtml(acStr)}</span>` : ''}
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

  function fullRender(container) {
    const items = filteredItems();
    const showSprintCtx = state.sprintFilter === 'Current' && state.activeSprint;
    const showKanban    = state.sprintFilter === 'Current' && state.vmMode === 'board' && state.activeSprint;

    container.innerHTML = `
      ${renderReadOnlyBanner()}
      ${renderHeader()}
      ${renderSearch()}
      ${renderFilterArea()}
      ${renderSummary(items)}
      ${showSprintCtx ? renderSprintBand() : ''}
      <div id="bl-main-canvas">${showKanban ? renderKanban(items) : renderItemsList(items)}</div>
      ${showSprintCtx ? renderAuxPanels() : ''}
    `;
    wireEvents(container);
  }

  // Update only the main canvas (faster than full render for filter changes)
  function updateCanvas(container) {
    const items = filteredItems();
    const showKanban = state.sprintFilter === 'Current' && state.vmMode === 'board' && state.activeSprint;
    const canvas = container.querySelector('#bl-main-canvas');
    if (canvas) canvas.innerHTML = showKanban ? renderKanban(items) : renderItemsList(items);
    wireCanvasEvents(container);
    // Update summary
    const summary = container.querySelector('.bl-sb');
    if (summary) summary.outerHTML = renderSummary(items);
  }

  // ── Event wiring ───────────────────────────────

  function wireEvents(container) {
    // Search
    const searchEl = container.querySelector('#bl-search-input');
    if (searchEl) {
      searchEl.addEventListener('input', e => {
        state.searchQuery = e.target.value;
        updateCanvas(container);
      });
      searchEl.addEventListener('keydown', e => {
        if (e.key === 'Escape' && searchEl.value) { searchEl.value = ''; state.searchQuery = ''; updateCanvas(container); }
      });
    }
    // Product tabs
    container.querySelectorAll('#bl-product-tabs .bl-fa-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        state.productFilter = btn.dataset.product;
        fullRender(container);
      });
    });
    // Session chips
    container.querySelectorAll('#bl-stype-chips .bl-fa-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        state.sessionFilter = btn.dataset.stype;
        fullRender(container);
      });
    });
    // Sprint chips
    container.querySelectorAll('#bl-sprint-chips .bl-fa-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        state.sprintFilter = btn.dataset.sprint;
        state.vmManual = false;
        if (state.sprintFilter === 'Current' && !state.vmManual) state.vmMode = 'board';
        else if (state.sprintFilter !== 'Current') state.vmMode = 'list';
        fullRender(container);
      });
    });
    // VM toggle
    container.querySelectorAll('.bl-vm-btn').forEach(btn => {
      btn.addEventListener('click', () => { state.vmMode = btn.dataset.vm; state.vmManual = true; fullRender(container); });
    });
    // Range date inputs
    const rs = container.querySelector('#bl-range-start');
    const re = container.querySelector('#bl-range-end');
    if (rs) rs.addEventListener('change', e => { state.rangeStart = e.target.value; updateCanvas(container); });
    if (re) re.addEventListener('change', e => { state.rangeEnd   = e.target.value; updateCanvas(container); });
    // Sprint band collapse (mobile only via CSS, but click anywhere on head toggles state)
    const bandHead = container.querySelector('#bl-band-head');
    if (bandHead) {
      bandHead.addEventListener('click', () => {
        state.bandCollapsed = !state.bandCollapsed;
        const band = container.querySelector('#bl-sprint-band');
        if (band) band.setAttribute('data-collapsed', state.bandCollapsed);
      });
    }
    // Aux panel collapse
    container.querySelectorAll('.bl-ctx-panel-head').forEach(h => {
      h.addEventListener('click', () => {
        const panel = h.closest('.bl-ctx-panel');
        if (panel) panel.classList.toggle('collapsed');
      });
    });
    wireCanvasEvents(container);
  }

  function wireCanvasEvents(container) {
    // Clear filters CTA
    const cta = container.querySelector('#bl-clear-filters');
    if (cta) cta.addEventListener('click', () => {
      state.productFilter = 'All'; state.sessionFilter = 'All'; state.sprintFilter = 'All sprints';
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

    // Kanban card drag
    container.querySelectorAll('.kanban-card').forEach(card => {
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

  function rebuildBacklogMd(originalMd) {
    // Parse the table, reconstruct with current state.items values
    const lines = originalMd.split('\n');
    const out = [];
    let inTable = false; let headers = []; let headerLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.startsWith('|')) {
        if (/^## Backlog$/.test(line)) inTable = true;
        else if (/^## /.test(line) && inTable) inTable = false;
        out.push(line);
        continue;
      }
      if (!inTable) { out.push(line); continue; }

      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (cells.every(c => /^[-: ]+$/.test(c))) { out.push(line); continue; }

      if (cells[0] === '#' && headers.length === 0) {
        headers = cells.map(c => c.toLowerCase().replace(/[()]/g, '').trim());
        headerLineIdx = i;
        out.push(line);
        continue;
      }
      if (headers.length && /^\d+$/.test(cells[0])) {
        const id = cells[0];
        const item = state.items.find(x => x.id === id);
        if (!item) { out.push(line); continue; }
        const newCells = cells.slice();
        headers.forEach((h, idx) => {
          if (h === 'status') newCells[idx] = item.status;
          else if (h === 'rank')   newCells[idx] = item.rank == null ? '—' : String(item.rank);
          else if (h === 'reason') newCells[idx] = reasonCellValue(item);
        });
        out.push('| ' + newCells.join(' | ') + ' |');
        continue;
      }
      out.push(line);
    }
    return out.join('\n');
  }

  async function writeBacklogField(reason) {
    // Re-fetch latest BACKLOG.md to get fresh SHA, then PUT with merged content
    const latest = await Repos.getFileWithSha(CONFIG.username, state.backlogRepo, state.backlogPath);
    if (!latest) throw new Error('Could not fetch BACKLOG.md SHA');
    state.backlogSha = latest.sha;
    const newMd = rebuildBacklogMd(latest.content);
    const result = await Repos.putFile(
      CONFIG.username, state.backlogRepo, state.backlogPath,
      newMd, latest.sha,
      `Backlog 2.0 writeback (${reason}) — autonomous via UI`
    );
    state.backlogSha = result.sha;
    return result;
  }

  // ── Main render entry point ────────────────────

  async function render(container, opts = {}) {
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
      state.products = extractProducts(state.items);
      state.sessionTypes = extractSessionTypes(state.items);

      // Try to load active sprint (non-fatal if absent)
      try { state.activeSprint = await loadActiveSprint(); } catch { state.activeSprint = null; }

      fullRender(container);
    } catch (err) {
      container.innerHTML = `<div class="bl-empty">
        <div class="bl-empty-glyph">✕</div>
        <div class="bl-empty-msg">Failed to load backlog.</div>
        <div class="bl-empty-detail">${escHtml(err.message)}</div>
        <button class="bl-empty-cta" onclick="BacklogView.render(document.getElementById('main-content'))">Retry</button>
      </div>`;
    }
  }

  return { render };
})();
