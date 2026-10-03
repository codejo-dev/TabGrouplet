import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  NO_GROUP,
  compileRules,
  createRule,
  matchUrl,
  normalizeRule,
  planOrder,
  planWindow,
  TEMPLATES,
  renderTitle,
} from '../src/core.js';

let nextTabId = 1;
const tab = (url, fields = {}) => ({ id: nextTabId++, url, groupId: NO_GROUP, pinned: false, windowId: 1, ...fields });
const indexed = (tabs) => tabs.map((t, index) => ({ ...t, index }));
const rule = (fields) => createRule(fields);

test('renderTitle expands numbered, named, whole-match and escaped tokens', () => {
  const m = /(?<sub>[^.]+)\.(example)\.com/.exec('api.example.com');
  assert.equal(renderTitle('$1 ⭐', m), 'api ⭐');
  assert.equal(renderTitle('$<sub>/$2', m), 'api/example');
  assert.equal(renderTitle('[$&]', m), '[api.example.com]');
  assert.equal(renderTitle('$$5 $7', m), '$5');
  assert.equal(renderTitle('💻', m), '💻');
});

test('matchUrl tests the full URL and uses the first matching rule', () => {
  const rules = [
    rule({ pattern: '^https?://([^./:]+)\\.corp\\.com[:/]', title: '$1 🏢' }),
    rule({ pattern: '^https?://([^/]+)', title: '$1' }),
  ];
  const compiled = compileRules(rules);
  assert.equal(matchUrl(compiled, 'https://wiki.corp.com/page').title, 'wiki 🏢');
  assert.equal(matchUrl(compiled, 'https://github.com/x').title, 'github.com');
  assert.equal(matchUrl(compiled, 'https://github.com/x').rule, rules[1]);
  assert.equal(matchUrl(compiled, 'chrome://newtab/'), null);
});

test('matching ignores case', () => {
  const compiled = compileRules([rule({ pattern: 'github\\.com/MyOrg', title: 'org' })]);
  assert.equal(matchUrl(compiled, 'https://github.com/myorg/repo').title, 'org');
});

test('the domain template keeps only the domain name', () => {
  const compiled = compileRules([rule(TEMPLATES.domain)]);
  const name = (host) => matchUrl(compiled, `https://${host}/some.path.com/`)?.title ?? null;
  const cases = {
    'google.com': 'google',
    'www.google.de': 'google',
    'mail.google.com': 'google',
    'a.b.c.google.com': 'google',
    'www.google.co.jp': 'google',
    'news.bbc.co.uk': 'bbc',
    'bbc.co.uk': 'bbc',
    'example.com.au': 'example',
    'blog.go.dev': 'go',
    'en.m.wikipedia.org': 'wikipedia',
    't.co': 't',
    'xn--80ak6aa92e.xn--p1ai': 'xn--80ak6aa92e',
    'example.com:8443': 'example',
    localhost: null,
    '127.0.0.1': null,
    '10.0.0.12': null,
  };
  for (const [host, expected] of Object.entries(cases)) assert.equal(name(host), expected, host);
  assert.equal(matchUrl(compiled, 'chrome://newtab/')?.title ?? null, null);
});

test('the URL templates match what their descriptions promise', () => {
  const title = (template, url) => matchUrl(compileRules([rule(TEMPLATES[template])]), url)?.title ?? null;
  assert.equal(title('localhost', 'http://localhost:3000/a'), '💻');
  assert.equal(title('localhost', 'http://127.0.0.1:8080/'), '💻');
  assert.equal(title('localhost', 'http://[::1]:5173/'), '💻');
  assert.equal(title('localhost', 'http://localhost.evil.com/'), null);
  assert.equal(title('hostname', 'https://www.github.com/x'), 'github.com');
  assert.equal(title('hostname', 'https://docs.github.com/x'), 'docs.github.com');
  assert.equal(title('hostname', 'http://[::1]:5173/'), '[::1]');
  assert.equal(title('subdomain', 'https://api.example.com/v1'), 'api ⭐');
  assert.equal(title('subdomain', 'https://example.com.evil.net/'), null);
  assert.equal(title('lan', 'http://192.168.178.1/'), '🛜');
  assert.equal(title('lan', 'http://10.0.0.12:8080/x'), '🛜');
  assert.equal(title('lan', 'http://172.20.1.1/'), '🛜');
  assert.equal(title('lan', 'http://172.32.1.1/'), null);
  assert.equal(title('lan', 'http://10.0.0.12.evil.com/'), null);
  assert.equal(title('chrome', 'chrome://settings/'), '⚙️');
  assert.equal(title('chrome', 'chrome-extension://abc/page.html'), '⚙️');
  assert.equal(title('chrome', 'chrome://newtab/'), null);
  assert.equal(title('newtab', 'chrome://newtab/'), '🆕');
  assert.equal(title('newtab', 'chrome://new-tab-page/'), '🆕');
  assert.equal(title('newtab', 'about:blank'), '🆕');
  assert.equal(title('newtab', 'chrome://settings/'), null);
  assert.equal(title('newtab', 'https://example.com/about:blank'), null);
});

