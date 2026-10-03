// Shared logic with no Chrome API calls: the rule model, matching, group-name
// templates, and the planners that decide how a window should be grouped and
// ordered. The background worker executes the plans; the pages use the
// matching helpers for previews.

export const NO_GROUP = -1;

// The only colors chrome.tabGroups supports.
export const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

// Preference order for automatic colors: most distinct first, grey last.
const AUTO_COLOR_ORDER = ['blue', 'red', 'green', 'yellow', 'purple', 'cyan', 'orange', 'pink', 'grey'];

export function createRule(fields = {}) {
  return normalizeRule({ ...fields, id: crypto.randomUUID() });
}

// Coerces anything (stored data, imported JSON) into a well-formed rule.
export function normalizeRule(raw = {}) {
  const position = toInt(raw.position, -99, 99);
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
    enabled: raw.enabled !== false,
    label: String(raw.label ?? '').slice(0, 80),
    pattern: String(raw.pattern ?? ''),
    title: String(raw.title ?? ''),
    color: GROUP_COLORS.includes(raw.color) ? raw.color : '',
    minTabs: toInt(raw.minTabs, 1, 99) ?? 1,
    position: position === 0 ? null : position,
  };
}

function toInt(value, min, max) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
}

// Matching always ignores case: Chrome lowercases the scheme and host anyway,
// and case-sensitive paths are rare enough not to be worth a setting.
function toRegExp(pattern) {
  return new RegExp(pattern, 'i');
}

export function patternError(rule) {
  if (!rule.pattern) return 'Enter a regular expression.';
  try {
    toRegExp(rule.pattern);
    return null;
  } catch (err) {
    return err.message;
  }
}

// Enabled rules with valid patterns, in priority order. Invalid ones are skipped.
export function compileRules(rules) {
  const compiled = [];
  for (const rule of rules) {
    if (!rule.enabled || patternError(rule)) continue;
    compiled.push({ rule, re: toRegExp(rule.pattern) });
  }
  return compiled;
}

export function tabUrl(tab) {
  return tab.pendingUrl || tab.url || '';
}

export function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// Expands $1…$9, $<name>, $& and $$ in a group-name template.
export function renderTitle(template, match) {
  return template
    .replace(/\$(\$|&|\d|<([^>]*)>)/g, (_, token, name) => {
      if (token === '$') return '$';
      if (token === '&') return match[0];
      if (name !== undefined) return match.groups?.[name] ?? '';
      return match[Number(token)] ?? '';
    })
    .trim();
}

// Rules match against the full URL. The first matching rule wins. Tabs with
// the same rule and the same rendered name share a group, so the key is the
// pair of both.
export function matchUrl(compiled, url) {
  if (!url) return null;
  for (const { rule, re } of compiled) {
    const m = re.exec(url);
    if (m) {
      const title = renderTitle(rule.title, m);
      return { rule, title, key: `${rule.id}\u0001${title}` };
    }
  }
  return null;
}

/**
 * Decides how one window's tabs should be grouped.
 *
 * `managed` maps group ids to { key, ruleId } for groups this extension owns.
 * Tabs in groups it does not own are never touched. Returns:
 *   ungroup: tab ids to remove from owned groups
 *   ops:     [{ key, ruleId, groupId (null = create), addTabIds, update }]
 *   adopt:   [{ groupId, key, ruleId }] untracked groups that now count as owned
 */
