#!/usr/bin/env node
// Helper for the `diagram` skill. Installs the pinned Eraser engine on first use, renders
// diagram JSON to PNG (and HTML), and checks the rendered layout for faults the engine itself
// does not report: overlapping nodes, captions spilling out of groups, connection labels
// sitting on nodes, shapes too small for their text.
//
//   node eraser.mjs render <diagram.json...> [-o out.png] [--scale 2] [--html] [--transparent] [--strict]
//   node eraser.mjs icons <query...> [--limit 12]    search the icon catalog, one result line per query
//   node eraser.mjs icons --refresh                  re-list the hosted catalog into references/icons.txt
//   node eraser.mjs guide format|layout              print a reference; example <name> prints an example
//   node eraser.mjs schema <Tag> | registry | validate <diagram.json>   pass through to eraser-diagrams
//   node eraser.mjs doctor                           report Node, engine install and browser
//
// stdout carries only the result (JSON for render and doctor); progress goes to stderr.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const ENGINE_VERSION = '0.2.0';
const SKILL_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ICON_INDEX = path.join(SKILL_DIR, 'references', 'icons.txt');
const ICON_LISTING = 'https://storage.googleapis.com/storage/v1/b/eraser-public-assets/o';

// Layout-check thresholds, in diagram pixels. Intersections thinner than TOUCH are borders
// touching, not overlap; PAD is the breathing room suggested when a container must grow.
const TOUCH = 2;
const PAD = 24;
const MIN_TEXT_SHAPE = 40;
// A labelled line needs this much run beyond its label's width, and a label this much air
// around it, or it reads as stuck to the node.
const LABEL_RUN = 48;
const LABEL_CLEAR = 8;
// Two connections may meet at a corner; running together for longer than this is a fault.
const SHARED_RUN = 12;

function fail(message, code = 2) {
  process.stderr.write(`eraser: ${message}\n`);
  process.exit(code);
}

function requireNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) {
    fail(`Node.js 22.12 or newer is required (this is ${process.versions.node}).`);
  }
}

// ---------------------------------------------------------------------------------------------
// Engine install

function engineHome() {
  if (process.env.ERASER_DIAGRAMS_HOME) return process.env.ERASER_DIAGRAMS_HOME;
  const cache =
    process.env.XDG_CACHE_HOME ||
    (process.platform === 'win32' ? process.env.LOCALAPPDATA : undefined) ||
    path.join(os.homedir(), '.cache');
  return path.join(cache, 'eraser-diagrams-skill', ENGINE_VERSION);
}

function engineInstalled(home) {
  return fs.existsSync(path.join(home, 'node_modules', '@eraserlabs', 'diagrams-cli', 'package.json'));
}

function ensureEngine() {
  const home = engineHome();
  if (engineInstalled(home)) return home;
  // Install into a scratch directory and rename it into place, so a second render started
  // during the install never sees a half-written node_modules.
  const scratch = `${home}.installing-${process.pid}`;
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
  fs.writeFileSync(
    path.join(scratch, 'package.json'),
    JSON.stringify({ name: 'eraser-diagrams-skill-engine', private: true }),
  );
  process.stderr.write(
    `eraser: installing @eraserlabs/diagrams-cli@${ENGINE_VERSION} into ${home} (one time, ~30s)\n`,
  );
  const npm = spawnSync(
    'npm',
    ['install', '--no-audit', '--no-fund', '--loglevel=error', `@eraserlabs/diagrams-cli@${ENGINE_VERSION}`],
    { cwd: scratch, stdio: ['ignore', 2, 2], shell: process.platform === 'win32' },
  );
  if (npm.error || npm.status !== 0) {
    fs.rmSync(scratch, { recursive: true, force: true });
    fail(`npm install failed (${npm.error?.message ?? `exit ${npm.status}`}). Is npm on PATH and the registry reachable?`);
  }
  try {
    fs.renameSync(scratch, home);
  } catch (error) {
    fs.rmSync(scratch, { recursive: true, force: true });
    if (!engineInstalled(home)) throw error;
  }
  return home;
}

async function loadEngine() {
  const home = ensureEngine();
  const fromHome = createRequire(path.join(home, 'package.json'));
  const diagramsEntry = fromHome.resolve('@eraserlabs/diagrams');
  const api = await import(pathToFileURL(diagramsEntry).href);
  const playwright = await import(pathToFileURL(createRequire(diagramsEntry).resolve('playwright-core')).href);
  return { api, chromium: playwright.chromium ?? playwright.default.chromium, home };
}

