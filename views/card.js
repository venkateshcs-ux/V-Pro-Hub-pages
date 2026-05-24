// views/card.js — Backlog card detail page (#136)
//
// Deep-linkable at #/card/<id>. Navigated to by clicking a kanban card.
// Fetches docs/backlog-detail/<id>.md from the active sprint branch,
// parses via BacklogView.parseFrontmatter(), renders using .proj-* CSS
// (layout parity with /#/project/vhalli), derives status via
// BacklogView.deriveCardStatus() (#130), surfaces sessions via
// BacklogView.sessionsFromCards() (#129). Per-todo checkbox writeback (#134 FR4).

window.CardView = (() => {

  // ── Module state ───────────────────────────────

  const state = {
    cardId:   null,
    fm:       null,    // parsed frontmatter
    raw:      null,    // raw markdown (truth for line-targeted writes)
    filePath: null,    // docs/backlog-detail/<id>.md
    branch:   null,    // active sprint branch
    owner:    null,
    repo:     null,
    sessions: [],
  };

  // ── Helpers ────────────────────────────────────

  function escHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function inline(text) {
    return escHtml(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');
  }

  function isReadOnly() {
    return document.body.getAttribute('data-mode') === 'readonly';
  }

  // ── Status ─────────────────────────────────────

  const STATUS_MAP = {
    'done':        { cls: 'cs-done',        icon: '✓', label: 'Done'        },
    'in-progress': { cls: 'cs-in-progress', icon: '▶', label: 'In Progress' },
    'candidate':   { cls: 'cs-candidate',   icon: '⏳', label: 'Candidate'   },
    'blocked':     { cls: 'cs-blocked',     icon: '⏸', label: 'Blocked'     },
  };

  function statusBadge(status) {
    const s = STATUS_MAP[status] || { cls: 'cs-candidate', icon: '?', label: escHtml(status || 'unknown') };
    return `<span class="cs-badge ${s.cls}" title="${s.label}">${s.icon} ${escHtml(s.label)}</span>`;
  }

  function getStatus(fm) {
    if (window.BacklogView && typeof window.BacklogView.deriveCardStatus === 'function') {
      return window.BacklogView.deriveCardStatus(fm) || fm.status || 'candidate';
    }
    // #131 tier-2 fallback — read dc.status directly when deriveCardStatus unavailable
    return fm.status || 'candidate';
  }

  // ── Section renderers ───────────────────────────

  function renderHeader(fm, status) {
    const priority    = fm.priority || '';
    const priorityCls = { HIGH: 'rail-high', 'SUPER HIGH': 'rail-high', Medium: 'rail-med', Low: 'rail-low' }[priority] || '';
    const carryTag    = fm.carry_forward_from
      ? `<span class="cs-carry-tag" title="Carried from ${escHtml(fm.carry_forward_from)}">↩ carry</span>` : '';
    const facts = [
      fm.sprint          && { label: 'Sprint',    value: fm.sprint },
      fm.layer != null   && { label: 'Layer',     value: String(fm.layer) },
      fm.sprint_priority && { label: 'Rank',      value: `#${fm.sprint_priority}` },
      fm.session_class   && { label: 'Class',     value: fm.session_class },
    ].filter(Boolean);

    return `<div class="proj-header">
      <div class="proj-h-row">
        <div>
          <span class="proj-card-id">#${escHtml(String(fm.id ?? ''))}</span>
          ${priority ? `<span class="cs-priority ${priorityCls}">${escHtml(priority)}</span>` : ''}
          ${statusBadge(status)}
          ${carryTag}
          <h1 class="proj-h-title" style="margin-top:8px">${escHtml(fm.title || fm.name || String(fm.id ?? ''))}</h1>
          ${fm.scope ? `<p class="proj-h-sub">${escHtml(fm.scope)}</p>` : ''}
        </div>
      </div>
      ${facts.length ? `<div class="proj-facts-strip">${facts.map(f =>
        `<div class="proj-fact"><div class="proj-fact-label">${escHtml(f.label)}</div><div class="proj-fact-value">${escHtml(f.value)}</div></div>`
      ).join('')}</div>` : ''}
    </div>`;
  }

  function renderTodos(todos, ro) {
    if (!todos || todos.length === 0) return '';
    const rows = todos.map(t => {
      const statusLo = String(t.status || '').toLowerCase();
      const done     = statusLo === 'done';
      const blocked  = statusLo === 'blocked';
      const iconCls  = done ? 'cs-todo-done' : blocked ? 'cs-todo-blocked' : '';
      const icon     = done ? '✓' : blocked ? '⏸' : '○';
      const label    = t.status || 'open';
      const cbAttr   = ro ? 'disabled aria-disabled="true"' : `data-todo-id="${escHtml(t.id)}"`;
      return `<div class="cs-todo-row${done ? ' cs-todo-row-done' : ''}">
        <button class="cs-todo-cb ${iconCls}" ${cbAttr} title="${escHtml(label)}" aria-label="${done ? 'Mark open' : 'Mark done'}: ${escHtml(t.text || '')}">${icon}</button>
        <span class="cs-todo-label">${inline(t.text || '')}</span>
        <span class="cs-todo-status-tag" aria-label="Status: ${escHtml(label)}">${escHtml(label)}</span>
      </div>`;
    }).join('');
    return `<div class="proj-card proj-todos">
      <div class="proj-card-title">Todos <span class="proj-card-count">${todos.length}</span></div>
      <div class="cs-todo-list">${rows}</div>
    </div>`;
  }

  function renderDoneCriteria(dcs) {
    if (!dcs || dcs.length === 0) return '';
    const rows = dcs.map(dc => {
      const met = String(dc.status || '').toLowerCase() === 'met';
      return `<div class="cs-dc-row${met ? ' cs-dc-met' : ''}">
        <span class="cs-dc-icon" aria-hidden="true">${met ? '✓' : '○'}</span>
        <span class="cs-dc-text">${inline(dc.text || '')}</span>
        <span class="cs-dc-tag ${met ? 'cs-tag-met' : 'cs-tag-open'}" aria-label="${met ? 'met' : 'open'}">${met ? 'met' : 'open'}</span>
      </div>`;
    }).join('');
    return `<div class="proj-card">
      <div class="proj-card-title">Done Criteria <span class="proj-card-count">${dcs.length}</span></div>
      <div class="cs-dc-list">${rows}</div>
    </div>`;
  }

  function renderFeatureRequirements(frs) {
    if (!frs || frs.length === 0) return '';
    const rows = frs.map(fr => {
      const priCls = (fr.priority || '').toLowerCase().replace(/\s+/g, '-');
      return `<div class="cs-fr-row">
        <span class="cs-fr-id">${escHtml(fr.id || '')}</span>
        <span class="cs-fr-pri ${priCls}">${escHtml(fr.priority || '')}</span>
        <span class="cs-fr-text">${inline(fr.text || '')}</span>
      </div>`;
    }).join('');
    return `<div class="proj-card">
      <div class="proj-card-title">Feature Requirements</div>
      <div class="cs-fr-list">${rows}</div>
    </div>`;
  }

  function renderProcessSteps(steps) {
    if (!steps || steps.length === 0) return '';
    const items = steps.map((s, i) =>
      `<span class="cs-step">${escHtml(s)}</span>${i < steps.length - 1 ? '<span class="cs-step-sep" aria-hidden="true">→</span>' : ''}`
    ).join('');
    return `<div class="proj-card">
      <div class="proj-card-title">Process</div>
      <div class="cs-steps" role="list">${items}</div>
    </div>`;
  }

  function renderReadyReckoner(fm, status) {
    const rows = [
      { label: 'ID',       value: `#${fm.id ?? ''}` },
      { label: 'Status',   value: status },
      { label: 'Priority', value: fm.priority || '—' },
      { label: 'Layer',    value: String(fm.layer ?? '—') },
      { label: 'Sprint',   value: fm.sprint || '—' },
    ].map(f => `<div class="proj-rr-row">
      <span class="proj-rr-label">${escHtml(f.label)}</span>
      <span class="proj-rr-value">${escHtml(f.value)}</span>
    </div>`).join('');
    return `<div class="proj-card proj-rr">
      <div class="proj-card-title">Card Info</div>
      <div class="proj-rr-list">${rows}</div>
    </div>`;
  }

  function renderNfr(nfr) {
    if (!nfr || nfr.length === 0) return '';
    const rows = nfr.map(n => `<div class="cs-nfr-row">
      <span class="cs-nfr-dim" aria-label="Dimension: ${escHtml(n.dimension || '')}">${escHtml(n.dimension || '')}</span>
      <span class="cs-nfr-req">${inline(n.requirement || '')}</span>
    </div>`).join('');
    return `<div class="proj-card">
      <div class="proj-card-title">Non-Functional Requirements</div>
      <div class="cs-nfr-list">${rows}</div>
    </div>`;
  }

  function renderDependencies(deps) {
    if (!deps || deps.length === 0) return '';
    const items = deps.map(d =>
      `<a class="cs-dep-link" href="#/card/${escHtml(String(d))}" data-dep="${escHtml(String(d))}">#${escHtml(String(d))}</a>`
    ).join('');
    return `<div class="proj-card">
      <div class="proj-card-title">Dependencies</div>
      <div class="cs-deps">${items}</div>
    </div>`;
  }

  function renderTeam(team) {
    if (!team || team.length === 0) return '';
    const rows = team.map(t => {
      const instances = Array.isArray(t.instances)
        ? t.instances.map(escHtml).join(', ')
        : escHtml(String(t.instances || ''));
      return `<div class="proj-team-row">
        <div class="proj-team-role">${escHtml(t.role || '')}</div>
        <div class="proj-team-handle">${instances}</div>
        <div class="proj-team-gates"><span class="cs-auth-badge">${escHtml(t.authority || '')}</span></div>
      </div>`;
    }).join('');
    return `<div class="proj-card proj-team">
      <div class="proj-card-title">Team</div>
      ${rows}
    </div>`;
  }

  function renderSessionsBody(sessions) {
    if (!sessions || sessions.length === 0) {
      return '<div class="cs-no-sessions">No sessions recorded</div>';
    }
    return sessions.map(s => `<div class="cs-session-row">
      <span class="cs-session-id">${escHtml(s.id || '')}</span>
      ${s.date ? `<span class="cs-session-meta">${escHtml(s.date)}</span>` : ''}
      <span class="cs-session-title">${escHtml(s.focus || s.id || '')}</span>
    </div>`).join('');
  }

  // ── Full page render ────────────────────────────

  function renderFull(container) {
    const fm     = state.fm;
    const status = getStatus(fm);
    const ro     = isReadOnly();
    container.innerHTML = `
      ${renderHeader(fm, status)}
      <div class="proj-grid">
        <div class="proj-main">
          ${renderTodos(fm.todos, ro)}
          ${renderDoneCriteria(fm.done_criteria)}
          ${renderFeatureRequirements(fm.feature_requirements)}
          ${renderProcessSteps(fm.process_steps)}
        </div>
        <div class="proj-side">
          ${renderReadyReckoner(fm, status)}
          <div class="proj-card">
            <div class="proj-card-title">Sessions</div>
            <div class="card-sessions-body">${renderSessionsBody(state.sessions)}</div>
          </div>
          ${renderNfr(fm.nfr)}
          ${renderDependencies(fm.dependencies)}
          ${renderTeam(fm.team)}
        </div>
      </div>`;
    wireEvents(container);
  }

  // ── Per-todo checkbox writeback (FR4) ───────────

  function flipTodoStatusInMd(raw, todoId, newStatus) {
    const lines = raw.split('\n');
    let inTodo  = false;
    for (let i = 0; i < lines.length; i++) {
      // Detect start of a todo bullet: `  - id: <todoId>`
      const m = lines[i].match(/^\s{2}-\s+id:\s*["']?(.+?)["']?\s*$/);
      if (m && m[1].trim() === String(todoId).trim()) { inTodo = true; continue; }
      if (inTodo) {
        if (/^\S/.test(lines[i]) || /^\s{2}-\s+id:/.test(lines[i])) { inTodo = false; continue; }
        const sm = lines[i].match(/^(\s+status:\s*)(.*)$/);
        if (sm) { lines[i] = sm[1] + newStatus; inTodo = false; }
      }
    }
    return lines.join('\n');
  }

  async function flipTodo(container, todoId) {
    const fm = state.fm;
    if (!fm || !fm.todos) return;
    const todo = fm.todos.find(t => t.id === todoId);
    if (!todo) return;

    const wasDone  = String(todo.status || '').toLowerCase() === 'done';
    const newStatus = wasDone ? 'candidate' : 'done';

    // Optimistic UI update
    todo.status = newStatus;
    const btn = container.querySelector(`[data-todo-id="${CSS.escape(todoId)}"]`);
    if (btn) {
      btn.textContent = newStatus === 'done' ? '✓' : '○';
      btn.className   = `cs-todo-cb${newStatus === 'done' ? ' cs-todo-done' : ''}`;
      const row = btn.closest('.cs-todo-row');
      if (row) row.classList.toggle('cs-todo-row-done', newStatus === 'done');
      const tag = row && row.querySelector('.cs-todo-status-tag');
      if (tag) tag.textContent = newStatus;
    }

    try {
      // Fresh SHA-guarded fetch from sprint branch before write
      const fresh = await Repos.getFileWithSha(state.owner, state.repo, state.filePath, state.branch);
      if (!fresh) throw new Error('Could not fetch current file for writeback');
      const newRaw = flipTodoStatusInMd(fresh.content, todoId, newStatus);
      await Repos.putFile(
        state.owner, state.repo, state.filePath,
        newRaw, fresh.sha,
        `data(#136): flip todo ${todoId} → ${newStatus} on card #${state.cardId}`,
        state.branch
      );
      state.raw = newRaw;
    } catch (err) {
      // Revert optimistic on failure
      todo.status = wasDone ? 'done' : 'candidate';
      renderFull(container);
      console.error('[CardView] todo writeback failed:', err.message);
    }
  }

  // ── Event wiring ────────────────────────────────

  function wireEvents(container) {
    container.querySelectorAll('[data-todo-id]').forEach(btn => {
      btn.addEventListener('click', () => flipTodo(container, btn.dataset.todoId));
    });
    container.querySelectorAll('[data-dep]').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        navigate('card', a.dataset.dep);
      });
    });
  }

  // ── Public render ───────────────────────────────

  async function render(container, param) {
    const cardId = String(param || '').trim();
    if (!cardId) {
      container.innerHTML = `<div class="proj-empty">
        <div class="proj-empty-glyph">◎</div>
        <div class="proj-empty-msg">No card selected</div>
        <div class="proj-empty-detail">Click a card on the Sprint Board to view its detail page.</div>
      </div>`;
      return;
    }

    container.innerHTML = `<div class="view-loading">Loading card #${escHtml(cardId)}…</div>`;
    state.sessions = [];

    try {
      const owner = CONFIG.username;
      const repo  = 'V-Pro-Hub';

      // Resolve active sprint branch via ActiveSprint (#119)
      let branch = null;
      if (window.ActiveSprint && typeof window.ActiveSprint.getActiveSprintBranch === 'function') {
        const discovered = await window.ActiveSprint.getActiveSprintBranch(owner, repo).catch(() => null);
        branch = (discovered && discovered.branch) || null;
      }

      const filePath = `docs/backlog-detail/${cardId}.md`;
      const raw = await Repos.getFile(owner, repo, filePath, branch || undefined);
      if (!raw) throw new Error(`Card file not found: ${filePath}`);

      if (!window.BacklogView || typeof window.BacklogView.parseFrontmatter !== 'function') {
        throw new Error('BacklogView.parseFrontmatter not available — ensure backlog.js loaded');
      }
      const fm = window.BacklogView.parseFrontmatter(raw);

      state.cardId   = cardId;
      state.fm       = fm;
      state.raw      = raw;
      state.filePath = filePath;
      state.branch   = branch;
      state.owner    = owner;
      state.repo     = repo;

      renderFull(container);

      // Sessions async fill-in after initial render (#129)
      if (fm.sessions && fm.sessions.length && typeof window.BacklogView.sessionsFromCards === 'function') {
        window.BacklogView.sessionsFromCards(fm.sessions, branch).then(sessions => {
          state.sessions = sessions || [];
          const sesEl = container.querySelector('.card-sessions-body');
          if (sesEl) sesEl.innerHTML = renderSessionsBody(state.sessions);
        }).catch(() => {});
      }

    } catch (err) {
      container.innerHTML = `<div class="proj-error">
        <strong>Error loading card #${escHtml(cardId)}</strong><br>
        ${escHtml(err.message)}
        <br><br>
        <button onclick="CardView.render(document.getElementById('main-content'), '${escHtml(cardId)}')" style="margin-top:8px;padding:6px 14px;cursor:pointer">Retry</button>
        &nbsp;
        <button onclick="navigate('backlog')" style="margin-top:8px;padding:6px 14px;cursor:pointer">← Back to Backlog</button>
      </div>`;
    }
  }

  return { render };

})();
