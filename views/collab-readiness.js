// views/collab-readiness.js — COLLAB-INFRA readiness view (E-012 · card #172)
//
// Ported from CP-authored prototype at docs/handoffs/collab-readiness-view-prototype.html
// (Designer deliverable for #172 dc2 — see backlog-detail/172.md).
//
// PORT NOTES (S102 2026-06-09, item 4):
//   - Taxonomy preserved verbatim: labels, tree shape, lens names, CP-authored leaf states
//     all unchanged. Per V directive "Do NOT change the taxonomy — Venkatesh ratifies that first."
//   - Single placeholder substitution: workflow → "Design card #NNN" → "Design card #171"
//     (NNN was a known placeholder in the CP file; 171 is the landed Phase 0 design card).
//   - Live projection: a `signalRef` metadata field added per leaf where mechanical resolution
//     from a card/epic frontmatter is defensible. For every other leaf, signalRef is absent /
//     'static', and the CP-authored `state` field stands.
//   - Conservative live coverage today (6 leaves): card:107.status × 2 leaves (Data layer +
//     Event-sourced projection), epic:E-012.status × 1, card:171.status × 1, card:172.status
//     × 1, card:68.status NOT added (CP's qualitative 'gap' for untested Cowork preferred
//     over mechanical 'planned'). All others static pending V ratification of mapping rules.
//   - CSS scoped under #collab-readiness (matches CP prototype). Safe to mount inside any
//     details page container.

