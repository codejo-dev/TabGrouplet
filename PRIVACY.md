# Privacy Policy: Tab Grouplet

_Last updated: October 3, 2026_

Tab Grouplet is a Chrome extension published by codejo.dev. It groups your browser tabs according to rules you define.

**In short: Tab Grouplet does not collect, transmit, sell or share any personal data. Everything it works with stays in your browser on your device.**

## What the extension reads

To group your tabs, the extension reads the following inside your browser:

- **Tab URLs**, to check them against your rules.
- **Tab titles**, only to show example tabs in the rule preview on the extension's settings page.
- **Tab state** needed for grouping: which window a tab is in, its position, whether it is pinned, and which group it belongs to.
- **Tab group names and colors**, to manage the groups the extension created and to pick colors not already in use.

This information is processed in memory when your tabs change. It is not logged, not stored, and never leaves your browser.

## What the extension stores

- **Your rules and the on/off setting**, in Chrome's local extension storage (`chrome.storage.local`) on your device. They are not synced to your Google account.
- **The IDs of the tab groups the extension created**, in Chrome's session storage (`chrome.storage.session`). This is cleared when you close the browser.

Uninstalling the extension deletes all of this data.

## What the extension does not do

- It makes **no network requests**. There are no servers, analytics, tracking, advertising, cookies or third-party services.
- It does not load or run remote code.
- It does not sell, share or transfer data to anyone, and does not use data for purposes unrelated to grouping your tabs.

The use of information received from Chrome APIs adheres to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including the Limited Use requirements.

## Import and export

**Export** creates a JSON file with your rules only when you click it, and saves it where you choose. **Import** reads only a file you select yourself. These files contain your rules and nothing else.

## Permissions

| Permission  | Why it is needed                                             |
| ----------- | ------------------------------------------------------------ |
| `tabs`      | Read tab URLs and titles to match them against your rules.   |
| `tabGroups` | Create, name, color and move tab groups.                     |
| `storage`   | Save your rules on your device.                              |

## Changes to this policy

Changes are published in this file with a new date. The full history is available in this repository.

## Contact

For questions about this policy, open an issue at <https://github.com/codejo-dev/TabGrouplet/issues>.
