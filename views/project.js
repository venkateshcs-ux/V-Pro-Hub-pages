// views/project.js — Layer B Project Surface (S037 — writeback live)
//
// Renders projects/<id>/state.md as an interactive working file:
//   - Status header (project name, layer/class/domain, current phase, key facts strip)
//   - Stepwise workflow (accordion: steps + sub-items + status badges + consult gates)
//   - Ready reckoner sidebar (key facts + countdown to hard deadline)
//   - Open todos panel (toggle/add/edit/remove → state.md round-trip)
//   - Documents panel (links to research/decisions files)
//
// Writeback (S037, autonomous/S037):
//   ✓ Op 1 — toggle todo done (`- [ ]` ↔ `- [x]`)
//   ✓ Op 2 — cycle sub-item status (▶ progress / ✓ done / ⏸ blocked / ⏳ pending)
//   ✓ Op 3 — add new todo (insert into `## Open todos` section)
//   ✓ Op 4 — inline edit todo / sub-item text
//   ✓ Op 5 — remove todo
//   ✓ Public/readonly mode hides all edit affordances
//   ✓ Optimistic UI w/ SHA-conflict toast (reuses #76 Backlog 2.0 pattern)
//
// Round-trip strategy: line-targeted safe replace on the original raw markdown.
// Never re-serialize parsed model back to text. Frontmatter byte-for-byte preserved.

