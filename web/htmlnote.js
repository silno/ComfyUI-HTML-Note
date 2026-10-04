import { app } from "../../scripts/app.js";

  /* ComfyUI-HTML-Note frontend: renders an HTML string into a same-origin iframe.

     Where the content comes from (highest priority first):
     1) Upstream link: when the html input is connected (e.g. to a String (multiline) note),
     the upstream node's widgets_values are read straight from the graph - no execution, no queueing,
     so updates are visible live without pressing Run.
     2) This node's own input area: paste HTML here when nothing is connected.
     3) node.properties.html (fallback, covers json restore timing).

     v4 fix: the code used to look at this node's own textarea only, so once a link was plugged in
     the node kept showing the INPUT_TYPES default placeholder, which looks like "the link does nothing".
     Links now win, and the hidden native multiline textarea follows the upstream value. */

const NS = "htmlnote";

function cssVar(name, fallback) {
  for (const el of [document.documentElement, document.body]) {
    try {
      const v = getComputedStyle(el).getPropertyValue(name);
      if (v && v.trim()) return v.trim();
    } catch (e) { /* ignore */ }
  }
  return fallback;
}

function palette() {
  return {
    bg: cssVar("--comfy-input-bg", "#111214"),
    fg: cssVar("--comfy-input-text", "#e6e6e6"),
    accent: cssVar("--comfy-accent", "#3b82f6"),
    border: cssVar("--comfy-input-border", "#4b5563"),
    mono: cssVar("--font-mono", "Consolas, ui-monospace, monospace"),
  };
}

/* Two kinds of input:
   1) A full document (<!doctype / <html) -> handed to srcdoc untouched, keeps your own <style>
   2) A fragment (<h1> / <table> / plain text) -> wrapped in a themed skeleton */
function buildDoc(html) {
  const raw = String(html == null ? "" : html);

  if (!raw.trim()) {
    const c = palette();
    return (
      "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><style>" +
      "html,body{margin:0;height:100%}body{" +
      "background:" + c.bg + ";color:" + c.fg + ";font:14px/1.6 system-ui,sans-serif;" +
      "padding:24px;text-align:center}</style></head><body>" +
      "<div style=\"opacity:.6\">Empty</div>" +
      "<div style=\"opacity:.4;font:12px/mono;margin-top:8px\">Paste HTML here, or connect an upstream String (multiline) note</div>" +
      "</body></html>"
    );
  }

  const head = raw.trim().slice(0, 20).toLowerCase();
  if (head.startsWith("<!doctype") || head.startsWith("<html")) return raw;

  const c = palette();
  return (
    "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><style>" +
    "html,body{margin:0;height:100%}body{" +
    "background:" + c.bg + ";color:" + c.fg +
    ";font:14px/1.6 system-ui,-apple-system,\"Segoe UI\",sans-serif" +
    ";padding:10px 12px;overflow:auto}" +
    "code,pre{font-family:" + c.mono + ";font-size:12px}" +
    "table{border-collapse:collapse;margin:6px 0}" +
    "th,td{border:1px solid " + c.border + ";padding:4px 8px}" +
    "a{color:" + c.accent + "}img{max-width:100%}" +
    "</style></head><body>" + raw + "</body></html>"
  );
}

  /* Suppress the default action of Space / arrow keys, otherwise the outer ComfyUI canvas pans
     and the page scrolls. capture + preventDefault, without stopPropagation - the game's own
     keydown handler still fires. Both iframes (the one in the node, and the fullscreen one opened by Enlarge) go here. */
function bindKeys(frameEl) {
  try {
    frameEl.addEventListener("load", function () {
      try {
        const d = frameEl.contentDocument;
        if (!d || !d.addEventListener) return;
        if (frameEl._hnKeysBound) return;
        frameEl._hnKeysBound = true;
        d.addEventListener("keydown", function (ev) {
          const k = ev.key;
          if (k === " " || k === "Spacebar" || (typeof k === "string" && k.indexOf("Arrow") === 0)) {
            try { ev.preventDefault(); } catch (e) { /* ignore */ }
          }
        }, true);
      } catch (e) { /* ignore */ }
    });
  } catch (e) { /* ignore */ }
}

function render(frame, html) {
  frame.setAttribute("srcdoc", buildDoc(html));
  bindKeys(frame);
  try { frame.contentWindow.location.reload; } catch (e) { /* ignore */ }
}

