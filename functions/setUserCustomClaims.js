const functions = require("firebase-functions");
const admin = require("firebase-admin");

// No inicializamos Firebase Admin aquí, ya se inicializa en index.js

/**
 * Cloud Function HTTP para establecer custom claims a usuarios basados en sus datos en Firestore
 * Esta función debe ser llamada por un administrador
 */
exports.syncUserCustomClaims = functions.https.onRequest(async (req, res) => {
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
  
  // Verificar clave API para proteger la función
  const { apiKey } = req.body;
  const EXPECTED_API_KEY = process.env.ADMIN_API_KEY || "clave-secreta-para-produccion";
  
  if (apiKey !== EXPECTED_API_KEY) {
    res.status(401).json({ 
      success: false, 
      error: "API Key inválida" 
    });
    return;
  }
  
  try {
    console.log("🔄 Iniciando sincronización de custom claims...");
    
    // Obtener todos los usuarios de Firestore
    const snapshot = await admin.firestore().collection("usuarios").get();
    
    if (snapshot.empty) {
      console.log("❌ No se encontraron usuarios en Firestore");
      res.status(404).json({ 
        success: false, 
        error: "No se encontraron usuarios"
      });
      return;
    }
    
    console.log(`✅ Se encontraron ${snapshot.size} usuarios en Firestore`);
    
    const updatePromises = [];
    const successUpdates = [];
    const failedUpdates = [];
    
    // Procesar cada usuario
    snapshot.forEach(doc => {
      const userData = doc.data();
      const dni = userData.dni;
      const firebaseUid = userData.firebaseUid;
      
      // Verificar que tiene un UID de Firebase
      if (!firebaseUid || firebaseUid.trim() === "") {
        console.log(`⚠️ Usuario ${dni} no tiene firebaseUid, saltando...`);
        failedUpdates.push({
          dni,
          error: "No tiene firebaseUid"
        });
        return;
      }
      
      // Determinar roles del usuario
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
      
      console.log(`🔑 Estableciendo claims para ${dni} (${firebaseUid}):`, JSON.stringify(customClaims));
      
      // Agregar promesa para actualizar claims
      const updatePromise = admin.auth().setCustomUserClaims(firebaseUid, customClaims)
        .then(() => {
          console.log(`✅ Claims actualizados para ${dni}`);
          successUpdates.push({
            dni,
            firebaseUid,
            claims: customClaims
          });
          return true;
        })
        .catch((error) => {
          console.error(`❌ Error al actualizar claims para ${dni}:`, error);
          failedUpdates.push({
            dni,
            firebaseUid,
            error: error.message
          });
          return false;
        });
      
      updatePromises.push(updatePromise);
    });
    
    // Esperar a que todas las actualizaciones terminen
    await Promise.all(updatePromises);
    
    console.log(`🎉 Sincronización completa. Éxitos: ${successUpdates.length}, Fallos: ${failedUpdates.length}`);
    
    res.status(200).json({
      success: true,
      totalProcessed: snapshot.size,
      successCount: successUpdates.length,
      failureCount: failedUpdates.length,
      successUpdates: successUpdates,
      failedUpdates: failedUpdates
    });
    
  } catch (error) {
    console.error("❌ Error general:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * Cloud Function HTTPS para establecer custom claims a un solo usuario
 */
exports.setUserClaimsById = functions.https.onCall(async (data, context) => {
  // Verificar autenticación y permisos
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated", 
      "La función requiere autenticación"
    );
  }
  
  // Solo permitir a administradores
  if (!context.auth.token.isAdmin && !context.auth.token.isAdminApp) {
    throw new functions.https.HttpsError(
      "permission-denied", 
      "Requiere privilegios de administrador"
    );
  }
  
  const { uid, dni, isProfesor, isAdmin, isAdminApp } = data;
  
  if (!uid) {
    throw new functions.https.HttpsError(
      "invalid-argument", 
      "Se requiere el UID del usuario"
    );
  }
  
  try {
    // Crear objeto con los claims
    const customClaims = {
      dni: dni || "",
      isProfesor: isProfesor || false,
      isAdmin: isAdmin || false,
      isAdminApp: isAdminApp || false
    };
    
    // Establecer custom claims
    await admin.auth().setCustomUserClaims(uid, customClaims);
    
    console.log(`Custom claims establecidos para usuario ${uid}:`, customClaims);
    
    return {
      success: true,
      message: `Claims actualizados para usuario ${uid}`,
      claims: customClaims
    };
  } catch (error) {
    console.error(`Error al establecer custom claims:`, error);
    throw new functions.https.HttpsError(
      "internal", 
      `Error al establecer custom claims: ${error.message}`
    );
  }
});

// Función para mantener sincronizados los claims automáticamente cuando se actualiza un usuario
exports.syncClaimsOnUserUpdate = functions.firestore
  .document("usuarios/{userId}")
  .onUpdate(async (change, context) => {
    const userId = context.params.userId;
    const afterData = change.after.data();
    const beforeData = change.before.data();
    
    // Si el firebaseUid no existe o está vacío, no podemos hacer nada
    if (!afterData.firebaseUid || afterData.firebaseUid.trim() === "") {
      console.log(`Usuario ${userId} no tiene firebaseUid, saltando...`);
      return null;
    }
    
    // Verificar si los perfiles han cambiado
    const beforePerfiles = JSON.stringify(beforeData.perfiles || []);
    const afterPerfiles = JSON.stringify(afterData.perfiles || []);
    
    if (beforePerfiles === afterPerfiles && beforeData.dni === afterData.dni) {
      console.log(`No hay cambios en perfiles o DNI para usuario ${userId}, saltando...`);
      return null;
    }
    
    // Determinar roles basados en perfiles
    const perfiles = afterData.perfiles || [];
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
      dni: afterData.dni,
      isProfesor: isProfesor,
      isAdmin: isAdmin,
      isAdminApp: isAdminApp
    };
    
    try {
      // Actualizar custom claims
      await admin.auth().setCustomUserClaims(afterData.firebaseUid, customClaims);
      console.log(`Claims actualizados automáticamente para ${afterData.dni} (${afterData.firebaseUid}):`, customClaims);
      return { success: true };
    } catch (error) {
      console.error(`Error al actualizar claims para ${afterData.dni}:`, error);
      return { success: false, error: error.message };
    }
  });

// Función para establecer claims cuando se crea un nuevo usuario
exports.setClaimsOnNewUser = functions.firestore
  .document("usuarios/{userId}")
  .onCreate(async (snap, context) => {
    const userId = context.params.userId;
    const userData = snap.data();
    
    // Si el firebaseUid no existe o está vacío, no podemos hacer nada
    if (!userData.firebaseUid || userData.firebaseUid.trim() === "") {
      console.log(`Nuevo usuario ${userId} no tiene firebaseUid, saltando...`);
      return null;
    }
    
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
      dni: userData.dni,
      isProfesor: isProfesor,
      isAdmin: isAdmin,
      isAdminApp: isAdminApp
    };
    
    try {
      // Establecer custom claims
      await admin.auth().setCustomUserClaims(userData.firebaseUid, customClaims);
      console.log(`Claims establecidos para nuevo usuario ${userData.dni} (${userData.firebaseUid}):`, customClaims);
      return { success: true };
    } catch (error) {
      console.error(`Error al establecer claims para nuevo usuario ${userData.dni}:`, error);
      return { success: false, error: error.message };
    }
  }); 