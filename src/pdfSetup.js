// Configuracion compartida de pdf.js (renderizado) y utilidades comunes.
const path = require('path');
const { webUtils } = require('electron');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

pdfjsLib.GlobalWorkerOptions.workerSrc = path.join(
  path.dirname(require.resolve('pdfjs-dist/package.json')),
  'legacy/build/pdf.worker.js'
);

// Carga un PDF (Buffer/Uint8Array) y devuelve el documento pdf.js para renderizar.
async function loadPdfForRender(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const task = pdfjsLib.getDocument({ data });
  return task.promise;
}

// Renderiza una pagina de un documento pdf.js en un <canvas> nuevo.
async function renderPageToCanvas(pdfDoc, pageNumber, scale) {
  const page = await pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { canvas, viewport, page };
}

function bytesToDataUrl(bytes, mime) {
  const b64 = Buffer.from(bytes).toString('base64');
  return `data:${mime};base64,${b64}`;
}

// Utilidades para arrastrar-y-soltar. Desde Electron 32, la ruta absoluta de
// un File soltado ya no viene en su propiedad .path (eliminada por seguridad);
// hay que pedirla explicitamente con webUtils.getPathForFile.
function allPdfPaths(fileList) {
  return Array.from(fileList)
    .filter((f) => f.name.toLowerCase().endsWith('.pdf'))
    .map((f) => webUtils.getPathForFile(f));
}

function firstPdfPath(fileList) {
  return allPdfPaths(fileList)[0] || null;
}
