# HTML Note

**Your workflow's documentation lives in the workflow. One `.json` file, self-contained.**

A ComfyUI note node that renders **HTML** instead of plain text - so parameter tables,
node-by-node walkthroughs, before/after comparisons and index cards render the way you wrote
them, right on the canvas, next to the nodes they describe.

```
built-in Note:    "lr 0.8 / steps 22 / sampler euler ... readable?"
HTML Note:        <table> + colours + text + links, i.e. an actual document
```

The HTML is stored **inside the node**, so it saves with the workflow and travels with it.
Copy the `.json` to another machine and the documentation still renders. No `README.md`, no
`notes.txt`, no external file, no path that only exists on your disk.

> This started as a note plugin, so the docs first. Because the iframe is same-origin
> (`srcdoc`, no `sandbox`), scripts do run - which also makes it usable as a small browser
> for interactive things. That is a bonus, not the point.

---

## Why this exists

ComfyUI ships with a `Note` node, and it is fine for three words. The moment a workflow needs
real documentation it falls apart:

- A parameter table becomes a wall of unreadable text.
- A "what each node does" list has no structure - no headings, no tables, no alignment.
- The usual workaround is a `README.md` / `notes.txt` saved somewhere next to the `.json`.
  That means: the docs are **no longer in the canvas**, you have to go find them; and the
  workflow you send to someone else arrives **completely undocumented**.

**This plugin exists so that a workflow can carry its own documentation.**

One `.json` = the graph *and* the explanation of the graph. You save with `Ctrl+S` and it is
there forever. You send the file to a friend, a client, or a forum post, and the explanation
travels inside it.

That is the whole point. The HTML-in-iframe part is just what makes a long text readable.

### What you get

| | |
|---|---|
| **Readable long text** | Real HTML: tables, headings, `<details>`, images, links, code blocks. |
| **Portable** | Content is in the node -> in the `.json` -> moves with the workflow. |
| **Zero cost** | No Python dependencies, no models, no VRAM, never runs during queueing. |
| **Editable in place** | Toggle *Source* on the node, edit, toggle back to *Preview*. |
| **Reusable content** | Feed it from an upstream *String (multiline)* note - one source text used by many nodes. |
| **Bonus: runs JS** | No `sandbox` -> canvas animations, scripts, a small game all work. |

---

## Install

ComfyUI-Manager: search **HTML Note**.

Or via CLI:

```
comfy node install html-note
```

Restart ComfyUI after installing (custom nodes are imported once at startup).
No models, no extra Python packages, no downloads.

---

## Usage - 4 steps

1. Right-click the canvas -> *Add Node* -> search `HTML Note`. It sits under **Notes**.
2. Either paste HTML into the source box, or drag a *String (multiline)* note onto the
   canvas and connect its output to the node's **`html`** input.
3. Use the toolbar: **Enlarge** (fullscreen), **Reload** (re-read), **Preview / Source** switch.
4. Save the workflow (`Ctrl+S`). That's it - the HTML now lives in the file.

### Filling it: two ways

**A. Type directly in the node (simplest).**

Paste a snippet:

```html
<h2>How to pick a sampler</h2>
<table>
  <tr><th>Sampler</th><th>Good for</th></tr>
  <tr><td>euler</td><td>Everyday generation, stable</td></tr>
  <tr><td>dpmpp_2m</td><td>More detail</td></tr>
</table>
```

or a whole document (starting with `<!doctype` / `<html` is passed through untouched, so you
can keep your own `<style>`).

**B. From an upstream node (content reuse).**

Put the HTML in a *String (multiline)* note, connect it to the `html` input.

- The preview **updates live** - no queueing, no running the graph.
- The node's source box lights up read-only and shows *From upstream #N (read-only)*.
- The node stores **no copy** of the text; the upstream note is the single source of truth
  (and still travels inside the json).
- Pull the cable and it becomes editable again.

> Why does the linked content get read from the graph instead of through execution?
> This node has no output and doesn't run, so ComfyUI prunes it - and its upstream note - out
> of the execution graph. The value never reaches the node at run time. The frontend reads the
> upstream's `widgets_values` from `app.graph` directly, so it works without pressing Run.

### The `height` widget

Height of the widget area, 120-8000, default 420. Changing the number takes effect
immediately; you can also just drag the node's bottom edge. `height` counts the whole widget
area, so the preview iframe is roughly `height` - toolbar height. For very long docs use
**Enlarge**.

### The toolbar

| Button | Does |
|---|---|
| Enlarge | Fullscreen overlay - best for reading long docs. `Esc` or click the backdrop closes. |
| Reload | Re-reads the content and re-renders. Also logs `len` / `propLen` to the console. |
| Preview / Source | Rendered view <-> editable source. |

---

## Why HTML and not Markdown

Markdown nodes exist, and they are a fine choice for a pure text description. HTML was picked
for three practical reasons:

1. **One pass, no toolchain.** Markdown-to-HTML needs a Python package (`markdown`) on the
   receiving machine; the html is just a string here.
2. **A ComfyUI note is rarely just text.** Parameter tables, two-column comparisons, a
   screenshot with a caption, a collapsible section - all of that is `<table>`/`<details>`,
   and all of it is painful in Markdown and trivial in HTML.
