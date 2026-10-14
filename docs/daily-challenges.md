# Activar el desafío diario compartido

## Qué cambia

Todos juegan las mismas cinco ubicaciones, con el mismo orden y los mismos IDs de panorama. La fecha se calcula en PostgreSQL usando `America/Argentina/Buenos_Aires`. Las partidas registradas guardan el día y el ID del desafío; se permiten varios intentos, que repiten esos cinco sitios.

La revisión no es trabajo del jugador. Un preparador confiable ejecuta Google Maps en un navegador de GitHub Actions y valida imágenes exteriores oficiales con conexiones. Selecciona cinco puntos distintos, prioriza provincias y entornos diferentes y publica el lote completo en una sola transacción. El proceso confiable guarda el resultado de cobertura en el catálogo. No publica desafíos parciales ni promueve candidatos a activos basándose en reportes de jugadores y no concede permisos administrativos a usuarios.

El frontend carga los panoramas publicados por ID. Si Google deja de ofrecer uno, muestra un error y permite reintentar; no cambia silenciosamente la ubicación para ese jugador.

## Configuración única del dueño del proyecto

Si ya se ejecutaron las migraciones 001 y 002, ejecutar **solo** el archivo completo `supabase/migrations/202610130003_daily_challenges.sql` en Supabase → SQL Editor. La migración agrega tablas y actualiza funciones; conserva las cuentas y el historial existente. Se aplica una sola vez, no hay que repetir las migraciones anteriores. Los proyectos nuevos aplican 001, 002 y 003 en orden.

En GitHub → repositorio → Settings → Secrets and variables → Actions, configurar:

| Tipo | Nombre | Valor |
|---|---|---|
| Variable | `SUPABASE_URL` | URL base del proyecto, igual que en Vercel, sin `/rest/v1/`. |
| Variable | `RUMBO_SITE_URL` | Dominio HTTPS principal del juego en Vercel, sin rutas. |
| Secret | `SUPABASE_SERVICE_ROLE_KEY` | Clave privada del servidor: service-role o secret key de Supabase. Nunca la clave publishable. |
| Secret | `GOOGLE_MAPS_API_KEY` | Clave de navegador de Maps JavaScript API, con referrers que autoricen `RUMBO_SITE_URL`. |

La clave privada de Supabase se usa únicamente en el proceso de preparación. **No configurarla como `SUPABASE_PUBLISHABLE_KEY`, no incorporarla al frontend y no enviarla por chat.** Usar valores reales en los Secrets de GitHub, no placeholders de un proxy. Esta tarea no necesita contraseñas de usuarios, Client Secret de Google OAuth ni una API nueva de Google: reutiliza Maps JavaScript API.

Después:

1. Confirmar que el despliegue de `main` terminó y que `RUMBO_SITE_URL` abre la aplicación sin una pantalla de protección de Vercel. El navegador automatizado debe poder acceder al dominio público.
2. En GitHub → Actions → **Preparar desafío diario**, pulsar **Run workflow**, elegir `main` y dejar `target: today`.
3. Esperar que termine correctamente. El mensaje `Published five navigable locations for ...` confirma la publicación en Supabase; la ejecución omitida por falta de configuración no la confirma.
4. Abrir el juego y pulsar **Volver a consultar** si aún mostraba preparación. Debe aparecer el desafío y quedar habilitado **Jugar** tanto para invitados como para cuentas.
5. Probar con dos navegadores/cuentas: deben recibir los mismos lugares. Jugar cinco rondas con cuenta y verificar el historial.

Sin la migración, secretos y primera publicación, esta entrega no puede llamarse activa en producción. Conectar GitHub a Supabase no configura automáticamente los Secrets de Actions ni aplica necesariamente las migraciones.

## Horario, reintentos y continuidad

La tarea programada corre a las 22:00 y 23:00 de Argentina (01:00 y 02:00 UTC), preparando **el día siguiente**. La segunda ejecución omite el trabajo si el desafío ya está listo. Prepararlo antes de medianoche da margen ante retrasos de GitHub; GitHub Actions no garantiza una ejecución al segundo exacto.

A medianoche, la API utiliza el desafío de la nueva fecha. Si no está listo, fija el último disponible para todo ese día. Una publicación tardía no cambia los cinco puntos después de que alguien recibió el desafío de esa fecha. Las partidas empezadas antes de medianoche conservan sus ubicaciones y su día hasta terminar. Las repeticiones tampoco sortean nuevos puntos.

Un lease de diez minutos evita preparaciones concurrentes. Una falla libera el trabajo y establece una espera de diez minutos para reintentar; nunca reemplaza un desafío ya publicado. Las funciones de preparación solo pueden ejecutarse con la clave privada del servidor. Los jugadores únicamente consultan desafíos listos y escriben sus propias partidas mediante las funciones autenticadas.

El preparador vuelve a considerar los puntos sin cobertura cuya última revisión fue hace más de siete días. Comprueba como máximo 40 candidatos, con hasta cinco consultas por candidato. Si hay menos de cinco válidos, falla sin publicar un lote incompleto y conserva el desafío anterior. Google puede cambiar o retirar panoramas; los IDs se comprueban al cargarlos. Los datos independientes del catálogo se copian al desafío para que editar un candidato no modifique un día ya publicado.

## Costos y datos

Preparar cada día puede generar consultas facturables a Google y consume tiempo de GitHub Actions. Mostrar Street View al jugar puede generar costos adicionales por jugador; tener cinco ubicaciones compartidas no hace gratuitas las visualizaciones. Revisar precios, cuotas y facturación vigentes en ambos proveedores.

El desafío conserva IDs de panorama y las coordenadas/etiquetas originales del catálogo independiente, no fotos, enlaces ni las coordenadas resueltas de Google. Las coordenadas del panorama se usan temporalmente en la ronda como en el backend existente. Revisar las condiciones de Google sobre IDs, uso de su servicio y almacenamiento antes de un lanzamiento masivo. El visor mantiene las atribuciones.

## Verificación de esta entrega

Las pruebas ejecutan la migración nueva en PostgreSQL embebido y comprueban permisos, lotes atómicos de cinco, igualdad entre usuarios e invitados, fecha argentina, leases, fallback, snapshots e historial. El selector se prueba con cobertura y fallos simulados. El script real de preparación y el flujo de navegador se verifican con respuestas simuladas de proveedores, no con el proyecto remoto ni una cuenta real de Google. La activación descrita arriba sigue siendo necesaria.
