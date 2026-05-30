# PRD — CedulaScan Pro v2

**Stack**: FastAPI + MongoDB (Motor) + Expo React Native (Expo Router) + WebSockets + JWT + bcrypt + Expo Camera (PDF417) + xlsxwriter/openpyxl.

## Goal
Escaneo distribuido de cédulas colombianas en eventos. Múltiples operadores en varios dispositivos escanean simultáneamente con **cero duplicados garantizados** y broadcast en tiempo real. Autocompletado de datos del docente desde una base interna de 29 642 afiliados.

## Anti-duplicación (3 niveles)
1. Idempotency-Key cache (`deduplication` collection) → exactly-once.
2. Pre-check rápido por `(evento_id, cedula)`.
3. Unique compound index `(evento_id, cedula)` en MongoDB → race-safe.

## Lectura de código de barras (Colombia)
`extract_cedula` (backend) y `extractCedula` (frontend) parsean cualquier payload PDF417/QR/Code128 de la Registraduría:
- Tokens separados por `|`, `;`, espacios o saltos: toma el primero de 6-11 dígitos.
- Solo dígitos: lo usa tal cual si está en rango.
- Free-form: la corrida de dígitos más larga dentro de [6, 11].
- Cubre CC (8-10), TI (10-11), CE (6-7) y PPT (7-9).

## Base interna de afiliados (docentes)
- Sembrada al inicio desde `/app/backend/seed/afiliados.csv` (29 642 docentes).
- Columnas: cedula, nombre, sede, municipio, zona, cargo, titulo, email, celular, fecha_nac.
- En cada escaneo se enriquece automáticamente el registro con los datos del afiliado y se marca `es_afiliado=true`.

## Admin (rol)
Endpoints solo para `role=admin` (`require_admin` dependency):
- `GET /admin/afiliados?q=&limit=&skip=` — listar/buscar.
- `POST /admin/afiliados/import` — subir CSV o XLSX (upsert por cédula).
- `PATCH /admin/afiliados/{cedula}` — editar.
- `DELETE /admin/afiliados/{cedula}` y `DELETE /admin/afiliados` — borrar uno o todos.
- `GET /eventos/{id}/export` — descarga XLSX completo del evento.
- `PATCH/DELETE /eventos/{id}/registros/{id}` — corrige o elimina registros.
- `DELETE /eventos/{id}` — borra evento + sus registros + audit log.

Admin seed automático en startup vía `ADMIN_EMAIL` / `ADMIN_PASSWORD` (en `.env`).

## Pantallas
Sign-in / Sign-up · Tabs:
- **Eventos** — listar/crear (verde brand).
- **Escanear** — cámara PDF417 + manual con preview en vivo del afiliado (verde/amarillo).
- **Dashboard** — total, hoy, duplicados bloqueados, dispositivos.
- **Auditoría** — event sourcing (creados + duplicados rechazados + eliminaciones).
- **Admin** (solo admin) — buscar/editar/borrar afiliados, importar XLSX/CSV, exportar registros.
- **Perfil** — logout.

## Paleta verde institucional
`#009241` principal · `#00af47` light · `#00c425` success · `#00e73c` neon · `#006027` deep · `#009164` teal · `#00c692` mint sobre fondo `#0A0F0A`.

## Smart business enhancement
- **Contador de "duplicados bloqueados"** visible en dashboard y pestaña recientes — vende solo el ROI de integridad de datos.
- **Importación drag&drop por el cliente** elimina dependencia del proveedor.
