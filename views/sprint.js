// views/sprint.js — Thin redirect to BacklogView (S035, post-merger)
// The Sprint Dashboard's content (health pills, drift flags, kanban, sessions log,
// projects panel) is now part of Backlog 2.0 view, surfaced contextually when
// Sprint filter = "Current" (Option C inline-band layout per Polished.html).
//
// This file remains so the existing #/sprint route still works — it delegates to
// BacklogView with sprintFilter='Current' + vmMode='board' preset. Once the new
// route shape is settled, the route entry in app/router.js will redirect directly
// to #/backlog and this file can be retired.

window.SprintView = (() => {
  async function render(container) {
    if (!window.BacklogView || typeof window.BacklogView.render !== 'function') {
      container.innerHTML = `<div class="bl-empty">
        <div class="bl-empty-glyph">∅</div>
        <div class="bl-empty-msg">Sprint Dashboard moved into Backlog 2.0.</div>
        <div class="bl-empty-detail">Visit <a href="#/backlog">Backlog</a> and select Sprint = Current.</div>
      </div>`;
      return;
    }
    return window.BacklogView.render(container, { sprintFilter: 'Current', vmMode: 'board' });
  }
  return { render };
})();
