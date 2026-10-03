import { NO_GROUP, compileRules, hostnameOf, matchUrl, normalizeRule, tabUrl } from '../src/core.js';
import { el, groupChip, ruleName } from '../src/ui.js';

const $ = (selector) => document.querySelector(selector);
const send = (type) => chrome.runtime.sendMessage({ type });

async function render() {
  const [{ rules = [], paused = false }, [tab], status] = await Promise.all([
    chrome.storage.local.get(['rules', 'paused']),
    chrome.tabs.query({ active: true, currentWindow: true }),
    send('status'),
  ]);
  const normalized = rules.map(normalizeRule);

  $('#active').checked = !paused;
  const state = $('#state');
  state.className = `state${paused ? ' paused' : ''}`;
  if (paused) state.textContent = 'Paused: tabs are not being grouped.';
  else {
    const n = status?.managedGroups ?? 0;
    const active = normalized.filter((r) => r.enabled).length;
    state.textContent = `${active} active rule${active === 1 ? '' : 's'} · ${n} group${n === 1 ? '' : 's'} managed`;
  }

  $('#current').replaceChildren(...(await describeTab(tab, normalized)).filter(Boolean));
}

async function describeTab(tab, rules) {
  if (!tab) return ['No active tab.'];
  const url = tabUrl(tab);
  const m = matchUrl(compileRules(rules), url);
  if (tab.pinned) return [el('span', { class: 'note' }, 'Pinned tabs are never grouped.')];
  if (m) {
    // An automatic color is only known once the group exists.
    let color = m.rule.color;
    if (!color && tab.groupId !== NO_GROUP) color = (await chrome.tabGroups.get(tab.groupId).catch(() => null))?.color ?? '';
    const nodes = [
      el('div', { class: 'line' }, 'Group', groupChip(m.title, color)),
      el('div', { class: 'note' }, `Rule ${rules.indexOf(m.rule) + 1}: ${ruleName(m.rule)}`),
    ];
    if (m.rule.minTabs > 1) nodes.push(el('div', { class: 'note' }, `Groups once ${m.rule.minTabs} matching tabs are open`));
    return nodes;
  }
  const host = /^https?:/.test(url) ? hostnameOf(url) : '';
  return [
    el('div', { class: 'note' }, 'No rule matches this tab.'),
    host ? el('button', { type: 'button', onclick: () => openOptions(`#add=${encodeURIComponent(host)}`) }, `+ Rule for ${host.replace(/^www\./, '')}`) : null,
  ];
}

function openOptions(hash = '') {
  if (!hash) chrome.runtime.openOptionsPage();
  else chrome.tabs.create({ url: chrome.runtime.getURL(`options/options.html${hash}`) });
  window.close();
}

$('#active').addEventListener('change', (event) => chrome.storage.local.set({ paused: !event.target.checked }));
$('#regroup').addEventListener('click', async () => {
  await chrome.storage.local.set({ paused: false });
  await send('regroup');
  setTimeout(render, 400);
});
$('#ungroup').addEventListener('click', async () => {
  await send('ungroupAll');
  render();
});
$('#settings').addEventListener('click', () => openOptions());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') render();
});

$('#version').textContent = `v${chrome.runtime.getManifest().version}`;
render();
