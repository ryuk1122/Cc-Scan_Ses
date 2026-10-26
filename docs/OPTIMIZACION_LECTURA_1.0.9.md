# Lectura rápida de cédulas — versión 1.0.9

Fecha: 26 de octubre de 2026. Android, versión interna 10.

## Estado de la meta de 150 ms

Esta versión elimina limitaciones de la aplicación y añade medición en el teléfono. **No hay una medición física que demuestre todavía una detección inferior a 150 ms.** No había teléfono ni emulador conectado para esta entrega. Las pruebas automáticas comprueban lógica y manejo de imágenes; no sustituyen un ensayo con cámara, ML Kit y cédulas reales.

Detección de un cuadro, confirmación de la identidad y registro completo son tiempos diferentes. El objetivo solicitado se aplica a detectar. La confirmación de MRZ conserva tres lecturas válidas coincidentes y los dígitos de control. Guardar y sincronizar también dependen del resto de la aplicación y de la conexión.

## Cambios aplicados

- Eliminada la pausa mínima de 200 ms entre cuadros. Antes, obtener tres cuadros implicaba al menos 400 ms entre el primero y el tercero, además del procesamiento. Ahora se analiza el siguiente cuadro disponible al terminar los lectores.
- ML Kit recibe directamente la imagen nativa de CameraX. Se eliminan la conversión completa a RGB y la rotación de un bitmap por cada cuadro.
- Lectura de PDF417/QR y reconocimiento de texto iniciados de forma asíncrona sobre el mismo cuadro, sin esperar a que termine un lector para iniciar el otro.
- Conservado un único cuadro en procesamiento y la política de CameraX de quedarse con el más reciente. No se acumula una cola de imágenes antiguas.
- El cuadro se libera una sola vez cuando ambos lectores terminan. Se contemplan errores al iniciar un lector, salidas de pantalla y resultados de sesiones anteriores.
- Nitidez, brillo y reflejos se muestrean directamente en el plano de luminancia de la región MRZ. Se respetan rotación, relleno de filas, separación de píxeles y posición del buffer. La fase del muestreo varía para evitar confundir un patrón nítido periódico con una imagen uniforme.
- Un QR sin datos de identidad ya no reinicia la confirmación de MRZ. Los códigos que sí se aceptan para el flujo de identidad conservan su tratamiento correspondiente.
- Sin nuevas llamadas a Gemini ni servicios de pago en el recorrido rápido. El respaldo de Gemini conserva el flujo explícito de la versión anterior.

## Medición incluida

En la cámara, el botón **Velocidad** muestra p95, número de muestras y porcentaje estrictamente inferior a 150 ms para códigos decodificados, detección de MRZ y confirmación de tres lecturas. p95 indica el tiempo dentro del cual terminaron el 95 % de las muestras de esa etapa. Se conserva una ventana de las últimas 120 muestras por etapa y se puede reiniciar la medición.

Los tiempos comienzan cuando entra el cuadro al analizador; no cuando el usuario presenta la cédula. La detección de códigos cuenta resultados del lector, incluidos QR que después pueden no contener identidad. La detección MRZ cuenta candidatos que superaron la localización y calidad de imagen; todavía pueden ser rechazados por los controles de contenido. Las estadísticas de detección sólo incluyen cuadros con resultado, por lo que **no representan la tasa de acierto ni el tiempo total hasta conseguir una lectura**. La confirmación se mide desde el primer cuadro de la secuencia válida hasta la recepción de la confirmación en la aplicación.

El módulo también expone tiempos de procesamiento de todos los cuadros completados, de OCR, de códigos y de evaluación de calidad mediante `getPerformance`. Las estadísticas contienen tiempos y contadores; no almacenan fotos, nombres ni números de cédula.

## Pruebas y criterios para el teléfono

