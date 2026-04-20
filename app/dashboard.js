// app/dashboard.js — app init and state
// Phase 1 — Vanilla JS, no framework

const Dashboard = (() => {

  // ── State ─────────────────────────────────────
  const state = {
    user:        null,   // GitHub user object
    repos:       [],     // all repos
    activeRepo:  null,   // currently selected repo key
    connected:   false,
    error:       null,
  };

  // ── DOM refs ───────────────────────────────────
  const dom = {
    dot:      () => document.getElementById('connection-dot'),
    label:    () => document.getElementById('connection-label'),
    username: () => document.getElementById('topbar-username'),
  };

  // ── Status helpers ─────────────────────────────
  function setStatus(state, label) {
    const dot = dom.dot();
    const lbl = dom.label();
    if (!dot || !lbl) return;
    dot.className = 'status-dot';
    if (state !== 'idle') dot.classList.add(state); // 'connected' | 'error'
    lbl.textContent = label;
  }

  function setUsername(name) {
    const el = dom.username();
    if (el) el.textContent = name;
  }

  // ── Init ───────────────────────────────────────
  async function init() {
    // Guard: config must be present
    if (typeof CONFIG === 'undefined') {
      setStatus('error', 'no config.js');
      setUsername('—');
      console.error('[Dashboard] config.js not loaded — copy config.example.js to config.js');
      return;
    }

    // Resolve token from legacy CONFIG.pat or new CONFIG.providers format
    const _providerToken = Array.isArray(CONFIG.providers) &&
      CONFIG.providers.find(p => p.primary)?.auth?.token;
    const _token = CONFIG.pat || _providerToken || '';
    const _username = (Array.isArray(CONFIG.providers) && CONFIG.providers.find(p => p.primary)?.username) ||
      CONFIG.username || '—';

    if (!_token || _token === 'ghp_your_token_here') {
      setStatus('error', 'public mode');
      setUsername(_username);
      console.info('[Dashboard] No PAT — running in public mode (read-only, unauthenticated)');
      return;
    }

    setStatus('idle', 'connecting…');
    setUsername(_username);

    try {
      const user = await Repos.getUser();
      state.user      = user;
      state.connected = true;

      setStatus('connected', 'connected');
      setUsername(user.login);

      console.info(`[Dashboard] Connected as ${user.login}`);
      console.info(`[Dashboard] Rate limit: ${user._rateLimit.remaining}/${user._rateLimit.limit} remaining`);

    } catch (err) {
      state.error = err.message;
      setStatus('error', 'auth failed');
      console.error('[Dashboard] GitHub auth failed:', err.message);
    }
  }

  // ── Public ─────────────────────────────────────
  return {
    init,
    getState: () => ({ ...state }),
  };

})();

// Auto-init on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  Dashboard.init();
  SessionTimer.init();
  UpgradePill.init();
});

// ── Session timer ──────────────────────────────
const SessionTimer = (() => {
  const WARN_MIN  = 40;
  const ALERT_MIN = 55;
  const start     = Date.now();
  let bannerShown = false;

  function pad(n) { return String(n).padStart(2, '0'); }

  function tick() {
    const elapsed = Math.floor((Date.now() - start) / 1000);
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;

    const el     = document.getElementById('timer-display');
    const timer  = document.getElementById('session-timer');
    const banner = document.getElementById('session-banner');
    if (!el || !timer) return;

    el.textContent = `${pad(m)}:${pad(s)}`;

    timer.classList.remove('timer-warn', 'timer-alert');
    if (m >= ALERT_MIN) {
      timer.classList.add('timer-alert');
      if (!bannerShown && banner) {
        banner.style.display = 'flex';
        bannerShown = true;
      }
    } else if (m >= WARN_MIN) {
      timer.classList.add('timer-warn');
    }
  }

  function init() {
    setInterval(tick, 1000);
    tick();
    const dismiss = document.getElementById('session-banner-dismiss');
    if (dismiss) {
      dismiss.addEventListener('click', () => {
        const banner = document.getElementById('session-banner');
        if (banner) banner.style.display = 'none';
      });
    }
  }

  return { init };
})();

