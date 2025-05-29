# UmeEgunero Firebase Cloud Functions

Este directorio contiene las Cloud Functions utilizadas por la aplicación UmeEgunero.

## Funciones Implementadas

### Notificaciones

- **notifyOnNewUnifiedMessage**: Envía notificaciones push cuando se crea un nuevo mensaje en la colección `unified_messages`.
  - Detecta si es un mensaje individual (receiverId) o grupal (receiversIds)
  - Filtra para no enviar notificaciones al emisor del mensaje

### Solicitudes de vinculación

- **notifyOnNewVinculationRequest**: Envía notificaciones a los administradores cuando un familiar solicita vinculación con un alumno.
- **notifyOnVinculationRequestUpdate**: Notifica al familiar cuando su solicitud de vinculación es procesada.

### Eliminación de usuarios

- **deleteUserByEmail**: Elimina completamente un usuario de Firebase Auth y actualiza el estado en Firestore.
  - Se activa cuando se crea un documento en la colección `user_deletion_requests`
  - Actualiza el documento con el estado del proceso (COMPLETED/ERROR)
- **requestUserDeletion**: Endpoint HTTP para solicitar eliminación de usuarios (para pruebas).

### Custom Claims

- **setClaimsOnNewUser**: Establece automáticamente los custom claims cuando se crea un nuevo usuario.
  - Analiza los perfiles del usuario para determinar sus roles (isProfesor, isAdmin, isAdminApp)
  - Añade el DNI como claim para utilizarlo en las reglas de seguridad

- **syncClaimsOnUserUpdate**: Actualiza los custom claims cuando se modifica un usuario en Firestore.
  - Solo se ejecuta si los perfiles o el DNI han cambiado
  - Mantiene sincronizados los permisos en Auth con la información en Firestore

- **syncUserCustomClaims**: Función HTTP para sincronizar todos los claims de usuarios existentes.
  - Útil para actualizar todos los usuarios cuando se implementan nuevas reglas
  - Requiere una clave API para proteger el acceso

- **setUserClaimsById**: Función HTTPS callable para establecer claims a un usuario específico.
  - Solo puede ser llamada por administradores
  - Permite modificar manualmente los claims de un usuario

## Comandos Útiles

### Desplegar todas las funciones

```bash
firebase deploy --only functions
```

### Desplegar una función específica

```bash
firebase deploy --only functions:nombreDeLaFuncion
```

### Desplegar solo las nuevas funciones de custom claims

```bash
firebase deploy --only functions:setClaimsOnNewUser,functions:syncClaimsOnUserUpdate,functions:syncUserCustomClaims,functions:setUserClaimsById
```

### Ver logs

```bash
firebase functions:log
```

## Notas importantes

- Todas las funciones utilizan Firebase Admin SDK para acceder a Firestore y Authentication.
- Las funciones relacionadas con notificaciones requieren tokens FCM válidos almacenados en los documentos de usuario.
- Las funciones para custom claims son esenciales para que las reglas de seguridad de Firestore funcionen correctamente.

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