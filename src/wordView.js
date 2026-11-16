// Vista "PDF a Word": abre un PDF y lo convierte a un documento .docx editable.
const WordView = (() => {
  const fs = require('fs');
  const path = require('path');
  const { ipcRenderer } = require('electron');
  const { convertPdfToDocx } = require(path.join(__dirname, 'pdfToWord.js'));

  let current = null; // { filePath, name, bytes, pageCount }
  let busy = false;
  let els = {};

  function init() {
    els = {
      openBtn: document.getElementById('word-open-btn'),
      convertBtn: document.getElementById('word-convert-btn'),
      file: document.getElementById('word-file'),
      status: document.getElementById('word-status')
    };
    els.openBtn.addEventListener('click', async () => {
      const filePaths = await ipcRenderer.invoke('dialog:openPdfPaths');
      if (filePaths && filePaths.length > 0) await openFile(filePaths[0]);
    });
    els.convertBtn.addEventListener('click', convertAndSave);
    setupDropZone();
  }

  function setupDropZone() {
    const dropTarget = document.getElementById('view-word');
    dropTarget.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropTarget.classList.add('drag-over');
    });
    dropTarget.addEventListener('dragleave', (e) => {
      if (e.target === dropTarget) dropTarget.classList.remove('drag-over');
    });
    dropTarget.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropTarget.classList.remove('drag-over');
      const filePath = firstPdfPath(e.dataTransfer.files);
      if (filePath) await openFile(filePath);
    });
  }

  async function openFile(filePath) {
    if (busy) return;
    const bytes = fs.readFileSync(filePath);
    let pageCount = '?';
    try {
      const doc = await loadPdfForRender(bytes);
      pageCount = doc.numPages;
      await doc.destroy();
    } catch (e) {
      setStatus('No se pudo leer el PDF: ' + e.message, 'error');
      return;
    }
    current = { filePath, name: path.basename(filePath), bytes, pageCount };
    els.file.classList.remove('empty-hint');
    els.file.innerHTML = '';
    const name = document.createElement('span');
    name.textContent = current.name;
    const count = document.createElement('span');
    count.className = 'pages-count';
    count.textContent = `${pageCount} pág.`;
    els.file.append(name, count);
    els.convertBtn.disabled = false;
    setStatus('');
  }

  // Renderiza a PNG las paginas sin texto (PDF escaneado) para incluirlas como imagen.
  async function renderPageImage(page) {
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const data = new Uint8Array(await blob.arrayBuffer());
    return { data, width: canvas.width, height: canvas.height };
  }

  async function convertAndSave() {
    if (!current || busy) return;
    const defaultName = current.name.replace(/\.pdf$/i, '') + '.docx';
    const savePath = await ipcRenderer.invoke('dialog:saveDocxPath', defaultName);
    if (!savePath) return;

    busy = true;
    els.convertBtn.disabled = true;
    els.openBtn.disabled = true;
    setStatus('Convirtiendo...');
    try {
      const result = await convertPdfToDocx(current.bytes, pdfjsLib, {
        renderPageImage,
        onProgress: (done, total) => setStatus(`Convirtiendo... página ${done} de ${total}`)
      });
      fs.writeFileSync(savePath, result.buffer);
      let msg = `Listo: guardado en ${savePath}`;
      if (result.imagePages > 0) {
        msg += ` (${result.imagePages} página(s) sin texto se insertaron como imagen)`;
      }
      setStatus(msg, 'ok');
    } catch (e) {
      console.error(e);
      setStatus('Error al convertir: ' + e.message, 'error');
    } finally {
      busy = false;
      els.convertBtn.disabled = false;
      els.openBtn.disabled = false;
    }
  }

  function setStatus(text, kind) {
    els.status.textContent = text;
    els.status.className = 'word-status' + (kind ? ' ' + kind : '');
  }

  return { init };
})();