3. **It is a document, not a code block.** The rendering follows ComfyUI's own theme
   variables, so it stays readable in both dark and light mode.

If you want a rich *editor* with preview/syntax highlighting and you don't need scripts,
install one of the Markdown nodes in the table below - they are better at that.

---

## Running scripts (the bonus)

The iframe uses `srcdoc` **without** `sandbox`, so it behaves like the same page: `canvas`,
JS and keyboard all work. Paste an interactive demo (a small game, a chart, a form) and it
just runs.

Three things were needed to make that usable inside ComfyUI:

1. **Keyboard focus is sent into the iframe** on click and on every re-render - focus defaults
   to the outer canvas, so without this the keys do nothing.
2. **Space / arrow keys are `preventDefault`ed** (capture, without `stopPropagation`, so your
   own `keydown` still fires) - otherwise the canvas pans and the page scrolls.
3. **Enlarge** focuses the iframe too, so fullscreen mode is playable.

Runtime state (score, progress) is not saved - only the source travels with the json.
Don't paste HTML you don't trust: it executes as the same origin.

---

## If you already have an .html file

```bash
node tools/inject_html.js <workflow.json> <doc.html> [--node <id>] [--title Note] [--height 420]
```

Picks up the last HTML Note in the workflow, or creates one. The original json is backed up
to `.bak_YYYYMMDD_HHMM`. Only rewrites text - it doesn't talk to a running ComfyUI.
Needs Node 18+.

---

## Troubleshooting

**Source box has content but preview is empty.**
`html` is declared as a `multiline` STRING, so ComfyUI generates *its own* native textarea on
top of the one this plugin draws. Two boxes, two unrelated strings - paste in one, the other
never sees it. This plugin hides that native box and syncs it bidirectionally, so there is
only one source box. If you still see two:

1. Hard refresh the browser: **`Ctrl+Shift+R`**. Frontend extensions are static files.
2. There must be exactly **one** textarea, directly under the toolbar. A big block above it
   means the old frontend version is cached.
3. Hit **Reload** - it re-reads from the node properties/widgets and logs `len`, `propLen`,
   `widgetType` in the console (`F12`) so you can see where the content actually is.
4. Save with `Ctrl+S`, otherwise a refresh throws it away.

**`height` changes but the box doesn't resize.**
Fixed in the shipped version. The number widget's callback lives on `widget.callback` (and on
DOM events), not on `widget.onChange`, so an implementation that only wrapped `onChange`
wired nothing up. The current code reads the value on every `computeSize` and hooks
`onChange` + `callback` + `input/change/mouseup`.

**Top half of the node is black / empty.**
ComfyUI 1.53+ positions DOM widgets in a `position:fixed` `.dom-widget` layer whose offset is
accumulated from every widget's `computedHeight`. A `display:none` widget **still takes
space**, which pushed the view down. The hidden native box now reports `0`.

**Images 404.**
Inside the iframe, relative paths resolve against the ComfyUI site root. Use absolute URLs
or base64.

---

## Choose the right plugin

There are already several "HTML/Markdown note" nodes in the ecosystem. Pick by need:

| Plugin | Install | Renders | Runs JS | With the json | Note |
|---|---|---|---|---|---|
| **HTML Note** (this) | Manager: *HTML Note* | HTML, themed | **yes** | yes | The one that runs scripts. |
| Note+ (`Note Plus (mtb)`) | Manager: *comfy-mtb* (`mtb/utils`) | HTML + Markdown + CSS | no (DOMPurify) | yes | Nicest editor: ACE, Shiki, themes. Likely needs the legacy canvas on 1.53.x. |
| AF - Enhanced HTML Note | Manager | Rich HTML | no | yes | The "pretty sticky note", double-click to edit. |
| ComfyUI_Viewer | Manager | HTML/SVG/Markdown, sandbox | no | yes | Edit / download / fullscreen, sandbox-isolated. |
| ComfyUI-Notebook -> `PreviewHTML` | github liusida/ComfyUI-Notebook | HTML | **yes** | yes | The other script-running option. |
| LiteLLM -> `MarkdownNode` / daz-tools -> `Markdown Display` | Manager | Markdown | no | yes | Plain display, needs `pip install markdown`. |

- **Need scripts / canvas / a game** -> this plugin or `PreviewHTML`, everything else is
  sanitised or sandboxed.
- **Just want pretty text with a good editor** -> Note+ or AF Enhanced HTML Note.
- **You send the json to other people** -> this node's type is custom (`HTMLNote`); without
  this plugin they see a red missing node. The others are community-standard types, so the
  recipient only needs one of them installed. That is the one real trade-off here.
- **Watch out for name collisions**: if another package also registers a node named
  `HTMLNote`, only one of them wins (whichever loads last), and the node category in the log
  tells you which. Renaming the type is the only real fix, at the cost of migrating saved
  workflows.

---

## Limitations

- **Upstream must be a node whose value always exists** (a note, a text combine). A node that
  only produces a string at run time can't be read this way - use way A instead.
- Scripts run (no sandbox): the iframe cannot reach ComfyUI's JS context. Use `postMessage`
  if you need to talk to the page.
- Very long documents: keep the `height` manageable or open fullscreen.

---

## License

MIT (c) 2026 silno
