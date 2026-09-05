// Punto de entrada del renderer: cablea la navegacion entre vistas e inicializa cada una.
// Sin esto, Chromium intenta navegar a file://... al soltar un PDF fuera
// de una zona de arrastre reconocida, dejando la app en blanco.
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());

document.addEventListener('DOMContentLoaded', () => {
  const navButtons = document.querySelectorAll('.nav-btn');
  const views = document.querySelectorAll('.view');

  navButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      navButtons.forEach((b) => b.classList.remove('active'));
      views.forEach((v) => v.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('view-' + btn.dataset.view).classList.add('active');
    });
  });

  EditorView.init();
  MergeView.init();
  OrganizeView.init();
});
