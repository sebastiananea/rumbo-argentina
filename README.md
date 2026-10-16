# Rumbo · GeoGuessr Argentina
MVP single player con Angular 22, TypeScript y Leaflet. Pantalla de inicio, desafío diario compartido con cinco rondas de dos minutos, selección de ubicación, resultados y resumen final responsive. Backend opcional con Supabase para cuentas, catálogo e historial privado. Sin multijugador ni suscripciones.

## Ejecutar
Node 24.15 o superior (24.x). `npm ci`, `npm start`. Producción: `npm run build`. Pruebas: `npm test`.

## Cuentas, catálogo e historial
La integración incluye registro, ingreso con Google o correo, recuperación de contraseña, catálogo validable, desafío diario compartido e historial privado. Para activarla hace falta crear un proyecto propio de Supabase y configurar sus variables públicas en Vercel. Seguir [la guía del backend](docs/backend.md), que incluye las migraciones, el administrador de catálogo, la importación de nuevos puntos y la verificación real. Sin Supabase, el juego continúa como invitado y no guarda partidas.

## Desafío diario
Todos reciben las mismas cinco ubicaciones y el mismo orden durante el día de Argentina. El preparador de GitHub Actions valida y publica el siguiente desafío antes de medianoche; si falla se mantiene el último disponible durante todo el día, sin cambios a mitad de partida. No hace falta ser administrador ni validar puntos para jugar. Cada cuenta tiene un único intento por día; puede continuarlo si sale y consultar el puntaje al terminar. El inicio muestra los participantes y los cinco mejores puntajes del día entre cuentas que completaron el desafío. Para actualizar el proyecto existente, aplicar las migraciones pendientes y configurar el preparador: [instrucciones de activación](docs/daily-challenges.md).

## Cómo jugar
La pantalla de inicio muestra las reglas y el botón **Jugar**. El mapa y Street View se inicializan recién al pulsarlo. Cada ronda dispone de **2 minutos**, contados desde que se obtiene el panorama, sin descontar el tiempo de carga. Hay que marcar y confirmar una ubicación antes del límite: si se agota el tiempo, la ronda termina con **0 puntos**, incluso si había una apuesta marcada sin confirmar. El reloj sigue corriendo al salir de la vista de juego o cambiar de pestaña. Se puede avanzar a la siguiente ronda o volver a jugar después del resumen final.

## Street View
En Google Cloud habilitar **Maps JavaScript API** y facturación. Crear una clave de navegador y configurarla en Vercel como variable de entorno `GOOGLE_MAPS_API_KEY`, disponible para el entorno de producción (y Preview si corresponde). Después de agregar o cambiar la variable, volver a desplegar para que Angular la incluya en el build. Localmente, se puede definir esa misma variable antes de `npm start` o `npm run build`.

La clave se incorpora al JavaScript que recibe el navegador: una variable de entorno evita guardarla en el repositorio, pero no la hace secreta. Restringirla en Google Cloud a **Maps JavaScript API** y a HTTP referrers del dominio publicado (`https://DOMINIO/*`) y desarrollo (`http://localhost:4200/*`); configurar cuotas y alertas de facturación. Google puede cobrar por uso. Si falta la variable o falla la autenticación, la aplicación muestra un error y no inicia Street View. No se necesita una clave para el mapa OpenStreetMap.

Con Supabase, todos juegan los cinco panoramas publicados del desafío diario. La tarea de preparación comprueba imágenes exteriores oficiales de Google y conexiones para moverse, descartando candidatos sin cobertura. El navegador carga el ID publicado; no busca una ciudad diferente para cada usuario. El reloj empieza al obtener el panorama, y la distancia se calcula contra sus coordenadas reales, aunque el jugador se desplace. Se mantienen las atribuciones de Google y OSM. Sin Supabase, el entorno local ofrece únicamente una demostración con cinco centros candidatos deterministas por fecha, sin publicación compartida ni historial.

Sin una clave configurada o sin panorama disponible, no se puede comenzar ni confirmar apuestas. Los fallos aparecen en pantalla. Con cuenta se guardan los resultados confirmados en el historial; todavía no se reanuda una partida al recargar.

## Puntaje
Haversine, radio terrestre medio de 6371.0088 km. `round(5000 * exp(-distanciaKm / 500))`; máximo 25.000 puntos por partida. La apuesta no se modifica después de confirmar.

## Verificación y límites
`npm test` cubre cálculo geográfico, antipodal, puntajes, selección sin repetición, ciclo completo de partida, límite de tiempo, apuestas tardías y rondas agotadas. También ejecuta las migraciones y verifica aislamiento entre usuarios, privilegios administrativos, plazos, puntajes e idempotencia del backend. `npm run build` valida plantillas y tipos Angular. Para verificar imágenes, controles y autorización real de Google hace falta configurar una clave propia en el entorno. El mapa requiere conexión a servidores de OpenStreetMap. Las coordenadas del catálogo siguen disponibles para el navegador: esta etapa no evita todas las trampas. Ver los límites de confianza y almacenamiento en la guía del backend.

### Música del juego

El modo juego incluye una melodía ambiental original generada con Web Audio (`src/music.ts`), sin grabaciones, samples ni música de terceros. La composición y su implementación se ofrecen bajo CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/ . No requieren atribución. Suena a volumen suave tras pulsar Jugar, se detiene en resultados, al salir y al ocultar la pestaña. El botón «Música» permite silenciarla y recuerda esa preferencia en el navegador. No requiere claves, descargas ni servicios externos.
