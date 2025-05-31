const functions = require("firebase-functions");
const {onDocumentCreated, onDocumentUpdated} = require("firebase-functions/v2/firestore");
// Importante: Necesitamos un módulo para hacer llamadas HTTP.
// 'node-fetch' es común, pero las Cloud Functions v2 tienen fetch global (experimental?)
// Para asegurar compatibilidad, usaremos node-fetch v2 (require).
// ¡Asegúrate de añadirlo a package.json!
const fetch = require("node-fetch");
const admin = require("firebase-admin");
const axios = require("axios");

// Importar funciones de autenticación personalizada
// Nota: estas funciones usan Firebase Functions v1, no v2
const {
  syncUserCustomClaims,
  setUserClaimsById,
  syncClaimsOnUserUpdate,
  setClaimsOnNewUser
} = require("./setUserCustomClaims");

admin.initializeApp();

// URLs de los servicios Google Apps Script desplegados
const APPS_SCRIPT_EMAIL_URL = "https://script.google.com/macros/s/AKfycbyWjyQ_-J5YeKxgGMVsFOFCuQMUqFKsr5zRCONGNydiFrqdx6Gwd6YPosdx1dXhu8H4QA/exec"; // Servicio de email
// const APPS_SCRIPT_DELETE_USER_URL = "https://script.google.com/macros/s/AKfycbyh6ESPVYm-EyBM3z4DXgNW2yKNFSTzpN4-fR6b6CwFvSZMxBAtUJVk2Djy5qb_7qtk/exec"; // Servicio de eliminación de usuarios (no usado en Cloud Functions)
const APPS_SCRIPT_MESSAGING_URL = "https://script.google.com/macros/s/AKfycbz-icUrMUrWAmvf8iuc6B8qd_WB5x0OORsnt3wfQ3XdzPl0nCml_L3MS3Lr6rLnQuxAdA/exec"; // Servicio de mensajería/notificaciones actualizado

// Nueva función para manejar solicitudes de vinculación
exports.notifyOnNewSolicitudVinculacion = onDocumentCreated("solicitudes_vinculacion/{solicitudId}", async (event) => {
  const snap = event.data;
  if (!snap) {
    console.log("No data associated with the event");
    return;
  }
  
  const solicitud = snap.data();
  const solicitudId = event.params.solicitudId;
  
  console.log(`Nueva solicitud de vinculación detectada [${solicitudId}]. Datos:`, JSON.stringify(solicitud));
  
  try {
    // Obtener el centro ID de la solicitud
    const centroId = solicitud.centroId;
    if (!centroId) {
      console.log("Solicitud sin centroId, no se pueden buscar administradores");
      return;
    }
    
    console.log(`Buscando administradores para el centro: ${centroId}`);
    
    // Buscar todos los usuarios y filtrar en el código
    const allUsersSnapshot = await admin.firestore().collection("usuarios").get();
    
    if (allUsersSnapshot.empty) {
      console.log("No se encontraron usuarios en la base de datos");
      return;
    }
    
    console.log(`Se encontraron ${allUsersSnapshot.size} usuarios en total`);
    
    // Filtrar administradores del centro específico
    const adminUsers = [];
    allUsersSnapshot.forEach(doc => {
      const userData = doc.data();
      const perfiles = userData.perfiles || [];
      
      // Buscar si tiene un perfil de ADMIN_CENTRO para este centro
      const isAdminOfCenter = perfiles.some(perfil => 
        perfil.tipo === "ADMIN_CENTRO" && 
        perfil.centroId === centroId && 
        perfil.verificado === true
      );
      
      if (isAdminOfCenter) {
        adminUsers.push({
          id: doc.id,
          data: userData
        });
        console.log(`Administrador encontrado: ${doc.id}`);
      }
    });
    
    // Simular adminSnapshot para compatibilidad con el código existente
    const adminSnapshot = { 
      empty: adminUsers.length === 0,
      forEach: (callback) => {
        adminUsers.forEach(admin => {
          callback({
            id: admin.id,
            data: () => admin.data
          });
        });
      }
    };
    
    // Recopilar tokens FCM de todos los administradores
    let tokensToSend = [];
    
    adminSnapshot.forEach(doc => {
      const adminData = doc.data();
      
      // Buscar token FCM en preferencias.notificaciones.fcmToken
      const preferencias = adminData.preferencias || {};
      const notificaciones = preferencias.notificaciones || {};
      const fcmToken = notificaciones.fcmToken;
      
      if (fcmToken && typeof fcmToken === "string") {
        tokensToSend.push(fcmToken);
        console.log(`Token FCM encontrado para admin ${doc.id}: ${fcmToken.substring(0, 20)}...`);
      }
      
      // También buscar en fcmTokens (formato alternativo)
      const fcmTokens = adminData.fcmTokens || {};
      Object.values(fcmTokens).forEach(token => {
        if (token && typeof token === "string" && !tokensToSend.includes(token)) {
          tokensToSend.push(token);
        }
      });
    });
    
    if (tokensToSend.length === 0) {
      console.log("No se encontraron tokens FCM para los administradores del centro");
      return;
    }
    
    console.log(`Se encontraron ${tokensToSend.length} tokens de administradores para enviar notificaciones`);
    
    // Preparar el mensaje de notificación
    const titulo = "Nueva solicitud de vinculación";
    const mensaje = `El familiar ${solicitud.nombreFamiliar || "Un familiar"} ha solicitado vincularse con ${solicitud.alumnoNombre || "un alumno"}`;
    
    // Enviar notificaciones usando HTTP directo en lugar de sendMulticast
    try {
      // Obtener el token de acceso para la API de FCM
      const accessToken = await admin.credential.applicationDefault().getAccessToken();
      
      // Enviar notificación a cada token individualmente
      const notificationPromises = tokensToSend.map(async (token) => {
        const fcmMessage = {
          message: {
            token: token,
            notification: {
              title: titulo,
              body: mensaje
            },
            data: {
              tipo: "solicitud_vinculacion",
              solicitudId: solicitudId,
              centroId: centroId,
              click_action: "SOLICITUD_PENDIENTE"
            },
            android: {
              priority: "high",
              notification: {
                channel_id: "channel_solicitudes_vinculacion"
              }
            },
            apns: {
              payload: {
                aps: {
                  alert: {
                    title: titulo,
                    body: mensaje
                  },
                  sound: "default"
                }
              }
            }
          }
        };
        
        const response = await fetch(`https://fcm.googleapis.com/v1/projects/umeegunero/messages:send`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken.access_token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(fcmMessage)
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          console.log(`Error enviando a token ${token.substring(0, 20)}...: ${response.status} - ${errorText}`);
          return { success: false, token, error: errorText };
        }
        
        const result = await response.json();
        console.log(`Notificación enviada exitosamente a token ${token.substring(0, 20)}...: ${result.name}`);
        return { success: true, token, result };
      });
      
      const results = await Promise.all(notificationPromises);
      const successCount = results.filter(r => r.success).length;
      const failureCount = results.filter(r => !r.success).length;
      
      console.log(`Notificaciones de solicitud enviadas: ${successCount} éxitos, ${failureCount} fallos`);
      
      return { success: true, successCount, failureCount };
      
    } catch (error) {
      console.error("Error al obtener token de acceso o enviar notificaciones:", error);
      return { success: false, error: error.message };
    }
    
  } catch (error) {
    console.error("Error al enviar notificaciones de solicitud de vinculación:", error);
    return { success: false, error: error.message };
  }
});

