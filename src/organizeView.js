// Vista "Organizar / Dividir": reordenar, rotar, borrar y extraer paginas de un PDF.
const OrganizeView = (() => {
  const fs = require('fs');
  const path = require('path');
  const { PDFDocument, degrees } = require('pdf-lib');
  const { ipcRenderer } = require('electron');

  const state = {
    fileName: 'documento.pdf',
    workingDoc: null,
    renderDoc: null,
    selected: new Set(),
    dragSrcIndex: null
  };

  let els = {};

  function cacheEls() {
    els = {
      openBtn: document.getElementById('org-open-btn'),
      rotateBtn: document.getElementById('org-rotate-btn'),
      deleteBtn: document.getElementById('org-delete-btn'),
      selectAllBtn: document.getElementById('org-select-all-btn'),
      selectNoneBtn: document.getElementById('org-select-none-btn'),
      extractBtn: document.getElementById('org-extract-btn'),
      exportBtn: document.getElementById('org-export-btn'),
      grid: document.getElementById('org-grid')
    };
  }

  function init() {
    cacheEls();
    els.openBtn.addEventListener('click', openPdf);
    els.rotateBtn.addEventListener('click', rotateSelected);
    els.deleteBtn.addEventListener('click', deleteSelected);
    els.selectAllBtn.addEventListener('click', () => {
      for (let i = 0; i < state.workingDoc.getPageCount(); i++) state.selected.add(i);
      renderGrid();
    });
    els.selectNoneBtn.addEventListener('click', () => {
      state.selected.clear();
      renderGrid();
    });
    els.extractBtn.addEventListener('click', extractSelected);
    els.exportBtn.addEventListener('click', exportAll);
  }

  function setToolsEnabled(enabled) {
    [els.rotateBtn, els.deleteBtn, els.selectAllBtn, els.selectNoneBtn, els.extractBtn, els.exportBtn]
      .forEach((b) => (b.disabled = !enabled));
  }

  async function openPdf() {
    const filePaths = await ipcRenderer.invoke('dialog:openPdfPaths');
    if (!filePaths || filePaths.length === 0) return;
    const filePath = filePaths[0];
    const bytes = fs.readFileSync(filePath);
    state.fileName = path.basename(filePath);
    state.workingDoc = await PDFDocument.load(bytes);
    state.selected.clear();
    await rebuildRenderDoc();
    setToolsEnabled(true);
    await renderGrid();
  }

  async function rebuildRenderDoc() {
    const bytes = await state.workingDoc.save();
    state.renderDoc = await loadPdfForRender(bytes);
  }

  async function renderGrid() {
    els.grid.innerHTML = '';
    const count = state.workingDoc.getPageCount();
    for (let i = 0; i < count; i++) {
      const { canvas } = await renderPageToCanvas(state.renderDoc, i + 1, 0.35);
      const tile = document.createElement('div');
      tile.className = 'org-page' + (state.selected.has(i) ? ' selected' : '');
      tile.draggable = true;
      tile.dataset.index = i;
      tile.appendChild(canvas);
      const num = document.createElement('div');
      num.className = 'page-num';
      num.textContent = `Página ${i + 1}`;
      tile.appendChild(num);
      const check = document.createElement('div');
      check.className = 'check';
      check.textContent = state.selected.has(i) ? '✓' : '';
      tile.appendChild(check);

      tile.addEventListener('click', () => {
        if (state.selected.has(i)) state.selected.delete(i);
        else state.selected.add(i);
        renderGrid();
      });
      tile.addEventListener('dragstart', () => {
        state.dragSrcIndex = i;
        tile.classList.add('dragging');
      });
      tile.addEventListener('dragend', () => tile.classList.remove('dragging'));
      tile.addEventListener('dragover', (e) => e.preventDefault());
      tile.addEventListener('drop', async (e) => {
        e.preventDefault();
        if (state.dragSrcIndex === null || state.dragSrcIndex === i) return;
        await reorderPage(state.dragSrcIndex, i);
        state.dragSrcIndex = null;
      });

      els.grid.appendChild(tile);
    }
    if (count === 0) {
      els.grid.innerHTML = '<div class="empty-hint">Abre un PDF para reordenar, rotar, borrar o extraer páginas.</div>';
    }
  }

  async function reorderPage(fromIndex, toIndex) {
    const order = state.workingDoc.getPageIndices();
    const [moved] = order.splice(fromIndex, 1);
    order.splice(toIndex, 0, moved);
    const newDoc = await PDFDocument.create();
    const copied = await newDoc.copyPages(state.workingDoc, order);
    copied.forEach((p) => newDoc.addPage(p));
    state.workingDoc = newDoc;
    state.selected.clear();
    await rebuildRenderDoc();
    await renderGrid();
  }

  async function rotateSelected() {
    if (state.selected.size === 0) return;
    state.selected.forEach((idx) => {
      const page = state.workingDoc.getPage(idx);
      const newAngle = (page.getRotation().angle + 90) % 360;
      page.setRotation(degrees(newAngle));
    });
    await rebuildRenderDoc();
    await renderGrid();
  }

  async function deleteSelected() {
    if (state.selected.size === 0) return;
    if (state.selected.size >= state.workingDoc.getPageCount()) {
      alert('No puedes borrar todas las páginas del documento.');
      return;
    }
    const indices = Array.from(state.selected).sort((a, b) => b - a);
    indices.forEach((idx) => state.workingDoc.removePage(idx));
    state.selected.clear();
    await rebuildRenderDoc();
    await renderGrid();
  }

  async function extractSelected() {
    if (state.selected.size === 0) return;
    const indices = Array.from(state.selected).sort((a, b) => a - b);
    const newDoc = await PDFDocument.create();
    const copied = await newDoc.copyPages(state.workingDoc, indices);
    copied.forEach((p) => newDoc.addPage(p));
    const savePath = await ipcRenderer.invoke('dialog:savePdfPath', 'paginas_extraidas.pdf');
    if (!savePath) return;
    const bytes = await newDoc.save();
    fs.writeFileSync(savePath, bytes);
    alert('Páginas extraídas y guardadas correctamente.');
  }

  async function exportAll() {
    if (!state.workingDoc) return;
    const savePath = await ipcRenderer.invoke('dialog:savePdfPath', state.fileName);
    if (!savePath) return;
    const bytes = await state.workingDoc.save();
    fs.writeFileSync(savePath, bytes);
    alert('Cambios guardados correctamente.');
  }

  return { init };
})();
