import {
  GROUP_COLORS,
  TEMPLATES,
  compileRules,
  createRule,
  escapeRegExp,
  matchUrl,
  normalizeRule,
  patternError,
  tabUrl,
} from '../src/core.js';
import { el, groupChip, ruleName } from '../src/ui.js';

const COLOR_NAMES = {
  grey: 'Grey', blue: 'Blue', red: 'Red', yellow: 'Yellow', green: 'Green',
  pink: 'Pink', purple: 'Purple', cyan: 'Cyan', orange: 'Orange',
};
const EMOJI = [
  '🏠', '💻', '🧪', '🚀', '⭐', '🔥', '📦', '🛠️',
  '🐞', '📊', '📝', '📚', '🔒', '🌐', '☁️', '🐙',
  '🦊', '🐳', '⚙️', '💬', '📧', '🎨', '🎵', '🎬',
  '🛒', '💼', '🏢', '🧭', '🔍', '📅', '✅', '💡',
  '🧩', '🗂️', '📌', '🛜', '🟢', '🟡', '🔴', '🔵',
];
const PREVIEW_LIMIT = 12;

const $ = (selector, root = document) => root.querySelector(selector);
const list = $('#rules');
const testInput = $('#test-url');
const emojiPop = $('#emoji-pop');

let rules = []; // working copy, saved explicitly
let savedJson = '[]';
let openTabs = [];
const expanded = new Set(); // ids of rules showing their details; all collapsed on load

const isDirty = () => JSON.stringify(rules) !== savedJson;

// ---- Rendering --------------------------------------------------------------

function renderRules() {
  list.replaceChildren(...rules.map(buildCard));
  $('#empty').hidden = rules.length > 0;
  refresh();
}

function buildCard(rule) {
  const card = $('#rule-template').content.firstElementChild.cloneNode(true);
  card.dataset.id = rule.id;

  for (const input of card.querySelectorAll('[data-field]')) {
    const { field } = input.dataset;
    if (input.type === 'checkbox') input.checked = rule[field];
    else input.value = rule[field] ?? '';
    const live = input.type !== 'checkbox' && input.tagName !== 'SELECT';
    input.addEventListener(live ? 'input' : 'change', () => {
      rule[field] = readField(rule, input);
      refresh();
    });
    if (input.type === 'number') {
      input.addEventListener('change', () => (input.value = rule[field] ?? ''));
    }
  }

  const swatches = $('[data-role="swatches"]', card);
  for (const color of ['', ...GROUP_COLORS]) {
    const name = color ? COLOR_NAMES[color] : 'Auto';
    const radio = el('input', {
      type: 'radio',
      name: `color-${rule.id}`,
      value: color,
      checked: rule.color === color,
      'aria-label': name,
      onchange: () => {
        rule.color = color;
        refresh();
      },
    });
    swatches.append(
      el(
        'label',
        {
          class: color ? `swatch c-${color}` : 'swatch auto',
          title: color ? name : 'Auto: use the color least used by other groups in the window',
        },
        radio,
        el('span', {}, color ? '' : 'Auto'),
      ),
    );
  }
  setOpen(card, expanded.has(rule.id));
  return card;
}

function setOpen(card, open) {
  card.classList.toggle('open', open);
  const toggle = $('[data-action="toggle"]', card);
  const label = open ? 'Hide details' : 'Show details';
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', label);
  toggle.title = label;
}

function toggleRule(card, open = !card.classList.contains('open')) {
  if (open) expanded.add(card.dataset.id);
  else expanded.delete(card.dataset.id);
  setOpen(card, open);
  updateToggleAll();
}

