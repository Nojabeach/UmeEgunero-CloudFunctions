# Cloud Functions para UmeEgunero

Este directorio contiene las Firebase Cloud Functions utilizadas por la aplicación UmeEgunero.

## Descripción

Las Cloud Functions manejan la lógica del servidor, incluyendo:
- Envío de notificaciones push cuando se crean nuevos mensajes
- Notificaciones para solicitudes de vinculación
- Integración con Google Apps Script para servicios externos

## Estructura

```
cloud-functions/
├── functions/
│   ├── index.js          # Funciones principales
│   ├── package.json      # Dependencias
│   └── .gitignore       # Archivos ignorados
└── README.md            # Este archivo
```

## Funciones Implementadas

### 1. `notifyOnNewUnifiedMessage`
- **Trigger**: Creación de documento en `unified_messages`
- **Descripción**: Envía notificaciones push cuando se crea un nuevo mensaje unificado
- **Integración**: Llama al servicio de Google Apps Script para enviar notificaciones FCM

### 2. `notifyOnNewMessage`
- **Trigger**: Creación de documento en `messages` (compatibilidad)
- **Descripción**: Maneja mensajes del sistema antiguo
- **Integración**: Similar a la función unificada

### 3. `notifyOnNewSolicitudVinculacion`
- **Trigger**: Creación de documento en `solicitudes_vinculacion`
- **Descripción**: Notifica a administradores cuando hay nuevas solicitudes
- **Integración**: Envío directo de notificaciones FCM

### 4. `notifyOnSolicitudVinculacionUpdated`
- **Trigger**: Actualización de documento en `solicitudes_vinculacion`
- **Descripción**: Notifica al familiar cuando su solicitud es procesada
- **Integración**: FCM + Email vía Google Apps Script

## Configuración

Las funciones utilizan las siguientes URLs de servicios externos (Google Apps Script):

- **Email Service**: Para envío de emails transaccionales
- **Messaging Service**: Para procesamiento de notificaciones push

Estas URLs están configuradas directamente en el código y deben actualizarse si los servicios GAS cambian.

## Despliegue

```bash
cd functions
npm install
firebase deploy --only functions
```

## Desarrollo Local

Para probar las funciones localmente:

```bash
cd functions
npm install
firebase emulators:start --only functions
```

## Notas Importantes

- Las funciones dependen de servicios externos de Google Apps Script
- Los tokens FCM se obtienen de los documentos de usuario en Firestore
- Las notificaciones incluyen datos específicos para la navegación en la app

## Mantenimiento

Para actualizar las funciones:
1. Modificar el código en `functions/index.js`
2. Probar localmente con emuladores
3. Desplegar con `firebase deploy --only functions`
4. Verificar en la consola de Firebase que las funciones estén activas 