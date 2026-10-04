#!/usr/bin/env node
/* ComfyUI-HTML-Note 附带工具：把一份本地 .html 灌进工作流里的 HTML 说明节点。
 *
 * 用法（Node 22+ / 任意系统）：
 *   node tools/inject_html.js <工作流.json> <说明.html> [选项]
 *
 * 选项：
 *   --node <id>      指定目标节点 id（必须已是 HTMLNote 节点）
 *   --title <文字>   新建节点时的标题，默认 "说明"
 *   --height <px>    节点高度，默认 420
 *   --pos x,y        新建节点的位置，默认放在现有节点右侧空白
 *
 * 找不到 HTMLNote 节点时会自动新建一个（并自动备份原 json）。
 * 这个脚本只改文本，不连 ComfyUI、不碰 workflows\工作流OK。
 */

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error("用法: node inject_html.js <工作流.json> <说明.html> [--node <id>] [--title <文字>] [--height <px>] [--pos x,y]");
  process.exit(1);
}

const workflowPath = args[0];
const htmlPath = args[1];

const opt = { node: null, title: "说明", height: 420, pos: null };
for (let i = 2; i < args.length; i++) {
  const a = args[i];
  if (a === "--node") opt.node = args[++i];
  else if (a === "--title") opt.title = args[++i];
  else if (a === "--height") opt.height = Number(args[++i]);
  else if (a === "--pos") opt.pos = args[++i].split(",").map(Number);
  else console.error("未知选项: " + a);
}

if (!fs.existsSync(workflowPath)) { console.error("找不到工作流文件: " + workflowPath); process.exit(1); }
if (!fs.existsSync(htmlPath)) { console.error("找不到 html 文件: " + htmlPath); process.exit(1); }

const html = fs.readFileSync(htmlPath, "utf8");
const wf = JSON.parse(fs.readFileSync(workflowPath, "utf8"));

if (!Array.isArray(wf.nodes)) { console.error("这个 json 不是 ComfyUI 工作流（没有 nodes 数组）"); process.exit(1); }

const notes = wf.nodes.filter((n) => n.type === "HTMLNote");
let target = null;

if (opt.node != null) {
  target = wf.nodes.find((n) => String(n.id) === String(opt.node));
  if (!target) { console.error("没有 id=" + opt.node + " 的节点"); process.exit(1); }
  if (target.type !== "HTMLNote") { console.error("id=" + opt.node + " 不是 HTMLNote 节点（是 " + target.type + "）"); process.exit(1); }
} else if (notes.length > 0) {
  target = notes[notes.length - 1];
  console.log("复用已有节点 #" + target.id);
} else {
  const maxId = wf.nodes.reduce((m, n) => Math.max(m, Number(n.id) || 0), 0);
  const maxOrder = wf.nodes.reduce((m, n) => Math.max(m, Number(n.order) || 0), -1);
  const maxX = wf.nodes.reduce((m, n) => Math.max(m, (n.pos && n.pos[0]) || 0), 0);
  const minY = wf.nodes.reduce((m, n) => Math.min(m, (n.pos && n.pos[1]) || 0), 0);
  target = {
    id: maxId + 1,
    type: "HTMLNote",
    pos: opt.pos || [maxX + 120, minY],
    size: [560, opt.height + 24],
    flags: {},
    order: maxOrder + 1,
    mode: 0,
    inputs: [],
    outputs: [],
    title: opt.title,
    properties: { "Node name for S&R": "HTMLNote" },
    widgets_values: ["", opt.height],
  };
  wf.nodes.push(target);
  console.log("新建节点 #" + target.id);
}

target.widgets_values = [html, Number(target.widgets_values && target.widgets_values[1]) || opt.height];
target.properties = target.properties || {};
target.properties.html = html;
if (!Array.isArray(target.size) || target.size[1] == null) target.size = [target.size[0] || 560, opt.height + 24];

const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 12).replace("T", "_").slice(0, 15);
const bak = workflowPath + ".bak_" + stamp;
fs.copyFileSync(workflowPath, bak);

fs.writeFileSync(workflowPath, JSON.stringify(wf, null, 2), "utf8");

console.log("已写入 #" + target.id + " (" + target.title + ")");
console.log("  html 字符数: " + html.length);
console.log("  备份: " + path.basename(bak));
console.log("\n重启/刷新 ComfyUI 后可见。节点里切到「源码」可编辑，切回「预览」看渲染。");
