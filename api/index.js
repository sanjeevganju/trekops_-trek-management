import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import cookieSession from "cookie-session";
import { GoogleGenAI, Type } from "@google/genai";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import "dotenv/config";
import fs from "fs";

// Load Firebase config from file if it exists
let firebaseConfig = {};
try {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  console.log("Checking for config at:", configPath);
  if (fs.existsSync(configPath)) {
    console.log("Config file exists, reading...");
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    console.log("Config loaded for project:", firebaseConfig.projectId);
  } else {
    console.log("Config file NOT found at:", configPath);
  }
} catch (err) {
  console.error("Error reading firebase-applet-config.json:", err);
}

import { initializeApp as initializeClientApp } from "firebase/app";
import { getFirestore as getClientFirestore, doc as clientDoc, setDoc as clientSetDoc } from "firebase/firestore";

// Initialize Firebase Admin (still needed for some things, but we'll use Client SDK for Firestore)
let db;
let clientDb;
const BACKEND_SECRET = "trekops-backend-secret-2026";

try {
  const targetProjectId = firebaseConfig.projectId || "gen-lang-client-0186576617";
  const targetDatabaseId = firebaseConfig.firestoreDatabaseId || "ai-studio-64d8079d-e23a-4f66-930e-d71d16f15d38";

  console.log("--- Firebase Backend Init ---");
  
  // Admin SDK Init (Keep it for potential future use)
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: targetProjectId });
  }
  db = getFirestore(admin.app(), targetDatabaseId !== '(default)' ? targetDatabaseId : undefined);

  // Client SDK Init - THIS WORKS where Admin SDK is failing
  const clientApp = initializeClientApp(firebaseConfig);
  clientDb = getClientFirestore(clientApp, targetDatabaseId !== '(default)' ? targetDatabaseId : undefined);

  // Startup test
  (async () => {
    try {
      console.log("Running backend startup test (Client SDK)...");
      await clientSetDoc(clientDoc(clientDb, "system_status", "backend"), {
        last_startup: new Date().toISOString(),
        status: "online",
        secret: BACKEND_SECRET // Used for rule validation
      });
      console.log("Backend startup test: SUCCESS");
      await logDebug("Backend started successfully");
    } catch (err) {
      console.error("Backend startup test: FAILED", err.message);
    }
  })();
} catch (err) {
  console.error("CRITICAL: Firebase initialization failed:", err);
}

// Helper to log debug info to Firestore
async function logDebug(message, type = "info", data = {}) {
  if (!clientDb) return;
  try {
    const { collection: cColl, addDoc: cAdd } = await import("firebase/firestore");
    await cAdd(cColl(clientDb, "debug_logs"), {
      message,
      type,
      data,
      timestamp: new Date().toISOString(),
      secret: BACKEND_SECRET
    });
  } catch (err) {
    console.error("Failed to log debug info:", err.message);
  }
}

console.log("API Index loading... ENV:", process.env.NODE_ENV);
console.log("APP_URL:", process.env.APP_URL);
console.log("GOOGLE_CLIENT_ID exists:", !!process.env.GOOGLE_CLIENT_ID);

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets'
];

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SEC;
  
  if (process.env.GOOGLE_CLIENT_SEC && !process.env.GOOGLE_CLIENT_SECRET) {
    console.log("Using GOOGLE_CLIENT_SEC as fallback for GOOGLE_CLIENT_SECRET");
  }

  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in environment variables.");
  }
  return new google.auth.OAuth2(clientId, clientSecret);
}

const app = express();
const isProd = process.env.NODE_ENV === 'production';

// Essential for Vercel/Proxies to handle HTTPS and Cookies correctly
app.set('trust proxy', 1);

app.use(express.json());

// Session middleware MUST be before routes
app.use(cookieSession({
  name: 'trekops_session',
  keys: [process.env.SESSION_SECRET || 'trek-ops-permanent-secret-2026-xyz-987'],
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
  secure: true, // Required for SameSite=None in iframes
  sameSite: 'none', // Required for cross-origin iframe context
  httpOnly: true,
}));

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", env: process.env.NODE_ENV });
});

// Proxy route to bypass CORS for image scanning
app.get("/api/proxy-image", async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) return res.status(400).send("URL is required");
  
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    res.set("Content-Type", response.headers.get("Content-Type") || "image/jpeg");
    res.set("Access-Control-Allow-Origin", "*");
    res.send(buffer);
  } catch (error) {
    console.error("Proxy error:", error);
    res.status(500).send("Failed to proxy image");
  }
});

