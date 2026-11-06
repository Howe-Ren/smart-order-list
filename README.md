# Smart Order List

Smart Order List maintains ordered and nested list prefixes as you edit in Obsidian. It supports numbers, letters, Chinese numerals, bullets, and task checkboxes.

![Nested list prefixes in Live Preview](assets/3.0-live-preview.png)

## Features

- Continue and adjust list prefixes with Enter, Space, and Tab.
- Combine numeric and alphabetic elements in nested ordered prefixes.
- Use task checkboxes with ordered prefixes, including inside plain blockquotes.
- Choose between fixed and dynamic Reading-view indentation.
- Format a selection with the **Format smart list** command.

## Quick start

1. Type `1.` followed by a space, then enter an item.
2. Press Enter to start the next item.
3. Press Tab on a list item to nest it, or Shift+Tab to move it back.

For example, indenting the second item produces a nested prefix:

```text
1. Parent
    1.1 Child
```

You can also select existing list lines and run **Smart Order List: Format smart list** from the command palette. Formatting can change the prefixes in the Markdown source.

## Supported prefixes

| Type | Examples | Notes |
| --- | --- | --- |
| Numeric | `1.`, `1.1`, `1.1.1` | `0` can be introduced manually in all-numeric prefixes, subject to the ordering rules. |
| Alphabetic | `A.`, `a.`, `1.a` | Uppercase and lowercase letters each range from A to Z. |
| Parenthesized | `(1)` | Positive integers; one element per prefix. |
| Chinese | `一、`, `一百、` | From `一` through `一百`; one element per prefix. |
| Bullet and task | `-`, `- [ ]`, `- [x]` | Task checkboxes can be combined with ordered prefixes. |

Numeric and alphabetic elements can form ordered prefixes with up to four slots when the nesting rules allow. A single numeric or alphabetic element ends with a dot, such as `1.` or `a.`. In a multi-slot prefix, dots go only between elements: use `1.2`, not `1.2.`.

When a recognized ordered prefix exceeds its supported range or nesting rules, it can fall back to a bullet while retaining the line's indentation and content. For example, the item after `z.` falls back to a bullet.

## Indentation profiles

Choose a profile under **Settings → Smart Order List → Indentation Profile**:

| Profile | Live Preview | Reading view |
| --- | --- | --- |
| **Profile 1** (default) | Fixed indentation | Fixed indentation |
| **Profile 2** | Fixed indentation | Dynamic indentation based on parent prefixes |

## List shortcuts

Obsidian's **Toggle bullet list**, **Toggle numbered list**, and **Toggle checkbox status** commands work with the plugin's list prefixes. Assign shortcuts to those commands under **Settings → Hotkeys** if you want to use them.

## Known limitation

Nested lists inside callouts can still be misaligned in Live Preview.

## Installation

See the [release page](https://github.com/Howe-Ren/smart-order-list/releases) for installation instructions and downloadable plugin files.

## License

[Apache License 2.0](LICENSE)
