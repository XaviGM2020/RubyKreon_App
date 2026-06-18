# 💊 FatDose MVP

**Análisis de grasas en platos de comida + cálculo de dosis de medicamento mediante IA**

> Sube una foto de tu plato → la IA estima la grasa → se calcula la dosis automáticamente.

---

## ¿Qué hace?

1. **Analiza la imagen** con Google Gemini 1.5 Flash (Vision)
2. **Estima** grasa total, grasa saturada y calorías del plato
3. **Calcula la dosis** del medicamento según la fórmula: `dosis = grasa_g × mg_por_gramo`
4. Aplica límites mínimo/máximo configurables

---

## Demo rápida (sin servidor)

Solo necesitas abrir `index.html` en cualquier navegador moderno. No requiere instalación ni dependencias.

```bash
git clone https://github.com/TU_USUARIO/fat-dose-app.git
cd fat-dose-app
# Abre index.html en tu navegador (doble clic o arrástralo)
```

---

## Configuración

1. Obtén tu API key en [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Abre la app → campo **API Key** → pega la clave → **Guardar**
   - La clave se guarda en `localStorage` de tu navegador (nunca sale de tu dispositivo)

---

## Medicamentos preconfigurados

| Medicamento   | mg/g grasa | Dosis mín | Dosis máx | Uso típico |
|---------------|-----------|-----------|-----------|------------|
| **Orlistat**  | 1.5       | 30 mg     | 120 mg    | Obesidad / inhibidor lipasa |
| **Pancrelipasa** | 2.5    | 500 mg    | 2500 mg   | Insuficiencia pancreática exocrina |
| **Personalizado** | libre | libre     | libre     | Cualquier medicamento |

> ⚠️ Los valores son orientativos. Ajusta siempre según prescripción médica.

---

## Fórmula de cálculo

```
dosis_bruta  = grasa_total_g × dosis_por_gramo
dosis_final  = clamp(dosis_bruta, dosis_min, dosis_max)
dosis_redondeada = round(dosis_final / 5) × 5   # múltiplos de 5 mg
```

---

## Stack técnico

| Capa | Tecnología |
|------|-----------|
| Frontend | HTML + CSS + JS vanilla (0 dependencias) |
| IA Vision | Google Gemini 1.5 Flash (API REST) |
| Almacenamiento | `localStorage` del navegador |
| Despliegue | Cualquier hosting estático (GitHub Pages, Netlify, etc.) |

---

## Despliegue en GitHub Pages

1. Ve a **Settings → Pages** de tu repositorio
2. Source: `main` branch, carpeta `/root`
3. La app queda disponible en `https://TU_USUARIO.github.io/fat-dose-app/`

---

## Roadmap (próximas versiones)

- [ ] Historial de análisis (IndexedDB)
- [ ] Exportar informe PDF
- [ ] Modo cámara en tiempo real
- [ ] Soporte para múltiples platos por comida
- [ ] Backend con autenticación (para uso clínico)
- [ ] Validación con base de datos nutricional (USDA / OpenFoodFacts)

---

## Aviso legal

> Este software es un prototipo con fines de investigación y demostración. **No constituye consejo médico.** Consulta siempre a un profesional sanitario antes de modificar cualquier pauta de medicación. Los autores no se responsabilizan del uso clínico de esta herramienta.

---

## Licencia

MIT © 2024
