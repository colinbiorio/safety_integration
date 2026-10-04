// Converts the Markdown subset used in this repo's milestone docs into a Word .docx.
//
//   node tools/md2docx.mjs milestone-1/HIAS_Milestone1.md milestone-1/HIAS_Milestone1.docx
//
// Supported: # / ## / ### / #### headings, paragraphs, - and 1. lists (two levels, indent 2+ spaces),
// pipe tables, ![caption](image.png), **bold**, *italic*, `code`, > notes, --- page breaks
// (a line with only "\pagebreak" also forces one), "\landscape" / "\portrait" lines (start a new
// section in that orientation), and <!-- comments --> (dropped; use them to hide the markers on GitHub).
// Requires the `docx` npm package (preinstalled in the Claude Code container; else `npm i docx`).

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType,
  ShadingType, BorderStyle, ImageRun, AlignmentType, LevelFormat, PageBreak, Footer, PageNumber,
  TableLayoutType, PageOrientation,
} = require('docx');

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: node tools/md2docx.mjs <in.md> <out.docx>');
  process.exit(1);
}
const baseDir = dirname(resolve(inPath));
const src = readFileSync(inPath, 'utf8')
  .replace(/<!--\s*(\\(?:landscape|portrait|pagebreak))\s*-->/g, '$1') // keep layout markers hidden in comments
  .replace(/<!--[\s\S]*?-->/g, '');

// US Letter, 1" margins -> 6.5" text width.
const PAGE_W = 12240, MARGIN = 1440, TEXT_W = PAGE_W - 2 * MARGIN;
const FONT = 'Calibri', MONO = 'Consolas';
const INK = '1E293B', SUB = '475569', RULE = 'CBD5E1', HEAD_FILL = 'E2E8F0', NOTE_FILL = 'F1F5F9';

// ---------------------------------------------------------------- inline formatting
function runs(text, base = {}) {
  const out = [];
  // tokens: `code`, **bold**, *italic*
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g;
  let last = 0, m;
  const push = (t, o = {}) => { if (t) out.push(new TextRun({ text: t, font: FONT, color: INK, ...base, ...o })); };
  while ((m = re.exec(text))) {
    push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('`')) push(tok.slice(1, -1), { font: MONO, size: (base.size ?? 22) - 2 });
    else if (tok.startsWith('**')) {
      // allow `code` inside bold
      const inner = tok.slice(2, -2);
      for (const r of runs(inner, { ...base, bold: true })) out.push(r);
    } else push(tok.slice(1, -1), { italics: true });
    last = m.index + tok.length;
  }
  push(text.slice(last));
  return out;
}

// ---------------------------------------------------------------- block parsing
const lines = src.split('\n');
const sections = [{ landscape: false, children: [] }];
let children = sections[0].children;
let i = 0;
let imageCount = 0;
let listInstance = 0;
const textWidth = () => (sections[sections.length - 1].landscape ? 15840 - 2 * MARGIN : TEXT_W);
const textHeight = () => (sections[sections.length - 1].landscape ? PAGE_W - 2 * MARGIN : 15840 - 2 * MARGIN);

const para = (text, opts = {}) => new Paragraph({ children: runs(text, opts.run), spacing: { after: 120, line: 276 }, ...opts.p });

function cell(text, { header = false, width }) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: header ? { type: ShadingType.CLEAR, color: 'auto', fill: HEAD_FILL } : undefined,
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
    children: text.split(/<br\s*\/?>/i).map(t => new Paragraph({
      children: runs(t.trim(), { size: 18, bold: header || undefined }),
      spacing: { after: 0, line: 252 },
    })),
  });
}

function parseRow(l) {
  return l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
}