// Nueva función para manejar actualizaciones de solicitudes de vinculación
exports.notifyOnSolicitudVinculacionUpdated = onDocumentUpdated("solicitudes_vinculacion/{solicitudId}", async (event) => {
  const beforeSnap = event.data.before;
  const afterSnap = event.data.after;
  
  if (!beforeSnap || !afterSnap) {
    console.log("No hay datos before/after en el evento de actualización");
    return;
  }
  
  const beforeData = beforeSnap.data();
  const afterData = afterSnap.data();
  const solicitudId = event.params.solicitudId;
  
  console.log(`Solicitud de vinculación actualizada [${solicitudId}]`);
  console.log(`Estado anterior: ${beforeData.estado}, Estado nuevo: ${afterData.estado}`);
  
  // Solo procesar si el estado cambió de PENDIENTE a APROBADA o RECHAZADA
  if (beforeData.estado === "PENDIENTE" && (afterData.estado === "APROBADA" || afterData.estado === "RECHAZADA")) {
    console.log(`Solicitud ${solicitudId} procesada: ${afterData.estado}`);
    
    try {
      // Buscar el familiar para obtener su token FCM
      const familiarId = afterData.familiarId;
      if (!familiarId) {
        console.log("No se encontró familiarId en la solicitud");
        return;
      }
      
      console.log(`Buscando familiar: ${familiarId}`);
      
      const familiarDoc = await admin.firestore().collection("usuarios").doc(familiarId).get();
      if (!familiarDoc.exists) {
        console.log(`❌ No se encontró el familiar con ID: ${familiarId} - familiar aún no ha iniciado sesión`);
        console.log(`📧 Enviando email vía Google Apps Script usando datos de la solicitud`);
        
        // Enviar email usando los datos de la solicitud
        await enviarEmailViaGAS(
          afterData.familiarEmail || "email@ejemplo.com", // Email desde la solicitud
          afterData.familiarNombre || "Familiar", // Nombre desde la solicitud
          afterData.estado,
          afterData.alumnoNombre || "el alumno",
          afterData.observaciones || ""
        );
        
        return { 
          success: true, 
          method: "email_sent_via_gas", 
          familiarId: familiarId,
          reason: "Familiar no ha iniciado sesión - email enviado vía GAS"
        };
      }
      
      const familiarData = familiarDoc.data();
      console.log(`Familiar encontrado: ${familiarData.nombre} ${familiarData.apellidos}`);
      
      // Buscar tokens FCM del familiar
      let tokensToSend = [];
      
      // Buscar en preferencias.notificaciones.fcmToken
      const preferencias = familiarData.preferencias || {};
      const notificaciones = preferencias.notificaciones || {};
      const fcmToken = notificaciones.fcmToken;
      
      if (fcmToken && typeof fcmToken === "string") {
        tokensToSend.push(fcmToken);
        console.log(`Token FCM encontrado en preferencias para familiar ${familiarId}: ${fcmToken.substring(0, 20)}...`);
      }
      
      // También buscar en fcmTokens (formato alternativo)
      const fcmTokens = familiarData.fcmTokens || {};
      Object.values(fcmTokens).forEach(token => {
        if (token && typeof token === "string" && !tokensToSend.includes(token)) {
          tokensToSend.push(token);
          console.log(`Token FCM adicional encontrado para familiar ${familiarId}: ${token.substring(0, 20)}...`);
        }
      });
      
      if (tokensToSend.length === 0) {
        console.log(`❌ No se encontraron tokens FCM para el familiar ${familiarId} - dispositivo no registrado`);
        console.log(`📧 Enviando email vía Google Apps Script a ${familiarData.email || "email no disponible"}`);
      }
      
      // Preparar el mensaje según el estado
      const esAprobada = afterData.estado === "APROBADA";
      const titulo = esAprobada ? "Solicitud aprobada" : "Solicitud rechazada";
      const alumnoNombre = afterData.alumnoNombre || "el alumno";
      const mensaje = esAprobada 
        ? `Tu solicitud para vincularte con ${alumnoNombre} ha sido aprobada`
        : `Tu solicitud para vincularte con ${alumnoNombre} ha sido rechazada`;
      
      console.log(`Enviando notificación: "${titulo}" - "${mensaje}"`);
      
      // SIEMPRE enviar email vía Google Apps Script (independientemente de si hay tokens FCM)
      try {
        await enviarEmailViaGAS(
          familiarData.email || afterData.familiarEmail || "email@ejemplo.com",
          familiarData.nombre || afterData.familiarNombre || "Familiar",
          afterData.estado,
          afterData.alumnoNombre || "el alumno",
          afterData.observaciones || ""
        );
        console.log(`📧 Email enviado vía Google Apps Script a ${familiarData.email || afterData.familiarEmail}`);
      } catch (emailError) {
        console.error("Error enviando email vía GAS:", emailError);
        // No interrumpimos el flujo si falla el email
      }
      
      // Enviar notificaciones push solo si hay tokens FCM
      if (tokensToSend.length > 0) {
        console.log(`📱 Enviando notificaciones push a ${tokensToSend.length} dispositivos`);
      } else {
        console.log(`📱 No hay tokens FCM, solo se envió email`);
        return { 
          success: true, 
          method: "email_only", 
          familiarId: familiarId,
          email: familiarData.email || afterData.familiarEmail
        };
      }
      
      // Enviar notificaciones push usando HTTP directo
      try {
        const accessToken = await admin.credential.applicationDefault().getAccessToken();
        
        const notificationPromises = tokensToSend.map(async (token) => {
          const fcmMessage = {
            message: {
              token: token,
              notification: {
                title: titulo,
                body: mensaje
              },
              data: {
                tipo: "solicitud_procesada",
                solicitudId: solicitudId,
                estado: afterData.estado,
                click_action: "SOLICITUD_PROCESADA"
              },
              android: {
                priority: "high",
                notification: {
                  channel_id: "channel_solicitudes_vinculacion"
                }
              },
              apns: {
                payload: {
                  aps: {
                    alert: {
                      title: titulo,
                      body: mensaje
                    },
                    sound: "default"
                  }
                }
              }
            }
          };
          
          const response = await fetch(`https://fcm.googleapis.com/v1/projects/umeegunero/messages:send`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${accessToken.access_token}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(fcmMessage)
          });
          
          if (!response.ok) {
            const errorText = await response.text();
            console.log(`Error enviando a token ${token.substring(0, 20)}...: ${response.status} - ${errorText}`);
            return { success: false, token, error: errorText };
          }
          
          const result = await response.json();
          console.log(`Notificación enviada exitosamente a token ${token.substring(0, 20)}...: ${result.name}`);
          return { success: true, token, result };
        });
        
        const results = await Promise.all(notificationPromises);
        const successCount = results.filter(r => r.success).length;
        const failureCount = results.filter(r => !r.success).length;
        
        console.log(`Notificaciones de solicitud procesada enviadas: ${successCount} éxitos, ${failureCount} fallos`);
        
        return { success: true, successCount, failureCount };
        
      } catch (error) {
        console.error("Error al obtener token de acceso o enviar notificaciones:", error);
        return { success: false, error: error.message };
      }
      
    } catch (error) {
      console.error("Error al procesar notificación de solicitud actualizada:", error);
      return { success: false, error: error.message };
    }
  } else {
    console.log(`Cambio de estado no relevante: ${beforeData.estado} -> ${afterData.estado}`);
  }
});