function cliPath(home) {
  return path.join(home, 'node_modules', '@eraserlabs', 'diagrams-cli', 'dist', 'cli.js');
}

// ---------------------------------------------------------------------------------------------
// Browser

function browserCandidates() {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      path.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
  }
  if (process.platform === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    return roots.flatMap((root) => [
      path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ]);
  }
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/microsoft-edge',
  ];
}

function findBrowser() {
  const pinned = process.env.CHROMIUM_PATH;
  if (pinned) return fs.existsSync(pinned) ? pinned : null;
  return browserCandidates().find((candidate) => fs.existsSync(candidate)) ?? null;
}

function requireBrowser() {
  const found = findBrowser();
  if (found) return found;
  if (process.env.CHROMIUM_PATH) fail(`CHROMIUM_PATH is set to "${process.env.CHROMIUM_PATH}", which does not exist.`);
  fail('No Chrome, Chromium or Edge found. Install Google Chrome, or set CHROMIUM_PATH to a Chromium-family executable.');
}

// ---------------------------------------------------------------------------------------------
// render

async function render(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o' },
      scale: { type: 'string', default: '2' },
      html: { type: 'boolean', default: false },
      transparent: { type: 'boolean', default: false },
      strict: { type: 'boolean', default: false },
    },
  });
  if (positionals.length === 0) fail('render needs at least one diagram JSON file.');
  if (values.out && positionals.length > 1) fail('-o takes a single input; with several inputs each PNG goes next to its JSON.');
  const scale = Number(values.scale);
  if (!(scale > 0 && scale <= 4)) fail(`--scale must be a number in (0, 4], got "${values.scale}".`);

  const { api, chromium } = await loadEngine();
  const browser = await chromium.launch({ executablePath: requireBrowser() });
  try {
    // Inline the stock font files so the HTML output renders anywhere and the layout check
    // measures text in the real fonts rather than a fallback.
    const stock = api.eraserFonts();
    const renderer = await api.createRenderer({
      browser: async () => browser,
      deviceScaleFactor: scale,
      transparent: values.transparent,
      fonts: { ...stock, faces: stock.faces.map((face) => ({ ...face, inline: true })) },
    });
    const containerTags = new Set(renderer.registryInfo().tags.filter((t) => t.container).map((t) => t.tag));
    const results = [];
    for (const input of positionals) {
      results.push(await renderOne({ renderer, browser, input, values, containerTags }));
    }
    await renderer.close();
    const ok = results.every((r) => r.ok && (!values.strict || r.clean));
    process.stdout.write(`${JSON.stringify({ ok, results }, null, 2)}\n`);
    process.exitCode = ok ? 0 : 1;
  } finally {
    await browser.close().catch(() => {});
  }
}

function defaultOut(input) {
  const base = input.replace(/\.diagram\.json$/i, '').replace(/\.json$/i, '');
  return `${base}.png`;
}

function slimIssue(issue) {
  const element = issue.elementId ? `${issue.tag ?? '?'} "${issue.elementId}"` : issue.tag;
  return Object.fromEntries(
    Object.entries({
      code: issue.code,
      path: issue.path,
      element,
      message: issue.message,
      suggestion: issue.suggestion,
    }).filter(([, v]) => v !== undefined && v !== ''),
  );
}

async function renderOne({ renderer, browser, input, values, containerTags }) {
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(input, 'utf8'));
  } catch (error) {
    return { input, ok: false, errors: [{ code: 'E_READ', message: error.message }] };
  }
  const outcome = await renderer.render({ ...doc, outputs: { png: true, html: true, json: true } });
  const warnings = (outcome.warnings ?? []).map(slimIssue);
  if (!outcome.ok) return { input, ok: false, errors: outcome.errors.map(slimIssue), warnings };

  const png = values.out ?? defaultOut(input);
  fs.mkdirSync(path.dirname(path.resolve(png)), { recursive: true });
  fs.writeFileSync(png, outcome.png);
  const out = [png];
  if (values.html) {
    const html = png.replace(/\.png$/i, '') + '.html';
    fs.writeFileSync(html, outcome.html);
    out.push(html);
  }
  const layout = checkLayout(outcome.json, await measure(browser, outcome.html), containerTags);
  const scene = outcome.json.scene ?? { width: 0, height: 0 };
  return {
    input,
    ok: true,
    out,
    size: { width: Math.round(scene.width), height: Math.round(scene.height) },
    warnings,
    layout,
    clean: warnings.length === 0 && layout.length === 0,
  };
}

