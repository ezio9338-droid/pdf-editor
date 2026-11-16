// Conversion PDF -> Word (.docx), 100% local.
// Usa pdf.js para leer el texto con su posicion, tamano y estilo, reconstruye
// lineas y parrafos, y genera el .docx con la libreria "docx".
// Las paginas sin texto (p. ej. escaneadas) se insertan como imagen si se
// proporciona options.renderPageImage.
const docx = require('docx');

const PT_TO_TWIP = 20;
const PT_TO_PX = 96 / 72;

// Caracteres no validos en XML (Word se niega a abrir el archivo si aparecen).
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

function cleanText(str) {
  return str.replace(INVALID_XML_CHARS, '');
}

async function getFontInfo(page, fontName, cache) {
  if (cache.has(fontName)) return cache.get(fontName);
  let info = { bold: false, italic: false };
  try {
    const font = page.commonObjs.get(fontName);
    const name = (font && font.name) || '';
    info = {
      bold: !!(font && (font.bold || font.black)) || /bold|black|heavy|semibold|demi/i.test(name),
      italic: !!(font && font.italic) || /italic|oblique/i.test(name)
    };
  } catch (e) { /* fuente no disponible: estilo normal */ }
  cache.set(fontName, info);
  return info;
}

// Convierte los items de texto de pdf.js en lineas ordenadas de arriba a abajo.
async function extractLines(page) {
  // getOperatorList fuerza la carga de las fuentes en commonObjs (para negrita/cursiva).
  try { await page.getOperatorList(); } catch (e) { /* sin estilos */ }
  const content = await page.getTextContent();
  const fontCache = new Map();

  const items = [];
  for (const it of content.items) {
    if (typeof it.str !== 'string' || it.str.length === 0) continue;
    const [a, b, c, d, x, y] = it.transform;
    const size = Math.hypot(c, d) || Math.hypot(a, b) || 12;
    const font = await getFontInfo(page, it.fontName, fontCache);
    items.push({ str: it.str, x, y, width: it.width || 0, size, bold: font.bold, italic: font.italic });
  }

  // Agrupa en lineas por coordenada vertical.
  items.sort((p, q) => (q.y - p.y) || (p.x - q.x));
  const lines = [];
  for (const it of items) {
    const line = lines.find((l) => Math.abs(l.y - it.y) < Math.max(l.size, it.size) * 0.5);
    if (line) {
      line.items.push(it);
      line.size = Math.max(line.size, it.size);
    } else {
      lines.push({ y: it.y, size: it.size, items: [it] });
    }
  }
  lines.sort((p, q) => q.y - p.y);

  for (const line of lines) {
    line.items.sort((p, q) => p.x - q.x);
    const runs = [];
    let prev = null;
    for (const it of line.items) {
      let text = it.str;
      if (prev) {
        const gap = it.x - (prev.x + prev.width);
        const needsSpace = gap > it.size * 0.2 && !/\s$/.test(prev.str) && !/^\s/.test(text);
        if (needsSpace) text = ' ' + text;
      }
      const last = runs[runs.length - 1];
      if (last && last.bold === it.bold && last.italic === it.italic && Math.abs(last.size - it.size) < 0.5) {
        last.text += text;
      } else {
        runs.push({ text, bold: it.bold, italic: it.italic, size: it.size });
      }
      prev = it;
    }
    line.runs = runs;
    line.x = line.items[0].x;
    const lastItem = line.items[line.items.length - 1];
    line.right = lastItem.x + lastItem.width;
    line.text = runs.map((r) => r.text).join('');
  }
  return lines.filter((l) => l.text.trim().length > 0);
}

// Une lineas consecutivas en parrafos segun el espacio vertical y el tamano de letra.
function linesToParagraphs(lines, pageWidth) {
  const paragraphs = [];
  let current = null;
  let prevLine = null;

  for (const line of lines) {
    let startNew = !current;
    if (current && prevLine) {
      const gap = prevLine.y - line.y;
      const sameSize = Math.abs(prevLine.size - line.size) / Math.max(prevLine.size, line.size) < 0.15;
      const normalSpacing = gap > 0 && gap < Math.max(prevLine.size, line.size) * 1.6;
      // Una linea anterior que termina muy antes del margen derecho suele cerrar el parrafo.
      const prevShort = prevLine.right < current.maxRight - pageWidth * 0.15 && /[.:!?]$/.test(prevLine.text.trim());
      startNew = !(sameSize && normalSpacing) || prevShort;
    }

    if (startNew) {
      current = { lines: [line], runs: line.runs.map((r) => ({ ...r })), maxRight: line.right };
      paragraphs.push(current);
    } else {
      const lastRun = current.runs[current.runs.length - 1];
      const firstText = line.runs[0].text;
      if (/[A-Za-zÀ-ÿ]-$/.test(lastRun.text) && /^[a-zà-ÿ]/.test(firstText)) {
        lastRun.text = lastRun.text.slice(0, -1); // palabra cortada con guion al final de linea
      } else if (!/\s$/.test(lastRun.text) && !/^\s/.test(firstText)) {
        lastRun.text += ' ';
      }
      current.runs.push(...line.runs.map((r) => ({ ...r })));
      current.lines.push(line);
      current.maxRight = Math.max(current.maxRight, line.right);
    }
    prevLine = line;
  }

  for (const p of paragraphs) {
    const totalChars = p.runs.reduce((s, r) => s + r.text.length, 0) || 1;
    p.size = p.runs.reduce((s, r) => s + r.size * r.text.length, 0) / totalChars;
    p.bold = p.runs.every((r) => r.bold || !r.text.trim());
    const first = p.lines[0];
    const center = (first.x + first.right) / 2;
    p.centered = p.lines.length <= 2 &&
      Math.abs(center - pageWidth / 2) < pageWidth * 0.04 &&
      first.x > pageWidth * 0.18;
  }
  return paragraphs;
}