function revealRule(id) {
  const card = list.querySelector(`[data-id="${id}"]`);
  if (!card) return;
  toggleRule(card, true);
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

const allExpanded = () => rules.length > 0 && rules.every((r) => expanded.has(r.id));

function updateToggleAll() {
  const button = $('#toggle-all');
  button.hidden = rules.length === 0;
  button.textContent = allExpanded() ? 'Collapse all' : 'Expand all';
}

function readField(rule, input) {
  const { field } = input.dataset;
  if (input.type === 'checkbox') return input.checked;
  if (input.type === 'number') return normalizeRule({ ...rule, [field]: input.value })[field];
  return input.value;
}

// Updates everything derived from the working rules without rebuilding the
// cards, so typing never loses focus.
function refresh() {
  updateStatus();
  updateToggleAll();
  const compiled = compileRules(rules);
  const previews = computePreviews(compiled);
  [...list.children].forEach((card, i) => {
    const rule = rules.find((r) => r.id === card.dataset.id);
    const error = rule.pattern ? patternError(rule) : null;
    $('[data-role="index"]', card).textContent = i + 1;
    card.classList.toggle('disabled', !rule.enabled);
    card.classList.toggle('invalid', Boolean(error));
    const errorEl = $('[data-role="error"]', card);
    errorEl.hidden = !error;
    errorEl.textContent = error ? `Invalid pattern: ${error}` : '';
    $('[data-action="up"]', card).disabled = i === 0;
    $('[data-action="down"]', card).disabled = i === rules.length - 1;
    renderPreview($('[data-role="preview"]', card), rule, previews.get(rule.id), error);
  });
  renderTest(compiled);
}

// Which groups each rule would form from the currently open tabs.
function computePreviews(compiled) {
  const byRule = new Map();
  for (const tab of openTabs) {
    if (tab.pinned) continue;
    const m = matchUrl(compiled, tabUrl(tab));
    if (!m) continue;
    if (!byRule.has(m.rule.id)) byRule.set(m.rule.id, new Map());
    const groups = byRule.get(m.rule.id);
    if (!groups.has(m.title)) groups.set(m.title, { title: m.title, total: 0, perWindow: new Map(), tabs: [] });
    const g = groups.get(m.title);
    g.total++;
    g.perWindow.set(tab.windowId, (g.perWindow.get(tab.windowId) ?? 0) + 1);
    if (g.tabs.length < 6) g.tabs.push(tab.title || tabUrl(tab));
  }
  return byRule;
}

function renderPreview(container, rule, groups, error) {
  let content;
  if (!rule.enabled) content = 'Disabled: this rule is ignored.';
  else if (!rule.pattern) content = 'Enter a pattern to see which open tabs match.';
  else if (error) content = 'This rule is skipped until the pattern is valid.';
  else if (!groups) content = 'No open tabs match (or an earlier rule takes them).';
  if (content) {
    container.replaceChildren(content);
    return;
  }
  const sorted = [...groups.values()].sort((a, b) => b.total - a.total || a.title.localeCompare(b.title));
  const chips = sorted.slice(0, PREVIEW_LIMIT).map((g) => {
    const grouped = Math.max(...g.perWindow.values()) >= rule.minTabs;
    const lines = [`${g.title || 'Untitled group'}: ${g.total} tab${g.total === 1 ? '' : 's'}`, ...g.tabs.map((t) => `• ${t}`)];
    if (g.total > g.tabs.length) lines.push('…');
    if (!grouped) lines.push(`Not grouped yet: needs ${rule.minTabs} in one window`);
    return groupChip(g.title, rule.color, { count: g.total, dim: !grouped, tooltip: lines.join('\n') });
  });
  const more = sorted.length - PREVIEW_LIMIT;
  container.replaceChildren(el('span', { class: 'preview-label' }, 'Open tabs →'), ...chips);
  if (more > 0) container.append(el('span', {}, `+${more} more`));
}

function renderTest(compiled) {
  const out = $('#test-result');
  let url = testInput.value.trim();
  if (!url) {
    out.replaceChildren('Shows which rule matches and the group name it gets, using your unsaved edits.');
    return;
  }
  // "localhost:3000" has no scheme even though it looks like one.
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(url) && !/^(about|data|blob|javascript|mailto):/i.test(url)) url = `https://${url}`;
  const m = matchUrl(compiled, url);
  if (!m) {
    out.replaceChildren('No rule matches, so the tab stays ungrouped.');
    return;
  }
  const index = rules.indexOf(m.rule) + 1;
  out.replaceChildren(
    'Goes to',
    groupChip(m.title, m.rule.color),
    'via',
    el('button', { type: 'button', class: 'link', onclick: () => revealRule(m.rule.id) }, `rule ${index} “${ruleName(m.rule)}”`),
  );
  if (m.rule.minTabs > 1) out.append(`once ${m.rule.minTabs} matching tabs are open in a window`);
}

// ---- Status & saving --------------------------------------------------------

let flashTimer = null;

function showStatus(text, kind = '') {
  const status = $('#status');
  status.textContent = text;
  status.className = `status ${kind}`;
}

function flashStatus(text, kind) {
  clearTimeout(flashTimer);
  showStatus(text, kind);
  flashTimer = setTimeout(() => {
    flashTimer = null;
    updateStatus();
  }, 3500);
}

function updateStatus() {
  const dirty = isDirty();
  $('#save').disabled = !dirty;
  $('#revert').disabled = !dirty;
  if (!flashTimer) showStatus(dirty ? 'Unsaved changes' : '', dirty ? 'dirty' : '');
}

