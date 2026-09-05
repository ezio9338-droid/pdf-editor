// Vista "Unir PDFs": anadir varios PDFs, reordenarlos arrastrando y unirlos en uno solo.
const MergeView = (() => {
  const fs = require('fs');
  const path = require('path');
  const { PDFDocument } = require('pdf-lib');
  const { ipcRenderer } = require('electron');

  let files = []; // { filePath, name, bytes, pageCount }
  let els = {};
  let dragSrcIndex = null;

  function cacheEls() {
    els = {
      addBtn: document.getElementById('merge-add-btn'),
      clearBtn: document.getElementById('merge-clear-btn'),
      exportBtn: document.getElementById('merge-export-btn'),
      list: document.getElementById('merge-list')
    };
  }

  function init() {
    cacheEls();
    els.addBtn.addEventListener('click', addFiles);
    els.clearBtn.addEventListener('click', () => {
      files = [];
      render();
    });
    els.exportBtn.addEventListener('click', mergeAndSave);
  }

  async function addFiles() {
    const filePaths = await ipcRenderer.invoke('dialog:openPdfPaths');
    if (!filePaths || filePaths.length === 0) return;
    for (const filePath of filePaths) {
      const bytes = fs.readFileSync(filePath);
      let pageCount = '?';
      try {
        const doc = await PDFDocument.load(bytes);
        pageCount = doc.getPageCount();
      } catch (e) { /* PDF protegido o corrupto: se mostrara igualmente en la lista */ }
      files.push({ filePath, name: path.basename(filePath), bytes, pageCount });
    }
    render();
  }

  function render() {
    els.list.innerHTML = '';
    if (files.length === 0) {
      els.list.innerHTML = '<li class="empty-hint">Añade dos o más PDFs. Arrastra para reordenarlos.</li>';
      els.exportBtn.disabled = true;
      return;
    }
    els.exportBtn.disabled = files.length < 2;

    files.forEach((f, idx) => {
      const li = document.createElement('li');
      li.className = 'file-row';
      li.draggable = true;
      li.dataset.index = idx;
      li.innerHTML = `
        <span class="handle">⠿</span>
        <span class="name">${escapeHtml(f.name)}</span>
        <span class="pages-count">${f.pageCount} pág.</span>
        <button class="remove-btn" title="Quitar">✕</button>
      `;
      li.querySelector('.remove-btn').addEventListener('click', () => {
        files.splice(idx, 1);
        render();
      });
      li.addEventListener('dragstart', () => {
        dragSrcIndex = idx;
        li.classList.add('dragging');
      });
      li.addEventListener('dragend', () => li.classList.remove('dragging'));
      li.addEventListener('dragover', (e) => e.preventDefault());
      li.addEventListener('drop', (e) => {
        e.preventDefault();
        const targetIndex = idx;
        if (dragSrcIndex === null || dragSrcIndex === targetIndex) return;
        const [moved] = files.splice(dragSrcIndex, 1);
        files.splice(targetIndex, 0, moved);
        dragSrcIndex = null;
        render();
      });
      els.list.appendChild(li);
    });
  }

  async function mergeAndSave() {
    if (files.length < 2) return;
    const merged = await PDFDocument.create();
    for (const f of files) {
      const doc = await PDFDocument.load(f.bytes, { ignoreEncryption: true });
      const pages = await merged.copyPages(doc, doc.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
    }
    const savePath = await ipcRenderer.invoke('dialog:savePdfPath', 'documento_unido.pdf');
    if (!savePath) return;
    const bytes = await merged.save();
    fs.writeFileSync(savePath, bytes);
    alert('PDFs unidos y guardados correctamente.');
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  return { init };
})();