// ---------------------------------------------------------------------------------------------
// Layout check
//
// The engine's measured JSON gives each entity's own box, but an Icon's caption hangs outside
// that box and groups never grow to fit their children. So the check loads the rendered HTML
// and takes, for every entity, the union of everything it actually painted.

async function measure(browser, html) {
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    return await page.evaluate(() => {
      const boxes = {};
      for (const host of document.querySelectorAll('[data-mdp-id]')) {
        const id = host.dataset.mdpId;
        if (id.startsWith('@connection:')) continue;
        const own = host.getBoundingClientRect();
        let [l, t, r, b] = [own.left, own.top, own.right, own.bottom];
        const texts = [];
        for (const el of host.querySelectorAll('*')) {
          const bb = el.getBoundingClientRect();
          if (bb.width <= 0 || bb.height <= 0) continue;
          l = Math.min(l, bb.left);
          t = Math.min(t, bb.top);
          r = Math.max(r, bb.right);
          b = Math.max(b, bb.bottom);
          const words = [...el.childNodes]
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent.trim())
            .join(' ')
            .trim();
          if (words) texts.push({ x: bb.left, y: bb.top, w: bb.width, h: bb.height, text: words });
        }
        boxes[id] = { own: { x: own.left, y: own.top }, ink: { x: l, y: t, w: r - l, h: b - t }, texts };
      }
      return boxes;
    });
  } finally {
    await page.close();
  }
}

function intersect(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > TOUCH && h > TOUCH ? { w, h } : null;
}

function routeLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

// Length over which two routes run on top of each other (axis-aligned segments only).
function sharedRun(a, b) {
  let total = 0;
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      const [p, q, r, s] = [a[i - 1], a[i], b[j - 1], b[j]];
      const horizontal = Math.abs(p.y - q.y) < 0.5 && Math.abs(r.y - s.y) < 0.5 && Math.abs(p.y - r.y) <= TOUCH;
      const vertical = Math.abs(p.x - q.x) < 0.5 && Math.abs(r.x - s.x) < 0.5 && Math.abs(p.x - r.x) <= TOUCH;
      if (horizontal) {
        total += Math.max(0, Math.min(Math.max(p.x, q.x), Math.max(r.x, s.x)) - Math.max(Math.min(p.x, q.x), Math.min(r.x, s.x)));
      } else if (vertical) {
        total += Math.max(0, Math.min(Math.max(p.y, q.y), Math.max(r.y, s.y)) - Math.max(Math.min(p.y, q.y), Math.min(r.y, s.y)));
      }
    }
  }
  return total;
}

// Is the route segment nearest the label's centre vertical?
function labelSegmentIsVertical(c, b) {
  const centre = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const route = c.points.map((p) => ({ x: (c.x ?? 0) + p.x, y: (c.y ?? 0) + p.y }));
  let best = { distance: Infinity, vertical: false };
  for (let i = 1; i < route.length; i++) {
    const [p, q] = [route[i - 1], route[i]];
    const t = Math.max(0, Math.min(1, ((centre.x - p.x) * (q.x - p.x) + (centre.y - p.y) * (q.y - p.y)) / (Math.hypot(q.x - p.x, q.y - p.y) ** 2 || 1)));
    const distance = Math.hypot(centre.x - (p.x + t * (q.x - p.x)), centre.y - (p.y + t * (q.y - p.y)));
    if (distance < best.distance) best = { distance, vertical: Math.abs(q.y - p.y) > Math.abs(q.x - p.x) };
  }
  return best.vertical;
}

// Pull both ends of a route in by `by` px. The router attaches a line flush against the
// caption of the node it leaves or reaches; that contact is not a crossing.
function trimRoute(route, by) {
  const out = route.map((p) => ({ ...p }));
  const pull = (from, toward) => {
    const d = Math.hypot(toward.x - from.x, toward.y - from.y);
    if (d <= by) return;
    from.x += ((toward.x - from.x) / d) * by;
    from.y += ((toward.y - from.y) / d) * by;
  };
  if (out.length >= 2) {
    pull(out[0], out[1]);
    pull(out[out.length - 1], out[out.length - 2]);
  }
  return out;
}