async function save() {
  if (!isDirty()) return;
  await chrome.storage.local.set({ rules });
  savedJson = JSON.stringify(rules);
  updateStatus();
  flashStatus('Saved, groups updated', 'ok');
}

function revert() {
  rules = JSON.parse(savedJson).map(normalizeRule);
  renderRules();
  flashStatus('Reverted', '');
}

// ---- Rule actions -------------------------------------------------------------

function addRule(fields, { atTop = false, focus = '[data-field="pattern"]' } = {}) {
  const rule = createRule(fields);
  expanded.add(rule.id);
  if (atTop) rules.unshift(rule);
  else rules.push(rule);
  renderRules();
  const card = list.querySelector(`[data-id="${rule.id}"]`);
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  $(focus, card)?.focus({ preventScroll: true });
}

list.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) {
    // Empty parts of the header also toggle the details.
    const head = event.target.closest('.rule-head');
    if (head && !event.target.closest('input, label, .handle')) toggleRule(head.closest('.rule'));
    return;
  }
  const card = button.closest('.rule');
  const index = rules.findIndex((r) => r.id === card.dataset.id);
  const { action } = button.dataset;
  if (action === 'toggle') {
    toggleRule(card);
    return;
  }
  if (action === 'emoji') {
    openEmoji(button);
    return;
  }
  if (action === 'up' || action === 'down') {
    const to = action === 'up' ? index - 1 : index + 1;
    [rules[index], rules[to]] = [rules[to], rules[index]];
    renderRules();
    const moved = list.querySelector(`[data-id="${card.dataset.id}"] [data-action="${action}"]`);
    (moved.disabled ? moved.parentElement.querySelector('button:not(:disabled)') : moved)?.focus();
  } else if (action === 'duplicate') {
    const copy = createRule({ ...rules[index], label: rules[index].label ? `${rules[index].label} (copy)` : '' });
    rules.splice(index + 1, 0, copy);
    expanded.add(copy.id);
    renderRules();
  } else if (action === 'delete') {
    rules.splice(index, 1);
    renderRules();
    flashStatus('Rule deleted. Revert to undo', 'dirty');
  }
});

// Drag to reorder. Cards only become draggable while the handle is held, so
// text in their inputs stays selectable.
let dragged = null;
list.addEventListener('pointerdown', (event) => {
  const handle = event.target.closest('.handle');
  if (handle) handle.closest('.rule').draggable = true;
});
list.addEventListener('pointerup', (event) => {
  const card = event.target.closest('.rule');
  if (card) card.draggable = false;
});
list.addEventListener('dragstart', (event) => {
  dragged = event.target.closest('.rule');
  dragged.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', dragged.dataset.id);
});
list.addEventListener('dragover', (event) => {
  if (!dragged) return;
  event.preventDefault();
  const over = event.target.closest('.rule');
  if (!over || over === dragged) return;
  const rect = over.getBoundingClientRect();
  list.insertBefore(dragged, event.clientY > rect.top + rect.height / 2 ? over.nextSibling : over);
});
list.addEventListener('drop', (event) => event.preventDefault());
list.addEventListener('dragend', () => {
  if (!dragged) return;
  dragged.classList.remove('dragging');
  dragged.draggable = false;
  dragged = null;
  const order = [...list.children].map((card) => card.dataset.id);
  rules.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  refresh();
});

// ---- Emoji picker -------------------------------------------------------------

let emojiTarget = null;
emojiPop.append(...EMOJI.map((ch) => el('button', { type: 'button', textContent: ch, onclick: () => insertEmoji(ch) })));

function openEmoji(button) {
  emojiTarget = button.closest('.title-row').querySelector('input');
  emojiPop.hidden = false;
  const r = button.getBoundingClientRect();
  emojiPop.style.top = `${r.bottom + scrollY + 6}px`;
  emojiPop.style.left = `${Math.max(8, r.right + scrollX - emojiPop.offsetWidth)}px`;
  emojiPop.querySelector('button').focus();
}

function insertEmoji(ch) {
  const input = emojiTarget;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const before = input.value.slice(0, start);
  input.setRangeText(before && !/\s$/.test(before) ? ` ${ch}` : ch, start, end, 'end');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  emojiPop.hidden = true;
  input.focus();
}

// ---- Page controls ------------------------------------------------------------

const addButton = $('#add');
const addMenu = $('#add-menu');

