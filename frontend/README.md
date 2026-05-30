# CedulaScan Pro Frontend

App Expo/React Native para registrar asistencia por cédula.

## Configuración

Crea `.env` desde `.env.example`:

```env
EXPO_PUBLIC_BACKEND_URL=https://tu-backend-publicado.com
```

En desarrollo LAN puedes usar una IP local si el celular está en la misma red. En builds de nube/EAS usa siempre la URL pública HTTPS del backend.

## Comandos

```bash
yarn install
yarn start
yarn android
```

El escáner usa `expo-camera`; no requiere `react-native-vision-camera`, así evita errores de módulo nativo faltante en Expo Go o dev clients no reconstruidos.
