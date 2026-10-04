// Builds the HIAS diagrams from the signal lists below.
// Outputs (in milestone-1/diagrams/): <name>.svg, <name>.drawio (editable in diagrams.net), <name>.png
//
//   node tools/build_diagrams.mjs
//
// To change a signal, edit INPUTS / OUTPUTS / HARDWARE and re-run. Keep names in sync with
// milestone-1/HIAS_Milestone1.md (Section 2). Figure 2's labels are written directly in systemContext().

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'milestone-1', 'diagrams');
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// Signal data. status: 'agreed' (matches the other team's doc), 'expected' (other team
// has not confirmed yet), 'proposed' (new in this revision, needs the other team's OK).
// ---------------------------------------------------------------------------
const INPUTS = [
  { group: 'From Autonomous Vehicle Control', signals: [
    { name: 'cmd_speed', meta: 'm/s · single · 50 Hz', status: 'agreed' },
    { name: 'cmd_steering_angle', meta: 'rad · single · 50 Hz', status: 'agreed' },
  ] },
  { group: 'From Perception & Sensor Fusion', signals: [
    { name: 'obstacle_distance', meta: 'm · single · 20 Hz', status: 'proposed' },
    { name: 'obstacle_ttc', meta: 's · single · 20 Hz', status: 'expected' },
    { name: 'sensor_valid', meta: 'boolean · 20 Hz', status: 'proposed' },
  ] },
  { group: 'From Motion Planning', signals: [
    { name: 'planner_heartbeat', meta: 'uint32 counter · 20 Hz', status: 'expected' },
  ] },
];

const OUTPUTS = [
  { group: 'Actuator feedback', signals: [
    { name: 'fbk_wheel_speed', meta: 'm/s · 100 Hz  →  AVC, Perception', status: 'agreed' },
    { name: 'fbk_actual_steering', meta: 'rad · 50 Hz  →  AVC', status: 'agreed' },
  ] },
  { group: 'Safety status  →  AVC, Planning, Perception', signals: [
    { name: 'emergency_stop', meta: 'boolean · 100 Hz', status: 'proposed', emphasis: true },
    { name: 'safety_supervisory_state', meta: 'uint8 enum · 100 Hz', status: 'agreed' },
    { name: 'hw_hardware_health', meta: 'uint16 bitmask · 10 Hz', status: 'agreed' },
  ] },
  { group: 'Telemetry  →  all teams (for information)', signals: [
    { name: 'battery_rail_voltage', meta: 'V · single · 10 Hz', status: 'proposed' },
  ] },
  { group: 'Operator buttons (from remote)  →  AVC', signals: [
    { name: 'user_on · user_off', meta: 'boolean, TRUE while held · 20 Hz', status: 'proposed' },
    { name: 'user_inc · user_dec', meta: 'boolean, TRUE while held · 20 Hz', status: 'proposed' },
    { name: 'user_setspeed', meta: 'm/s · single · 20 Hz', status: 'proposed' },
  ] },
];

// Physical (electrical) I/O along the bottom edge. dir: 'in' = into HIAS, 'out' = out of HIAS.
const HARDWARE = [
  { label: ['Remote control', '(RC transmitter', 'or phone app)'], wire: ['e-stop, buttons,', 'link status'], dir: 'in' },
  { label: ['Wheel speed', 'sensor'], wire: ['pulses'], dir: 'in' },
  { label: ['Drive battery', '(2S LiPo, TBD)'], wire: ['voltage', '(ADC)'], dir: 'in' },
  { label: ['ESC +', 'drive motor'], wire: ['PWM'], dir: 'out' },
  { label: ['Steering', 'servo'], wire: ['PWM'], dir: 'out' },
];

