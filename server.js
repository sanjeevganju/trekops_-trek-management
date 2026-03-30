import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { google } from "googleapis";
import cookieSession from "cookie-session";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  // The redirect URI will be constructed dynamically in the routes
);

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets'
];

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Essential for Vercel/Proxies to handle HTTPS and Cookies correctly
  app.set('trust proxy', 1);

  const isProd = process.env.NODE_ENV === 'production';
  
  app.use(express.json());
  app.use(cookieSession({
    name: 'trekops_session',
    keys: [process.env.SESSION_SECRET || 'trek-ops-secret-key-2026'],
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    secure: isProd, 
    sameSite: 'lax', // Changed from 'none' to 'lax' for better Vercel compatibility
    httpOnly: true,
  }));

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

  // Google OAuth Routes
  app.get("/api/auth/google/url", (req, res) => {
    // Use the APP_URL provided by the environment, fallback to request headers
    const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const redirectUri = `${appUrl.replace(/\/$/, "")}/api/auth/google/callback`;
    
    console.log("Generating OAuth URL with redirectUri:", redirectUri);
    console.log("APP_URL env:", process.env.APP_URL);
    console.log("Protocol:", req.protocol);
    console.log("Host:", req.get('host'));
    
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      redirect_uri: redirectUri,
      prompt: 'select_account consent'
    });
    res.json({ url });
  });

  app.get("/api/auth/google/callback", async (req, res) => {
    const { code } = req.query;
    const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const redirectUri = `${appUrl.replace(/\/$/, "")}/api/auth/google/callback`;
    console.log("Handling OAuth callback with redirect:", redirectUri);

    try {
      const { tokens } = await oauth2Client.getToken({
        code: code,
        redirect_uri: redirectUri
      });
      console.log("Tokens received, setting session...");
      req.session.tokens = tokens;
      console.log("Session tokens set. Session ID:", req.session?.id);
      
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
      oauth2Client.setCredentials(req.session.tokens);
      const drive = google.drive({ version: 'v3', auth: oauth2Client });
      const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

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

      // 2. Find or create Sheet for this trek inside the folder
      let sheetId;
      console.log(`Searching for spreadsheet '${trekName}' in folder ${folderId}...`);
      const sheetResponse = await drive.files.list({
        q: `name = '${trekName}' and '${folderId}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
        fields: 'files(id)',
        spaces: 'drive'
      });

      if (sheetResponse.data.files && sheetResponse.data.files.length > 0) {
        sheetId = sheetResponse.data.files[0].id;
        console.log("Found existing spreadsheet:", sheetId);
      } else {
        console.log("Creating new spreadsheet:", trekName);
        const sheetMetadata = {
          name: trekName,
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
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files from the 'dist' directory
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
