# RubyKreon — Diario y analíticas

App instalable para comidas, tomas de Kreon, deposiciones Bristol y peso. **Analíticas** analiza estos registros, no informes de laboratorio.

## Abrir e instalar

**https://xavigm2020.github.io/RubyKreon_App/** — abre directamente la app; no requiere cuenta de GitHub.

- Android: Chrome → **Instalar app**, o menú ⋮ → **Instalar app / Añadir a pantalla de inicio**.
- iPhone: Safari → **Compartir → Añadir a pantalla de inicio → Añadir**.

## Comidas y cápsulas

La cámara del móvil conserva el archivo recibido sin filtros. La pestaña Comida contiene una sola descripción y hasta cuatro fotos, cargadas juntas o añadidas desde la cámara. La fecha y hora se guardan automáticamente al registrar la comida. Cantidades, ingredientes y observaciones pueden escribirse en el mismo campo. El botón se habilita al escribir una descripción; si falta la clave de IA, abre Ajustes para introducirla. La IA estima el contenido nutricional a partir de la descripción, con fotos opcionales. Sin fotos, indica cantidades y aceite añadido; si faltan cantidades, la IA debe explicar sus supuestos y reducir la confianza.

Se han eliminado de Comida los parámetros de medicamento y la fórmula automática basada en UI/g de grasa. No se utilizan dosis de partida inventadas ni se transforma Bristol en una dosis.

En **Analíticas → Mi pauta prescrita**, registra las UI por comida principal y, opcionalmente, por tentempié, y las presentaciones autorizadas de 10.000, 25.000 y 35.000 UI. La app encuentra una combinación exacta con el menor número de cápsulas. No redondea al alza ni excede el objetivo para conseguir una combinación. Si falta una pauta o no se puede representar con esas cápsulas, no indica una toma.

**Preparar registro de esta toma** rellena el formulario del diario: no guarda medicación como tomada hasta que confirmes el registro. La pauta no se cambia por una respuesta del LLM ni por el modelo de regresión.

## Diario

- Comidas y fotos, con estimación nutricional opcional.
- Tomas de Kreon con suma de UI y comida asociada. Puedes asociar registros anteriores mediante **Editar**.
- Bristol 1–7 y aspecto graso/aceitoso observado (sí, no, desconocido), sin equipararlo a una medición fecal.
- Peso en kg y evolución.
- Historial con fecha/hora, filtros, edición y borrado confirmado.
- Los documentos archivados por la versión anterior se conservan en el historial y en las copias; se ha eliminado la interfaz de subida y lectura de informes.

## Analíticas y revisión de pauta

El resumen por fechas reúne comidas, grasa estimada, tomas, Bristol y peso. La IA recibe el resumen, las observaciones y los últimos 300 registros detallados del periodo; no recibe fotos ni documentos archivados. Puede elaborar observaciones, señalar datos faltantes y preparar una revisión de pauta para el profesional, citando registros reales.

