# Chrome Web Store listing: Tab Grouplet

Copy each block into the matching field of the Developer Dashboard.

## Store listing

**Name** (from `manifest.json`): Tab Grouplet

**Summary** (from `manifest.json`, max. 132 characters):

```text
Group tabs automatically with regex rules: custom names and emoji, colors, ordering and minimum tab counts.
```

**Description:**

```text
Too many tabs? Tab Grouplet keeps them organized for you. It puts every tab into the right Chrome tab group as you browse, based on a few rules you set up once. You always know where things are, and you stop hunting through a crowded tab bar.

WHAT IT DOES
Each rule looks at a tab's web address. When a tab matches, Tab Grouplet moves it into a group with the name, emoji, color and place in the tab bar that you chose. Open another page from the same site or project and it joins the group automatically. When the matching tabs are closed, the group goes away again.

WHY INSTALL IT
• No more sorting tabs by hand: groups build themselves while you work.
• Find things at a glance: one group per project, website or topic, with clear names and colors.
• A tab bar that stays in order: choose where groups appear, for example Chrome's settings pages and new tabs always on the right.
• Less clutter: group only once 2 or more matching tabs are open, so single tabs stay as they are.
• You stay in control: groups you create yourself are never touched, and one click pauses everything.

TEMPLATES TO START WITH
Ready-made rules for local development servers, devices on your home network, Chrome's own pages, new tabs, one group per website, one group per domain, and one group per subdomain. Use them as they are, adjust them, or write your own.

FOR POWER USERS
Rules use regular expressions, so you can match exactly what you need, ports included. Turn parts of the address into the group name with $1 or named captures, preview the groups your open tabs would form before you save, test any address, and import or export your rules.

PRIVATE BY DESIGN
Tab Grouplet works entirely inside your browser. It makes no network requests, and nothing is collected, tracked or shared.
Privacy policy: https://github.com/codejo-dev/TabGrouplet/blob/main/PRIVACY.md

FREE AND OPEN SOURCE
MIT licensed. Source code and feedback: https://github.com/codejo-dev/TabGrouplet
```

**Category:** Productivity → Workflow & Planning

**Language:** English

**Graphics** (in this folder):

| Field              | File                                                    |
| ------------------ | ------------------------------------------------------- |
| Store icon         | `../icons/icon128.png`                                  |
| Screenshots        | `screenshot-1-tab-groups.png` … `screenshot-5-popup.png` |
| Small promo tile   | `promo-small-440x280.png`                               |
| Marquee promo tile | `promo-marquee-1400x560.png`                            |

**Homepage URL:** https://github.com/codejo-dev/TabGrouplet

**Support URL:** https://github.com/codejo-dev/TabGrouplet/issues

## Privacy practices

**Single purpose:**

```text
Tab Grouplet automatically organizes the user's browser tabs into tab groups according to URL rules the user defines, with custom group names, colors, order and minimum tab counts.
```

**Permission justifications:**

`tabs`

```text
Reads the URL and title of open tabs to match them against the user's grouping rules and to show matching tabs in the rule preview. URLs are only processed locally and never leave the browser.
```

`tabGroups`

```text
Creates, names, colors, moves and dissolves tab groups according to the user's rules.
```

`storage`

```text
Saves the user's rules and the on/off setting locally in the browser, and remembers which tab groups the extension created during the current session.
```

**Remote code:** No, I am not using remote code.

**Data usage:**

- Tick **Web history**. The extension reads tab URLs and titles to apply your rules. The Chrome Web Store asks for this even when, as here, the data is only processed locally and never transmitted.
- Leave all other categories unticked.
- Tick all three statements: data is not sold to third parties, not used or transferred for purposes unrelated to the single purpose, and not used to determine creditworthiness or for lending.

**Privacy policy URL:** https://github.com/codejo-dev/TabGrouplet/blob/main/PRIVACY.md