const INTERNAL = [
  ['Input checks', 'range · NaN · staleness timeouts'],
  ['Safety supervisor (Stateflow)', 'STANDBY · ACTIVE · AEB · E-STOP · SAFE STOP'],
  ['Command gate (override)', 'AVC\'s speed command passes only in ACTIVE;', 'otherwise HIAS stops the vehicle'],
  ['Actuator drivers + feedback', 'PWM out · wheel speed · steering est. · battery'],
];

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
const C = {
  ink: '#1e293b', sub: '#64748b', line: '#334155', groupFill: '#f8fafc', groupStroke: '#cbd5e1',
  boxFill: '#ffffff', innerFill: '#f1f5f9', innerStroke: '#94a3b8',
  prop: '#b45309', propFill: '#fef3c7', exp: '#475569', hw: '#64748b', bg: '#ffffff', estop: '#b91c1c',
};
const SANS = 'Helvetica, Arial, sans-serif';
const MONO = 'Menlo, Consolas, \'DejaVu Sans Mono\', monospace';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A tiny scene graph shared by the SVG and draw.io writers.
class Scene {
  constructor(w, h) { this.w = w; this.h = h; this.items = []; }
  rect(o) { this.items.push({ t: 'rect', ...o }); }
  text(o) { this.items.push({ t: 'text', ...o }); }
  arrow(o) { this.items.push({ t: 'arrow', ...o }); }
}

function svgOf(sc) {
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${sc.w}" height="${sc.h}" viewBox="0 0 ${sc.w} ${sc.h}" font-family="${SANS}">`);
  out.push(`<defs>
  <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${C.line}"/></marker>
  <marker id="ahp" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${C.prop}"/></marker>
  <marker id="ahh" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${C.hw}"/></marker>
  <marker id="ahe" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${C.estop}"/></marker>
</defs>`);
  out.push(`<rect x="0" y="0" width="${sc.w}" height="${sc.h}" fill="${C.bg}"/>`);
  for (const it of sc.items) {
    if (it.t === 'rect') {
      out.push(`<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" rx="${it.r ?? 6}" fill="${it.fill ?? 'none'}" stroke="${it.stroke ?? C.line}" stroke-width="${it.sw ?? 1.5}"${it.dash ? ` stroke-dasharray="${it.dash}"` : ''}/>`);
    } else if (it.t === 'text') {
      const lines = Array.isArray(it.text) ? it.text : [it.text];
      const lh = it.lh ?? (it.size ?? 13) * 1.25;
      const anchor = it.anchor ?? 'start';
      const y0 = it.y - ((lines.length - 1) * lh) / 2 * (it.vcenter ? 1 : 0);
      lines.forEach((ln, i) => {
        out.push(`<text x="${it.x}" y="${(y0 + i * lh).toFixed(1)}" font-size="${it.size ?? 13}" fill="${it.color ?? C.ink}" text-anchor="${anchor}" dominant-baseline="middle"${it.bold ? ' font-weight="700"' : ''}${it.mono ? ` font-family="${MONO}"` : ''}${it.italic ? ' font-style="italic"' : ''}>${esc(ln)}</text>`);
      });
    } else if (it.t === 'arrow') {
      const pts = it.pts.map(p => p.join(',')).join(' ');
      const m = it.marker ?? 'ah';
      out.push(`<polyline points="${pts}" fill="none" stroke="${it.color ?? C.line}" stroke-width="${it.sw ?? 1.6}"${it.dash ? ` stroke-dasharray="${it.dash}"` : ''} marker-end="url(#${m})"/>`);
    }
  }
  out.push('</svg>');
  return out.join('\n');
}