/* Find the link currently plugged into the html input */
function linkOf(node) {
  try {
    if (!app.graph) return null;
    let id = null;
    if (node.inputs) {
      for (const i of node.inputs) {
        if (i.name === "html" && (i.link != null)) { id = i.link; break; }
      }
    }
    if (id == null) return null;
    const l = (typeof id === "object") ? id : app.graph.links[id];
    if (!l) return null;
    const origin_id = l.origin_id != null ? l.origin_id : l[2];
    const slot = l.origin_slot != null ? l.origin_slot : l[3];
    let up = null;
    if (app.graph.getNodeById) up = app.graph.getNodeById(origin_id);
    if (!up && app.graph._nodes) {
      for (const n of app.graph._nodes) if (n.id === origin_id) { up = n; break; }
    }
    return { id: id, slot: slot, up: up };
  } catch (e) { return null; }
}

/* Read the text of the upstream node: widgets_values by slot first, then the widget object */
function upstreamText(li) {
  if (!li || !li.up) return null;
  const up = li.up;
  try {
    const wv = up.widgets_values;
    if (Array.isArray(wv) && li.slot != null && typeof wv[li.slot] === "string") return wv[li.slot];
    const ws = up.widgets;
    if (Array.isArray(ws)) {
      const bySlot = ws[li.slot != null ? li.slot : 0];
      if (bySlot && typeof bySlot.value === "string") return bySlot.value;
      for (const w of ws) if (w && w.name === "value" && typeof w.value === "string") return w.value;
    }
  } catch (e) { /* ignore */ }
  return null;
}

