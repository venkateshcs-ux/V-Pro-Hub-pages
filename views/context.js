// views/context.js — F4 Context Viewer
// Reads and displays docs/CONTEXT.md from any repo

window.ContextView = (() => {

  // ── Simple markdown → HTML renderer ───────────
  // Handles: headings, bold, code blocks, inline code, bullets, horizontal rules

  function renderMarkdown(md) {
    if (!md) return '<p class="muted">Empty file.</p>';

    let html = '';
    const lines = md.split('\n');
    let inCodeBlock = false;
    let codeBuffer  = [];
    let codeLang    = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Code block toggle
      if (line.startsWith('```')) {
        if (inCodeBlock) {
          html += `<pre class="md-code"><code class="lang-${codeLang}">${escHtml(codeBuffer.join('\n'))}</code></pre>`;
          codeBuffer  = [];
          codeLang    = '';
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
          codeLang    = line.slice(3).trim();
        }
        continue;
      }
      if (inCodeBlock) { codeBuffer.push(line); continue; }

      // Horizontal rule
      if (/^---+$/.test(line.trim())) { html += '<hr class="md-hr">'; continue; }

      // Headings
      const h3 = line.match(/^### (.+)/);
      const h2 = line.match(/^## (.+)/);
      const h1 = line.match(/^# (.+)/);
      if (h1)  { html += `<h1 class="md-h1">${inline(h1[1])}</h1>`; continue; }
      if (h2)  { html += `<h2 class="md-h2">${inline(h2[1])}</h2>`; continue; }
      if (h3)  { html += `<h3 class="md-h3">${inline(h3[1])}</h3>`; continue; }

      // Table row
      if (line.startsWith('|')) {
        // Simple table: collect consecutive | lines
        const tableLines = [];
        while (i < lines.length && lines[i].startsWith('|')) {
          tableLines.push(lines[i]);
          i++;
        }
        i--; // rewind one (outer loop will increment)
        html += renderTable(tableLines);
        continue;
      }

      // Bullet list
      const bullet = line.match(/^[-*] (.+)/);
      if (bullet) { html += `<li class="md-li">${inline(bullet[1])}</li>`; continue; }

      // Blank line
      if (line.trim() === '') { html += '<div class="md-spacer"></div>'; continue; }

      // Paragraph
      html += `<p class="md-p">${inline(line)}</p>`;
    }

    return html;
  }

  function renderTable(lines) {
    const rows = lines
      .filter(l => !l.match(/^\|[-| :]+\|$/)) // skip separator row
      .map(l => l.split('|').slice(1, -1).map(c => c.trim()));

    if (rows.length === 0) return '';
    const [head, ...body] = rows;

    const ths = head.map(c => `<th class="md-th">${inline(c)}</th>`).join('');
    const trs = body.map(row =>
      `<tr>${row.map(c => `<td class="md-td">${inline(c)}</td>`).join('')}</tr>`
    ).join('');

    return `<div class="md-table-wrap"><table class="md-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`;
  }

  function inline(text) {
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>')
      .replace(/←/g, '<span class="md-arrow">←</span>');
  }

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── Repo selector ──────────────────────────────

  function renderSelector(repos, activeRepo) {
    const opts = repos.map(r =>
      `<option value="${r}" ${r === activeRepo ? 'selected' : ''}>${r}</option>`
    ).join('');
    return `<div class="ctx-selector-row">
      <label class="ctx-label">Repo</label>
      <select class="ctx-select" id="ctx-repo-select">${opts}</select>
    </div>`;
  }

  // ── Skeleton ───────────────────────────────────

  function renderSkeleton() {
    return `
    <div class="ctx-header">
      <h1 class="ctx-title">Context Viewer</h1>
      <p class="ctx-sub muted">Reading CONTEXT.md…</p>
    </div>
    <div class="ctx-body">
      ${[80,95,60,100,70].map(w =>
        `<div class="skel-line" style="width:${w}%;height:13px;margin-bottom:10px"></div>`
      ).join('')}
    </div>`;
  }

  // ── Main render ────────────────────────────────

  async function render(container, param) {
    container.innerHTML = renderSkeleton();

    try {
      const repos = await Repos.listRepos();
      const repoNames = repos.map(r => r.name);
      const activeRepo = (param && repoNames.includes(param)) ? param : repoNames[0];

      await loadContext(container, repoNames, activeRepo);

    } catch (err) {
      container.innerHTML = `<div class="view-placeholder">
        <div class="placeholder-inner">
          <span class="placeholder-icon" style="color:var(--danger)">✕</span>
          <h2>Failed to load</h2>
          <p class="muted">${err.message}</p>
          <button class="btn-retry" onclick="ContextView.render(document.getElementById('main-content'))">Retry</button>
        </div>
      </div>`;
    }
  }

  async function loadContext(container, repos, activeRepo) {
    // Render shell with selector immediately
    container.innerHTML = `
    <div class="ctx-header">
      <h1 class="ctx-title">Context Viewer</h1>
      ${renderSelector(repos, activeRepo)}
    </div>
    <div class="ctx-body" id="ctx-body">
      ${[80,95,60].map(w =>
        `<div class="skel-line" style="width:${w}%;height:13px;margin-bottom:10px"></div>`
      ).join('')}
    </div>`;

    // Wire selector
    const sel = container.querySelector('#ctx-repo-select');
    sel.addEventListener('change', () => {
      window.location.hash = `#/context/${sel.value}`;
    });

    // Fetch CONTEXT.md
    const body = container.querySelector('#ctx-body');
    try {
      const content = await Repos.getFile(CONFIG.username, activeRepo, 'docs/CONTEXT.md');
      if (!content) {
        body.innerHTML = `<div class="ctx-missing">
          <span class="ctx-missing-icon">◌</span>
          <p>No <code>docs/CONTEXT.md</code> found in <strong>${activeRepo}</strong>.</p>
        </div>`;
        return;
      }

      // Extract last-updated from first lines
      const lastUpdated = (content.match(/Last updated[:\s]+(.+)/i) || [])[1]?.trim() || null;

      body.innerHTML = `
        ${lastUpdated ? `<div class="ctx-meta">Last updated: <span class="ctx-date">${lastUpdated}</span></div>` : ''}
        <div class="ctx-markdown">${renderMarkdown(content)}</div>`;

    } catch (err) {
      body.innerHTML = `<p class="muted">Error: ${err.message}</p>`;
    }
  }

  return { render };

})();