function drawioOf(sc, name) {
  let id = 2;
  const cells = [];
  const xs = s => esc(s);
  for (const it of sc.items) {
    if (it.t === 'rect') {
      const style = `rounded=1;arcSize=${Math.min(20, Math.round(((it.r ?? 6) / Math.min(it.w, it.h)) * 100))};whiteSpace=wrap;html=1;fillColor=${it.fill && it.fill !== 'none' ? it.fill : 'none'};strokeColor=${it.stroke ?? C.line};strokeWidth=${it.sw ?? 1.5};${it.dash ? 'dashed=1;' : ''}`;
      cells.push(`<mxCell id="c${id++}" value="" style="${xs(style)}" vertex="1" parent="1"><mxGeometry x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" as="geometry"/></mxCell>`);
    } else if (it.t === 'text') {
      const lines = Array.isArray(it.text) ? it.text : [it.text];
      const size = it.size ?? 13;
      const lh = it.lh ?? size * 1.25;
      const h = Math.ceil(lines.length * lh + 4);
      const w = it.w ?? Math.ceil(Math.max(...lines.map(l => l.length)) * size * (it.mono ? 0.62 : 0.56) + 8);
      const align = { start: 'left', middle: 'center', end: 'right' }[it.anchor ?? 'start'];
      const x = align === 'left' ? it.x : align === 'center' ? it.x - w / 2 : it.x - w;
      const yTop = it.vcenter ? it.y - h / 2 : it.y - lh / 2 - 2;
      const font = it.mono ? 'fontFamily=Courier New;' : 'fontFamily=Helvetica;';
      const style = `text;html=1;strokeColor=none;fillColor=none;align=${align};verticalAlign=middle;whiteSpace=nowrap;${font}fontSize=${size};fontColor=${it.color ?? C.ink};${it.bold ? 'fontStyle=1;' : it.italic ? 'fontStyle=2;' : ''}spacing=0;`;
      cells.push(`<mxCell id="c${id++}" value="${xs(lines.map(esc).join('<br>'))}" style="${xs(style)}" vertex="1" parent="1"><mxGeometry x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${w}" height="${h}" as="geometry"/></mxCell>`);
    } else if (it.t === 'arrow') {
      const [s, ...rest] = it.pts;
      const t = rest.pop();
      const style = `endArrow=block;endFill=1;html=1;rounded=0;strokeColor=${it.color ?? C.line};strokeWidth=${it.sw ?? 1.6};${it.dash ? 'dashed=1;' : ''}`;
      const via = rest.length ? `<Array as="points">${rest.map(p => `<mxPoint x="${p[0]}" y="${p[1]}"/>`).join('')}</Array>` : '';
      cells.push(`<mxCell id="c${id++}" value="" style="${xs(style)}" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="${s[0]}" y="${s[1]}" as="sourcePoint"/><mxPoint x="${t[0]}" y="${t[1]}" as="targetPoint"/>${via}</mxGeometry></mxCell>`);
    }
  }
  return `<mxfile host="build_diagrams.mjs"><diagram name="${esc(name)}" id="${esc(name)}"><mxGraphModel dx="${sc.w}" dy="${sc.h}" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${sc.w}" pageHeight="${sc.h}" background="#ffffff" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}</root></mxGraphModel></diagram></mxfile>\n`;
}

const statusColor = s => (s === 'proposed' ? C.prop : C.line);
const marker = s => (s === 'proposed' ? 'ahp' : 'ah');