Se aporta al LLM una referencia identificada de la [ficha técnica de Kreon 35.000, AEMPS, apartados 4.2 y 4.4](https://cima.aemps.es/cima/dochtml/ft/83862/FT_83862.html), revisada en julio de 2026. Sus rangos y criterios poblacionales no equivalen a una prescripción individual ni a un algoritmo Bristol → UI. La ficha indica individualización, seguimiento del estado nutricional y ajustes supervisados.

El contexto opcional incluye edad, diagnóstico indicado por el profesional y el último peso registrado hasta el final del periodo. Sin edad, diagnóstico, peso o pauta, la revisión se marca como insuficiente. Las respuestas con cantidades nuevas de tratamiento o referencias a registros inexistentes se rechazan. El resultado no autoriza una nueva dosis: los ajustes requieren valoración profesional.

Los análisis pueden guardarse en el diario y consultarse desde **Análisis guardados**.

## Regresión lineal local

El modelo exploratorio predice **UI registradas por comida**, no la dosis terapéutica óptima. Las dosis tomadas son etiquetas observacionales; no demuestran eficacia ni seguridad.

Variables:

1. Grasa estimada de la comida (g).
2. Último peso registrado antes de la comida (kg).
3. Bristol medio de las deposiciones de las 48 horas previas.
4. Proporción de aspecto graso entre las observaciones conocidas de esas 48 horas.
5. Última toma registrada antes de la comida (UI).

Se necesita una asociación explícita entre toma y comida. Varias tomas asociadas a la misma comida se suman como una sola etiqueta. Se excluyen filas sin análisis de grasa, sin antecedentes completos o con tomas anteriores a la hora de la comida. Los desconocidos no se convierten en ceros ni se emparejan automáticamente comidas y tomas.

La regresión usa mínimos cuadrados con intercepto y QR reortogonalizado. Las variables constantes o colineales se omiten y se muestran como tales. El mínimo operativo de la app es de 30 comidas completas; **no es un umbral de validación clínica**.

El historial completo se separa cronológicamente: 80 % inicial para entrenamiento y 20 % posterior para evaluación. Se excluyen del entrenamiento las etiquetas que aún no estaban disponibles cuando comenzó la evaluación. Medias, escalas y coeficientes se ajustan solo con entrenamiento. La interfaz muestra MAE, RMSE y R², y compara el error con usar la media del entrenamiento o la última toma. R² se marca como no calculable si el objetivo de validación es constante.

Una predicción fuera del rango de entrenamiento se señala como extrapolación. No se redondea a una toma, no genera cápsulas ni actualiza la pauta. El modelo se entrena en el navegador sin enviar datos y debe reentrenarse al recargar o cambiar los registros. Los coeficientes no prueban efectos causales; Bristol es una escala ordinal y las grasas de las fotos son estimaciones.

## IA y almacenamiento

Obtén una clave en [OpenRouter](https://openrouter.ai/settings/keys) y guárdala desde ⚙️ Ajustes en la app. Se conserva en `localStorage` (nombre `gai_key` por compatibilidad) y se envía a OpenRouter para autenticar las peticiones. Se usa `meta-llama/llama-4-maverick` para fotos y analíticas del diario. La regresión no necesita clave ni conexión.

El historial se guarda en IndexedDB (`rubykreon-diary`) dentro de ese navegador y móvil, sin cuentas ni sincronización. El service worker permite abrir y usar el diario sin conexión después de la primera carga. La IA requiere conexión y puede consumir saldo.

Exporta copias del diario con regularidad. Incluyen registros, análisis guardados y originales de la versión anterior; no incluyen API key, pauta, contexto clínico ni un modelo entrenado. En otro teléfono debes volver a introducir tu pauta y contexto. La importación valida todos los registros antes de escribir y omite IDs existentes. Límite: 200 MB y 10.000 registros.

## Desarrollo y pruebas

Frontend HTML/CSS/JS sin dependencias en producción:

- `index.html`: comidas, cámara, configuración e instalación.
- `diary.js`: IndexedDB, formularios, historial y copias.
- `analytics.js`: resumen, revisión con LLM y combinación según pauta prescrita.
- `regression.js`: dataset temporal, regresión, validación y predicción exploratoria.
- `diary.css`, `sw.js`: estilos y caché PWA.

```bash
python3 tests/serve_app.py
```

Abre `http://127.0.0.1:8765/RubyKreon_App/`. En otro terminal:

```bash
python3 -m pip install playwright
RUBYKREON_TEST_URL=http://127.0.0.1:8765/RubyKreon_App/ python3 tests/test_diary_browser.py
```

En otros sistemas configura `RUBYKREON_CHROME` o instala Chromium con `playwright install chromium`. Las pruebas usan historia sintética y respuestas de IA simuladas, sin saldo ni datos reales. Verifican ajuste matemático, separación temporal, etiquetas tardías, colinealidad, persistencia, compatibilidad de copias, aislamiento de la pauta y uso sin conexión. No constituyen validación clínica ni evalúan el rendimiento en pacientes reales.

Se publica con `.github/workflows/deploy.yml` al subir a `main`.

## Aviso médico

El diario y sus modelos no sustituyen la pauta prescrita ni la valoración sanitaria. No utilices la predicción estadística como indicación para aumentar o reducir Kreon.

## Licencia

MIT © 2024

Tras el análisis de la comida, Kreon muestra el desglose de cápsulas, unidades de lipasa por cápsula, subtotales y total según la pauta prescrita guardada. El acceso «Introducir o revisar mi pauta prescrita» abre directamente el formulario. La estimación de grasa no determina ni modifica la dosis personal.

Enlace único de instalación y actualizaciones: https://xavigm2020.github.io/RubyKreon_App/. Chrome requiere confirmar la instalación. La app comprueba versiones al abrirse, al recuperar conexión, al volver al primer plano y cada minuto mientras está visible. Recarga automáticamente si no hay cambios; con formularios modificados o cámara/análisis activos, aplaza la recarga y ofrece aplicarla desde Ajustes. El diario y la clave se mantienen. Las actualizaciones necesitan conexión.

El prototipo muestra tras cada análisis la referencia AEMPS de 25.000–80.000 UI por comida para adolescentes/adultos con IPE por causas distintas de fibrosis quística, con enlace a la ficha vigente. Una tabla de ejemplos en pasos de 5.000 UI calcula repartos exactos con el mínimo de cápsulas de 10.000/25.000/35.000; no elige dosis, no usa la grasa para asignarla, no modifica la pauta y no registra tomas.

La simulación del prototipo multiplica la grasa estimada por un factor editable, inicialmente 1.000 UI/g recuperado del código antiguo (no una pauta AEMPS). Guarda el factor bajo `rubykreon-demo-ui-per-gram`, separado de las prescripciones. Muestra total y reparto mínimo exacto en cápsulas enteras si es representable; no redondea, no aplica límites clínicos, no modifica pautas, no registra dosis y no alimenta la regresión ni la revisión clínica. No usar para decidir tomas reales.

La pestaña Comida muestra solo fotos, descripción, botón de análisis y resultados. El factor de simulación, la pauta prescrita y la referencia AEMPS se encuentran en Ajustes. Las fotos se añaden a la selección existente (hasta 4 / 20 MB) y se pueden quitar individualmente; cualquier cambio invalida el análisis anterior.

El resultado de Kreon incluye «Cambiar UI por gramo de grasa», que abre y enfoca el parámetro en Ajustes. «Guardar UI/g» lo conserva para próximas simulaciones. La descripción es solo un campo de texto, sin etiqueta ni tarjeta exterior.

La pestaña Registros muestra una tabla con día, hora y tipo, y acciones Editar/Borrar por fila. Un único botón Nuevo registro abre el formulario en una ventana. Copias de seguridad y evolución de peso permanecen en Ajustes; los archivos originales pueden descargarse al editar el registro.

Analíticas contiene únicamente cuatro gráficas del historial: grasa estimada diaria, Kreon registrado diario, Bristol y peso. Las fechas usan el tiempo real de los registros; los días sin datos no se sustituyen por cero. Bristol se muestra como puntos ordinales. Los ajustes, revisión con IA y regresión permanecen bajo Ajustes → Herramientas del historial.
