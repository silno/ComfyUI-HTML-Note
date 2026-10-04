import { app } from "../../scripts/app.js";

/* ComfyUI-HTML-Note 前端：把 HTML 字符串渲染进一个同源 iframe。

   内容来源（优先级从高到低）：
     1) 上游连线：html 输入口接了线（比如「字符串（多行）」便签节点）时，
        直接从图里读上游节点的 widgets_values —— 不走执行、不排队，
        所以「不点运行也能实时看」。
     2) 本节点输入区：没接线时直接在本节点里粘 HTML。
     3) 节点属性 properties.html（兜底，覆盖 json 回填时机）。

   v4 修复：原来只认「本节点自己的输入框」，所以接了上游线之后，
   节点里显示的还是 INPUT_TYPES 里的默认占位文字，看起来像"线没生效"。
   现在连线优先，并且隐藏的原生 multiline 输入框会跟着上游值走。 */

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

/* 两种输入：
   1) 完整文档（<!doctype / <html）→ 原样塞 srcdoc，保留自带 <style>
   2) 片段（<h1> / <table> / 裸文字）→ 套一层带主题色的骨架 */
function buildDoc(html) {
  const raw = String(html == null ? "" : html);

  if (!raw.trim()) {
    const c = palette();
    return (
      "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><style>" +
      "html,body{margin:0;height:100%}body{" +
      "background:" + c.bg + ";color:" + c.fg + ";font:14px/1.6 system-ui,sans-serif;" +
      "padding:24px;text-align:center}</style></head><body>" +
      "<div style=\"opacity:.6\">内容为空</div>" +
      "<div style=\"opacity:.4;font:12px/mono;margin-top:8px\">内容写在节点里，或直接接一个「字符串（多行）」上游</div>" +
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

/* 拦 空格 / 方向键的默认行为：不然外层 ComfyUI 画布会跟着平移、页面会滚动。
   capture + preventDefault，不 stopPropagation —— 游戏自己的 keydown 照常收到。
   两个 iframe（节点里的、点「放大」后全屏的）都走这里。 */
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

/* 找到 html 输入口当前接的那条线 */
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

/* 从上游节点取文本：先按 slot 读 widgets_values，再退回 widget 对象 */
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

  /* html 是 multiline STRING，ComfyUI 会自动生成一个原生多行输入框。
     它会和我们自己的源码框抢内容（两份互不相通的字符串 → "粘了却没预览"），
     所以藏掉它，只留 DOM widget 里唯一一个源码框；内容仍写回它，保证保存不丢。 */
  for (const nw of nativeWidgets) {
    try {
      nw.element.style.setProperty("display", "none", "important");
      /* 关键：光 display:none 不够。1.53+ 的前端把 DOM 控件放在
         `position:fixed` 的 .dom-widget 容器里，位置/高度由 canvas 侧的
         widget 栈按 computedHeight 累加算出来 —— 被隐藏的 widget 仍然占位，
         于是本控件被整体往下顶，节点上半截留下一大片空白。
         所以这里把它的占位高度归零。 */
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
  btn.textContent = "放大";

  const reload = document.createElement("button");
  reload.style.cssText = "font:12px system-ui;color:#fff;background:#4b5563;border:0;" +
    "border-radius:4px;padding:2px 8px;cursor:pointer";
  reload.textContent = "重读";
  reload.title = "重新取内容并渲染（改了上游值 / 内容没跟上时用）";

  const sel = document.createElement("select");
  sel.style.cssText = "font:12px system-ui;background:#374151;color:#fff;border:0;" +
    "border-radius:4px;padding:2px 4px";
  sel.innerHTML = '<option value="preview">预览</option><option value="source">源码</option>';

  const hint = document.createElement("span");
  hint.style.cssText = "font:11px system-ui;color:#9ca3af;margin-left:auto;white-space:nowrap";
  hint.textContent = "内容存在工作流里";

  bar.appendChild(btn);
  bar.appendChild(reload);
  bar.appendChild(sel);
  bar.appendChild(hint);

  const bodyBox = document.createElement("div");
  bodyBox.style.cssText = "flex:1 1 auto;min-height:0;position:relative;display:flex";

  const frame = document.createElement("iframe");
  frame.tabIndex = 0;  // 让键盘焦点能落进来（玩交互内容/小游戏时用得上）
  frame.style.cssText = "flex:1 1 auto;min-width:0;border:0;display:block;width:100%;height:100%";

  const ta = document.createElement("textarea");
  ta.spellcheck = false;
  ta.placeholder = "直接把 HTML 粘在这里（也可以从上游「字符串（多行）」连线进来）";
  ta.style.cssText = "flex:1 1 auto;min-width:0;border:0;outline:none;resize:none;display:none;" +
    "box-sizing:border-box;padding:8px 10px;font:12px/1.5 Consolas,ui-monospace,monospace;" +
    "background:#111827;color:#e5e7eb;width:100%;height:100%";

  bodyBox.appendChild(frame);
  bodyBox.appendChild(ta);
  wrap.appendChild(bar);
  wrap.appendChild(bodyBox);

  /* height 控件的真身是 node.widgets 里那个 number widget（序列化后落在
     widgets_values[1]），不在 properties 里。以前只从 properties 读 + 只认 onChange，
     所以流程是「改了数字 → widget.value 变了 → 但前端闭包里的 height 没变 → 没反应」。 */
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
  let linkedVal = null;   // 上游来的值（有连线时的唯一真相）
  let watchKey = null;    // 上游节点 id，避免重复挂监听

  function persist() {
    /* 高度也要一起存回 widget/属性，否则 json 里存的是旧值，重开页面又被拉回来 */
    height = readHeight();
    if (hWidget) { try { hWidget.value = height; } catch (e) { /* ignore */ } }
    nodeState.height = height;
    if (linkedVal !== null) {
      // 有上游时本节点不存副本，避免把过期内容写进 json
      nodeState.html = "";
      for (const nw of nativeWidgets) { try { nw.value = ""; } catch (e) { /* ignore */ } }
      return "";
    }
    nodeState.html = ta.value || "";
    for (const nw of nativeWidgets) { try { nw.value = nodeState.html; } catch (e) { /* ignore */ } }
    return nodeState.html;
  }

  /* 名字别用 "html"：会和原生 multiline 输入框重名，
     导致 widgets_values 索引混乱（保存后取回的值对不上）。 */
  const widget = node.addDOMWidget("hn_view", NS, wrap, { serializeValue: persist });
  widget.serializeValue = persist;

  /* 控件高度 = 节点剩余高度（而不是写死的 420），
     这样拖节点下边缘能直接把预览区拉大，也不会溢出节点。 */
  function topOffset() {
    try { if (typeof widget.y === "number" && widget.y > 0) return widget.y; } catch (e) { /* ignore */ }
    let y = node.widgets_start_y || 24;
    for (const w of (node.widgets || [])) {
      if (w === widget) break;
      y += (w.computedHeight || 0);
    }
    return y;
  }
  /* 让前端把 DOM 控件重新定位：1.53+ 的 .dom-widget 是 position:fixed 浮层，
     只改 node.size 是不够的，得再触发一次重排，否则 iframe 高度不会跟着变。 */
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

  /* 高度写死成 height（别去读 node.size 反推剩余空间 —— 前端会自动按
     控件高度撑节点，读回来会形成正反馈，节点一路涨到上千像素）。
     每次都现算，改用 height widget 的最新值。 */
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
        hint.textContent = "内容存在工作流里";
      }
    } else {
      if (typeof v !== "string") v = String(v);
      linkedVal = v;
      // 上游内容回写到输入框，源码视图里也能看见
      ta.value = v;
      ta.readOnly = true;
      ta.style.background = "#1f2937";
      hint.textContent = "来自上游 #" + (li.up ? li.up.id : "?") + "（只读）";
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

  /* 交互内容（小游戏之类）必备：把键盘焦点送进 iframe。
     焦点默认在外层 ComfyUI 画布上，不送进去按键就没反应。
     拦 空格 / 方向键默认行为的活儿在顶层 bindKeys() 里做（全屏那个 iframe 也用得到）。 */
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

  /* srcdoc 每次重设都会触发 load，正好是焦点落地时机 */
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

  /* 连线变化时（接上 / 断开 / 换上游）立刻重算 */
  const origConnChange = node.onConnectionsChange;
  node.onConnectionsChange = function () {
    if (origConnChange) origConnChange.apply(this, arguments);
    try { refresh(true); } catch (e) { console.error("[HTMLNote] onConnectionsChange", e); }
  };

  /* 监听上游输入框的改动（比如「字符串（多行）」便签里打字） */
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

  /* 兜底轮询：上游节点类型是自定义的、拿不到 widget 元素时也能跟上 */
  const timer = setInterval(function () {
    try {
      if (node.flags && node.flags.collapsed) return;
      watchUpstream();
      syncLinked();
      if (linkedVal !== null && linkedVal !== lastRendered && sel.value === "preview") refresh(true);
    } catch (e) { /* ignore */ }
  }, 1200);
  node._htmlnoteTimer = timer;

  /* 高度联动：ComfyUI 的 number 控件回调挂在 callback（不是 onChange），
     而且两个都可能是 undefined —— 所以三层都兜：回调 + DOM 事件 + 兜底轮询。
     以前只认 onChange，等于一根线都没接上，改数字自然没反应。 */
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

  /* json 恢复完成后再同步一次（DOM widget 回填常晚于 onNodeCreated） */
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
  close.textContent = "关闭 (Esc)";
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
