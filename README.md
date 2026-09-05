# PDF Editor

Editor de PDF de escritorio, 100% local (nada se sube a internet), construido con Electron.

## Funcionalidades

- **Editar**: abre un PDF, añade cuadros de texto e imágenes en cualquier posición (arrastrar y redimensionar), rota o borra páginas, y exporta el resultado.
- **Unir**: añade varios PDFs, reordénalos arrastrando y únelos en un solo archivo.
- **Organizar / Dividir**: reordena páginas arrastrando, rota o borra páginas seleccionadas, extrae una selección de páginas a un PDF nuevo, o guarda los cambios sobre el documento completo.

## Requisitos

- [Node.js](https://nodejs.org/) 18 o superior.

## Instalación y uso

```bash
npm install
npm start
```

### Acceso directo (Windows), sin usar la terminal

Tras el `npm install`, puedes abrir la app con un doble clic en **`Iniciar PDF Editor.vbs`** (en la raíz del proyecto) — no abre ninguna ventana de consola.

Para tener un icono en el Escritorio, crea un acceso directo a ese `.vbs` (clic derecho sobre el archivo → *Enviar a* → *Escritorio (crear acceso directo)*), o ejecuta esto una vez en PowerShell (ajusta la ruta si clonaste el repo en otro sitio):

```powershell
$desktop = [Environment]::GetFolderPath("Desktop")
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut("$desktop\PDF Editor.lnk")
$sc.TargetPath = "$PWD\Iniciar PDF Editor.vbs"
$sc.WorkingDirectory = "$PWD"
$sc.IconLocation = "$PWD\node_modules\electron\dist\electron.exe,0"
$sc.Save()
```

## Generar un ejecutable instalable

```bash
npm run dist
```

El instalable se genera en la carpeta `dist/` (usa [electron-builder](https://www.electron.build/), configurado para Windows, macOS y Linux).

## Tecnología

- [Electron](https://www.electronjs.org/) — ventana de escritorio.
- [pdf-lib](https://pdf-lib.js.org/) — crear, editar, unir y dividir PDFs.
- [pdf.js](https://mozilla.github.io/pdf.js/) — renderizar páginas para previsualizarlas.

Todo el procesamiento ocurre en tu propio equipo: los archivos nunca salen de tu disco.

## Limitaciones conocidas (v0.1)

- Al combinar rotación de página + superposición de texto/imagen en la misma página, la posición final puede no ser perfecta si rotas la página *después* de haber colocado elementos sobre ella. Recomendado: rota primero, luego añade texto/imágenes.
- El editor de texto no ajusta el texto automáticamente (sin salto de línea automático); usa Enter para saltos de línea manuales.

## Licencia

MIT
