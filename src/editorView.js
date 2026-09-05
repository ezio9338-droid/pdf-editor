// Vista "Editar PDF": abrir un PDF, ver sus paginas, anadir texto e imagenes
// libremente sobre cada pagina, rotar/borrar paginas y exportar el resultado.
const EditorView = (() => {
  const fs = require('fs');
  const path = require('path');
  const { PDFDocument, rgb, degrees, StandardFonts } = require('pdf-lib');
  const { ipcRenderer } = require('electron');

  const state = {
    fileName: 'documento.pdf',
    workingDoc: null,   // PDFDocument (pdf-lib) mutado con rotaciones/borrados
    renderDoc: null,    // documento pdf.js para previsualizar
    pages: [],          // por pagina: { overlays: [...] }
    currentPage: 0,
    scale: 1.4,
    selected: null,      // overlay seleccionado actualmente
    overlaySeq: 0
  };

  let els = {};

  function cacheEls() {
    els = {
      openBtn: document.getElementById('edit-open-btn'),
      textBtn: document.getElementById('tool-text'),
      imageBtn: document.getElementById('tool-image'),
      rotateBtn: document.getElementById('edit-rotate-btn'),
      deletePageBtn: document.getElementById('edit-delete-page-btn'),
      exportBtn: document.getElementById('edit-export-btn'),
      thumbs: document.getElementById('edit-thumbs'),
      canvasArea: document.getElementById('edit-canvas-area'),
      fontSizeField: document.getElementById('font-size-field'),
      fontColorField: document.getElementById('font-color-field'),
      fontSizeInput: document.getElementById('font-size-input'),
      fontColorInput: document.getElementById('font-color-input'),
      deleteElementBtn: document.getElementById('delete-element-btn')
    };
  }

  function init() {
    cacheEls();
    els.openBtn.addEventListener('click', openPdf);
    setupDropZone();
    els.textBtn.addEventListener('click', addTextOverlay);
    els.imageBtn.addEventListener('click', addImageOverlay);
    els.rotateBtn.addEventListener('click', rotateCurrentPage);
    els.deletePageBtn.addEventListener('click', deleteCurrentPage);
    els.exportBtn.addEventListener('click', exportPdf);
    els.deleteElementBtn.addEventListener('click', deleteSelectedOverlay);
    els.fontSizeInput.addEventListener('input', () => {
      if (state.selected && state.selected.type === 'text') {
        state.selected.fontSize = Number(els.fontSizeInput.value) || 12;
        state.selected.el.style.fontSize = state.selected.fontSize * state.scale + 'px';
      }
    });
    els.fontColorInput.addEventListener('input', () => {
      if (state.selected && state.selected.type === 'text') {
        state.selected.color = els.fontColorInput.value;
        state.selected.el.style.color = state.selected.color;
      }
    });
  }

  function setToolsEnabled(enabled) {
    [els.textBtn, els.imageBtn, els.rotateBtn, els.deletePageBtn, els.exportBtn]
      .forEach((b) => (b.disabled = !enabled));
  }

  async function openPdf() {
    const filePaths = await ipcRenderer.invoke('dialog:openPdfPaths');
    if (!filePaths || filePaths.length === 0) return;
    await openPdfFromPath(filePaths[0]);
  }

  async function openPdfFromPath(filePath) {
    const bytes = fs.readFileSync(filePath);
    state.fileName = path.basename(filePath);
    state.workingDoc = await PDFDocument.load(bytes);
    state.pages = new Array(state.workingDoc.getPageCount()).fill(null).map(() => ({ overlays: [] }));
    state.currentPage = 0;
    state.selected = null;
    await rebuildRenderDoc();
    setToolsEnabled(true);
    renderThumbs();
    await renderCurrentPage();
  }

  function setupDropZone() {
    const dropTarget = document.getElementById('view-edit');
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
      if (!filePath) return;
      await openPdfFromPath(filePath);
    });
  }

  async function rebuildRenderDoc() {
    const bytes = await state.workingDoc.save();
    state.renderDoc = await loadPdfForRender(bytes);
  }

  async function renderThumbs() {
    els.thumbs.innerHTML = '';
    for (let i = 0; i < state.pages.length; i++) {
      const { canvas } = await renderPageToCanvas(state.renderDoc, i + 1, 0.2);
      const item = document.createElement('div');
      item.className = 'thumb-item' + (i === state.currentPage ? ' active' : '');
      item.appendChild(canvas);
      const label = document.createElement('div');
      label.className = 'thumb-label';
      label.textContent = i + 1;
      item.appendChild(label);
      item.addEventListener('click', async () => {
        state.currentPage = i;
        state.selected = null;
        updateSelectionUI();
        renderThumbs();
        await renderCurrentPage();
      });
      els.thumbs.appendChild(item);
    }
  }

  async function renderCurrentPage() {
    const { canvas, viewport } = await renderPageToCanvas(state.renderDoc, state.currentPage + 1, state.scale);
    els.canvasArea.innerHTML = '';
    const stage = document.createElement('div');
    stage.className = 'page-stage';
    stage.style.width = canvas.width + 'px';
    stage.style.height = canvas.height + 'px';
    stage.appendChild(canvas);
    stage.addEventListener('mousedown', (e) => {
      if (e.target === canvas) {
        state.selected = null;
        updateSelectionUI();
      }
    });
    els.canvasArea.appendChild(stage);

    state.currentViewport = viewport;
    state.currentStage = stage;

    // Vuelve a montar los overlays ya creados en esta pagina.
    const overlays = state.pages[state.currentPage].overlays;
    overlays.forEach((ov) => mountOverlayEl(ov, stage));
  }

  function screenToPdfBox(leftPx, topPx, widthPx, heightPx) {
    const viewport = state.currentViewport;
    const [x1, y1] = viewport.convertToPdfPoint(leftPx, topPx + heightPx); // esquina inferior-izq en pantalla
    const [x2, y2] = viewport.convertToPdfPoint(leftPx + widthPx, topPx);  // esquina superior-der en pantalla
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1)
    };
  }

  function currentPageRotationDeg() {
    return state.workingDoc.getPage(state.currentPage).getRotation().angle;
  }

  function mountOverlayEl(ov, stage) {
    stage.appendChild(ov.el);
    if (ov._dragAttached) return;
    ov._dragAttached = true;
    // El contenedor se resuelve en el momento del arrastre (no aqui), porque
    // el <div> de pagina se recrea cada vez que se cambia de pagina.
    makeDraggable(ov.el, () => state.currentStage, {
      resizable: true,
      onSelect: () => selectOverlay(ov),
      onChange: (el) => {
        const box = screenToPdfBox(el.offsetLeft, el.offsetTop, el.offsetWidth, el.offsetHeight);
        Object.assign(ov, box);
      }
    });
  }

  function selectOverlay(ov) {
    state.selected = ov;
    updateSelectionUI();
  }

  function updateSelectionUI() {
    document.querySelectorAll('.overlay-el').forEach((e) => e.classList.remove('selected'));
    if (!state.selected) {
      els.fontSizeField.style.display = 'none';
      els.fontColorField.style.display = 'none';
      els.deleteElementBtn.style.display = 'none';
      return;
    }
    state.selected.el.classList.add('selected');
    els.deleteElementBtn.style.display = '';
    if (state.selected.type === 'text') {
      els.fontSizeField.style.display = '';
      els.fontColorField.style.display = '';
      els.fontSizeInput.value = state.selected.fontSize;
      els.fontColorInput.value = state.selected.color;
    } else {
      els.fontSizeField.style.display = 'none';
      els.fontColorField.style.display = 'none';
    }
  }

  function deleteSelectedOverlay() {
    if (!state.selected) return;
    const list = state.pages[state.currentPage].overlays;
    const idx = list.indexOf(state.selected);
    if (idx >= 0) list.splice(idx, 1);
    state.selected.el.remove();
    state.selected = null;
    updateSelectionUI();
  }

  function addTextOverlay() {
    if (!state.workingDoc) return;
    const stage = state.currentStage;
    const fontSize = 24;
    const el = document.createElement('div');
    el.className = 'overlay-el text-el';
    el.contentEditable = 'true';
    el.style.left = '40px';
    el.style.top = '40px';
    el.style.width = '220px';
    el.style.fontSize = fontSize * state.scale + 'px';
    el.style.color = '#000000';
    el.textContent = 'Escribe aqui';

    const ov = {
      id: ++state.overlaySeq,
      type: 'text',
      el,
      fontSize,
      color: '#000000',
      rotationAtCreation: currentPageRotationDeg(),
      get text() { return el.innerText; }
    };
    Object.assign(ov, screenToPdfBox(40, 40, 220, fontSize * state.scale * 1.3));

    state.pages[state.currentPage].overlays.push(ov);
    mountOverlayEl(ov, stage);
    el.addEventListener('mousedown', (e) => e.stopPropagation());
    el.addEventListener('input', () => {
      const box = screenToPdfBox(el.offsetLeft, el.offsetTop, el.offsetWidth, el.offsetHeight);
      Object.assign(ov, box);
    });
    selectOverlay(ov);

    // Selecciona el texto por defecto para que el usuario escriba directamente.
    setTimeout(() => {
      el.focus();
      document.execCommand('selectAll', false, null);
    }, 0);
  }

  async function addImageOverlay() {
    if (!state.workingDoc) return;
    const imagePath = await ipcRenderer.invoke('dialog:openImagePath');
    if (!imagePath) return;
    const bytes = fs.readFileSync(imagePath);
    const ext = path.extname(imagePath).toLowerCase().replace('.', '');
    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
    const dataUrl = bytesToDataUrl(bytes, mime);

    const stage = state.currentStage;
    const w = 160, h = 160;
    const el = document.createElement('div');
    el.className = 'overlay-el image-el';
    el.style.left = '40px';
    el.style.top = '40px';
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    const img = document.createElement('img');
    img.src = dataUrl;
    el.appendChild(img);

    const ov = {
      id: ++state.overlaySeq,
      type: 'image',
      el,
      imageBytes: bytes,
      imageExt: ext,
      rotationAtCreation: currentPageRotationDeg()
    };
    Object.assign(ov, screenToPdfBox(40, 40, w, h));

    state.pages[state.currentPage].overlays.push(ov);
    mountOverlayEl(ov, stage);
    selectOverlay(ov);
  }

  async function rotateCurrentPage() {
    if (!state.workingDoc) return;
    const page = state.workingDoc.getPage(state.currentPage);
    const newAngle = (page.getRotation().angle + 90) % 360;
    page.setRotation(degrees(newAngle));
    await rebuildRenderDoc();
    renderThumbs();
    await renderCurrentPage();
  }

  async function deleteCurrentPage() {
    if (!state.workingDoc || state.workingDoc.getPageCount() <= 1) {
      alert('El documento debe tener al menos una pagina.');
      return;
    }
    state.workingDoc.removePage(state.currentPage);
    state.pages.splice(state.currentPage, 1);
    if (state.currentPage >= state.pages.length) state.currentPage = state.pages.length - 1;
    state.selected = null;
    await rebuildRenderDoc();
    renderThumbs();
    await renderCurrentPage();
  }

  async function exportPdf() {
    if (!state.workingDoc) return;
    const font = await state.workingDoc.embedFont(StandardFonts.Helvetica);

    for (let i = 0; i < state.pages.length; i++) {
      const page = state.workingDoc.getPage(i);
      for (const ov of state.pages[i].overlays) {
        const rotate = degrees(-ov.rotationAtCreation);
        if (ov.type === 'text') {
          const lines = ov.text.split('\n');
          const lineHeight = ov.fontSize * 1.15;
          const color = hexToRgb(ov.color);
          lines.forEach((line, idx) => {
            page.drawText(line, {
              x: ov.x,
              y: ov.y + ov.height - ov.fontSize - idx * lineHeight,
              size: ov.fontSize,
              font,
              color: rgb(color.r, color.g, color.b),
              rotate
            });
          });
        } else if (ov.type === 'image') {
          const image = ov.imageExt === 'png'
            ? await state.workingDoc.embedPng(ov.imageBytes)
            : await state.workingDoc.embedJpg(ov.imageBytes);
          page.drawImage(image, { x: ov.x, y: ov.y, width: ov.width, height: ov.height, rotate });
        }
      }
    }

    const savePath = await ipcRenderer.invoke('dialog:savePdfPath', state.fileName);
    if (!savePath) return;
    const finalBytes = await state.workingDoc.save();
    fs.writeFileSync(savePath, finalBytes);
    alert('PDF guardado correctamente.');
  }

  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return { r: 0, g: 0, b: 0 };
    return { r: parseInt(m[1], 16) / 255, g: parseInt(m[2], 16) / 255, b: parseInt(m[3], 16) / 255 };
  }

  return { init };
})();
