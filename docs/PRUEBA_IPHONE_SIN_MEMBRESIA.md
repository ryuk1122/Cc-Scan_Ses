# CédulaScan Pro — prueba nativa para iPhone

Esta entrega prepara una aplicación independiente para iPhone. No utiliza Expo Go ni Safari. La prueba no incluye impresión, búsqueda de impresoras ni permisos Bluetooth.

## Requisitos

- iPhone con iOS 16.4 o posterior, cable USB y computador Windows.
- Una cuenta gratuita de Apple. No hace falta pagar Apple Developer.
- Sideloadly descargado de https://sideloadly.io/ y los componentes de Apple para Windows que indica su sitio oficial.
- El archivo **CedulaScan-Pro-iOS-Prueba.ipa** generado correctamente por GitHub Actions. El código fuente y un paquete JavaScript no sustituyen ese archivo.

## Instalación temporal

1. Descargar y descomprimir el artefacto `CedulaScan-Pro-iOS-Prueba` de la ejecución correcta en GitHub Actions.
2. Conectar el iPhone por USB, desbloquearlo y aceptar «Confiar en este computador».
3. Abrir Sideloadly, seleccionar el iPhone y cargar `CedulaScan-Pro-iOS-Prueba.ipa`.
4. Ingresar personalmente la cuenta de Apple y los códigos de verificación en Sideloadly. No compartirlos en el chat ni guardarlos en el repositorio.
5. Iniciar la firma e instalación. Si iOS lo solicita, confiar en la cuenta en Ajustes → General → VPN y gestión de dispositivos.
6. En iOS 16 o posterior, habilitar el Modo de desarrollador en Ajustes → Privacidad y seguridad y reiniciar cuando lo solicite.
7. Abrir CédulaScan Pro y permitir acceso a la cámara.

La firma gratuita suele durar siete días desde la instalación: permite la prueba de seis días solicitada. La app no agrega un bloqueo artificial. La renovación necesita volver a firmar desde Windows, manualmente o mediante el mecanismo de renovación de Sideloadly. Usar el mismo identificador y la misma cuenta para actualizar; no desinstalar una aplicación con datos pendientes. La vigencia depende de Apple y la instalación puede fallar por restricciones de la cuenta o del dispositivo.

## Funciones de esta adaptación

- Cámara trasera mediante AVFoundation, preferencia 1920×1080, enfoque y exposición continuos y control de luz.
- MRZ local mediante Apple Vision, con corrección lingüística desactivada; el validador compartido comprueba longitud, campos y controles antes de confirmar tres observaciones.
- PDF417/QR mediante ZXing-C++ 2.2.1, licencia Apache 2.0. El PDF417 se entrega como bytes de contenido decodificado a una cadena Latin-1, conservando NUL y tildes. No se interpretan los codewords como datos personales.
- Interpretación PDF417 de formato posicional y compacto. Se conserva la entrada original antes de recortar o extraer campos.
- Conexión al servidor existente https://cc-scan-ses.onrender.com y flujo de eventos de Pro.

No se altera el servidor, no se activa un respaldo nuevo ni se cargan registros de prueba automáticamente. La conexión al servidor conserva el comportamiento de la aplicación y exige sus credenciales habituales.

## Prueba recomendada de seis días

Crear un evento identificado claramente como prueba antes de registrar documentos. Los registros enviados al servidor son reales.

1. Día 1: abrir, iniciar sesión, elegir evento, conceder cámara; verificar que abre de nuevo después de cerrarla.
2. Día 2: PDF417 con documentos de prueba; comparar número, nombres y apellidos visibles con lo guardado.
3. Día 3: MRZ completa; verificar número, nombres y apellidos, especialmente en nombres compuestos. Los controles MRZ no comprueban cada letra del nombre.
4. Día 4: repetir con luz interior, exterior, inclinación moderada y reflejos; registrar intentos fallidos y tiempo hasta confirmación, sin suponer rendimiento inferior a 150 ms.
5. Día 5: cambiar de aplicación, bloquear y desbloquear el teléfono, retirar y volver a presentar documentos; verificar que no se mezclan sesiones ni se duplican registros.
6. Día 6: verificar registros por evento, funcionamiento sin conexión y recuperación al reconectar; comprobar la recepción del respaldo únicamente si está configurado en el servidor.

Antes de usarla en un evento de producción debe verificarse en un iPhone real. Ni una compilación correcta ni las pruebas de texto demuestran por sí solas la lectura de documentos físicos, la velocidad o el comportamiento ante reflejos.

## Compilación

Rama: `codex/ios-native-trial`. Flujo: `.github/workflows/ios-trial.yml`.

El flujo usa un Mac hospedado por GitHub para generar un Release para `iphoneos`, con el paquete JavaScript embebido y sin firma de distribución. El archivo necesita la firma personal que realiza Sideloadly antes de ejecutarse en el teléfono. No sirve instalar una compilación para simulador.

Los ejecutores estándar de GitHub son gratuitos para repositorios públicos; no cambiar la visibilidad de un repositorio privado para obtener gratuidad. No se solicita una cuenta de Apple durante la compilación y no se publican certificados ni contraseñas.

Fuentes: https://docs.github.com/en/actions/concepts/billing-and-usage, https://sideloadly.io/faq.html, https://developer.apple.com/help/account/basics/about-your-developer-account/.