function table(rows, tw) {
  const header = rows[0];
  const body = rows.slice(2); // skip separator
  const n = header.length;
  const plain = t => (t ?? '').replace(/[`*]/g, '').replace(/<br\s*\/?>/gi, ' ');
  const colTexts = header.map((h, c) => [h, ...body.map(r => r[c] ?? '')].map(plain));
  // Narrow columns must still fit their longest word (Word otherwise breaks it letter by letter).
  const CHAR = 112, PADDING = 260;
  let mins = colTexts.map(ts => Math.min(26, Math.max(...ts.flatMap(t => t.split(/\s+/)).map(w => w.length))) * CHAR + PADDING);
  const minSum = mins.reduce((a, b) => a + b, 0);
  if (minSum > tw) mins = mins.map(m => Math.floor((m / minSum) * tw));
  const extra = Math.max(0, tw - mins.reduce((a, b) => a + b, 0));
  const avg = colTexts.map(ts => ts.reduce((a, t) => a + t.length, 0) / ts.length);
  const avgSum = avg.reduce((a, b) => a + b, 0) || 1;
  const widths = mins.map((m, c) => Math.floor(m + (avg[c] / avgSum) * extra));
  widths[n - 1] += tw - widths.reduce((a, b) => a + b, 0);
  const border = { style: BorderStyle.SINGLE, size: 4, color: RULE };
  return new Table({
    width: { size: tw, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: [
      new TableRow({ tableHeader: true, children: header.map((h, c) => cell(h, { header: true, width: widths[c] })) }),
      ...body.map(r => new TableRow({ cantSplit: true, children: header.map((_, c) => cell(r[c] ?? '', { width: widths[c] })) })),
    ],
  });
}

function pngSize(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

while (i < lines.length) {
  const line = lines[i];
  const t = line.trim();

  if (!t) { i++; continue; }

  if (t === '\\landscape' || t === '\\portrait') {
    sections.push({ landscape: t === '\\landscape', children: [] });
    children = sections[sections.length - 1].children;
    i++; continue;
  }

  if (t === '\\pagebreak' || t === '---') {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    i++; continue;
  }

  const h = t.match(/^(#{1,4})\s+(.*)$/);
  if (h) {
    const level = h[1].length;
    const heading = [HeadingLevel.TITLE, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][level - 1];
    children.push(new Paragraph({ heading, children: runs(h[2]), keepNext: true }));
    i++; continue;
  }

  const img = t.match(/^!\[(.*?)\]\((.*?)\)$/);
  if (img) {
    const path = resolve(baseDir, img[2]);
    const data = readFileSync(path);
    const { w, h: ph } = pngSize(data);
    const maxW = Math.round(textWidth() / 15); // DXA -> px at 96 dpi
    const maxH = Math.round(textHeight() / 15) - 110; // leave room for a heading and the caption
    const scale = Math.min(1, maxW / w, maxH / ph);
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      keepNext: true,
      spacing: { before: 120, after: 60 },
      children: [new ImageRun({ type: 'png', data, transformation: { width: Math.round(w * scale), height: Math.round(ph * scale) }, altText: { title: img[1], description: img[1], name: `figure${++imageCount}` } })],
    }));
    if (img[1]) children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: runs(img[1], { italics: true, size: 18, color: SUB }) }));
    i++; continue;
  }

  if (t.startsWith('|')) {
    const rows = [];
    while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(parseRow(lines[i++]));
    children.push(table(rows, textWidth()));
    const spacer = new Paragraph({ spacing: { after: 120 }, children: [] });
    spacer.__spacer = true;
    children.push(spacer);
    continue;
  }

  if (t.startsWith('>')) {
    const buf = [];
    while (i < lines.length && lines[i].trim().startsWith('>')) buf.push(lines[i++].trim().replace(/^>\s?/, ''));
    for (const b of buf.join('\n').split(/\n\s*\n/)) {
      children.push(new Paragraph({
        children: runs(b.replace(/\n/g, ' '), { size: 20 }),
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: NOTE_FILL },
        border: { left: { style: BorderStyle.SINGLE, size: 18, color: '94A3B8', space: 8 } },
        indent: { left: 200 },
        spacing: { before: 60, after: 120 },
      }));
    }
    continue;
  }

  const li = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
  if (li) {
    listInstance++;
    while (i < lines.length) {
      const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
      if (!m) {
        // continuation line of the previous item
        if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && children.length) {
          const prev = children[children.length - 1];
          prev.addChildElement(new TextRun({ text: ' ' }));
          for (const r of runs(lines[i].trim())) prev.addChildElement(r);
          i++; continue;
        }
        break;
      }
      const level = m[1].length >= 2 ? 1 : 0;
      const numbered = /\d+\./.test(m[2]);
      children.push(new Paragraph({
        numbering: { reference: numbered ? 'numbers' : 'bullets', level, instance: listInstance },
        spacing: { after: 60, line: 264 },
        children: runs(m[3]),
      }));
      i++;
    }
    continue;
  }

  // paragraph: gather until blank / block start
  const buf = [t];
  i++;
  while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\||>|!\[|\s*([-*]|\d+\.)\s|---$|\\pagebreak)/.test(lines[i].trim())) buf.push(lines[i++].trim());
  children.push(para(buf.join(' ')));
}

// A spacer paragraph after a table at the very end of a section makes Word/LibreOffice add a blank page.
for (const sec of sections) if (sec.children.at(-1)?.__spacer) sec.children.pop();

const doc = new Document({
  creator: 'HIAS team',
  title: 'ISE 350 Milestone 1 — Hardware Integration & Active Safety',
  styles: {
    default: { document: { run: { font: FONT, size: 21, color: INK } } },
    paragraphStyles: [
      { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', run: { size: 40, bold: true, font: FONT, color: INK }, paragraph: { spacing: { after: 120 } } },
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 30, bold: true, font: FONT, color: INK }, paragraph: { spacing: { before: 360, after: 140 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 25, bold: true, font: FONT, color: INK }, paragraph: { spacing: { before: 260, after: 100 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 22, bold: true, font: FONT, color: SUB }, paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets', levels: [
        { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } },
        { level: 1, format: LevelFormat.BULLET, text: '◦', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1080, hanging: 270 } } } },
      ] },
      { reference: 'numbers', levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 300 } } } },
        { level: 1, format: LevelFormat.LOWER_LETTER, text: '%2.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1080, hanging: 300 } } } },
      ] },
    ],
  },
  sections: sections.filter(sec => sec.children.length).map(sec => ({
    properties: { page: {
      size: { width: PAGE_W, height: 15840, orientation: sec.landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
      margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ['HIAS — Milestone 1 · page ', PageNumber.CURRENT], size: 16, color: SUB, font: FONT })] })] }) },
    children: sec.children,
  })),
});

writeFileSync(outPath, await Packer.toBuffer(doc));
console.log(`wrote ${outPath} (${sections.reduce((a, x) => a + x.children.length, 0)} blocks, ${imageCount} images, ${sections.filter(x => x.children.length).length} sections)`);