// Función auxiliar para enviar emails vía Google Apps Script
async function enviarEmailViaGAS(destinatario, nombre, estado, nombreAlumno, observaciones = "") {
  try {
    console.log(`📧 Enviando email vía GAS: ${destinatario}, Estado: ${estado}, Alumno: ${nombreAlumno}`);
    
    const esAprobada = estado === "APROBADA";
    const asunto = esAprobada 
      ? `Solicitud Aprobada - Vinculación con ${nombreAlumno}`
      : `Solicitud Rechazada - Vinculación con ${nombreAlumno}`;
    
    // Construir la URL con parámetros para Google Apps Script
    const params = new URLSearchParams({
      destinatario: destinatario,
      asunto: asunto,
      nombre: nombre,
      tipoPlantilla: "SOLICITUD_PROCESADA",
      nombreAlumno: nombreAlumno,
      estado: estado,
      observaciones: observaciones || ""
    });
    
    const gasUrl = `${APPS_SCRIPT_EMAIL_URL}?${params.toString()}`;
    
    console.log(`📧 Llamando a GAS: ${gasUrl.substring(0, 100)}...`);
    
    const response = await fetch(gasUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json"
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const result = await response.json();
    console.log(`📧 Respuesta de GAS:`, JSON.stringify(result));
    
    if (result.status === "OK") {
      console.log(`✅ Email enviado exitosamente vía GAS a ${destinatario}`);
      return { success: true, result };
    } else {
      console.error(`❌ Error en GAS: ${result.message}`);
      return { success: false, error: result.message };
    }
    
  } catch (error) {
    console.error(`❌ Error enviando email vía GAS:`, error);
    return { success: false, error: error.message };
  }
}

// Nueva función para eliminar usuarios completamente de Firebase Authentication
exports.deleteUserByEmail = onDocumentCreated("user_deletion_requests/{requestId}", async (event) => {
  const snap = event.data;
  if (!snap) {
    console.log("No data associated with the event");
    return;
  }
  
  const request = snap.data();
  const requestId = event.params.requestId;
  
  console.log(`🗑️ Nueva solicitud de eliminación de usuario [${requestId}]`);
  console.log(`📧 Email a eliminar: ${request.email}`);
  
  try {
    // Validar que tenemos el email
    if (!request.email) {
      console.error("❌ No se proporcionó email en la solicitud");
      // Actualizar el documento con el error
      await admin.firestore().collection("user_deletion_requests").doc(requestId).update({
        status: "ERROR",
        error: "Email no proporcionado",
        processedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return { success: false, error: "Email no proporcionado" };
    }
    
    // Buscar el usuario por email
    console.log(`🔍 Buscando usuario con email: ${request.email}`);
    let userRecord;
    
    try {
      userRecord = await admin.auth().getUserByEmail(request.email);
      console.log(`✅ Usuario encontrado - UID: ${userRecord.uid}`);
    } catch (error) {
      if (error.code === "auth/user-not-found") {
        console.log(`⚠️ Usuario no encontrado en Firebase Auth: ${request.email}`);
        // Actualizar el documento indicando que no se encontró
        await admin.firestore().collection("user_deletion_requests").doc(requestId).update({
          status: "USER_NOT_FOUND",
          error: "Usuario no encontrado en Firebase Authentication",
          processedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return { success: false, error: "Usuario no encontrado" };
      }
      throw error;
    }
    
    // Eliminar el usuario de Firebase Authentication
    console.log(`🗑️ Eliminando usuario ${userRecord.uid} de Firebase Auth...`);
    await admin.auth().deleteUser(userRecord.uid);
    console.log(`✅ Usuario eliminado exitosamente de Firebase Auth`);
    
    // Actualizar el documento de solicitud como completado
    await admin.firestore().collection("user_deletion_requests").doc(requestId).update({
      status: "COMPLETED",
      deletedUid: userRecord.uid,
      processedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log(`✅ Proceso de eliminación completado para ${request.email}`);
    
    return { 
      success: true, 
      message: `Usuario ${request.email} eliminado completamente`,
      uid: userRecord.uid 
    };
    
  } catch (error) {
    console.error(`❌ Error al eliminar usuario:`, error);
    
    // Actualizar el documento con el error
    await admin.firestore().collection("user_deletion_requests").doc(requestId).update({
      status: "ERROR",
      error: error.message,
      errorDetails: error.stack,
      processedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    return { success: false, error: error.message };
  }
});

// Función HTTP para crear solicitudes de eliminación (opcional, para testing)
exports.requestUserDeletion = require("firebase-functions").https.onRequest(async (req, res) => {
  // Habilitar CORS
  res.set("Access-Control-Allow-Origin", "*");
  
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "POST");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Max-Age", "3600");
    res.status(204).send("");
    return;
  }
  
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }
  
  const { email, apiKey } = req.body;
  
  // Validación básica de API Key (puedes mejorar esto)
  const EXPECTED_API_KEY = process.env.DELETE_USER_API_KEY || "tu-api-key-secreta";
  if (apiKey !== EXPECTED_API_KEY) {
    res.status(401).json({ success: false, error: "API Key inválida" });
    return;
  }
  
  if (!email) {
    res.status(400).json({ success: false, error: "Email requerido" });
    return;
  }
  
  try {
    // Crear documento de solicitud de eliminación
    const docRef = await admin.firestore().collection("user_deletion_requests").add({
      email: email,
      status: "PENDING",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      requestSource: "HTTP_API"
    });
    
    console.log(`📝 Solicitud de eliminación creada: ${docRef.id} para ${email}`);
    
    res.status(200).json({ 
      success: true, 
      message: "Solicitud de eliminación creada",
      requestId: docRef.id 
    });
    
  } catch (error) {
    console.error("Error creando solicitud:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Función HTTP para actualizar el firebaseUid de un usuario
exports.updateUserFirebaseUid = require("firebase-functions").https.onRequest(async (req, res) => {
  // Habilitar CORS
  res.set("Access-Control-Allow-Origin", "*");
  
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "POST");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Max-Age", "3600");
    res.status(204).send("");
    return;
  }
  
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }
  
  const { dni, firebaseUid, apiKey } = req.body;
  
  // Validación básica de API Key
  const EXPECTED_API_KEY = process.env.ADMIN_API_KEY || "clave-secreta-para-produccion";
  if (apiKey !== EXPECTED_API_KEY) {
    res.status(401).json({ success: false, error: "API Key inválida" });
    return;
  }
  
  if (!dni || !firebaseUid) {
    res.status(400).json({ success: false, error: "DNI y firebaseUid son requeridos" });
    return;
  }
  
  try {
    // Actualizar el documento
    await admin.firestore().collection("usuarios").doc(dni).update({
      firebaseUid: firebaseUid
    });
    
    // Verificar que se haya actualizado correctamente
    const userDoc = await admin.firestore().collection("usuarios").doc(dni).get();
    const userData = userDoc.data();
    
    console.log(`✅ Usuario ${dni} actualizado con firebaseUid: ${firebaseUid}`);
    
    // Intentar establecer custom claims para el usuario
    try {
      // Determinar roles basados en perfiles
      const perfiles = userData.perfiles || [];
      let isProfesor = false;
      let isAdmin = false;
      let isAdminApp = false;
      
      perfiles.forEach(perfil => {
        const tipo = perfil.tipo;
        if (tipo === "PROFESOR") {
          isProfesor = true;
        } else if (tipo === "ADMIN_CENTRO") {
          isAdmin = true;
        } else if (tipo === "ADMIN_APP") {
          isAdminApp = true;
        }
      });
      
      // Preparar custom claims
      const customClaims = {
        dni: dni,
        isProfesor: isProfesor,
        isAdmin: isAdmin,
        isAdminApp: isAdminApp
      };
      
      // Establecer custom claims
      await admin.auth().setCustomUserClaims(firebaseUid, customClaims);
      
      console.log(`✅ Custom claims establecidos para ${dni}:`, customClaims);
      
      res.status(200).json({
        success: true,
        message: `Usuario ${dni} actualizado correctamente`,
        userData: {
          dni: userData.dni,
          nombre: userData.nombre,
          apellidos: userData.apellidos,
          email: userData.email,
          firebaseUid: userData.firebaseUid
        },
        customClaims: customClaims
      });
    } catch (claimsError) {
      console.error(`❌ Error al establecer custom claims:`, claimsError);
      
      // Todavía consideramos la operación exitosa si se actualizó el documento
      res.status(200).json({
        success: true,
        message: `Usuario ${dni} actualizado, pero hubo un error al establecer custom claims`,
        error: claimsError.message,
        userData: {
          dni: userData.dni,
          nombre: userData.nombre,
          apellidos: userData.apellidos,
          email: userData.email,
          firebaseUid: userData.firebaseUid
        }
      });
    }
  } catch (error) {
    console.error(`❌ Error al actualizar usuario:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Reexportar funciones de autenticación personalizada
exports.syncUserCustomClaims = syncUserCustomClaims;
exports.setUserClaimsById = setUserClaimsById;
exports.syncClaimsOnUserUpdate = syncClaimsOnUserUpdate;
exports.setClaimsOnNewUser = setClaimsOnNewUser;

// Función para enviar notificaciones utilizando FCM cuando se crea un mensaje unificado
exports.sendMessageNotification = functions.firestore.document("unified_messages/{messageId}")
    .onCreate(async (snapshot, context) => {
        const messageData = snapshot.data();
        const messageId = context.params.messageId;
        
        console.log(`⚡ Procesando notificación para mensaje: ${messageId}`);
        console.log(`📝 Datos del mensaje:`, JSON.stringify(messageData));
        
        try {
            // Validar que tengamos los datos necesarios
            if (!messageData) {
                console.error("❌ No hay datos en el mensaje");
                return null;
            }
            
            // Extraer datos relevantes
            const senderId = messageData.senderId || "";
            const receiversIds = messageData.receiversIds || [];
            const receiverId = messageData.receiverId || "";
            const messageType = messageData.type || "SYSTEM";
            const messageContent = messageData.content || "Nuevo mensaje";
            const messageTitle = messageData.title || "Ume Egunero";
            const conversationId = messageData.conversationId || "";
            
            console.log(`📬 Mensaje: Tipo=${messageType}, De=${senderId}, Para=${receiverId || receiversIds.join(",")}`);
            
            // Lista de receptores (combinar receiverId y receiversIds)
            let recipients = [];
            if (receiverId && receiverId !== "") {
                recipients.push(receiverId);
            }
            if (receiversIds && receiversIds.length > 0) {
                // Añadir sin duplicados
                for (const id of receiversIds) {
                    if (!recipients.includes(id)) {
                        recipients.push(id);
                    }
                }
            }
            
            // Remover al remitente de los destinatarios (no queremos enviarle notificación a él mismo)
            recipients = recipients.filter(id => id !== senderId);
            
            if (recipients.length === 0) {
                console.log("⚠️ No hay destinatarios para notificar");
                return null;
            }
            
            console.log(`📤 Preparando notificación para ${recipients.length} destinatarios: ${recipients.join(", ")}`);
            
            // Obtener datos del remitente para incluir en la notificación
            let senderName = "Usuario";
            let senderRole = "";
            try {
                const senderDoc = await admin.firestore().collection("usuarios").doc(senderId).get();
                if (senderDoc.exists) {
                    const senderData = senderDoc.data();
                    senderName = `${senderData.nombre || ""} ${senderData.apellidos || ""}`.trim() || "Usuario";
                    if (senderData.perfiles && senderData.perfiles.length > 0) {
                        senderRole = senderData.perfiles[0].tipo || "";
                    }
                }
                console.log(`👤 Remitente: ${senderName} (${senderRole})`);
            } catch (error) {
                console.error("❌ Error al obtener datos del remitente:", error);
                // Continuamos con el nombre por defecto
            }
            
            // Obtener tokens FCM para cada destinatario
            const fcmTokens = [];
            for (const recipientId of recipients) {
                try {
                    console.log(`🔍 Buscando token FCM para usuario: ${recipientId}`);
                    const userDoc = await admin.firestore().collection("usuarios").doc(recipientId).get();
                    if (userDoc.exists) {
                        const userData = userDoc.data();
                        
                        // Buscar el token FCM en varias ubicaciones posibles
                        let token = null;
                        
                        // 1. Estructura preferencias.notificaciones.fcmToken (preferida)
                        if (userData.preferencias && 
                            userData.preferencias.notificaciones && 
                            userData.preferencias.notificaciones.fcmToken) {
                            token = userData.preferencias.notificaciones.fcmToken;
                            console.log(`✅ Token encontrado en preferencias.notificaciones.fcmToken`);
                        }
                        
                        // 2. Campo fcmToken a nivel raíz
                        if (!token && userData.fcmToken) {
                            token = userData.fcmToken;
                            console.log(`✅ Token encontrado en fcmToken raíz`);
                        }
                        
                        // 3. Campo fcmTokens (objeto con múltiples tokens)
                        if (!token && userData.fcmTokens) {
                            const tokens = Object.values(userData.fcmTokens);
                            if (tokens.length > 0) {
                                token = tokens[0]; // Usar el primer token disponible
                                console.log(`✅ Token encontrado en fcmTokens`);
                            }
                        }
                        
                        // 4. Campo deviceId como último recurso
                        if (!token && userData.preferencias && 
                            userData.preferencias.notificaciones && 
                            userData.preferencias.notificaciones.deviceId) {
                            const deviceId = userData.preferencias.notificaciones.deviceId;
                            console.log(`⚠️ Usando deviceId como token para usuario ${recipientId}: ${deviceId}`);
                            token = deviceId;
                        }
                        
                        if (token) {
                            fcmTokens.push({
                                token: token,
                                userId: recipientId
                            });
                            console.log(`✅ Token FCM encontrado para usuario ${recipientId}: ${token.substring(0, 20)}...`);
                        } else {
                            console.warn(`⚠️ No se encontró token FCM para usuario ${recipientId}`);
                        }
                    } else {
                        console.warn(`⚠️ Usuario no encontrado: ${recipientId}`);
                    }
                } catch (userError) {
                    console.error(`❌ Error al obtener token para usuario ${recipientId}:`, userError);
                }
            }
            
            if (fcmTokens.length === 0) {
                console.error("❌ No se encontraron tokens FCM para ningún destinatario");
                return { success: false, message: "No se pudieron obtener tokens FCM" };
            }
            
            console.log(`📱 Enviando notificaciones push a ${fcmTokens.length} dispositivos`);
            
            // Preparar mensaje FCM
            const notificationTitle = `${messageTitle}${senderName ? ` - ${senderName}` : ""}`;
            const notificationBody = messageContent;
            
            // Enviar notificaciones push
            const fcmResults = [];
            for (const tokenData of fcmTokens) {
                try {
                    const message = {
                        token: tokenData.token,
                        notification: {
                            title: notificationTitle,
                            body: notificationBody
                        },
                        data: {
                            messageId: messageId,
                            conversationId: conversationId || "",
                            messageType: messageType,
                            senderId: senderId,
                            senderName: senderName,
                            senderRole: senderRole,
                            title: notificationTitle,
                            body: notificationBody,
                            click_action: "OPEN_MESSAGE"
                        },
                        android: {
                            priority: "high",
                            notification: {
                                sound: "default",
                                channel_id: getChannelIdForMessageType(messageType),
                                icon: "ic_notification",
                                color: "#6750A4"
                            }
                        },
                        apns: {
                            headers: {
                                "apns-priority": "10"
                            },
                            payload: {
                                aps: {
                                    alert: {
                                        title: notificationTitle,
                                        body: notificationBody
                                    },
                                    sound: "default",
                                    badge: 1
                                }
                            }
                        }
                    };
                    
                    const response = await admin.messaging().send(message);
                    fcmResults.push({ 
                        userId: tokenData.userId,
                        token: tokenData.token.substring(0, 20) + "...", 
                        success: true,
                        messageId: response
                    });
                    console.log(`✅ Notificación FCM enviada a ${tokenData.userId} (token: ${tokenData.token.substring(0, 20)}...)`);
                } catch (fcmError) {
                    console.error(`❌ Error al enviar FCM a ${tokenData.userId}:`, fcmError.message);
                    fcmResults.push({ 
                        userId: tokenData.userId,
                        token: tokenData.token.substring(0, 20) + "...", 
                        success: false, 
                        error: fcmError.message 
                    });
                    
                    // Si el token es inválido, podríamos limpiarlo de la base de datos
                    if (fcmError.code === "messaging/invalid-registration-token" ||
                        fcmError.code === "messaging/registration-token-not-registered") {
                        console.log(`🗑️ Token inválido, considerar limpiarlo de la BD para usuario ${tokenData.userId}`);
                    }
                }
            }
            
            const successCount = fcmResults.filter(r => r.success).length;
            const failureCount = fcmResults.filter(r => !r.success).length;
            
            console.log(`📊 Resultados FCM: ${successCount} éxitos, ${failureCount} fallos`);
            console.log(`📊 Detalle:`, JSON.stringify(fcmResults, null, 2));
            
            // También intentar enviar a través de GAS (opcional, como respaldo o para otros propósitos)
            try {
                const notificationData = {
                    messageId: messageId,
                    senderId: senderId,
                    participantsIds: recipients,
                    messageType: messageType,
                    messageContent: messageContent,
                    messageTitle: notificationTitle,
                    conversationId: conversationId,
                    senderName: senderName,
                    senderRole: senderRole
                };
                
                console.log("📤 Enviando también a GAS...");
                const response = await axios.post(APPS_SCRIPT_MESSAGING_URL, notificationData);
                console.log("✅ Respuesta del servicio GAS:", response.data);
            } catch (gasError) {
                console.error("❌ Error al enviar a GAS (no crítico):", gasError.message);
                // No es crítico si falla GAS, ya enviamos las notificaciones FCM
            }
            
            return { 
                success: successCount > 0, 
                message: `Notificaciones enviadas: ${successCount} éxitos, ${failureCount} fallos`,
                results: fcmResults,
                stats: { success: successCount, failures: failureCount }
            };
            
        } catch (error) {
            console.error("❌ Error general en función sendMessageNotification:", error);
            return { success: false, error: error.message };
        }
    });

// Función auxiliar para determinar el canal de notificación según el tipo de mensaje
function getChannelIdForMessageType(messageType) {
  switch (messageType) {
    case "CHAT":
      return "channel_chat";
    case "ANNOUNCEMENT":
      return "channel_announcements";
    case "INCIDENT":
      return "channel_incidencias";
    case "ATTENDANCE":
      return "channel_asistencia";
    case "DAILY_RECORD":
      return "channel_tareas";
    case "REGISTRO_ACTIVIDAD":
      return "channel_registros_actividad";
    case "NOTIFICATION":
    case "SYSTEM":
      return "channel_unified_communication";
    default:
      return "channel_general";
  }
}

// Función para enviar notificaciones cuando se crea un nuevo registro de actividad
exports.sendActivityRecordNotification = onDocumentCreated("registrosActividad/{registroId}", async (event) => {
    const snap = event.data;
    if (!snap) {
        console.log("No hay datos asociados al evento de registro de actividad");
        return;
    }
    
    const registroData = snap.data();
    const registroId = event.params.registroId;
    
    console.log(`⚡ Procesando notificación para registro de actividad: ${registroId}`);
    
    try {
        // Validar que tengamos los datos necesarios
        if (!registroData) {
            console.error("❌ No hay datos en el registro de actividad");
            return null;
        }
        
        // Extraer datos relevantes
        const alumnoId = registroData.alumnoId || "";
        const alumnoNombre = registroData.alumnoNombre || "Alumno";
        const profesorNombre = registroData.profesorNombre || "Profesor";
        const fecha = registroData.fecha ? new Date(registroData.fecha.seconds * 1000) : new Date();
        
        console.log(`📬 Registro actividad: Alumno=${alumnoNombre}, ID=${alumnoId}, Profesor=${profesorNombre}`);
        
        // Si no hay ID de alumno, no podemos continuar
        if (!alumnoId) {
            console.error("❌ El registro no tiene ID de alumno");
            return null;
        }
        
        // Buscar los familiares vinculados al alumno
        const vinculacionesSnapshot = await admin.firestore().collection("vinculaciones_familiar_alumno")
            .where("alumnoId", "==", alumnoId)
            .get();
        
        if (vinculacionesSnapshot.empty) {
            console.log(`⚠️ No hay familiares vinculados al alumno ${alumnoId}`);
            return null;
        }
        
        // Extraer IDs de los familiares
        const familiaresIds = [];
        vinculacionesSnapshot.forEach(doc => {
            const vinculacion = doc.data();
            if (vinculacion.familiarId) {
                familiaresIds.push(vinculacion.familiarId);
            }
        });
        
        if (familiaresIds.length === 0) {
            console.log("⚠️ No se encontraron IDs de familiares en las vinculaciones");
            return null;
        }
        
        console.log(`📤 Enviando notificación a ${familiaresIds.length} familiares: ${familiaresIds.join(", ")}`);
        
        // Obtener tokens FCM de los familiares
        let tokensToSend = [];
        let familiaresToNotify = [];
        
        // Primero intentar buscar por ID de documento (Firebase UID)
        try {
            const familiaresSnapshot = await admin.firestore().collection("usuarios")
                .where(admin.firestore.FieldPath.documentId(), "in", familiaresIds)
                .get();
            
            familiaresSnapshot.forEach(doc => {
                const familiarData = doc.data();
                familiaresToNotify.push({ id: doc.id, data: familiarData });
            });
        } catch (e) {
            console.log("No se encontraron usuarios por ID de documento, intentando por DNI...");
        }
        
        // Si no encontramos usuarios por ID, buscar por DNI
        if (familiaresToNotify.length === 0) {
            console.log("Buscando familiares por DNI...");
            for (const familiarId of familiaresIds) {
                try {
                    const usuarioSnapshot = await admin.firestore().collection("usuarios")
                        .where("dni", "==", familiarId)
                        .limit(1)
                        .get();
                    
                    if (!usuarioSnapshot.empty) {
                        const doc = usuarioSnapshot.docs[0];
                        familiaresToNotify.push({ id: doc.id, data: doc.data() });
                        console.log(`Familiar encontrado por DNI ${familiarId}: ${doc.id}`);
                    } else {
                        console.log(`No se encontró usuario con DNI: ${familiarId}`);
                    }
                } catch (e) {
                    console.error(`Error buscando usuario por DNI ${familiarId}:`, e);
                }
            }
        }
        
        // Extraer tokens FCM de los familiares encontrados
        familiaresToNotify.forEach(({ id, data: familiarData }) => {
            // Buscar en preferencias.notificaciones.fcmToken
            const preferencias = familiarData.preferencias || {};
            const notificaciones = preferencias.notificaciones || {};
            const fcmToken = notificaciones.fcmToken;
            
            if (fcmToken && typeof fcmToken === "string") {
                tokensToSend.push(fcmToken);
                console.log(`Token FCM encontrado en preferencias para familiar ${id}: ${fcmToken.substring(0, 20)}...`);
            }
            
            // También buscar en fcmTokens (formato alternativo)
            const fcmTokens = familiarData.fcmTokens || {};
            Object.values(fcmTokens).forEach(token => {
                if (token && typeof token === "string" && !tokensToSend.includes(token)) {
                    tokensToSend.push(token);
                    console.log(`Token FCM adicional encontrado para familiar ${id}: ${token.substring(0, 20)}...`);
                }
            });
            
            // Buscar en fcmToken a nivel raíz
            if (familiarData.fcmToken && typeof familiarData.fcmToken === "string" && !tokensToSend.includes(familiarData.fcmToken)) {
                tokensToSend.push(familiarData.fcmToken);
                console.log(`Token FCM encontrado a nivel raíz para familiar ${id}: ${familiarData.fcmToken.substring(0, 20)}...`);
            }
        });
        
        if (tokensToSend.length === 0) {
            console.log("❌ No se encontraron tokens FCM para ningún familiar");
            return null;
        }
        
        // Formatear la fecha para el mensaje
        const fechaFormateada = fecha.toLocaleDateString("es-ES", { 
            day: "2-digit", 
            month: "2-digit", 
            year: "numeric" 
        });
        
        // Preparar el mensaje de notificación
        const titulo = "Nuevo registro de actividad";
        const mensaje = `Se ha actualizado el registro de actividad de ${alumnoNombre} (${fechaFormateada})`;
        
        // Enviar notificaciones push usando FCM
        try {
            // Obtener el token de acceso para la API de FCM
            const accessToken = await admin.credential.applicationDefault().getAccessToken();
            
            // Enviar notificación a cada token individualmente
            const notificationPromises = tokensToSend.map(async (token) => {
                const fcmMessage = {
                    message: {
                        token: token,
                        notification: {
                            title: titulo,
                            body: mensaje
                        },
                        data: {
                            tipo: "registro_actividad",
                            registroId: registroId,
                            alumnoId: alumnoId,
                            alumnoNombre: alumnoNombre,
                            fecha: fechaFormateada,
                            click_action: "REGISTRO_ACTIVIDAD"
                        },
                        android: {
                            priority: "high",
                            notification: {
                                channel_id: "channel_registros_actividad"
                            }
                        },
                        apns: {
                            payload: {
                                aps: {
                                    alert: {
                                        title: titulo,
                                        body: mensaje
                                    },
                                    sound: "default"
                                }
                            }
                        }
                    }
                };
                
                const response = await fetch(`https://fcm.googleapis.com/v1/projects/umeegunero/messages:send`, {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${accessToken.access_token}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(fcmMessage)
                });
                
                if (!response.ok) {
                    const errorText = await response.text();
                    console.log(`Error enviando a token ${token.substring(0, 20)}...: ${response.status} - ${errorText}`);
                    return { success: false, token, error: errorText };
                }
                
                const result = await response.json();
                console.log(`Notificación de registro enviada exitosamente a token ${token.substring(0, 20)}...: ${result.name}`);
                return { success: true, token, result };
            });
            
            const results = await Promise.all(notificationPromises);
            
            // Calcular estadísticas de éxito
            const successCount = results.filter(r => r.success).length;
            const failureCount = results.filter(r => !r.success).length;
            
            console.log(`✅ Notificaciones enviadas: ${successCount} éxitos, ${failureCount} fallos`);
            
            return { 
                success: true, 
                message: "Notificaciones de registro de actividad enviadas", 
                stats: { success: successCount, failures: failureCount } 
            };
            
        } catch (error) {
            console.error("❌ Error al enviar notificaciones push:", error);
            return { success: false, error: error.message };
        }
        
    } catch (error) {
        console.error("❌ Error general en procesamiento de notificación de registro:", error);
        return { success: false, error: error.message };
    }
}); 