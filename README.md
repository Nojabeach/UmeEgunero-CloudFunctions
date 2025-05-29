# UmeEgunero Firebase Cloud Functions

Este directorio contiene las Cloud Functions utilizadas por la aplicación UmeEgunero.

## Funciones Implementadas

### Notificaciones

- **notifyOnNewUnifiedMessage**: Envía notificaciones push cuando se crea un nuevo mensaje en la colección `unified_messages`.
  - Detecta si es un mensaje individual (receiverId) o grupal (receiversIds)
  - Filtra para no enviar notificaciones al emisor del mensaje
  - Integración con servicio GAS de Messaging para personalización avanzada
  - Trigger: `document.created` en la colección `unified_messages`

- **notifyOnNewMessage**: (Función de compatibilidad) Envía notificaciones para mensajes creados en la colección antigua de mensajes.
  - Mantiene compatibilidad con versiones anteriores de la app
  - Trigger: `document.created` en la colección `mensajes`

### Solicitudes de vinculación

- **notifyOnNewSolicitudVinculacion**: Envía notificaciones a los administradores cuando un familiar solicita vinculación con un alumno.
  - Trigger: `document.created` en la colección `solicitudes_vinculacion`

- **notifyOnSolicitudVinculacionUpdated**: Notifica al familiar cuando su solicitud de vinculación es procesada.
  - Envía diferentes mensajes según estado (APROBADA/RECHAZADA)
  - Trigger: `document.updated` en la colección `solicitudes_vinculacion`

### Eliminación de usuarios

- **deleteUserByEmail**: Elimina completamente un usuario de Firebase Auth y actualiza el estado en Firestore.
  - Se activa cuando se crea un documento en la colección `user_deletion_requests`
  - Actualiza el documento con el estado del proceso (COMPLETED/ERROR)
  - Utiliza el servicio GAS de User Management para operaciones críticas
  - Trigger: `document.created` en la colección `user_deletion_requests`

- **requestUserDeletion**: Endpoint HTTP para solicitar eliminación de usuarios (para pruebas).
  - URL: `https://us-central1-umeegunero.cloudfunctions.net/requestUserDeletion`
  - Método: `POST`
  - Requiere autenticación y privilegios de administrador

### Custom Claims

- **setClaimsOnNewUser**: Establece automáticamente los custom claims cuando se crea un nuevo usuario.
  - Analiza los perfiles del usuario para determinar sus roles (isProfesor, isAdmin, isAdminApp)
  - Añade el DNI como claim para utilizarlo en las reglas de seguridad
  - Trigger: `document.create` en la ruta `usuarios/{userId}`

- **syncClaimsOnUserUpdate**: Actualiza los custom claims cuando se modifica un usuario en Firestore.
  - Solo se ejecuta si los perfiles o el DNI han cambiado
  - Mantiene sincronizados los permisos en Auth con la información en Firestore
  - Trigger: `document.update` en la ruta `usuarios/{userId}`

- **syncUserCustomClaims**: Función HTTP para sincronizar todos los claims de usuarios existentes.
  - Útil para actualizar todos los usuarios cuando se implementan nuevas reglas
  - Requiere una clave API para proteger el acceso
  - URL: `https://us-central1-umeegunero.cloudfunctions.net/syncUserCustomClaims`
  - Método: `POST`

- **setUserClaimsById**: Función HTTPS callable para establecer claims a un usuario específico.
  - Solo puede ser llamada por administradores
  - Permite modificar manualmente los claims de un usuario
  - URL: `https://us-central1-umeegunero.cloudfunctions.net/setUserClaimsById`
  - Método: `POST`

### Actualización de Usuarios

- **updateUserFirebaseUid**: Actualiza el campo firebaseUid de un usuario en Firestore.
  - Función HTTP utilizada para sincronización y corrección de datos
  - Útil para usuarios que se crearon sin vincular correctamente con Auth
  - URL: `https://us-central1-umeegunero.cloudfunctions.net/updateUserFirebaseUid`
  - Método: `POST`
  - Requiere autenticación y privilegios de administrador

## Integración con Google Apps Script

La aplicación utiliza tres servicios GAS independientes que complementan las Cloud Functions:

### 1. Email Service
- Envío de correos transaccionales con plantillas HTML personalizadas
- Notificaciones de registro y recuperación de contraseña
- Informes y comunicados oficiales