export function planWindow({ tabs, groups, managed, compiled }) {
  tabs = [...tabs].sort((a, b) => a.index - b.index);
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const owned = new Map();
  for (const g of groups) if (managed[g.id]) owned.set(g.id, managed[g.id]);

  const matchOf = new Map();
  const membersOf = new Map();
  for (const tab of tabs) {
    if (tab.pinned) continue;
    matchOf.set(tab.id, matchUrl(compiled, tabUrl(tab)));
    if (tab.groupId !== NO_GROUP) push(membersOf, tab.groupId, tab);
  }
  const movable = (tab) => tab.groupId === NO_GROUP || owned.has(tab.groupId);

  const movableCount = new Map();
  for (const tab of tabs) {
    const m = matchOf.get(tab.id);
    if (m && movable(tab)) increment(movableCount, m.key);
  }

  // Group ids change when Chrome restores a session, so take over untracked
  // groups that look exactly like one this extension would create.
  const adopt = [];
  const ownedKeys = new Set([...owned.values()].map((e) => e.key));
  for (const g of groups) {
    if (owned.has(g.id)) continue;
    const members = membersOf.get(g.id) ?? [];
    const m = members.length ? matchOf.get(members[0].id) : null;
    if (!m || m.title !== (g.title ?? '') || ownedKeys.has(m.key)) continue;
    if (!members.every((t) => matchOf.get(t.id)?.key === m.key)) continue;
    if (members.length + (movableCount.get(m.key) ?? 0) < m.rule.minTabs) continue;
    const entry = { key: m.key, ruleId: m.rule.id };
    owned.set(g.id, entry);
    ownedKeys.add(m.key);
    adopt.push({ groupId: g.id, ...entry });
  }

  const buckets = new Map();
  for (const tab of tabs) {
    const m = matchOf.get(tab.id);
    if (!m || !movable(tab)) continue;
    if (!buckets.has(m.key)) buckets.set(m.key, { ...m, tabs: [] });
    buckets.get(m.key).tabs.push(tab);
  }
  const active = [...buckets.values()].filter((b) => b.tabs.length >= b.rule.minTabs);
  const activeKeys = new Set(active.map((b) => b.key));

  const ungroup = tabs
    .filter((t) => !t.pinned && owned.has(t.groupId) && !activeKeys.has(matchOf.get(t.id)?.key))
    .map((t) => t.id);

  // Pick an existing owned group for each bucket: first one already carrying
  // its key, otherwise one that is going away but holds some of its tabs. Reuse
  // keeps a group's color and place when its name changes.
  const claimed = new Map();
  const taken = new Set();
  const bestGroup = (bucket, eligible) => {
    const counts = new Map();
    for (const t of bucket.tabs) {
      if (owned.has(t.groupId) && !taken.has(t.groupId) && eligible(owned.get(t.groupId))) {
        increment(counts, t.groupId);
      }
    }
    let best = null;
    for (const [id, n] of counts) if (best === null || n > counts.get(best)) best = id;
    return best;
  };
  const claim = (bucket, eligible) => {
    if (claimed.has(bucket.key)) return;
    const id = bestGroup(bucket, eligible);
    if (id === null) return;
    claimed.set(bucket.key, id);
    taken.add(id);
  };
  for (const b of active) claim(b, (e) => e.key === b.key);
  for (const b of active) claim(b, () => true);

  // Automatic colors avoid every color that stays visible in the window.
  const usage = new Map(GROUP_COLORS.map((c) => [c, 0]));
  for (const g of groups) if (!owned.has(g.id)) increment(usage, g.color);
  for (const b of active) {
    const id = claimed.get(b.key);
    if (id !== undefined) increment(usage, b.rule.color || groupById.get(id).color);
    else if (b.rule.color) increment(usage, b.rule.color);
  }

  const ops = [];
  for (const b of active) {
    const groupId = claimed.get(b.key) ?? null;
    const group = groupId === null ? null : groupById.get(groupId);
    const update = {};
    if (!group || (group.title ?? '') !== b.title) update.title = b.title;
    if (b.rule.color) {
      if (!group || group.color !== b.rule.color) update.color = b.rule.color;
    } else if (!group) {
      update.color = leastUsedColor(usage);
      increment(usage, update.color);
    }
    const addTabIds = b.tabs.filter((t) => t.groupId !== groupId).map((t) => t.id);
    const rekey = groupId === null || owned.get(groupId).key !== b.key;
    if (addTabIds.length || Object.keys(update).length || rekey) {
      ops.push({ key: b.key, ruleId: b.rule.id, groupId, addTabIds, update });
    }
  }

  return { ungroup, ops, adopt };
}

function leastUsedColor(usage) {
  let best = AUTO_COLOR_ORDER[0];
  for (const c of AUTO_COLOR_ORDER) if (usage.get(c) < usage.get(best)) best = c;
  return best;
}