// ---------------------------------------------------------------------------
// Figure 1: HIAS I/O block diagram
// ---------------------------------------------------------------------------
function hiasIO() {
  const W = 1400, H = 1040;
  const sc = new Scene(W, H);
  const GX0 = 30, GW = 360;            // left group column
  const BX = 490, BW = 420;            // HIAS box
  const RX = BX + BW + 100, RW = 360;  // right group column
  const ROW = 48, HEAD = 32, PAD = 10, GAP = 14, TOP = 100;

  sc.text({ x: W / 2, y: 34, text: 'Hardware Integration & Active Safety (HIAS) — Milestone 1 I/O Diagram', size: 23, bold: true, anchor: 'middle' });
  sc.text({ x: W / 2, y: 66, text: 'Inputs → HIAS → Outputs.  Solid = signal exchanged with another team.  Dashed = physical wiring owned by HIAS.', size: 15, color: C.sub, anchor: 'middle' });

  function column(groups, x0, side) {
    let y = TOP;
    const rows = [];
    for (const g of groups) {
      const h = HEAD + g.signals.length * ROW + PAD;
      sc.rect({ x: x0, y, w: GW, h, fill: C.groupFill, stroke: C.groupStroke, sw: 1 });
      sc.text({ x: x0 + 12, y: y + 18, text: g.group, size: 13.5, bold: true, color: C.sub });
      g.signals.forEach((s, i) => {
        const cy = y + HEAD + i * ROW + ROW / 2;
        if (s.status === 'proposed') sc.rect({ x: x0 + 6, y: cy - ROW / 2 + 3, w: GW - 12, h: ROW - 6, fill: C.propFill, stroke: C.propFill, sw: 1, r: 4 });
        sc.text({ x: x0 + 14, y: cy - 9, text: s.name, size: 16, bold: true, mono: true, color: s.emphasis ? C.estop : C.ink });
        sc.text({ x: x0 + 14, y: cy + 12, text: s.meta + (s.status === 'proposed' ? '   [proposed]' : s.status === 'expected' ? '   [expected]' : ''), size: 13, color: s.status === 'proposed' ? C.prop : C.sub });
        rows.push({ cy, s });
      });
      y += h + GAP;
    }
    rows.forEach(({ cy, s }) => {
      const col = s.emphasis ? C.estop : statusColor(s.status);
      const mk = s.emphasis ? 'ahe' : marker(s.status);
      if (side === 'left') sc.arrow({ pts: [[x0 + GW, cy], [BX, cy]], color: col, marker: mk, sw: s.emphasis ? 2.4 : 1.6 });
      else sc.arrow({ pts: [[BX + BW, cy], [x0, cy]], color: col, marker: mk, sw: s.emphasis ? 2.4 : 1.6 });
    });
    return y - GAP;
  }

  const leftBottom = column(INPUTS, GX0, 'left');
  const rightBottom = column(OUTPUTS, RX, 'right');
  const boxBottom = Math.max(leftBottom, rightBottom);

  // HIAS box
  sc.rect({ x: BX, y: TOP, w: BW, h: boxBottom - TOP, fill: C.boxFill, stroke: C.line, sw: 2.5, r: 10 });
  sc.text({ x: BX + BW / 2, y: TOP + 32, text: 'Hardware Integration &', size: 21, bold: true, anchor: 'middle' });
  sc.text({ x: BX + BW / 2, y: TOP + 58, text: 'Active Safety (HIAS)', size: 21, bold: true, anchor: 'middle' });
  const innerTop = TOP + 82, innerH = (boxBottom - innerTop - 20 - 3 * 18) / 4;
  INTERNAL.forEach((lines, i) => {
    const y = innerTop + i * (innerH + 18);
    sc.rect({ x: BX + 28, y, w: BW - 56, h: innerH, fill: C.innerFill, stroke: C.innerStroke, sw: 1, r: 6 });
    const [title, ...rest] = lines;
    const block = [title, ...rest];
    const lh = 19;
    const startY = y + innerH / 2 - ((block.length - 1) * lh) / 2;
    sc.text({ x: BX + BW / 2, y: startY, text: title, size: 15, bold: true, anchor: 'middle' });
    rest.forEach((ln, j) => sc.text({ x: BX + BW / 2, y: startY + (j + 1) * lh, text: ln, size: 13, color: C.sub, anchor: 'middle' }));
    if (i < INTERNAL.length - 1) sc.arrow({ pts: [[BX + BW / 2, y + innerH], [BX + BW / 2, y + innerH + 18]], color: C.innerStroke, sw: 1.2 });
  });

  // Physical hardware along the bottom
  const hwTop = boxBottom + 125, hwH = 74, hwW = 136;
  const n = HARDWARE.length;
  const span = BW + 330;
  const step = span / n;
  HARDWARE.forEach((h, i) => {
    const cx = BX - 165 + step * (i + 0.5);
    const bx = Math.max(BX + 30, Math.min(BX + BW - 30, BX + 40 + (BW - 80) * (i / (n - 1))));
    sc.rect({ x: cx - hwW / 2, y: hwTop, w: hwW, h: hwH, fill: '#ffffff', stroke: C.hw, sw: 1.5, dash: '6 4' });
    sc.text({ x: cx, y: hwTop + hwH / 2, text: h.label, size: 14, anchor: 'middle', vcenter: true, lh: 17, bold: false });
    const midY = boxBottom + 60;
    const pts = h.dir === 'in' ? [[cx, hwTop], [cx, midY], [bx, midY], [bx, boxBottom]] : [[bx, boxBottom], [bx, midY], [cx, midY], [cx, hwTop]];
    // drop the redundant elbow when the box sits directly under the attach point
    const clean = Math.abs(cx - bx) < 1 ? [pts[0], pts[3]] : pts;
    sc.arrow({ pts: clean, color: C.hw, dash: '6 4', marker: 'ahh', sw: 1.6 });
    sc.text({ x: cx + 8, y: hwTop - 30, text: h.wire, size: 13, color: C.sub, lh: 15, vcenter: true });
  });
  const captionY = hwTop + hwH + 28;
  sc.text({ x: BX + BW / 2, y: captionY, text: 'Physical vehicle hardware (prebuilt RC-car layout assumed; microcontroller TBD — see Team 4 Questions)', size: 14, color: C.sub, anchor: 'middle', italic: true });

  // Legend (two rows, fixed column positions so labels never collide)
  const rowsY = [captionY + 52, captionY + 86];
  sc.h = rowsY[1] + 30; // canvas height follows the content
  const cols = [30, 470, 1010];
  const entries = [
    [x => sc.arrow({ pts: [[x, 0], [x + 46, 0]] }), 'Signal exchanged with another team'],
    [x => sc.arrow({ pts: [[x, 0], [x + 46, 0]], color: C.prop, marker: 'ahp' }), '[proposed] new — needs the other team\'s OK'],
    [x => sc.arrow({ pts: [[x, 0], [x + 46, 0]], color: C.estop, marker: 'ahe', sw: 2.4 }), 'Primary safety override output'],
    [x => sc.arrow({ pts: [[x, 0], [x + 46, 0]], color: C.hw, marker: 'ahh', dash: '6 4' }), 'Physical wiring owned by HIAS'],
    [null, '[expected] = our assumption; the other team has not confirmed'],
  ];
  entries.forEach(([draw, label], k) => {
    const x = cols[k % 3], y = rowsY[Math.floor(k / 3)];
    if (draw) {
      const before = sc.items.length;
      draw(x);
      sc.items.slice(before).forEach(it => { it.pts = it.pts.map(([px]) => [px, y]); });
    }
    sc.text({ x: draw ? x + 56 : x, y, text: label, size: 13.5, color: C.sub });
  });
  return sc;
}

