# Implementación de lectura local de cédula — Android 1.0.7

## Entrega

Se incorporó un módulo Expo local en `frontend/modules/cedula-scanner`, con CameraX 1.6.0, ML Kit Text Recognition 16.0.1 y Barcode Scanning 17.3.0. Los modelos se empaquetan en Android: la lectura principal no envía imágenes a servicios remotos ni invoca Gemini.

La pantalla usa el nuevo módulo cuando está presente en el binario Android. iOS, web y binarios antiguos conservan la cámara anterior; esta entrega no agrega OCR continuo nativo en esas plataformas. Hace falta instalar la nueva APK; actualizar solo JavaScript no incorpora el módulo.

## Comportamiento

- Una sola cámara trasera para PDF417, QR y MRZ. Los bytes del PDF417 se transportan mediante ISO-8859-1, sin convertirlos a UTF-8 de forma destructiva.
- Imágenes automáticas en memoria, un analizador activo y estrategia de último cuadro. Intervalo inicial 200 ms, adaptado al tiempo real de procesamiento hasta 600 ms. La frecuencia efectiva depende del teléfono.
- OCR sobre la imagen orientada; localización de filas y agrupación de fragmentos por coordenadas. Evaluación del tamaño de letras, límites, inclinación, brillo y nitidez en la región MRZ. Mensajes de calidad, enfoque al tocar y linterna opcional.
- Tres observaciones completas válidas consecutivas; cuadros repetidos no cuentan dos veces. Un cuadro inválido, cambio de documento, pausa o separación de más de 1.2 segundos reinicia la confirmación.
- Después de confirmar una MRZ se pide retirar esa cédula, evitando volver a enviar continuamente el mismo resultado. Una persona distinta puede leerse directamente.
- Captura manual como respaldo: archivo temporal eliminado al terminar de convertirlo. Usa la nueva ruta `/ocr/cedula/local` del servidor, necesita conexión y solicita revisión si sus datos no están validados. Esta ruta impide usar Gemini. Si el servidor aún no se actualizó, la foto falla sin recurrir a una ruta antigua que pudiera generar cobros.
- Lectura y guardado son estados distintos: se mantiene la cola local y la sincronización existentes. La procedencia de captura viaja en esa cola y se almacena en el registro.

## Correcciones de datos

`mrz_validation.py` y `mrzValidation.ts` implementan las mismas reglas, comprobadas con un conjunto común de casos ficticios:

- Tres líneas completas de 30 caracteres; no se rellenan caracteres ausentes para aceptar automáticamente.
- Controles del documento, nacimiento, vencimiento y compuesto TD1.
- Fechas de calendario, nacimiento no futuro y política de siglo consistente en UTC.
- NUIP opcional colombiano separado del número documental; posiciones de relleno y control final no se agregan al NUIP.
- Correcciones OCR limitadas a posiciones numéricas. Los nombres se conservan sin heurísticas que recortan supuestos prefijos de ruido o eliminan nombres como LILI.
- El parser anterior puede conservar candidatos incompletos para revisión, pero no marcarlos como MRZ válida.
- El servidor vuelve a validar las lecturas MRZ automáticas antes de consultar o guardar, comprueba que la cédula enviada coincida y utiliza los campos extraídos de las líneas validadas.
- Los datos de una MRZ dudosa no se mezclan automáticamente con la identidad de otra lectura OCR.

El control de lectura no acredita autenticidad documental. Los nombres pueden venir truncados de origen y la separación de componentes de apellidos compuestos requiere contraste con el frente si se necesita distinguirlos exactamente.

## Validación ejecutada

- Compilación Kotlin del módulo Android.
- Compilación de APK release Android.
- Comprobación TypeScript sin emitir archivos.
- ESLint de los archivos de aplicación afectados.
- 19 casos compartidos de MRZ para validar paridad entre Python y TypeScript, más comprobaciones de consenso temporal en JavaScript.
- 53 pruebas locales de backend: parser, controles, rechazo previo a base de datos, campos revalidados, candidatos OCR, ausencia de llamadas a Gemini en el flujo por defecto, ruta exclusiva sin nube, PDF417/QR y controles existentes de dispositivos.

Las pruebas de backend ejecutadas usan datos ficticios y simulaciones; no realizan registros en el servidor público. La suite de integración remota `test_cedulascan.py` no se ejecutó porque crea datos en un servicio externo.

## Instalación y servidor

1. Instalar la APK 1.0.7, código de versión 8, en Android. Se usa el identificador y la firma que ya estaban configurados en el proyecto; la configuración actual de release usa la clave de desarrollo existente. Esta compilación sirve como piloto instalable, no como nueva configuración de firma de producción.
2. Desplegar los cambios de `backend/server.py`, `cedula_parser.py`, `mrz_validation.py`, `ocr_service.py` y `barcode_service.py` al servidor habitual mediante su proceso normal. Esta tarea modifica los archivos locales; no publica el backend ni cambia la base de datos remota.
3. Probar cédula amarilla/PDF417 y policarbonato/MRZ; verificar número, nombres y fechas contra el documento. Probar sin conexión la lectura automática y comprobar posteriormente la sincronización.
4. Probar retirada y cambio de cédula, modo manual, revisión de foto, permisos, linterna, navegación y paso a segundo plano.
5. Medir una sesión de 20–30 minutos en los teléfonos operativos, con luz del evento y documentos autorizados. Registrar latencia mediana/p95 y exactitud de los campos.

No había dispositivo Android conectado durante la implementación. No se midió aún la velocidad de cámara ni la precisión óptica real. Los umbrales de calidad son valores iniciales para el piloto; requieren ajuste en los teléfonos de uso.

La implementación localiza la banda mediante las filas del OCR y rechaza inclinaciones excesivas; no incorpora un modelo dedicado de detección de las cuatro esquinas ni una rectificación proyectiva completa. Tampoco incorpora lectura automática del frente para recuperar nombres truncados. Estas capacidades deben evaluarse con los resultados del piloto antes de ampliar el motor.

## Comprobaciones reproducibles

Desde `backend`:

```text
python -m pytest tests/test_mrz_registration.py tests/test_mrz_validation.py tests/test_cedula_parser_pdf417.py tests/test_ocr_mrz_merge.py tests/test_barcode_qr_payload.py tests/test_device_security.py -q
```

Desde `frontend`:

```text
npm run test:mrz
npx tsc --noEmit
```

Desde `frontend/android`:

```text
gradlew.bat :app:assembleRelease --console=plain --no-daemon
```
