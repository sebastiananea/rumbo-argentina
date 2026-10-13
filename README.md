# Rumbo · GeoGuessr Argentina
MVP single player con Angular 22, TypeScript y Leaflet. Pantalla de inicio, cinco rondas de dos minutos, selección de ubicación, resultados y resumen final responsive. Sin backend ni multijugador.

## Ejecutar
Node 24.15 o superior (24.x). `npm ci`, `npm start`. Producción: `npm run build`. Pruebas: `npm test`.

## Cómo jugar
La pantalla de inicio muestra las reglas y el botón **Jugar**. El mapa y Street View se inicializan recién al pulsarlo. Cada ronda dispone de **2 minutos**, contados desde que se obtiene el panorama, sin descontar el tiempo de carga. Hay que marcar y confirmar una ubicación antes del límite: si se agota el tiempo, la ronda termina con **0 puntos**, incluso si había una apuesta marcada sin confirmar. El reloj sigue corriendo al salir de la vista de juego o cambiar de pestaña. Se puede avanzar a la siguiente ronda o volver a jugar después del resumen final.

## Street View
En Google Cloud habilitar **Maps JavaScript API** y facturación. Crear una clave de navegador y configurarla en Vercel como variable de entorno `GOOGLE_MAPS_API_KEY`, disponible para el entorno de producción (y Preview si corresponde). Después de agregar o cambiar la variable, volver a desplegar para que Angular la incluya en el build. Localmente, se puede definir esa misma variable antes de `npm start` o `npm run build`.

La clave se incorpora al JavaScript que recibe el navegador: una variable de entorno evita guardarla en el repositorio, pero no la hace secreta. Restringirla en Google Cloud a **Maps JavaScript API** y a HTTP referrers del dominio publicado (`https://DOMINIO/*`) y desarrollo (`http://localhost:4200/*`); configurar cuotas y alertas de facturación. Google puede cobrar por uso. Si falta la variable o falla la autenticación, la aplicación muestra un error y no inicia Street View. No se necesita una clave para el mapa OpenStreetMap.

Se eligen 5 destinos sin repetir de 12 ciudades argentinas. StreetViewService busca un panorama exterior cercano (hasta 1 km), y la distancia se calcula contra las coordenadas **reales del panorama inicial**, aunque el jugador se desplace. Se ocultan direcciones y nombres de calles. Las atribuciones de Google y OSM se mantienen.

Sin una clave configurada o sin panorama disponible, no se puede comenzar ni confirmar apuestas. Los fallos aparecen en pantalla. No se persiste la partida al recargar.

## Puntaje
Haversine, radio terrestre medio de 6371.0088 km. `round(5000 * exp(-distanciaKm / 500))`; máximo 25.000 puntos por partida. La apuesta no se modifica después de confirmar.

## Verificación y límites
`npm test` cubre cálculo geográfico, antipodal, puntajes, selección sin repetición ciclo completo de partida, límite de tiempo, apuestas tardías y rondas agotadas. `npm run build` valida plantillas y tipos Angular. Para verificar imágenes, controles y autorización real de Google hace falta configurar una clave propia en el entorno. El mapa requiere conexión a servidores de OpenStreetMap. El catálogo es público en el frontend: este MVP no evita trampas.