// ---------------------------------------------------------------------------
// Figure 2: where HIAS sits in the class architecture
// ---------------------------------------------------------------------------
function systemContext() {
  const W = 1700, H = 500;
  const sc = new Scene(W, H);
  sc.text({ x: W / 2, y: 30, text: 'System context — HIAS sits between Vehicle Control and the actuators, so its override does not depend on any other team', size: 20, bold: true, anchor: 'middle' });
  const y = 200, h = 96, w = 170;
  const boxes = [
    { k: 'sen', x: 20, label: ['Sensors'], w: 150 },
    { k: 'per', x: 270, label: ['Perception &', 'Sensor Fusion'] },
    { k: 'mp', x: 540, label: ['Motion', 'Planning'] },
    { k: 'avc', x: 810, label: ['Autonomous', 'Vehicle Control'] },
    { k: 'hias', x: 1190, label: ['HIAS', 'safety supervisor +', 'command gate'], w: 220, bold: true },
    { k: 'act', x: 1500, label: ['Motor (ESC) &', 'steering servo'], w: 180, dash: true },
  ];
  const B = Object.fromEntries(boxes.map(b => [b.k, { ...b, w: b.w ?? w }]));
  for (const b of Object.values(B)) {
    sc.rect({ x: b.x, y, w: b.w, h, fill: b.k === 'hias' ? C.innerFill : '#fff', stroke: b.dash ? C.hw : C.line, sw: b.k === 'hias' ? 2.5 : 1.5, dash: b.dash ? '6 4' : undefined, r: 8 });
    sc.text({ x: b.x + b.w / 2, y: y + h / 2, text: b.label, size: 17, anchor: 'middle', vcenter: true, lh: 21, bold: b.k === 'hias' });
  }
  const mid = y + h / 2;
  const chain = (a, b, label) => {
    sc.arrow({ pts: [[B[a].x + B[a].w, mid], [B[b].x, mid]] });
    sc.text({ x: (B[a].x + B[a].w + B[b].x) / 2, y: mid - 14, text: label, size: 15, color: C.sub, anchor: 'middle', mono: true });
  };
  chain('sen', 'per', 'raw data');
  chain('per', 'mp', 'obstacles');
  chain('mp', 'avc', 'desired_*');
  sc.arrow({ pts: [[B.avc.x + B.avc.w, mid - 14], [B.hias.x, mid - 14]] });
  sc.text({ x: (B.avc.x + B.avc.w + B.hias.x) / 2, y: mid - 40, text: ['cmd_speed', 'cmd_steering_angle'], size: 15, color: C.sub, anchor: 'middle', mono: true, lh: 18, vcenter: true });
  sc.arrow({ pts: [[B.hias.x, mid + 18], [B.avc.x + B.avc.w, mid + 18]] });
  sc.text({ x: (B.avc.x + B.avc.w + B.hias.x) / 2, y: mid + 44, text: ['fbk_wheel_speed', 'fbk_actual_steering'], size: 15, color: C.sub, anchor: 'middle', mono: true, lh: 18, vcenter: true });
  sc.arrow({ pts: [[B.hias.x + B.hias.w, mid], [B.act.x, mid]], color: C.hw, marker: 'ahh', dash: '6 4' });
  sc.text({ x: (B.hias.x + B.hias.w + B.act.x) / 2, y: mid - 14, text: 'PWM', size: 15, color: C.sub, anchor: 'middle' });

  // Perception + Planning -> HIAS (below)
  const lowY = y + h + 60;
  const perX = B.per.x + B.per.w / 2, mpX = B.mp.x + B.mp.w / 2;
  sc.arrow({ pts: [[perX, y + h], [perX, lowY + 30], [B.hias.x + 60, lowY + 30], [B.hias.x + 60, y + h]] });
  sc.text({ x: perX + 10, y: lowY + 46, text: 'obstacle_distance, obstacle_ttc, sensor_valid', size: 15, color: C.sub, mono: true });
  sc.arrow({ pts: [[mpX, y + h], [mpX, lowY], [B.hias.x + 30, lowY], [B.hias.x + 30, y + h]] });
  sc.text({ x: mpX + 10, y: lowY - 12, text: 'planner_heartbeat', size: 15, color: C.sub, mono: true });

  // Remote control -> HIAS
  const rcY = lowY + 70;
  sc.rect({ x: B.hias.x + 20, y: rcY, w: 180, h: 46, fill: '#fff', stroke: C.hw, dash: '6 4' });
  sc.text({ x: B.hias.x + 110, y: rcY + 23, text: 'Remote control', size: 16, anchor: 'middle' });
  sc.arrow({ pts: [[B.hias.x + 180, rcY], [B.hias.x + 180, y + h]], color: C.hw, marker: 'ahh', dash: '6 4' });
  sc.text({ x: B.hias.x + 190, y: rcY - 22, text: 'e-stop, buttons', size: 15, color: C.sub });

  // HIAS -> everyone (above)
  const topY = y - 70;
  const drops = [B.per, B.mp, B.avc].map(b => b.x + b.w / 2);
  sc.arrow({ pts: [[B.hias.x + B.hias.w / 2, y], [B.hias.x + B.hias.w / 2, topY], [drops[0], topY], [drops[0], y]], color: C.estop, marker: 'ahe', sw: 2.2 });
  sc.arrow({ pts: [[drops[1], topY], [drops[1], y]], color: C.estop, marker: 'ahe', sw: 2.2 });
  sc.arrow({ pts: [[drops[2], topY], [drops[2], y]], color: C.estop, marker: 'ahe', sw: 2.2 });
  sc.text({ x: (drops[1] + drops[2]) / 2, y: topY - 16, text: 'emergency_stop, safety_supervisory_state, hw_hardware_health', size: 15, color: C.estop, mono: true, anchor: 'middle' });
  return sc;
}

for (const [name, sc] of [['hias_io_diagram', hiasIO()], ['system_context', systemContext()]]) {
  writeFileSync(join(OUT, `${name}.svg`), svgOf(sc));
  writeFileSync(join(OUT, `${name}.drawio`), drawioOf(sc, name));
}

// PNG export via Playwright's Chromium (preinstalled in the dev container; optional elsewhere).
try {
  // createRequire honours NODE_PATH, so a globally installed playwright works too.
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  for (const name of ['hias_io_diagram', 'system_context']) {
    const svg = readFileSync(join(OUT, `${name}.svg`), 'utf8');
    const w = +svg.match(/width="(\d+)"/)[1], h = +svg.match(/height="(\d+)"/)[1];
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
    await page.screenshot({ path: join(OUT, `${name}.png`), clip: { x: 0, y: 0, width: w, height: h } });
  }
  await browser.close();
  console.log('wrote svg, drawio, png');
} catch (e) {
  console.log('wrote svg + drawio; PNG skipped (playwright unavailable):', e.message);
}
