// Small DOM helpers shared by the options page and the popup.

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
}

// A tab-group label as Chrome draws it. An empty color means "picked automatically".
export function groupChip(title, color, { count, dim = false, tooltip } = {}) {
  const classes = ['chip', color ? `c-${color}` : 'auto'];
  if (!title) classes.push('untitled');
  if (dim) classes.push('dim');
  return el(
    'span',
    { class: classes.join(' '), title: tooltip ?? (title || 'Untitled group') },
    title ? el('span', { class: 'chip-title' }, title) : null,
    count != null && title ? el('span', { class: 'count' }, String(count)) : null,
  );
}

export function ruleName(rule) {
  return rule.label || rule.pattern || 'Untitled rule';
}
