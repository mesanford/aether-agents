import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

// These should eventually be placed in .env
// We mock them locally until real keys are provided as discussed.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'mock-client-id';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'mock-client-secret';
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5173/api/integrations/google/callback';

export const getOAuthClient = (redirectUri?: string): OAuth2Client => {
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    redirectUri || REDIRECT_URI
  );
};

export const generateAuthUrl = (stateString: string, redirectUri?: string): string => {
  const oauth2Client = getOAuthClient(redirectUri);
  return oauth2Client.generateAuthUrl({
    access_type: 'offline', // Request a refresh token
    prompt: 'consent', // Force consent prompt to ensure refresh token is always provided
    scope: [
      'https://www.googleapis.com/auth/drive.file', // Scoped only to files created by the app
      'https://www.googleapis.com/auth/drive.readonly', // Needed to read files added via the UI
    ],
    state: stateString,
  });
};

export const exchangeCodeForTokens = async (code: string, redirectUri?: string) => {
  const oauth2Client = getOAuthClient(redirectUri);
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
};

export const initializeWorkspaceFolder = async (auth: OAuth2Client, workspaceName: string): Promise<string> => {
  const drive = google.drive({ version: 'v3', auth });
  
  // Create a folder matching the workspace
  const folderMetadata = {
    name: `AgencyOS Knowledge - ${workspaceName}`,
    mimeType: 'application/vnd.google-apps.folder',
  };

  const file = await drive.files.create({
    requestBody: folderMetadata,
    fields: 'id',
  });

  return file.data.id || '';
};

export const searchFilesInFolder = async (auth: OAuth2Client, folderId: string, query: string) => {
  const drive = google.drive({ version: 'v3', auth });
  
  // Search within the specific folder ID for files matching the title or fulltext
  const res = await drive.files.list({
    q: `'${folderId}' in parents and (fullText contains '${query}' or name contains '${query}')`,
    fields: 'files(id, name, mimeType)',
    spaces: 'drive',
  });

  const files = res.data.files || [];
  
  const extractedContents = [];
  
  // For each matched file, extract text
  for (const f of files) {
    if (!f.id) continue;
    try {
      let content = '';
      if (f.mimeType === 'application/vnd.google-apps.document') {
        const exported = await drive.files.export({ fileId: f.id, mimeType: 'text/plain' });
        content = exported.data as string;
      } else if (f.mimeType === 'text/plain') {
        const stream = await drive.files.get({ fileId: f.id, alt: 'media' });
        content = stream.data as string;
      }
      // Note: PDFs require parsing, which Google Drive handles partly in export but we skip for brevity
      if (content) {
        extractedContents.push(`--- File: ${f.name} ---\n${content.substring(0, 3000)}\...`);
      }
    } catch (e) {
      console.warn(`Failed to export content for ${f.name}`, e);
    }
  }

  return extractedContents;
};
