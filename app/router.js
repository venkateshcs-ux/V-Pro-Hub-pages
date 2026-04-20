// app/router.js — hash-based router for V-Pro-Hub
// Phase 1 — Vanilla JS, no framework

const ROUTES = {
  sprint:       { label: 'Sprint',       icon: '▶', built: true, step: '#38', desc: 'Active sprint — health, kanban, sessions', viewModule: 'SprintView' },
  orchestrator: { label: 'Orchestrator', icon: '⚡', built: true, step: '#35', desc: 'Multi-tool projects — next step per project', viewModule: 'OrchestratorView' },
  portfolio: { label: 'Portfolio',      icon: '◈', built: true, step: 'C3', desc: 'All products at a glance',    viewModule: 'PortfolioView' },
  product:   { label: 'Product Detail', icon: '◉', built: true, step: 'C4', desc: 'Drill into one product',      viewModule: 'ProductView'   },
  session:   { label: 'Session Log',    icon: '◎', built: true, step: 'C5', desc: 'Claude Code session history', viewModule: 'SessionView'   },
  context:   { label: 'Context Viewer', icon: '◍', built: true, step: 'C6', desc: 'CONTEXT.md reader',           viewModule: 'ContextView'   },
  backlog:   { label: 'Backlog',        icon: '◐', built: true,  step: 'C8',  desc: 'Product backlog per repo',    viewModule: 'BacklogView'   },
  health:    { label: 'Health Check',   icon: '◑', built: true,  step: 'C11', desc: 'Product health at a glance',  viewModule: 'HealthView'    },
  architecture: { label: 'Architecture', icon: '◇', built: true, step: '#19', desc: 'Multi-provider architecture', viewModule: 'ArchitectureView' },
  investment: { label: 'AI Investment', icon: '◆', built: true, step: '#29', desc: 'Plan costs, tool ranking, break-even', viewModule: 'InvestmentView' },
  settings:  { label: 'Settings',       icon: '◌', built: true,  step: 'C7',  desc: 'PAT, preferences, intervals', viewModule: 'SettingsView'  },
};

const DEFAULT_ROUTE = 'sprint';

// Parse hash into { routeKey, param }
// Supports: #/portfolio, #/product/V-Pro-Hub
function getRoute() {
  const hash = window.location.hash.replace(/^#\//, '');
  const [routeKey, ...rest] = hash.split('/');
  const param = rest.join('/') || null;
  return {
    routeKey: ROUTES[routeKey] ? routeKey : DEFAULT_ROUTE,
    param,
  };
}

function renderView(routeKey, param) {
  const route = ROUTES[routeKey];
  const main  = document.getElementById('main-content');

  // Update nav active state
  document.querySelectorAll('.nav-item').forEach(el => {
    const isActive = el.dataset.route === routeKey;
    el.classList.toggle('active', isActive);
    if (isActive && route.built) el.classList.remove('unbuilt');
  });

  // Update page title
  const pageTitle = document.getElementById('page-title');
  if (pageTitle) pageTitle.textContent = param ? `${route.label} — ${param}` : route.label;

  if (route.built) {
    const viewModule = window[route.viewModule];
    if (viewModule && typeof viewModule.render === 'function') {
      viewModule.render(main, param);
    } else {
      main.innerHTML = `<div class="view-placeholder built">
        <div class="placeholder-inner">
          <span class="placeholder-icon">${route.icon}</span>
          <h2>${route.label}</h2>
          <p>${route.desc}</p>
        </div>
      </div>`;
    }
  } else {
    main.innerHTML = `<div class="view-placeholder unbuilt">
      <div class="placeholder-inner">
        <span class="placeholder-icon dim">${route.icon}</span>
        <h2>${route.label}</h2>
        <p class="muted">${route.desc}</p>
        <div class="not-built-badge">
          <span class="badge-dot"></span>
          Not built yet &mdash; coming in Step ${route.step}
        </div>
      </div>
    </div>`;
  }
}

function showToast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span class="toast-icon">⚠</span> ${message}`;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('toast-visible'));
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function navigate(routeKey, param) {
  const route = ROUTES[routeKey];
  if (!route) return;
  window.location.hash = param ? `/${routeKey}/${param}` : `/${routeKey}`;
}

function handleNavClick(e) {
  const item     = e.currentTarget;
  const routeKey = item.dataset.route;
  const route    = ROUTES[routeKey];

  if (!route.built) {
    showToast(`${route.label} is not built yet — coming in Step ${route.step}`);
    return;
  }
  navigate(routeKey);
}

function initRouter() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', handleNavClick);
  });

  window.addEventListener('hashchange', () => {
    const { routeKey, param } = getRoute();
    renderView(routeKey, param);
  });

  const { routeKey, param } = getRoute();
  renderView(routeKey, param);
}

window.Router = { init: initRouter, navigate };
