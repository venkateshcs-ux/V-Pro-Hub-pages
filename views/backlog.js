// views/backlog.js — Portfolio Backlog View
// Single source: docs/BACKLOG.md in V-Pro-Hub repo.
// Items tagged by Product(s) — filter pills per product.

window.BacklogView = (() => {

  let _filter            = 'All';
  let _sessionTypeFilter = 'All';
  let _items             = [];
  let _products          = [];
  let _sessionTypes      = [];

  // ── Helpers ────────────────────────────────────

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function inline(text) {
    return escHtml(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');
  }

  // ── Parse BACKLOG.md ───────────────────────────
  // Finds the main ## Backlog table; reads Product(s), Name, Type, Phase, Priority, Status

  function parseBacklog(md) {
    const items = [];
    const lines = md.split('\n');
    let headers  = [];
    let inTable  = false;

    for (const line of lines) {
      if (!line.startsWith('|')) {
        // A heading "## Backlog" activates table capture mode
        if (/^## Backlog/.test(line)) { inTable = true; headers = []; }
        else if (/^## /.test(line) && inTable) { inTable = false; headers = []; }
        continue;
      }
      if (!inTable) continue;

      const cells = line.split('|').slice(1, -1).map(c => c.trim());

      // Separator row
      if (cells.every(c => /^[-: ]+$/.test(c))) continue;

      // Header row — must contain '#' as first cell
      if (cells[0] === '#') {
        headers = cells.map(c => c.toLowerCase().replace(/[()]/g, '').trim());
        continue;
      }

      // Data row — first cell is a number
      if (headers.length && /^\d+$/.test(cells[0])) {
        const item = { id: cells[0], products: [], name: '', type: '—', sessionType: '—', phase: '—', priority: '—', status: 'Open', aiTool: '—' };
        headers.forEach((h, idx) => {
          if (idx >= cells.length) return;
          const v = cells[idx];
          if (h === 'products')                        item.products     = v.split(',').map(p => p.trim()).filter(Boolean);
          else if (h === 'name')                       item.name         = v;
          else if (h === 'type')                       item.type         = v;
          else if (h === 'session type')               item.sessionType  = v || '—';
          else if (h === 'phase')                      item.phase        = v;
          else if (h === 'priority')                   item.priority     = v;
          else if (h === 'status' || h === 'closed')   item.status       = (v === '—' || v === '') ? 'Open' : v;
          else if (h === 'ai tool(s)')                 item.aiTool       = v || '—';
        });
        if (item.name) items.push(item);
      }
    }
    return items;
  }

  // ── Unique product list ────────────────────────

  function extractProducts(items) {
    const set = new Set();
    items.forEach(i => i.products.forEach(p => set.add(p)));
    return [...set].sort();
  }

  // ── Unique session types ───────────────────────

  function extractSessionTypes(items) {
    const order = ['Hygiene fix', 'Prod build', 'Infra build', 'Biz enablement'];
    const set = new Set();
    items.forEach(i => { if (i.sessionType && i.sessionType !== '—') set.add(i.sessionType); });
    // Return in canonical order, then any extras
    const found = order.filter(t => set.has(t));
    set.forEach(t => { if (!order.includes(t)) found.push(t); });
    return found;
  }

  // ── Filter items ───────────────────────────────

  function filteredItems() {
    return _items.filter(i => {
      const matchProduct = _filter === 'All' || i.products.includes(_filter);
      const matchSession = _sessionTypeFilter === 'All' || i.sessionType === _sessionTypeFilter;
      return matchProduct && matchSession;
    });
  }

  // ── Summary bar ────────────────────────────────

  function renderSummary(items) {
    const isDone = i => i.status.includes('Done') || i.status.includes('✓') || i.status.toLowerCase() === 'closed';
    const open   = items.filter(i => !isDone(i));
    const high   = open.filter(i => i.priority === 'HIGH');
    const medium = open.filter(i => i.priority === 'Medium');
    const low    = open.filter(i => i.priority === 'Low');
    const done   = items.filter(isDone);

    return `<div class="backlog-summary">
      <div class="summary-stat">
        <span class="summary-num">${open.length}</span>
        <span class="summary-label">Open</span>
      </div>
      <div class="summary-divider"></div>
      <div class="summary-stat">
        <span class="summary-num high">${high.length}</span>
        <span class="summary-label">HIGH</span>
      </div>
      <div class="summary-stat">
        <span class="summary-num medium">${medium.length}</span>
        <span class="summary-label">Medium</span>
      </div>
      <div class="summary-stat">
        <span class="summary-num low">${low.length}</span>
        <span class="summary-label">Low</span>
      </div>
      <div class="summary-divider"></div>
      <div class="summary-stat">
        <span class="summary-num done">${done.length}</span>
        <span class="summary-label">Done</span>
      </div>
    </div>`;
  }

  // ── Product filter pills ───────────────────────

  function renderPills(products) {
    const all = ['All', ...products];
    return `<div class="session-filters" id="backlog-pills">
      ${all.map(p => `
        <button class="filter-pill ${p === _filter ? 'active' : ''}" data-product="${p}">
          ${escHtml(p)}
        </button>`).join('')}
    </div>`;
  }

  // ── Session Type filter pills ──────────────────

  function renderSessionTypePills(types) {
    if (!types.length) return '';
    const all = ['All', ...types];
    return `<div class="session-filters stype-filters" id="stype-pills">
      <span class="filter-label">Session type</span>
      ${all.map(t => `
        <button class="filter-pill stype-pill ${sessionTypeClass(t)} ${t === _sessionTypeFilter ? 'active' : ''}" data-stype="${t}">
          ${escHtml(t)}
        </button>`).join('')}
    </div>`;
  }

  // ── Item row ───────────────────────────────────

  // Shorten "Claude Code / Sonnet 4.6" → "CC · Sonnet"
  function shortAiTool(t) {
    if (!t || t === '—') return '—';
    const tool  = t.includes('Claude Code') ? 'CC' : t.split('/')[0].trim().slice(0, 8);
    const model = t.includes('Opus')   ? 'Opus'
                : t.includes('Sonnet') ? 'Sonnet'
                : t.includes('Haiku')  ? 'Haiku'
                : '';
    return model ? `${tool} · ${model}` : tool;
  }

  function sessionTypeClass(t) {
    if (!t || t === '—') return '';
    const tl = t.toLowerCase();
    if (tl.includes('hygiene')) return 'stype-hygiene';
    if (tl.includes('prod'))    return 'stype-prod';
    if (tl.includes('infra'))   return 'stype-infra';
    if (tl.includes('biz'))     return 'stype-biz';
    return '';
  }

  function priorityClass(p) {
    if (p === 'HIGH')   return 'priority-high';
    if (p === 'Medium') return 'priority-medium';
    return 'priority-low';
  }

  function statusClass(s) {
    if (s.includes('Done') || s.includes('✓')) return 'status-done';
    if (s.includes('Progress') || s.includes('Pending') || s === 'In Progress') return 'status-pending';
    return 'status-open';
  }

  function renderProductTags(products) {
    return products.map(p =>
      `<span class="item-product-tag">${escHtml(p)}</span>`
    ).join('');
  }

  function renderItem(item) {
    const done = item.status.includes('Done') || item.status.includes('✓');
    return `
    <div class="backlog-item ${done ? 'item-done' : ''}">
      <div class="item-id">#${escHtml(item.id)}</div>
      <div class="item-body">
        <span class="item-name ${done ? 'item-name-done' : ''}">${inline(item.name)}</span>
        <div class="item-meta">
          ${renderProductTags(item.products)}
          <span class="item-type">${escHtml(item.type)}</span>
          ${item.sessionType && item.sessionType !== '—'
            ? `<span class="item-stype ${sessionTypeClass(item.sessionType)}">${escHtml(item.sessionType)}</span>`
            : ''}
          <span class="item-phase">Phase ${escHtml(item.phase)}</span>
        </div>
      </div>
      <span class="item-priority ${priorityClass(item.priority)}">${escHtml(item.priority)}</span>
      <span class="item-status ${statusClass(item.status)}">${escHtml(item.status)}</span>
      ${item.aiTool && item.aiTool !== '—'
        ? `<span class="item-ai-tool" title="Built with ${escHtml(item.aiTool)}">${escHtml(shortAiTool(item.aiTool))}</span>`
        : '<span class="item-ai-tool item-ai-tool-empty">—</span>'}
    </div>`;
  }

  // ── Render items section ───────────────────────

  function renderItemsSection(items) {
    const isDone = i => i.status.includes('Done') || i.status.includes('✓') || i.status.toLowerCase() === 'closed';
    const open   = items.filter(i => !isDone(i));
    const closed = items.filter(isDone);

    if (items.length === 0) return '<p class="muted" style="margin-top:16px;font-size:13px">No items match this filter.</p>';

    return `
      ${renderSummary(items)}

      ${open.length > 0 ? `
        <div class="backlog-section-label">Open</div>
        <div class="backlog-list">${open.map(renderItem).join('')}</div>
      ` : '<p class="muted" style="font-size:13px">No open items.</p>'}

      ${closed.length > 0 ? `
        <div class="backlog-section-label" style="margin-top:24px">Closed</div>
        <div class="backlog-list">${closed.map(renderItem).join('')}</div>
      ` : ''}`;
  }

  // ── Wire filter pills ──────────────────────────

  function wirePills(container) {
    // Product pills
    container.querySelectorAll('#backlog-pills .filter-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        _filter = btn.dataset.product;
        container.querySelectorAll('#backlog-pills .filter-pill').forEach(b =>
          b.classList.toggle('active', b.dataset.product === _filter)
        );
        container.querySelector('#backlog-items').innerHTML = renderItemsSection(filteredItems());
      });
    });
    // Session type pills
    container.querySelectorAll('#stype-pills .filter-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        _sessionTypeFilter = btn.dataset.stype;
        container.querySelectorAll('#stype-pills .filter-pill').forEach(b =>
          b.classList.toggle('active', b.dataset.stype === _sessionTypeFilter)
        );
        container.querySelector('#backlog-items').innerHTML = renderItemsSection(filteredItems());
      });
    });
  }

  // ── Skeleton ───────────────────────────────────

  function renderSkeleton() {
    return `
    <div class="backlog-header">
      <h1 class="backlog-title">Backlog</h1>
      <p class="muted" style="font-size:13px">Loading…</p>
    </div>
    <div class="session-filters">
      ${['All','…','…'].map(l => `<button class="filter-pill">${l}</button>`).join('')}
    </div>
    ${[1,2,3].map(() => `
      <div class="backlog-item">
        <div class="skel-line" style="width:36px;height:12px"></div>
        <div class="item-body">
          <div class="skel-line" style="width:55%;height:13px"></div>
          <div class="skel-line" style="width:30%;height:10px;margin-top:6px"></div>
        </div>
        <div class="skel-line" style="width:48px;height:20px;border-radius:10px"></div>
        <div class="skel-line" style="width:60px;height:20px;border-radius:10px"></div>
      </div>`).join('')}`;
  }

  // ── Main render ────────────────────────────────

  async function render(container) {
    container.innerHTML = renderSkeleton();

    try {
      // Always read from V-Pro-Hub — single source of truth
      const hubRepo = 'V-Pro-Hub';
      const content = await Repos.getFile(CONFIG.username, hubRepo, 'docs/BACKLOG.md');

      if (!content) {
        container.innerHTML = `<div class="view-placeholder">
          <div class="placeholder-inner">
            <span class="placeholder-icon">◐</span>
            <h2>No backlog found</h2>
            <p class="muted">Create <code>docs/BACKLOG.md</code> in the V-Pro-Hub repo.</p>
          </div>
        </div>`;
        return;
      }

      _items             = parseBacklog(content);
      _products          = extractProducts(_items);
      _sessionTypes      = extractSessionTypes(_items);
      _filter            = 'All';
      _sessionTypeFilter = 'All';

      container.innerHTML = `
        <div class="backlog-header">
          <h1 class="backlog-title">Backlog</h1>
          <p class="muted" style="font-size:13px;margin-top:2px">${_items.length} items across all products</p>
        </div>
        ${renderPills(_products)}
        ${renderSessionTypePills(_sessionTypes)}
        <div id="backlog-items">
          ${renderItemsSection(filteredItems())}
        </div>`;

      wirePills(container);

    } catch (err) {
      container.innerHTML = `<div class="view-placeholder">
        <div class="placeholder-inner">
          <span class="placeholder-icon" style="color:var(--danger)">✕</span>
          <h2>Failed to load backlog</h2>
          <p class="muted">${escHtml(err.message)}</p>
          <button class="btn-retry" onclick="BacklogView.render(document.getElementById('main-content'))">Retry</button>
        </div>
      </div>`;
    }
  }

  return { render };

})();
