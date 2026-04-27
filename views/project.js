// views/project.js — Layer B Project Surface (S036, MVP for CD review)
//
// Renders projects/<id>/state.md as an interactive project surface:
//   - Status header (project name, layer/class/domain, current phase, key facts strip)
//   - Stepwise workflow (accordion: steps with per-step sub-items, status badges, consult gates)
//   - Ready reckoner sidebar (key facts + countdown to hard deadline)
//   - Open todos panel (derived from incomplete sub-items)
//   - Documents panel (links to research/decisions files)
//
// MVP scope (S036, autonomous overnight build):
//   ✓ Read state.md from GitHub via Repos.getFile
//   ✓ Parse YAML frontmatter + structured markdown body
//   ✓ Render all components, light/dark theme parity, mobile responsive
//   ✗ Writeback (TODO comments mark where it lands; tomorrow's CD review + Sonnet pass)
//   ✗ Edit modals + agent dispatch handles (forward-looking, post-CD-review)
//
// Visual language: Backlog 2.0 Polished v3 token system (tints, semantic colors,
// Space Grotesk + JetBrains Mono). All component classes prefixed `proj-`.

window.ProjectView = (() => {

  // ── State ──────────────────────────────────────

  const state = {
    projectId: null,
    project: null,    // parsed data
    error: null,
  };

  // ── Helpers ────────────────────────────────────

  function escHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function inline(text) {
    return escHtml(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
        const safeHref = String(href).replace(/[<>"']/g, '');
        return `<a href="${safeHref}" class="proj-link" target="_blank" rel="noopener">${escHtml(label)}</a>`;
      });
  }

  // YAML frontmatter parser (minimal — string/number/bool/null/array)
  function parseYaml(text) {
    const out = {};
    if (!text) return out;
    text.split(/\r?\n/).forEach(line => {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
      if (!m) return;
      const key = m[1];
      let v = m[2].trim();
      if (v === '' || v === 'null') { out[key] = null; return; }
      if (v === 'true') { out[key] = true; return; }
      if (v === 'false') { out[key] = false; return; }
      // strip quotes
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      // number
      if (/^-?\d+(\.\d+)?$/.test(v)) { out[key] = Number(v); return; }
      out[key] = v;
    });
    return out;
  }

  function splitFrontmatter(md) {
    const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!m) return { frontmatter: '', body: md };
    return { frontmatter: m[1], body: m[2] };
  }

  // ── State.md body parser ───────────────────────

  // Splits body into sections by `## Heading`. Returns map { 'Section name': sectionLines }.
  function splitSections(body) {
    const sections = {};
    let current = null;
    let buf = [];
    body.split(/\r?\n/).forEach(line => {
      const m = line.match(/^##\s+(.+?)\s*$/);
      if (m) {
        if (current) sections[current] = buf.join('\n');
        current = m[1].replace(/\s*\(.*?\)\s*$/, '').trim();  // strip parenthetical suffix
        buf = [];
      } else {
        buf.push(line);
      }
    });
    if (current) sections[current] = buf.join('\n');
    return sections;
  }

  // Parse `| col1 | col2 |` markdown tables. Skips header separator row.
  function parseMdTable(text) {
    const rows = [];
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.startsWith('|'));
    if (lines.length < 2) return rows;
    // First line = headers; second = separator
    const headers = lines[0].split('|').slice(1, -1).map(c => c.trim().toLowerCase());
    for (let i = 2; i < lines.length; i++) {
      const cells = lines[i].split('|').slice(1, -1).map(c => c.trim());
      if (cells.length === 0 || cells.every(c => c === '' || /^[-:]+$/.test(c))) continue;
      const row = {};
      headers.forEach((h, idx) => { row[h] = cells[idx] ?? ''; });
      rows.push(row);
    }
    return rows;
  }

  // Parse the Steps section: `### Step N — name (duration)` then sub-items `#### N.M — title`.
  function parseSteps(text) {
    const steps = [];
    const lines = text.split(/\r?\n/);
    let curStep = null;
    let curSub = null;

    function pushSub() {
      if (curSub && curStep) curStep.sub_items.push(curSub);
      curSub = null;
    }
    function pushStep() {
      pushSub();
      if (curStep) steps.push(curStep);
      curStep = null;
    }

    for (const line of lines) {
      const stepM = line.match(/^###\s+Step\s+(\d+)\s*[—\-]\s*(.+?)(?:\s*\(([^)]+)\))?\s*$/);
      if (stepM) {
        pushStep();
        curStep = {
          id: parseInt(stepM[1], 10),
          name: stepM[2].trim(),
          duration: stepM[3] ? stepM[3].trim() : '',
          status: 'pending',
          sub_items: [],
          goals: [],
          consult: [],
          notes: '',
        };
        continue;
      }
      const subM = line.match(/^####\s+(\d+\.\d+)\s*[—\-]\s*(.+?)\s*$/);
      if (subM && curStep) {
        pushSub();
        curSub = { id: subM[1], name: subM[2].trim(), attrs: {} };
        continue;
      }
      // Step-level "Status: **In progress ▶**"
      if (curStep && !curSub) {
        const ssm = line.match(/^Status:\s*\*\*(.+?)\*\*\s*$/i);
        if (ssm) { curStep.status = ssm[1].toLowerCase().replace(/\s+[▶✓⏳⏸].*/, '').trim(); continue; }
        const sm = line.match(/^Status:\s*(.+?)\s*$/i);
        if (sm) { curStep.status = sm[1].toLowerCase().replace(/\*+/g, '').replace(/\s+[▶✓⏳⏸].*/, '').trim(); continue; }
        // Step goals (Step 3 has Goals: in body)
        const gm = line.match(/^\s*\d+\.\s+(.+?)\s*$/);
        if (gm && /goals/i.test(curStep.notes || '')) { curStep.goals.push(gm[1].trim()); }
        // Note any "**Goals:**" marker line
        if (/\*\*Goals:\*\*/i.test(line)) curStep.notes = (curStep.notes || '') + 'goals\n';
        // Step-level consult
        const cm = line.match(/^\*\*Consult\s*\/?\s*sign-off:\*\*/i);
        if (cm) curStep.notes = (curStep.notes || '') + 'consult\n';
        if (/^[-*]\s*Ssuresh consult/i.test(line)) curStep.consult.push('ssuresh');
        if (/^[-*]\s*SEBI-registered IA/i.test(line)) curStep.consult.push('tbd-ia');
        if (/^[-*]\s*Real CA/i.test(line) || /^[-*]\s*CA sign-off/i.test(line)) curStep.consult.push('tbd-ca');
      }
      // Sub-item attribute line: `- **Type:** value`
      if (curSub) {
        const am = line.match(/^-\s*\*\*([\w\s\-/]+?):\*\*\s*(.+)\s*$/);
        if (am) {
          const key = am[1].toLowerCase().trim().replace(/\s+/g, '_').replace(/[\/-]/g, '_');
          curSub.attrs[key] = am[2].trim();
          continue;
        }
      }
    }
    pushStep();
    return steps;
  }

  // Parse `- [ ] task` list items.
  function parseTodos(text) {
    const todos = [];
    text.split(/\r?\n/).forEach(line => {
      const m = line.match(/^[-*]\s*\[\s\]\s+(.+?)\s*$/);
      if (m) todos.push(m[1].trim());
    });
    return todos;
  }

  function parseStateMd(md) {
    const { frontmatter, body } = splitFrontmatter(md);
    const meta = parseYaml(frontmatter);
    const sections = splitSections(body);

    const keyFacts = parseMdTable(sections['Key facts'] || '');
    const team = parseMdTable(sections['Team'] || '');
    const documents = parseMdTable(sections['Documents'] || sections['Documents (attachments)'] || '');
    const todos = parseTodos(sections['Open todos'] || sections['Open todos (derived view — items not yet `done` in current/next-active phase)'] || '');
    const steps = parseSteps(sections['Steps'] || '');

    return { meta, keyFacts, team, documents, todos, steps };
  }

  // ── Status helpers ─────────────────────────────

  function statusKind(raw) {
    if (!raw) return 'pending';
    const s = String(raw).toLowerCase();
    if (s.includes('done') || s.includes('complete') || s === '✓') return 'done';
    if (s.includes('blocked') || s === '⏸') return 'blocked';
    if (s.includes('progress') || s === '▶' || s === 'in-progress' || s.includes('monitoring')) return 'progress';
    return 'pending';
  }

  function statusGlyph(kind) {
    return ({ done: '✓', progress: '▶', blocked: '⏸', pending: '⏳' })[kind] || '⏳';
  }

  function statusLabel(kind) {
    return ({ done: 'Done', progress: 'In progress', blocked: 'Blocked', pending: 'Pending' })[kind] || 'Pending';
  }

  // ── Date helpers ───────────────────────────────

  function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function daysBetween(a, b) {
    if (!a || !b) return null;
    const da = new Date(a + 'T00:00:00');
    const db = new Date(b + 'T00:00:00');
    if (isNaN(da) || isNaN(db)) return null;
    return Math.round((db - da) / (1000 * 60 * 60 * 24));
  }

  // ── Render: skeleton + error ───────────────────

  function renderSkeleton() {
    return `<div class="proj-skel">
      <div class="proj-skel-header"></div>
      <div class="proj-skel-grid">
        <div class="proj-skel-main">
          <div class="proj-skel-step"></div>
          <div class="proj-skel-step"></div>
          <div class="proj-skel-step"></div>
        </div>
        <div class="proj-skel-side">
          <div class="proj-skel-card"></div>
          <div class="proj-skel-card"></div>
        </div>
      </div>
    </div>`;
  }

  function renderError(err) {
    return `<div class="proj-empty">
      <div class="proj-empty-glyph">⚠</div>
      <div class="proj-empty-msg">Could not load project.</div>
      <div class="proj-empty-detail">${escHtml(err && err.message ? err.message : String(err))}</div>
      <div class="proj-empty-detail">Check that <code>projects/${escHtml(state.projectId || '')}/state.md</code> exists in the V-Pro-Hub repo.</div>
    </div>`;
  }

  function renderEmpty() {
    return `<div class="proj-empty">
      <div class="proj-empty-glyph">∅</div>
      <div class="proj-empty-msg">No project specified.</div>
      <div class="proj-empty-detail">Navigate to a project route, e.g. <code>#/project/vhalli</code>.</div>
    </div>`;
  }

  // ── Render: components ─────────────────────────

  function renderStatusHeader() {
    const m = state.project.meta;
    const currentStep = (state.project.steps || []).find(s => s.id === m.current_phase_id);
    const layerBadge = m.layer ? `<span class="proj-badge proj-badge-layer">Layer ${escHtml(m.layer)}</span>` : '';
    const classBadge = (m.class && m.domain) ? `<span class="proj-badge proj-badge-cd">${escHtml(m.class)} × ${escHtml(m.domain)}</span>` : '';
    const stKind = statusKind(m.status);
    const statusBadge = `<span class="proj-badge proj-badge-status ${stKind}">${statusGlyph(stKind)} ${statusLabel(stKind)}</span>`;
    const phaseLine = currentStep
      ? `<div class="proj-h-phase"><span class="proj-h-phase-label">Current phase</span><strong>Step ${currentStep.id} — ${escHtml(currentStep.name)}</strong>${currentStep.duration ? ` <span class="proj-h-phase-dur">(${escHtml(currentStep.duration)})</span>` : ''}</div>`
      : '';
    const updatedLine = m.last_updated ? `<div class="proj-h-updated">Last updated <strong>${escHtml(m.last_updated)}</strong>${m.last_updated_by ? ` · ${escHtml(m.last_updated_by)}` : ''}</div>` : '';

    return `<div class="proj-header">
      <div class="proj-h-row">
        <div>
          <div class="proj-h-title">${escHtml(m.name || state.projectId || '')}</div>
          <div class="proj-h-meta">${layerBadge}${classBadge}${statusBadge}</div>
        </div>
        <div class="proj-h-right">${updatedLine}</div>
      </div>
      ${phaseLine}
      ${renderKeyFactsStrip()}
    </div>`;
  }

  function renderKeyFactsStrip() {
    const facts = state.project.keyFacts || [];
    if (!facts.length) return '';
    // Show top 5 in the strip
    const top = facts.slice(0, 5);
    const items = top.map(f => `<div class="proj-fact"><div class="proj-fact-label">${escHtml(f.label)}</div><div class="proj-fact-value">${inline(f.value)}</div></div>`).join('');
    return `<div class="proj-facts-strip">${items}</div>`;
  }

  function renderStepwiseWorkflow() {
    const steps = state.project.steps || [];
    if (!steps.length) return '<div class="proj-empty-inline">No steps defined in state.md.</div>';
    const cur = state.project.meta.current_phase_id;
    const items = steps.map(step => renderStep(step, step.id === cur)).join('');
    return `<div class="proj-workflow">
      <div class="proj-section-title">Workflow</div>
      ${items}
    </div>`;
  }

  function renderStep(step, isCurrent) {
    const kind = statusKind(step.status);
    const subs = (step.sub_items || []).map(sub => renderSubItem(sub, step)).join('');
    const goalsHtml = (step.goals && step.goals.length)
      ? `<div class="proj-step-goals"><div class="proj-step-goals-label">Goals</div><ul>${step.goals.map(g => `<li>${inline(g)}</li>`).join('')}</ul></div>`
      : '';
    const consultHtml = (step.consult && step.consult.length)
      ? `<div class="proj-step-consult"><span class="proj-gate">⚑ Consult: ${step.consult.map(c => escHtml(c)).join(', ')}</span></div>`
      : '';
    const subCount = (step.sub_items || []).length;
    const doneCount = (step.sub_items || []).filter(s => statusKind(s.attrs && s.attrs.status) === 'done').length;
    const progressBar = subCount > 0
      ? `<span class="proj-step-progress">${doneCount}/${subCount}</span>`
      : '';
    return `<details class="proj-step ${kind}${isCurrent ? ' is-current' : ''}" ${isCurrent || kind === 'progress' ? 'open' : ''}>
      <summary class="proj-step-summary">
        <span class="proj-step-num">Step ${step.id}</span>
        <span class="proj-step-name">${escHtml(step.name)}</span>
        ${step.duration ? `<span class="proj-step-dur">${escHtml(step.duration)}</span>` : ''}
        <span class="proj-step-status ${kind}">${statusGlyph(kind)} ${statusLabel(kind)}</span>
        ${progressBar}
      </summary>
      <div class="proj-step-body">
        ${subs}
        ${goalsHtml}
        ${consultHtml}
      </div>
    </details>`;
  }

  function renderSubItem(sub, step) {
    const a = sub.attrs || {};
    const kind = statusKind(a.status);
    const typeBadge = a.type ? `<span class="proj-sub-type">${escHtml(a.type)}</span>` : '';
    const ownerBadge = a.owner ? `<span class="proj-sub-owner">@${escHtml(a.owner)}</span>` : '';
    const consultBadge = a.consult ? `<span class="proj-gate">⚑ Consult: ${escHtml(a.consult)}</span>` : '';
    const research = a.research ? `<a class="proj-link proj-sub-link" href="#/project/${escHtml(state.projectId)}/doc/${escHtml(a.research)}" data-doc="${escHtml(a.research)}">📄 ${escHtml(a.research)}</a>` : '';
    const deadline = a.deadline ? `<span class="proj-sub-deadline">⏰ ${escHtml(a.deadline)}</span>` : '';
    const action = a.pending_action ? `<div class="proj-sub-action"><strong>Pending:</strong> ${inline(a.pending_action)}</div>` : '';

    // Type-specific rendering hint
    const typeKind = (a.type || '').toLowerCase();
    let typeIcon = '◎';
    if (typeKind.includes('checklist')) typeIcon = '☐';
    else if (typeKind.includes('data-capture')) typeIcon = '✎';
    else if (typeKind.includes('decision')) typeIcon = '◇';
    else if (typeKind.includes('research')) typeIcon = '🔍';
    else if (typeKind.includes('monitoring')) typeIcon = '👁';

    // Extra attrs displayed if present
    const extras = [];
    if (a.society_demand)   extras.push(`<div class="proj-sub-extra"><strong>Society demand:</strong> ${inline(a.society_demand)}</div>`);
    if (a.recommended_counter) extras.push(`<div class="proj-sub-extra"><strong>Recommended counter:</strong> ${inline(a.recommended_counter)}</div>`);
    if (a.value && a.value !== '_(to be captured)_') extras.push(`<div class="proj-sub-extra"><strong>Value:</strong> ${inline(a.value)}</div>`);
    if (a.notes) extras.push(`<div class="proj-sub-extra"><strong>Notes:</strong> ${inline(a.notes)}</div>`);

    return `<div class="proj-sub ${kind}" data-step="${step.id}" data-id="${escHtml(sub.id)}">
      <div class="proj-sub-row">
        <span class="proj-sub-icon">${typeIcon}</span>
        <span class="proj-sub-id">${escHtml(sub.id)}</span>
        <span class="proj-sub-name">${escHtml(sub.name)}</span>
        <span class="proj-sub-status ${kind}" title="${statusLabel(kind)}">${statusGlyph(kind)}</span>
      </div>
      <div class="proj-sub-meta">
        ${typeBadge}
        ${ownerBadge}
        ${consultBadge}
        ${research}
        ${deadline}
      </div>
      ${action}
      ${extras.join('')}
    </div>`;
  }

  function renderReadyReckoner() {
    const m = state.project.meta;
    const facts = state.project.keyFacts || [];
    const factsList = facts.map(f => `<div class="proj-rr-row"><span class="proj-rr-label">${escHtml(f.label)}</span><span class="proj-rr-value">${inline(f.value)}</span></div>`).join('');

    let countdownHtml = '';
    if (m.hard_deadline) {
      const days = daysBetween(todayIso(), m.hard_deadline);
      let cls = 'ok';
      if (days !== null) {
        if (days < 0) cls = 'past';
        else if (days < 14) cls = 'tight';
        else if (days < 30) cls = 'warn';
      }
      countdownHtml = `<div class="proj-rr-countdown ${cls}">
        <div class="proj-rr-countdown-label">Hard deadline</div>
        <div class="proj-rr-countdown-value">${escHtml(m.hard_deadline)}</div>
        <div class="proj-rr-countdown-delta">${days !== null ? (days < 0 ? `${-days} days past` : `${days} days from today`) : ''}</div>
        ${m.hard_deadline_reason ? `<div class="proj-rr-countdown-reason">${escHtml(m.hard_deadline_reason)}</div>` : ''}
      </div>`;
    }

    return `<div class="proj-card proj-rr">
      <div class="proj-card-title">Ready reckoner</div>
      ${countdownHtml}
      <div class="proj-rr-list">${factsList}</div>
    </div>`;
  }

  function renderTodos() {
    const todos = state.project.todos || [];
    if (!todos.length) return '';
    // Pull todos from sub_items too: any sub_item with pending_action and not done
    const derived = [];
    (state.project.steps || []).forEach(step => {
      (step.sub_items || []).forEach(sub => {
        const k = statusKind(sub.attrs && sub.attrs.status);
        if (k === 'done') return;
        if (sub.attrs && sub.attrs.pending_action) {
          derived.push({ id: sub.id, name: sub.name, action: sub.attrs.pending_action, kind: k, step: step.id });
        }
      });
    });

    const derivedHtml = derived.length
      ? `<div class="proj-todos-section">
          <div class="proj-todos-section-label">Per sub-item</div>
          ${derived.map(d => `<div class="proj-todo proj-todo-derived ${d.kind}">
            <span class="proj-todo-id">${escHtml(d.id)}</span>
            <span class="proj-todo-text"><strong>${escHtml(d.name)}:</strong> ${inline(d.action)}</span>
          </div>`).join('')}
        </div>`
      : '';

    const stateTodosHtml = todos.length
      ? `<div class="proj-todos-section">
          <div class="proj-todos-section-label">From state.md</div>
          ${todos.map(t => `<div class="proj-todo">
            <span class="proj-todo-marker">☐</span>
            <span class="proj-todo-text">${inline(t)}</span>
          </div>`).join('')}
        </div>`
      : '';

    return `<div class="proj-card proj-todos">
      <div class="proj-card-title">Open todos <span class="proj-card-count">${todos.length + derived.length}</span></div>
      ${derivedHtml}
      ${stateTodosHtml}
    </div>`;
  }

  function renderAttachments() {
    const docs = state.project.documents || [];
    if (!docs.length) return '';
    const items = docs.map(d => {
      const path = (d.path || '').replace(/^\[([^\]]+)\]\([^)]+\).*$/, '$1');
      const url = `#/project/${escHtml(state.projectId)}/doc/${escHtml(path)}`;
      return `<a class="proj-doc" href="${url}" data-doc="${escHtml(path)}">
        <span class="proj-doc-icon">📄</span>
        <span class="proj-doc-body">
          <div class="proj-doc-path">${escHtml(path)}</div>
          <div class="proj-doc-meta">${escHtml(d.type || '')}${d.source ? ` · ${escHtml(d.source)}` : ''}${d.phase ? ` · phase ${escHtml(d.phase)}` : ''}</div>
        </span>
      </a>`;
    }).join('');
    return `<div class="proj-card proj-docs">
      <div class="proj-card-title">Documents</div>
      ${items}
    </div>`;
  }

  function renderTeam() {
    const team = state.project.team || [];
    if (!team.length) return '';
    const rows = team.map(t => {
      const consultBadge = t['consult gate'] && t['consult gate'] !== '—' ? `<span class="proj-gate">⚑ ${escHtml(t['consult gate'])}</span>` : '';
      const signoffBadge = t['sign-off gate'] && t['sign-off gate'] !== '—' ? `<span class="proj-gate proj-gate-signoff">✍ ${escHtml(t['sign-off gate'])}</span>` : '';
      return `<div class="proj-team-row">
        <div class="proj-team-handle">@${escHtml(t.handle || '')}</div>
        <div class="proj-team-role">${escHtml(t.role || '')}</div>
        <div class="proj-team-gates">${consultBadge}${signoffBadge}</div>
      </div>`;
    }).join('');
    return `<div class="proj-card proj-team">
      <div class="proj-card-title">Team</div>
      ${rows}
    </div>`;
  }

  // ── Main render ────────────────────────────────

  function renderProject(container) {
    container.innerHTML = `
      ${renderStatusHeader()}
      <div class="proj-grid">
        <div class="proj-main">
          ${renderStepwiseWorkflow()}
        </div>
        <div class="proj-side">
          ${renderReadyReckoner()}
          ${renderTodos()}
          ${renderTeam()}
          ${renderAttachments()}
        </div>
      </div>
      <div class="proj-mvp-note">
        <span class="proj-mvp-tag">MVP</span>
        Read-only render. Writeback (checklist tick → state.md commit), agent dispatch handles, edit modals coming via CD-review iteration. Source: <a class="proj-link" href="https://github.com/${escHtml(CONFIG.username)}/V-Pro-Hub/blob/master/projects/${escHtml(state.projectId)}/state.md" target="_blank" rel="noopener">projects/${escHtml(state.projectId)}/state.md</a>
      </div>
    `;
    wireEvents(container);
  }

  function wireEvents(container) {
    // Doc links: hijack to navigate to GitHub blob view (MVP fallback — proper inline doc viewer post-CD)
    container.querySelectorAll('[data-doc]').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        const path = el.dataset.doc;
        const url = `https://github.com/${CONFIG.username}/V-Pro-Hub/blob/master/projects/${state.projectId}/${path}`;
        window.open(url, '_blank', 'noopener');
      });
    });
  }

  // ── Public render ──────────────────────────────

  async function render(container, param) {
    state.projectId = param || null;
    if (!state.projectId) {
      // Default: redirect to vhalli (only Layer B project today)
      container.innerHTML = renderEmpty();
      return;
    }

    container.innerHTML = renderSkeleton();
    try {
      const owner = CONFIG.username;
      const repo  = (typeof CONFIG.dashboardRepo === 'string' && CONFIG.dashboardRepo) ? CONFIG.dashboardRepo : 'V-Pro-Hub';
      const path  = `projects/${state.projectId}/state.md`;
      const md = await Repos.getFile(owner, repo, path);
      if (!md) { container.innerHTML = renderError({ message: `state.md not found at ${path}` }); return; }
      state.project = parseStateMd(md);
      renderProject(container);
    } catch (e) {
      console.error('[ProjectView] render error', e);
      state.error = e;
      container.innerHTML = renderError(e);
    }
  }

  return { render };
})();