// Gemini Data Extraction Route
app.post("/api/extract-data", async (req, res) => {
  const { fileUrl, fileUrls } = req.body;
  const urls = fileUrls || (fileUrl ? [fileUrl] : []);
  
  console.log("--- EXTRACTION REQUEST START ---");
  console.log("URLs received:", urls);

  if (urls.length === 0) {
    console.warn("No URLs provided in request");
    return res.status(400).json({ error: "File URL is required" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.length < 5 || apiKey.includes("TODO")) {
    console.error("CRITICAL: GEMINI_API_KEY is missing or invalid");
    return res.status(500).json({ 
      error: "Gemini API Key is missing. Please click the Gear icon (Settings) in AI Studio and ensure an API Key is selected." 
    });
  }

  try {
    // 1. Fetch all images and convert to base64
    console.log("Fetching images...");
    const imageParts = await Promise.all(urls.map(async (url, index) => {
      try {
        console.log(`Fetching image ${index + 1}/${urls.length}: ${url}`);
        const imageResponse = await fetch(url);
        if (!imageResponse.ok) {
          throw new Error(`HTTP ${imageResponse.status}: ${imageResponse.statusText}`);
        }
        
        const arrayBuffer = await imageResponse.arrayBuffer();
        const base64Data = Buffer.from(arrayBuffer).toString('base64');
        const mimeType = imageResponse.headers.get("Content-Type") || "image/jpeg";
        
        console.log(`Successfully fetched image ${index + 1}. MimeType: ${mimeType}, Size: ${arrayBuffer.byteLength} bytes`);
        
        return {
          inlineData: { data: base64Data, mimeType }
        };
      } catch (fetchErr) {
        console.error(`Failed to fetch image ${index + 1}:`, fetchErr.message);
        await logDebug(`Failed to fetch image ${index + 1}`, "error", { url, error: fetchErr.message });
        throw new Error(`Failed to fetch image ${index + 1}: ${fetchErr.message}`);
      }
    }));

    // 2. Initialize Gemini
    console.log("Initializing Gemini SDK...");
    const ai = new GoogleGenAI({ apiKey });
    
    // 3. Call Gemini
    console.log("Calling Gemini API (gemini-3-flash-preview)...");
    await logDebug("Calling Gemini API", "info", { model: "gemini-3-flash-preview", imageCount: imageParts.length });
    
    const result = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          parts: [
            { text: "Extract the items, quantities, and any prices from these lists/images. Return the data as a single combined JSON array of objects with keys: 'item' (string), 'quantity' (string), and 'unit_price' (number, optional). If a price is not found, omit the key. Focus on making the list clean and readable. Combine duplicates if they are clearly the same item." },
            ...imageParts
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              item: { type: Type.STRING },
              quantity: { type: Type.STRING },
              unit_price: { type: Type.NUMBER }
            },
            required: ["item", "quantity"]
          }
        }
      }
    });

    if (!result.text) {
      console.error("Gemini returned no text content");
      await logDebug("Gemini returned empty response", "error");
      throw new Error("Gemini returned an empty response.");
    }

    console.log("Gemini response received. Parsing JSON...");
    const data = JSON.parse(result.text);
    console.log("Extraction successful, found items:", data.length);
    console.log("--- EXTRACTION REQUEST SUCCESS ---");
    await logDebug("Extraction successful", "success", { itemCount: data.length });
    res.json({ data });
  } catch (error) {
    console.error("--- EXTRACTION REQUEST FAILED ---");
    console.error("Error details:", error);
    
    let errorMessage = error.message || "Unknown error during AI extraction";
    
    // Try to parse Gemini specific errors if they are JSON strings
    try {
      if (errorMessage.includes('{')) {
        const jsonStart = errorMessage.indexOf('{');
        const jsonStr = errorMessage.substring(jsonStart);
        const parsed = JSON.parse(jsonStr);
        if (parsed.error?.message) {
          errorMessage = parsed.error.message;
        }
      }
    } catch (e) {
      // Not JSON, keep original message
    }

    await logDebug("Extraction failed", "error", { error: errorMessage });
    res.status(500).json({ error: errorMessage });
  }
});

