# CedulaScan Pro

Aplicación para registrar asistencia en eventos mediante escaneo de cédulas colombianas, con backend FastAPI, MongoDB, Expo React Native, autenticación JWT, anti-duplicados y exportación XLSX.

## Estructura

- `backend/`: API FastAPI, WebSocket, OCR, importación/exportación y carga inicial de afiliados.
- `frontend/`: app Expo con pantallas de inicio de sesión, eventos, escaneo, panel, auditoría, administración y perfil.
- `backend/seed/afiliados.csv`: base inicial de afiliados.

## Backend

Variables requeridas en `backend/.env` o en el entorno del servidor:

```env
MONGO_URL=mongodb://localhost:27017
DB_NAME=cedulascan
JWT_SECRET_KEY=cambia_esto_por_un_secreto_largo
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_HOURS=12
ADMIN_EMAIL=admin@cedulascan.local
ADMIN_PASSWORD=Admin123!
CORS_ORIGINS=*
```

Para producción, cambia `JWT_SECRET_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` y limita `CORS_ORIGINS` al dominio real del frontend cuando aplique.

Comandos:

```bash
cd backend
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8000
```

Verificación:

```text
GET /api/
GET /api/health/dependencies
```

Si el OCR no lee imágenes en producción, abre `/api/health/dependencies` en el backend publicado. Debe reportar `pytesseract: true`, `tesseract_available: true`, `zxingcpp: true`, `opencv: true` y `numpy: true`. Para despliegues tipo Render/Railway que acepten Docker, usa `backend/Dockerfile`; instala Tesseract, OpenCV y el idioma español dentro de la imagen.

## Railway

El backend esta preparado para Railway con `railway.json` y `Dockerfile.railway`.
El contenedor escucha el `PORT` que inyecta Railway y no copia Android, `node_modules`, `.env`, `.mongo-data` ni caches.

Proyecto Railway:

```bash
npx --yes @railway/cli link -p 0fa5559c-85e6-4d16-94f1-fb88e1a6741a
npx --yes @railway/cli up --project 0fa5559c-85e6-4d16-94f1-fb88e1a6741a
```

Variables requeridas en Railway:

```env
MONGO_URL=<mongodb de produccion>
DB_NAME=cedulascan
JWT_SECRET_KEY=<secreto largo>
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_HOURS=12
BCRYPT_ROUNDS=10
ADMIN_EMAIL=<admin real>
ADMIN_PASSWORD=<password inicial>
CORS_ORIGINS=*
GEMINI_ENABLED=auto
GEMINI_API_KEY=<api key>
GEMINI_MODEL=gemini-2.5-flash
GEMINI_OCR_MODE=auto
GEMINI_MIN_CONFIDENCE=0.40
GEMINI_TIMEOUT_SECONDS=18
ALLOW_WIPE_AFILIADOS=false
```

Despues de publicar Railway, recompila Android con la URL publica del backend:

```bash
cd frontend
EXPO_PUBLIC_BACKEND_URL=https://tu-servicio.up.railway.app npm run android
```

## Frontend

Variable requerida:

```env
EXPO_PUBLIC_BACKEND_URL=https://tu-api.com
```

Comandos:

```bash
cd frontend
yarn install
yarn start
yarn android
```

Para crear APK/AAB de producción usa EAS Build con la variable `EXPO_PUBLIC_BACKEND_URL` apuntando al backend publicado.

Importante: si compilas con EAS o usas un dev client en el celular, `EXPO_PUBLIC_BACKEND_URL` se embebe al construir el bundle. Debe ser una URL pública HTTPS del backend, no una IP local como `192.168.x.x`, salvo que el teléfono esté en la misma red y sea solo desarrollo LAN.

## Notas De Producción

- La primera ejecución crea índices de MongoDB y un administrador inicial.
- El backend carga afiliados desde `backend/seed/afiliados.csv` si la colección está vacía.
- La exportación XLSX requiere usuario administrador y funciona con header `Authorization` o con el token temporal que genera la app para abrir la descarga.
- El OCR requiere Tesseract instalado en el servidor o ambiente donde corra el backend.
- La lectura robusta de PDF417 usa `zxing-cpp` + `opencv-python-headless`; ambos deben estar instalados en producción.