// Liang–Barsky: does the segment p→q pass through rectangle r?
function segmentHitsRect(p, q, r) {
  const d = { x: q.x - p.x, y: q.y - p.y };
  let t0 = 0;
  let t1 = 1;
  const edges = [
    [-d.x, p.x - r.x],
    [d.x, r.x + r.w - p.x],
    [-d.y, p.y - r.y],
    [d.y, r.y + r.h - p.y],
  ];
  for (const [step, room] of edges) {
    if (step === 0) {
      if (room < 0) return false;
      continue;
    }
    const t = room / step;
    if (step < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

function checkLayout(json, dom, containerTags) {
  const entities = json.entities.filter((e) => dom[e.id]);
  if (entities.length === 0) return [];
  const byId = new Map(json.entities.map((e) => [e.id, e]));
  // DOM coordinates are the scene shifted by its margin; recover that shift from one entity.
  const dx = dom[entities[0].id].own.x - entities[0].x;
  const dy = dom[entities[0].id].own.y - entities[0].y;
  const isContainer = (e) => containerTags.has(e.tag) || e.isContainer === true;
  const textUnion = (e) => {
    const texts = dom[e.id].texts;
    if (texts.length === 0) return null;
    const l = Math.min(...texts.map((t) => t.x));
    const t = Math.min(...texts.map((r) => r.y));
    const r = Math.max(...texts.map((q) => q.x + q.w));
    const b = Math.max(...texts.map((q) => q.y + q.h));
    return { x: l - dx, y: t - dy, w: r - l, h: b - t };
  };
  const box = (e) => {
    if (isContainer(e)) return { x: e.x, y: e.y, w: e.width, h: e.height };
    // A divider is meant to cross things; only its label can collide.
    if (e.tag === 'Divider') return textUnion(e);
    const ink = dom[e.id].ink;
    return { x: ink.x - dx, y: ink.y - dy, w: ink.w, h: ink.h };
  };
  const routes = json.connections
    .filter((c) => c.points && c.points.length >= 2)
    .map((c) => ({
      c,
      ref: c.id ?? `${c.from}->${c.to}`,
      route: c.points.map((p) => ({ x: (c.x ?? 0) + p.x, y: (c.y ?? 0) + p.y })),
    }));
  const ancestors = (e) => {
    const seen = new Set();
    for (let c = e.containerId; c && !seen.has(c); c = byId.get(c)?.containerId) seen.add(c);
    return seen;
  };
  const name = (e) => `${e.tag} "${e.id}"`;
  const px = (n) => Math.round(n);
  const findings = [];

  // 1. A child that paints outside its container.
  for (const e of entities) {
    const parent = e.containerId ? byId.get(e.containerId) : null;
    const b = box(e);
    if (!parent || !b) continue;
    const p = box(parent);
    const over = {
      left: p.x - b.x,
      top: p.y - b.y,
      right: b.x + b.w - (p.x + p.w),
      bottom: b.y + b.h - (p.y + p.h),
    };
    const sides = Object.entries(over).filter(([, v]) => v > TOUCH);
    if (sides.length === 0) continue;
    const fixes = [];
    if (over.right > TOUCH) fixes.push(`width ≥ ${px(b.x + b.w + PAD - p.x)}`);
    if (over.bottom > TOUCH) fixes.push(`height ≥ ${px(b.y + b.h + PAD - p.y)}`);
    if (over.left > TOUCH) fixes.push(`move "${e.id}" right by ≥ ${px(over.left + PAD)}`);
    if (over.top > TOUCH) fixes.push(`move "${e.id}" down by ≥ ${px(over.top + PAD)}`);
    findings.push({
      code: 'outside-container',
      ids: [e.id, parent.id],
      message:
        `${name(e)} paints ${sides.map(([side, v]) => `${px(v)}px past the ${side}`).join(', ')} of ${name(parent)} ` +
        `(captions and text included). Fix: ${parent.id} ${fixes.join('; ')}.`,
    });
  }

  // 2. Two things overlapping that are not nested in each other.
  const solid = entities.filter((e) => box(e));
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i];
      const b = solid[j];
      if (ancestors(a).has(b.id) || ancestors(b).has(a.id)) continue;
      const divider = [a, b].find((e) => e.tag === 'Divider');
      if (divider && [a, b].some(isContainer)) continue;
      const hit = intersect(box(a), box(b));
      if (!hit) continue;
      const size = `${px(hit.w)}×${px(hit.h)}px`;
      let message;
      if (divider) {
        const other = divider === a ? b : a;
        message = `The label of ${name(divider)} overlaps ${name(other)} by ${size}. Move the divider or shorten its label.`;
      } else if (isContainer(a) && isContainer(b)) {
        message = `${name(a)} and ${name(b)} overlap by ${size}. Separate them, or nest one in the other with containerId.`;
      } else if (isContainer(a) || isContainer(b)) {
        const [c, n] = isContainer(a) ? [a, b] : [b, a];
        message = `${name(n)} sits on ${name(c)} (${size}) but is not inside it. Set "containerId": "${c.id}" or move it clear.`;
      } else {
        message = `${name(a)} and ${name(b)} overlap by ${size} (captions included). Move them apart.`;
      }
      findings.push({ code: 'overlap', ids: [a.id, b.id], message });
    }
  }

  // 3. Connection labels on nodes or on each other.
  const labels = json.connections
    .filter((c) => c.label && c.labelPlacement)
    .map((c) => ({
      c,
      ref: c.id ?? `${c.from}->${c.to}`,
      b: {
        x: (c.x ?? 0) + c.labelPlacement.x,
        y: (c.y ?? 0) + c.labelPlacement.y,
        w: c.labelPlacement.width ?? 0,
        h: c.labelPlacement.height ?? 0,
      },
    }));
  for (const { c, ref, b } of labels) {
    const length = c.points ? routeLength(c.points) : Infinity;
    // A label takes its width out of a horizontal run but only its height out of a vertical one.
    const along = c.points && labelSegmentIsVertical(c, b) ? b.h : b.w;
    if (length < along + LABEL_RUN) {
      findings.push({
        code: 'short-line',
        ids: [ref],
        message:
          `The ${c.from}→${c.to} connection is ${px(length)}px long for its label "${c.label}", so the label ` +
          `crowds both ends. Move the nodes apart to give it ≥ ${px(along + LABEL_RUN)}px, or drop the label.`,
      });
      continue;
    }
    const halo = { x: b.x - LABEL_CLEAR, y: b.y - LABEL_CLEAR, w: b.w + 2 * LABEL_CLEAR, h: b.h + 2 * LABEL_CLEAR };
    for (const e of solid) {
      if (isContainer(e)) continue;
      const on = intersect(b, box(e));
      if (!on && !intersect(halo, box(e))) continue;
      findings.push({
        code: on ? 'label-on-node' : 'label-crowded',
        ids: [ref, e.id],
        message:
          `Label "${c.label}" on ${c.from}→${c.to} ${on ? 'sits on' : `is within ${LABEL_CLEAR}px of`} ${name(e)}. ` +
          'Lengthen that connection (move its nodes apart) or shorten the label.',
      });
    }
  }
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      if (!intersect(labels[i].b, labels[j].b)) continue;
      findings.push({
        code: 'label-overlap',
        ids: [labels[i].ref, labels[j].ref],
        message: `Labels "${labels[i].c.label}" and "${labels[j].c.label}" overlap. Separate the two connections or pin different ports.`,
      });
    }
  }
  for (const { c, ref, b } of labels) {
    for (const other of routes) {
      if (other.c === c) continue;
      const segments = other.route.slice(1).map((q, i) => [other.route[i], q]);
      if (!segments.some(([p, q]) => segmentHitsRect(p, q, b))) continue;
      findings.push({
        code: 'line-through-label',
        ids: [other.ref, ref],
        message: `The ${other.c.from}→${other.c.to} connection runs through the label "${c.label}" of ${c.from}→${c.to}. Move a node or pin a port so the two routes part.`,
      });
    }
  }

  // Two connections drawn along the same stretch read as one line. A fan-out from one source or a
  // fan-in to one target sharing its trunk is deliberate, so only other pairs count.
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      const [a, b] = [routes[i], routes[j]];
      if (a.c.from === b.c.from || a.c.to === b.c.to) continue;
      const shared = sharedRun(a.route, b.route);
      if (shared <= SHARED_RUN) continue;
      findings.push({
        code: 'lines-overlap',
        ids: [a.ref, b.ref],
        message: `The ${a.c.from}→${a.c.to} and ${b.c.from}→${b.c.to} connections run along the same ${px(shared)}px, so they read as one line. Move a node or pin different ports.`,
      });
    }
  }

  // 4. A connection drawn across text. Routing avoids an Icon's 50px box but not the caption
  //    hanging under it, so a line leaving an Icon downwards runs through its own caption.
  for (const c of json.connections) {
    if (!c.points || c.points.length < 2) continue;
    const ox = c.x ?? 0;
    const oy = c.y ?? 0;
    const route = trimRoute(
      c.points.map((p) => ({ x: ox + p.x, y: oy + p.y })),
      2 * TOUCH,
    );
    const segments = route.slice(1).map((q, i) => [route[i], q]);
    for (const e of entities) {
      const crossed = dom[e.id].texts.find((t) => {
        // Grow by TOUCH: a line grazing the last letter reads as touching it.
        const r = { x: t.x - dx - TOUCH, y: t.y - dy - TOUCH, w: t.w + 2 * TOUCH, h: t.h + 2 * TOUCH };
        return segments.some(([p, q]) => segmentHitsRect(p, q, r));
      });
      if (!crossed) continue;
      findings.push({
        code: 'line-through-text',
        ids: [c.id ?? `${c.from}->${c.to}`, e.id],
        message:
          `The ${c.from}→${c.to} connection runs through the text "${crossed.text.slice(0, 40)}" of ${name(e)}. ` +
          (e.tag === 'Icon'
            ? 'Icon captions hang below the icon and routing does not avoid them: lay the two nodes out side by side, or pin fromPort/toPort to a side.'
            : 'Move the nodes so the route clears it, or pin fromPort/toPort.'),
      });
    }
  }

  // 5. A shape left to size itself around its text comes out cramped (a diamond collapses).
  for (const e of entities) {
    if (e.tag !== 'Shape' || !e.texts?.length) continue;
    if (e.width >= MIN_TEXT_SHAPE && e.height >= MIN_TEXT_SHAPE) continue;
    findings.push({
      code: 'too-small',
      ids: [e.id],
      message: `${name(e)} renders at only ${px(e.width)}×${px(e.height)}px. Give it an explicit width and height (a diamond needs about 140×90).`,
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------------------------
// icons

// Names people say that the catalog spells differently.
const ICON_ALIASES = {
  s3: 'simple storage service',
  'aws s3': 'aws simple storage service',
  email: 'mail',
  'e-mail': 'mail',
  blob: 'storage accounts',
  'blob storage': 'storage accounts',
  aad: 'entra',
  'azure ad': 'entra',
  'active directory': 'entra',
};

function rankIcons(names, query) {
  const tokens = query.toLowerCase().split(/[\s_-]+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const joined = tokens.join('-');
  const scored = [];
  for (const n of names) {
    const lower = n.toLowerCase();
    if (!tokens.every((t) => lower.includes(t))) continue;
    const parts = lower.split(/[-_]/);
    let score = 0;
    if (lower === joined) score = 100;
    else if (parts.includes(joined) || lower.endsWith(`-${joined}`)) score = 60;
    else if (lower.startsWith(joined)) score = 50;
    else if (tokens.every((t) => parts.includes(t))) score = 30;
    scored.push([score - lower.length / 100, n]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1]));
  return scored.map(([, n]) => n);
}

// Names matching the most words of the query, for when no name matches all of them.
function partialIcons(names, query) {
  const tokens = query.toLowerCase().split(/[\s_-]+/).filter((t) => t.length > 1);
  const scored = names
    .map((n) => [tokens.filter((t) => n.toLowerCase().split(/[-_]/).includes(t)).length, n])
    .filter(([count]) => count > 0);
  scored.sort((a, b) => b[0] - a[0] || a[1].length - b[1].length);
  return scored.map(([, n]) => n);
}

function searchIcons(names, query) {
  const alias = ICON_ALIASES[query.toLowerCase().trim()];
  const hits = [...new Set([...(alias ? rankIcons(names, alias) : []), ...rankIcons(names, query)])];
  return hits.length ? { hits, partial: false } : { hits: partialIcons(names, query), partial: true };
}

async function icons(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { limit: { type: 'string', default: '12' }, refresh: { type: 'boolean', default: false } },
  });
  if (values.refresh) return refreshIcons();
  if (positionals.length === 0) fail('icons needs at least one query, e.g. icons cosmos "key vault" postgres');
  const names = fs.readFileSync(ICON_INDEX, 'utf8').split('\n').filter(Boolean);
  const limit = Number(values.limit) || 12;
  for (const query of positionals) {
    const { hits, partial } = searchIcons(names, query);
    const shown = hits.slice(0, limit).join(', ');
    const more = hits.length > limit ? ` (+${hits.length - limit} more)` : '';
    const line = hits.length
      ? `${partial ? '(no name has every word; closest) ' : ''}${shown}${more}`
      : '(no match — try a synonym, or a vendor prefix: azure-, aws-, gcp-)';
    process.stdout.write(`${query}: ${line}\n`);
  }
}

async function refreshIcons() {
  const names = [];
  let pageToken;
  do {
    const query = new URLSearchParams({ prefix: 'canvas-icons/', maxResults: '1000', fields: 'items(name),nextPageToken' });
    if (pageToken) query.set('pageToken', pageToken);
    const response = await fetch(`${ICON_LISTING}?${query}`);
    if (!response.ok) fail(`icon listing failed: HTTP ${response.status}`);
    const page = await response.json();
    for (const { name } of page.items ?? []) {
      const file = name.slice('canvas-icons/'.length);
      if (file.endsWith('.svg') && !file.includes('/')) names.push(file.slice(0, -4));
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  if (names.length === 0) fail('icon listing returned no icons; leaving the index untouched.');
  names.sort();
  fs.writeFileSync(ICON_INDEX, `${names.join('\n')}\n`);
  process.stdout.write(`${names.length} icons written to ${ICON_INDEX}\n`);
}

// ---------------------------------------------------------------------------------------------
// doctor and pass-through

async function doctor() {
  const home = engineHome();
  const browser = findBrowser();
  let iconHost = 'unreachable';
  try {
    const r = await fetch('https://storage.googleapis.com/eraser-public-assets/canvas-icons/server.svg', { method: 'HEAD' });
    iconHost = r.ok ? 'ok' : `HTTP ${r.status}`;
  } catch (error) {
    iconHost = `unreachable (${error.message})`;
  }
  const report = {
    node: process.versions.node,
    engine: { version: ENGINE_VERSION, home, installed: engineInstalled(home) },
    browser: browser ?? (process.env.CHROMIUM_PATH ? `CHROMIUM_PATH "${process.env.CHROMIUM_PATH}" does not exist` : null),
    iconHost,
    icons: fs.existsSync(ICON_INDEX) ? fs.readFileSync(ICON_INDEX, 'utf8').split('\n').filter(Boolean).length : 0,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.engine.installed && browser && iconHost === 'ok' ? 0 : 1;
}

// The references and examples are printed through this script rather than read directly: they sit
// outside the user's project, where a file read needs approval, and this command is pre-approved.
const GUIDES = { format: 'references/format.md', layout: 'references/layout.md' };

function guide([name]) {
  if (!GUIDES[name]) fail(`guide takes one of: ${Object.keys(GUIDES).join(', ')}`);
  process.stdout.write(fs.readFileSync(path.join(SKILL_DIR, GUIDES[name]), 'utf8'));
}

function example([name]) {
  const dir = path.join(SKILL_DIR, 'examples');
  const names = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.diagram.json'))
    .map((f) => f.slice(0, -'.diagram.json'.length));
  if (!names.includes(name)) fail(`example takes one of: ${names.join(', ')}`);
  process.stdout.write(fs.readFileSync(path.join(dir, `${name}.diagram.json`), 'utf8'));
}

function passThrough(argv) {
  const home = ensureEngine();
  const run = spawnSync(process.execPath, [cliPath(home), ...argv], { stdio: 'inherit' });
  process.exitCode = run.status ?? 2;
}

// ---------------------------------------------------------------------------------------------

requireNode();
const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case 'render':
    await render(rest);
    break;
  case 'icons':
    await icons(rest);
    break;
  case 'doctor':
    await doctor();
    break;
  case 'guide':
    guide(rest);
    break;
  case 'example':
    example(rest);
    break;
  case 'schema':
  case 'registry':
  case 'validate':
    passThrough([command, ...rest]);
    break;
  default:
    fail(
      'usage: eraser.mjs render <diagram.json...> [-o out.png] [--scale 2] [--html] [--transparent] [--strict]\n' +
        '       eraser.mjs icons <query...> [--limit 12] | icons --refresh\n' +
        '       eraser.mjs guide format|layout | example <name>\n' +
        '       eraser.mjs schema <Tag> | registry | validate <diagram.json> | doctor',
    );
}
