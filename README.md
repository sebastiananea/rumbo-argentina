# Rumbo · GeoGuessr Argentina
MVP single player con Angular 22, TypeScript y Leaflet. Cinco rondas, selección de ubicación, resultados y resumen final responsive. Sin backend ni multijugador.

## Ejecutar
Node 24.15 o superior (24.x). `npm ci`, `npm start`. Producción: `npm run build`. Pruebas: `npm test`.

## Street View
En Google Cloud habilitar **Maps JavaScript API** y facturación. Crear una clave de navegador, restringirla a Maps JavaScript API y HTTP referrers: dominio publicado (`https://DOMINIO/*`) y desarrollo (`http://localhost:4200/*`). Ingresarla en “Configurar Google Maps”. No se guarda en disco, repositorio ni localStorage. La clave de navegador es visible en las solicitudes; las restricciones de Google son necesarias. Google puede cobrar por uso. No se necesita una clave para el mapa OpenStreetMap.

Se eligen 5 destinos sin repetir de 12 ciudades argentinas. StreetViewService busca un panorama exterior cercano (hasta 1 km), y la distancia se calcula contra las coordenadas **reales del panorama inicial**, aunque el jugador se desplace. Se ocultan direcciones y nombres de calles. Las atribuciones de Google y OSM se mantienen.

Sin clave o sin panorama disponible, no se puede comenzar ni confirmar apuestas. Los fallos aparecen en pantalla. No se persiste la partida al recargar.

## Puntaje
Haversine, radio terrestre medio de 6371.0088 km. `round(5000 * exp(-distanciaKm / 500))`; máximo 25.000 puntos por partida. La apuesta no se modifica después de confirmar.

## Verificación y límites
`npm test` cubre cálculo geográfico, antipodal, puntajes, selección sin repetición y ciclo completo de partida. `npm run build` valida plantillas y tipos Angular. Para verificar imágenes, controles y autorización real de Google hace falta una clave propia; no hay credenciales incluidas. El mapa requiere conexión a servidores de OpenStreetMap. El catálogo es público en el frontend: este MVP no evita trampas.
