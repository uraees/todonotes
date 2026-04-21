/**
 * TodoNotes — frontend application
 *
 * State model:
 *   items[]      — all non-deleted items from the server
 *   queryFilter  — optional query_type string to highlight a subset
 *   isLoading    — global loading flag
 *   isSubmitting — command submission in progress
 */

// ─── State ───────────────────────────────────────────────────────────────────
let state = {
  items: [],
  queryFilter: null,
  isLoading: true,
  mobileTab: 'active',
  authEnabled: false,
  isAuthenticated: false,
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $board        = document.getElementById('board');
const $commandInput = document.getElementById('commandInput');
const $submitBtn    = document.getElementById('submitBtn');
const $micBtn       = document.getElementById('micBtn');
const $feedbackBar  = document.getElementById('feedbackBar');
const $headerMeta   = document.getElementById('headerMeta');
const $authOverlay  = document.getElementById('authOverlay');
const $authForm     = document.getElementById('authForm');
const $authCode     = document.getElementById('authCode');
const $authSubmitBtn = document.getElementById('authSubmitBtn');
const $authError    = document.getElementById('authError');

// ─── Date helpers ─────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function tomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

function endOfWeekStr() {
  const d = new Date();
  const daysUntilSunday = (7 - d.getDay()) % 7;
  d.setDate(d.getDate() + daysUntilSunday);
  return d.toISOString().split('T')[0];
}

/** Format an ISO date for display. */
function formatDate(isoDate) {
  if (!isoDate) return '';
  const today    = todayStr();
  const tomorrow = tomorrowStr();

  if (isoDate === today)    return 'Today';
  if (isoDate === tomorrow) return 'Tomorrow';

  const date = new Date(isoDate + 'T00:00:00');
  const now  = new Date();
  now.setHours(0, 0, 0, 0);

  const diffDays = Math.round((date - now) / 86400000);
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;

  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Return a CSS modifier class for the date pill. */
function dateCssClass(isoDate) {
  if (!isoDate) return '';
  const today = todayStr();
  if (isoDate < today) return 'overdue-date';
  if (isoDate === today) return 'today-date';
  return '';
}

/** Format a datetime as a relative "time ago" string. */
function timeAgo(isoDateTime) {
  if (!isoDateTime) return '';
  const diffMs = Date.now() - new Date(isoDateTime).getTime();
  const mins  = Math.floor(diffMs / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7)  return `${days}d ago`;
  return new Date(isoDateTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Grouping ─────────────────────────────────────────────────────────────────

const GROUPS = [
  { key: 'overdue',   label: 'Overdue',        cls: 'section--overdue' },
  { key: 'today',     label: 'Due Today',       cls: 'section--today' },
  { key: 'this-week', label: 'Due This Week',   cls: 'section--this-week' },
  { key: 'upcoming',  label: 'Upcoming',        cls: 'section--upcoming' },
  { key: 'no-date',   label: 'No Due Date',     cls: 'section--no-date' },
  { key: 'completed', label: 'Completed',       cls: 'section--completed' },
];

function getGroup(item) {
  if (item.status === 'completed') return 'completed';
  const today   = todayStr();
  const eow     = endOfWeekStr();
  const due     = item.due_date;
  if (!due) return 'no-date';
  if (due < today)             return 'overdue';
  if (due === today)           return 'today';
  if (due <= eow)              return 'this-week';
  return 'upcoming';
}

function getRecentCompleted() {
  return state.items
    .filter(i => i.status === 'completed')
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, 10);
}

function groupItems(items) {
  const map = {};
  GROUPS.forEach(g => { map[g.key] = []; });
  for (const item of items) {
    map[getGroup(item)].push(item);
  }
  return map;
}

// ─── Query filter logic ───────────────────────────────────────────────────────

function queryMatchesGroup(queryFilter, groupKey) {
  if (!queryFilter) return true;
  const map = {
    overdue:   ['overdue'],
    today:     ['today'],
    tomorrow:  ['today'],   // tomorrow items show in "today" or "this-week" depending on date
    this_week: ['today', 'this-week', 'overdue'],
    upcoming:  ['upcoming'],
    open:      ['overdue', 'today', 'this-week', 'upcoming', 'no-date'],
    completed: ['completed'],
    notes:     ['overdue', 'today', 'this-week', 'upcoming', 'no-date', 'completed'],
    todos:     ['overdue', 'today', 'this-week', 'upcoming', 'no-date', 'completed'],
    all:       ['overdue', 'today', 'this-week', 'upcoming', 'no-date', 'completed'],
  };
  return (map[queryFilter] || []).includes(groupKey);
}

function queryMatchesItem(queryFilter, item) {
  if (!queryFilter) return false;
  const today    = todayStr();
  const tomorrow = tomorrowStr();
  const eow      = endOfWeekStr();
  switch (queryFilter) {
    case 'overdue':   return item.due_date && item.due_date < today && item.status === 'open';
    case 'today':     return item.due_date === today;
    case 'tomorrow':  return item.due_date === tomorrow;
    case 'this_week': return item.due_date && item.due_date >= today && item.due_date <= eow;
    case 'upcoming':  return item.due_date && item.due_date > eow && item.status === 'open';
    case 'open':      return item.status === 'open';
    case 'completed': return item.status === 'completed';
    case 'notes':     return item.type === 'note';
    case 'todos':     return item.type === 'todo';
    case 'all':       return true;
    default:          return true;
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderItem(item) {
  const isCompleted = item.status === 'completed';
  const isHighlighted = state.queryFilter && queryMatchesItem(state.queryFilter, item);

  const card = document.createElement('div');
  card.className = `item-card status-${item.status}${isHighlighted ? ' highlighted' : ''}`;
  card.dataset.id = item.id;

  const dateDisplay = formatDate(item.due_date);
  const dateCls     = dateCssClass(item.due_date);
  const isOverdue   = item.due_date && item.due_date < todayStr() && item.status === 'open';

  card.innerHTML = `
    <div class="item-body">
      <div class="item-meta">
        <span class="badge badge-${item.type}">${item.type === 'todo' ? 'TODO' : 'NOTE'}</span>
        ${isOverdue ? '<span class="badge badge-overdue">OVERDUE</span>' : ''}
        ${dateDisplay ? `<span class="item-date ${dateCls}">${dateDisplay}</span>` : ''}
      </div>
      <div class="item-content">${escapeHtml(item.content)}</div>
    </div>
    <div class="item-actions">
      ${isCompleted
        ? `<button class="action-btn btn-reopen" data-id="${item.id}" title="Reopen">↩</button>`
        : `<button class="action-btn btn-complete" data-id="${item.id}" title="Mark complete">✓</button>`
      }
      <button class="action-btn btn-delete" data-id="${item.id}" title="Delete">✕</button>
    </div>
  `;

  return card;
}

function renderGroup(groupKey, groupLabel, groupCls, items) {
  if (items.length === 0) return null;

  const isActive = !state.queryFilter || queryMatchesGroup(state.queryFilter, groupKey);

  const section = document.createElement('section');
  section.className = `section ${groupCls}${!isActive ? ' dimmed' : ''}`;
  section.dataset.group = groupKey;

  section.innerHTML = `
    <div class="section-header">
      <div class="section-dot"></div>
      <span class="section-title">${groupLabel}</span>
      <span class="section-count">${items.length}</span>
    </div>
    <div class="section-divider"></div>
    <div class="items-list"></div>
  `;

  const list = section.querySelector('.items-list');
  items.forEach(item => list.appendChild(renderItem(item)));

  return section;
}

function renderCompletedPanelItem(item) {
  const card = document.createElement('div');
  card.className = 'item-card status-completed';
  card.dataset.id = item.id;

  const ago = timeAgo(item.updated_at);

  card.innerHTML = `
    <div class="item-body">
      <div class="item-meta">
        <span class="badge badge-${item.type}">${item.type === 'todo' ? 'TODO' : 'NOTE'}</span>
        ${ago ? `<span class="item-date">${ago}</span>` : ''}
      </div>
      <div class="item-content">${escapeHtml(item.content)}</div>
    </div>
    <div class="item-actions">
      <button class="action-btn btn-reopen" data-id="${item.id}" title="Reopen">↩</button>
      <button class="action-btn btn-delete"  data-id="${item.id}" title="Delete">✕</button>
    </div>
  `;

  return card;
}

function renderCompletedPanel() {
  const items = getRecentCompleted();

  const panel = document.createElement('aside');
  panel.className = 'completed-panel section--completed';

  panel.innerHTML = `
    <div class="section-header">
      <div class="section-dot"></div>
      <span class="section-title">Recently Completed</span>
      <span class="section-count">${items.length}</span>
    </div>
    <div class="section-divider"></div>
    <div class="items-list"></div>
  `;

  const list = panel.querySelector('.items-list');

  if (items.length === 0) {
    list.innerHTML = `<div class="completed-panel-empty">Nothing completed yet — get to it! ✓</div>`;
  } else {
    items.forEach(item => list.appendChild(renderCompletedPanelItem(item)));
  }

  return panel;
}

function renderBoard() {
  const grouped = groupItems(state.items);
  $board.innerHTML = '';
  $board.classList.toggle('show-completed', state.mobileTab === 'completed');

  if (state.items.length === 0) {
    $board.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">✦</div>
        <div class="empty-title">No items yet</div>
        <div class="empty-hint">Type a command above to get started.<br>Try "Add a todo to review the quarterly report by Friday".</div>
      </div>
    `;
    return;
  }

  // Tab bar — shown only on mobile via CSS
  const tabBar = document.createElement('div');
  tabBar.className = 'tab-bar';
  tabBar.innerHTML = `
    <button class="tab${state.mobileTab === 'active'    ? ' tab--active' : ''}" data-tab="active">Active</button>
    <button class="tab${state.mobileTab === 'completed' ? ' tab--active' : ''}" data-tab="completed">Completed</button>
  `;
  tabBar.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (!tab) return;
    state.mobileTab = tab.dataset.tab;
    tabBar.querySelectorAll('.tab').forEach(t =>
      t.classList.toggle('tab--active', t.dataset.tab === state.mobileTab)
    );
    $board.classList.toggle('show-completed', state.mobileTab === 'completed');
  });
  $board.appendChild(tabBar);

  // Two-column layout wrapper
  const layout = document.createElement('div');
  layout.className = 'board-layout';

  // ── Left: active items (all groups except completed) ──
  const mainPanel = document.createElement('div');
  mainPanel.className = 'main-panel';

  let rendered = 0;
  for (const { key, label, cls } of GROUPS) {
    if (key === 'completed') continue;
    const items = grouped[key] || [];
    const section = renderGroup(key, label, cls, items);
    if (section) {
      mainPanel.appendChild(section);
      rendered++;
    }
  }

  if (rendered === 0) {
    mainPanel.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">✦</div>
        <div class="empty-title">All clear!</div>
        <div class="empty-hint">Nothing active right now.</div>
      </div>
    `;
  }

  // ── Right: recently completed ──
  layout.appendChild(mainPanel);
  layout.appendChild(renderCompletedPanel());
  $board.appendChild(layout);
}

function updateHeaderMeta() {
  const open = state.items.filter(i => i.status === 'open').length;
  const overdue = state.items.filter(i =>
    i.status === 'open' && i.due_date && i.due_date < todayStr()
  ).length;
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  $headerMeta.textContent = overdue > 0
    ? `${today} · ${open} open · ${overdue} overdue`
    : `${today} · ${open} open`;
}

// ─── Feedback bar ─────────────────────────────────────────────────────────────

let feedbackTimer = null;

function showFeedback(text, type = 'success', autohide = true) {
  $feedbackBar.textContent = text;
  $feedbackBar.className = `feedback ${type}`;
  if (feedbackTimer) clearTimeout(feedbackTimer);
  if (autohide) {
    feedbackTimer = setTimeout(() => {
      $feedbackBar.className = 'feedback hidden';
    }, 5000);
  }
}

function hideFeedback() {
  $feedbackBar.className = 'feedback hidden';
}

function showAuthOverlay(message = '') {
  $authOverlay.classList.remove('hidden');
  $authOverlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('auth-locked');

  if (message) {
    $authError.textContent = message;
    $authError.className = 'auth-error';
  } else {
    $authError.className = 'auth-error hidden';
  }

  window.setTimeout(() => $authCode.focus(), 0);
}

function hideAuthOverlay() {
  $authOverlay.classList.add('hidden');
  $authOverlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('auth-locked');
  $authCode.value = '';
  $authError.className = 'auth-error hidden';
}

function lockApp(message = 'Enter the access code to continue.') {
  state.isAuthenticated = false;
  state.items = [];
  showAuthOverlay(message);
  $board.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">🔒</div>
      <div class="empty-title">Workspace locked</div>
      <div class="empty-hint">Unlock the app to load your notes and todos.</div>
    </div>
  `;
}

// ─── API calls ────────────────────────────────────────────────────────────────

async function apiFetch(url, options = {}) {
  const res = await fetch(url, options);
  let data = null;

  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (res.status === 401) {
    state.isAuthenticated = false;
    showAuthOverlay(data?.error || 'Session expired. Enter the access code again.');
    throw new Error(data?.error || 'Authentication required.');
  }

  return { res, data };
}

async function checkAuthStatus() {
  const { data } = await apiFetch('/api/auth/status');
  state.authEnabled = Boolean(data?.auth_enabled);
  state.isAuthenticated = Boolean(data?.authenticated);

  if (!state.authEnabled || state.isAuthenticated) {
    hideAuthOverlay();
    return true;
  }

  lockApp();
  return false;
}

async function loadItems() {
  state.isLoading = true;
  $board.innerHTML = `<div class="loading-state"><div class="spinner"></div><span>Loading…</span></div>`;

  try {
    const { data } = await apiFetch('/api/items');
    if (!data.success) throw new Error(data.error || 'Failed to load items');
    state.items       = data.items || [];
    state.queryFilter = null;
    renderBoard();
    updateHeaderMeta();
  } catch (err) {
    $board.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠</div>
        <div class="empty-title">Could not connect</div>
        <div class="empty-hint">${escapeHtml(err.message)}</div>
      </div>
    `;
  } finally {
    state.isLoading = false;
  }
}

async function submitCommand() {
  const command = $commandInput.value.trim();
  if (!command) return;

  $submitBtn.disabled = true;
  $submitBtn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px;"></span><span class="submit-label">Thinking…</span>';
  hideFeedback();

  try {
    const { data } = await apiFetch('/api/command', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ command }),
    });

    if (data.success) {
      state.items       = data.items || state.items;
      state.queryFilter = data.query_filter || null;
      renderBoard();
      updateHeaderMeta();
      showFeedback(data.message || 'Done.', 'success');
      $commandInput.value = '';
    } else {
      const msg = data.message || data.error || 'Something went wrong.';
      showFeedback(msg, 'error', false);
      if (data.items) {
        state.items       = data.items;
        state.queryFilter = null;
        renderBoard();
        updateHeaderMeta();
      }
    }
  } catch (err) {
    showFeedback(`Network error: ${err.message}`, 'error', false);
  } finally {
    $submitBtn.disabled = false;
    $submitBtn.innerHTML = '<span class="submit-icon">→</span><span class="submit-label">Execute</span>';
    $commandInput.focus();
  }
}

async function deleteItemById(id) {
  try {
    const { data } = await apiFetch(`/api/items/${id}`, { method: 'DELETE' });
    if (!data.success) throw new Error(data.error);
    state.items       = data.items || [];
    state.queryFilter = null;
    renderBoard();
    updateHeaderMeta();
    showFeedback('Item deleted.', 'info');
  } catch (err) {
    showFeedback(`Delete failed: ${err.message}`, 'error');
  }
}

async function completeItemById(id) {
  try {
    const { data } = await apiFetch(`/api/items/${id}/complete`, { method: 'PATCH' });
    if (!data.success) throw new Error(data.error);
    state.items       = data.items || [];
    state.queryFilter = null;
    renderBoard();
    updateHeaderMeta();
    showFeedback('Marked as complete.', 'success');
  } catch (err) {
    showFeedback(`Error: ${err.message}`, 'error');
  }
}

async function reopenItemById(id) {
  try {
    const { data } = await apiFetch(`/api/items/${id}/reopen`, { method: 'PATCH' });
    if (!data.success) throw new Error(data.error);
    state.items       = data.items || [];
    state.queryFilter = null;
    renderBoard();
    updateHeaderMeta();
    showFeedback('Item reopened.', 'info');
  } catch (err) {
    showFeedback(`Error: ${err.message}`, 'error');
  }
}

// ─── Speech recognition ───────────────────────────────────────────────────────

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognition) {
  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let isListening = false;
  let savedText = '';

  $micBtn.addEventListener('click', () => {
    if (isListening) {
      recognition.stop();
    } else {
      savedText = $commandInput.value;
      recognition.start();
    }
  });

  recognition.addEventListener('start', () => {
    isListening = true;
    $micBtn.classList.add('listening');
    $micBtn.title = 'Listening… click to stop';
  });

  recognition.addEventListener('result', (e) => {
    const transcript = Array.from(e.results)
      .map(r => r[0].transcript)
      .join('');
    $commandInput.value = savedText ? savedText + ' ' + transcript : transcript;
  });

  recognition.addEventListener('end', () => {
    isListening = false;
    $micBtn.classList.remove('listening');
    $micBtn.title = 'Speak your command';
    $commandInput.focus();
  });

  recognition.addEventListener('error', (e) => {
    isListening = false;
    $micBtn.classList.remove('listening');
    $micBtn.title = 'Speak your command';
    const msgs = { 'not-allowed': 'Microphone access denied.', 'no-speech': 'No speech detected.' };
    showFeedback(msgs[e.error] || `Speech error: ${e.error}`, 'error');
  });
} else {
  $micBtn.style.display = 'none';
}

