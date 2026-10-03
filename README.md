# Tab Grouplet

A Chrome extension that groups tabs automatically with regular-expression rules.

- **Match** a regex against the tab's full URL (including the port, e.g. `http://localhost:3000/`). Matching ignores upper/lower case.
- **Name** the group with a template: `$1`, `$<name>` and `$&` pull in parts of the match, and emoji work anywhere (`$1 🚀`, `💻`).
- **Color**: pick one of Chrome's nine group colors, or leave it on *Auto* to get the color least used in the window.
- **Threshold**: only group once *N* matching tabs are open in a window. The group dissolves again when the count drops below *N*.
- **Position** (optional): `1` = leftmost group, `2` = next, …; `-1` = rightmost, `-2` = second from right. Ties follow the rule order.

## Install

1. Open `chrome://extensions` and switch on **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. The rules page opens. Add a rule from a template, adjust it, and click **Save**.

No build step and no dependencies are needed. Requires Chrome 102 or later.

## How grouping works

- Rules are checked from top to bottom, and the **first match wins**. Drag rules to change their priority.
- Tabs from the same rule whose **group names come out the same** share a group. A fixed name (`💻`) collects every match into one group, while a capture (`$1`) makes one group per distinct value.
- Pinned tabs are never grouped.
- Tab Grouplet **owns the groups it creates**: it keeps them in sync with the rules, so a tab you drag out goes back on the next tab change in that window. **Groups you create yourself are never touched.**
- After a browser restart, existing groups whose name and tabs match a rule are adopted again instead of duplicated.
- The toolbar popup shows which rule the current tab matches. From there you can pause, regroup, ungroup everything the extension manages, or add a rule for the current site.

## Examples

| Pattern                                       | Name        | Result                                   |
| --------------------------------------------- | ----------- | ---------------------------------------- |
| `^https?://([^./:]+)\.corp\.example\.com[:/]`  | `$1 🏢`     | `wiki 🏢`, `jira 🏢`, …                   |
| `^https?://(?:localhost\|127\.0\.0\.1)[:/]`   | `💻`        | every local dev tab in one group         |
| `^https?://localhost:(\d+)`                   | `💻 $1`     | one group per port: `💻 3000`, `💻 8080`  |
| `^https?://(?:www\.)?([^/:]+)`                | `$1`        | one group per hostname                   |
| *“By domain name” template*                   | `$1`        | `google` for mail.google.com and google.de, `bbc` for news.bbc.co.uk |
| `github\.com/(?<org>[^/]+)`                   | `🐙 $<org>` | one group per GitHub org                 |

Rules can be exported to JSON and imported from the rules page.

## Development

```
manifest.json
src/core.js         rule model, matching, name templates, grouping/ordering planners (no Chrome APIs)
src/background.js   service worker: listens to tab events and applies the plans
src/theme.css, ui.js shared styles and DOM helpers
options/            rules editor (live preview against open tabs, URL tester)
popup/              toolbar popup
scripts/make-icons.py  regenerates icons/ (needs Pillow)
scripts/store-assets.mjs  regenerates the Chrome Web Store images in store/ (needs Chrome)
store/              store images and listing texts (listing.md)
```

Run the unit tests (Node 18+):

```
npm test
```

## Privacy

Tab Grouplet does not collect or transmit any data. Your rules are stored only in your browser. See [PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE) © 2026 codejo.dev
