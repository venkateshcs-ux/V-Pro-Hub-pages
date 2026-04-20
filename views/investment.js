// views/investment.js — #29b AI Investment Tracker view
// Shows current plan, weekly usage, tool ranking, break-even calculator, active promos.
// Data sources: docs/AI_INVESTMENT.md + docs/USAGE_LOG.md

window.InvestmentView = (() => {

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── Parsers ───────────────────────────────────────

  function parseKeyValue(md, sectionName) {
    if (!md) return {};
    const section = md.split(/^## /m).find(s => s.startsWith(sectionName));
    if (!section) return {};
    const out = {};
    section.split('\n').forEach(line => {
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (cells.length === 2 && cells[0] && !/^[-: ]+$/.test(cells[0]) && cells[0] !== 'Key') {
        out[cells[0]] = cells[1];
      }
    });
    return out;
  }

  function parseTable(md, sectionName) {
    if (!md) return [];
    const section = md.split(/^## /m).find(s => s.startsWith(sectionName));
    if (!section) return [];
    const rows = [];
    const lines = section.split('\n').filter(l => l.startsWith('|'));
    let headers = [];
    for (const line of lines) {
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (cells.every(c => /^[-: ]+$/.test(c))) continue;
      if (!headers.length) { headers = cells.map(c => c.toLowerCase()); continue; }
      const row = {};
      headers.forEach((h, i) => { row[h] = cells[i] || ''; });
      // Skip comment rows (start with <)
      if (Object.values(row)[0]?.startsWith('<')) continue;
      if (Object.values(row).some(v => v)) rows.push(row);
    }
    return rows;
  }

  function parseUsage(md) {
    if (!md) return { thisWeekCount: 0, forcedWaits: 0, latestWeeklyPct: 0, latestRow: null };
    const rows = parseTable(md, 'Usage log');
    if (!rows.length) return { thisWeekCount: 0, forcedWaits: 0, latestWeeklyPct: 0, latestRow: null };

    const latestRow = rows[rows.length - 1];
    const latestWeeklyPct = parseInt((latestRow['weekly % used'] || '0').replace('%', '')) || 0;

    // Sessions in the last 7 days
    const cutoff = new Date(Date.now() - 7 * 86400000);
    const recent = rows.filter(r => r.date && new Date(r.date) >= cutoff);

    // Forced waits: sessions noting a wait of >1 hour before restart
    const waitPattern = /wait\s+~?\d+\s*(hr|hour)/i;
    const forcedWaits = recent.filter(r => waitPattern.test(r.notes || '')).length;

    return { thisWeekCount: recent.length, forcedWaits, latestWeeklyPct, latestRow };
  }

  function valueScore(tool) {
    const cost  = parseFloat(tool.cost_per_month) || 1;
    const cap   = parseFloat(tool.capacity_factor) || 1;
    const bench = parseFloat(tool.benchmark_score) || 0;
    return (bench * cap) / cost;
  }

  // ── Render helpers ────────────────────────────────

  function statusClass(pct) {
    if (pct >= 90) return 'danger';
    if (pct >= 75) return 'warning';
    return 'success';
  }

  function dotClass(pct) {
    if (pct >= 90) return 'red';
    if (pct >= 75) return 'amber';
    return 'green';
  }

  // ── Plan card ─────────────────────────────────────

  function renderPlanCard(plan, usage) {
    const cost            = parseFloat(plan.cost_per_month || 0);
    const billing         = plan.billing || '—';
    const renewal         = plan.renewal_date || '—';
    const planName        = plan.plan || '—';
    const annualOption    = parseFloat(plan.annual_option || 0);
    const annualSaving    = annualOption > 0 ? ((cost - annualOption) * 12).toFixed(0) : null;

    // Cost per productive hour: each session ≈ 45 min productive work
    const sessionsPerMonth    = Math.max(usage.thisWeekCount * 4, 1);
    const productiveHrs       = (sessionsPerMonth * 45) / 60;
    const costPerHour         = cost > 0 ? '$' + (cost / productiveHrs).toFixed(2) : '—';

    const wPct  = usage.latestWeeklyPct;
    const waits = usage.forcedWaits;

    return `
    <div class="inv-plan-card">
      <div class="inv-card-header">
        <span class="inv-card-title">Current Plan</span>
        <span class="health-status-dot ${dotClass(wPct)}" title="${wPct}% weekly capacity used"></span>
      </div>
      <div class="inv-card-body">
        <div class="inv-stat-row">
          <span class="inv-stat-label">Plan</span>
          <span class="inv-stat-value accent">${escHtml(planName)}</span>
        </div>
        <div class="inv-stat-row">
          <span class="inv-stat-label">Cost</span>
          <span class="inv-stat-value">$${cost}/mo · ${escHtml(billing)}</span>
        </div>
        ${annualSaving ? `<div class="inv-stat-row">
          <span class="inv-stat-label">Annual option</span>
          <span class="inv-stat-value warning">$${annualOption}/mo · saves $${annualSaving}/yr</span>
        </div>` : ''}
        <div class="inv-stat-row">
          <span class="inv-stat-label">Renewal</span>
          <span class="inv-stat-value">${escHtml(renewal)}</span>
        </div>
        <div class="inv-stat-row">
          <span class="inv-stat-label">Weekly usage</span>
          <span class="inv-stat-value ${statusClass(wPct)}">${wPct}%</span>
        </div>
        <div class="inv-stat-row">
          <span class="inv-stat-label">Forced waits</span>
          <span class="inv-stat-value ${waits >= 2 ? 'danger' : waits === 1 ? 'warning' : 'success'}">${waits} this week</span>
        </div>
        <div class="inv-stat-row">
          <span class="inv-stat-label">Est. cost / hr</span>
          <span class="inv-stat-value">${costPerHour} <span class="inv-hint">(~${sessionsPerMonth} sessions/mo)</span></span>
        </div>
      </div>
    </div>`;
  }

  // ── Tool registry table ───────────────────────────

  function renderToolTable(tools, currentPlanName) {
    if (!tools.length) return '';

    const normalise = s => s.toLowerCase().replace(/\s+/g, '-');
    const currentId  = normalise(currentPlanName || '');

    const sorted = [...tools]
      .map(t => ({ ...t, _vs: valueScore(t) }))
      .sort((a, b) => b._vs - a._vs);

    const tbody = sorted.map((t, i) => {
      const isCurrent = t.id === currentId || t.id === 'claude-pro' && currentId === 'pro';
      return `<tr class="${isCurrent ? 'inv-current-row' : ''}">
        <td class="inv-rank">${i + 1}</td>
        <td class="inv-tool-name">
          ${escHtml(t.name)}
          ${isCurrent ? '<span class="inv-current-badge">current</span>' : ''}
        </td>
        <td><span class="inv-type-badge inv-type-${escHtml(t.type)}">${escHtml(t.type)}</span></td>
        <td>$${escHtml(t.cost_per_month)}/mo</td>
        <td class="inv-cap">${escHtml(t.capacity_factor)}×</td>
        <td class="inv-bench">${escHtml(t.benchmark_score)}</td>
        <td class="inv-score-cell">${t._vs.toFixed(1)}</td>
      </tr>`;
    }).join('');

    return `
    <div class="inv-section">
      <div class="inv-section-header">
        <span class="inv-section-title">Tool Registry</span>
        <span class="inv-section-sub">value_score = (benchmark × capacity) ÷ cost — higher is better</span>
      </div>
      <div class="inv-table-wrap">
        <table class="inv-table">
          <thead>
            <tr>
              <th>#</th><th>Tool</th><th>Type</th><th>Cost</th>
              <th>Cap</th><th>Bench</th><th>Score ▼</th>
            </tr>
          </thead>
          <tbody>${tbody}</tbody>
        </table>
      </div>
    </div>`;
  }

  // ── Break-even calculator ─────────────────────────

  function renderBreakEven(plan, tiers) {
    if (!tiers.length) return '';
    const currentCost = parseFloat(plan.cost_per_month || 20);
    const planName    = plan.plan || 'current';

    const rows = tiers
      .filter(t => t.id !== 'pro' && parseFloat(t.cost_per_month || 0) > currentCost)
      .map(t => {
        const delta = parseFloat(t.cost_per_month) - currentCost;
        // Each forced wait ≈ 45 min at ~$50/hr knowledge work = $37.50 of lost time
        const waitsNeeded = (delta / 37.5).toFixed(1);
        const hoursNeeded = (delta / 50).toFixed(1);
        return `<div class="inv-be-row">
          <div class="inv-be-upgrade">${escHtml(t.label)}</div>
          <div class="inv-be-delta">+$${delta}/mo</div>
          <div class="inv-be-detail">
            Break-even: <strong>${waitsNeeded} forced waits/mo</strong>
            <span class="inv-hint"> · or ${hoursNeeded} hr/mo saved @ $50/hr</span>
          </div>
          <div class="inv-be-note muted">${escHtml(t.notes)}</div>
        </div>`;
      }).join('');

    if (!rows) return '';

    return `
    <div class="inv-section">
      <div class="inv-section-header">
        <span class="inv-section-title">Break-even vs ${escHtml(planName)}</span>
        <span class="inv-section-sub">assumes $50/hr knowledge work value · 45 min per forced wait</span>
      </div>
      <div class="inv-be-list">${rows}</div>
    </div>`;
  }

  // ── Active promos ─────────────────────────────────

  function renderPromos(promos) {
    const now    = new Date();
    const active = promos.filter(p => {
      if (!p.valid_until || p.valid_until.toLowerCase() === 'always') return true;
      return new Date(p.valid_until) >= now;
    });
    if (!active.length) return '';

    const rows = active.map(p => `
      <div class="inv-promo-row">
        <span class="inv-promo-icon">🎁</span>
        <span class="inv-promo-discount">${escHtml(p.discount)}</span>
        <span class="inv-promo-applies">· ${escHtml(p.applies_to)}</span>
        <span class="muted inv-promo-note">${escHtml(p.notes)}</span>
      </div>`).join('');

    return `
    <div class="inv-section">
      <div class="inv-section-header">
        <span class="inv-section-title">Active Promos</span>
      </div>
      <div class="inv-promos">${rows}</div>
    </div>`;
  }

  // ── Skeleton ──────────────────────────────────────

  function renderSkeleton() {
    return `
    <div class="inv-header">
      <h1 class="inv-title">AI Investment</h1>
      <p class="muted" style="font-size:13px">Loading…</p>
    </div>
    <div class="inv-top-grid">
      <div class="inv-plan-card">
        ${[1,2,3,4].map(() => `<div class="health-row"><div class="skel-line" style="width:100%;height:11px"></div></div>`).join('')}
      </div>
    </div>`;
  }

  // ── Main render ───────────────────────────────────

  async function render(container) {
    container.innerHTML = renderSkeleton();

    try {
      const [investMd, usageMd] = await Promise.all([
        Repos.getFile(CONFIG.username, CONFIG.dashboardRepo, 'docs/AI_INVESTMENT.md').catch(() => null),
        Repos.getFile(CONFIG.username, CONFIG.dashboardRepo, 'docs/USAGE_LOG.md').catch(() => null),
      ]);

      const plan   = parseKeyValue(investMd, 'Current Plan');
      const tools  = parseTable(investMd, 'Tool Registry');
      const tiers  = parseTable(investMd, 'Tier Comparison');
      const promos = parseTable(investMd, 'Active Promos');
      const usage  = parseUsage(usageMd);

      if (!investMd) {
        container.innerHTML = `<div class="view-placeholder">
          <div class="placeholder-inner">
            <span class="placeholder-icon" style="color:var(--warning)">⚠</span>
            <h2>AI Investment data not found</h2>
            <p class="muted">docs/AI_INVESTMENT.md has not been committed to GitHub yet.</p>
            <p class="muted" style="margin-top:8px">Commit the file and reload.</p>
          </div>
        </div>`;
        return;
      }

      container.innerHTML = `
        <div class="inv-header">
          <h1 class="inv-title">AI Investment</h1>
          <p class="muted" style="font-size:13px">Source: docs/AI_INVESTMENT.md · docs/USAGE_LOG.md</p>
        </div>
        <div class="inv-top-grid">
          ${renderPlanCard(plan, usage)}
        </div>
        ${renderPromos(promos)}
        ${renderToolTable(tools, plan.plan)}
        ${renderBreakEven(plan, tiers)}
      `;
    } catch (err) {
      container.innerHTML = `<div class="view-placeholder">
        <div class="placeholder-inner">
          <span class="placeholder-icon" style="color:var(--danger)">✕</span>
          <h2>Failed to load investment data</h2>
          <p class="muted">${escHtml(err.message)}</p>
          <button class="btn-retry" onclick="InvestmentView.render(document.getElementById('main-content'))">Retry</button>
        </div>
      </div>`;
    }
  }

  return { render };

})();
