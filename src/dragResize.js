// Helper generico: hace que un elemento absoluto dentro de un contenedor
// se pueda arrastrar y (opcionalmente) redimensionar con un handle.
// `container` puede ser un elemento fijo o una funcion que devuelva el
// contenedor actual: los overlays del editor se remontan en un <div> de
// pagina nuevo cada vez que se cambia de pagina, asi que necesitan resolver
// su contenedor en el momento del arrastre, no en el momento del montaje.
function makeDraggable(el, container, { onChange, onSelect, resizable } = {}) {
  const getContainer = typeof container === 'function' ? container : () => container;
  let dragging = false;
  let resizing = false;
  let startX = 0, startY = 0;
  let startLeft = 0, startTop = 0, startW = 0, startH = 0;

  el.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('resize-handle')) return;
    e.stopPropagation();
    if (onSelect) onSelect(el);
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startLeft = el.offsetLeft;
    startTop = el.offsetTop;
    document.body.style.userSelect = 'none';
  });

  let handle = null;
  if (resizable) {
    handle = document.createElement('div');
    handle.className = 'resize-handle';
    el.appendChild(handle);
    handle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if (onSelect) onSelect(el);
      resizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startW = el.offsetWidth;
      startH = el.offsetHeight;
    });
  }

  window.addEventListener('mousemove', (e) => {
    if (!dragging && !resizing) return;
    const bounds = getContainer().getBoundingClientRect();
    if (dragging) {
      let newLeft = startLeft + (e.clientX - startX);
      let newTop = startTop + (e.clientY - startY);
      newLeft = Math.max(0, Math.min(newLeft, bounds.width - el.offsetWidth));
      newTop = Math.max(0, Math.min(newTop, bounds.height - el.offsetHeight));
      el.style.left = newLeft + 'px';
      el.style.top = newTop + 'px';
      if (onChange) onChange(el);
    } else if (resizing) {
      const newW = Math.max(16, startW + (e.clientX - startX));
      const newH = Math.max(12, startH + (e.clientY - startY));
      el.style.width = newW + 'px';
      el.style.height = newH + 'px';
      if (onChange) onChange(el);
    }
  });

  window.addEventListener('mouseup', () => {
    dragging = false;
    resizing = false;
    document.body.style.userSelect = '';
  });
}
