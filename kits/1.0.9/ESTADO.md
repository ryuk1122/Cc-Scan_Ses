# Entrega 1.0.9

Servidor Render actualizado al commit f32fb4d89719c38df672c19b4d033973f5b5d388; API 2.3.0; lector 1.0.9. /api/health y /api/ready respondieron HTTP 200 con base disponible. Rutas de OCR local y Gemini presentes y protegidas: HTTP 401 sin autenticar. Render comprueba /api/ready como ruta de salud. Los registros de inicio conservaron 4.871 afiliados, igual que el despliegue previo; no se comprobó el contenido de todas las colecciones.

430 pruebas de servidor aprobadas; 337 casos MRZ y 23 pruebas nativas aprobados en la preparación de la APK. La meta de 150 ms requiere teléfono real.

El ZIP contiene servidor, pruebas, documentación y archivos modificados del lector, sin base de datos ni credenciales. Para compilar la aplicación completa usar el repositorio con sus recursos y archivos de dependencias. La APK está generada y verificada, pero no se adjuntó a GitHub porque el navegador bloquea archivos locales hasta habilitar el permiso de la extensión. No confundir la suma de la APK con su disponibilidad en esta carpeta.

Supabase sigue sin configurar según el registro actual de inicio. No se creó una copia completa de MongoDB ni se afirma recuperación de datos garantizada. Se conservó el código del servidor previo en codex/respaldo-servidor-2026-10-26. Ver docs/KIT_ACTUALIZACION_1.0.9.md.