La verificación automática abarca 337 casos MRZ compartidos, consenso con cuadros consecutivos sin pausa artificial, QR intercalado, comprobación de tipos y revisión estática del código. El módulo Android tiene 23 pruebas: nueve de calidad y catorce de rotación, planos de imagen, límites de memoria, vida del cuadro entre lectores concurrentes y estadísticas. La secuencia sintética de cuadros rápidos verifica ausencia de una espera impuesta por el consenso; no constituye una medición de ML Kit.

Para comprobar el objetivo en el dispositivo de uso:

1. Instalar la APK 1.0.9 y abrir la cámara. Medir por separado la primera apertura y las lecturas con los modelos ya preparados.
2. Reiniciar las estadísticas y realizar al menos 30 lecturas por tipo de documento, con distintos documentos y posiciones. Registrar también intentos fallidos, confusiones de datos y tiempo desde presentación hasta confirmación, aunque no produzcan muestras de detección.
3. Revisar en **Velocidad** si el p95 de la etapa objetivo es inferior a 150 ms. Revisar por separado la confirmación de MRZ y el tiempo de registro.
4. Repetir con iluminación normal, reflejos, cámara en movimiento y tras varios minutos de uso. Validar los datos extraídos contra los documentos de prueba.

La resolución de análisis conserva el objetivo de 1920 × 1080 para no perder detalle del PDF417 ni los caracteres pequeños. El enfoque, exposición, resolución elegida por la cámara, procesador, temperatura del teléfono y carga simultánea de los dos lectores afectan el resultado real. Se necesita el ensayo físico para decidir si conviene ajustar resolución o planificación de lectores en un modelo concreto de teléfono.

## Archivos principales

- `frontend/modules/cedula-scanner/android/src/main/java/expo/modules/cedulascanner/CedulaScannerView.kt`: flujo CameraX/ML Kit y medición.
- `frontend/modules/cedula-scanner/android/src/main/java/expo/modules/cedulascanner/UprightLuma.kt`: calidad sin conversión RGB.
- `frontend/modules/cedula-scanner/android/src/main/java/expo/modules/cedulascanner/FrameLease.kt`: duración compartida del cuadro.
- `frontend/modules/cedula-scanner/android/src/main/java/expo/modules/cedulascanner/ScanPerformance.kt`: estadísticas acotadas.
- `frontend/src/components/LocalCedulaCamera.tsx`: consenso y consulta de velocidad.
- `frontend/src/utils/mrzValidation.ts`: validación de MRZ y consenso.

Referencias de la implementación: [análisis de imágenes en CameraX](https://developer.android.com/media/camera/camerax/analyze), [reconocimiento de texto en Android](https://developers.google.com/ml-kit/vision/text-recognition/v2/android) y [lectura de códigos en Android](https://developers.google.com/ml-kit/vision/barcode-scanning/android).

## Resultado de la entrega

- Compilación Android release: correcta. Versión verificada `1.0.9`, código `10`.
- Pruebas nativas: 23 correctas, cero fallos, cero errores y cero omitidas.
- Casos MRZ compartidos: 337 correctos, junto con las comprobaciones de consenso.
- TypeScript y ESLint de los archivos revisados: correctos.
- Firma de APK: verificada con Android apksigner. Se mantiene la configuración de firma existente del proyecto.
- Contenido de APK: confirmados bundle de la aplicación, módulo nativo y modelos OCR locales.
- Sin dispositivos conectados en ADB; sin prueba física de velocidad ni de cámara.
- Instalador: `frontend/android/app/build/outputs/apk/release/CedulaScan-Pro-1.0.9-lectura-rapida.apk` (92.561.627 bytes).
- SHA-256: `BA869461641A4688CC5B893E2F297E5AC15ECDCF5904E49A085667F8F796D9B5`.

Los registros de compilación y pruebas se conservan en la carpeta de salida de la APK. Esta entrega modifica el recorrido local del lector; no publica cambios en servidores ni instala automáticamente la aplicación en un teléfono.