// Google OAuth Routes
app.get("/api/auth/google/url", (req, res) => {
  try {
    const { userId } = req.query;
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return res.status(500).json({ 
        error: "Server configuration error: Google Client ID or Secret is missing." 
      });
    }

    let appUrl = process.env.APP_URL;
    if (!appUrl) {
      const host = req.get('host');
      const isAiStudio = host.includes('run.app') || host.includes('google.com');
      const protocol = (isProd || isAiStudio) ? 'https' : req.protocol;
      appUrl = `${protocol}://${host}`;
    }
    
    const redirectUri = `${appUrl.replace(/\/$/, "")}/api/auth/google/callback`;
    
    const client = getOAuth2Client();
    const url = client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      redirect_uri: redirectUri,
      prompt: 'select_account consent',
      state: userId
    });
    res.json({ url });
  } catch (error) {
    console.error("Error generating OAuth URL:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/auth/google/callback", async (req, res) => {
  const { code, state: userId } = req.query;
  
  let appUrl = process.env.APP_URL;
  if (!appUrl) {
    const host = req.get('host');
    const isAiStudio = host.includes('run.app') || host.includes('google.com');
    const protocol = (isProd || isAiStudio) ? 'https' : req.protocol;
    appUrl = `${protocol}://${host}`;
  }
  const redirectUri = `${appUrl.replace(/\/$/, "")}/api/auth/google/callback`;

  try {
    const client = getOAuth2Client();
    const { tokens } = await client.getToken({
      code: code,
      redirect_uri: redirectUri
    });
    
    req.session.tokens = tokens;
    
    await logDebug("OAuth Callback Success", { userId, hasTokens: !!tokens });

    // Save tokens to Firestore from backend for reliability
    if (userId && userId !== "undefined" && clientDb) {
      const { doc: cDoc, setDoc: cSet } = await import("firebase/firestore");
      try {
        await cSet(cDoc(clientDb, "users", userId), {
          google_auth: tokens,
          updatedAt: new Date().toISOString(),
          secret: BACKEND_SECRET // For rule validation
        }, { merge: true });
        console.log(`Successfully saved Google tokens to Firestore for user: ${userId}`);
        await logDebug("Tokens saved to Firestore", { userId });
      } catch (dbErr) {
        console.error("Error saving tokens to Firestore from backend:", dbErr.message);
        await logDebug("Error saving tokens", { userId, error: dbErr.message });
      }
    }
    
    res.send(`
      <html>
        <head>
          <title>Authentication Successful</title>
          <style>
            body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f9fafb; }
            .card { background: white; padding: 2rem; border-radius: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); text-align: center; }
          </style>
        </head>
        <body>
          <div class="card">
            <div id="status">Connection Successful! Closing...</div>
          </div>
          <script>
            if (window.opener) {
              // Send message to parent
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
              
              // Try to trigger a manual refresh in the parent if it has the function
              try {
                if (window.opener.checkGoogleStatus) {
                  window.opener.checkGoogleStatus();
                }
              } catch (e) {}

              setTimeout(() => window.close(), 1000);
            } else {
              window.location.href = '/';
            }
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("OAuth error:", error);
    res.status(500).send("Authentication failed");
  }
});

app.post("/api/debug/clear", async (req, res) => {
  if (!clientDb) return res.status(500).json({ error: "Firestore not initialized" });
  try {
    const { collection: cColl, getDocs: cGet, deleteDoc: cDel, writeBatch: cBatch } = await import("firebase/firestore");
    const snapshot = await cGet(cColl(clientDb, "debug_logs"));
    const batch = cBatch(clientDb);
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to clear logs:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/google/status", async (req, res) => {
  const { userId } = req.query;
  let connected = !!req.session?.tokens;
  
  if (!connected && userId && clientDb) {
    try {
      const { doc: cDoc, getDoc: cGetDoc } = await import("firebase/firestore");
      const userDoc = await cGetDoc(cDoc(clientDb, "users", userId));
      if (userDoc.exists() && userDoc.data().google_auth) {
        connected = true;
        // Sync to session for future requests if possible
        req.session.tokens = userDoc.data().google_auth;
      }
    } catch (err) {
      console.error(`Error checking Firestore for tokens:`, err.message);
    }
  }
  
  res.json({ connected });
});

app.post("/api/google/save-list", async (req, res) => {
  const { userId, trekName, taskTitle, data } = req.body;
  let tokens = req.session?.tokens;
  
  if (!tokens && userId && clientDb) {
    try {
      const { doc: cDoc, getDoc: cGetDoc } = await import("firebase/firestore");
      const userDoc = await cGetDoc(cDoc(clientDb, "users", userId));
      if (userDoc.exists() && userDoc.data().google_auth) {
        tokens = userDoc.data().google_auth;
      }
    } catch (err) {
      console.error(`Error fetching tokens from Firestore:`, err.message);
    }
  }

  if (!tokens) {
    return res.status(401).json({ error: "Not connected to Google Drive" });
  }

  if (!trekName || !data) {
    return res.status(400).json({ error: "Missing trek name or data" });
  }

  try {
    console.log("Starting Google Sheets sync for trek:", trekName, "task:", taskTitle);
    const client = getOAuth2Client();
    client.setCredentials(tokens);
    const drive = google.drive({ version: 'v3', auth: client });
    const sheets = google.sheets({ version: 'v4', auth: client });

    // 1. Find or create "Trek Ops App" folder
    let folderId;
    console.log("Searching for 'Trek Ops App' folder...");
    const folderResponse = await drive.files.list({
      q: "name = 'Trek Ops App' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
      fields: 'files(id)',
      spaces: 'drive'
    });

    if (folderResponse.data.files && folderResponse.data.files.length > 0) {
      folderId = folderResponse.data.files[0].id;
      console.log("Found existing folder:", folderId);
    } else {
      console.log("Creating new 'Trek Ops App' folder...");
      const folderMetadata = {
        name: 'Trek Ops App',
        mimeType: 'application/vnd.google-apps.folder'
      };
      const folder = await drive.files.create({
        requestBody: folderMetadata,
        fields: 'id'
      });
      folderId = folder.data.id;
      console.log("Created folder:", folderId);
    }

    // 2. Find or create Sheet for this specific task inside the folder
    let sheetId;
    const sheetName = `${trekName} - ${taskTitle}`;
    console.log(`Searching for spreadsheet '${sheetName}' in folder ${folderId}...`);
    const sheetResponse = await drive.files.list({
      q: `name = '${sheetName}' and '${folderId}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
      fields: 'files(id)',
      spaces: 'drive'
    });

    if (sheetResponse.data.files && sheetResponse.data.files.length > 0) {
      sheetId = sheetResponse.data.files[0].id;
      console.log("Found existing spreadsheet:", sheetId);
    } else {
      console.log("Creating new spreadsheet:", sheetName);
      const sheetMetadata = {
        name: sheetName,
        mimeType: 'application/vnd.google-apps.spreadsheet',
        parents: [folderId]
      };
      const sheet = await drive.files.create({
        requestBody: sheetMetadata,
        fields: 'id'
      });
      sheetId = sheet.data.id;
      console.log("Created spreadsheet:", sheetId);

      // Add headers to the new sheet
      console.log("Adding headers to new sheet...");
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: 'Sheet1!A1',
        valueInputOption: 'RAW',
        requestBody: {
          values: [['Task', 'Item', 'Quantity', 'Price', 'Scanned At']]
        }
      });
    }

    // 3. Append data to the sheet
    console.log("Appending data rows...");
    const values = data.map((row) => [
      taskTitle,
      row.item || '-',
      row.quantity || '-',
      row.unit_price || '-',
      new Date().toLocaleString()
    ]);

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Sheet1!A1',
      valueInputOption: 'RAW',
      requestBody: { values }
    });

    console.log("Sync completed successfully!");
    res.json({ success: true, sheetId });
  } catch (error) {
    console.error("Google Sheets error detail:", error);
    res.status(500).json({ error: `Failed to save to Google Sheets: ${error.message}` });
  }
});

// Vite middleware for development or Static serving for production
if (!isProd) {
  const startDevServer = async () => {
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      app.listen(3000, "0.0.0.0", () => {
        console.log("Dev server running on http://0.0.0.0:3000");
      });
    } catch (e) {
      console.error("Failed to start Vite server:", e);
    }
  };
  startDevServer();
} else {
  // Production: Serve static files from 'dist'
  const distPath = path.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(distPath, "index.html"));
  });

  app.listen(3000, "0.0.0.0", () => {
    console.log("Production server running on port 3000");
  });
}

export default app;
