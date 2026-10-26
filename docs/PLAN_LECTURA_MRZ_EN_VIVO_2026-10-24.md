# Lectura rápida y confiable de cédulas: investigación y propuesta

Fecha de consulta: 24 de octubre de 2026, Colombia.

## Decisión propuesta

Cambiar la lectura principal de MRZ a un flujo de cámara en vivo, procesamiento en el teléfono, evaluación de calidad, interpretación por posiciones y validación antes de registrar. El usuario presenta el documento y obtiene un resultado automático; no necesita repetir fotos ni esperar a que el servidor intente leer cada imagen.

La prioridad es evaluar un SDK especializado (BlinkID y Regula) con los teléfonos y documentos reales del proyecto. Si la licencia no resulta viable, implementar un módulo Android propio con CameraX y ML Kit Text Recognition v2, más detector de MRZ, validación estricta y consenso entre lecturas. Ningún proveedor tiene rendimiento demostrado en este proyecto todavía.

Este documento entrega investigación y diseño. No modifica la aplicación ni afirma que exista ya una nueva APK. Complementa INVESTIGACION_ESCANEO_IDENTIDAD_COLOMBIA.md; el objetivo actual requiere superar su anterior propuesta de MRZ mediante captura manual.

## Hallazgos comprobados en el código

| Hallazgo | Ubicación | Implicación |
|---|---|---|
| Se toma una foto, se convierte a Base64 y se llama a OCR remoto | frontend/app/(app)/escanear.tsx:397–449 | Cada intento paga captura, conversión, transmisión y procesamiento. |
| El botón de foto ejecuta OCR y, si falla, intenta Gemini | frontend/app/(app)/escanear.tsx:585–619 | Puede encadenar dos rutas lentas para una misma imagen. |
| La petición de OCR permite esperar 22 segundos | frontend/src/utils/api.ts:139–145 | Es un límite configurado, no una medición de duración habitual. |
| La lectura remota puede ejecutar OCR general y MRZ simultáneamente | backend/ocr_service.py:1015–1020 | Hay competencia por CPU; no existe garantía de latencia por usar tareas en paralelo. |
| MRZ permite hasta 24 llamadas a Tesseract | backend/ocr_service.py:821 | Limitar intentos no limita el tiempo total de una solicitud. |
| La llamada MRZ a Tesseract no incluye timeout | backend/ocr_service.py:780–784 | Una llamada lenta puede prolongar toda la operación. |
| Se devuelve un candidato sin validación con ok=True | backend/ocr_service.py:835–856 | Haber obtenido un número no equivale a una lectura confirmada. |
| El cliente acepta datos de servidor si contienen un número plausible | frontend/app/(app)/escanear.tsx:465–482 | No exige una validación MRZ para continuar hacia el registro. |
| El servidor considera suficiente que exista NUIP más controles de fechas | backend/cedula_parser.py:498–502 | No valida el dígito compuesto que cubre también los datos opcionales. |
| Frontend y backend toman extensiones distintas del campo opcional | frontend/src/utils/cedula.ts:381; backend/cedula_parser.py:351–365 | Ante relleno leído como dígito pueden producir números distintos. |
| Hay reconstrucción por relleno, recorte y unión de fragmentos | frontend/src/utils/cedula.ts:295–339; backend/cedula_parser.py:368 en adelante | Útil para generar candidatos; no debe convertir texto incompleto en lectura confirmada. |
| Se eliminan ciertos tokens de nombres como supuesto ruido | backend/cedula_parser.py:276–310 | Puede perderse información legítima. |

La pantalla actual usa expo-camera, no un motor de OCR continuo. package.json declara Expo 56 y React Native 0.85.3; no declara VisionCamera ni ML Kit para OCR nativo. La rama condicional takePhoto en el código no demuestra que exista VisionCamera instalado.

## Comprobaciones locales con datos ficticios

Se ejecutaron comprobaciones directas del parser, sin imágenes de personas ni cambios en producción:

1. Se construyó una MRZ de tres líneas de 30 caracteres, con controles individuales y compuesto calculados. El parser devolvió NUIP ficticio 1234567890 y mrz_valido=True.
2. Se cambió únicamente el último dígito de ese NUIP por 1 y se conservó el dígito compuesto original. Una comprobación independiente del compuesto falló; el parser siguió devolviendo mrz_valido=True para 1234567891.
3. La limpieza de nombres recibió los tokens ficticios LILI y ANA y devolvió solo ANA. La regla considera LILI un posible relleno mal leído.