// Tamano de letra mas frecuente (ponderado por caracteres): se toma como texto normal.
function detectBodySize(allParagraphs) {
  const counts = new Map();
  for (const p of allParagraphs) {
    for (const r of p.runs) {
      const key = Math.round(r.size * 2) / 2;
      counts.set(key, (counts.get(key) || 0) + r.text.length);
    }
  }
  let best = 11;
  let bestCount = -1;
  for (const [size, count] of counts) {
    if (count > bestCount) { best = size; bestCount = count; }
  }
  return best;
}

function buildParagraph(p, bodySize, pageBreakBefore) {
  let heading;
  const shortish = p.runs.reduce((s, r) => s + r.text.length, 0) < 200;
  if (shortish && p.size >= bodySize * 1.5) heading = docx.HeadingLevel.HEADING_1;
  else if (shortish && p.size >= bodySize * 1.2) heading = docx.HeadingLevel.HEADING_2;
  else if (shortish && p.bold && p.lines.length === 1 && p.size >= bodySize * 1.05) heading = docx.HeadingLevel.HEADING_3;

  const children = p.runs
    .map((r) => ({ ...r, text: cleanText(r.text) }))
    .filter((r) => r.text.length > 0)
    .map((r) => new docx.TextRun({
      text: r.text,
      bold: r.bold,
      italics: r.italic,
      size: Math.max(2, Math.round(r.size * 2)), // docx usa medios puntos
      color: '000000'
    }));

  return new docx.Paragraph({
    children,
    heading,
    pageBreakBefore,
    alignment: p.centered ? docx.AlignmentType.CENTER : undefined,
    spacing: { after: Math.round(bodySize * 0.6 * PT_TO_TWIP) }
  });
}

/**
 * Convierte un PDF a .docx.
 * @param {Uint8Array} bytes  contenido del PDF
 * @param {object} pdfjsLib   modulo pdf.js ya configurado
 * @param {object} [options]
 * @param {(page, info) => Promise<{data: Uint8Array, width: number, height: number}|null>} [options.renderPageImage]
 *        renderiza una pagina sin texto a PNG (para PDFs escaneados)
 * @param {(done: number, total: number) => void} [options.onProgress]
 * @returns {Promise<{buffer: Buffer, pageCount: number, imagePages: number}>}
 */
async function convertPdfToDocx(bytes, pdfjsLib, options = {}) {
  const data = bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(bytes);
  const pdfDoc = await pdfjsLib.getDocument({ data }).promise;
  const pageCount = pdfDoc.numPages;

  const pages = [];
  for (let n = 1; n <= pageCount; n++) {
    const page = await pdfDoc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const lines = await extractLines(page);
    const entry = { n, width: viewport.width, height: viewport.height, paragraphs: [], image: null };
    if (lines.length > 0) {
      entry.paragraphs = linesToParagraphs(lines, viewport.width);
    } else if (options.renderPageImage) {
      entry.image = await options.renderPageImage(page, viewport);
    }
    pages.push(entry);
    page.cleanup();
    if (options.onProgress) options.onProgress(n, pageCount);
  }
  await pdfDoc.destroy();

  const bodySize = detectBodySize(pages.flatMap((p) => p.paragraphs));
  const first = pages[0] || { width: 595, height: 842 };
  const margin = 1134; // 2 cm
  const contentWidthPt = (first.width * PT_TO_TWIP - margin * 2) / PT_TO_TWIP;
  const contentHeightPt = (first.height * PT_TO_TWIP - margin * 2) / PT_TO_TWIP;

  const children = [];
  let imagePages = 0;
  for (const pg of pages) {
    const pageBreak = children.length > 0;
    if (pg.paragraphs.length > 0) {
      pg.paragraphs.forEach((p, i) => children.push(buildParagraph(p, bodySize, pageBreak && i === 0)));
    } else if (pg.image) {
      imagePages++;
      const scale = Math.min(contentWidthPt / pg.width, contentHeightPt / pg.height, 1);
      children.push(new docx.Paragraph({
        pageBreakBefore: pageBreak,
        alignment: docx.AlignmentType.CENTER,
        children: [new docx.ImageRun({
          type: 'png',
          data: pg.image.data,
          transformation: {
            width: Math.round(pg.width * scale * PT_TO_PX),
            height: Math.round(pg.height * scale * PT_TO_PX)
          }
        })]
      }));
    } else {
      children.push(new docx.Paragraph({ pageBreakBefore: pageBreak, children: [] }));
    }
  }
  if (children.length === 0) children.push(new docx.Paragraph({ children: [] }));

  const document = new docx.Document({
    creator: 'PDF Editor',
    styles: {
      default: { document: { run: { font: 'Calibri', size: Math.round(bodySize * 2) } } }
    },
    sections: [{
      properties: {
        page: {
          size: {
            width: Math.round(first.width * PT_TO_TWIP),
            height: Math.round(first.height * PT_TO_TWIP)
          },
          margin: { top: margin, right: margin, bottom: margin, left: margin }
        }
      },
      children
    }]
  });

  const buffer = await docx.Packer.toBuffer(document);
  return { buffer, pageCount, imagePages };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { convertPdfToDocx };
}