### 2. Messaging Service
- Procesamiento avanzado de notificaciones push
- Gestión y verificación de tokens FCM
- Personalización de mensajes según tipo de usuario

### 3. User Management Service
- Eliminación segura de usuarios (Auth + Firestore)
- Actualización de estado de usuarios
- Operaciones administrativas privilegiadas

Estos servicios funcionan como microservicios serverless, proporcionando funcionalidades avanzadas sin costos adicionales.

## Comandos Útiles

### Desplegar todas las funciones

```bash
firebase deploy --only functions
```

### Desplegar una función específica

```bash
firebase deploy --only functions:nombreDeLaFuncion
```

### Desplegar solo las funciones de custom claims

```bash
firebase deploy --only functions:setClaimsOnNewUser,functions:syncClaimsOnUserUpdate,functions:syncUserCustomClaims,functions:setUserClaimsById
```

### Ver logs

```bash
firebase functions:log
```

## Estructura

```
cloud-functions/
├── functions/
│   ├── index.js                # Funciones principales
│   ├── setUserCustomClaims.js  # Funciones de custom claims
│   ├── package.json            # Dependencias
│   └── .gitignore              # Archivos ignorados
└── README.md                   # Este archivo
```

## Configuración

Las funciones utilizan las siguientes URLs de servicios externos (Google Apps Script):

- **Email Service**: Para envío de emails transaccionales
  - URL: `https://script.google.com/macros/s/AKfycbyfTE5SZDmPymn-KfkrWh-_T3thgxnNbSdLr93lsXMcYgMd_-xmIRRaA3JZb3xvPDZgCw/exec`

- **Messaging Service**: Para procesamiento de notificaciones push
  - URL: `https://script.google.com/macros/s/AKfycbze3MmQnykWCV_ymsZgnICiC1wFIZG37-8Pr66ZbJS9X87LiL10wC3JJYVu1MVzsjxP/exec`

- **User Management Service**: Para operaciones de gestión de usuarios
  - URL: `https://script.google.com/macros/s/AKfycbyLX_6MkLXYoZTzAWbrZ-NMRDlGNx6DuWUDXDJ3MxEiKRPTqHVGCRmIw_NQhiEO7eT5/exec`

Estas URLs están configuradas directamente en el código y deben actualizarse si los servicios GAS cambian.

## Desarrollo Local

Para probar las funciones localmente:

```bash
cd functions
npm install
firebase emulators:start --only functions
```

## Notas Importantes

- Las funciones requieren Node.js 16+ (configurado en package.json)
- Las funciones para custom claims son esenciales para que las reglas de seguridad de Firestore funcionen correctamente
- Los alumnos nunca tendrán firebaseUid ya que no inician sesión en la aplicación
- Todos los tokens FCM se obtienen de los documentos de usuario en Firestore
- Las notificaciones incluyen datos específicos para la navegación en la app

## Monitoreo y Rendimiento

| Función | Región | Tipo | Versión | Invocaciones (30d) | Errores |
|---------|--------|------|---------|-------------------|---------|
| notifyOnNewUnifiedMessage | us-central1 | document.created | v2 | 19 | 0 |
| notifyOnNewSolicitudVinculacion | us-central1 | document.created | v2 | 0 | 0 |
| notifyOnSolicitudVinculacionUpdated | us-central1 | document.updated | v2 | 0 | 0 |
| deleteUserByEmail | us-central1 | document.created | v2 | 0 | 0 |
| notifyOnNewMessage | us-central1 | document.created | v2 | 0 | 0 |
| requestUserDeletion | us-central1 | Solicitud | v1 | 0 | 0 |
| setUserClaimsById | us-central1 | Solicitud | v1 | 0 | 0 |
| syncUserCustomClaims | us-central1 | Solicitud | v1 | 2 | 0 |
| setClaimsOnNewUser | us-central1 | document.create | v1 | 0 | 0 |
| updateUserFirebaseUid | us-central1 | Solicitud | v1 | 1 | 0 |
| syncClaimsOnUserUpdate | us-central1 | document.update | v1 | 4 | 0 |

## Mantenimiento

Para actualizar las funciones:
1. Modificar el código en `functions/index.js` o `functions/setUserCustomClaims.js`
2. Probar localmente con emuladores
3. Desplegar con `firebase deploy --only functions`
4. Verificar en la consola de Firebase que las funciones estén activas 