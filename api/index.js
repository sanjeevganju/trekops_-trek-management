import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import cookieSession from "cookie-session";
import { GoogleGenAI, Type } from "@google/genai";

console.log("API Index loading... ENV:", process.env.NODE_ENV);

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
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in environment variables.");
  }
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
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
  secure: isProd, 
  sameSite: 'lax', 
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
  const { fileUrl } = req.body;
  if (!fileUrl) return res.status(400).json({ error: "File URL is required" });

  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is missing in environment variables");
    return res.status(500).json({ error: "Gemini API Key is missing on the server. Please check Vercel environment variables." });
  }

  try {
    console.log("Starting Gemini extraction for:", fileUrl);
    
    // 1. Fetch the image
    const imageResponse = await fetch(fileUrl);
    if (!imageResponse.ok) throw new Error(`Failed to fetch image: ${imageResponse.statusText}`);
    
    const arrayBuffer = await imageResponse.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = imageResponse.headers.get("Content-Type") || "image/jpeg";

    // 2. Initialize Gemini
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    // 3. Call Gemini
    const result = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          parts: [
            { text: "Extract the items, quantities, and any prices from this list. Return the data as a JSON array of objects with keys: 'item' (string), 'quantity' (string), and 'unit_price' (number, optional). If a price is not found, omit the key. Focus on making the list clean and readable." },
            { inlineData: { data: base64Data, mimeType } }
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
      throw new Error("Gemini returned an empty response.");
    }

    const data = JSON.parse(result.text);
    console.log("Extraction successful, found items:", data.length);
    res.json({ data });
  } catch (error) {
    console.error("Extraction error:", error);
    res.status(500).json({ error: `AI Extraction failed: ${error.message}` });
  }
});

// Google OAuth Routes
app.get("/api/auth/google/url", (req, res) => {
  try {
    console.log("Request to /api/auth/google/url received");
    
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      console.error("MISSING GOOGLE CREDENTIALS in ENV");
      return res.status(500).json({ 
        error: "Server configuration error: Google Client ID or Secret is missing in environment variables." 
      });
    }

    // Force HTTPS in production, otherwise use request headers
    let appUrl = process.env.APP_URL;
    if (!appUrl) {
      const protocol = isProd ? 'https' : req.protocol;
      appUrl = `${protocol}://${req.get('host')}`;
    }
    
    const redirectUri = `${appUrl.replace(/\/$/, "")}/api/auth/google/callback`;
    
    console.log("Generating OAuth URL with redirectUri:", redirectUri);
    
    const client = getOAuth2Client();
    const url = client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      redirect_uri: redirectUri,
      prompt: 'select_account consent'
    });
    console.log("Generated URL starts with:", url.substring(0, 100));
    res.json({ url });
  } catch (error) {
    console.error("Error generating OAuth URL:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/auth/google/callback", async (req, res) => {
  const { code } = req.query;
  let appUrl = process.env.APP_URL;
  if (!appUrl) {
    const protocol = isProd ? 'https' : req.protocol;
    appUrl = `${protocol}://${req.get('host')}`;
  }
  const redirectUri = `${appUrl.replace(/\/$/, "")}/api/auth/google/callback`;
  console.log("Handling OAuth callback with redirect:", redirectUri);

  try {
    const client = getOAuth2Client();
    const { tokens } = await client.getToken({
      code: code,
      redirect_uri: redirectUri
    });
    console.log("Tokens received, setting session...");
    req.session.tokens = tokens;
    
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("OAuth error:", error);
    res.status(500).send("Authentication failed");
  }
});

app.get("/api/google/status", (req, res) => {
  const connected = !!req.session?.tokens;
  console.log("Checking Google status. Session ID:", req.session?.id, "Connected:", connected);
  res.json({ connected });
});

app.post("/api/google/save-list", async (req, res) => {
  if (!req.session?.tokens) {
    return res.status(401).json({ error: "Not connected to Google Drive" });
  }

  const { trekName, taskTitle, data } = req.body;
  if (!trekName || !data) {
    return res.status(400).json({ error: "Missing trek name or data" });
  }

  try {
    console.log("Starting Google Sheets sync for trek:", trekName, "task:", taskTitle);
    const client = getOAuth2Client();
    client.setCredentials(req.session.tokens);
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

// Vite middleware for development
if (!isProd) {
  const startDevServer = async () => {
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      const PORT = 3000;
      app.listen(PORT, "0.0.0.0", () => {
        console.log(`Server running on http://0.0.0.0:${PORT}`);
      });
    } catch (e) {
      console.error("Failed to start Vite server:", e);
    }
  };
  startDevServer();
}

export default app;
