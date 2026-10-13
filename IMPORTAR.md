# Llevar a tu repositorio
Requiere Node.js 24.15 o superior (24.x).

```bash
npm ci
npm start
```

Pruebas: `npm test`. Producción: `npm run build`.

## GitHub
Creá un repositorio vacío en GitHub. Dentro de esta carpeta:

```bash
git init
git add .
git commit -m "Initial Rumbo MVP"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
git push -u origin main
```

## Vercel
Importá tu repo, seleccioná Angular, Node 24.x, comando `npm run build` y directorio de salida `dist`.
Revisá las opciones de acceso antes de publicar: la privacidad de ChatGPT Sites no se exporta.
Agregá el dominio nuevo a los sitios autorizados de tu clave Google Maps. Ingresá la clave desde la interfaz del juego; no la subas al repo.

Este paquete contiene el código fuente actual, sin credenciales, dependencias, compilados ni historial Git del hosting original.
