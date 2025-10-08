# Simulador Médico v3

Reescritura limpia con UX mejorada y mismas funcionalidades clave:

- Carga de CSV (parser robusto con comillas y saltos de línea)
- Configuración de examen (tiempo, cantidad, barajar preguntas/opciones)
- Cronómetro con pausa/reanudar (tecla P)
- Navegador de preguntas con filtros (todas/pendientes/marcadas)
- Marcadores 🚩 y notas por pregunta
- Progreso en localStorage (exportar/importar JSON)
- Resultados con gauge, revisión detallada y exportación de errores (CSV)
- Refuerzo dirigido + flashcards con valoración de dificultad
- Dashboard de estadísticas por categoría
- PWA (offline): service worker + manifest
- Accesibilidad básica (roles, atajos, skip-link)

## Uso
1. Abrir `index.html` en el navegador (sirve también con Live Server).
2. Cargar un CSV o descargar la plantilla.
3. Atajos: A–D, ←/→ o Enter, F, P.

CSV esperado: `pregunta,opcion_a,opcion_b,opcion_c,opcion_d,respuesta,categoria,explicacion`
