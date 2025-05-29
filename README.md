# UmeEgunero Cloud Functions

Este repositorio contiene las Cloud Functions para el proyecto UmeEgunero.

## Descripción

Las Cloud Functions manejan las siguientes funcionalidades:
- **notifyOnNewUnifiedMessage**: Notificaciones push para mensajes unificados (usa servicio GAS)
- **notifyOnNewMessage**: Notificaciones para mensajes regulares (compatibilidad)
- **notifyOnNewSolicitudVinculacion**: Notificaciones para nuevas solicitudes de vinculación
- **notifyOnSolicitudVinculacionUpdated**: Notificaciones cuando se procesan solicitudes

## Estructura

```
cloud-functions/
├── functions/
│   ├── index.js         # Código principal de las funciones
│   ├── package.json     # Dependencias
│   └── .eslintrc.js     # Configuración de linting
├── firebase.json        # Configuración de Firebase
└── .firebaserc          # Proyecto de Firebase
```

## Instalación

1. Instalar dependencias:
```bash
cd functions
npm install
```

2. Configurar Firebase:
```bash
firebase use umeegunero
```

## Despliegue

Para desplegar las funciones:
```bash
firebase deploy --only functions
```

## Integración con servicios GAS

Las funciones están integradas con Google Apps Script para:
- Envío de emails mediante plantillas
- Notificaciones push
- Eliminación de usuarios (solo desde la app)

Las URLs de los servicios GAS están configuradas en el código.

## Desarrollo

Para ejecutar las funciones localmente:
```bash
firebase emulators:start --only functions
```

## Notas importantes

- Este es un submódulo del repositorio principal [UmeEgunero](https://github.com/Nojabeach/UmeEgunero)
- Las funciones se ejecutan en Node.js 20
- Se requiere Firebase CLI para el despliegue 