// ─── Event listeners ──────────────────────────────────────────────────────────

$submitBtn.addEventListener('click', submitCommand);

$authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $authCode.value.trim();
  if (!code) return;

  $authSubmitBtn.disabled = true;
  $authSubmitBtn.textContent = 'Checking…';
  $authError.className = 'auth-error hidden';

  try {
    const { data } = await apiFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });

    if (!data.success) throw new Error(data.error || 'Invalid access code.');

    state.isAuthenticated = true;
    hideAuthOverlay();
    await loadItems();
  } catch (err) {
    showAuthOverlay(err.message || 'Invalid access code.');
  } finally {
    $authSubmitBtn.disabled = false;
    $authSubmitBtn.textContent = 'Unlock';
  }
});

$commandInput.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    submitCommand();
  }
});

// Delegated click handler for inline action buttons
$board.addEventListener('click', (e) => {
  const btn = e.target.closest('.action-btn');
  if (!btn) return;
  const id = btn.dataset.id;
  if (!id) return;

  if (btn.classList.contains('btn-delete'))   deleteItemById(id);
  if (btn.classList.contains('btn-complete')) completeItemById(id);
  if (btn.classList.contains('btn-reopen'))   reopenItemById(id);
});

// ─── Utilities ────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

(async function boot() {
  try {
    const authenticated = await checkAuthStatus();
    if (authenticated) {
      await loadItems();
    }
  } catch (err) {
    lockApp(err.message);
  }
})();