/**
 * Returns the chrome.tabGroups.move calls ({ groupId, index }) that pack groups
 * with a positive position against the left edge (after pinned tabs) and
 * groups with a negative one against the right edge. `positionOf(groupId)`
 * returns { position, rank } or null, where rank is the rule's place in the
 * list. Groups sharing a position follow rule order, then name.
 */
export function planOrder({ tabs, groups, positionOf }) {
  const sorted = [...tabs].sort((a, b) => a.index - b.index);
  const pinned = sorted.filter((t) => t.pinned).length;
  // The strip as a sequence of blocks; a run of ungrouped tabs is one NO_GROUP block.
  let strip = [];
  for (const t of sorted) if (!t.pinned && strip.at(-1) !== t.groupId) strip.push(t.groupId);

  const titleOf = new Map(groups.map((g) => [g.id, g.title ?? '']));
  const entries = [...new Set(strip)]
    .filter((id) => id !== NO_GROUP)
    .map((id) => ({ id, place: positionOf(id), title: titleOf.get(id) ?? '' }))
    .filter((e) => e.place != null);
  const byPosition = (a, b) =>
    a.place.position - b.place.position ||
    a.place.rank - b.place.rank ||
    a.title.localeCompare(b.title) ||
    a.id - b.id;
  const left = entries.filter((e) => e.place.position > 0).sort(byPosition).map((e) => e.id);
  const right = entries.filter((e) => e.place.position < 0).sort(byPosition).map((e) => e.id);

  const moves = [];
  if (!sameIds(strip.slice(0, left.length), left)) {
    for (const id of [...left].reverse()) moves.push({ groupId: id, index: pinned });
    strip = [...left, ...strip.filter((id) => !left.includes(id))];
  }
  if (right.length && !sameIds(strip.slice(-right.length), right)) {
    for (const id of right) moves.push({ groupId: id, index: -1 });
  }
  return moves;
}

function sameIds(a, b) {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function push(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function increment(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Starting points offered in the options page. All patterns run against the
// full URL, e.g. "https://mail.google.com:443/inbox".
export const TEMPLATES = {
  blank: { label: '', pattern: '', title: '', minTabs: 1 },
  localhost: {
    label: 'Localhost',
    pattern: '^https?://(?:localhost|127\\.0\\.0\\.1|\\[::1\\])[:/]',
    title: '💻',
    minTabs: 1,
  },
  lan: {
    label: 'LAN',
    pattern: '^https?://(?:10(?:\\.\\d{1,3}){3}|192\\.168(?:\\.\\d{1,3}){2}|172\\.(?:1[6-9]|2\\d|3[01])(?:\\.\\d{1,3}){2})[:/]',
    title: '🛜',
    minTabs: 1,
  },
  // New tab pages are left out; the newtab template handles them.
  chrome: {
    label: 'Chrome pages',
    pattern: '^chrome(?:-extension)?://(?!new-?tab)',
    title: '⚙️',
    minTabs: 1,
    position: -1,
  },
  newtab: {
    label: 'New tabs',
    pattern: '^(?:chrome://new-?tab|about:blank)',
    title: '🆕',
    minTabs: 1,
    position: -1,
  },
  hostname: {
    label: 'By hostname',
    pattern: '^https?://(?:www\\.)?(\\[[^\\]]+\\]|[^/:]+)',
    title: '$1',
    minTabs: 2,
  },
  // The domain name without subdomains or ending: mail.google.com and
  // www.google.de become "google", news.bbc.co.uk becomes "bbc". Knows common
  // two-part endings (co.uk, com.au, co.jp, …). IPs and localhost don't match.
  domain: {
    label: 'By domain name',
    pattern: '^https?://(?:[^/:]+?\\.)??([^./:]+)\\.(?:(?:co|com|net|org|gov|edu|ac|ne|or|go)\\.[a-z]{2}|[a-z]{2,}|xn--[a-z0-9-]+)[:/]',
    title: '$1',
    minTabs: 2,
  },
  subdomain: {
    label: 'By Subdomain',
    pattern: '^https?://([^./:]+)\\.example\\.com[:/]',
    title: '$1 ⭐',
    minTabs: 1,
  },
};
