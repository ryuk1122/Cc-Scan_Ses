# Kit de actualización 1.0.9

Entrega del 26 de octubre de 2026. Aplicación Android 1.0.9, código 10; API 2.3.0.

## Contenido

La entrega integra lectura local continua de MRZ, PDF417 y QR, optimización del procesamiento de imágenes, validación de MRZ en cliente y servidor y respaldo de Gemini con revisión explícita. La APK y su suma SHA-256 se distribuyen como archivos de la versión en GitHub; los modelos OCR vienen incluidos.

El código no contiene migraciones destructivas de datos, cambios de dirección de MongoDB, rotación de credenciales, limpieza de registros ni reinicio de las colas locales. Los escaneos siguen guardándose primero en la cola persistente del teléfono y reintentándose con su clave de idempotencia. Los nuevos campos son opcionales para clientes anteriores.

## Actualización del servicio existente

Render está conectado a `ryuk1122/Cc-Scan_Ses`, rama `main`, directorio `backend`. Conserva su entorno, base de datos y credenciales actuales. El comando de construcción es `pip install -r requirements.txt` y el de arranque existente usa Uvicorn. No hace falta cambiar de proveedor ni crear otra base.

El endpoint `/api/health` identifica la API, la versión del lector y el commit desplegado. El nuevo `/api/ready` devuelve 200 únicamente cuando los índices terminaron de prepararse y la base de datos responde; devuelve 503 si todavía no está disponible. Usar `/api/ready` como comprobación de salud de Render después de incorporar esta versión.

La verificación remota debe confirmar API 2.3.0, lector 1.0.9, commit publicado y respuesta correcta de `/api/ready`. Confirmar también en OpenAPI las rutas de OCR local y respaldo Gemini. Las pruebas remotas de entrega no crean usuarios, eventos ni registros.

## Instalación en los teléfonos y conservación de pendientes

Instalar la APK como actualización de la aplicación existente. **No desinstalar, no borrar almacenamiento y no cerrar la sesión para instalar.** La entrega mantiene el identificador `com.anonymous.frontend`; Android exige también la misma firma del instalador anterior. Si Android rechaza la firma, detener la instalación y recuperar la firma anterior: desinstalar eliminaría los datos locales.

Antes de actualizar cada teléfono, registrar la cantidad de pendientes, comprobar la sincronización con conexión y conservar el teléfono si quedan pendientes. Después de instalar, comprobar evento seleccionado, sesión, cola y lista. Los escaneos realizados por un binario anterior no adquieren la mejora de cámara hasta instalar la APK nueva.

## Recuperación y límites

Antes de actualizar `main`, conservar una referencia Git al commit anterior. Si la nueva API falla, usar el despliegue previo de Render o desplegar ese commit. Revertir código **no restaura ni borra** la base de datos. Mantener el mismo entorno y almacenamiento remoto durante la recuperación.

La referencia Git respalda el código, no los datos. No se debe considerar que existe un respaldo externo reciente de MongoDB sólo porque se publicó esta versión. Los registros históricos revisados mostraban Supabase sin configurar; comprobar su estado actual antes de atribuirle protección. Una copia completa de MongoDB necesita acceso autorizado al proveedor o sus credenciales y debe conservarse en almacenamiento privado, nunca en este repositorio público.

La verificación automatizada reduce riesgos, pero no garantiza ausencia absoluta de errores ni pérdidas. El tiempo inferior a 150 ms sigue pendiente de validación en el teléfono real. Ver `OPTIMIZACION_LECTURA_1.0.9.md` para el alcance de las mediciones y `PRUEBAS_Y_RESPALDO_GEMINI_1.0.8.md` para las pruebas del respaldo.
