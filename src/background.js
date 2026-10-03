import { compileRules, normalizeRule, planOrder, planWindow } from './core.js';

const DEBOUNCE_MS = 150;
const RETRY_MS = 400;
const MAX_RETRIES = 6;

// ---- Scheduling -------------------------------------------------------------
// Bursts of tab events are debounced per window, and all work runs through one
// queue so two passes never edit the same tabs or the stored state at once.

const timers = new Map();
let queue = Promise.resolve();

function enqueue(task) {
  const run = queue.then(task);
  queue = run.catch(() => {});
  return run;
}

function schedule(windowId, delay = DEBOUNCE_MS, attempt = 0) {
  if (typeof windowId !== 'number' || windowId < 0) return;
  clearTimeout(timers.get(windowId));
  const timer = setTimeout(() => {
    timers.delete(windowId);
    enqueue(() => reconcileWindow(windowId)).catch((err) => {
      // Chrome rejects edits while the user drags a tab, and tabs can close
      // mid-pass. Both settle quickly, so try again shortly.
      if (attempt < MAX_RETRIES) schedule(windowId, RETRY_MS * (attempt + 1), attempt + 1);
      else console.warn('Tab Grouplet: giving up on window', windowId, err);
    });
  }, delay);
  timers.set(windowId, timer);
}

async function scheduleAll(delay = DEBOUNCE_MS) {
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  for (const w of windows) schedule(w.id, delay);
}

// ---- State ------------------------------------------------------------------

async function loadConfig() {
  const { rules = [], paused = false } = await chrome.storage.local.get(['rules', 'paused']);
  return { rules: rules.map(normalizeRule), paused };
}

// Group ids owned by the extension: { [groupId]: { key, ruleId } }. Group ids
// only live as long as the browser session, and so does this map.
async function loadManaged() {
  const { managed = {} } = await chrome.storage.session.get('managed');
  return managed;
}

function saveManaged(managed) {
  return chrome.storage.session.set({ managed });
}

// ---- Reconciling --------------------------------------------------------------

async function reconcileWindow(windowId) {
  const { rules, paused } = await loadConfig();
  if (paused) return;
  const win = await chrome.windows.get(windowId).catch(() => null);
  if (!win || win.type !== 'normal') return;

  const [tabs, groups, allGroups, managed] = await Promise.all([
    chrome.tabs.query({ windowId }),
    chrome.tabGroups.query({ windowId }),
    chrome.tabGroups.query({}),
    loadManaged(),
  ]);
  const alive = new Set(allGroups.map((g) => g.id));
  for (const id of Object.keys(managed)) if (!alive.has(Number(id))) delete managed[id];

  const plan = planWindow({ tabs, groups, managed, compiled: compileRules(rules) });
  for (const { groupId, key, ruleId } of plan.adopt) managed[groupId] = { key, ruleId };
  try {
    if (plan.ungroup.length) await chrome.tabs.ungroup(plan.ungroup);
    for (const op of plan.ops) {
      let groupId = op.groupId;
      if (op.addTabIds.length) {
        groupId = await chrome.tabs.group(
          groupId === null
            ? { tabIds: op.addTabIds, createProperties: { windowId } }
            : { groupId, tabIds: op.addTabIds },
        );
      }
      managed[groupId] = { key: op.key, ruleId: op.ruleId };
      if (Object.keys(op.update).length) await chrome.tabGroups.update(groupId, op.update);
    }
  } finally {
    await saveManaged(managed);
  }

  await applyOrder(windowId, rules, managed);
}

async function applyOrder(windowId, rules, managed) {
  const positions = new Map();
  rules.forEach((r, rank) => {
    if (r.position != null) positions.set(r.id, { position: r.position, rank });
  });
  if (!positions.size) return;
  const [tabs, groups] = await Promise.all([
    chrome.tabs.query({ windowId }),
    chrome.tabGroups.query({ windowId }),
  ]);
  const moves = planOrder({
    tabs,
    groups,
    positionOf: (groupId) => positions.get(managed[groupId]?.ruleId) ?? null,
  });
  for (const { groupId, index } of moves) await chrome.tabGroups.move(groupId, { index });
}

// Pauses first so nothing regroups the tabs right away.
function ungroupAll() {
  return enqueue(async () => {
    await chrome.storage.local.set({ paused: true });
    const managed = await loadManaged();
    const tabs = await chrome.tabs.query({});
    const tabIds = tabs.filter((t) => managed[t.groupId]).map((t) => t.id);
    if (tabIds.length) await chrome.tabs.ungroup(tabIds);
    await saveManaged({});
  });
}

async function status() {
  const [managed, groups] = await Promise.all([loadManaged(), chrome.tabGroups.query({})]);
  return { managedGroups: groups.filter((g) => managed[g.id]).length };
}

// ---- Events -----------------------------------------------------------------
// Group membership changes are deliberately not watched: a manual move stays
// until the next tab change in that window, instead of being undone mid-drag.

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.runtime.openOptionsPage();
  scheduleAll();
});
chrome.runtime.onStartup.addListener(() => scheduleAll());

chrome.tabs.onCreated.addListener((tab) => schedule(tab.windowId));
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if ('url' in change || 'pinned' in change) schedule(tab.windowId);
});
chrome.tabs.onRemoved.addListener((tabId, { windowId, isWindowClosing }) => {
  if (!isWindowClosing) schedule(windowId);
});
chrome.tabs.onAttached.addListener((tabId, { newWindowId }) => schedule(newWindowId));
chrome.tabs.onDetached.addListener((tabId, { oldWindowId }) => schedule(oldWindowId));
chrome.tabs.onReplaced.addListener((addedTabId) => {
  chrome.tabs.get(addedTabId).then((tab) => schedule(tab.windowId), () => {});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.rules || changes.paused)) scheduleAll();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const reply = (promise) => {
    promise.then(
      (result) => sendResponse({ ok: true, ...result }),
      (err) => sendResponse({ ok: false, error: err.message }),
    );
    return true;
  };
  switch (message?.type) {
    case 'regroup':
      return reply(scheduleAll(0));
    case 'ungroupAll':
      return reply(ungroupAll());
    case 'status':
      return reply(status());
  }
});
