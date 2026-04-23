// views/backlog.js — Portfolio Backlog View
// Single source: docs/BACKLOG.md in V-Pro-Hub repo.
// Items tagged by Product(s) — filter pills per product.

window.BacklogView = (() => {

  let _filter            = 'All';
  let _sessionTypeFilter = 'All';
  let _searchQuery       = '';
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
    const q = _searchQuery.trim().toLowerCase();
    return _items.filter(i => {
      const matchProduct = _filter === 'All' || i.products.includes(_filter);
      const matchSession = _sessionTypeFilter === 'All' || i.sessionType === _sessionTypeFilter;
      if (!q) return matchProduct && matchSession;
      // Strip a leading '#' so queries like "#62" work
      const qClean = q.replace(/^#/, '');
      const hay = [
        '#' + i.id,
        i.id,
        i.name,
        i.products.join(' '),
        i.type,
        i.sessionType,
        i.status
      ].join(' ').toLowerCase();
      return matchProduct && matchSession && hay.includes(qClean);
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

    return `<div class="bl-sb">
      <div class="bl-sb-tile lead">
        <div class="bl-sb-num">${open.length}<span class="bl-sb-unit">items</span></div>
        <div class="bl-sb-lbl">Open</div>
      </div>
      <div class="bl-sb-tile lead danger">
        <div class="bl-sb-num">${high.length}<span class="bl-sb-unit">items</span></div>
        <div class="bl-sb-lbl">High priority</div>
      </div>
      <div class="bl-sb-divider"></div>
      <div class="bl-sb-tile ctx">
        <div class="bl-sb-ctx-wrap">
          <div class="bl-sb-num">${medium.length}<span class="bl-sb-unit">med</span></div>
          <div class="bl-sb-sub">${low.length} low</div>
        </div>
      </div>
      <div class="bl-sb-tile ctx">
        <div class="bl-sb-ctx-wrap">
          <div class="bl-sb-num">${done.length}<span class="bl-sb-unit">done</span></div>
          <div class="bl-sb-sub">this cycle</div>
        </div>
      </div>
    </div>`;
  }

  // ── Search input ───────────────────────────────

  function renderSearch() {
    const val = escHtml(_searchQuery);
    return `<div class="backlog-search">
      <input
        type="search"
        id="backlog-search-input"
        class="backlog-search-input"
        placeholder="Search backlog — name, #id, product, status…"
        value="${val}"
        autocomplete="off"
        spellcheck="false" />
      ${_searchQuery ? `<button type="button" class="backlog-search-clear" id="backlog-search-clear" title="Clear search">✕</button>` : ''}
    </div>`;
  }

  // ── Filter area — two visually distinct axes ───

  function renderFilterArea(products, types) {
    const allProducts = ['All', ...products];
    const tabs = allProducts.map(p => {
      const count = p === 'All' ? _items.length : _items.filter(i => i.products.includes(p)).length;
      return `<button class="bl-fa-tab${p === _filter ? ' active' : ''}" data-product="${escHtml(p)}">${escHtml(p)}<span class="bl-fa-count">${count}</span></button>`;
    }).join('');

    let sessionRow = '';
    if (types.length) {
      const allTypes = ['All', ...types];
      const chips = allTypes.map(t =>
        `<button class="bl-fa-chip${t === _sessionTypeFilter ? ' active' : ''}" data-stype="${escHtml(t)}"><span class="bl-fa-dot"></span>${escHtml(t)}</button>`
      ).join('');
      sessionRow = `<div class="bl-fa-axis">
        <div class="bl-fa-axis-label">Session</div>
        <div class="bl-fa-chips" id="bl-stype-chips">${chips}</div>
      </div>`;
    }

    return `<div class="bl-fa" id="bl-filter-area">
      <div class="bl-fa-axis">
        <div class="bl-fa-axis-label">Product</div>
        <div class="bl-fa-tabs" id="backlog-pills">${tabs}</div>
      </div>
      ${sessionRow}
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
    const prioClass = { HIGH: 'prio-high', Medium: 'prio-med', Low: 'prio-low' }[item.priority] || 'prio-low';
    const railClass = { HIGH: 'rail-high', Medium: 'rail-med', Low: 'rail-low' }[item.priority] || '';
    const sClass = done ? 'status-done'
      : item.status.includes('Progress') ? 'status-progress'
      : item.status.includes('Blocked')  ? 'status-block'
      : 'status-open';
    const statusText = done ? 'Done ✓' : item.status.replace(' ▶', '').replace(' ⏸', '');
    const tags = item.products.map(p => `<span class="bl-ic-tag">${escHtml(p)}</span>`).join('');
    const infoBtn = (item.aiTool && item.aiTool !== '—')
      ? `<span class="bl-ic-info" title="${escHtml(item.aiTool)}">i</span>`
      : '';
    return `<div class="bl-ic ${railClass}${done ? ' item-done' : ''}">
      <div class="bl-ic-head">
        <div class="bl-ic-name">${inline(item.name)}</div>
        <div class="bl-ic-meta">
          <span class="bl-ic-id">#${escHtml(item.id)}</span>
          <span class="bl-ic-sep">·</span>
          ${tags}
          ${infoBtn}
        </div>
      </div>
      <div class="bl-ic-glance">
        <span class="bl-chip ${prioClass}"><span class="bl-chip-dot"></span>${escHtml(item.priority === 'HIGH' ? 'High' : item.priority)}</span>
        <span class="bl-chip ${sClass}"><span class="bl-chip-dot"></span>${escHtml(statusText)}</span>
      </div>
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

  // ── Wire search input ──────────────────────────

  function wireSearch(container) {
    const input = container.querySelector('#backlog-search-input');
    if (!input) return;

    const applyFilter = () => {
      _searchQuery = input.value || '';
      // Toggle the clear button without re-rendering the input (preserves focus + caret)
      let clearBtn = container.querySelector('#backlog-search-clear');
      if (_searchQuery && !clearBtn) {
        clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'backlog-search-clear';
        clearBtn.id = 'backlog-search-clear';
        clearBtn.title = 'Clear search';
        clearBtn.textContent = '✕';
        clearBtn.addEventListener('click', () => {
          input.value = '';
          _searchQuery = '';
          clearBtn.remove();
          container.querySelector('#backlog-items').innerHTML = renderItemsSection(filteredItems());
          input.focus();
        });
        input.parentNode.appendChild(clearBtn);
      } else if (!_searchQuery && clearBtn) {
        clearBtn.remove();
      }
      container.querySelector('#backlog-items').innerHTML = renderItemsSection(filteredItems());
    };

    input.addEventListener('input', applyFilter);
    // Esc clears
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && input.value) {
        e.preventDefault();
        input.value = '';
        applyFilter();
      }
    });

    // Wire the initial clear button if it was rendered server-side
    const initialClear = container.querySelector('#backlog-search-clear');
    if (initialClear) {
      initialClear.addEventListener('click', () => {
        input.value = '';
        applyFilter();
        input.focus();
      });
    }
  }

  // ── Wire filter pills ──────────────────────────

  function wirePills(container) {
    container.querySelectorAll('#backlog-pills .bl-fa-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        _filter = btn.dataset.product;
        container.querySelectorAll('#backlog-pills .bl-fa-tab').forEach(b =>
          b.classList.toggle('active', b.dataset.product === _filter)
        );
        container.querySelector('#backlog-items').innerHTML = renderItemsSection(filteredItems());
      });
    });
    container.querySelectorAll('#bl-stype-chips .bl-fa-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        _sessionTypeFilter = btn.dataset.stype;
        container.querySelectorAll('#bl-stype-chips .bl-fa-chip').forEach(b =>
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
    <div class="bl-fa">
      <div class="bl-fa-axis">
        <div class="bl-fa-axis-label">Product</div>
        <div class="bl-fa-tabs">
          ${['All','…','…'].map(l => `<button class="bl-fa-tab">${l}</button>`).join('')}
        </div>
      </div>
    </div>
    <div class="backlog-list">
      ${[1,2,3].map(() => `
        <div class="bl-ic">
          <div class="bl-ic-head">
            <div class="skel-line" style="width:55%;height:13px"></div>
            <div class="skel-line" style="width:30%;height:10px;margin-top:6px"></div>
          </div>
          <div class="bl-ic-glance">
            <div class="skel-line" style="width:48px;height:20px;border-radius:10px"></div>
            <div class="skel-line" style="width:60px;height:20px;border-radius:10px"></div>
          </div>
        </div>`).join('')}
    </div>`;
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
      _searchQuery       = '';

      container.innerHTML = `
        <div class="backlog-header">
          <h1 class="backlog-title">Backlog</h1>
          <p class="muted" style="font-size:13px;margin-top:2px">${_items.length} items across all products</p>
        </div>
        ${renderSearch()}
        ${renderFilterArea(_products, _sessionTypes)}
        <div id="backlog-items">
          ${renderItemsSection(filteredItems())}
        </div>`;

      wireSearch(container);
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
