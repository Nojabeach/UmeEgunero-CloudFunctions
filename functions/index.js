// const functions = require("firebase-functions");
const {onDocumentCreated, onDocumentUpdated} = require("firebase-functions/v2/firestore");
// Importante: Necesitamos un módulo para hacer llamadas HTTP.
// 'node-fetch' es común, pero las Cloud Functions v2 tienen fetch global (experimental?)
// Para asegurar compatibilidad, usaremos node-fetch v2 (require).
// ¡Asegúrate de añadirlo a package.json!
const fetch = require("node-fetch");
const admin = require("firebase-admin");

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
const APPS_SCRIPT_MESSAGING_URL = "https://script.google.com/macros/s/AKfycbyCQGJcr25-Vt_2ueOgCWq_ATxX2FcxTKP8sT-WgdvvDlTUeLWlui52m7ScZOzsTx0Qjw/exec"; // Servicio de mensajería/notificaciones

// Define la función que se exportará para mensajes unificados
exports.notifyOnNewUnifiedMessage = onDocumentCreated("unified_messages/{messageId}", async (event) => {
  // En v2, el snapshot está en event.data
  const snap = event.data;
  if (!snap) {
    console.log("No data associated with the event");
    return;
  }
  const newMessage = snap.data();
  const messageId = event.params.messageId; // Obtener messageId de event.params

  console.log(`Nuevo mensaje unificado detectado [${messageId}]. Datos:`, JSON.stringify(newMessage));

  // Extraer datos necesarios
  const senderId = newMessage.senderId || null;
  const senderName = newMessage.senderName || "Usuario";
  
  // Dependiendo del tipo, asignaremos los destinatarios
  let participantsIds = [];
  
  // Si es un mensaje personal, solo notificar al receptor
  if (newMessage.receiverId && newMessage.receiverId !== "") {
    participantsIds.push(newMessage.receiverId);
  } 
  // Si es un mensaje grupal, notificar a todos los receptores
  if (Array.isArray(newMessage.receiversIds) && newMessage.receiversIds.length > 0) {
    // Agregar todos los IDs de receiversIds que no estén ya en participantsIds
    newMessage.receiversIds.forEach(id => {
      if (!participantsIds.includes(id)) {
        participantsIds.push(id);
      }
    });
  }
  
  // Filtrar el senderId de los participantes (no notificar al que envía)
  participantsIds = participantsIds.filter(id => id !== senderId);
  
  // Si no hay destinatarios después de filtrar, no enviar notificaciones
  if (participantsIds.length === 0) {
    console.log("Mensaje sin destinatarios válidos para notificar, no se enviarán notificaciones push");
    return;
  }
  
  const messageType = newMessage.type || "CHAT";
  const messageContent = newMessage.content || "";
  const messageTitle = newMessage.title || `Nuevo mensaje de ${senderName}`;
  const conversationId = newMessage.conversationId || "";

  // Construir el payload para Apps Script
  const payload = {
    messageId: messageId,
    senderId: senderId,
    participantsIds: participantsIds,
    messageType: messageType,
    messageContent: messageContent,
    messageTitle: messageTitle,
    conversationId: conversationId
  };

  // Validar que tenemos IDs de participantes
  if (!Array.isArray(participantsIds) || participantsIds.length === 0) {
    console.log(`Mensaje ${messageId} sin campo 'participantsIds' (Array) válido. No se llamará a Apps Script.`);
    return null;
  }

  // Validar que el mensaje tiene contenido
  if (!messageContent && messageType !== "SOLICITUD_VINCULACION") {
    console.log(`Mensaje ${messageId} sin contenido. No se llamará a Apps Script.`);
    return null;
  }

  try {
    console.log(`Llamando a Apps Script con payload:`, JSON.stringify(payload));
    
    // Realizar la llamada HTTP a Google Apps Script Web App
    const response = await fetch(APPS_SCRIPT_MESSAGING_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const responseData = await response.json();
    console.log(`Respuesta de Apps Script:`, JSON.stringify(responseData));
    
    return {success: true, data: responseData};
  } catch (error) {
    console.error(`Error al procesar mensaje unificado ${messageId}:`, error);
    return {success: false, error: error.message};
  }
});

// Define la función para mensajes regulares (compatibilidad con versión anterior)
exports.notifyOnNewMessage = onDocumentCreated("messages/{messageId}", async (event) => {
  // En v2, el snapshot está en event.data
  const snap = event.data;
  if (!snap) {
    console.log("No data associated with the event");
    return;
  }
  const newMessage = snap.data();
  const messageId = event.params.messageId; // Obtener messageId de event.params

  console.log(`Nuevo mensaje detectado [${messageId}]. Datos:`, JSON.stringify(newMessage));

  // Extraer datos necesarios para Apps Script
  // ¡VALIDA que estos campos existen en tu documento newMessage!
  const senderId = newMessage.senderId || null;
  // *** CRUCIAL: Asegúrate de que tus mensajes en Firestore tienen este Array/Lista ***
  const participantsIds = newMessage.participantsIds || [];
  const messageType = newMessage.type || "UNKNOWN";
  const messageContent = newMessage.content || "";
  // Genera un título si no existe en el mensaje
  const messageTitle = newMessage.title || (newMessage.senderName ? `Nuevo mensaje de ${newMessage.senderName}` : "Nuevo mensaje");

  // Construir el payload para Apps Script
  const payload = {
    messageId: messageId,
    senderId: senderId,
    participantsIds: participantsIds,
    messageType: messageType,
    messageContent: messageContent,
    messageTitle: messageTitle,
  };

  // Validar que tenemos IDs de participantes
  if (!Array.isArray(participantsIds) || participantsIds.length === 0) {
    console.log(`Mensaje ${messageId} sin campo 'participantsIds' (Array) válido. No se llamará a Apps Script.`);
    return null;
  }

  // Validar que el mensaje tiene contenido
  if (!messageContent) {
    console.log(`Mensaje ${messageId} sin contenido. No se llamará a Apps Script.`);
    return null;
  }

  try {
    console.log(`Llamando a Apps Script con payload:`, JSON.stringify(payload));
    
    // Realizar la llamada HTTP a Google Apps Script Web App
    const response = await fetch(APPS_SCRIPT_MESSAGING_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const responseData = await response.json();
    console.log(`Respuesta de Apps Script:`, JSON.stringify(responseData));
    
    return {success: true, data: responseData};
  } catch (error) {
    console.error(`Error al procesar mensaje ${messageId}:`, error);
    return {success: false, error: error.message};
  }
});

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

// Función auxiliar para determinar el canal de notificación según el tipo de mensaje
// Ya no se usa porque las notificaciones se envían a través del servicio GAS
/*
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
    case "NOTIFICATION":
    case "SYSTEM":
      return "channel_unified_communication";
    default:
      return "channel_general";
  }
}
*/

// Reexportar funciones de autenticación personalizada
exports.syncUserCustomClaims = syncUserCustomClaims;
exports.setUserClaimsById = setUserClaimsById;
exports.syncClaimsOnUserUpdate = syncClaimsOnUserUpdate;
exports.setClaimsOnNewUser = setClaimsOnNewUser; 