Esto demuestra fallos de aceptación y conservación de datos. No mide su frecuencia en documentos reales ni el desempeño de la cámara. No se realizó una prueba de velocidad en teléfonos.

## Qué puede entregar cada documento

- Cédula de policarbonato: MRZ como ruta principal para identidad estructurada. El mapeo de datos opcionales colombianos debe verificarse por variante; el número documental y el NUIP deben conservarse en campos distintos.
- Cédula amarilla: mantener PDF417 local, respetando los bytes originales, caracteres de control y codificación. No tratar su contenido binario como si fuera solo una cadena visible.
- QR de cédula digital: la Registraduría indica que contiene información cifrada. Detectar el símbolo no proporciona automáticamente acceso a sus datos personales. No perseguir una lectura de QR como sustituto general de MRZ sin integración documentada.
- Datos adicionales: cargo, sede, aportes y municipio de residencia o trabajo proceden de la base de afiliados, no de la MRZ. No interpretar códigos opcionales como ubicación sin documentación suficiente.

ICAO TD1 tiene tres líneas de 30 caracteres. Los controles individuales y el compuesto detectan determinados errores de lectura; no prueban autenticidad. Los nombres no están cubiertos por esos controles y pueden estar truncados. Si se requiere nombre completo con su escritura original, puede hacer falta leer también el frente y contrastar ambas caras. [ICAO, parte 5](https://www.icao.int/sites/default/files/publications/DocSeries/9303_p5_cons_en.pdf).

[Registraduría: seguridad del QR](https://www.registraduria.gov.co/Seguridad-7486.html). [Circular sobre cédula digital](https://www.registraduria.gov.co/IMG/pdf/circular-externa-011-2021-presentacion-cc-digital.pdf).

## Arquitectura recomendada

### 1. Cámara y selección de imágenes

Procesar cuadros directamente en memoria. No guardar fotos ni convertir cada cuadro a Base64. Mantener una sola operación de reconocimiento activa; descartar cuadros antiguos mientras está ocupada. CameraX documenta STRATEGY_KEEP_ONLY_LATEST para este propósito. Liberar siempre ImageProxy y detener el análisis al salir de la pantalla. [CameraX](https://developer.android.com/media/camera/camerax/analyze).

Iniciar con previsualización de 30 FPS y reconocimiento limitado, por ejemplo a 4–8 cuadros por segundo según el dispositivo. Son parámetros iniciales de ingeniería, no resultados medidos. Bajar la frecuencia ante calentamiento o carga elevada. Evitar que el análisis de MRZ retrase un PDF417 ya reconocido.

### 2. Calidad antes de reconocer

Detectar documento y banda MRZ; corregir perspectiva y orientación; rechazar recortes que pierdan líneas. Medir enfoque, movimiento, exposición y reflejo dentro de la región relevante. Mostrar instrucciones específicas: acercar, mantener quieto o inclinar ligeramente para quitar el reflejo. La linterna debe ser opcional: puede empeorar reflejos.

Usar la cámara trasera principal y medir la distancia mínima de enfoque. Ajustar resolución por tamaño real de caracteres, no por megapíxeles anunciados. ML Kit recomienda suficiente detalle por carácter y limitar trabajo en tiempo real. PDF417 denso puede requerir mucha más anchura que un QR. No confundir ampliar una imagen borrosa con recuperar detalle. [ML Kit OCR](https://developers.google.com/ml-kit/vision/text-recognition/v2/android). [ML Kit códigos](https://developers.google.com/ml-kit/vision/barcode-scanning/android).

Los umbrales de nitidez y brillo deben calibrarse por región y teléfono: no fijar un valor universal de varianza de Laplaciano. Un reflejo fuera de la MRZ no debe bloquear una MRZ legible. [Controles de calidad de Regula](https://docs.regulaforensics.com/develop/doc-reader-sdk/overview/image-quality/).

### 3. OCR y parser

ML Kit es un reconocedor general de texto; no resuelve por sí solo la estructura colombiana, la calidad de la captura ni las reglas de aceptación. Sobre su salida se necesita:

- Ordenar líneas por sus coordenadas y comprobar la región capturada.
- Separar texto observado, normalizaciones y candidatos corregidos.
- Aplicar correcciones O/0 o I/1 solo en posiciones compatibles, conservando el original.
- Validar formato, caracteres y longitudes; controles documentales, nacimiento, vencimiento y compuesto; fechas de calendario y política de siglo.
- Usar reglas por tipo y variante, sin buscar cualquier número de longitud plausible.
- Evitar cambios en nombres basados únicamente en que una secuencia parece ruido.
- Compartir especificación y casos de prueba entre cliente y servidor.

Para TD1, el compuesto se calcula sobre L1[5:30] + L2[0:7] + L2[8:15] + L2[18:29], y se compara con L2[29], con índices de programación desde cero. Las excepciones de una variante deben documentarse, no sustituirse silenciosamente por otra regla.

### 4. Consenso temporal

Exigir una lectura estructuralmente válida y coincidencia de campos críticos en 2 o 3 cuadros distintos de calidad suficiente, dentro de una ventana breve. Calibrar cantidad y ventana con mediciones. No contar tres llamadas sobre la misma imagen como tres lecturas independientes.

El consenso reduce inestabilidad, pero no elimina errores sistemáticos repetidos. No crear por votación una MRZ que nunca existió en un cuadro completo válido. Conservar coherencia entre documento, fecha y persona; reiniciar consenso cuando cambia el documento, se retira de cámara o hay una interrupción prolongada.

### 5. Aceptación y registro

Estados propuestos: buscando, mejorar encuadre, leyendo, candidato, confirmado y revisión necesaria. Solo confirmado puede registrar automáticamente. Un candidato incompleto puede mostrarse para revisión sin presentarlo como validado.

Enviar al servidor los campos estructurados, la procedencia, el resultado de cada control y, cuando sea necesario, las líneas para revalidación. No enviar video. Aplicar verificación también en servidor; no confiar ciegamente en mrz_valido enviado por el cliente.

Separar lectura, consulta de afiliado, guardado y sincronización. La lectura puede ser local; la confirmación de guardado y la búsqueda remota tienen sus propios estados. No bloquear lectura con impresión o consulta de afiliados. Controlar respuestas atrasadas para que no cambien la persona mostrada.

### 6. Respaldo

Mantener una captura manual y corrección supervisada para plástico deteriorado, reflejos persistentes o campos truncados. Si se usa OCR remoto, enviar un recorte suficiente y aplicar un presupuesto total de tiempo, límites de concurrencia y tiempos por tarea. Cancelar la espera del cliente no garantiza que Tesseract haya terminado en el servidor.

Gemini puede ayudar en revisión excepcional; no usar su confianza declarada como probabilidad calibrada ni aceptar un número propuesto sin evidencia suficiente. No combinar automáticamente campos de fuentes contradictorias.

## Comparación de soluciones

| Alternativa | Ventaja | Trabajo pendiente | Decisión |
|---|---|---|---|
| BlinkID | Motor especializado, integración React Native y extracción local | Licencia, prueba de documentos reales, campos por versión y compilación | Primera opción para evaluar si prima llegar a una solución robusta con menos desarrollo propio. |
| Regula Document Reader Mobile | Lectura local y controles de calidad documentados | Licencia, cobertura exacta y compatibilidad de integración | Segundo candidato para comparar con el mismo protocolo. |
| CameraX + ML Kit + parser propio | Control de captura y procesamiento local | Detector de banda, calidad, consenso, casos por variante y mantenimiento | Alternativa sin SDK documental comercial. |
| VisionCamera + motor nativo | Acceso a cuadros desde React Native | Elegir versión compatible y desarrollar integración OCR | Alternativa a módulo CameraX directo si facilita mantener Android/iOS. |
| OCR remoto como flujo principal | Reutiliza backend | Conserva dependencia de red y captura | Reservar para respaldo. |

BlinkID publica extracción local y React Native. Se consultó además su catálogo JSON v8001.0.0: contiene Colombia / Identity Card, nombre localizado «Cédula Digital Colombiana, Cédula de Ciudadanía (CC)», con FRONT y BACK. Esto acredita soporte declarado, no exactitud por lote o velocidad en nuestros teléfonos. [Introducción](https://docs.microblink.com/blinkid). [Catálogo y URLs JSON](https://docs.microblink.com/blinkid/supported-documents).

Regula documenta procesamiento móvil offline; verificar independientemente cada variante colombiana requerida. [Arquitectura](https://docs.regulaforensics.com/develop/doc-reader-sdk/overview/architecture/).

No se verificó una tarifa comercial aplicable al proyecto. Solicitar cotización por dispositivos/volumen, duración, soporte, actualizaciones y uso offline antes de elegir. Probar inicialización en modo avión, disponibilidad de recursos y expiración de licencia.

## Integración con el proyecto

expo-camera 56 ofrece previsualización, captura y detección de códigos; no aporta el motor MRZ continuo requerido por sí solo. Incorporar SDK documental con cámara propia, un módulo Expo nativo con CameraX o una integración compatible de VisionCamera. No mantener dos propietarios activos de la cámara. [Expo Camera 56](https://docs.expo.dev/versions/v56.0.0/sdk/camera/).

VisionCamera cambió su API: la documentación actual llama Frame Output a lo antes denominado Frame Processors. Fijar una versión verificada y usar su documentación correspondiente; no copiar instrucciones de versiones anteriores. La integración exige recompilar el binario. [Frame Output](https://visioncamera.margelo.com/docs/frame-output). [Instalación](https://visioncamera.margelo.com/docs).

Para la ruta propia Android, empaquetar el modelo latino de ML Kit para que la primera lectura no dependa de descargarlo. Crear un módulo que emita solo resultados estructurados y estados de calidad hacia React Native; procesar imágenes en la capa nativa. Revisar Gradle, Kotlin, arquitectura de React Native y tamaños/ABIs antes de fijar dependencias. Para BlinkID, comprobar requisitos de la versión elegida contra Expo 56/RN 0.85.3. [Compatibilidad BlinkID](https://docs.microblink.com/blinkid/dependencies).

## Orden de implementación

1. Corregir aceptación: compuesto, candidatos sin validar, nombres y discrepancias del parser; pruebas significativas con datos ficticios y variantes verificadas.
2. Preparar un conjunto de referencia autorizado y una medición del flujo actual; separar captura, OCR, red y registro.
3. Hacer una prueba acotada con BlinkID/Regula y un prototipo local, comparando los mismos documentos y teléfonos. No contratar por la demostración comercial.
4. Integrar el motor elegido con calidad, consenso, deduplicación y registro existente.
5. Validar la APK en dispositivos reales, incluyendo sin red y con iluminación de evento, antes de reemplazar el flujo principal.

## Criterios de aceptación propuestos

Son objetivos para el piloto, no promesas ni mediciones existentes:

- Mediana de lectura desde documento correctamente presentado: hasta 1 segundo; percentil 95: hasta 2 segundos en condiciones definidas y teléfonos objetivo.
- Identidad estructurada exacta en al menos 98 % de documentos legibles en hasta 2 segundos. Reportar por tipo de documento y teléfono; las excepciones cuentan como fallos de lectura automática.
- Ningún identificador equivocado registrado automáticamente en el conjunto de evaluación. Una muestra sin errores no demuestra riesgo cero en producción.
- Reportar aparte exactitud de NUIP, nombres, fechas y porcentaje de registros completos; no esconder campos ausentes detrás de un promedio por carácter.
- Primera lectura offline con modelo disponible; sin solicitudes de imágenes en la ruta principal.
- Sesión sostenida de al menos 20–30 minutos para evaluar calentamiento, batería, memoria y degradación.

Comenzar con 100–200 documentos autorizados y variados, varias presentaciones de cada uno y al menos tres teléfonos representativos. Es un piloto práctico, insuficiente por sí solo para demostrar tasas extremadamente bajas de aceptación errónea. Separar documentos de ajuste y evaluación. Incluir nombres largos/compuestos, números cortos, variantes ICCOL/IDCOL verificadas, brillo, desgaste, inclinación, movimiento, retiro rápido y cambio de persona.

El cronómetro de lectura comienza cuando el documento está presentado; registrar aparte inicio de cámara, colocación, consulta y guardado para no esconder esperas. No conservar imágenes identificables por defecto; usar únicamente muestras autorizadas y retención definida para diagnóstico.

## Pendientes que la documentación pública no resuelve

- Modelo de los teléfonos operativos y su calidad de cámara.
- Campos obligatorios exactos: solo identificación o también nombre completo y fechas.
- Cobertura y mapeo de todas las versiones físicas de cédula que llegan a los eventos.
- Coste y condiciones de una licencia comercial para este despliegue.
- Rendimiento, falsos aceptados y estabilidad sostenida de cada alternativa en este proyecto.

La investigación permite elegir una arquitectura y localizar defectos. La prueba sobre documentos y dispositivos reales es la que permitirá afirmar cuánto mejora y si satisface los criterios del proyecto.
