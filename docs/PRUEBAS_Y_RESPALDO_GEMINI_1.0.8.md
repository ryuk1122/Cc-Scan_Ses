# Verificación de lectura de cédula y respaldo Gemini — 1.0.8

Fecha: 26 de octubre de 2026, Colombia. Código Android: 9.

## Resultado de las comprobaciones

| Área | Resultado |
|---|---|
| Backend local, sin suite de integración remota | 427 pruebas aprobadas |
| Paridad Python/TypeScript del lector MRZ | 337 casos compartidos aprobados en JavaScript y también incluidos en la suite Python |
| Calidad de lectura del módulo Android | 9 pruebas Kotlin/JUnit aprobadas |
| TypeScript | Sin errores |
| ESLint de los archivos afectados | Sin errores ni advertencias |

No sumar los casos compartidos a las pruebas Python como si fueran datos distintos: se ejecuta el mismo conjunto contra ambas implementaciones para detectar diferencias.

Los 337 casos incluyen 315 cambios de un solo dígito en posiciones protegidas: número documental, fechas, NUIP y controles. Se comprueba que un cambio no pueda convertirse en MRZ confirmada. Se incluyen documentos incompletos, nombres legítimos, errores OCR normalizables, texto alrededor de la MRZ y dos documentos en la misma entrada.

Las pruebas de cámara de esta sesión son pruebas de reglas y compilación. No había teléfono conectado ni emulador instalado. No se midieron foco óptico, latencia real, batería, temperatura ni precisión con plásticos reales.

## Fallos corregidos durante esta revisión

- Una MRZ completa podía descartarse si había otra línea de texto de 30 caracteres antes de ella. El parser ahora prioriza el bloque validado.
- Una entrada con dos documentos podía aceptar silenciosamente el primero. Se rechaza para confirmación automática.
- Repetir un cuadro anterior después de otro cuadro podía completar el consenso. Los identificadores atrasados, repetidos o no finitos no cuentan.
- Una respuesta antigua de cámara podía llegar después de pausar o volver a la pantalla. Los eventos incluyen la sesión y el cliente rechaza sesiones antiguas.
- Una cédula podía quedar bloqueada como ya leída aunque el guardado hubiera fallado. El bloqueo se libera si el registro no fue aceptado.
- Respuestas de fotos de un evento o pantalla anterior podían seguir utilizándose. Se invalidan al cambiar el contexto.
- Un texto parecido a ICCOL dentro de un PDF417 podía confundirse con MRZ. La detección distingue el contenido binario y exige un prefijo de línea.
- Gemini podía tratar una confianza ausente o inválida como máxima. Ahora se rechaza.
- Las identidades de OCR y Gemini podían mezclarse. Ante números diferentes se rechaza la combinación; una MRZ local validada no se reemplaza por una propuesta de nube.
- El respaldo no asumirá que la primera foto es el frente. Cada imagen se etiqueta y se identifica por sus elementos visibles.
- Se rechazan respuestas vacías, JSON incompleto, estructuras incorrectas, salidas truncadas, errores HTTP y tiempos agotados sin reintentos automáticos.
- Una respuesta de Gemini no puede heredar `mrz_valido=true` ni registrar automáticamente. El endpoint exige revisión incluso si el servicio devolviera una bandera incorrecta.

## Instrucciones que recibe Gemini

Están implementadas en `backend/gemini_service.py`, constante `PROMPT`, y se envían en cada consulta explícita. No se limitaron a una recomendación en el chat.

1. **Reverso:** localizar las tres líneas monoespaciadas con `<`, habitualmente en la parte inferior de la tarjeta. Mirar esa banda, no el QR ni la foto fantasma. Transcribir las líneas completas sin inventar caracteres ni rellenar espacios que no se ven.
2. **ICCOL:** la primera línea contiene el número documental/serial y no debe tomarse como NUIP. En la segunda línea, leer los diez caracteres tras `COL`, posiciones 19–28 desde 1. Excluir el relleno 29 y el control 30. No confundir las posiciones de nacimiento y vencimiento con el número de cédula.
3. **Nombres:** en la tercera línea, apellidos antes de `<<` y nombres después. Conservar lo visible; no completar nombres truncados ni borrar nombres cortos como LILI.
4. **Frente:** localizar el número asociado a NUIP, C.C., cédula, número o identificación. Separar nombres y apellidos por sus etiquetas, sin adivinar apellidos compuestos.
5. **Dos caras:** contrastar los números y rechazar discrepancias; no elegir una cara para ocultar el conflicto ni mezclar personas.
6. **Incertidumbre:** devolver campos desconocidos en `null`. Si un dígito no se ve con claridad, no proponer un número.

La respuesta utiliza un esquema JSON y debe indicar el origen y los números observados en cada cara. La aplicación comprueba esa coherencia y, cuando hay MRZ, contrasta su contenido con el parser independiente. Una lectura basada únicamente en MRZ necesita sus líneas completas y controles válidos. La autoconfianza declarada por el modelo no demuestra exactitud.

Se consultó la documentación oficial sobre [imágenes en Gemini](https://ai.google.dev/gemini-api/docs/image-understanding) y [salidas estructuradas](https://ai.google.dev/gemini-api/docs/structured-output). El análisis visual real del modelo no se probó contra el proveedor en esta sesión.

## Cuándo se ofrece el respaldo

La cámara en vivo y la foto de respaldo local continúan siendo las opciones principales. Si una foto no entrega una lectura suficiente, o el operador solicita releer un candidato dudoso, aparece una opción explícita para Gemini. La pantalla explica que la foto se enviará a Google y que puede consumir cuota o generar cargos. Cancelar mantiene el flujo local.

Solo al elegir continuar se llama a `/api/ocr/cedula/gemini-backup`, con autenticación. No se llama por cada cuadro, no se hacen reintentos automáticos y se reutiliza la foto elegida. Después se exige comparar los datos con el documento y confirmar o descartar. Cambiar de pantalla o evento invalida el resultado pendiente.

Las pruebas del respaldo usan imágenes sintéticas y respuestas HTTP simuladas. No se enviaron cédulas reales a Google ni se consumieron llamadas de pago para ejecutar estas pruebas.

## Qué falta comprobar en campo

Instalar la APK nueva y actualizar el backend local modificado en el servidor habitual. Esta tarea no publica el servidor ni modifica la base de datos remota.

Con un teléfono real: verificar permisos, enfoque al tocar, luz, modo avión, regreso desde segundo plano, retirada/cambio de cédula, cambio de evento, foto de respaldo, cancelación de Gemini y revisión antes de guardar. Usar cédulas autorizadas de las variantes reales y comparar todos los campos, incluidos los nombres.

Hacer una sesión sostenida de al menos 20–30 minutos y medir mediana/p95 de lectura, errores por campo, falsos aceptados y degradación térmica. La ausencia de fallos en pruebas automatizadas no permite prometer que no exista ningún error óptico o de dispositivo.

## Comandos de verificación

Desde `backend`:

```text
python -m pytest tests --ignore=tests/test_cedulascan.py -q
```

Desde `frontend`:

```text
npm run test:mrz
npx tsc --noEmit
```

Desde `frontend/android`:

```text
gradlew.bat :cedula-scanner:testDebugUnitTest --console=plain --no-daemon
gradlew.bat :app:assembleRelease --console=plain --no-daemon
```
