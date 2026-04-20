// views/sprint.js — Sprint Dashboard (#38)
// Data sources: docs/SPRINTS.md (index) · docs/sprints/SP-*.md (detail) · docs/BACKLOG.md (items)

window.SprintView = (() => {

  // ── Helpers ──────────────────────────────────────────

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function daysBetween(isoA, isoB) {
    const a = new Date(isoA + 'T00:00:00');
    const b = new Date(isoB + 'T00:00:00');
    return Math.round((b - a) / 86400000);
  }

  function todayIso() {
    return new Date().toISOString().split('T')[0];
  }

  // ── YAML frontmatter parser ───────────────────────────
  // Handles: string, number, null, boolean, array [1,2,3]

  function parseFrontmatter(md) {
    const match = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return {};
    const result = {};
    for (const line of match[1].split('\n')) {
      const m = line.match(/^([\w_]+):\s*(.*)/);
      if (!m) continue;
      const key = m[1];
      const raw = m[2].trim();
      if (raw === 'null' || raw === '') { result[key] = null; continue; }
      if (raw === 'true')               { result[key] = true; continue; }
      if (raw === 'false')              { result[key] = false; continue; }
      if (/^-?\d+(\.\d+)?$/.test(raw)) { result[key] = parseFloat(raw); continue; }
      if (/^\[.*\]$/.test(raw)) {
        result[key] = raw.slice(1, -1)
          .split(',')
          .map(s => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean)
          .map(s => /^-?\d+(\.\d+)?$/.test(s) ? parseFloat(s) : s);
        continue;
      }
      result[key] = raw.replace(/^["']|["']$/g, '');
    }
    return result;
  }

  // ── SPRINTS.md index parser ───────────────────────────
  // Returns [{ id, num, start, end, days, theme, status }]

  function parseSprintsIndex(md) {
    const sprints = [];
    const lines   = md.split('\n');
    let inTable   = false;
    let hasHeader = false;

    for (const line of lines) {
      if (/^## Sprints/.test(line))              { inTable = true;  hasHeader = false; continue; }
      if (inTable && /^## /.test(line))           { inTable = false; continue; }
      if (!inTable || !line.startsWith('|'))       continue;

      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) continue;

      if (!hasHeader) { hasHeader = true; continue; } // skip header row

      if (cells[0] && cells[0] !== '—') {
        sprints.push({
          id:     cells[0] || '',
          num:    parseInt(cells[1]) || 0,
          start:  cells[2] || '',
          end:    cells[3] || '',
          days:   parseInt(cells[4]) || 7,
          theme:  cells[5] || '',
          status: (cells[6] || 'planned').trim(),
        });
      }
    }
    return sprints;
  }

  // ── Sprint plan section parser ────────────────────────
  // Parses ## Plan table → [{ priority, id, name, scope, est_h, model }]

  function parsePlanSection(md) {
    const items  = [];
    const lines  = md.split('\n');
    let inPlan   = false;
    let hasHeader = false;

    for (const line of lines) {
      if (/^## Plan/.test(line))           { inPlan = true; hasHeader = false; continue; }
      if (inPlan && /^## /.test(line))     { inPlan = false; continue; }
      if (!inPlan || !line.startsWith('|')) continue;

      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) continue;

      if (!hasHeader) { hasHeader = true; continue; }

      if (cells.length >= 5 && /^P\d+$/.test(cells[0])) {
        items.push({
          priority: cells[0],
          id:       parseInt(cells[1]) || 0,
          name:     cells[2] || '',
          scope:    cells[3] || '?',
          est_h:    parseFloat(cells[4]) || 0,
          model:    cells[5] || '',
        });
      }
    }
    return items;
  }

  // ── Adaptation log parser ─────────────────────────────
  // Returns real entries (filters "no entries yet" placeholder)

  function parseAdaptations(md) {
    const entries = [];
    const lines   = md.split('\n');
    let inAdapt   = false;
    let hasHeader = false;

    for (const line of lines) {
      if (/^## Adaptation log/.test(line))  { inAdapt = true; hasHeader = false; continue; }
      if (inAdapt && /^## /.test(line))     { inAdapt = false; continue; }
      if (!inAdapt || !line.startsWith('|')) continue;

      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) continue;
      if (!hasHeader) { hasHeader = true; continue; }

      if (cells[0] && cells[0] !== '—' && !cells.some(c => /no entries yet/i.test(c))) {
        entries.push({ session: cells[0], date: cells[1] || '', kind: cells[2] || '' });
      }
    }
    return entries;
  }

  // ── Daily log parser ──────────────────────────────────
  // Returns [{ date, entries: [{ sessionId, header, bullets[] }] }]

  function parseDailyLog(md) {
    const days   = [];
    const lines  = md.split('\n');
    let inLog    = false;
    let curDay   = null;
    let curEntry = null;

    const flush = () => { if (curEntry && curDay) { curDay.entries.push(curEntry); curEntry = null; } };

    for (const line of lines) {
      if (/^## Daily log/.test(line))   { inLog = true; continue; }
      if (inLog && /^## /.test(line))   { flush(); inLog = false; continue; }
      if (!inLog) continue;

      const dayMatch = line.match(/^### (.+)/);
      if (dayMatch) {
        flush();
        curDay = { date: dayMatch[1], entries: [] };
        days.push(curDay);
        continue;
      }

      const sessMatch = line.match(/^- \*\*([^*]+)\*\*/);
      if (sessMatch && curDay) {
        flush();
        const header  = sessMatch[1];
        const idMatch = header.match(/^(S\d+[-\w]*)/i);
        curEntry = { sessionId: idMatch ? idMatch[1] : '', header, bullets: [] };
        continue;
      }

      if (curEntry && /^\s{2,}- /.test(line)) {
        curEntry.bullets.push(line.replace(/^\s{2,}- /, '').trim());
      }
    }
    flush();
    return days;
  }

  // ── Backlog items parser ──────────────────────────────
  // Returns { id(number) → { name, status, priority } }

  function parseBacklogMap(md) {
    const map     = {};
    const lines   = md.split('\n');
    let inBacklog = false;
    let headers   = [];

    for (const line of lines) {
      if (/^## Backlog$/.test(line))           { inBacklog = true; headers = []; continue; }
      if (inBacklog && /^## /.test(line))       { inBacklog = false; continue; }
      if (!inBacklog || !line.startsWith('|'))  continue;

      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) continue;

      if (cells[0] === '#') {
        headers = cells.map(c => c.toLowerCase().replace(/[()]/g, '').trim());
        continue;
      }

      if (headers.length && /^\d+$/.test(cells[0])) {
        const iName = headers.indexOf('name');
        const iStat = headers.findIndex(h => h === 'status');
        const iPri  = headers.findIndex(h => h === 'priority');
        const id    = parseInt(cells[0]);
        map[id] = {
          id,
          name:     iName >= 0 ? cells[iName] || '' : '',
          status:   iStat >= 0 ? cells[iStat] || '' : '',
          priority: iPri  >= 0 ? cells[iPri]  || '' : '',
        };
      }
    }
    return map;
  }

  // ── Sprint-ready AC parser ────────────────────────────
  // Returns { itemId → { done, total } }

  function parseSprintReadyAC(md) {
    const acMap  = {};
    const lines  = md.split('\n');
    let inReady  = false;
    let curId    = null;

    for (const line of lines) {
      if (/^## Sprint-ready items/.test(line)) { inReady = true; continue; }
      if (inReady && /^## /.test(line))        { inReady = false; continue; }
      if (!inReady) continue;

      const hm = line.match(/^### #(\d+)/);
      if (hm) { curId = parseInt(hm[1]); if (!acMap[curId]) acMap[curId] = { done: 0, total: 0 }; continue; }

      if (curId !== null) {
        if (/^\s*- \[x\]/i.test(line)) { acMap[curId].done++; acMap[curId].total++; }
        else if (/^\s*- \[ \]/.test(line)) { acMap[curId].total++; }
      }
    }
    return acMap;
  }

  // ── Column classifier ─────────────────────────────────

  function statusToColumn(status) {
    const s = status || '';
    if (/Done\s*✓|done ✓|\bdone\b/i.test(s) && !/in progress/i.test(s)) return 'done';
    if (/in progress/i.test(s) && !/⏸/.test(s))                          return 'in-progress';
    if (/⏸|blocked/i.test(s))                                             return 'blocked';
    return 'not-started';
  }

  // ── Health metrics ────────────────────────────────────

  function computeHealthMetrics(frontmatter, planItems, backlogMap, adaptations, dailyLog) {
    const committed   = (frontmatter.committed_items || []).map(Number);
    const today       = todayIso();
    const dayOfSprint = Math.max(1, daysBetween(frontmatter.start || today, today) + 1);
    const totalDays   = frontmatter.length_days || 7;

    const items = committed.map(id => ({
      id,
      column: statusToColumn((backlogMap[id] || {}).status || ''),
    }));

    const total     = items.length;
    const delivered = items.filter(i => i.column === 'done').length;

    // Delivery ratio
    const deliveryRatio = total > 0 ? delivered / total : 0;

    // Estimate drift — actual hours from daily log bullets
    let actualH = null;
    for (const day of dailyLog) {
      for (const e of day.entries) {
        const ef = e.bullets.find(b => /^effort_hours:\s*[\d.]+/.test(b));
        if (ef) { if (actualH === null) actualH = 0; actualH += parseFloat(ef.match(/[\d.]+/)[0]); }
      }
    }
    const totalEstH = planItems.reduce((s, p) => s + (p.est_h || 0), 0);
    const drift     = (actualH !== null && totalEstH > 0) ? actualH / totalEstH : null;

    // Scope stability
    const scopeStab = total > 0 ? adaptations.length / total : 0;

    // Burn pace
    const expectedRatio = dayOfSprint / totalDays;
    const actualRatio   = total > 0 ? delivered / total : 0;
    const burnPace      = expectedRatio > 0 ? actualRatio / expectedRatio : null;

    // Focus average
    const focusRatings = [];
    for (const day of dailyLog) {
      for (const e of day.entries) {
        const fr = e.bullets.find(b => /^focus_rating:\s*\d/.test(b));
        if (fr) focusRatings.push(parseInt(fr.match(/\d/)[0]));
      }
    }
    const focusAvg = focusRatings.length > 0 ? focusRatings.reduce((s, n) => s + n, 0) / focusRatings.length : null;

    // Goal confidence drift
    const confPlan  = frontmatter.goal_confidence_plan ?? frontmatter.goal_confidence ?? null;
    const confClose = frontmatter.goal_confidence_close ?? null;
    const confDrift = (confPlan !== null && confClose !== null) ? confClose - confPlan : null;

    function band(v, greenFn, amberFn) {
      if (v === null) return 'na';
      if (greenFn(v)) return 'green';
      if (amberFn(v)) return 'amber';
      return 'red';
    }

    return {
      delivery: {
        label:   'Delivery',
        display: total > 0 ? `${delivered}/${total}` : '—',
        value:   deliveryRatio,
        band:    (delivered === 0 && dayOfSprint <= 2)
                   ? 'na'
                   : band(deliveryRatio, v => v >= 0.8, v => v >= 0.5),
      },
      drift: {
        label:   'Est Drift',
        display: drift !== null ? drift.toFixed(2) : '—',
        value:   drift,
        band:    band(drift, v => v >= 0.8 && v <= 1.2, v => (v >= 0.6 && v < 0.8) || (v > 1.2 && v <= 1.5)),
      },
      scope: {
        label:   'Scope',
        display: scopeStab.toFixed(2),
        value:   scopeStab,
        band:    band(scopeStab, v => v <= 0.2, v => v <= 0.4),
      },
      burn: {
        label:   'Burn',
        display: dayOfSprint <= 1 ? '—' : (burnPace !== null ? burnPace.toFixed(2) : '—'),
        value:   burnPace,
        band:    dayOfSprint <= 1
                   ? 'na'
                   : band(burnPace, v => v >= 0.9 && v <= 1.1, v => (v >= 0.6 && v < 0.9) || (v > 1.1 && v <= 1.3)),
      },
      focus: {
        label:   'Focus',
        display: focusAvg !== null ? focusAvg.toFixed(1) : '—',
        value:   focusAvg,
        band:    band(focusAvg, v => v >= 3.8, v => v >= 2.8),
      },
      confDrift: {
        label:   'Conf ±',
        display: confDrift !== null
                   ? (confDrift >= 0 ? `+${confDrift}` : String(confDrift))
                   : (confPlan !== null ? `${confPlan}/5` : '—'),
        value:   confDrift,
        band:    confDrift === null ? 'na' : band(confDrift, v => v >= 0, v => v >= -1),
      },
    };
  }

  // ── Drift flags ───────────────────────────────────────

  function computeDriftFlags(metrics, adaptations) {
    const flags = [];

    if (metrics.burn.band === 'red' && metrics.burn.value !== null) {
      flags.push({
        icon: '🔴',
        message: `Burn pace is ${metrics.burn.display} — behind expected sprint pace.`,
        recommendation: 'Trigger Adaptation Check: swap or drop a committed item.',
      });
    }

    if (metrics.scope.band === 'red') {
      flags.push({
        icon: '🔴',
        message: `Scope stability is ${metrics.scope.display} — ${adaptations.length} adaptation${adaptations.length !== 1 ? 's' : ''} this sprint.`,
        recommendation: 'Stop adding scope. Swap or defer.',
      });
    } else if (metrics.scope.band === 'amber') {
      flags.push({
        icon: '🟡',
        message: `Scope stability at ${metrics.scope.display} — ${adaptations.length} adaptation${adaptations.length !== 1 ? 's' : ''} this sprint. Consider swap before adding more.`,
        recommendation: 'Default is swap-not-add.',
      });
    }

    if (metrics.confDrift.band === 'red') {
      flags.push({
        icon: '🔴',
        message: `Goal confidence dropped ${metrics.confDrift.display}.`,
        recommendation: 'Consider Initiative Review or early retro.',
      });
    }

    return flags;
  }

  // ── Skeleton ──────────────────────────────────────────

  function renderSkeleton() {
    return `
      <div class="sprint-header" style="margin-bottom:24px">
        <div class="skel-line" style="width:160px;height:22px;border-radius:20px"></div>
        <div class="skel-line" style="width:55%;height:22px;margin-top:14px"></div>
        <div class="skel-line" style="width:75%;height:13px;margin-top:10px"></div>
      </div>
      <div class="health-strip-wrap">
        <div class="skel-line" style="width:60px;height:11px;margin-bottom:10px"></div>
        <div class="health-strip">
          ${Array(6).fill('<div class="skel-line" style="width:84px;height:30px;border-radius:20px"></div>').join('')}
        </div>
      </div>`;
  }

  // ── Health pill ───────────────────────────────────────

  function renderHealthPill(key, metric) {
    const cls  = metric.band === 'green' ? 'hp-green'
               : metric.band === 'amber' ? 'hp-amber'
               : metric.band === 'red'   ? 'hp-red'
               : 'hp-na';
    const icon = metric.band === 'green' ? '🟢'
               : metric.band === 'amber' ? '🟡'
               : metric.band === 'red'   ? '🔴'
               : '⚪';
    return `<div class="health-pill ${cls}">
      <span class="hp-icon">${icon}</span>
      <span class="hp-label">${escHtml(metric.label)}</span>
      <span class="hp-value">${escHtml(metric.display)}</span>
    </div>`;
  }

  // ── Kanban card ───────────────────────────────────────

  function renderKanbanCard(item, acMap) {
    const ac        = acMap[item.id];
    const scopeCls  = item.scope === 'XL' ? 'scope-xl'
                    : item.scope === 'L'  ? 'scope-l'
                    : item.scope === 'M'  ? 'scope-m'
                    : 'scope-s';
    const nameShort = item.name.length > 52 ? item.name.slice(0, 50) + '…' : item.name;
    const modelShort = (item.model || '')
      .replace(/Claude Code\s*\/\s*/i, '')
      .replace('Sonnet 4.6', 'S4.6')
      .replace('Opus 4.7', 'O4.7')
      .trim();

    return `<div class="kanban-card">
      <div class="kc-header">
        <span class="kc-id">#${escHtml(String(item.id))}</span>
        <span class="kc-scope ${scopeCls}">${escHtml(item.scope)}</span>
      </div>
      <div class="kc-name">${escHtml(nameShort)}</div>
      <div class="kc-footer">
        ${modelShort  ? `<span class="kc-model">${escHtml(modelShort)}</span>` : ''}
        ${ac          ? `<span class="kc-ac">${ac.done}/${ac.total} AC</span>` : ''}
        ${item.est_h  ? `<span class="kc-est">${item.est_h}h</span>` : ''}
      </div>
    </div>`;
  }

  // ── Kanban column ─────────────────────────────────────

  function renderKanbanColumn(colId, icon, label, items, acMap) {
    const colItems = items.filter(i => i.column === colId);
    return `<div class="kanban-col">
      <div class="kanban-col-header">
        <span class="kch-icon">${icon}</span>
        <span class="kch-label">${escHtml(label)}</span>
        <span class="kch-count">${colItems.length}</span>
      </div>
      <div class="kanban-col-body">
        ${colItems.length > 0
          ? colItems.map(i => renderKanbanCard(i, acMap)).join('')
          : '<div class="kc-empty">—</div>'}
      </div>
    </div>`;
  }

  // ── Table row ─────────────────────────────────────────

  function renderTableRow(item, acMap) {
    const ac       = acMap[item.id];
    const colLabel = item.column === 'done'        ? '✓ Done'
                   : item.column === 'in-progress' ? '▶ In Progress'
                   : item.column === 'blocked'     ? '⏸ Blocked'
                   : '⏳ Not Started';
    const colCls   = item.column === 'done'        ? 'col-done'
                   : item.column === 'in-progress' ? 'col-active'
                   : item.column === 'blocked'     ? 'col-blocked'
                   : 'col-pending';
    const nm = item.name.length > 65 ? item.name.slice(0, 63) + '…' : item.name;

    return `<tr class="st-row">
      <td class="st-id">#${escHtml(String(item.id))}</td>
      <td class="st-name">${escHtml(nm)}</td>
      <td class="st-scope">${escHtml(item.scope)}</td>
      <td class="st-est">${item.est_h ? item.est_h + 'h' : '—'}</td>
      <td class="st-ac">${ac ? `${ac.done}/${ac.total}` : '—'}</td>
      <td><span class="st-status ${colCls}">${escHtml(colLabel)}</span></td>
    </tr>`;
  }

  // ── Sessions log ──────────────────────────────────────

  function renderSessionsLog(dailyLog) {
    const hasSessions = dailyLog.some(d => d.entries.length > 0);
    if (!hasSessions) return '<div class="sprint-sessions-empty">No sessions logged yet this sprint.</div>';

    return dailyLog.filter(d => d.entries.length).map(day => {
      const entries = day.entries.map(e => `
        <div class="sl-entry">
          <div class="sl-header">${escHtml(e.header)}</div>
          ${e.bullets.length ? `<ul class="sl-bullets">
            ${e.bullets.slice(0, 4).map(b => `<li>${escHtml(b)}</li>`).join('')}
            ${e.bullets.length > 4 ? `<li class="sl-more">+${e.bullets.length - 4} more…</li>` : ''}
          </ul>` : ''}
        </div>`).join('');
      return `<div class="sl-day">
        <div class="sl-date">${escHtml(day.date)}</div>
        ${entries}
      </div>`;
    }).join('');
  }

  // ── Bootstrap state ───────────────────────────────────

  function renderBootstrap(container) {
    container.innerHTML = `<div class="sprint-view">
      <div class="sprint-bootstrap">
        <span class="sprint-boot-icon">▶</span>
        <h2>No active sprint yet</h2>
        <p class="muted">Run a Sprint Planning session to get started.</p>
        <div class="sprint-boot-steps">
          <div class="boot-step"><span class="boot-step-num">1</span>Groom backlog — add Scope + Acceptance Criteria to items you want to commit</div>
          <div class="boot-step"><span class="boot-step-num">2</span>Create <code>docs/SPRINTS.md</code> + <code>docs/sprints/SP-*.md</code> in a Planning session</div>
          <div class="boot-step"><span class="boot-step-num">3</span>Set <code>status: active</code> in the sprint file — this view auto-detects it</div>
        </div>
        <a class="sprint-boot-link" href="https://github.com/${escHtml(CONFIG.username)}/V-Pro-Hub/blob/master/docs/AGILE.md" target="_blank" rel="noopener noreferrer">Read AGILE.md ↗</a>
      </div>
    </div>`;
  }

  // ── Between state ─────────────────────────────────────

  function renderBetween(container, lastSprint) {
    container.innerHTML = `<div class="sprint-view">
      <div class="sprint-between">
        <div class="sb-badge">Sprint ${escHtml(String(lastSprint.num))} closed</div>
        <h2>${escHtml(lastSprint.theme)}</h2>
        <p class="muted">Last sprint closed ${escHtml(lastSprint.end)}. Time to plan the next one.</p>
        <div class="sb-actions">
          <div class="sb-action">Plan Sprint ${escHtml(String(lastSprint.num + 1))} →</div>
        </div>
      </div>
    </div>`;
  }

  // ── Active state ──────────────────────────────────────

  function renderActive(container, sprint, frontmatter, planItems, backlogMap, acMap, adaptations, dailyLog) {
    const today       = todayIso();
    const dayOfSprint = Math.max(1, daysBetween(frontmatter.start || today, today) + 1);
    const totalDays   = frontmatter.length_days || 7;
    const daysLeft    = Math.max(0, daysBetween(today, frontmatter.end || today));
    const committed   = (frontmatter.committed_items || []).map(Number);
    const stretch     = (frontmatter.stretch_items || []).map(Number);

    const items = committed.map(id => {
      const planItem = planItems.find(p => p.id === id) || {};
      const bl       = backlogMap[id] || {};
      return {
        id,
        name:   bl.name || planItem.name || `Item #${id}`,
        scope:  planItem.scope || '?',
        est_h:  planItem.est_h || 0,
        model:  planItem.model || '',
        status: bl.status || '',
        column: statusToColumn(bl.status || ''),
      };
    });

    const metrics    = computeHealthMetrics(frontmatter, planItems, backlogMap, adaptations, dailyLog);
    const driftFlags = computeDriftFlags(metrics, adaptations);
    const done       = items.filter(i => i.column === 'done').length;
    const donePct    = committed.length > 0 ? Math.round((done / committed.length) * 100) : 0;
    const totalSessions = dailyLog.reduce((s, d) => s + d.entries.length, 0);

    const statusLabel = metrics.burn.band === 'red'   ? '🔴 behind'
                      : metrics.burn.band === 'amber' ? '🟡 watch'
                      : dayOfSprint === 1             ? '▶ started'
                      : '🟢 on track';

    container.innerHTML = `
    <div class="sprint-view">

      <!-- Sprint header -->
      <div class="sprint-header">
        <div class="sprint-header-top">
          <div class="sprint-id-badge">Sprint ${escHtml(String(frontmatter.sprint_number))} · ${escHtml(sprint.id)}</div>
          <div class="sprint-status-badge">${statusLabel}</div>
        </div>
        <h1 class="sprint-title">${escHtml(frontmatter.theme || sprint.theme || '')}</h1>
        <div class="sprint-goal">${escHtml(frontmatter.goal || '')}</div>
        <div class="sprint-meta-row">
          <span class="sprint-meta-item">Day ${dayOfSprint} of ${totalDays}</span>
          <span class="sprint-meta-sep">·</span>
          <span class="sprint-meta-item">${daysLeft} day${daysLeft !== 1 ? 's' : ''} left</span>
          <span class="sprint-meta-sep">·</span>
          <span class="sprint-meta-item">${escHtml(frontmatter.start || '')} → ${escHtml(frontmatter.end || '')}</span>
          <span class="sprint-meta-sep">·</span>
          <span class="sprint-meta-item">Confidence at plan: ${frontmatter.goal_confidence_plan ?? '—'}/5</span>
        </div>
        <div class="sprint-progress-wrap">
          <div class="sprint-progress-bar">
            <div class="sprint-progress-fill" style="width:${donePct}%"></div>
          </div>
          <span class="sprint-progress-label">${donePct}% delivered (${done}/${committed.length})</span>
        </div>
      </div>

      <!-- Health strip -->
      <div class="health-strip-wrap">
        <div class="section-label">Health</div>
        <div class="health-strip">
          ${Object.entries(metrics).map(([k, m]) => renderHealthPill(k, m)).join('')}
        </div>
      </div>

      <!-- Sprint backlog -->
      <div class="sprint-backlog-wrap">
        <div class="sprint-backlog-header">
          <div class="section-label" style="margin-bottom:0">Sprint Backlog</div>
          <div class="view-toggle">
            <button class="vt-btn vt-active" id="btn-board" onclick="SprintView._setView('board')">Board</button>
            <button class="vt-btn" id="btn-table" onclick="SprintView._setView('table')">Table</button>
          </div>
        </div>

        <div id="sprint-board-view" class="kanban-board">
          ${renderKanbanColumn('not-started', '⏳', 'Not Started', items, acMap)}
          ${renderKanbanColumn('in-progress', '▶',  'In Progress', items, acMap)}
          ${renderKanbanColumn('blocked',     '⏸',  'Blocked',     items, acMap)}
          ${renderKanbanColumn('done',        '✓',  'Done',        items, acMap)}
        </div>

        <div id="sprint-table-view" class="sprint-table-wrap" style="display:none">
          <table class="sprint-table">
            <thead><tr>
              <th>#</th><th>Item</th><th>Scope</th><th>Est</th><th>AC</th><th>Status</th>
            </tr></thead>
            <tbody>${items.map(i => renderTableRow(i, acMap)).join('')}</tbody>
          </table>
          ${stretch.length > 0 ? `
            <div class="stretch-label">Stretch items</div>
            <table class="sprint-table">
              <tbody>
                ${stretch.map(id => {
                  const bl = backlogMap[id] || {};
                  const nm = (bl.name || `#${id}`).slice(0, 65);
                  return `<tr class="st-row st-stretch">
                    <td class="st-id">#${escHtml(String(id))}</td>
                    <td class="st-name" colspan="4">${escHtml(nm)}</td>
                    <td><span class="st-status col-pending">Stretch</span></td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>` : ''}
        </div>
      </div>

      <!-- Drift flags -->
      ${driftFlags.length > 0 ? `
        <div class="drift-flags-wrap">
          <div class="section-label">Drift Flags</div>
          <div class="drift-flags">
            ${driftFlags.map(f => `
              <div class="drift-flag">
                <span class="df-icon">${f.icon}</span>
                <div class="df-body">
                  <div class="df-message">${escHtml(f.message)}</div>
                  <div class="df-recommendation">${escHtml(f.recommendation)}</div>
                </div>
              </div>`).join('')}
          </div>
        </div>` : ''}

      <!-- Sessions this sprint (collapsible, open by default) -->
      <details class="sprint-section-collapsible" open>
        <summary class="sprint-section-summary">
          <span class="section-label inline">Sessions this sprint</span>
          <span class="ssc-count">${totalSessions} session${totalSessions !== 1 ? 's' : ''}</span>
        </summary>
        <div class="sprint-sessions-log">
          ${renderSessionsLog(dailyLog)}
        </div>
      </details>

      <!-- Projects at a glance (collapsible, closed by default) -->
      <details class="sprint-section-collapsible">
        <summary class="sprint-section-summary">
          <span class="section-label inline">Projects at a glance</span>
          <span class="ssc-hint">multi-tool projects</span>
        </summary>
        <div class="sprint-projects-panel">
          <p class="muted" style="font-size:12px;margin-bottom:12px">
            Multi-tool projects tracked in V-Pro-Hub — each with a <code>_FEED.md</code> pointing to the next step.
          </p>
          <a class="sprint-orch-link" href="#/orchestrator">Open full Orchestrator ↗</a>
        </div>
      </details>

    </div>`;
  }

  // ── View toggle (called from inline onclick) ──────────

  function _setView(which) {
    const board = document.getElementById('sprint-board-view');
    const table = document.getElementById('sprint-table-view');
    const btnB  = document.getElementById('btn-board');
    const btnT  = document.getElementById('btn-table');
    if (!board || !table) return;
    if (which === 'board') {
      board.style.display = '';   table.style.display = 'none';
      btnB.classList.add('vt-active'); btnT.classList.remove('vt-active');
    } else {
      board.style.display = 'none'; table.style.display = '';
      btnT.classList.add('vt-active'); btnB.classList.remove('vt-active');
    }
  }

  // ── Error state ───────────────────────────────────────

  function renderError(container, msg) {
    container.innerHTML = `<div class="sprint-view">
      <div class="view-placeholder"><div class="placeholder-inner">
        <span class="placeholder-icon" style="color:var(--danger)">✕</span>
        <h2>Sprint Dashboard failed to load</h2>
        <p class="muted">${escHtml(msg)}</p>
        <button class="btn-retry" onclick="SprintView.render(document.getElementById('main-content'))">Retry</button>
      </div></div>
    </div>`;
  }

  // ── Main render ───────────────────────────────────────

  async function render(container) {
    container.innerHTML = `<div class="sprint-view">${renderSkeleton()}</div>`;

    try {
      const sprintsMd = await Repos.getFile(CONFIG.username, 'V-Pro-Hub', 'docs/SPRINTS.md');
      if (!sprintsMd) throw new Error('docs/SPRINTS.md not found');

      const sprints = parseSprintsIndex(sprintsMd);
      const active  = sprints.find(s => s.status === 'active');
      const closed  = sprints.filter(s => s.status === 'closed');

      if (!active) {
        return sprints.length === 0 || closed.length === 0
          ? renderBootstrap(container)
          : renderBetween(container, closed[closed.length - 1]);
      }

      const sprintPath = `docs/sprints/SP-${active.start}.md`;
      const sprintMd   = await Repos.getFile(CONFIG.username, 'V-Pro-Hub', sprintPath);
      if (!sprintMd) throw new Error(`Sprint file not found: ${sprintPath}`);

      const frontmatter = parseFrontmatter(sprintMd);
      const planItems   = parsePlanSection(sprintMd);
      const adaptations = parseAdaptations(sprintMd);
      const dailyLog    = parseDailyLog(sprintMd);

      const backlogMd  = await Repos.getFile(CONFIG.username, 'V-Pro-Hub', 'docs/BACKLOG.md');
      const backlogMap = backlogMd ? parseBacklogMap(backlogMd)    : {};
      const acMap      = backlogMd ? parseSprintReadyAC(backlogMd) : {};

      renderActive(container, active, frontmatter, planItems, backlogMap, acMap, adaptations, dailyLog);

    } catch (err) {
      console.error('[SprintView]', err);
      renderError(container, err.message);
    }
  }

  return { render, _setView };

})();
