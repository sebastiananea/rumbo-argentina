# Backend: catálogo, usuarios e historial

## Arquitectura de esta entrega

Angular usa Supabase Auth (correo/contraseña) y la API de Supabase. PostgreSQL expone funciones RPC para crear partidas, elegir ubicaciones, iniciar rondas y confirmar apuestas. Una tarea programada de GitHub prepara cinco panoramas compartidos por fecha argentina; el juego deja de sortear ciudades por usuario. Estas operaciones son transacciones: identifican al usuario por su sesión, bloquean la partida, controlan el plazo y calculan el puntaje. No hace falta desplegar otra API de Vercel en esta etapa. La interfaz queda en Vercel.

Con Supabase, invitados y cuentas juegan el desafío publicado. Sin Supabase solo se ofrece una demostración local con candidatos deterministas por fecha, sin preparación compartida. Las partidas de invitado no se guardan ni se incorporan retroactivamente a una cuenta. Con cuenta, cada ronda se guarda antes de permitir avanzar y al terminar se muestra la confirmación del historial.

No incluye multijugador ni pagos.

## Crear y conectar el proyecto

1. Crear un proyecto propio en [Supabase](https://supabase.com/dashboard). Elegir región y plan; guardar la contraseña de PostgreSQL de forma privada. El repositorio no crea proyectos ni cuentas de proveedores.
2. En **SQL Editor**, ejecutar, en este orden, el contenido completo de:
   - `supabase/migrations/202610130001_backend.sql`
   - `supabase/migrations/202610130002_catalog_candidates.sql`
   - `supabase/migrations/202610130003_daily_challenges.sql`
   Estas migraciones iniciales se aplican una sola vez. Con Supabase CLI también pueden aplicarse con `supabase db push` después de vincular el proyecto.
3. En los ajustes de API obtener la URL del proyecto y la clave **publishable** (o la antigua clave pública **anon**). Configurar en Vercel `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY`, además de la `GOOGLE_MAPS_API_KEY` existente. Volver a desplegar: las tres variables se incorporan al frontend durante el build. Las claves públicas son públicas; jamás usar `service_role` o `sb_secret_...` en `SUPABASE_PUBLISHABLE_KEY`.
4. En **Authentication → URL Configuration**, definir la URL pública de Vercel como **Site URL** y permitir los redirects de ese dominio y `http://localhost:4200/` para desarrollo. Registrar explícitamente los dominios de Preview que se vayan a utilizar. Habilitar el proveedor **Email**, mantener la confirmación de correo y exigir contraseñas de al menos ocho caracteres. Para uso público configurar SMTP propio y revisar los límites de envío de Supabase; el correo de pruebas del proveedor no es un servicio de producción.
5. Configurar el preparador automático según [la guía de desafíos diarios](daily-challenges.md): dos variables y dos secretos privados en GitHub Actions. Ejecutar **Preparar desafío diario → Run workflow → today** para generar el primer desafío. Es una tarea del dueño del proyecto; ningún jugador necesita ser administrador o validar lotes.
6. Registrar una cuenta o ingresar con Google y jugar. Invitados y cuentas reciben las mismas cinco ubicaciones; solo las cuentas guardan historial. El reloj empieza al cargar el panorama de cada ronda.
7. Habilitar **Supabase Cron** y ejecutar `supabase/maintenance.sql` una vez. Limpia cada hora las coordenadas temporales de panoramas de partidas abandonadas durante más de un día. Las coordenadas también se eliminan al confirmar la ronda o reemplazar una partida en curso.
8. Validar en el proyecto real: crear dos cuentas, jugar cinco rondas, ver el historial, recargar, salir e ingresar de nuevo. La segunda cuenta no debe ver el historial de la primera. Probar recuperación de contraseña y una ronda agotada. Las pruebas locales de SQL no sustituyen la configuración real de Auth, correo, Google y red.

No enviar claves privadas por chat ni guardarlas en Git. Este entorno necesita las variables públicas también en sus propios ajustes si se quiere probar conectado a Supabase; Vercel no las inyecta acá.

## Ingreso con Google

El formulario de ingreso y registro incluye **Continuar con Google**. Supabase crea la cuenta en el primer ingreso y administra la sesión y el perfil como en el flujo por correo. No hace falta una nueva migración para habilitar este botón.

En Google Cloud crear un cliente OAuth de tipo Aplicación web. En **URIs de redireccionamiento autorizados** agregar exactamente `https://TU_PROJECT_REF.supabase.co/auth/v1/callback`, sin barra final; copiar la URL que muestra Supabase. En Supabase → Authentication → Providers → Google habilitar el proveedor y guardar el Client ID y el Client Secret de OAuth. El secreto va solo en Supabase; no es la clave de Google Maps ni una variable del frontend. Configurar la pantalla de consentimiento de Google; si la aplicación está en modo Testing, agregar los usuarios de prueba autorizados.

El botón vuelve a la raíz del dominio desde el que se abrió el juego. Ese destino debe estar permitido en Authentication → URL Configuration. Verificar el flujo real en Vercel, incluyendo regreso al juego, historial y cierre de sesión. El proveedor Google se probó localmente mediante una redirección simulada, no mediante una cuenta real.

## Catálogo y ampliación

`data/catalog-candidates.json` contiene 51 coordenadas aproximadas seleccionadas independientemente para empezar: barrios del AMBA, localidades de diferentes provincias y algunos puntos de rutas. **No es un catálogo de miles de puntos ni cobertura validada de Google.** La migración de datos los crea con estado `pending`. El preparador puede comprobar candidatos pendientes. Solo publica un desafío después de encontrar exactamente cinco panoramas navegables. Los jugadores no tienen que revisar el catálogo.

Para ampliar el catálogo, preparar otro JSON con `seed_slug` único, `name`, `region` (provincia), `kind` (`city`, `town` o `road`), `lat` y `lng`. Usar una fuente independiente con licencia compatible y verificar que los puntos estén dentro de Argentina; el rectángulo de límites de la base de datos no reemplaza una validación territorial. No extraer coordenadas de Google para crear un catálogo masivo sin revisar sus condiciones.

Importación administrativa opcional desde una máquina confiable:

```sh
# Definir SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY mediante el gestor seguro de variables.
# La service-role es privada, solo para este script, y no se incorpora al frontend.
node scripts/import-catalog.mjs ruta/al/catalogo.json
```

Importa lotes de 250 y conserva los registros existentes, incluida su validación. Un mismo `seed_slug` nunca cambia de coordenadas por este script; para mover un punto hay que revisarlo administrativamente y volver a validarlo. Las claves nuevas quedan pendientes. El panel administrativo opcional revisa primero las ubicaciones nunca comprobadas y luego las más antiguas, por lo que también sirve para revalidar cobertura.

El preparador prioriza candidatos no usados en los últimos siete días, puntos ya revisados y variedad de provincias y entornos. Son prioridades, no garantías cuando el catálogo disponible es pequeño. El desafío guarda cinco IDs distintos de catálogo y de panorama, en un orden compartido. La ronda de un jugador no puede reemplazarse por otro sitio distinto: eso rompería la igualdad del desafío.

## Historial y límites de esta etapa

- Las políticas RLS permiten leer únicamente el perfil, las partidas y las rondas del usuario autenticado. Los usuarios no tienen permisos directos para escribir puntos, plazos o estados.
- Crear una nueva partida abandona la anterior en curso; sus resultados ya confirmados se conservan. Una partida nueva y su confirmación se pueden reintentar sin duplicar registros o puntos. Todavía no se reanuda una partida al recargar.
- El servidor controla los dos minutos y calcula la distancia y el puntaje. El navegador muestra el plazo ajustado respecto de la hora del servidor; una apuesta que llegue tarde al servidor da cero puntos.
- **No es un sistema antitrampas competitivo.** El navegador todavía recibe coordenadas de catálogo y comunica la posición real del panorama, que el servidor limita a 1,05 km del candidato. Antes de competencias habría que verificar ese panorama mediante un componente confiable y revisar la exposición de datos del visor.
- No se persisten imágenes ni enlaces de Google. El desafío conserva IDs de panorama, cuyo uso debe revisarse conforme a las condiciones de Google. La posición del panorama se mantiene temporalmente para calcular la ronda; después solo se guardan las coordenadas originales del catálogo, las apuestas del jugador y los resultados derivados. Revisar las condiciones vigentes de Google y la retención permitida antes de un lanzamiento público o una importación grande.
- Se permiten repeticiones de las mismas cinco ubicaciones, guardadas como intentos separados; no se impuso un único intento puntuable. El historial identifica el día del desafío y muestra las últimas 30 partidas y sus rondas. No hay clasificación pública, salas, suscripciones ni almacenamiento de contraseñas en nuestras tablas: Auth administra las credenciales.

## Verificación local

`npm test` ejecuta las pruebas del juego, la búsqueda de panoramas y las migraciones/funciones/RLS en PostgreSQL embebido con PGlite. Los roles y `auth.uid()` de Supabase se simulan en la prueba, mientras que la transacción, las restricciones y las políticas SQL se ejecutan realmente. No requiere Docker ni un proyecto remoto.

`npm run build` verifica tipos y plantillas. Si este entorno bloquea Google Fonts, usar el workspace auxiliar documentado en `/workspace/.rumbo-dev`, sin alterar la lógica del backend. El navegador se valida con respuestas de Auth, API y Google simuladas mientras no existe un proyecto de Supabase conectado.
