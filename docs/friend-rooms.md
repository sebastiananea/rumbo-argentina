# Google obligatorio, alerta y salas privadas

## Activación del proyecto existente

Aplicar una sola vez en Supabase → SQL Editor, en este orden:

1. `supabase/migrations/202610170008_google_login.sql`
2. `supabase/migrations/202610170009_friend_rooms.sql`

Requieren las migraciones 001–007 ya aplicadas. No volver a ejecutarlas. Las cuentas, perfiles, partidas y puntajes existentes se conservan. No requiere nuevas claves ni habilitar Supabase Realtime.

En Supabase → Authentication → Sign In / Providers, mantener Google habilitado y deshabilitar Email y los demás proveedores. Comprobar el acceso real con Google después del deploy. La aplicación muestra solo Google, exige su sesión antes de cargar el juego y las funciones de juego exigen el método `oauth` en `amr` y Google entre los proveedores del JWT firmado de Supabase. Esto admite cuentas antiguas vinculadas a Google y bloquea sesiones por contraseña incluso si el perfil ya tiene Google vinculado. Es necesario dejar Google como único proveedor OAuth habilitado, porque `amr` identifica OAuth y no distingue entre proveedores OAuth vinculados. Una sesión antigua de correo no puede iniciar ni enviar rondas: hay que salir y volver a ingresar con Google. No modificar perfiles desde el navegador para simular el proveedor; eso no cambia el token firmado. Los visitantes siguen viendo la presentación y el top público, pero no pueden jugar.

## Cómo jugar con amigos

Una cuenta con Google crea una sala y comparte el código privado de 10 caracteres. Hasta ocho personas pueden entrar antes de empezar. Se necesitan al menos dos para iniciar. El anfitrión inicia cada ronda y todos reciben el mismo panorama y un plazo compartido de dos minutos, fijado por PostgreSQL. La primera respuesta reduce el plazo compartido a un máximo de 15 segundos para el resto. Si ya quedaban menos, no se extiende. Las respuestas siguientes tampoco reinician el reloj. Cargar Street View o recargar la página no reinicia ese plazo. Si el panorama tarda, ese tiempo cuenta para todos; existe un botón de reintento.

Cada jugador puede confirmar una sola apuesta por ronda. Los puntajes y distancias no se revelan hasta que todos los participantes activos hayan enviado o venza el tiempo. Al vencer, el servidor registra cero para quienes no respondieron. La siguiente ronda espera al anfitrión; la quinta termina con una clasificación final. Salir de la vista de Street View vuelve al panel de la sala sin abandonar la partida. Salir de la sala la abandona y transfiere el anfitrión a otro participante activo; las apuestas ya enviadas se conservan. Si el anfitrión se desconecta por más de 90 segundos, otro participante activo puede iniciar la siguiente ronda.

El código de la sala actual se conserva en `sessionStorage` para recuperarla al recargar la pestaña. No se publica un listado de salas ni se permite consultar una sala a quien no es miembro. Mientras la pestaña está visible, el estado se consulta cada segundo durante las rondas y cada tres segundos en el lobby y los resultados. El plazo acortado es autoritativo en el servidor y llega a los otros navegadores en la siguiente consulta; no hay una garantía de actualización instantánea si la red se demora. La sala vence a las seis horas; crear salas tiene un límite de diez por cuenta cada 24 horas. Esto no reemplaza límites contra bots en la plataforma.

Las salas usan las cinco ubicaciones del desafío preparado del día al crearse y mantienen esa selección al cambiar de fecha. Las salas y su clasificación están separadas del intento diario: no lo consumen ni alteran el top público. Alguien que ya jugó el desafío puede conocer esos lugares; es una modalidad casual para amigos, no una competencia protegida contra trampas.

Los puntajes de salas se calculan exclusivamente en PostgreSQL contra las coordenadas independientes del catálogo, iguales para todos; el jugador no envía ni puntajes ni coordenadas de destino. El panorama puede estar desplazado respecto del centro del catálogo (la validación busca cobertura cercana). El cliente recibe información geográfica para mostrar el juego; no se promete impedir trampas por inspección del navegador. Las tablas de salas tienen RLS y no permiten lecturas ni escrituras directas de clientes; solo funciones con autenticación y verificación de pertenencia. La clave administrativa nunca va al frontend.

## Alerta de tiempo

El cronómetro se destaca en rojo y pulsa suavemente una vez por segundo entre 15 y 1 segundos restantes, tanto en el desafío como en salas. Con `prefers-reduced-motion`, la alerta queda roja fija. Se detiene al responder, al terminar el tiempo o salir.

## Verificación

Las pruebas SQL ejecutan PostgreSQL embebido con roles simulados y comprueban Google obligatorio, pertenencia, permisos, capacidad, plazos compartidos, reintentos idempotentes, apuestas inmutables, ocultamiento de resultados, expiración, cambio de anfitrión y separación del desafío. La configuración de proveedores, migraciones y acceso OAuth en el proyecto remoto requieren la activación indicada arriba.
