# Catálogo de coordenadas candidatas

`catalog-candidates.json` contiene **1.190** coordenadas independientes de Google, en las 23 provincias y CABA. Conserva los 51 puntos originales; añade 1.137 localidades deduplicadas de GeoNames y dos puntos seleccionados manualmente: Plaza Constitución y Plaza San Martín (Retiro). Los centros urbanos son aproximados: ni la población ni estar en el centro garantizan cobertura o navegación de Street View.

## Fuente y atribución

**GeoNames**, distribuido a través de [lutangar/cities.json](https://github.com/lutangar/cities.json), bajo [Creative Commons Attribution 4.0](licenses/CC-BY-4.0.txt). Fuente original: https://www.geonames.org/ ; términos: https://www.geonames.org/about.html . Coordenadas GeoNames, © GeoNames contributors, CC BY 4.0. El código de la aplicación no cambia de licencia.

- Instantánea del repositorio: `c05addfe79dce8a87076ef3fd487eab7e5fe4abd`.
- Archivo: `https://raw.githubusercontent.com/lutangar/cities.json/c05addfe79dce8a87076ef3fd487eab7e5fe4abd/cities.json`.
- SHA-256 del archivo mundial consultado: `9026f0201668325205be9e6299c317b3aad10d1b5f584524fdee718ee70282a3`.
- `geonames-argentina-source.json` conserva los 1.179 registros de Argentina extraídos de esa fuente, sin datos de Google.
- Cambios: filtrado por país AR y límites geográficos del juego; nombres de provincias normalizados desde los códigos administrativos GeoNames; exclusión de coordenadas a menos de 500 m de un candidato existente y de nombres iguales en la misma provincia a menos de 3 km. Los puntos existentes no se reemplazan.

Los puntos nuevos se insertan como `pending`. El proceso confiable debe encontrar un panorama exterior oficial con conexiones antes de marcarlos como activos. No se incluyen panoramas inventados ni se declara cobertura sin comprobarla.
