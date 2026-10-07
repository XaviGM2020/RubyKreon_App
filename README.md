# RubyKreon — Diario de salud

App instalable para registrar comidas, tomas de Kreon, deposiciones Bristol, peso e informes de analíticas.

## Abrir e instalar

**https://xavigm2020.github.io/RubyKreon_App/** — abre directamente la app; no requiere cuenta de GitHub.

- **Android:** abre el enlace en Chrome → **Instalar app**, o menú ⋮ → **Instalar app / Añadir a pantalla de inicio**.
- **iPhone:** abre en Safari → **Compartir → Añadir a pantalla de inicio → Añadir**.
- Si se abre dentro de una app de mensajería, usa el navegador del teléfono.

## Funciones

- **Comidas:** foto del plato, hasta tres fotos adicionales, descripción, cantidad en gramos, ingredientes y observaciones. Se pueden guardar sin IA. El análisis usa las fotos y el contexto introducido.
- **Cámara:** en móvil abre la captura propia del teléfono, conservando la imagen recibida sin filtros. En ordenador permite capturar desde una vista previa; requiere un contexto seguro y permiso de cámara.
- **Kreon tomado:** registro independiente de cápsulas de 10.000, 25.000 y 35.000 UI (presentaciones indicadas por el usuario). Suma las UI registradas; no convierte automáticamente una estimación en una toma.
- **Deposiciones:** tipos Bristol 1–7, fecha, hora y observaciones. Incluye descripciones y enlace a la guía visual del NHS.
- **Peso:** kg, fecha, hora y evolución en tabla.
- **Analíticas:** hasta seis archivos PDF o fotos por informe, máximo 20 MB en total. Conserva los archivos originales. La IA extrae fecha, parámetros, valores como texto, unidades y rangos impresos. Los valores pueden corregirse; deben confirmarse antes de archivarlos. Se puede archivar el original sin extracción y reabrirlo posteriormente para leerlo con IA.
- **Línea temporal:** todos los registros ordenados por fecha y hora, filtros por día y tipo, edición, descarga de originales y eliminación con confirmación.
- **Evolución:** tablas de peso y parámetros de analíticas; compara parámetros con el mismo nombre y unidad.
- **Copia de seguridad:** exportación JSON con registros y archivos originales; importación validada que añade registros nuevos y omite identificadores existentes. No incluye claves de API. Límite de importación: 200 MB y 10.000 registros.

## IA y configuración

1. Obtén una clave en [OpenRouter](https://openrouter.ai/settings/keys).
2. Pégala en **API Key OpenRouter** y pulsa **Guardar**.

La clave se conserva en `localStorage` y se envía a OpenRouter para autenticar las peticiones. Se mantiene el nombre de almacenamiento `gai_key` para conservar la configuración existente.

Se utiliza `meta-llama/llama-4-maverick` para comidas y transcripción de analíticas. Para PDF se solicita el procesador `mistral-ocr` de OpenRouter, que permite leer documentos escaneados. Las fotos, informes y contexto se envían al proveedor al pulsar el botón de análisis o lectura; pueden consumir saldo. Sin clave o sin conexión, puedes registrar datos y archivar informes manualmente.

La extracción no interpreta resultados ni recomienda tratamientos. Los valores se guardan como texto para conservar decimales y signos como `<` o `>`. Los documentos se tratan como datos, no como instrucciones.

Documentación del envío de PDF: [OpenRouter PDF inputs](https://openrouter.ai/docs/guides/overview/multimodal/pdfs).

## Almacenamiento y copias

El diario se guarda en **IndexedDB**, base `rubykreon-diary`, dentro del navegador del móvil. No hay cuentas, sincronización ni servidor de historial. Los originales se almacenan junto con cada registro. La app solicita almacenamiento persistente cuando el navegador lo permite y se guarda un registro.

Exporta copias con regularidad: borrar los datos del navegador, cambiar de dispositivo o usar otro perfil no conserva el historial. Guarda la copia en un lugar adecuado para tus datos personales. El service worker conserva los archivos de la aplicación para abrirla sin conexión después de la primera carga; la IA requiere conexión.

## Desarrollo y pruebas

Frontend HTML, CSS y JavaScript sin dependencias en producción:

- `index.html`: captura y análisis de comidas, configuración e instalación.
- `diary.js`: registros, IndexedDB, extracción de informes, historial y copias.
- `diary.css`: formularios y vistas del diario.
- `sw.js`: caché de la PWA.

Vista previa local (solo sirve los archivos públicos de la app):

```bash
python3 tests/serve_app.py
```

Abre `http://127.0.0.1:8765/RubyKreon_App/`.

Pruebas con Playwright y Chrome, en otro terminal:

```bash
python3 -m pip install playwright
RUBYKREON_TEST_URL=http://127.0.0.1:8765/RubyKreon_App/ python3 tests/test_diary_browser.py
```

En otros sistemas, configura `RUBYKREON_CHROME` con la ruta de Chrome o instala Chromium con `playwright install chromium`. Las pruebas usan archivos sintéticos y simulan las respuestas de IA; no requieren clave real ni consumen saldo.

La publicación se realiza mediante `.github/workflows/deploy.yml` al subir cambios a `main`.

## Aviso médico

La estimación de alimentos y dosis es orientativa y no sustituye la pauta prescrita ni el criterio sanitario. Los parámetros configurables del cálculo deben revisarse con el profesional correspondiente. El diario de tomas registra lo introducido por el usuario y no modifica su tratamiento.

## Licencia

MIT © 2024