window.CollabReadinessView = (() => {

  // ── Scoped CSS (identical to CP prototype) ─────────────────

  const CSS = `
    #collab-readiness{
      --ink:#1b1f27; --muted:#5b6573; --faint:#8a93a1; --hair:#e4e7ec; --panel:#ffffff; --sub:#f6f7f9;
      --ready:#1f8a4c; --ready-bg:#e8f5ee; --partial:#b4790e; --partial-bg:#fbf2dd;
      --planned:#5b6b86; --planned-bg:#eef1f6; --gap:#c0392b; --gap-bg:#fae9e7;
      --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
      --sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
      color:var(--ink); font-family:var(--sans); font-size:14px; line-height:1.45;
      background:var(--panel); border:1px solid var(--hair); border-radius:12px;
      max-width:860px; overflow:hidden;
    }
    #collab-readiness *{box-sizing:border-box}
    #collab-readiness .cr-head{padding:18px 20px 14px;border-bottom:1px solid var(--hair)}
    #collab-readiness .cr-kicker{font:600 11px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--faint)}
    #collab-readiness .cr-title{font-size:17px;font-weight:650;margin:6px 0 2px}
    #collab-readiness .cr-meta{font:11px/1.4 var(--mono);color:var(--muted)}
    #collab-readiness .cr-overall{display:flex;align-items:center;gap:14px;margin-top:14px}
    #collab-readiness .cr-gauge{flex:1;height:8px;border-radius:99px;background:var(--sub);overflow:hidden;display:flex}
    #collab-readiness .cr-gauge span{height:100%}
    #collab-readiness .cr-pct{font:650 22px/1 var(--mono);min-width:64px;text-align:right}
    #collab-readiness .cr-counts{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
    #collab-readiness .cr-chip{font:600 10px/1 var(--mono);letter-spacing:.04em;padding:4px 8px;border-radius:99px;text-transform:uppercase}
    #collab-readiness .cr-tabs{display:flex;gap:2px;padding:10px 16px 0;background:var(--sub);border-bottom:1px solid var(--hair)}
    #collab-readiness .cr-tab{appearance:none;border:0;background:transparent;cursor:pointer;font:600 12px var(--sans);
      color:var(--muted);padding:9px 13px;border-radius:8px 8px 0 0;display:flex;align-items:center;gap:8px}
    #collab-readiness .cr-tab[aria-selected="true"]{background:var(--panel);color:var(--ink);box-shadow:0 -1px 0 var(--hair) inset, -1px 0 0 var(--hair) inset, 1px 0 0 var(--hair) inset}
    #collab-readiness .cr-tab .cr-tpct{font:650 11px var(--mono);color:var(--faint)}
    #collab-readiness .cr-tree{padding:8px 8px 14px}
    #collab-readiness .cr-row{display:flex;align-items:center;gap:10px;width:100%;text-align:left;appearance:none;border:0;
      background:transparent;cursor:default;padding:8px 10px;border-radius:8px;font:inherit;color:inherit}
    #collab-readiness button.cr-row{cursor:pointer}
    #collab-readiness button.cr-row:hover{background:var(--sub)}
    #collab-readiness button.cr-row:focus-visible{outline:2px solid var(--planned);outline-offset:1px}
    #collab-readiness .cr-tw{width:14px;flex:0 0 14px;color:var(--faint);font:10px var(--mono);transition:transform .15s ease}
    #collab-readiness .cr-row[aria-expanded="true"] .cr-tw{transform:rotate(90deg)}
    #collab-readiness .cr-label{flex:1;min-width:0;font-weight:550;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #collab-readiness .cr-label .cr-sub{font:11px var(--mono);color:var(--faint);margin-left:8px;font-weight:400}
    #collab-readiness .cr-signal{font:500 10.5px var(--mono);color:var(--muted);background:var(--sub);
      border:1px solid var(--hair);border-radius:6px;padding:2px 7px;white-space:nowrap;max-width:340px;overflow:hidden;text-overflow:ellipsis}
    #collab-readiness .cr-signal.is-repo{color:#0f5e63;background:#e8f4f4;border-color:#cfe6e6}
    #collab-readiness .cr-bar{width:62px;flex:0 0 62px;height:6px;border-radius:99px;background:var(--sub);overflow:hidden;display:flex}
    #collab-readiness .cr-bar span{height:100%}
    #collab-readiness .cr-pill{font:600 10px var(--mono);letter-spacing:.04em;text-transform:uppercase;padding:3px 8px;border-radius:99px;flex:0 0 auto;min-width:62px;text-align:center}
    #collab-readiness .s-ready{color:var(--ready)} #collab-readiness .b-ready{background:var(--ready)} #collab-readiness .p-ready{color:var(--ready);background:var(--ready-bg)}
    #collab-readiness .s-partial{color:var(--partial)} #collab-readiness .b-partial{background:var(--partial)} #collab-readiness .p-partial{color:var(--partial);background:var(--partial-bg)}
    #collab-readiness .s-planned{color:var(--planned)} #collab-readiness .b-planned{background:var(--planned)} #collab-readiness .p-planned{color:var(--planned);background:var(--planned-bg)}
    #collab-readiness .s-gap{color:var(--gap)} #collab-readiness .b-gap{background:var(--gap)} #collab-readiness .p-gap{color:var(--gap);background:var(--gap-bg)}
    #collab-readiness .cr-kids{overflow:hidden}
    #collab-readiness .cr-foot{padding:10px 20px 14px;border-top:1px solid var(--hair);font:11px/1.5 var(--mono);color:var(--faint)}
    #collab-readiness .cr-gapcount{color:var(--gap);font:600 10px var(--mono)}
    @media (max-width:620px){
      #collab-readiness .cr-signal{display:none}
      #collab-readiness .cr-bar{display:none}
    }
    @media (prefers-reduced-motion:reduce){
      #collab-readiness .cr-tw{transition:none}
    }
  `;

  // ── Static taxonomy (CP-authored — DO NOT change without V ratification) ───
  // signalRef field added by CC port for live resolution. Absent / 'static' = use leaf.state.

  function buildManifest() {
    return {
      architecture: [
        { label:"Contributors & roles", children:[
          { label:"Humans (CLI + WebApp)", state:"ready",   signal:"card team[]: Assigner=venkatesh", repo:true },
          { label:"Claude Code (CC)",      state:"ready",   signal:"reference impl · Co-Authored-By", repo:true },
          { label:"Claude Projects (CP)",  state:"partial", signal:"connector read live; write not wired", repo:true },
          { label:"Cowork (CCo)",          state:"gap",     signal:"dispatch beta, untested (#68)", repo:true },
          { label:"Other AI tools",        state:"partial", signal:".cursorrules/.windsurfrules present; no e2e", repo:true },
          { label:"New roles: CI/CD · QA · customers", state:"planned", signal:"design: extend WORKFLOW archetypes", repo:false }
        ]},
        { label:"Surfaces", children:[
          { label:"WebApp",      state:"partial", signal:"repo-as-store; no inbound sync; 1 PAT", repo:true },
          { label:"Code tab",    state:"ready",   signal:"native git read/write", repo:true },
          { label:"Cowork",      state:"gap",     signal:"not wired", repo:true },
          { label:"Chat / CP",   state:"partial", signal:"read live; write manual", repo:true },
          { label:"Mobile (web)",state:"planned", signal:"design: responsive WebApp over server", repo:false }
        ]},
        { label:"Business logic / API (server tier)", state:"planned", signal:"design: thin app server + identity broker (P2)", repo:false },
        { label:"Governance (auto + human)", children:[
          { label:"Card-claim gate (GR-24 L0)",    state:"ready",   signal:"pre_tool_use.py PreToolUse block", repo:true },
          { label:"Commit references card (L5/6)", state:"ready",   signal:"commit-msg + pre-push", repo:true },
          { label:"Verify-before-codify (GR-23)",  state:"ready",   signal:"GR-23 ladder L1-L7", repo:true },
          { label:"Ratification gate (GR-25)",     state:"ready",   signal:"non-bypassable content gate", repo:true },
          { label:"Schema validators (#167/#168)", state:"ready",   signal:"validate_card_schema.py block-mode", repo:true },
          { label:"Schema v2.1 lint (#169)",       state:"partial", signal:"warn-mode; SCHEMA_V2_BLOCK_MODE toggle", repo:true },
          { label:"Card-scope path binding",       state:"gap",     signal:"B.7: claim authorizes any non-allowlist path", repo:true },
          { label:"Blast-radius limits",           state:"gap",     signal:"B.7: no rate/cost/file/time cap", repo:true },
          { label:"Autonomy authorization",        state:"gap",     signal:"session_class/auto_candidate: no code consumer", repo:true },
          { label:"Override-with-log completeness",state:"partial", signal:"GR24 ledgered; GR23/24 bypass stderr-only", repo:true },
          { label:"Per-agent identity",            state:"planned", signal:"design: GitHub App (P1); 1 PAT today", repo:false }
        ]},
        { label:"Data layer (DB primary · operational slice)", state:"planned", signal:"#107 candidate; no DB chosen", repo:true, signalRef:"card:107.status" },
        { label:"Repo substrate", children:[
          { label:"V-Pro-Hub hub (dominant node)", state:"ready",   signal:"live · master synced", repo:true },
          { label:"Invest split repo",             state:"ready",   signal:"separate node exists", repo:true },
          { label:"Repo-per-product target",       state:"planned", signal:"design: split incrementally (P4)", repo:false },
          { label:"GitHub org + App",              state:"planned", signal:"design: retire single PAT (P1)", repo:false },
          { label:"Event-sourced projection",      state:"planned", signal:"#107: repo as projection of DB", repo:true, signalRef:"card:107.status" }
        ]},
        { label:"Hosting / runtime", state:"planned", signal:"design: local node, cloud-promotable (P2)", repo:false }
      ],
      topology: [
        { label:"Human · CLI", children:[
          { label:"read",  state:"ready", signal:"local FS + git pull", repo:true },
          { label:"write", state:"ready", signal:"git push · venkateshcs-ux", repo:true }
        ]},
        { label:"Human · WebApp", children:[
          { label:"read",  state:"partial", signal:"no inbound sync (stale)", repo:true },
          { label:"write", state:"partial", signal:"single PAT · last-write-wins", repo:true }
        ]},
        { label:"Claude Code", children:[
          { label:"read",  state:"ready", signal:"clone · Read/Glob/Grep", repo:true },
          { label:"write", state:"ready", signal:"edit + git · Co-Authored-By", repo:true }
        ]},
        { label:"Claude Projects (CP)", children:[
          { label:"read",  state:"partial", signal:"connector live · master-only · manual sync", repo:true },
          { label:"write", state:"gap",     signal:"no write path", repo:true }
        ]},
        { label:"Cowork (CCo)", children:[
          { label:"read",  state:"gap", signal:"not wired", repo:true },
          { label:"write", state:"gap", signal:"dispatch beta, untested", repo:true }
        ]},
        { label:"Other AI tools", children:[
          { label:"read",  state:"ready",   signal:"clone (same as CC)", repo:true },
          { label:"write", state:"partial", signal:"gh CLI + PAT; no shim run", repo:true }
        ]}
      ],
      workflow: [
        { label:"P0 · Design (E-012)", children:[
          { label:"E-012 epic",            state:"partial", signal:"status: active", repo:true, signalRef:"epic:E-012.status" },
          { label:"Design card #171",      state:"partial", signal:"status: candidate · 0/6 DCs met", repo:true, signalRef:"card:171.status" },
          { label:"Readiness view (this)", state:"partial", signal:"prototype · not yet ported", repo:false, signalRef:"card:172.status" }
        ]},
        { label:"P1 · Identity + governance-hardening", state:"planned", signal:"design: org+App + hooks", repo:false },
        { label:"P2 · Server + DB-primary",             state:"planned", signal:"design: #107 dual-write", repo:false },
        { label:"P3 · Surfaces (incl. this view)",      state:"planned", signal:"design: WebApp web+mobile over server", repo:false },
        { label:"P4 · Repo-per-product split",          state:"planned", signal:"design: split (P4)", repo:false },
        { label:"P5 · External edge",                   state:"planned", signal:"design: CI/CD · testers · customers", repo:false }
      ]
    };
  }

  const LENSES = [
    { id:"architecture", label:"Architecture" },
    { id:"topology",     label:"Topology" },
    { id:"workflow",     label:"Workflow" }
  ];
  const STATE = {
    ready:  { score:1.0, label:"ready" },
    partial:{ score:0.5, label:"partial" },
    planned:{ score:0.0, label:"planned" },
    gap:    { score:0.0, label:"gap" }
  };

  // ── Resolver — maps signalRef → state via live repo facade ─────────
  // Conservative coverage (S102): card:NNN.status + epic:E-NNN.status only.
  // 'static' / absent / unrecognized / fetch-fail → return leaf.state (CP-authored).
  // Status→state map per leaf domain:
  //   card:   done→ready / in-progress→partial / candidate→planned / blocked→gap / missing→gap
  //   epic:   done→ready / active→partial / planning→planned / dormant→gap

  const CARD_STATUS_TO_STATE = { done:'ready', 'in-progress':'partial', candidate:'planned', blocked:'gap' };
  const EPIC_STATUS_TO_STATE = { done:'ready', active:'partial', planning:'planned', dormant:'gap' };

  async function resolveLeafState(leaf, ctx) {
    const ref = leaf.signalRef;
    if (!ref || ref === 'static') return leaf.state;
    try {
      const cardMatch = ref.match(/^card:(\d+)\.status$/);
      if (cardMatch) {
        const id = cardMatch[1];
        const md = await Repos.getFile(ctx.owner, ctx.repo, `docs/backlog-detail/${id}.md`, ctx.branch);
        if (!md) return 'gap';
        const fm = (window.BacklogView && window.BacklogView.parseFrontmatter)
          ? window.BacklogView.parseFrontmatter(md) : {};
        const s = String(fm.status || '').toLowerCase().split(/\s+/)[0].replace(/[^a-z-]/g, '');
        return CARD_STATUS_TO_STATE[s] || leaf.state;
      }
      const epicMatch = ref.match(/^epic:(E-\d+)\.status$/);
      if (epicMatch) {
        const eid = epicMatch[1];
        const epicsMd = await Repos.getFile(ctx.owner, ctx.repo, 'docs/EPICS.md', ctx.branch);
        if (!epicsMd) return leaf.state;
        const pathMatch = epicsMd.match(new RegExp(`\\[${eid}\\]\\(([^)]+)\\)`));
        if (!pathMatch) return leaf.state;
        const epicMd = await Repos.getFile(ctx.owner, ctx.repo, `docs/${pathMatch[1]}`, ctx.branch);
        if (!epicMd) return leaf.state;
        const statusMatch = epicMd.match(/^---[\s\S]*?\nstatus:\s*(\S+)/m);
        if (!statusMatch) return leaf.state;
        const s = statusMatch[1].replace(/[#"',]/g, '').toLowerCase();
        return EPIC_STATUS_TO_STATE[s] || leaf.state;
      }
    } catch (_e) {
      // fail-soft: keep static state
    }
    return leaf.state;
  }

  async function applyLiveStates(manifest, ctx) {
    function walk(nodes) {
      const out = [];
      for (const n of nodes) {
        if (n.children && n.children.length) out.push(...walk(n.children));
        else out.push(n);
      }
      return out;
    }
    const allLeaves = LENSES.flatMap(L => walk(manifest[L.id]));
    const live = allLeaves.filter(l => l.signalRef && l.signalRef !== 'static');
    await Promise.all(live.map(async leaf => {
      const resolved = await resolveLeafState(leaf, ctx);
      if (resolved && resolved !== leaf.state) {
        leaf._origState = leaf.state;  // preserve CP-authored state for audit
        leaf.state = resolved;
      }
    }));
    return live.length;
  }

  // ── Rollup ───────────────────────────────────────────────

  function leaves(node) {
    if (!node.children || !node.children.length) return [node];
    return node.children.reduce((a, c) => a.concat(leaves(c)), []);
  }
  function rollup(nodes) {
    const ls = nodes.reduce((a, n) => a.concat(leaves(n)), []);
    let sum = 0;
    const counts = { ready:0, partial:0, planned:0, gap:0 };
    ls.forEach(l => { sum += STATE[l.state].score; counts[l.state]++; });
    return { pct: ls.length ? Math.round(100 * sum / ls.length) : 0, counts, n: ls.length };
  }
  function bandClass(pct) { return pct >= 80 ? 'ready' : pct >= 40 ? 'partial' : 'planned'; }

  function gaugeFill(counts, n) {
    let html = '';
    for (const s of ['ready', 'partial']) {
      const w = n ? (100 * counts[s] / n) : 0;
      if (w > 0) html += `<span class="b-${s}" style="width:${w}%"></span>`;
    }
    return html;
  }

  // ── Render helpers ────────────────────────────────────────

  function escHtml(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function pill(state) {
    return `<span class="cr-pill p-${state}">${STATE[state].label}</span>`;
  }
  function signalChip(node) {
    if (!node.signal) return '';
    return `<span class="cr-signal${node.repo ? ' is-repo' : ''}" title="${escHtml(node.signal)}">${escHtml(node.signal)}</span>`;
  }
  function barFor(pct) {
    return `<span class="cr-bar"><span class="b-${bandClass(pct)}" style="width:${pct}%"></span></span>`;
  }

  function renderNode(node, depth) {
    const wrap = document.createElement('div');
    const hasKids = node.children && node.children.length;
    const pad = 10 + depth * 18;

    if (hasKids) {
      const r = rollup([node]);
      const btn = document.createElement('button');
      btn.className = 'cr-row';
      btn.style.paddingLeft = pad + 'px';
      btn.setAttribute('aria-expanded', 'false');
      const gapNote = r.counts.gap ? ` <span class="cr-gapcount">${r.counts.gap} gap</span>` : '';
      btn.innerHTML =
        '<span class="cr-tw">&#9656;</span>' +
        `<span class="cr-label">${escHtml(node.label)}${gapNote}</span>` +
        barFor(r.pct) +
        `<span class="cr-pill p-${bandClass(r.pct)}">${r.pct}%</span>`;
      const kids = document.createElement('div');
      kids.className = 'cr-kids';
      kids.style.maxHeight = '0px';
      node.children.forEach(c => kids.appendChild(renderNode(c, depth + 1)));
      btn.addEventListener('click', () => {
        const open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', open ? 'false' : 'true');
        kids.style.maxHeight = open ? '0px' : kids.scrollHeight + 'px';
      });
      wrap.appendChild(btn);
      wrap.appendChild(kids);
    } else {
      const row = document.createElement('div');
      row.className = 'cr-row';
      row.style.paddingLeft = (pad + 24) + 'px';
      row.innerHTML =
        `<span class="cr-label">${escHtml(node.label)}</span>` +
        signalChip(node) +
        pill(node.state);
      wrap.appendChild(row);
    }
    return wrap;
  }

  function renderLens(treeEl, manifest, id) {
    treeEl.innerHTML = '';
    manifest[id].forEach(n => treeEl.appendChild(renderNode(n, 0)));
  }

  function renderTabs(tabsEl, manifest, active, onSwitch) {
    tabsEl.innerHTML = '';
    LENSES.forEach(L => {
      const r = rollup(manifest[L.id]);
      const t = document.createElement('button');
      t.className = 'cr-tab';
      t.setAttribute('role', 'tab');
      t.setAttribute('aria-selected', L.id === active ? 'true' : 'false');
      t.innerHTML = `${escHtml(L.label)} <span class="cr-tpct">${r.pct}%</span>`;
      t.addEventListener('click', () => onSwitch(L.id, t));
      tabsEl.appendChild(t);
    });
  }

  function renderHeader(rootEl, manifest, sourceLabel) {
    const allRoots = LENSES.flatMap(L => manifest[L.id]);
    const all = rollup(allRoots);
    const pctEl = rootEl.querySelector('#cr-pct');
    const gaugeEl = rootEl.querySelector('#cr-gauge');
    const metaEl = rootEl.querySelector('#cr-meta');
    const countsEl = rootEl.querySelector('#cr-counts');
    if (pctEl) {
      pctEl.textContent = all.pct + '%';
      pctEl.className = 'cr-pct s-' + bandClass(all.pct);
    }
    if (gaugeEl) gaugeEl.innerHTML = gaugeFill(all.counts, all.n);
    if (metaEl) metaEl.textContent = `projection over repo signals · ${sourceLabel}`;
    if (countsEl) {
      countsEl.innerHTML = '';
      [['ready','p-ready'],['partial','p-partial'],['planned','p-planned'],['gap','p-gap']].forEach(pair => {
        const c = document.createElement('span');
        c.className = 'cr-chip ' + pair[1];
        c.textContent = `${all.counts[pair[0]]} ${pair[0]}`;
        countsEl.appendChild(c);
      });
    }
  }

  // ── Public render ─────────────────────────────────────────

  async function render(container, branchHint) {
    if (!container) return;
    container.innerHTML = `<div id="collab-readiness">
      <style>${CSS}</style>
      <div class="cr-head">
        <div class="cr-kicker">VProHub · initiative readiness</div>
        <div class="cr-title">AI-Native VProHub — E-012 COLLAB-INFRA</div>
        <div class="cr-meta" id="cr-meta">projection over repo signals · loading…</div>
        <div class="cr-overall">
          <div class="cr-gauge" id="cr-gauge" aria-hidden="true"></div>
          <div class="cr-pct" id="cr-pct">—</div>
        </div>
        <div class="cr-counts" id="cr-counts"></div>
      </div>
      <div class="cr-tabs" id="cr-tabs" role="tablist" aria-label="Readiness lenses"></div>
      <div class="cr-tree" id="cr-tree" role="region" aria-live="polite"></div>
      <div class="cr-foot">
        Read-only. Each row's chip names the repo signal it derives from
        (<span style="color:#0f5e63">teal = live repo fact</span>, grey = design/manual).
        Status is never typed into this view.
      </div>
    </div>`;

    const root = container.querySelector('#collab-readiness');
    const tabsEl = root.querySelector('#cr-tabs');
    const treeEl = root.querySelector('#cr-tree');

    const manifest = buildManifest();
    let active = 'architecture';

    function switchLens(id, tabBtn) {
      active = id;
      Array.from(tabsEl.children).forEach(c => c.setAttribute('aria-selected', 'false'));
      if (tabBtn) tabBtn.setAttribute('aria-selected', 'true');
      renderLens(treeEl, manifest, active);
    }

    // Phase 1 — instant render with static (CP-authored) states
    renderTabs(tabsEl, manifest, active, switchLens);
    renderHeader(root, manifest, 'static (CP-authored) · resolving…');
    renderLens(treeEl, manifest, active);

    // Phase 2 — async resolve live signals + re-render
    try {
      const owner = (typeof CONFIG !== 'undefined' && CONFIG.username) || 'venkateshcs-ux';
      const repo = 'V-Pro-Hub';
      let branch = branchHint || null;
      if (!branch && window.ActiveSprint && typeof window.ActiveSprint.getActiveSprintBranch === 'function') {
        const disc = await window.ActiveSprint.getActiveSprintBranch(owner, repo).catch(() => null);
        branch = (disc && disc.branch) || null;
      }
      const ctx = { owner, repo, branch: branch || undefined };
      const liveCount = await applyLiveStates(manifest, ctx);
      const sourceLabel = `${branch || 'default branch'} · ${liveCount} live signals resolved`;
      renderTabs(tabsEl, manifest, active, switchLens);
      renderHeader(root, manifest, sourceLabel);
      renderLens(treeEl, manifest, active);
    } catch (err) {
      // resolver failure is non-fatal — static render remains
      renderHeader(root, manifest, `static fallback (resolver error: ${escHtml(err.message || 'unknown')})`);
    }
  }

  return { render };
})();