// ── Upgrade decision pill v2 (#29a + #29c) ────
const UpgradePill = (() => {

  // ── Parse USAGE_LOG.md ─────────────────────────
  function parseUsageLog(md) {
    const rows = [];
    const lines = md.split('\n');
    let inTable = false;
    for (const line of lines) {
      if (line.startsWith('## Usage log')) { inTable = true; continue; }
      if (inTable && line.startsWith('##')) break;
      if (!inTable || !line.startsWith('|')) continue;
      const cells = line.split('|').map(c => c.trim()).filter(c => c.length > 0);
      if (cells.length < 7) continue;
      if (cells[0] === 'Date' || cells[0].startsWith('-')) continue;
      rows.push({
        date:       cells[0],
        session:    cells[1],
        sessionPct: parseInt(cells[2]) || 0,
        weeklyPct:  parseInt(cells[4]) || 0,
        weight:     cells[6] ? cells[6].toLowerCase() : '',
        notes:      cells[7] || '',
      });
    }
    return rows;
  }

  // ── Parse INVESTMENT.md ────────────────────────
  function parseInvestment(md) {
    if (!md) return { plan: {}, tiers: [], promos: [] };
    const lines = md.split('\n');
    let section = '';
    const plan = {}, tiers = [], promos = [];
    for (const line of lines) {
      if (line.startsWith('## Current Plan'))    { section = 'plan';   continue; }
      if (line.startsWith('## Tier Comparison')) { section = 'tiers';  continue; }
      if (line.startsWith('## Active Promos'))   { section = 'promos'; continue; }
      if (line.startsWith('##'))                 { section = '';       continue; }
      if (line.startsWith('<!--'))               continue;
      if (!line.startsWith('|'))                 continue;
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (cells.every(c => /^[-: ]+$/.test(c))) continue;
      if (section === 'plan' && cells.length >= 2 && cells[0] !== 'Key') {
        plan[cells[0]] = cells[1];
      }
      if (section === 'tiers' && cells.length >= 4 && cells[0] !== 'id') {
        tiers.push({ id: cells[0], label: cells[1], cost: parseInt(cells[2]) || 0,
                     capacity: parseFloat(cells[3]) || 0, notes: cells[4] || '' });
      }
      if (section === 'promos' && cells.length >= 3 && cells[0] !== 'source') {
        const validUntil = cells[2];
        const active = validUntil === 'always' || new Date(validUntil) >= new Date();
        if (active) promos.push({ source: cells[0], discount: cells[1],
                                  validUntil, appliesTo: cells[3] || '', notes: cells[4] || '' });
      }
    }
    return { plan, tiers, promos };
  }

  // ── Recommend specific tier ────────────────────
  function recommend(rows, inv) {
    if (!rows.length) return { level: 'unknown', icon: '—', label: 'no data yet', cls: '' };

    const latest       = rows[rows.length - 1];
    const weeklyPct    = latest.weeklyPct;
    const recentRows   = rows.slice(-5);
    const currentCost  = parseInt(inv.plan.cost_per_month) || 20;
    const billing      = inv.plan.billing || 'monthly';
    const annualOption = parseInt(inv.plan.annual_option) || 17;
    const tiers        = inv.tiers;
    const promos       = inv.promos;

    const highSessionCount = recentRows.filter(r => r.sessionPct >= 90).length;
    const heavyCount       = recentRows.filter(r => r.weight === 'heavy').length;
    const forcedWaits      = recentRows.filter(r => r.notes.toLowerCase().includes('wait')).length;

    const tier = id => tiers.find(t => t.id === id);
    const promoBadge = promos.length > 0
      ? `🎁 ${promos[0].discount} (${promos[0].source})  ·  `
      : '';
    const promoSuffix = promos.length > 0 ? ' promo' : '';

    // ── 🔴 Upgrade now ──
    if (weeklyPct >= 90 || forcedWaits >= 2) {
      let rec;
      if (forcedWaits >= 3 || weeklyPct >= 90) {
        const t = tier('max5x');
        const d = t ? t.cost - currentCost : 80;
        rec = t ? `→ ${t.label}  ·  ${t.capacity}× capacity  ·  +$${d}/mo` : '→ Max 5x  ·  +$80/mo';
      } else {
        const t = tier('hybrid');
        const d = t ? t.cost - currentCost : 10;
        rec = t ? `→ ${t.label}  ·  ~${t.capacity}× capacity  ·  +$${d}/mo` : '→ Smart Hybrid  ·  +$10/mo';
      }
      return { level: 'now', icon: '🔴', label: `${promoBadge}${rec}`, cls: `now${promoSuffix}` };
    }

    // ── ⚠ Upgrade soon ──
    if (weeklyPct >= 75 || highSessionCount >= 3) {
      let rec;
      if (billing === 'monthly') {
        const save = (currentCost - annualOption) * 12;
        rec = `→ Pro Annual  ·  save $${save}/yr  ·  same capacity`;
      } else {
        const t = tier('hybrid');
        const d = t ? t.cost - currentCost : 10;
        rec = t ? `→ ${t.label}  ·  ~${t.capacity}× capacity  ·  +$${d}/mo` : '→ Smart Hybrid';
      }
      return { level: 'soon', icon: '⚠', label: `${promoBadge}${rec}`, cls: `soon${promoSuffix}` };
    }

    // ── ✓ Stay ──
    const promoHint = promos.length > 0 ? `  ·  ${promoBadge.trimEnd().replace(/·\s*$/, '').trim()}` : '';
    return {
      level: 'stay', icon: '✓',
      label: `Stay on Pro  ·  weekly ${weeklyPct}%  ·  ${heavyCount} heavy${promoHint}`,
      cls:   `stay${promoSuffix}`,
    };
  }

  // ── Init ───────────────────────────────────────
  async function init() {
    const pill  = document.getElementById('upgrade-pill');
    const icon  = document.getElementById('upgrade-icon');
    const label = document.getElementById('upgrade-label');
    if (!pill || !icon || !label) return;

    try {
      const [usageMd, investMd] = await Promise.all([
        Repos.getFile(CONFIG.username, CONFIG.dashboardRepo, 'docs/USAGE_LOG.md'),
        Repos.getFile(CONFIG.username, CONFIG.dashboardRepo, 'docs/AI_INVESTMENT.md').catch(() => null),
      ]);
      if (!usageMd) throw new Error('USAGE_LOG.md not found');
      const rows   = parseUsageLog(usageMd);
      const inv    = parseInvestment(investMd);
      const result = recommend(rows, inv);
      pill.className    = `upgrade-pill ${result.cls}`;
      icon.textContent  = result.icon;
      label.textContent = result.label;
    } catch (e) {
      icon.textContent  = '—';
      label.textContent = 'usage data unavailable';
      console.warn('[UpgradePill]', e.message);
    }
  }

  return { init };
})();
