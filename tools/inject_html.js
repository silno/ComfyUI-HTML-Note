#!/usr/bin/env node
/* Tool shipped with ComfyUI-HTML-Note: inject a local .html file into the HTML Note node of a workflow.
 *
 * Usage (Node 22+ / any OS):
 *   node tools/inject_html.js <workflow.json> <doc.html> [options]
 *
 * Options:
 *   --node <id>      id of the target node (it must already be an HTMLNote node)
 *   --title <text>   title used when a node is created (default "Note")
 *   --height <px>    node height (default 420)
 *   --pos x,y        position used when a node is created (empty space right of the existing nodes)
 *
 * If the workflow has no HTMLNote node, one is created (and the original json is backed up).
 * This script only rewrites text; it never talks to a running ComfyUI.
 */

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error("Usage: node inject_html.js <workflow.json> <doc.html> [--node <id>] [--title <text>] [--height <px>] [--pos x,y]");
  process.exit(1);
}

const workflowPath = args[0];
const htmlPath = args[1];

const opt = { node: null, title: "Note", height: 420, pos: null };
for (let i = 2; i < args.length; i++) {
  const a = args[i];
  if (a === "--node") opt.node = args[++i];
  else if (a === "--title") opt.title = args[++i];
  else if (a === "--height") opt.height = Number(args[++i]);
  else if (a === "--pos") opt.pos = args[++i].split(",").map(Number);
  else console.error("Unknown option: " + a);
}

if (!fs.existsSync(workflowPath)) { console.error("Workflow file not found: " + workflowPath); process.exit(1); }
if (!fs.existsSync(htmlPath)) { console.error("HTML file not found: " + htmlPath); process.exit(1); }

const html = fs.readFileSync(htmlPath, "utf8");
const wf = JSON.parse(fs.readFileSync(workflowPath, "utf8"));

if (!Array.isArray(wf.nodes)) { console.error("Not a ComfyUI workflow json (no nodes array)"); process.exit(1); }

const notes = wf.nodes.filter((n) => n.type === "HTMLNote");
let target = null;

if (opt.node != null) {
  target = wf.nodes.find((n) => String(n.id) === String(opt.node));
  if (!target) { console.error("No node with id=" + opt.node); process.exit(1); }
  if (target.type !== "HTMLNote") { console.error("Node id=" + opt.node + " is not an HTMLNote node (it is " + target.type + ")"); process.exit(1); }
} else if (notes.length > 0) {
  target = notes[notes.length - 1];
  console.log("Reusing existing node #" + target.id);
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
  console.log("Created node #" + target.id);
}

target.widgets_values = [html, Number(target.widgets_values && target.widgets_values[1]) || opt.height];
target.properties = target.properties || {};
target.properties.html = html;
if (!Array.isArray(target.size) || target.size[1] == null) target.size = [target.size[0] || 560, opt.height + 24];

const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 12).replace("T", "_").slice(0, 15);
const bak = workflowPath + ".bak_" + stamp;
fs.copyFileSync(workflowPath, bak);

fs.writeFileSync(workflowPath, JSON.stringify(wf, null, 2), "utf8");

console.log("Written to #" + target.id + " (" + target.title + ")");
console.log("  html chars: " + html.length);
console.log("  backup: " + path.basename(bak));
console.log("Restart/reload ComfyUI to see it. Switch the node to Source to edit it, back to Preview to see the render.");
