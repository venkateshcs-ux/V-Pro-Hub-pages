// views/ai-collab-guide.js — #105 AI Collaboration Guide
// Renders docs/education/ai-collab-guide.md as a first-class menu item.
// Source-of-truth: V-Pro-Hub repo, docs/education/ai-collab-guide.md
// Sibling docs: ai-collab-toc.md (ToC + status mirror), ai-collab-decisions.md (ledger)

window.AiGuideView = (() => {

  const REPO = 'V-Pro-Hub';
  const GUIDE_PATH = 'docs/education/ai-collab-guide.md';
  const TOC_PATH   = 'docs/education/ai-collab-toc.md';
  const DECISIONS_PATH = 'docs/education/ai-collab-decisions.md';

  // ── Markdown renderer (cloned from views/context.js with anchor-id support) ────

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
          const langClass = codeLang ? ` lang-${escHtml(codeLang)}` : '';
          html += `<pre class="md-code"><code class="${langClass}">${escHtml(codeBuffer.join('\n'))}</code></pre>`;
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

      // Headings (with anchor ids)
      const h4 = line.match(/^#### (.+)/);
      const h3 = line.match(/^### (.+)/);
      const h2 = line.match(/^## (.+)/);
      const h1 = line.match(/^# (.+)/);
      if (h1) { const t = h1[1]; html += `<h1 class="md-h1" id="${slugify(t)}">${inline(t)}</h1>`; continue; }
      if (h2) { const t = h2[1]; html += `<h2 class="md-h2" id="${slugify(t)}">${inline(t)}</h2>`; continue; }
      if (h3) { const t = h3[1]; html += `<h3 class="md-h3" id="${slugify(t)}">${inline(t)}</h3>`; continue; }
      if (h4) { const t = h4[1]; html += `<h4 class="md-h4" id="${slugify(t)}">${inline(t)}</h4>`; continue; }

      // Blockquote
      const bq = line.match(/^>\s?(.*)/);
      if (bq) { html += `<blockquote class="md-bq">${inline(bq[1])}</blockquote>`; continue; }

      // Table row
      if (line.startsWith('|')) {
        const tableLines = [];
        while (i < lines.length && lines[i].startsWith('|')) {
          tableLines.push(lines[i]);
          i++;
        }
        i--;
        html += renderTable(tableLines);
        continue;
      }

      // Bullet list
      const bullet = line.match(/^[-*] (.+)/);
      if (bullet) { html += `<li class="md-li">${inline(bullet[1])}</li>`; continue; }

      // Numbered list
      const num = line.match(/^\d+\. (.+)/);
      if (num) { html += `<li class="md-li md-li-num">${inline(num[1])}</li>`; continue; }

      // Blank line
      if (line.trim() === '') { html += '<div class="md-spacer"></div>'; continue; }

      // Paragraph
      html += `<p class="md-p">${inline(line)}</p>`;
    }

    return html;
  }

  function renderTable(lines) {
    const rows = lines
      .filter(l => !l.match(/^\|[-| :]+\|$/))
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
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="md-link" href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/←/g, '<span class="md-arrow">←</span>')
      .replace(/→/g, '<span class="md-arrow">→</span>')
      .replace(/×/g, '<span class="md-arrow">×</span>');
  }

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function slugify(text) {
    return String(text)
      .toLowerCase()
      .replace(/&[a-z]+;/g, '')
      .replace(/[^a-z0-9\s.-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }

  // ── ToC parsing ──

  // Parse ai-collab-toc.md into a structured tree:
  // [ { partTitle, sections: [ { num, topic, status } ] } ]
  function parseToc(md) {
    if (!md) return [];
    const blocks = [];
    const lines  = md.split('\n');
    let cur = null;
    let inTable = false;
    let headerSkipped = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const h3 = line.match(/^### (.+)/);
      if (h3) {
        cur = { partTitle: h3[1].trim(), sections: [] };
        blocks.push(cur);
        inTable = false;
        headerSkipped = false;
        continue;
      }
      // h2 like "## Frame B — V-Pro-Hub-specific..." may directly carry a single table without a sub-h3
      const h2 = line.match(/^## (.+)/);
      if (h2 && /Frame /i.test(h2[1]) && !cur) {
        cur = { partTitle: h2[1].trim(), sections: [] };
        blocks.push(cur);
        continue;
      }

      if (cur && line.startsWith('|')) {
        // Skip header row + separator
        if (!headerSkipped) {
          if (line.match(/^\|[-| :]+\|$/) || /\bTopic\b/i.test(line)) {
            headerSkipped = true;
            continue;
          }
        }
        const parts = line.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
        if (parts.length >= 3) {
          const num = parts[0];
          const topic = parts[1];
          const status = parts[2].toLowerCase();
          if (num && !/^[-: ]+$/.test(num)) {
            cur.sections.push({ num, topic, status });
          }
        }
        inTable = true;
      } else if (inTable && !line.startsWith('|')) {
        inTable = false;
      }
    }
    return blocks;
  }

  function statusBadge(status) {
    const map = {
      'pending':     { cls: 'pending',    label: 'pending'     },
      'in_progress': { cls: 'inprogress', label: 'in progress' },
      'covered':     { cls: 'covered',    label: 'covered'     },
      'ratified':    { cls: 'ratified',   label: 'ratified'    },
      'deferred':    { cls: 'deferred',   label: 'deferred'    }
    };
    const m = map[status] || { cls: 'pending', label: status || 'pending' };
    return `<span class="ag-badge ag-badge-${m.cls}">${m.label}</span>`;
  }

  function tocSidebar(blocks) {
    if (!blocks.length) return '<div class="ag-toc-empty muted">ToC not loaded.</div>';
    const html = blocks.map(b => {
      const items = b.sections.map(s => {
        // Anchor: section heading in guide is `Part 1 — ...` or `### B.1 ...` etc.
        // We match by producing a slug compatible with the guide's headings.
        const anchorTarget = guessGuideAnchor(b.partTitle, s.num, s.topic);
        return `<li class="ag-toc-item" data-anchor="${anchorTarget}">
          <a href="#/aiGuide/${encodeURIComponent(s.num)}" class="ag-toc-link" data-anchor="${anchorTarget}">
            <span class="ag-toc-num">${escHtml(s.num)}</span>
            <span class="ag-toc-topic">${inline(s.topic)}</span>
          </a>
          ${statusBadge(s.status)}
        </li>`;
      }).join('');
      return `<div class="ag-toc-block">
        <div class="ag-toc-block-title">${escHtml(b.partTitle)}</div>
        <ul class="ag-toc-list">${items}</ul>
      </div>`;
    }).join('');
    return html;
  }

  // The guide stub headings look like:
  //   #### 1.1 What "context window" means + Opus 4.7 size
  //   ### B.1 CLAUDE.md shim + AI_CONTEXT.md as SoT
  // ToC rows give us num + topic. Slug of `${num} ${topic}` matches.
  function guessGuideAnchor(partTitle, num, topic) {
    return slugify(`${num} ${topic}`);
  }

  // ── Coverage widget ──

  function coverageWidget(blocks) {
    let total = 0, ratified = 0, inprog = 0, deferred = 0, pending = 0;
    blocks.forEach(b => b.sections.forEach(s => {
      total++;
      if (s.status === 'ratified') ratified++;
      else if (s.status === 'in_progress') inprog++;
      else if (s.status === 'deferred') deferred++;
      else pending++;
    }));
    const pct = total ? Math.round((ratified / total) * 100) : 0;
    return `<div class="ag-coverage">
      <div class="ag-coverage-row">
        <div class="ag-coverage-pill ag-coverage-pill-ratified">
          <span class="ag-coverage-num">${ratified}</span>
          <span class="ag-coverage-lbl">ratified</span>
        </div>
        <div class="ag-coverage-pill ag-coverage-pill-inprog">
          <span class="ag-coverage-num">${inprog}</span>
          <span class="ag-coverage-lbl">in progress</span>
        </div>
        <div class="ag-coverage-pill ag-coverage-pill-pending">
          <span class="ag-coverage-num">${pending}</span>
          <span class="ag-coverage-lbl">pending</span>
        </div>
        <div class="ag-coverage-pill ag-coverage-pill-deferred">
          <span class="ag-coverage-num">${deferred}</span>
          <span class="ag-coverage-lbl">deferred</span>
        </div>
        <div class="ag-coverage-total">${ratified} of ${total} sections ratified · ${pct}%</div>
      </div>
      <div class="ag-coverage-bar"><div class="ag-coverage-bar-fill" style="width:${pct}%"></div></div>
    </div>`;
  }

  // ── Skeleton ──

  function renderSkeleton() {
    return `
    <div class="ag-shell">
      <aside class="ag-sidebar">
        <div class="ag-sidebar-header">Loading ToC…</div>
        ${[80, 70, 90, 60, 75].map(w =>
          `<div class="skel-line" style="width:${w}%;height:10px;margin-bottom:8px"></div>`
        ).join('')}
      </aside>
      <main class="ag-main">
        <div class="ag-header">
          <h1 class="ag-title">Working with AI: predictive × deterministic</h1>
          <p class="ag-sub muted">Loading guide content…</p>
        </div>
        <div class="ag-body">
          ${[80, 95, 60, 100, 70, 85, 95].map(w =>
            `<div class="skel-line" style="width:${w}%;height:13px;margin-bottom:10px"></div>`
          ).join('')}
        </div>
      </main>
    </div>`;
  }

  // ── Inject one-shot CSS ──

  function injectStyles() {
    if (document.getElementById('ag-styles')) return;
    const style = document.createElement('style');
    style.id = 'ag-styles';
    style.textContent = `
      .ag-shell { display: grid; grid-template-columns: 280px 1fr; gap: 24px; align-items: start; max-width: 1400px; }
      .ag-sidebar { position: sticky; top: 16px; max-height: calc(100vh - 32px); overflow-y: auto; padding: 16px; background: var(--surface, #1a1f2c); border: 1px solid var(--border, #2a3142); border-radius: 8px; font-size: 13px; }
      .ag-sidebar-header { font-weight: 600; font-size: 11px; letter-spacing: 0.5px; text-transform: uppercase; color: var(--muted, #8a93a6); margin-bottom: 12px; }
      .ag-toc-block { margin-bottom: 18px; }
      .ag-toc-block-title { font-weight: 600; font-size: 12px; color: var(--accent, #7ab8ff); margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid var(--border, #2a3142); }
      .ag-toc-list { list-style: none; padding: 0; margin: 0; }
      .ag-toc-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 0; }
      .ag-toc-link { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; text-decoration: none; color: var(--fg, #cfd6e4); transition: color 120ms; }
      .ag-toc-link:hover { color: var(--accent, #7ab8ff); }
      .ag-toc-num { font-weight: 600; color: var(--muted, #8a93a6); flex-shrink: 0; min-width: 28px; }
      .ag-toc-topic { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ag-toc-empty { padding: 16px; text-align: center; }
      .ag-badge { font-size: 9px; font-weight: 600; padding: 2px 6px; border-radius: 10px; text-transform: uppercase; letter-spacing: 0.4px; flex-shrink: 0; }
      .ag-badge-pending     { background: rgba(138, 147, 166, 0.15); color: #8a93a6; }
      .ag-badge-inprogress  { background: rgba(255, 184, 0, 0.18);   color: #ffb800; }
      .ag-badge-covered     { background: rgba(122, 184, 255, 0.18); color: #7ab8ff; }
      .ag-badge-ratified    { background: rgba(70, 200, 120, 0.18);  color: #46c878; }
      .ag-badge-deferred    { background: rgba(255, 100, 100, 0.15); color: #ff8080; }
      .ag-main { min-width: 0; padding: 8px 8px 80px 8px; }
      .ag-header { margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--border, #2a3142); }
      .ag-title { margin: 0 0 6px 0; font-size: 28px; font-weight: 700; }
      .ag-sub { margin: 0; font-size: 14px; }
      .ag-meta { font-size: 12px; color: var(--muted, #8a93a6); margin-top: 6px; }
      .ag-coverage { margin: 16px 0 24px 0; padding: 14px; background: var(--surface, #1a1f2c); border: 1px solid var(--border, #2a3142); border-radius: 8px; }
      .ag-coverage-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
      .ag-coverage-pill { display: inline-flex; align-items: baseline; gap: 6px; padding: 4px 10px; border-radius: 14px; font-size: 12px; }
      .ag-coverage-pill-ratified { background: rgba(70, 200, 120, 0.18);  color: #46c878; }
      .ag-coverage-pill-inprog   { background: rgba(255, 184, 0, 0.18);   color: #ffb800; }
      .ag-coverage-pill-pending  { background: rgba(138, 147, 166, 0.15); color: #8a93a6; }
      .ag-coverage-pill-deferred { background: rgba(255, 100, 100, 0.15); color: #ff8080; }
      .ag-coverage-num { font-weight: 700; font-size: 14px; }
      .ag-coverage-lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; }
      .ag-coverage-total { margin-left: auto; font-size: 12px; color: var(--muted, #8a93a6); }
      .ag-coverage-bar { height: 4px; background: rgba(138, 147, 166, 0.15); border-radius: 2px; overflow: hidden; }
      .ag-coverage-bar-fill { height: 100%; background: linear-gradient(90deg, #46c878, #7ab8ff); transition: width 240ms; }
      .ag-body { font-size: 14px; line-height: 1.65; }
      .ag-body .md-h1 { margin: 24px 0 12px 0; font-size: 24px; }
      .ag-body .md-h2 { margin: 22px 0 10px 0; font-size: 20px; padding-top: 6px; }
      .ag-body .md-h3 { margin: 18px 0 8px 0; font-size: 16px; color: var(--accent, #7ab8ff); }
      .ag-body .md-h4 { margin: 14px 0 6px 0; font-size: 14px; color: var(--accent2, #c089f9); }
      .ag-body .md-p  { margin: 6px 0; }
      .ag-body .md-li { margin: 3px 0 3px 22px; }
      .ag-body .md-bq { margin: 10px 0; padding: 10px 14px; border-left: 3px solid var(--accent, #7ab8ff); background: rgba(122, 184, 255, 0.06); color: var(--fg, #cfd6e4); border-radius: 0 4px 4px 0; }
      .ag-body .md-code { padding: 12px; background: rgba(0, 0, 0, 0.25); border-radius: 6px; overflow-x: auto; font-size: 12px; }
      .ag-body .md-inline-code { padding: 1px 4px; background: rgba(122, 184, 255, 0.12); border-radius: 3px; font-size: 12px; }
      .ag-body .md-table-wrap { overflow-x: auto; margin: 10px 0; }
      .ag-body .md-table { border-collapse: collapse; width: 100%; font-size: 13px; }
      .ag-body .md-th, .ag-body .md-td { padding: 6px 10px; border: 1px solid var(--border, #2a3142); text-align: left; }
      .ag-body .md-th { background: rgba(122, 184, 255, 0.08); font-weight: 600; }
      .ag-body .md-hr { border: 0; border-top: 1px solid var(--border, #2a3142); margin: 18px 0; }
      .ag-body .md-link { color: var(--accent, #7ab8ff); text-decoration: none; }
      .ag-body .md-link:hover { text-decoration: underline; }
      @media (max-width: 900px) {
        .ag-shell { grid-template-columns: 1fr; }
        .ag-sidebar { position: static; max-height: none; }
      }
    `;
    document.head.appendChild(style);
  }

  // ── Main render ──

  async function render(container, param) {
    injectStyles();
    container.innerHTML = renderSkeleton();

    try {
      // Fetch guide + ToC in parallel; decisions ledger best-effort
      const owner = (typeof CONFIG !== 'undefined' && CONFIG.username) || 'venkateshcs-ux';

      const [guide, tocMd] = await Promise.all([
        Repos.getFile(owner, REPO, GUIDE_PATH).catch(() => null),
        Repos.getFile(owner, REPO, TOC_PATH).catch(() => null)
      ]);

      const tocBlocks = parseToc(tocMd);
      const lastRefined = guide
        ? ((guide.match(/\*Last refined[:\s]+([^*]+)\*/i) || [])[1] || '').trim()
        : '';

      container.innerHTML = `
      <div class="ag-shell">
        <aside class="ag-sidebar">
          <div class="ag-sidebar-header">Table of Contents</div>
          ${tocSidebar(tocBlocks)}
        </aside>
        <main class="ag-main">
          <div class="ag-header">
            <h1 class="ag-title">Working with AI: predictive × deterministic</h1>
            <p class="ag-sub muted">Co-authored guide — Venkatesh × Claude (Opus 4.7). Refined session-by-session via the <code>capture-collab-decision</code> Skill.</p>
            ${lastRefined ? `<div class="ag-meta">Last refined: <strong>${escHtml(lastRefined)}</strong></div>` : ''}
          </div>
          ${coverageWidget(tocBlocks)}
          <div class="ag-body" id="ag-body">
            ${guide ? renderMarkdown(guide) : '<div class="ctx-missing"><p class="muted">Guide source <code>docs/education/ai-collab-guide.md</code> not found.</p></div>'}
          </div>
        </main>
      </div>`;

      // Wire ToC links: smooth-scroll to in-page anchor
      container.querySelectorAll('.ag-toc-link').forEach(a => {
        a.addEventListener('click', (ev) => {
          const anchor = a.dataset.anchor;
          if (!anchor) return;
          const target = container.querySelector('#' + cssEscape(anchor));
          if (target) {
            ev.preventDefault();
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            // Update hash for shareable link without navigating away
            history.replaceState(null, '', `#/aiGuide/${encodeURIComponent(anchor)}`);
          }
        });
      });

      // If a section anchor was passed via param, scroll to it
      if (param) {
        const decoded = decodeURIComponent(param);
        const target  = container.querySelector('#' + cssEscape(decoded));
        if (target) setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
      }

    } catch (err) {
      container.innerHTML = `<div class="view-placeholder">
        <div class="placeholder-inner">
          <span class="placeholder-icon" style="color:var(--danger)">✕</span>
          <h2>Failed to load AI Collaboration Guide</h2>
          <p class="muted">${escHtml(String(err && err.message || err))}</p>
          <button class="btn-retry" onclick="AiGuideView.render(document.getElementById('main-content'))">Retry</button>
        </div>
      </div>`;
    }
  }

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
  }

  return { render };

})();