test('templates leave the color on auto; Chrome pages and new tabs go last', () => {
  for (const [name, template] of Object.entries(TEMPLATES)) assert.equal(rule(template).color, '', name);
  assert.equal(rule(TEMPLATES.chrome).position, -1);
  assert.equal(rule(TEMPLATES.newtab).position, -1);
});

test('disabled and invalid rules are skipped', () => {
  const compiled = compileRules([
    rule({ pattern: 'github', enabled: false }),
    rule({ pattern: '(unclosed' }),
    rule({ pattern: 'git', title: 'ok' }),
  ]);
  assert.equal(compiled.length, 1);
  assert.equal(matchUrl(compiled, 'https://github.com').title, 'ok');
});

test('normalizeRule clamps numbers and drops unknown colors', () => {
  const r = normalizeRule({ minTabs: '0', position: '0', color: 'magenta', target: 'hostname' });
  assert.equal(r.minTabs, 1);
  assert.equal(r.position, null);
  assert.equal(r.color, '');
  assert.equal('target' in r, false);
  assert.equal(normalizeRule({ position: '-2' }).position, -2);
});

test('groups tabs with the same rendered name and leaves others alone', () => {
  const localhost = rule(TEMPLATES.localhost);
  const tabs = indexed([
    tab('http://localhost:3000/'),
    tab('https://example.com/'),
    tab('http://localhost:8080/'),
  ]);
  const plan = planWindow({ tabs, groups: [], managed: {}, compiled: compileRules([localhost]) });
  assert.deepEqual(plan.ungroup, []);
  assert.equal(plan.ops.length, 1);
  assert.equal(plan.ops[0].groupId, null);
  assert.deepEqual(plan.ops[0].addTabIds, [tabs[0].id, tabs[2].id]);
  assert.equal(plan.ops[0].update.title, '💻');
});

test('a capture in the name makes one group per distinct value', () => {
  const byHost = rule({ pattern: '^https?://([^/]+)', title: '$1' });
  const tabs = indexed([tab('https://a.com/1'), tab('https://b.com/1'), tab('https://a.com/2')]);
  const plan = planWindow({ tabs, groups: [], managed: {}, compiled: compileRules([byHost]) });
  assert.deepEqual(plan.ops.map((o) => o.update.title), ['a.com', 'b.com']);
});

test('minTabs holds a group back until enough tabs match, then dissolves it again', () => {
  const r = rule({ pattern: 'github', title: 'gh', minTabs: 3 });
  const compiled = compileRules([r]);
  const two = indexed([tab('https://github.com/1'), tab('https://github.com/2')]);
  assert.equal(planWindow({ tabs: two, groups: [], managed: {}, compiled }).ops.length, 0);

  const grouped = indexed([
    tab('https://github.com/1', { groupId: 7 }),
    tab('https://github.com/2', { groupId: 7 }),
  ]);
  const managed = { 7: { key: `${r.id}\u0001gh`, ruleId: r.id } };
  const plan = planWindow({ tabs: grouped, groups: [{ id: 7, title: 'gh', color: 'blue' }], managed, compiled });
  assert.deepEqual(plan.ungroup, grouped.map((t) => t.id));
  assert.equal(plan.ops.length, 0);
});

test("tabs in the user's own groups are never touched", () => {
  const r = rule({ pattern: 'github', title: 'gh' });
  const tabs = indexed([tab('https://github.com/1', { groupId: 9 }), tab('https://github.com/2')]);
  const groups = [{ id: 9, title: 'my stuff', color: 'red' }];
  const plan = planWindow({ tabs, groups, managed: {}, compiled: compileRules([r]) });
  assert.deepEqual(plan.ops[0].addTabIds, [tabs[1].id]);
  assert.deepEqual(plan.adopt, []);
});

test('an owned group keeps its spot and color when its name changes', () => {
  const r = rule({ pattern: '^https?://([^/]+)', title: '$1' });
  const tabs = indexed([tab('https://b.com/', { groupId: 4 })]);
  const managed = { 4: { key: `${r.id}\u0001a.com`, ruleId: r.id } };
  const plan = planWindow({ tabs, groups: [{ id: 4, title: 'a.com', color: 'cyan' }], managed, compiled: compileRules([r]) });
  assert.equal(plan.ops.length, 1);
  assert.equal(plan.ops[0].groupId, 4);
  assert.deepEqual(plan.ops[0].update, { title: 'b.com' });
  assert.deepEqual(plan.ungroup, []);
});

test('a matching owned group with nothing to change produces no work', () => {
  const r = rule({ pattern: 'github', title: 'gh', color: 'blue' });
  const tabs = indexed([tab('https://github.com/1', { groupId: 3 })]);
  const managed = { 3: { key: `${r.id}\u0001gh`, ruleId: r.id } };
  const plan = planWindow({ tabs, groups: [{ id: 3, title: 'gh', color: 'blue' }], managed, compiled: compileRules([r]) });
  assert.deepEqual(plan, { ungroup: [], ops: [], adopt: [] });
});