function setup(node) {
  const nodeState = node.properties || (node.properties = {});
  if (typeof nodeState.view !== "string") nodeState.view = "preview";

  const nativeWidgets = (node.widgets || []).filter(function (w) { return w.name === "html"; });

  /* html is a multiline STRING, so ComfyUI generates its own native textarea.
     It competes with our own source box (two unrelated strings -> "paste it, no preview"),
     so it is hidden and only the single source box in the DOM widget remains; the content is
     still written back to it so nothing is lost on save.
     Key point: display:none alone is not enough. In 1.53+ the DOM controls live in a
     `position:fixed` .dom-widget layer; its offset/height is accumulated from every widget's
     computedHeight on the canvas side, so a hidden widget still takes space - which pushed this
     control down and left a big blank area at the top of the node. Zeroing its height fixes it. */
  for (const nw of nativeWidgets) {
    try {
      nw.element.style.setProperty("display", "none", "important");
      const prevCS = nw.computeSize;
      nw.computeSize = function (width) {
        try { if (prevCS) prevCS.apply(this, [width]); } catch (e) { /* ignore */ }
        return [width, 0];
      };
      try { nw.computedHeight = 0; } catch (e) { /* ignore */ }
    } catch (e) { /* ignore */ }
  }

  const wrap = document.createElement("div");
  wrap.className = "hn-wrap";
  wrap.style.cssText = "display:flex;flex-direction:column;width:100%;height:100%;" +
    "box-sizing:border-box;overflow:hidden";

  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;align-items:center;gap:6px;padding:3px 4px;flex:0 0 auto";

  const btn = document.createElement("button");
  btn.style.cssText = "font:12px system-ui;color:#fff;background:#2563eb;border:0;" +
    "border-radius:4px;padding:2px 8px;cursor:pointer";
  btn.textContent = "Enlarge";

  const reload = document.createElement("button");
  reload.style.cssText = "font:12px system-ui;color:#fff;background:#4b5563;border:0;" +
    "border-radius:4px;padding:2px 8px;cursor:pointer";
  reload.textContent = "Reload";
  reload.title = "Re-read the content and re-render it (use when the upstream value changed / the content did not catch up)";

  const sel = document.createElement("select");
  sel.style.cssText = "font:12px system-ui;background:#374151;color:#fff;border:0;" +
    "border-radius:4px;padding:2px 4px";
  sel.innerHTML = '<option value="preview">Preview</option><option value="source">Source</option>';

  const hint = document.createElement("span");
  hint.style.cssText = "font:11px system-ui;color:#9ca3af;margin-left:auto;white-space:nowrap";
  hint.textContent = "Content is stored in the workflow";

  bar.appendChild(btn);
  bar.appendChild(reload);
  bar.appendChild(sel);
  bar.appendChild(hint);

  const bodyBox = document.createElement("div");
  bodyBox.style.cssText = "flex:1 1 auto;min-height:0;position:relative;display:flex";

  const frame = document.createElement("iframe");
  frame.tabIndex = 0;  // let the keyboard focus land here (needed for interactive content / games)
  frame.style.cssText = "flex:1 1 auto;min-width:0;border:0;display:block;width:100%;height:100%";

  const ta = document.createElement("textarea");
  ta.spellcheck = false;
  ta.placeholder = "Paste HTML here (or let it arrive from an upstream String (multiline) note)";
  ta.style.cssText = "flex:1 1 auto;min-width:0;border:0;outline:none;resize:none;display:none;" +
    "box-sizing:border-box;padding:8px 10px;font:12px/1.5 Consolas,ui-monospace,monospace;" +
    "background:#111827;color:#e5e7eb;width:100%;height:100%";

  bodyBox.appendChild(frame);
  bodyBox.appendChild(ta);
  wrap.appendChild(bar);
  wrap.appendChild(bodyBox);

  /* The real height control is the number widget inside node.widgets (it lands in
     widgets_values[1] once serialised), not in properties. Reading only properties and hooking only
     onChange used to mean: the number changes -> widget.value changes -> but the frontend's own
     height variable did not, so nothing happened. */
  let hWidget = null;
  for (const w of (node.widgets || [])) {
    if (w && w.name === "height") { hWidget = w; break; }
  }

  function readHeight() {
    if (hWidget) {
      const v = Number(hWidget.value);
      if (Number.isFinite(v) && v > 0) return v;
    }
    const p = Number(nodeState.height);
    if (Number.isFinite(p) && p > 0) return p;
    return 420;
  }

  let height = readHeight();
  let lastRendered = null;
let linkedVal = null;   // value coming from upstream (the only truth when a link exists)
let watchKey = null;    // upstream node id, so listeners are not attached twice

  function persist() {
    /* The height is written back to the widget/properties too, otherwise the json keeps a stale value. */
    height = readHeight();
    if (hWidget) { try { hWidget.value = height; } catch (e) { /* ignore */ } }
    nodeState.height = height;
    if (linkedVal !== null) {
      // with an upstream link this node stores no copy, to avoid writing stale content into the json
      nodeState.html = "";
      for (const nw of nativeWidgets) { try { nw.value = ""; } catch (e) { /* ignore */ } }
      return "";
    }
    nodeState.html = ta.value || "";
    for (const nw of nativeWidgets) { try { nw.value = nodeState.html; } catch (e) { /* ignore */ } }
    return nodeState.html;
  }

/* Do not name it "html": it would collide with the native multiline textarea and
     scramble the widgets_values indexes (the value read back after a save would not match). */
  const widget = node.addDOMWidget("hn_view", NS, wrap, { serializeValue: persist });
  widget.serializeValue = persist;

     /* The widget height is the node's remaining height (instead of a fixed 420), so dragging the
     node's bottom edge directly enlarges the preview and never overflows the node. */
  function topOffset() {
    try { if (typeof widget.y === "number" && widget.y > 0) return widget.y; } catch (e) { /* ignore */ }
    let y = node.widgets_start_y || 24;
    for (const w of (node.widgets || [])) {
      if (w === widget) break;
      y += (w.computedHeight || 0);
    }
    return y;
  }
     /* Make the frontend reposition the DOM controls: in 1.53+ .dom-widget is a position:fixed layer,
     so changing node.size is not enough - a reflow must be triggered or the iframe height will not follow. */
  function relayoutDom() {
    try {
      if (typeof node.updateDOMWidgets === "function") { node.updateDOMWidgets(); return true; }
    } catch (e) { /* ignore */ }
    try {
      if (app.canvas && typeof app.canvas.updateDOMWidgets === "function") {
        app.canvas.updateDOMWidgets(node);
        return true;
      }
    } catch (e) { /* ignore */ }
    try {
      if (app.canvas && typeof app.canvas.draw === "function") { app.canvas.draw(true, true); return true; }
    } catch (e) { /* ignore */ }
    return false;
  }

  function setNodeHeight() {
    height = readHeight();
    if (hWidget) { try { hWidget.value = height; } catch (e) { /* ignore */ } }
    nodeState.height = height;
    try {
      const w0 = node.size ? node.size[0] : 460;
      node.setSize([w0, Math.max(120, height + topOffset())]);
    } catch (e) { /* ignore */ }
    relayoutDom();
    if (app.graph) app.graph.setDirtyCanvas(true, true);
  }

     /* The height is fixed to the height value. Do not derive it from node.size - the frontend
     grows the node from the widget height on its own, and reading it back creates a positive feedback
     loop that walks the node up to thousands of pixels. Always read the height widget's latest value. */
  widget.computeSize = function (width) {
    height = readHeight();
    return [width, height];
  };

  ta.value = typeof nodeState.html === "string" ? nodeState.html : "";

  function currentHTML() {
    if (linkedVal !== null) return linkedVal;
    return ta.value || "";
  }

  function syncLinked() {
    const li = linkOf(node);
    const v = li ? upstreamText(li) : null;
    if (v === null) {
      if (linkedVal !== null) {
        linkedVal = null;
        ta.readOnly = false;
        ta.style.background = "#111827";
  hint.textContent = "Content is stored in the workflow";
      }
    } else {
      if (typeof v !== "string") v = String(v);
      linkedVal = v;
// write the upstream content back into the textarea so it is visible in source view
      ta.value = v;
      ta.readOnly = true;
      ta.style.background = "#1f2937";
        hint.textContent = "From upstream #" + (li.up ? li.up.id : "?") + " (read-only)";
    }
    return linkedVal !== null;
  }

  function refresh(force) {
    syncLinked();
    const html = currentHTML();
    if (!force && html === lastRendered) return false;
    lastRendered = html;
    render(frame, html);
    if (app.graph) app.graph.setDirtyCanvas(true, true);
    return true;
  }

  /* For interactive content (games etc.) the keyboard focus must be pushed into the iframe.
     Focus defaults to the outer ComfyUI canvas; without this the keys do nothing.
     Blocking the default Space / arrow-key action is done by the top-level bindKeys() too (the fullscreen iframe needs it). */
  function primeFocus() {
    try {
      const d = frame.contentDocument;
      if (d) {
        try {
          if (d.activeElement && d.activeElement.blur) d.activeElement.blur();
          if (d.body && d.body.focus) d.body.focus();
          else if (d.documentElement && d.documentElement.focus) d.documentElement.focus();
        } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }
    try { frame.contentWindow.focus(); } catch (e) { /* ignore */ }
  }

/* Re-setting srcdoc fires load, which is a good moment to land the focus */
  frame.addEventListener("load", primeFocus);
  wrap.addEventListener("mousedown", function () { primeFocus(); });

  function setView(v) {
    if (v === "source") {
      frame.style.display = "none";
      ta.style.display = "block";
    } else {
      ta.style.display = "none";
      frame.style.display = "block";
      refresh(true);
    }
  }

  syncLinked();
  sel.value = nodeState.view === "source" ? "source" : "preview";
  setView(sel.value);

  ta.addEventListener("input", persist);
  ta.addEventListener("change", function () {
    persist();
    if (sel.value === "preview") refresh(true);
  });

  sel.addEventListener("change", function () {
    nodeState.view = sel.value;
    setView(sel.value);
  });

  reload.addEventListener("click", function (ev) {
    ev.preventDefault();
    ev.stopPropagation();
    syncLinked();
    nodeState.view = "preview";
    sel.value = "preview";
    setView("preview");
    console.log("[HTMLNote] reload", {
      linked: linkedVal !== null,
      len: currentHTML().length,
      fromUpstream: linkedVal !== null ? linkedVal.length : null,
      propLen: typeof nodeState.html === "string" ? nodeState.html.length : null,
    });
  });

  btn.addEventListener("click", function (ev) {
    ev.preventDefault();
    ev.stopPropagation();
    openFullscreen(currentHTML());
  });

/* Recompute immediately when the link changes (connected / disconnected / switched upstream) */
  const origConnChange = node.onConnectionsChange;
  node.onConnectionsChange = function () {
    if (origConnChange) origConnChange.apply(this, arguments);
    try { refresh(true); } catch (e) { console.error("[HTMLNote] onConnectionsChange", e); }
  };

/* Watch the upstream textarea for edits (e.g. typing into a String (multiline) note) */
  function watchUpstream() {
    const li = linkOf(node);
    if (!li || !li.up) { watchKey = null; return; }
    if (watchKey === li.up.id + ":" + li.id) return;
    watchKey = li.up.id + ":" + li.id;
    try {
      const ws = li.up.widgets || [];
      for (const w of ws) {
        if (w && w.element) {
          w.element.addEventListener("input", function () { refresh(true); });
          w.element.addEventListener("change", function () { refresh(true); });
        }
      }
    } catch (e) { /* ignore */ }
  }
  watchUpstream();

/* Polling fallback: still catches up when the upstream node type is custom and its widget element is unreachable */
  const timer = setInterval(function () {
    try {
      if (node.flags && node.flags.collapsed) return;
      watchUpstream();
      syncLinked();
      if (linkedVal !== null && linkedVal !== lastRendered && sel.value === "preview") refresh(true);
    } catch (e) { /* ignore */ }
  }, 1200);
  node._htmlnoteTimer = timer;

  /* Height wiring: ComfyUI's number control fires its callback on .callback (not .onChange),
     and both may be undefined, so all three layers are covered: callback + DOM events + polling.
     Hooking only onChange used to wire nothing at all, so changing the number did nothing. */
  function applyHeight(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return;
    height = Math.round(n);
    if (hWidget) { try { hWidget.value = height; } catch (e) { /* ignore */ } }
    nodeState.height = height;
    setNodeHeight();
  }

  if (hWidget) {
    if (typeof hWidget.onChange === "function") {
      const prevOnChange = hWidget.onChange;
      hWidget.onChange = function (v) { prevOnChange.call(this, v); applyHeight(v); };
    }
    for (const key of ["callback", "cb"]) {
      if (typeof hWidget[key] === "function") {
        const prevCb = hWidget[key];
        hWidget[key] = function (v) { prevCb.call(this, v); applyHeight(v); };
      }
    }
    const el = hWidget.element;
    if (el) {
      const onDom = function (ev) {
        ev.stopPropagation();
        applyHeight(hWidget.value);
      };
      el.addEventListener("change", onDom, true);
      el.addEventListener("input", onDom, true);
      el.addEventListener("mouseup", onDom, true);
    }
  }

  function refreshSize() {
    height = readHeight();
    nodeState.height = height;
    setNodeHeight();
    if (app.graph) app.graph.setDirtyCanvas(true, true);
  }
  node._htmlnoteRefresh = refreshSize;

/* Sync once more after the json restore finishes (DOM widgets are often restored after onNodeCreated) */
  const origConfigure = node.onConfigure;
  node.onConfigure = function () {
    if (origConfigure) origConfigure.apply(this, arguments);
    try {
      const li = linkOf(this);
      const up = li ? upstreamText(li) : null;
      if (up !== null && String(up).trim()) {
        linkedVal = String(up);
        ta.value = linkedVal;
        nodeState.html = "";
      } else if (typeof this.properties.html === "string" && this.properties.html) {
        linkedVal = null;
        ta.value = this.properties.html;
        nodeState.html = this.properties.html;
      }
      refresh(true);
      try { this.setSize([this.size[0], Math.max(120, height + topOffset())]); } catch (e) { /* ignore */ }
    } catch (e) { console.error("[HTMLNote] onConfigure failed", e); }
  };

  requestAnimationFrame(function () { refresh(true); });
}

let fullOverlay = null;
function openFullscreen(html) {
  if (fullOverlay) fullOverlay.remove();
  const c = palette();
  const ov = document.createElement("div");
  ov.style.cssText =
    "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.72)" +
    ";display:flex;align-items:center;justify-content:center";
  const box = document.createElement("div");
  box.style.cssText =
    "width:92%;height:92%;background:" + c.bg + ";border-radius:10px;overflow:hidden;" +
    "position:relative;display:flex;flex-direction:column";
  const big = document.createElement("iframe");
  big.style.cssText = "width:100%;height:100%;border:0;display:block";
  const close = document.createElement("div");
  close.style.cssText =
    "position:absolute;top:8px;right:12px;z-index:2;color:#fff;cursor:pointer;" +
    "font:13px system-ui;background:rgba(120,120,120,.6);padding:3px 10px;border-radius:6px";
  close.textContent = "Close (Esc)";
  box.appendChild(big);
  ov.appendChild(close);
  ov.appendChild(box);
  document.body.appendChild(ov);
  fullOverlay = ov;

  render(big, html);
  try { big.contentWindow.focus(); } catch (e) { /* ignore */ }

  function closeFull() {
    if (fullOverlay) { fullOverlay.remove(); fullOverlay = null; }
    document.removeEventListener("keydown", onKey);
  }
  const onKey = function (ev) { if (ev.key === "Escape") closeFull(); };
  close.onclick = closeFull;
  ov.onclick = function (ev) { if (ev.target === ov) closeFull(); };
  document.addEventListener("keydown", onKey);
}

app.registerExtension({
  name: "ComfyUI.HTMLNote",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (!nodeData || nodeData.name !== "HTMLNote") return;
    const original = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      if (original) original.apply(this, arguments);
      try { setup(this); } catch (e) { console.error("[HTMLNote] setup failed", e); }
    };
  },
});