window.ProjectView = (() => {

  // ── Module state ───────────────────────────────

  const state = {
    projectId: null,
    project:   null,    // parsed data
    error:     null,
    stateRaw:  null,    // original state.md text (truth for line-targeted edits)
    stateSha:  null,    // current SHA (for SHA-guarded writeback)
    statePath: null,    // `projects/<id>/state.md`
    repo:      null,    // resolved at render
    owner:     null,
  };

  // ── Helpers ────────────────────────────────────

  function isReadOnly() {
    return document.body.getAttribute('data-mode') === 'readonly';
  }

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
      if (v === 'true')  { out[key] = true;  return; }
      if (v === 'false') { out[key] = false; return; }
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
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

  function splitSections(body) {
    const sections = {};
    let current = null;
    let buf = [];
    body.split(/\r?\n/).forEach(line => {
      const m = line.match(/^##\s+(.+?)\s*$/);
      if (m) {
        if (current) sections[current] = buf.join('\n');
        current = m[1].replace(/\s*\(.*?\)\s*$/, '').trim();
        buf = [];
      } else {
        buf.push(line);
      }
    });
    if (current) sections[current] = buf.join('\n');
    return sections;
  }

  function parseMdTable(text) {
    const rows = [];
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.startsWith('|'));
    if (lines.length < 2) return rows;
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

  // Parse Steps + sub-items. Adds `_rawStatus` (original status line text) to each sub-item
  // for line-targeted writeback.
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
        curSub = { id: subM[1], name: subM[2].trim(), attrs: {}, _rawStatusLine: null };
        continue;
      }
      if (curStep && !curSub) {
        const ssm = line.match(/^Status:\s*\*\*(.+?)\*\*\s*$/i);
        if (ssm) { curStep.status = ssm[1].toLowerCase().replace(/\s+[▶✓⏳⏸].*/, '').trim(); continue; }
        const sm = line.match(/^Status:\s*(.+?)\s*$/i);
        if (sm) { curStep.status = sm[1].toLowerCase().replace(/\*+/g, '').replace(/\s+[▶✓⏳⏸].*/, '').trim(); continue; }
        const gm = line.match(/^\s*\d+\.\s+(.+?)\s*$/);
        if (gm && /goals/i.test(curStep.notes || '')) { curStep.goals.push(gm[1].trim()); }
        if (/\*\*Goals:\*\*/i.test(line)) curStep.notes = (curStep.notes || '') + 'goals\n';
        const cm = line.match(/^\*\*Consult\s*\/?\s*sign-off:\*\*/i);
        if (cm) curStep.notes = (curStep.notes || '') + 'consult\n';
        if (/^[-*]\s*Ssuresh consult/i.test(line)) curStep.consult.push('ssuresh');
        if (/^[-*]\s*SEBI-registered IA/i.test(line)) curStep.consult.push('tbd-ia');
        if (/^[-*]\s*Real CA/i.test(line) || /^[-*]\s*CA sign-off/i.test(line)) curStep.consult.push('tbd-ca');
      }
      if (curSub) {
        const am = line.match(/^-\s*\*\*([\w\s\-/]+?):\*\*\s*(.+)\s*$/);
        if (am) {
          const key = am[1].toLowerCase().trim().replace(/\s+/g, '_').replace(/[\/-]/g, '_');
          curSub.attrs[key] = am[2].trim();
          if (key === 'status') curSub._rawStatusLine = line;
          continue;
        }
      }
    }
    pushStep();
    return steps;
  }

  function parseTodos(text) {
    const todos = [];
    text.split(/\r?\n/).forEach(line => {
      const m = line.match(/^[-*]\s*\[([ xX])\]\s+(.+?)\s*$/);
      if (m) todos.push({ done: /[xX]/.test(m[1]), text: m[2].trim(), raw: line });
    });
    return todos;
  }

  function parseStateMd(md) {
    const { frontmatter, body } = splitFrontmatter(md);
    const meta = parseYaml(frontmatter);
    const sections = splitSections(body);

    const keyFacts  = parseMdTable(sections['Key facts'] || '');
    const team      = parseMdTable(sections['Team'] || '');
    const documents = parseMdTable(sections['Documents'] || sections['Documents (attachments)'] || '');
    const todosKey  = Object.keys(sections).find(k => /^Open todos/i.test(k)) || 'Open todos';
    const todos     = parseTodos(sections[todosKey] || '');
    const steps     = parseSteps(sections['Steps'] || '');

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

  // Cycle: pending → progress → done → blocked → pending
  function cycleStatus(kind) {
    return ({ pending: 'progress', progress: 'done', done: 'blocked', blocked: 'pending' })[kind] || 'progress';
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

  // ── Toast + save indicator (sibling of #76 backlog) ─

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

  function pushToast({ kind = 'success', icon, msg, action, onAction, ttl = 2500 }) {
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

  let _savesInFlight = 0;
  function saveStart() {
    _savesInFlight++;
    document.body.setAttribute('data-saves-in-flight', '');
  }
  function saveEnd() {
    _savesInFlight = Math.max(0, _savesInFlight - 1);
    if (_savesInFlight === 0) document.body.removeAttribute('data-saves-in-flight');
  }

  // ── Markdown line-targeted mutations ──────────

  // Status label string used in state.md `**Status:**` lines, indexed by kind.
  // Falls back to original (pending) if existing text is richer (e.g. "in-progress (negotiation pending)").
  function statusValueFor(kind, oldValue) {
    const base = ({
      pending:  'pending',
      progress: 'in-progress',
      done:     'done',
      blocked:  'blocked',
    })[kind] || 'pending';
    // Preserve trailing parenthetical, e.g. `in-progress (negotiation pending)` keeps "(negotiation pending)"
    const paren = oldValue ? oldValue.match(/\s*(\([^)]*\))\s*$/) : null;
    return paren ? `${base} ${paren[1]}` : base;
  }

  // Find the line index of `## Open todos` (or variant) in the raw text.
  function findOpenTodosHeading(rawLines) {
    for (let i = 0; i < rawLines.length; i++) {
      if (/^##\s+Open todos\b/i.test(rawLines[i])) return i;
    }
    return -1;
  }

  // Find the line index of a `#### N.M — name` heading (sub-item).
  function findSubItemHeading(rawLines, subId) {
    const re = new RegExp(`^####\\s+${subId.replace('.', '\\.')}\\s*[—\\-]`);
    for (let i = 0; i < rawLines.length; i++) {
      if (re.test(rawLines[i])) return i;
    }
    return -1;
  }

  // Within a sub-item block (after its #### heading), find the `- **Status:** value` line.
  function findSubItemStatusLine(rawLines, subStartIdx) {
    for (let i = subStartIdx + 1; i < rawLines.length; i++) {
      const line = rawLines[i];
      // Stop at next sub-item, step, or H2
      if (/^####\s/.test(line) || /^###\s/.test(line) || /^##\s/.test(line)) return -1;
      if (/^-\s*\*\*Status:\*\*/i.test(line)) return i;
    }
    return -1;
  }

  // Mutate raw text by op spec. Returns new text. Throws if target line not found.
  function mutateStateMd(rawText, op) {
    const lines = rawText.split(/\r?\n/);
    const eol = /\r\n/.test(rawText) ? '\r\n' : '\n';

    if (op.kind === 'toggle-todo') {
      // Locate `- [ ] <text>` or `- [x] <text>` line by exact text match
      const target = op.text;
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^([-*]\s*)\[([ xX])\](\s+)(.+?)(\s*)$/);
        if (m && m[4].trim() === target.trim()) {
          const newCheck = op.done ? 'x' : ' ';
          lines[i] = `${m[1]}[${newCheck}]${m[3]}${m[4]}${m[5]}`;
          return lines.join(eol);
        }
      }
      throw new Error(`Could not find todo line: "${target}"`);
    }

    if (op.kind === 'cycle-substatus') {
      const subStart = findSubItemHeading(lines, op.subId);
      if (subStart < 0) throw new Error(`Could not find sub-item heading ${op.subId}`);
      const statusIdx = findSubItemStatusLine(lines, subStart);
      if (statusIdx < 0) throw new Error(`Could not find Status line under ${op.subId}`);
      const oldLine = lines[statusIdx];
      const m = oldLine.match(/^(-\s*\*\*Status:\*\*\s*)(.+)$/i);
      if (!m) throw new Error(`Status line malformed at line ${statusIdx + 1}`);
      const newValue = statusValueFor(op.newKind, m[2]);
      lines[statusIdx] = `${m[1]}${newValue}`;
      return lines.join(eol);
    }

    if (op.kind === 'add-todo') {
      const headingIdx = findOpenTodosHeading(lines);
      if (headingIdx < 0) throw new Error(`Could not find ## Open todos heading`);
      // Find last `- [ ]`/`- [x]` line under this heading; insert after it.
      // If none, insert two lines after heading (heading + blank line).
      let lastTodo = -1;
      for (let i = headingIdx + 1; i < lines.length; i++) {
        if (/^##\s/.test(lines[i])) break;     // next H2 ends section
        if (/^---\s*$/.test(lines[i])) break;  // separator ends section
        if (/^[-*]\s*\[[ xX]\]\s+/.test(lines[i])) lastTodo = i;
      }
      const newLine = `- [ ] ${op.text}`;
      if (lastTodo >= 0) {
        lines.splice(lastTodo + 1, 0, newLine);
      } else {
        // Insert 2 lines after heading (skip the blank under the heading if present)
        let insertAt = headingIdx + 1;
        while (insertAt < lines.length && lines[insertAt].trim() === '') insertAt++;
        lines.splice(insertAt, 0, newLine);
      }
      return lines.join(eol);
    }

    if (op.kind === 'edit-todo') {
      const target = op.oldText;
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^([-*]\s*\[[ xX]\]\s+)(.+?)(\s*)$/);
        if (m && m[2].trim() === target.trim()) {
          lines[i] = `${m[1]}${op.newText}${m[3]}`;
          return lines.join(eol);
        }
      }
      throw new Error(`Could not find todo to edit: "${target}"`);
    }

    if (op.kind === 'remove-todo') {
      const target = op.text;
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^[-*]\s*\[[ xX]\]\s+(.+?)\s*$/);
        if (m && m[1].trim() === target.trim()) {
          lines.splice(i, 1);
          return lines.join(eol);
        }
      }
      throw new Error(`Could not find todo to remove: "${target}"`);
    }

    throw new Error(`Unknown mutation op: ${op.kind}`);
  }

  // ── Writeback ──────────────────────────────────

  async function writeStateMd(reason, op) {
    // Re-fetch latest state.md to get fresh SHA + content (handles concurrent edits)
    const latest = await Repos.getFileWithSha(state.owner, state.repo, state.statePath);
    if (!latest) throw new Error('Could not fetch state.md SHA');
    state.stateRaw = latest.content;
    state.stateSha = latest.sha;
    const newText = mutateStateMd(latest.content, op);
    if (newText === latest.content) {
      // No-op (e.g. user toggled then untoggled fast). Skip PUT.
      return null;
    }
    const result = await Repos.putFile(
      state.owner, state.repo, state.statePath,
      newText, latest.sha,
      `Project view writeback (${reason}) — autonomous via UI`
    );
    state.stateRaw = newText;
    state.stateSha = result.sha;
    return result;
  }

  // Reload + rerender from server (on conflict or successful write that needs full refresh)
  async function reload(container) {
    const latest = await Repos.getFileWithSha(state.owner, state.repo, state.statePath);
    if (!latest) { container.innerHTML = renderError({ message: `state.md not found at ${state.statePath}` }); return; }
    state.stateRaw = latest.content;
    state.stateSha = latest.sha;
    state.project = parseStateMd(latest.content);
    renderProject(container);
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
    const saveDot = `<span class="proj-save-indicator" aria-hidden="true" title="Saving..."></span>`;

    return `<div class="proj-header">
      <div class="proj-h-row">
        <div>
          <div class="proj-h-title">${escHtml(m.name || state.projectId || '')}${saveDot}</div>
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
    const progressBar = subCount > 0 ? `<span class="proj-step-progress">${doneCount}/${subCount}</span>` : '';
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

  // S038 — postman-pattern attrs (cross-tool handoff per GR16 mechanism (c)).
  // Maps a `target_tool` slug to a human label for the "via X" badge.
  const TOOL_LABELS = {
    'perplexity-pro': 'Perplexity Pro',
    'claude-design':  'Claude Design',
    'claude-text':    'Claude (text)',
    'claude-code':    'Claude Code',
    'runway-standard': 'Runway',
  };

  function renderSubItem(sub, step) {
    const a = sub.attrs || {};
    const kind = statusKind(a.status);
    const typeBadge = a.type ? `<span class="proj-sub-type">${escHtml(a.type)}</span>` : '';
    const ownerBadge = a.owner ? `<span class="proj-sub-owner">@${escHtml(a.owner)}</span>` : '';
    const consultBadge = a.consult ? `<span class="proj-gate">⚑ Consult: ${escHtml(a.consult)}</span>` : '';
    const research = a.research ? `<a class="proj-link proj-sub-link" href="#/project/${escHtml(state.projectId)}/doc/${escHtml(a.research)}" data-doc="${escHtml(a.research)}">📄 ${escHtml(a.research)}</a>` : '';
    const deadline = a.deadline ? `<span class="proj-sub-deadline">⏰ ${escHtml(a.deadline)}</span>` : '';
    const action = a.pending_action ? `<div class="proj-sub-action"><strong>Pending:</strong> ${inline(a.pending_action)}</div>` : '';

    // S038 — postman pattern: target_tool / prompt_path / return_path.
    // Renders the cross-tool handoff envelope so Venkatesh (postman) can see
    // at a glance: which tool, where the prompt artifact lives, where output returns.
    const toolLabel = a.target_tool ? (TOOL_LABELS[a.target_tool] || a.target_tool) : '';
    const viaBadge = a.target_tool ? `<span class="proj-sub-via" title="Cross-tool handoff target — postman pattern">via ${escHtml(toolLabel)}</span>` : '';
    const promptLink = a.prompt_path ? `<a class="proj-link proj-sub-link" href="#/project/${escHtml(state.projectId)}/doc/${escHtml(a.prompt_path)}" data-doc="${escHtml(a.prompt_path)}" title="Prompt artifact for the cross-tool handoff">📝 prompt</a>` : '';
    const returnLink = a.return_path ? `<a class="proj-link proj-sub-link" href="#/project/${escHtml(state.projectId)}/doc/${escHtml(a.return_path)}" data-doc="${escHtml(a.return_path)}" title="Where the postman drops the output back">📥 return → ${escHtml(a.return_path)}</a>` : '';

    const typeKind = (a.type || '').toLowerCase();
    let typeIcon = '◎';
    if (typeKind.includes('checklist')) typeIcon = '☐';
    else if (typeKind.includes('data-capture')) typeIcon = '✎';
    else if (typeKind.includes('decision')) typeIcon = '◇';
    else if (typeKind.includes('research')) typeIcon = '🔍';
    else if (typeKind.includes('monitoring')) typeIcon = '👁';

    const extras = [];
    if (a.society_demand)      extras.push(`<div class="proj-sub-extra"><strong>Society demand:</strong> ${inline(a.society_demand)}</div>`);
    if (a.recommended_counter) extras.push(`<div class="proj-sub-extra"><strong>Recommended counter:</strong> ${inline(a.recommended_counter)}</div>`);
    if (a.value && a.value !== '_(to be captured)_') extras.push(`<div class="proj-sub-extra"><strong>Value:</strong> ${inline(a.value)}</div>`);
    if (a.notes) extras.push(`<div class="proj-sub-extra"><strong>Notes:</strong> ${inline(a.notes)}</div>`);

    // Op 2 — sub-item status cycle button (interactive when not readonly)
    const statusBtn = isReadOnly()
      ? `<span class="proj-sub-status ${kind}" title="${statusLabel(kind)}">${statusGlyph(kind)}</span>`
      : `<button class="proj-sub-status proj-clickable ${kind}"
              data-sub-status-cycle data-sub-id="${escHtml(sub.id)}"
              title="Click to cycle status (currently: ${statusLabel(kind)})">${statusGlyph(kind)}</button>`;

    return `<div class="proj-sub ${kind}" data-step="${step.id}" data-id="${escHtml(sub.id)}">
      <div class="proj-sub-row">
        <span class="proj-sub-icon">${typeIcon}</span>
        <span class="proj-sub-id">${escHtml(sub.id)}</span>
        <span class="proj-sub-name">${escHtml(sub.name)}</span>
        ${statusBtn}
      </div>
      <div class="proj-sub-meta">
        ${typeBadge}
        ${ownerBadge}
        ${viaBadge}
        ${consultBadge}
        ${research}
        ${promptLink}
        ${returnLink}
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

  // S038 — extract sub-item / cross-step group reference from a todo's
  // trailing parenthetical (e.g. "(1.2)", "(1.1 cross — ...)", or "(1.1) — note").
  // Allows an optional trailing dash-note (em-dash or hyphen) after the paren so
  // todos like "Send NOC letter (1.1) — Ssuresh consult before" still group correctly.
  // Used by renderTodos to bucket todos under their owning sub-item heading.
  function parseTodoMeta(text) {
    const re = /\s*\((\d+(?:\.\d+)?)\b([^)]*)\)(\s*(?:[—\-][\s\S]*)?)\s*$/;
    const m = text.match(re);
    if (!m) return { subId: null, stepId: null, isCross: false, displayText: text };
    const subId    = m[1];
    const isCross  = /\bcross\b/i.test(m[2] || '');
    const stepId   = subId.includes('.') ? parseInt(subId.split('.')[0], 10) : parseInt(subId, 10);
    const dashNote = (m[3] || '').trim();
    const displayText = text.replace(re, dashNote ? ` ${dashNote}` : '').trim();
    return { subId, stepId, isCross, displayText };
  }

  function renderTodoLine(t, ro, opts) {
    opts = opts || {};
    const checked = t.done;
    const display = opts.showSuffix ? t.text : (t.displayText || t.text);
    const checkbox = ro
      ? `<span class="proj-todo-marker ${checked ? 'is-done' : ''}">${checked ? '☑' : '☐'}</span>`
      : `<button class="proj-todo-checkbox ${checked ? 'is-done' : ''}" data-todo-toggle data-text="${escHtml(t.text)}" aria-label="${checked ? 'Mark not done' : 'Mark done'}">${checked ? '☑' : '☐'}</button>`;
    const textHtml = ro
      ? `<span class="proj-todo-text${checked ? ' is-done' : ''}">${inline(display)}</span>`
      : `<span class="proj-todo-text${checked ? ' is-done' : ''}" data-todo-text="${escHtml(t.text)}" tabindex="0" title="Double-click to edit">${inline(display)}</span>`;
    const removeBtn = ro ? '' : `<button class="proj-todo-remove" data-todo-remove data-text="${escHtml(t.text)}" aria-label="Remove" title="Remove">×</button>`;
    return `<div class="proj-todo${checked ? ' is-done' : ''}">${checkbox}${textHtml}${removeBtn}</div>`;
  }

  function renderTodos() {
    const todosRaw = state.project.todos || [];
    const ro = isReadOnly();

    // Enrich + bucket
    const todos = todosRaw.map(t => Object.assign({}, t, parseTodoMeta(t.text)));
    const bySub = new Map();   // subId -> [todos]
    const crossList = [];
    const otherList = [];
    todos.forEach(t => {
      if (t.isCross) { crossList.push(t); return; }
      if (t.subId && t.subId.includes('.')) {
        if (!bySub.has(t.subId)) bySub.set(t.subId, []);
        bySub.get(t.subId).push(t);
        return;
      }
      otherList.push(t);
    });

    // Per-sub-item groups in document order; each shows derived pending_action
    // (from state.md sub-item attrs) followed by direct todos.
    const steps = state.project.steps || [];
    const groupBlocks = [];
    steps.forEach(step => {
      (step.sub_items || []).forEach(sub => {
        const direct = bySub.get(sub.id) || [];
        const a = sub.attrs || {};
        const subKind = statusKind(a.status);
        const hasDerived = a.pending_action && subKind !== 'done';
        if (!hasDerived && direct.length === 0) return;
        const derivedHtml = hasDerived
          ? `<div class="proj-todo-group-derived"><span class="proj-todo-group-derived-label">Pending:</span> ${inline(a.pending_action)}</div>`
          : '';
        const todosHtml = direct.map(t => renderTodoLine(t, ro)).join('');
        groupBlocks.push(`<div class="proj-todo-group ${subKind}">
          <div class="proj-todo-group-head">
            <span class="proj-todo-group-id">${escHtml(sub.id)}</span>
            <span class="proj-todo-group-name">${escHtml(sub.name)}</span>
            <span class="proj-todo-group-status ${subKind}" title="${statusLabel(subKind)}">${statusGlyph(subKind)}</span>
          </div>
          ${derivedHtml}
          ${todosHtml}
        </div>`);
      });
    });

    const crossHtml = crossList.length
      ? `<div class="proj-todo-group proj-todo-group-cross">
          <div class="proj-todo-group-head">
            <span class="proj-todo-group-name">Cross-step</span>
          </div>
          ${crossList.map(t => renderTodoLine(t, ro, { showSuffix: true })).join('')}
        </div>`
      : '';

    const otherHtml = otherList.length
      ? `<div class="proj-todo-group proj-todo-group-other">
          <div class="proj-todo-group-head">
            <span class="proj-todo-group-name">Other</span>
          </div>
          ${otherList.map(t => renderTodoLine(t, ro)).join('')}
        </div>`
      : '';

    const addHtml = ro ? '' : `<div class="proj-todos-add-row">
        <button class="proj-todos-add" data-todo-add aria-label="Add todo">+ Add todo</button>
      </div>`;

    return `<div class="proj-card proj-todos">
      <div class="proj-card-title">Open todos <span class="proj-card-count">${todos.length}</span></div>
      ${groupBlocks.join('')}
      ${crossHtml}
      ${otherHtml}
      ${addHtml}
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
    const ro = isReadOnly();
    const note = ro
      ? `<div class="proj-mvp-note"><span class="proj-mvp-tag">Read-only</span> Public mode — sign in for edits. Source: <a class="proj-link" href="https://github.com/${escHtml(CONFIG.username)}/V-Pro-Hub/blob/master/projects/${escHtml(state.projectId)}/state.md" target="_blank" rel="noopener">projects/${escHtml(state.projectId)}/state.md</a></div>`
      : `<div class="proj-mvp-note proj-mvp-live"><span class="proj-mvp-tag proj-mvp-tag-live">Live</span> Edits round-trip to <a class="proj-link" href="https://github.com/${escHtml(CONFIG.username)}/V-Pro-Hub/blob/master/projects/${escHtml(state.projectId)}/state.md" target="_blank" rel="noopener">projects/${escHtml(state.projectId)}/state.md</a> via GitHub Contents API.</div>`;

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
      ${note}
    `;
    wireEvents(container);
  }

  // ── Event wiring ───────────────────────────────

  function wireEvents(container) {
    // Doc links: open the file on github.com (MVP fallback for inline doc viewer)
    container.querySelectorAll('[data-doc]').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        const path = el.dataset.doc;
        const url = `https://github.com/${CONFIG.username}/V-Pro-Hub/blob/master/projects/${state.projectId}/${path}`;
        window.open(url, '_blank', 'noopener');
      });
    });

    if (isReadOnly()) return;

    // Op 1 — toggle todo done
    container.querySelectorAll('[data-todo-toggle]').forEach(btn => {
      btn.addEventListener('click', () => onToggleTodo(container, btn.dataset.text));
    });

    // Op 2 — cycle sub-item status
    container.querySelectorAll('[data-sub-status-cycle]').forEach(btn => {
      btn.addEventListener('click', () => onCycleSubStatus(container, btn.dataset.subId));
    });

    // Op 3 — add new todo
    container.querySelectorAll('[data-todo-add]').forEach(btn => {
      btn.addEventListener('click', () => onAddTodo(container, btn));
    });

    // Op 4 — inline edit text (double-click or Enter on focused span)
    container.querySelectorAll('[data-todo-text]').forEach(span => {
      span.addEventListener('dblclick', () => onEditTodoStart(container, span));
      span.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); onEditTodoStart(container, span); }
      });
    });

    // Op 5 — remove todo
    container.querySelectorAll('[data-todo-remove]').forEach(btn => {
      btn.addEventListener('click', () => onRemoveTodo(container, btn.dataset.text));
    });
  }

  // ── Op handlers ────────────────────────────────

  async function onToggleTodo(container, text) {
    const todo = (state.project.todos || []).find(t => t.text === text);
    if (!todo) return;
    const newDone = !todo.done;

    // Optimistic UI
    todo.done = newDone;
    renderProject(container);
    saveStart();
    try {
      await writeStateMd(`toggle-todo ${newDone ? 'done' : 'undone'}`, { kind: 'toggle-todo', text, done: newDone });
      pushToast({ kind: 'success', msg: newDone ? `Marked done: ${truncate(text, 40)}` : `Reopened: ${truncate(text, 40)}`, ttl: 1500 });
    } catch (e) {
      todo.done = !newDone;  // rollback
      renderProject(container);
      handleWriteError(container, e);
    } finally { saveEnd(); }
  }

  async function onCycleSubStatus(container, subId) {
    let sub = null;
    let step = null;
    for (const s of state.project.steps || []) {
      const found = (s.sub_items || []).find(x => x.id === subId);
      if (found) { sub = found; step = s; break; }
    }
    if (!sub) return;

    const oldKind = statusKind(sub.attrs && sub.attrs.status);
    const newKind = cycleStatus(oldKind);
    const oldStatusValue = sub.attrs && sub.attrs.status;

    // Optimistic UI
    sub.attrs = sub.attrs || {};
    sub.attrs.status = statusValueFor(newKind, oldStatusValue);
    renderProject(container);
    saveStart();
    try {
      await writeStateMd(`cycle-substatus ${subId} → ${newKind}`, { kind: 'cycle-substatus', subId, newKind });
      pushToast({ kind: 'success', msg: `${subId} → ${statusLabel(newKind)}`, ttl: 1500 });
    } catch (e) {
      sub.attrs.status = oldStatusValue;  // rollback
      renderProject(container);
      handleWriteError(container, e);
    } finally { saveEnd(); }
  }

  async function onAddTodo(container, btn) {
    // Replace button with inline input
    const row = btn.parentElement;
    row.innerHTML = `<input class="proj-todos-add-input" placeholder="What's next?" />
      <button class="proj-todos-add-save">Add</button>
      <button class="proj-todos-add-cancel">Cancel</button>`;
    const input = row.querySelector('.proj-todos-add-input');
    const save  = row.querySelector('.proj-todos-add-save');
    const cancel = row.querySelector('.proj-todos-add-cancel');
    input.focus();

    const submit = async () => {
      const text = input.value.trim();
      if (!text) { renderProject(container); return; }

      // Optimistic UI
      state.project.todos = state.project.todos || [];
      state.project.todos.push({ done: false, text, raw: `- [ ] ${text}` });
      renderProject(container);
      saveStart();
      try {
        await writeStateMd(`add-todo`, { kind: 'add-todo', text });
        pushToast({ kind: 'success', msg: `Added: ${truncate(text, 40)}`, ttl: 1500 });
      } catch (e) {
        state.project.todos.pop();
        renderProject(container);
        handleWriteError(container, e);
      } finally { saveEnd(); }
    };

    save.addEventListener('click', submit);
    cancel.addEventListener('click', () => renderProject(container));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { e.preventDefault(); renderProject(container); }
    });
  }

  function onEditTodoStart(container, span) {
    const oldText = span.dataset.todoText;
    const wrap = document.createElement('span');
    wrap.className = 'proj-todo-edit';
    wrap.innerHTML = `<input class="proj-todo-edit-input" value="${escHtml(oldText)}" />
      <button class="proj-todo-edit-save">Save</button>
      <button class="proj-todo-edit-cancel">×</button>`;
    span.replaceWith(wrap);
    const input = wrap.querySelector('.proj-todo-edit-input');
    input.focus(); input.select();

    const submit = async () => {
      const newText = input.value.trim();
      if (!newText || newText === oldText) { renderProject(container); return; }

      const todo = (state.project.todos || []).find(t => t.text === oldText);
      if (!todo) { renderProject(container); return; }
      // Optimistic UI
      todo.text = newText;
      renderProject(container);
      saveStart();
      try {
        await writeStateMd(`edit-todo`, { kind: 'edit-todo', oldText, newText });
        pushToast({ kind: 'success', msg: `Updated: ${truncate(newText, 40)}`, ttl: 1500 });
      } catch (e) {
        todo.text = oldText;
        renderProject(container);
        handleWriteError(container, e);
      } finally { saveEnd(); }
    };
    wrap.querySelector('.proj-todo-edit-save').addEventListener('click', submit);
    wrap.querySelector('.proj-todo-edit-cancel').addEventListener('click', () => renderProject(container));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { e.preventDefault(); renderProject(container); }
    });
  }

  async function onRemoveTodo(container, text) {
    if (!confirm(`Remove this todo?\n\n"${text}"`)) return;

    // Optimistic UI
    const todos = state.project.todos || [];
    const idx = todos.findIndex(t => t.text === text);
    if (idx < 0) return;
    const removed = todos.splice(idx, 1)[0];
    renderProject(container);
    saveStart();
    try {
      await writeStateMd(`remove-todo`, { kind: 'remove-todo', text });
      pushToast({ kind: 'success', msg: `Removed: ${truncate(text, 40)}`, ttl: 1500 });
    } catch (e) {
      todos.splice(idx, 0, removed);
      renderProject(container);
      handleWriteError(container, e);
    } finally { saveEnd(); }
  }

  function handleWriteError(container, e) {
    if (e && e.code === 'sha_conflict') {
      pushToast({ kind: 'danger', icon: '⚠',
        msg: 'Someone else edited this — reload to see latest',
        action: 'Reload', onAction: () => reload(container), ttl: 6000 });
    } else if (e && /401|invalid|expired/i.test(e.message || '')) {
      pushToast({ kind: 'danger', icon: '⚠', msg: 'Auth failed — check PAT in config.js', ttl: 5000 });
    } else {
      pushToast({ kind: 'danger', icon: '⚠', msg: `Save failed: ${e && e.message ? e.message : 'unknown error'}`, ttl: 4000 });
    }
  }

  function truncate(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  // ── _FEED.md fallback (S037ext Track A) ────────
  // Used when projects/<id>/state.md doesn't exist but _FEED.md does
  // (project-not-product / nontech-initiative class — IGNITE, Basketball
  // Literacy, etc). Renders a minimal read-only surface so click-through
  // from Orchestrator doesn't dead-end on "Could not load project."

  function parseFeed(md) {
    const result = { lastUpdated: null, purpose: null, phases: [], nextStep: {} };

    const updm = md.match(/^# Last updated:\s*(\d{4}-\d{2}-\d{2})/m);
    if (updm) result.lastUpdated = updm[1];

    const purpm = md.match(/## Purpose\s*\n\s*\n?([^\n#][^\n]+)/);
    if (purpm) result.purpose = purpm[1].trim();

    const statem = md.match(/## Current state[\s\S]*?```([\s\S]*?)```/);
    if (statem) {
      result.phases = statem[1].trim().split('\n')
        .filter(l => l.trim())
        .map(l => {
          const m = l.match(/Phase\s+(\d+)\s*[—–-]\s*([^:]+):\s*(.+)/);
          if (!m) return null;
          const raw = m[3].trim();
          const status = (raw.includes('Done') || raw.includes('✓'))                                 ? 'done'
                       : (raw.includes('▶') || /in progress/i.test(raw) || raw.includes('current')) ? 'active'
                       : 'pending';
          return { number: m[1], name: m[2].trim(), status };
        })
        .filter(Boolean);
    }

    const nsm = md.match(/## Next step\s*\n([\s\S]*?)(?=\n## |\n---)/);
    if (nsm) {
      let curKey = null; let curVal = [];
      const flush = () => { if (curKey) result.nextStep[curKey] = curVal.join(' ').replace(/`/g, '').trim(); };
      for (const line of nsm[1].split('\n')) {
        const km = line.match(/^\*\*([^*]+)\*\*[:\s]+(.*)$/);
        if (km) {
          flush();
          curKey = km[1].replace(/[?:]+$/, '').trim();
          curVal = [km[2].replace(/`/g, '').trim()];
        } else if (curKey && line.trim()) {
          curVal.push(line.replace(/`/g, '').trim());
        }
      }
      flush();
    }

    return result;
  }

  function renderFeedPhaseStrip(phases) {
    if (!phases || !phases.length) return '';
    return `<div class="proj-feed-phase-strip">` +
      phases.map((p, i) => {
        const cls   = p.status === 'done' ? 'ph-done' : p.status === 'active' ? 'ph-active' : 'ph-pending';
        const conn  = i < phases.length - 1
          ? `<div class="proj-feed-phase-conn${p.status === 'done' ? ' ph-conn-done' : ''}"></div>`
          : '';
        return `<div class="proj-feed-phase ${cls}" title="Phase ${escHtml(p.number)} — ${escHtml(p.name)}">
          <div class="proj-feed-phase-dot"></div>
          <div class="proj-feed-phase-label"><span class="proj-feed-phase-num">${escHtml(p.number)}</span> ${escHtml(p.name)}</div>
        </div>${conn}`;
      }).join('') +
      `</div>`;
  }

  function renderFeedSurface(container) {
    const f = state.feed;
    const id = state.projectId;
    const feedGhUrl = `https://github.com/${escHtml(CONFIG.username)}/V-Pro-Hub/blob/master/projects/${escHtml(id)}/_FEED.md`;

    const updatedLine = f.lastUpdated ? `<div class="proj-h-updated">Last updated <strong>${escHtml(f.lastUpdated)}</strong></div>` : '';

    const nextStepEntries = Object.entries(f.nextStep || {});
    const nextStepHtml = nextStepEntries.length
      ? `<div class="proj-card proj-feed-nextstep">
          <div class="proj-card-title">Next step</div>
          ${nextStepEntries.map(([k, v]) => `<div class="proj-feed-ns-row">
            <span class="proj-feed-ns-key">${escHtml(k)}</span>
            <span class="proj-feed-ns-val">${inline(v)}</span>
          </div>`).join('')}
        </div>`
      : '';

    container.innerHTML = `
      <div class="proj-header">
        <div class="proj-h-row">
          <div>
            <div class="proj-h-title">${escHtml(id)}</div>
            <div class="proj-h-meta">
              <span class="proj-badge proj-badge-feed">_FEED.md surface</span>
            </div>
          </div>
          <div class="proj-h-right">${updatedLine}</div>
        </div>
        ${f.purpose ? `<div class="proj-feed-purpose">${escHtml(f.purpose)}</div>` : ''}
        ${renderFeedPhaseStrip(f.phases)}
      </div>
      <div class="proj-grid">
        <div class="proj-main">
          ${nextStepHtml}
        </div>
        <div class="proj-side">
          <div class="proj-card proj-docs">
            <div class="proj-card-title">Source</div>
            <a class="proj-doc" href="${feedGhUrl}" target="_blank" rel="noopener">
              <span class="proj-doc-icon">📄</span>
              <span class="proj-doc-body">
                <div class="proj-doc-path">_FEED.md ↗</div>
                <div class="proj-doc-meta">github.com — opens in new tab</div>
              </span>
            </a>
          </div>
        </div>
      </div>
      <div class="proj-mvp-note">
        <span class="proj-mvp-tag">_FEED.md only</span>
        This project doesn't have a structured <code>state.md</code> surface yet (project-not-product or nontech-initiative class per GR9). To enable the full Layer B canvas with todo/sub-item writeback, bootstrap a <code>state.md</code> from the Vhalli template at <code>projects/vhalli/state.md</code>. Source: <a class="proj-link" href="${feedGhUrl}" target="_blank" rel="noopener">projects/${escHtml(id)}/_FEED.md</a>.
      </div>
    `;
  }

  // ── Public render ──────────────────────────────

  async function render(container, param) {
    state.projectId = param || null;
    if (!state.projectId) {
      container.innerHTML = renderEmpty();
      return;
    }

    container.innerHTML = renderSkeleton();
    try {
      state.owner = CONFIG.username;
      state.repo  = (typeof CONFIG.dashboardRepo === 'string' && CONFIG.dashboardRepo) ? CONFIG.dashboardRepo : 'V-Pro-Hub';
      state.statePath = `projects/${state.projectId}/state.md`;
      const feedPath  = `projects/${state.projectId}/_FEED.md`;

      // Try state.md first (full Layer B surface with writeback)
      const stateResult = (typeof Repos.getFileWithSha === 'function')
        ? await Repos.getFileWithSha(state.owner, state.repo, state.statePath).catch(() => null)
        : null;
      const stateMd = stateResult ? stateResult.content
        : await Repos.getFile(state.owner, state.repo, state.statePath).catch(() => null);

      if (stateMd) {
        state.stateRaw = stateMd;
        state.stateSha = stateResult ? stateResult.sha : null;
        state.project  = parseStateMd(stateMd);
        renderProject(container);
        return;
      }

      // Fallback: try _FEED.md (read-only minimal surface)
      const feedMd = await Repos.getFile(state.owner, state.repo, feedPath).catch(() => null);
      if (feedMd) {
        state.feedRaw = feedMd;
        state.feed    = parseFeed(feedMd);
        renderFeedSurface(container);
        return;
      }

      // Neither exists
      container.innerHTML = renderError({ message: `Neither state.md nor _FEED.md found for projects/${state.projectId}/` });

    } catch (e) {
      console.error('[ProjectView] render error', e);
      state.error = e;
      container.innerHTML = renderError(e);
    }
  }

  return { render };
})();
