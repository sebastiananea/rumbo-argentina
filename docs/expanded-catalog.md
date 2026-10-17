# Banco de ubicaciones y selección para salas

El repositorio incluye **1.190 coordenadas candidatas**, repartidas entre las 23 provincias y CABA. Incluye Hurlingham, Morón, Salta, Córdoba, Mar del Plata, Retiro y Constitución. Son centros aproximados: estar en esta lista no garantiza cobertura de Street View. La fuente y su licencia están en [data/README.md](../data/README.md).

El objetivo del preparador es **guardar al menos 500 panoramas diferentes y navegables**. Comprueba imágenes exteriores oficiales de Google y que tengan conexiones para moverse; descarta las fotos aisladas. Guarda el progreso de cada comprobación en Supabase y evita contar el mismo panorama dos veces.

## Activación, una sola vez

Con las migraciones 001–009 ya aplicadas, ejecutar en **Supabase → SQL Editor**, en este orden:

1. [202610170010_expanded_catalog.sql](../supabase/migrations/202610170010_expanded_catalog.sql): agrega las coordenadas candidatas sin borrar datos anteriores.
2. [202610170011_catalog_bank_rooms.sql](../supabase/migrations/202610170011_catalog_bank_rooms.sql): crea el banco validado y habilita los sorteos por sala.

Luego, en **GitHub → Actions → Ampliar y validar catálogo → Run workflow**, elegir la rama `main` y el objetivo `500`. Reutiliza las dos variables (`SUPABASE_URL`, `RUMBO_SITE_URL`) y los dos secretos (`SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_MAPS_API_KEY`) del preparador diario. La clave de Google debe autorizar el dominio de `RUMBO_SITE_URL`. No se agregan claves al navegador ni al repositorio.

La carga se confirma únicamente cuando el registro muestra `CATALOG_READY: at least 500 verified locations saved`. Si termina antes o falla, las ubicaciones ya guardadas se conservan: volver a ejecutarlo continúa el trabajo. Un resultado verde de otro workflow, como el desafío diario, no confirma este objetivo.

Se puede consultar el total actual en SQL Editor:

```sql
select count(*) as ubicaciones_jugables
from public.catalog_panoramas p
join public.locations l on l.id = p.location_id
where l.validation_status = 'active'
  and p.verified_at > now() - interval '28 days';
```

## Funcionamiento y costos

Cada sala nueva sortea cinco ubicaciones distintas del banco. Prioriza provincias diversas y evita las usadas por su anfitrión en los últimos siete días cuando hay suficientes alternativas. Todos los integrantes reciben la misma selección; queda fijada aunque cambie el catálogo. Las salas anteriores conservan sus puntos. El desafío diario sigue teniendo las mismas cinco ubicaciones para todos.

Hasta contar con cinco puntos frescos en el banco, las salas pueden usar el último desafío preparado. No consumen el intento diario del usuario ni alteran su clasificación.

La validación usa Google y puede generar cargos según la facturación del proyecto. Cada ejecución revisa como máximo 1.200 candidatos, con hasta cinco consultas por candidato, y se detiene al alcanzar el objetivo. Las solicitudes normales para mostrar Street View durante el juego siguen teniendo sus costos habituales. Crear una sala sortea datos guardados en PostgreSQL, sin buscar nuevas coordenadas en Google.

El workflow se ejecuta también a las 00:30 de Argentina para mantener un mínimo de 500 puntos recientes. Los IDs se revisan al cumplir 28 días; los candidatos sin cobertura se reintentan después de siete días. Se almacenan IDs de panorama y fechas de comprobación; no se descargan imágenes de Google ni se incorporan sus coordenadas al catálogo independiente. Aplican las condiciones y atribuciones de Google Maps Platform.