function setMenu(open) {
  addMenu.hidden = !open;
  addButton.setAttribute('aria-expanded', String(open));
  if (open) addMenu.querySelector('button').focus();
}

addButton.addEventListener('click', () => setMenu(addMenu.hidden));
document.addEventListener('click', (event) => {
  const templateButton = event.target.closest('[data-template]');
  if (templateButton) {
    setMenu(false);
    addRule(TEMPLATES[templateButton.dataset.template]);
    return;
  }
  if (!event.target.closest('.menu')) setMenu(false);
  if (!event.target.closest('.emoji-pop, [data-action="emoji"]')) emojiPop.hidden = true;
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!addMenu.hidden) {
      setMenu(false);
      addButton.focus();
    }
    if (!emojiPop.hidden) {
      emojiPop.hidden = true;
      emojiTarget?.focus();
    }
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    save();
  }
});

$('#toggle-all').addEventListener('click', () => {
  const open = !allExpanded();
  for (const card of list.children) {
    if (open) expanded.add(card.dataset.id);
    else expanded.delete(card.dataset.id);
    setOpen(card, open);
  }
  updateToggleAll();
});
$('#save').addEventListener('click', save);
$('#revert').addEventListener('click', revert);
$('#resume').addEventListener('click', () => chrome.storage.local.set({ paused: false }));
testInput.addEventListener('input', () => renderTest(compileRules(rules)));

$('#export').addEventListener('click', () => {
  const data = JSON.stringify({ app: 'tab-grouplet', version: 1, rules }, null, 2);
  const link = el('a', {
    href: URL.createObjectURL(new Blob([data], { type: 'application/json' })),
    download: 'tab-grouplet-rules.json',
  });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});

const importFile = $('#import-file');
$('#import').addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async () => {
  const file = importFile.files[0];
  importFile.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const imported = Array.isArray(data) ? data : data?.rules;
    if (!Array.isArray(imported)) throw new Error('no rules found in this file');
    const ids = new Set();
    expanded.clear();
    rules = imported.map((raw) => {
      const rule = normalizeRule(raw);
      if (ids.has(rule.id)) rule.id = crypto.randomUUID();
      ids.add(rule.id);
      return rule;
    });
    renderRules();
    flashStatus(`Imported ${rules.length} rule${rules.length === 1 ? '' : 's'}. Save to apply, or Revert`, 'dirty');
  } catch (err) {
    flashStatus(`Import failed: ${err.message}`, 'error');
  }
});

window.addEventListener('beforeunload', (event) => {
  if (isDirty()) event.preventDefault();
});

// ---- External changes ---------------------------------------------------------

function showPaused(paused) {
  $('#paused-banner').hidden = !paused;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.paused) showPaused(Boolean(changes.paused.newValue));
  if (changes.rules && !isDirty()) {
    const incoming = (changes.rules.newValue ?? []).map(normalizeRule);
    if (JSON.stringify(incoming) !== savedJson) {
      rules = incoming;
      savedJson = JSON.stringify(rules);
      renderRules();
    }
  }
});

let tabsTimer = null;
async function loadTabs() {
  openTabs = await chrome.tabs.query({});
}
function reloadTabsSoon() {
  clearTimeout(tabsTimer);
  tabsTimer = setTimeout(async () => {
    await loadTabs();
    refresh();
  }, 300);
}
chrome.tabs.onCreated.addListener(reloadTabsSoon);
chrome.tabs.onRemoved.addListener(reloadTabsSoon);
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if ('url' in change || 'title' in change || 'pinned' in change) reloadTabsSoon();
});

// "Add rule for this site" from the popup opens this page with #add=<hostname>.
function handleHash() {
  const host = new URLSearchParams(location.hash.slice(1)).get('add');
  if (!host) return;
  history.replaceState(null, '', location.pathname);
  const bare = host.replace(/^www\./, '');
  addRule(
    { label: bare, pattern: `^https?://(?:www\\.)?${escapeRegExp(bare)}[:/]`, title: bare, minTabs: 1 },
    { atTop: true, focus: '[data-field="title"]' },
  );
  flashStatus('New rule added at the top. Adjust it, then Save', 'dirty');
}

async function init() {
  const [{ rules: stored = [], paused = false }] = await Promise.all([
    chrome.storage.local.get(['rules', 'paused']),
    loadTabs(),
  ]);
  rules = stored.map(normalizeRule);
  savedJson = JSON.stringify(rules);
  showPaused(paused);
  renderRules();
  handleHash();
}

$('#version').textContent = `v${chrome.runtime.getManifest().version}`;
init();
