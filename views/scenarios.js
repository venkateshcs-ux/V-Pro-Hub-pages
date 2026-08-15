// views/scenarios.js — End User Scenario Status (dedicated page, #170 t5)
//
// Deep-linkable at #/scenarios/<cardId>. Standalone, independently-developable surface.
//
// PER-LAYER status, each layer carrying its own SOURCE (UI / API / 3P + Overall). Status
// is produced deterministically by regression-suite/sync_status.py (e2e + manual QA sheet).
//
// PROPOSE → RATIFY GATE: end_user_scenarios[] is the RATIFIED truth. Every add / modify /
// delete (from this page OR the public team-submission Worker) lands in scenario_proposals[]
// as PENDING + attributed (by + at) and does NOT change the ratified data until a paired
// Ratify. Rejected proposals are dropped. Proposal payloads use flat p_* fields (journey,
// scenario, role, priority) — parser-native, no JSON-in-YAML.

window.ScenariosView = (() => {

  const PRIORITIES = ['must-have', 'normal', 'nice-to-have'];
  const EDITABLE = ['journey', 'scenario', 'role', 'priority'];   // human-authored fields (status comes from the sync)
  const state = { cardId: null, fm: null, branch: null, owner: null, repo: null, filePath: null, raw: null, container: null };

  function escHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function inline(text) {
    return escHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');
  }
  function isReadOnly() { return document.body.getAttribute('data-mode') === 'readonly'; }
  function priClass(p) { return 'eus-pri-' + String(p || '').toLowerCase().replace(/\s+/g, '-'); }

  const EUS_STATUS = {
    pass: { cls: 'eus-pass', icon: '✓', label: 'pass' }, fail: { cls: 'eus-fail', icon: '✗', label: 'fail' },
    skip: { cls: 'eus-skip', icon: '⤼', label: 'skip' }, gap: { cls: 'eus-gap', icon: '○', label: 'gap' },
    'not-tested': { cls: 'eus-nt', icon: '·', label: 'not tested' },
    na: { cls: 'eus-na', icon: '–', label: 'n/a' },
  };
  function srcShort(s) {
    s = String(s || '');
    if (/^automation/.test(s)) return 'auto';
    if (/^manual-sheet/.test(s)) return 'manual';
    if (/^screenshot/.test(s)) return 'screenshot';
    if (/^screen-recording/.test(s)) return 'recording';
    if (/^paired/.test(s)) return 'paired';
    return '';
  }
  function layerCell(status, source) {
    const st = String(status || 'gap').toLowerCase();
    if (st === 'na') return '<span class="eus-na-cell" title="not applicable">—</span>';
    const m = EUS_STATUS[st] || EUS_STATUS.gap;
    const src = source && source !== 'none' && source !== 'na' ? ` title="source: ${escHtml(source)}"` : '';
    return `<span class="eus-badge ${m.cls}"${src}>${m.icon} ${m.label}</span>`;
  }

  // ── Deterministic markdown mutations (operate on LF-normalized GitHub content) ──

  function yamlQuote(v) { return '"' + String(v ?? '').replace(/"/g, "'").replace(/\r?\n/g, ' ').trim() + '"'; }
  function nl(raw) { return String(raw).replace(/\r\n/g, '\n').split('\n'); }

  function scanScenarioIds(raw) {
    const ids = [];
    let inBlock = false;
    nl(raw).forEach(l => {
      if (/^end_user_scenarios:\s*$/.test(l)) { inBlock = true; return; }
      if (inBlock && /^\S/.test(l)) inBlock = false;
      if (inBlock) { const m = l.match(/^\s{2}-\s+id:\s*["']?(S\d+)["']?/); if (m) ids.push(m[1]); }
    });
    return ids;
  }
  function nextScenarioId(raw) {
    const max = scanScenarioIds(raw).reduce((a, id) => Math.max(a, parseInt(id.slice(1), 10) || 0), 0);
    return 'S' + String(max + 1).padStart(2, '0');
  }
  function nextProposalId(proposals) {
    const max = (proposals || []).reduce((a, p) => Math.max(a, parseInt(String(p.pid || '').replace(/\D/g, ''), 10) || 0), 0);
    return 'P' + String(max + 1).padStart(2, '0');
  }

  // find [start,end) line range of a scenario bullet inside end_user_scenarios
  function scenarioRange(lines, scnId) {
    let inBlock = false, start = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^end_user_scenarios:\s*$/.test(lines[i])) { inBlock = true; continue; }
      if (inBlock && /^\S/.test(lines[i])) inBlock = false;
      if (!inBlock) { if (start >= 0) return [start, i]; continue; }
      const m = lines[i].match(/^\s{2}-\s+id:\s*["']?(.+?)["']?\s*$/);
      if (m) {
        if (start >= 0) return [start, i];
        if (m[1].trim() === String(scnId).trim()) start = i;
      }
    }
    return start >= 0 ? [start, lines.length] : null;
  }

  function updateScenarioFieldInMd(raw, scnId, field, value) {
    const lines = nl(raw);
    const rng = scenarioRange(lines, scnId);
    if (!rng) return lines.join('\n');
    const isText = field !== 'priority';
    const v = isText ? yamlQuote(value) : value;
    for (let i = rng[0]; i < rng[1]; i++) {
      if (new RegExp(`^\\s{4,}${field}:\\s*`).test(lines[i])) { lines[i] = lines[i].replace(new RegExp(`^(\\s{4,}${field}:\\s*).*$`), `$1${v}`); return lines.join('\n'); }
    }
    lines.splice(rng[0] + 1, 0, `    ${field}: ${v}`);   // field absent → insert after id
    return lines.join('\n');
  }

  function deleteScenarioInMd(raw, scnId) {
    const lines = nl(raw);
    const rng = scenarioRange(lines, scnId);
    if (!rng) return lines.join('\n');
    lines.splice(rng[0], rng[1] - rng[0]);
    return lines.join('\n');
  }

  function appendScenarioInMd(raw, scn) {
    const lines = nl(raw);
    const ki = lines.findIndex(l => /^end_user_scenarios:\s*$/.test(l));
    if (ki < 0) return raw;
    let end = ki + 1;
    while (end < lines.length && !/^\S/.test(lines[end]) && !/^---/.test(lines[end])) end++;
    const today = new Date().toISOString().slice(0, 10);
    lines.splice(end, 0,
      `  - id: ${scn.id}`,
      `    journey: ${yamlQuote(scn.journey)}`,
      `    scenario: ${yamlQuote(scn.scenario)}`,
      `    role: ${yamlQuote(scn.role)}`,
      `    priority: ${scn.priority}`,
      `    status_overall: gap`, `    status_ui: gap`, `    source_ui: "none"`,
      `    status_api: gap`, `    source_api: "none"`, `    status_3p: na`, `    source_3p: "na"`,
      `    integration: null`, `    decided_at: ${yamlQuote(today)}`, `    remark: ""`, `    e2e_ref: ""`);
    return lines.join('\n');
  }

  // ── Proposal-queue mutations ──

  function appendProposalInMd(raw, p) {
    const lines = nl(raw);
    const ki = lines.findIndex(l => /^scenario_proposals:\s*/.test(l));
    if (ki < 0) return raw;
    let end = ki + 1;
    while (end < lines.length && !/^\S/.test(lines[end]) && !/^---/.test(lines[end])) end++;
    const b = [
      `  - pid: ${p.pid}`,
      `    kind: ${p.kind}`,
      `    target: ${yamlQuote(p.target || '')}`,
      `    by: ${yamlQuote(p.by || 'in-app (paired)')}`,
      `    at: ${yamlQuote(p.at || new Date().toISOString().slice(0, 10))}`,
      `    status: pending`,
    ];
    EDITABLE.forEach(f => { if (p['p_' + f] != null && p['p_' + f] !== '') b.push(`    p_${f}: ${f === 'priority' ? p['p_' + f] : yamlQuote(p['p_' + f])}`); });
    if (p.p_to != null && p.p_to !== '') b.push(`    p_to: ${yamlQuote(p.p_to)}`);
    b.push(`    note: ${yamlQuote(p.note || '')}`);
    lines.splice(end, 0, ...b);
    return lines.join('\n');
  }

  function removeProposalFromMd(raw, pid) {
    const lines = nl(raw);
    let inBlock = false, start = -1, end = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^scenario_proposals:\s*/.test(lines[i])) { inBlock = true; continue; }
      if (inBlock && /^\S/.test(lines[i])) { if (start >= 0 && end < 0) end = i; inBlock = false; }
      if (!inBlock) continue;
      const m = lines[i].match(/^\s{2}-\s+pid:\s*["']?(.+?)["']?\s*$/);
      if (m) {
        if (start >= 0 && end < 0) { end = i; break; }
        if (m[1].trim() === String(pid).trim()) start = i;
      }
    }
    if (start < 0) return lines.join('\n');
    if (end < 0) { end = start + 1; while (end < lines.length && /^\s{4,}/.test(lines[end])) end++; }
    lines.splice(start, end - start);
    return lines.join('\n');
  }

  // Rename a journey/category across ALL scenarios that carry it.
  function renameJourneyInMd(raw, oldName, newName) {
    const lines = nl(raw);
    let inBlock = false;
    for (let i = 0; i < lines.length; i++) {
      if (/^end_user_scenarios:\s*$/.test(lines[i])) { inBlock = true; continue; }
      if (inBlock && /^\S/.test(lines[i])) inBlock = false;
      if (!inBlock) continue;
      const m = lines[i].match(/^(\s{4,}journey:\s*)["']?(.*?)["']?\s*$/);
      if (m && m[2].trim() === String(oldName).trim()) lines[i] = m[1] + yamlQuote(newName);
    }
    return lines.join('\n');
  }

  function applyProposalInMd(raw, p) {
    if (p.kind === 'delete') return deleteScenarioInMd(raw, p.target);
    if (p.kind === 'category-rename') return renameJourneyInMd(raw, p.target, p.p_to);
    if (p.kind === 'step-modify') return raw;  // step changes write to step-overrides.json out-of-band — handled in applyAndWrite
    if (p.kind === 'add') {
      return appendScenarioInMd(raw, { id: nextScenarioId(raw), journey: p.p_journey || 'Other', scenario: p.p_scenario || '', role: p.p_role || 'all', priority: p.p_priority || 'must-have' });
    }
    // modify — apply each provided p_* field
    let out = raw;
    EDITABLE.forEach(f => { if (p['p_' + f] != null && p['p_' + f] !== '') out = updateScenarioFieldInMd(out, p.target, f, p['p_' + f]); });
    return out;
  }

  async function applyAndWrite(mutate, msg) {
    const fresh = await Repos.getFileWithSha(state.owner, state.repo, state.filePath, state.branch);
    if (!fresh) throw new Error('Could not fetch current file for writeback');
    const newRaw = mutate(String(fresh.content || '').replace(/\r\n/g, '\n'));
    await Repos.putFile(state.owner, state.repo, state.filePath, newRaw, fresh.sha, msg, state.branch);
    state.raw = newRaw;
    state.fm = window.BacklogView.parseFrontmatter(newRaw);
    renderFull(state.container);
  }
  function toast(msg) { if (typeof window.showToast === 'function') window.showToast(msg); else console.warn('[Scenarios]', msg); }

  // ── Proposal helpers ──

  function getProposals() { return (Array.isArray(state.fm.scenario_proposals) ? state.fm.scenario_proposals : []).filter(p => String(p.status || 'pending').toLowerCase() === 'pending'); }
  function pendingFor(scnId) { return getProposals().find(p => (p.kind === 'modify' || p.kind === 'delete') && p.target === scnId); }
  function propChanges(p) { return EDITABLE.filter(f => p['p_' + f] != null && p['p_' + f] !== '').map(f => `${f}: ${p['p_' + f]}`); }

  // ── Renderers ──

  function renderTestSources() {
    const srcs = Array.isArray(state.fm.test_sources) ? state.fm.test_sources : [];
    if (srcs.length === 0) return '';
    const KIND_ICON = { automation: '⚙', manual: '👤', screenshot: '📸', 'screen-recording': '🎬', 'paired-review': '🤝' };
    const rows = srcs.map(s => {
      const ic = KIND_ICON[s.kind] || '·';
      const date = s.last_run_at ? `<span class="eus-when">${escHtml(s.last_run_at)}</span>` : '<span class="eus-when eus-when-pending">pending</span>';
      return `<div class="eus-ts-row" title="${escHtml(s.notes || '')}">
        <span class="eus-ts-ic">${ic}</span>
        <span class="eus-ts-sid">${escHtml(s.sid || '')}</span>
        <span class="eus-ts-name">${escHtml(s.name || '')}</span>
        ${date}
      </div>`;
    }).join('');
    return `<details class="eus-ts" open>
      <summary class="eus-ts-summary">Test sources <span class="eus-journey-ct">${srcs.length}</span> <span class="eus-ts-hint">— click status badges to see which source said so</span></summary>
      <div class="eus-ts-body">${rows}</div>
    </details>`;
  }

  function renderSummary(sc) {
    const norm = s => String(s || '').toLowerCase();
    const total = sc.length, by = pred => sc.filter(pred).length;
    const ovFail = by(s => norm(s.status_overall) === 'fail'), ovGap = by(s => norm(s.status_overall) === 'gap'), ovPass = by(s => norm(s.status_overall) === 'pass');
    const apiPass = by(s => norm(s.status_api) === 'pass'), apiFail = by(s => norm(s.status_api) === 'fail');
    const uiFail = by(s => norm(s.status_ui) === 'fail'), uiGap = by(s => norm(s.status_ui) === 'gap');
    const must = by(s => norm(s.priority) === 'must-have'), normal = by(s => norm(s.priority) === 'normal'), nice = by(s => norm(s.priority) === 'nice-to-have');
    const apiPct = total ? Math.round((apiPass / total) * 100) : 0;
    return `<div class="eus-summary">
      <div class="eus-stat"><div class="eus-stat-n">${total}</div><div class="eus-stat-l">scenarios</div></div>
      <div class="eus-stat eus-s-fail"><div class="eus-stat-n">${ovFail}</div><div class="eus-stat-l">overall fail</div></div>
      <div class="eus-stat eus-s-gap"><div class="eus-stat-n">${ovGap}</div><div class="eus-stat-l">overall gap</div></div>
      ${ovPass ? `<div class="eus-stat eus-s-pass"><div class="eus-stat-n">${ovPass}</div><div class="eus-stat-l">overall pass</div></div>` : ''}
      <div class="eus-stat"><div class="eus-stat-n">${apiPass}/${apiFail}</div><div class="eus-stat-l">API ✓ / ✗</div></div>
      <div class="eus-stat"><div class="eus-stat-n">${uiFail}/${uiGap}</div><div class="eus-stat-l">UI ✗ / gap</div></div>
      <div class="eus-stat"><div class="eus-stat-n">${must}/${normal}/${nice}</div><div class="eus-stat-l">must / norm / nice</div></div>
      <div class="eus-bar" title="${apiPct}% API pass"><div class="eus-bar-fill" style="width:${apiPct}%"></div><span class="eus-bar-lbl">${apiPct}% API pass</span></div>
    </div>`;
  }

  function renderProposalsPanel(ro) {
    const props = getProposals();
    if (props.length === 0) return '';
    const rows = props.map(p => {
      const what = p.kind === 'delete' ? `delete <strong>${escHtml(p.target)}</strong>`
        : p.kind === 'add' ? `add new — ${escHtml(p.p_scenario || '')}`
          : p.kind === 'category-rename' ? `rename category <strong>${escHtml(p.target)}</strong> → <strong>${escHtml(p.p_to || '')}</strong>`
          : `modify <strong>${escHtml(p.target)}</strong> → ${escHtml(propChanges(p).join(' · '))}`;
      const actions = ro ? '' : `<span class="eus-prop-actions">
        <button class="eus-ratify" data-pid="${escHtml(p.pid)}">✓ Ratify</button>
        <button class="eus-reject" data-pid="${escHtml(p.pid)}">✗ Reject</button></span>`;
      return `<div class="eus-prop-row eus-prop-${escHtml(p.kind)}">
        <span class="eus-prop-kind">${escHtml(p.kind)}</span>
        <span class="eus-prop-what">${what}</span>
        <span class="eus-prop-by">by ${escHtml(p.by || '—')} · ${escHtml(p.at || '')}</span>
        ${actions}
      </div>`;
    }).join('');
    return `<div class="eus-prop-panel">
      <div class="eus-prop-title">⏳ Proposed changes — pending ratification <span class="eus-journey-ct">${props.length}</span></div>
      ${rows}
      <div class="eus-prop-note">Proposals do not affect the ratified status above until <strong>Ratify</strong>. Team submissions arrive here too.</div>
    </div>`;
  }

  function priorityCell(s, ro, pend) {
    const cur = String(s.priority || '').toLowerCase();
    if (ro) return `<span class="eus-pri-chip ${priClass(cur)}">${escHtml(s.priority || '')}</span>`;
    const opts = PRIORITIES.map(p => `<option value="${p}"${p === cur ? ' selected' : ''}>${p}</option>`).join('');
    const propPri = pend && pend.kind === 'modify' && pend.p_priority ? `<div class="eus-prop-chip" title="proposed">→ ${escHtml(pend.p_priority)}</div>` : '';
    return `<select class="eus-pri-select ${priClass(cur)}" data-scn-id="${escHtml(s.id)}" aria-label="Priority for ${escHtml(s.id)}">${opts}</select>${propPri}`;
  }

  function evidenceCell(s) {
    const uniq = [...new Set([s.source_ui, s.source_api, s.source_3p].map(srcShort).filter(Boolean))];
    // Most-recent per-layer timestamp (UI > API > 3P > fallback to decided_at)
    const when = s.decided_ui_at || s.decided_api_at || s.decided_3p_at || s.decided_at || '';
    return `<span class="eus-evi">${uniq.length ? uniq.join(' + ') : '—'}</span> ${when ? `<span class="eus-when">${escHtml(when)}</span>` : ''}`;
  }
  // Build a sid→source map (registered test_sources[]).
  function sourceById() { const m = {}; (state.fm.test_sources || []).forEach(s => { if (s && s.sid) m[s.sid] = s; }); return m; }
  // Layer cell now embeds: status badge + source mini-badge + timestamp (stacked).
  // The "Evidence · when" column is gone; per-layer attribution lives in each cell.
  const KIND_ICON_INLINE = { automation: '⚙', manual: '👤', screenshot: '📸', 'screen-recording': '🎬', 'paired-review': '🤝' };
  function layerCellPerScenario(status, sid, fallbackSrc, decidedAt) {
    const m = sourceById()[sid];
    const tip = m ? `${m.kind} · ${m.name}${m.last_run_at ? ' · ' + m.last_run_at : ''}` : (fallbackSrc || '');
    const decoratedTip = (decidedAt && tip) ? `${tip} · ${decidedAt}` : tip;
    const st = String(status || 'gap').toLowerCase();
    if (st === 'na') return '<span class="eus-na-cell" title="not applicable">—</span>';
    const sm = EUS_STATUS[st] || EUS_STATUS.gap;
    const badge = `<span class="eus-badge ${sm.cls}"${decoratedTip ? ` title="${escHtml(decoratedTip)}"` : ''}>${sm.icon} ${sm.label}</span>`;
    // Source mini-badge + timestamp (small, stacked under status)
    const kindIcon = m ? (KIND_ICON_INLINE[m.kind] || '·') : '';
    const sidShort = sid ? sid.replace(/^(MANUAL-QA|AUTO)-?/i, '') : '';
    const srcLine = sid ? `<div class="eus-lyr-src" title="source: ${escHtml(sid)}">${kindIcon} ${escHtml(sid.length > 18 ? sidShort : sid)}</div>` : '';
    const dateLine = decidedAt ? `<div class="eus-lyr-when">${escHtml(decidedAt)}</div>` : '';
    return `<div class="eus-lyr-stack">${badge}${srcLine}${dateLine}</div>`;
  }
  // Overall cell — like the others but also shows a conflict ⚠ chip if layers disagree.
  function overallCell(s) {
    const st = String(s.status_overall || 'gap').toLowerCase();
    const sm = EUS_STATUS[st] || EUS_STATUS.gap;
    const c = s.conflict && s.conflict !== 'null' ? s.conflict : '';
    const tip = c ? `Layers disagree: ${c}` : '';
    const badge = `<span class="eus-badge ${sm.cls}"${tip ? ` title="${escHtml(tip)}"` : ''}>${sm.icon} ${sm.label}</span>`;
    const conflictLine = c ? `<div class="eus-conflict" title="${escHtml(c)}">⚠ ${escHtml(c)}</div>` : '';
    return `<div class="eus-lyr-stack">${badge}${conflictLine}</div>`;
  }

  // S129 — World-class verdict cell: ✓/✗ + hover tooltip with bulleted reasons.
  // Evidence-derived first pass (S129); V re-grades via normal edit-propose flow.
  function worldClassCell(s) {
    const v = String(s.world_class || '').toLowerCase();
    if (v !== 'yes' && v !== 'no') return '<span class="eus-badge eus-na">—</span>';
    const reasons = Array.isArray(s.wc_reasons) ? s.wc_reasons : (s.wc_reasons ? [s.wc_reasons] : []);
    const tip = reasons.length
      ? `<div class="eus-wc-tip"><div class="eus-wc-tip-h">${v === 'yes' ? 'Why it clears the bar' : 'What keeps it below the bar'}</div><ul>${reasons.map(r => `<li>${inline(r)}</li>`).join('')}</ul></div>`
      : '';
    const badge = v === 'yes'
      ? '<span class="eus-badge eus-pass">✓ yes</span>'
      : '<span class="eus-badge eus-fail">✗ not yet</span>';
    return `<div class="eus-wc">${badge}${tip}</div>`;
  }

  // ── Per-scenario test-report drill-down (steps: Expected / Actual / Status) ──
  function stepBadge(st) {
    const M = { fail: ['✗', 'eus-fail'], blocked: ['⛔', 'eus-skip'], untested: ['○', 'eus-gap'], pass: ['✓', 'eus-pass'] };
    const k = String(st || 'untested').toLowerCase();
    const [ic, cls] = M[k] || M.untested;
    return `<span class="eus-badge ${cls}">${ic} ${k}</span>`;
  }
  function renderStepsReport(s) {
    const d = (state.stepsData || {})[s.id];
    const e2e = s.e2e_ref
      ? `<div class="eus-tr-e2e"><strong>Automated (API):</strong> ${escHtml(s.e2e_ref)} &nbsp;${layerCell(s.status_api, s.source_api)}</div>`
      : '';
    if (!d || !Array.isArray(d.steps) || d.steps.length === 0) {
      return `<div class="eus-tr"><div class="eus-tr-h">Test report — ${escHtml(s.id)}</div>${e2e}
        <div class="eus-tr-none">No manual test steps logged for this scenario yet — the automated layer above is its current coverage.</div></div>`;
    }
    const ro = isReadOnly();
    const stepPending = (k) => getProposals().find(p => p.kind === 'step-modify' && p.target_scn === s.id && String(p.target_key) === String(k));
    const rows = d.steps.map(st => {
      const pend = stepPending(st.key || st.n);
      const correctedTag = st.origin === 'corrected' ? `<div class="eus-prop-chip" title="corrected by ${escHtml(st.corrected_by||'')}"><strong>corrected</strong> ${escHtml(st.corrected_at||'')}</div>` : '';
      const driftTag = st.drift ? `<div class="eus-prop-chip" title="QA text drifted since this was corrected — review">⚠ drift (QA now: ${escHtml((st.drift.qa_now||'').slice(0,60))}…)</div>` : '';
      const pendTag = pend ? `<div class="eus-prop-chip">⏳ proposed: ${escHtml(['expected','actual','status'].filter(f=>pend['p_'+f]!=null && pend['p_'+f]!=='').map(f=>f+'→'+pend['p_'+f]).join(' · '))}</div>` : '';
      const editBtn = ro ? '' : `<button class="eus-step-edit" data-scn="${escHtml(s.id)}" data-key="${escHtml(st.key||String(st.n))}" title="Propose correction">✎</button>`;
      return `<tr><td class="eus-tr-n">${escHtml(String(st.n))}</td>
        <td class="eus-tr-exp">${escHtml(st.expected)}${correctedTag}${driftTag}${pendTag}</td>
        <td class="eus-tr-act">${escHtml(st.actual)}</td>
        <td class="eus-tr-st">${stepBadge(st.status)} ${editBtn}</td></tr>`;
    }).join('');
    return `<div class="eus-tr">
      <div class="eus-tr-h">Test report — ${escHtml(s.id)} <span class="eus-tr-src">manual QA: ${(d.sources || []).map(escHtml).join(' · ')}</span></div>
      ${e2e}
      <table class="eus-tr-tbl"><thead><tr><th>#</th><th>Expected</th><th>Actual</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;
  }

  function renderRow(s, ro) {
    const pend = pendingFor(s.id);
    const isDel = pend && pend.kind === 'delete';
    const integ = s.integration && s.integration !== 'null' ? `<div class="eus-integ">${escHtml(s.integration)}</div>` : '';
    const remark = s.remark ? `<div class="eus-remark" title="${escHtml(s.remark)}">⚠ ${inline(s.remark)}</div>` : '';
    const propBanner = pend
      ? `<div class="eus-prop-chip" title="pending ratification">⏳ proposed ${escHtml(pend.kind)}${pend.kind === 'modify' ? ': ' + escHtml(propChanges(pend).join(' · ')) : ''}</div>`
      : '';
    const ctrls = ro ? '' : `<span class="eus-row-ctrls">
      <button class="eus-edit-btn" data-scn-id="${escHtml(s.id)}" title="Propose edit">✎</button>
      <button class="eus-del-btn" data-scn-id="${escHtml(s.id)}" title="Propose delete">🗑</button></span>`;
    return `<tr class="eus-row${isDel ? ' eus-row-del' : ''}${pend ? ' eus-row-pending' : ''}">
      <td class="eus-id"><button class="eus-expand" data-exp="${escHtml(s.id)}" title="open test report">▸</button> ${escHtml(s.id || '')}</td>
      <td class="eus-scn">${inline(s.scenario || '')}${remark}${propBanner}</td>
      <td class="eus-role"><span class="eus-chip">${escHtml(s.role || '')}</span></td>
      <td class="eus-pri">${priorityCell(s, ro, pend)}</td>
      <td class="eus-lyr">${layerCellPerScenario(s.status_ui, s.source_ui_sid, s.source_ui, s.decided_ui_at)}</td>
      <td class="eus-lyr">${layerCellPerScenario(s.status_api, s.source_api_sid, s.source_api, s.decided_api_at)}</td>
      <td class="eus-lyr">${layerCellPerScenario(s.status_3p, s.source_3p_sid, s.source_3p, s.decided_3p_at)}${integ}</td>
      <td class="eus-lyr">${overallCell(s)}</td>
      <td class="eus-lyr">${worldClassCell(s)}</td>
      <td class="eus-act">${ctrls}</td>
    </tr>
    <tr class="eus-detail" data-detail="${escHtml(s.id)}" hidden><td colspan="10">${renderStepsReport(s)}</td></tr>`;
  }

  function renderProposedAddRow(p) {
    return `<tr class="eus-row eus-row-add">
      <td class="eus-id">new</td>
      <td class="eus-scn">${inline(p.p_scenario || '')}<div class="eus-prop-chip">⏳ proposed add — by ${escHtml(p.by || '—')}</div></td>
      <td class="eus-role"><span class="eus-chip">${escHtml(p.p_role || '')}</span></td>
      <td class="eus-pri"><span class="eus-pri-chip ${priClass(p.p_priority)}">${escHtml(p.p_priority || '')}</span></td>
      <td class="eus-lyr">${layerCell('gap', '')}</td><td class="eus-lyr">${layerCell('gap', '')}</td>
      <td class="eus-lyr">${layerCell('na', '')}</td><td class="eus-lyr">${layerCell('gap', '')}</td>
      <td class="eus-lyr"><span class="eus-badge eus-na">—</span></td>
      <td class="eus-act"></td>
    </tr>`;
  }

  function renderTables(scenarios, ro) {
    const order = [], groups = {};
    scenarios.forEach(s => { const j = s.journey || 'Other'; if (!groups[j]) { groups[j] = []; order.push(j); } groups[j].push(s); });
    const adds = getProposals().filter(p => p.kind === 'add');
    adds.forEach(p => { const j = p.p_journey || 'Other'; if (!groups[j]) { groups[j] = []; order.push(j); } });
    const body = order.map(j => {
      const addRows = adds.filter(p => (p.p_journey || 'Other') === j).map(renderProposedAddRow).join('');
      const cnt = (groups[j] || []).length + adds.filter(p => (p.p_journey || 'Other') === j).length;
      const catPend = getProposals().find(p => p.kind === 'category-rename' && p.target === j);
      const catChip = catPend ? `<span class="eus-prop-chip" title="pending ratification">⏳ rename → ${escHtml(catPend.p_to || '')}</span>` : '';
      const catBtn = ro ? '' : `<button class="eus-cat-rename" data-cat="${escHtml(j)}" title="Propose rename of this category">✎</button>`;
      return `<tr class="eus-grp"><td colspan="10">${escHtml(j)} <span class="eus-journey-ct">${cnt}</span> ${catBtn} ${catChip}</td></tr>`
        + (groups[j] || []).map(s => renderRow(s, ro)).join('') + addRows;
    }).join('');
    return `<div class="eus-table-wrap"><table class="eus-table eus-table-full eus-table-aligned">
      <colgroup><col class="c-id"><col class="c-scn"><col class="c-role"><col class="c-pri"><col class="c-lyr"><col class="c-lyr"><col class="c-lyr"><col class="c-lyr"><col class="c-lyr"><col class="c-act"></colgroup>
      <thead><tr><th>#</th><th>Scenario</th><th>Role</th><th>Priority</th><th>UI</th><th>API</th><th>3P</th><th>Overall</th><th title="Evidence-derived first pass (S129) — V re-grades any verdict">World-class</th><th>Actions</th></tr></thead>
      <tbody>${body}</tbody></table></div>`;
  }

  function renderAddForm(ro) {
    if (ro) return '';
    const opts = PRIORITIES.map(p => `<option value="${p}"${p === 'must-have' ? ' selected' : ''}>${p}</option>`).join('');
    return `<div class="eus-add">
      <button id="eus-add-btn" class="eus-add-btn">＋ Propose scenario</button>
      <div id="eus-add-form" class="eus-add-form eus-hidden">
        <input id="eus-f-journey" class="eus-f-inp" placeholder="Journey (e.g. Money)" />
        <input id="eus-f-scenario" class="eus-f-inp eus-f-wide" placeholder="Scenario — end-user phrasing (required)" />
        <input id="eus-f-role" class="eus-f-inp" placeholder="Role (e.g. admin)" />
        <select id="eus-f-priority" class="eus-f-inp">${opts}</select>
        <button id="eus-add-submit" class="eus-add-submit">Propose</button>
        <span class="eus-add-hint">add / edit / delete all become <strong>proposals</strong> — pending until a paired Ratify</span>
      </div>
    </div>`;
  }

  // Smoke (must-haves only) vs Full regression + column filters.
  function filteredScenarios(all) {
    const f = state.filter;
    return all.filter(s => {
      if (f.view === 'smoke' && String(s.priority || '').toLowerCase() !== 'must-have') return false;
      if (f.status !== 'all' && String(s.status_overall || 'gap').toLowerCase() !== f.status) return false;
      if (f.journey !== 'all' && (s.journey || 'Other') !== f.journey) return false;
      if (f.search) { const q = f.search.toLowerCase(); if (!`${s.id} ${s.scenario} ${s.role} ${s.journey}`.toLowerCase().includes(q)) return false; }
      return true;
    });
  }
  function renderFilters(all, shown) {
    const f = state.filter;
    const journeys = [...new Set(all.map(s => s.journey || 'Other'))];
    const opt = (v, cur) => `<option value="${escHtml(v)}"${v === cur ? ' selected' : ''}>${escHtml(v)}</option>`;
    return `<div class="eus-filters">
      <div class="eus-fl-views">
        <button class="eus-fl-view${f.view === 'smoke' ? ' on' : ''}" data-view="smoke" title="absolutely-must-haves only">🔥 Smoke (must-haves)</button>
        <button class="eus-fl-view${f.view === 'full' ? ' on' : ''}" data-view="full">Full regression</button>
      </div>
      <label class="eus-fl">Overall <select class="eus-fl-status">${['all', 'fail', 'gap', 'skip', 'pass'].map(v => opt(v, f.status)).join('')}</select></label>
      <label class="eus-fl">Category <select class="eus-fl-journey">${['all', ...journeys].map(v => opt(v, f.journey)).join('')}</select></label>
      <input class="eus-fl-search" placeholder="search id / scenario / role…" value="${escHtml(f.search || '')}" />
      <span class="eus-fl-count">showing <strong>${shown.length}</strong> of ${all.length}</span>
    </div>`;
  }

  function renderFull(container) {
    state.container = container;
    const fm = state.fm, ro = isReadOnly();
    state.filter = state.filter || { view: 'full', status: 'all', journey: 'all', search: '' };
    const scenarios = Array.isArray(fm.end_user_scenarios) ? fm.end_user_scenarios : [];
    const shown = filteredScenarios(scenarios);
    const title = fm.title || fm.name || `#${state.cardId}`;
    const back = `<a class="proj-back-link" href="#/card/${escHtml(state.cardId)}">← Back to card #${escHtml(state.cardId)}</a>`;
    container.innerHTML = `<div class="eus-page">
      ${back}
      <div class="eus-page-head">
        <h1 class="eus-page-title">End User Scenario Status <span class="eus-mode-tag">${state.filter.view === 'smoke' ? '🔥 smoke' : 'full regression'}</span></h1>
        <div class="eus-page-sub">Heraizen HSM · Lite regression smoke suite · goal: retire manual testing
          &nbsp;·&nbsp; <a href="#/card/${escHtml(state.cardId)}">#${escHtml(state.cardId)} — ${escHtml(title)}</a>
          ${ro ? '<span class="eus-ro-tag">read-only</span>' : ''}</div>
      </div>
      ${renderSummary(shown)}
      ${renderTestSources()}
      ${renderProposalsPanel(ro)}
      <div class="eus-note">Status is split by <strong>layer</strong> so failures are attributable: <strong>UI</strong> (manual QA) · <strong>API</strong> (our e2e suite) · <strong>3P</strong> (Zoom / Razorpay / Edviron); <strong>Overall</strong> = worst applicable. Every add / edit / delete is a <strong>proposal</strong> — shown amber, pending until a paired Ratify. Status itself comes from the deterministic sync.</div>
      ${renderAddForm(ro)}
      ${renderFilters(scenarios, shown)}
      ${shown.length === 0 ? '<div class="proj-empty"><div class="proj-empty-glyph">◎</div><div class="proj-empty-msg">No scenarios match the current filters</div></div>' : renderTables(shown, ro)}
      <div class="eus-foot">SoT: <code>docs/backlog-detail/${escHtml(state.cardId)}.md</code> · ratified <code>end_user_scenarios[]</code> + <code>scenario_proposals[]</code> queue · API from <code>e2e-report-S108</code> · UI from manual-QA sheet · sync <code>regression-suite/sync_status.py</code>.</div>
    </div>`;
    wireEvents(container);
  }

  // ── Write handlers (all create or resolve PROPOSALS) ──

  async function onPriorityChange(scnId, newPriority) {
    const cur = (state.fm.end_user_scenarios.find(s => s.id === scnId) || {}).priority;
    if (String(cur) === String(newPriority)) return;
    try { await applyAndWrite(raw => appendProposalInMd(raw, { pid: nextProposalId(getAllProposals()), kind: 'modify', target: scnId, p_priority: newPriority }), `data(#170): propose modify ${scnId} priority -> ${newPriority}`); toast(`proposed: ${scnId} priority → ${newPriority}`); }
    catch (e) { toast('Propose failed: ' + e.message); renderFull(state.container); }
  }
  async function onProposeAdd() {
    const c = state.container;
    const scenario = (c.querySelector('#eus-f-scenario') || {}).value?.trim() || '';
    if (!scenario) { toast('Scenario text is required'); return; }
    const p = { pid: nextProposalId(getAllProposals()), kind: 'add', p_journey: (c.querySelector('#eus-f-journey') || {}).value?.trim() || 'Other', p_scenario: scenario, p_role: (c.querySelector('#eus-f-role') || {}).value?.trim() || 'all', p_priority: (c.querySelector('#eus-f-priority') || {}).value || 'must-have' };
    try { await applyAndWrite(raw => appendProposalInMd(raw, p), `data(#170): propose add scenario — ${scenario.slice(0, 40)}`); toast('proposed: add scenario'); }
    catch (e) { toast('Propose failed: ' + e.message); renderFull(c); }
  }
  async function onProposeDelete(scnId) {
    try { await applyAndWrite(raw => appendProposalInMd(raw, { pid: nextProposalId(getAllProposals()), kind: 'delete', target: scnId }), `data(#170): propose delete ${scnId}`); toast(`proposed: delete ${scnId}`); }
    catch (e) { toast('Propose failed: ' + e.message); renderFull(state.container); }
  }
  async function onProposeModify(scnId, fields) {
    const changed = {}; let any = false;
    const s = state.fm.end_user_scenarios.find(x => x.id === scnId) || {};
    EDITABLE.forEach(f => { if (fields[f] != null && String(fields[f]).trim() !== '' && String(fields[f]) !== String(s[f] || '')) { changed['p_' + f] = String(fields[f]).trim(); any = true; } });
    if (!any) { toast('No changes to propose'); return; }
    try { await applyAndWrite(raw => appendProposalInMd(raw, Object.assign({ pid: nextProposalId(getAllProposals()), kind: 'modify', target: scnId }, changed)), `data(#170): propose modify ${scnId}`); toast(`proposed: modify ${scnId}`); }
    catch (e) { toast('Propose failed: ' + e.message); renderFull(state.container); }
  }
  // Apply a ratified step-modify to the step-overrides.json file (the merge-aware corrections SoT).
  async function applyStepOverride(p) {
    const path = 'projects/shreemantra/regression-suite/step-overrides.json';
    const fresh = await Repos.getFileWithSha(state.owner, state.repo, path, state.branch).catch(() => null);
    let cur = {}, sha = null;
    if (fresh) { try { cur = JSON.parse(fresh.content || '{}'); } catch { cur = {}; } sha = fresh.sha; }
    cur[p.target_scn] = cur[p.target_scn] || {};
    const ov = cur[p.target_scn][String(p.target_key)] || {};
    if (p.p_expected != null && p.p_expected !== '') ov.expected = p.p_expected;
    if (p.p_actual   != null && p.p_actual   !== '') ov.actual   = p.p_actual;
    if (p.p_status   != null && p.p_status   !== '') ov.status   = p.p_status;
    if (p.expected_at_correction) ov.expected_at_correction = p.expected_at_correction;
    ov.by = p.by || 'in-app (paired)';
    ov.at = p.at || new Date().toISOString().slice(0, 10);
    cur[p.target_scn][String(p.target_key)] = ov;
    const body = JSON.stringify(cur, null, 2) + '\n';
    await Repos.putFile(state.owner, state.repo, path, body, sha, `data(#170): step-override ${p.target_scn}#${p.target_key} (RATIFY ${p.pid})`, state.branch);
  }

  async function onRatify(pid) {
    const p = getAllProposals().find(x => String(x.pid) === String(pid));
    if (!p) return;
    try {
      if (p.kind === 'step-modify') {
        await applyStepOverride(p);
        await applyAndWrite(raw => removeProposalFromMd(raw, pid), `data(#170): RATIFY ${pid} (step-modify ${p.target_scn}#${p.target_key})`);
      } else {
        await applyAndWrite(raw => removeProposalFromMd(applyProposalInMd(raw, p), pid), `data(#170): RATIFY ${pid} (${p.kind} ${p.target || ''})`);
      }
      toast(`ratified ${pid}`);
    } catch (e) { toast('Ratify failed: ' + e.message); renderFull(state.container); }
  }
  async function onReject(pid) {
    try { await applyAndWrite(raw => removeProposalFromMd(raw, pid), `data(#170): reject ${pid}`); toast(`rejected ${pid}`); }
    catch (e) { toast('Reject failed: ' + e.message); renderFull(state.container); }
  }
  async function onProposeStepEdit(scnId, key, fields) {
    const d = (state.stepsData || {})[scnId] || { steps: [] };
    const st = d.steps.find(x => String(x.key || x.n) === String(key));
    if (!st) { toast('Step not found'); return; }
    const changed = {}; let any = false;
    ['expected', 'actual', 'status'].forEach(f => {
      if (fields[f] != null && String(fields[f]).trim() !== '' && String(fields[f]) !== String(st[f] || '')) { changed['p_' + f] = String(fields[f]).trim(); any = true; }
    });
    if (!any) { toast('No changes to propose'); return; }
    const p = Object.assign({ pid: nextProposalId(getAllProposals()), kind: 'step-modify', target: `${scnId}#${key}`, target_scn: scnId, target_key: String(key), expected_at_correction: st.expected }, changed);
    try { await applyAndWrite(raw => appendProposalInMd(raw, p), `data(#170): propose step-modify ${scnId}#${key}`); toast(`proposed: step ${scnId}#${key}`); }
    catch (e) { toast('Propose failed: ' + e.message); renderFull(state.container); }
  }
  function openStepEdit(scnId, key, btn) {
    const row = btn.closest('tr'); if (!row) return;
    const d = (state.stepsData || {})[scnId] || { steps: [] };
    const st = d.steps.find(x => String(x.key || x.n) === String(key)) || {};
    if (row.nextElementSibling?.classList.contains('eus-step-edit-row')) return;
    const stOpts = ['fail','blocked','untested','pass'].map(v=>`<option value="${v}"${v===st.status?' selected':''}>${v}</option>`).join('');
    const tr = document.createElement('tr');
    tr.className = 'eus-step-edit-row';
    tr.innerHTML = `<td></td><td colspan="3"><div class="eus-edit-form">
      <input class="eus-f-inp eus-f-wide ef-exp" value="${escHtml(st.expected||'')}" placeholder="Expected" />
      <input class="eus-f-inp eus-f-wide ef-act" value="${escHtml(st.actual||'')}" placeholder="Actual" />
      <select class="eus-f-inp ef-st">${stOpts}</select>
      <button class="eus-add-submit ef-save">Propose correction</button>
      <button class="eus-edit-cancel">Cancel</button></div></td>`;
    row.after(tr);
    tr.querySelector('.ef-save').addEventListener('click', () => onProposeStepEdit(scnId, key, {
      expected: tr.querySelector('.ef-exp').value, actual: tr.querySelector('.ef-act').value, status: tr.querySelector('.ef-st').value,
    }));
    tr.querySelector('.eus-edit-cancel').addEventListener('click', () => tr.remove());
  }
  async function onProposeCategoryRename(oldName, newName) {
    newName = String(newName || '').trim();
    if (!newName || newName === oldName) { toast('No change to propose'); return; }
    try { await applyAndWrite(raw => appendProposalInMd(raw, { pid: nextProposalId(getAllProposals()), kind: 'category-rename', target: oldName, p_to: newName }), `data(#170): propose rename category ${oldName} -> ${newName}`); toast(`proposed: rename ${oldName} → ${newName}`); }
    catch (e) { toast('Propose failed: ' + e.message); renderFull(state.container); }
  }
  function openCatRename(cat, btn) {
    const td = btn.closest('td');
    if (!td || td.querySelector('.eus-cat-form')) return;
    const span = document.createElement('span');
    span.className = 'eus-cat-form';
    span.innerHTML = `<input class="eus-f-inp eus-cat-inp" value="${escHtml(cat)}" /> <button class="eus-add-submit eus-cat-save">Propose rename</button> <button class="eus-edit-cancel eus-cat-cancel">Cancel</button>`;
    td.appendChild(span);
    span.querySelector('.eus-cat-save').addEventListener('click', () => onProposeCategoryRename(cat, span.querySelector('.eus-cat-inp').value));
    span.querySelector('.eus-cat-cancel').addEventListener('click', () => span.remove());
  }
  function getAllProposals() { return Array.isArray(state.fm.scenario_proposals) ? state.fm.scenario_proposals : []; }

  function openEditForm(scnId) {
    const s = state.fm.end_user_scenarios.find(x => x.id === scnId);
    if (!s) return;
    const row = state.container.querySelector(`.eus-edit-btn[data-scn-id="${CSS.escape(scnId)}"]`)?.closest('tr');
    if (!row || row.nextElementSibling?.classList.contains('eus-edit-row')) return;
    const opts = PRIORITIES.map(p => `<option value="${p}"${p === s.priority ? ' selected' : ''}>${p}</option>`).join('');
    const tr = document.createElement('tr');
    tr.className = 'eus-edit-row';
    tr.innerHTML = `<td></td><td colspan="8"><div class="eus-edit-form">
      <input class="eus-f-inp ef-journey" value="${escHtml(s.journey || '')}" placeholder="Journey" />
      <input class="eus-f-inp eus-f-wide ef-scenario" value="${escHtml(s.scenario || '')}" placeholder="Scenario" />
      <input class="eus-f-inp ef-role" value="${escHtml(s.role || '')}" placeholder="Role" />
      <select class="eus-f-inp ef-priority">${opts}</select>
      <button class="eus-add-submit ef-save" data-scn-id="${escHtml(scnId)}">Propose change</button>
      <button class="eus-edit-cancel">Cancel</button></div></td>`;
    row.after(tr);
    tr.querySelector('.ef-save').addEventListener('click', () => onProposeModify(scnId, {
      journey: tr.querySelector('.ef-journey').value, scenario: tr.querySelector('.ef-scenario').value,
      role: tr.querySelector('.ef-role').value, priority: tr.querySelector('.ef-priority').value,
    }));
    tr.querySelector('.eus-edit-cancel').addEventListener('click', () => tr.remove());
  }

  function wireEvents(container) {
    container.querySelectorAll('.eus-pri-select').forEach(sel => sel.addEventListener('change', () => onPriorityChange(sel.dataset.scnId, sel.value)));
    container.querySelectorAll('.eus-edit-btn').forEach(b => b.addEventListener('click', () => openEditForm(b.dataset.scnId)));
    container.querySelectorAll('.eus-del-btn').forEach(b => b.addEventListener('click', () => onProposeDelete(b.dataset.scnId)));
    container.querySelectorAll('.eus-ratify').forEach(b => b.addEventListener('click', () => onRatify(b.dataset.pid)));
    container.querySelectorAll('.eus-reject').forEach(b => b.addEventListener('click', () => onReject(b.dataset.pid)));
    const addBtn = container.querySelector('#eus-add-btn');
    if (addBtn) addBtn.addEventListener('click', () => { const f = container.querySelector('#eus-add-form'); if (f) f.classList.toggle('eus-hidden'); });
    const submit = container.querySelector('#eus-add-submit');
    if (submit) submit.addEventListener('click', onProposeAdd);
    container.querySelectorAll('.eus-fl-view').forEach(b => b.addEventListener('click', () => { state.filter.view = b.dataset.view; renderFull(state.container); }));
    const flStatus = container.querySelector('.eus-fl-status');
    if (flStatus) flStatus.addEventListener('change', () => { state.filter.status = flStatus.value; renderFull(state.container); });
    const flJourney = container.querySelector('.eus-fl-journey');
    if (flJourney) flJourney.addEventListener('change', () => { state.filter.journey = flJourney.value; renderFull(state.container); });
    const flSearch = container.querySelector('.eus-fl-search');
    if (flSearch) flSearch.addEventListener('input', () => {
      state.filter.search = flSearch.value;
      renderFull(state.container);
      const ns = state.container.querySelector('.eus-fl-search');
      if (ns) { ns.focus(); ns.setSelectionRange(ns.value.length, ns.value.length); }
    });
    container.querySelectorAll('.eus-cat-rename').forEach(b => b.addEventListener('click', () => openCatRename(b.dataset.cat, b)));
    container.querySelectorAll('.eus-step-edit').forEach(b => b.addEventListener('click', () => openStepEdit(b.dataset.scn, b.dataset.key, b)));
    // Row-clickable drill-down (entire row toggles; ignores clicks on interactive controls).
    container.querySelectorAll('.eus-row').forEach(row => {
      row.addEventListener('click', (ev) => {
        if (ev.target.closest('button, select, input, textarea, a, label')) return;  // controls do their own thing
        const caret = row.querySelector('.eus-expand');
        if (!caret) return;
        const det = container.querySelector(`.eus-detail[data-detail="${CSS.escape(caret.dataset.exp)}"]`);
        if (!det) return;
        if (det.hasAttribute('hidden')) { det.removeAttribute('hidden'); caret.textContent = '▾'; }
        else { det.setAttribute('hidden', ''); caret.textContent = '▸'; }
      });
    });
  }

  // ── Public render ──

  async function render(container, param) {
    const cardId = String(param || '').trim();
    state.cardId = cardId;
    if (!cardId) {
      container.innerHTML = `<div class="eus-page"><div class="proj-empty"><div class="proj-empty-glyph">◎</div>
        <div class="proj-empty-msg">No card selected</div>
        <div class="proj-empty-detail">Open as #/scenarios/&lt;cardId&gt; (e.g. #/scenarios/170).</div></div></div>`;
      return;
    }
    container.innerHTML = `<div class="view-loading">Loading scenario suite for #${escHtml(cardId)}…</div>`;
    try {
      const owner = CONFIG.username, repo = 'V-Pro-Hub';
      let branch = null;
      if (window.ActiveSprint && typeof window.ActiveSprint.getActiveSprintBranch === 'function') {
        const d = await window.ActiveSprint.getActiveSprintBranch(owner, repo).catch(() => null);
        branch = (d && d.branch) || null;
      }
      const filePath = `docs/backlog-detail/${cardId}.md`;
      const raw = await Repos.getFile(owner, repo, filePath, branch || undefined);
      if (!raw) throw new Error(`Card file not found: ${filePath}`);
      if (!window.BacklogView || typeof window.BacklogView.parseFrontmatter !== 'function') throw new Error('BacklogView.parseFrontmatter not available');
      state.fm = window.BacklogView.parseFrontmatter(raw);
      state.raw = raw; state.branch = branch; state.owner = owner; state.repo = repo; state.filePath = filePath;
      try {
        const stepsRaw = await Repos.getFile(owner, repo, 'projects/shreemantra/regression-suite/scenario-steps.json', branch || undefined);
        state.stepsData = stepsRaw ? JSON.parse(stepsRaw) : {};
      } catch (e) { state.stepsData = {}; }
      renderFull(container);
    } catch (err) {
      container.innerHTML = `<div class="proj-error"><strong>Error loading scenario suite for #${escHtml(cardId)}</strong><br>${escHtml(err.message)}
        <br><br><button onclick="ScenariosView.render(document.getElementById('main-content'), '${escHtml(cardId)}')" style="margin-top:8px;padding:6px 14px;cursor:pointer">Retry</button>
        &nbsp;<button onclick="navigate('card', '${escHtml(cardId)}')" style="margin-top:8px;padding:6px 14px;cursor:pointer">← Back to card</button></div>`;
    }
  }

  return { render, _appendProposalInMd: appendProposalInMd, _removeProposalFromMd: removeProposalFromMd, _applyProposalInMd: applyProposalInMd, _updateScenarioFieldInMd: updateScenarioFieldInMd, _deleteScenarioInMd: deleteScenarioInMd, _appendScenarioInMd: appendScenarioInMd, _nextScenarioId: nextScenarioId, _nextProposalId: nextProposalId };

})();