test('automatic colors avoid colors already used in the window', () => {
  const r = rule({ pattern: '^https?://([^/]+)', title: '$1' });
  const groups = [
    { id: 1, title: 'mine', color: 'blue' },
    { id: 2, title: 'other', color: 'red' },
  ];
  const tabs = indexed([
    tab('https://x.org/', { groupId: 1 }),
    tab('https://y.org/', { groupId: 2 }),
    tab('https://a.com/'),
    tab('https://b.com/'),
  ]);
  const plan = planWindow({ tabs, groups, managed: {}, compiled: compileRules([r]) });
  assert.deepEqual(plan.ops.map((o) => o.update.color), ['green', 'yellow']);
});

test('fixed colors are counted before automatic ones are picked', () => {
  const fixed = rule({ pattern: 'fixed', title: 'F', color: 'blue' });
  const auto = rule({ pattern: 'auto', title: 'A' });
  const tabs = indexed([tab('https://auto.com/'), tab('https://fixed.com/')]);
  const plan = planWindow({ tabs, groups: [], managed: {}, compiled: compileRules([fixed, auto]) });
  const colors = Object.fromEntries(plan.ops.map((o) => [o.update.title, o.update.color]));
  assert.deepEqual(colors, { A: 'red', F: 'blue' });
});

test('untracked groups that look like ours are adopted after a restart', () => {
  const r = rule({ pattern: 'github', title: 'gh' });
  const tabs = indexed([tab('https://github.com/1', { groupId: 12 }), tab('https://github.com/2')]);
  const plan = planWindow({ tabs, groups: [{ id: 12, title: 'gh', color: 'pink' }], managed: {}, compiled: compileRules([r]) });
  assert.deepEqual(plan.adopt.map((a) => a.groupId), [12]);
  assert.equal(plan.ops[0].groupId, 12);
  assert.deepEqual(plan.ops[0].addTabIds, [tabs[1].id]);
});

test('pinned tabs are ignored', () => {
  const r = rule({ pattern: 'github', title: 'gh' });
  const tabs = indexed([tab('https://github.com/1', { pinned: true })]);
  assert.equal(planWindow({ tabs, groups: [], managed: {}, compiled: compileRules([r]) }).ops.length, 0);
});

test('planOrder packs positive positions left and negative ones right', () => {
  // strip: pinned | A A | u | B | C C | u
  const tabs = indexed([
    tab('p', { pinned: true }),
    tab('a', { groupId: 10 }),
    tab('a', { groupId: 10 }),
    tab('u'),
    tab('b', { groupId: 20 }),
    tab('c', { groupId: 30 }),
    tab('c', { groupId: 30 }),
    tab('u'),
  ]);
  const groups = [10, 20, 30].map((id) => ({ id, title: `g${id}` }));
  const positions = { 10: 2, 20: 1, 30: -1 };
  const moves = planOrder({ tabs, groups, positionOf: (id) => (id in positions ? { position: positions[id], rank: 0 } : null) });
  assert.deepEqual(moves, [
    { groupId: 10, index: 1 },
    { groupId: 20, index: 1 },
    { groupId: 30, index: -1 },
  ]);
});

test('planOrder does nothing when the order is already right', () => {
  const tabs = indexed([tab('b', { groupId: 20 }), tab('a', { groupId: 10 }), tab('u'), tab('c', { groupId: 30 })]);
  const groups = [10, 20, 30].map((id) => ({ id, title: '' }));
  const positions = { 20: 1, 10: 2, 30: -1 };
  const positionOf = (id) => (id in positions ? { position: positions[id], rank: 0 } : null);
  assert.deepEqual(planOrder({ tabs, groups, positionOf }), []);
});

test('planOrder sorts groups from the same rule and position by name', () => {
  const tabs = indexed([tab('z', { groupId: 2 }), tab('a', { groupId: 1 })]);
  const groups = [{ id: 1, title: 'alpha' }, { id: 2, title: 'zulu' }];
  const moves = planOrder({ tabs, groups, positionOf: () => ({ position: 1, rank: 0 }) });
  assert.deepEqual(moves, [{ groupId: 2, index: 0 }, { groupId: 1, index: 0 }]);
});

test('planOrder breaks position ties by rule order, so the later rule ends up last', () => {
  // ⚙️ (rule 0) and 🆕 (rule 1) both use -1; 🆕 must be rightmost.
  const tabs = indexed([tab('u'), tab('n', { groupId: 2 }), tab('c', { groupId: 1 })]);
  const groups = [{ id: 1, title: '⚙️' }, { id: 2, title: '🆕' }];
  const rank = { 1: 0, 2: 1 };
  const moves = planOrder({ tabs, groups, positionOf: (id) => ({ position: -1, rank: rank[id] }) });
  assert.deepEqual(moves, [{ groupId: 1, index: -1 }, { groupId: 2, index: -1 }]);
});
