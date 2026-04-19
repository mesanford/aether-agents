import express from 'express';
import { generateAuthUrl, exchangeCodeForTokens, initializeWorkspaceFolder, getOAuthClient } from '../../services/googleDriveService.ts';

export function registerGoogleDriveRoutes({ app, db, requireAuth, requireWorkspaceAccess }: any) {
  
  // 1. Kickoff the Auth Flow
  app.get('/api/workspaces/:workspaceId/integrations/google/auth', requireAuth, requireWorkspaceAccess, async (req: express.Request, res: express.Response) => {
    const { workspaceId } = req.params;
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const redirectUri = `${baseUrl}/api/integrations/google/callback`;
    const state = JSON.stringify({ workspaceId });
    const url = generateAuthUrl(state, redirectUri);
    res.json({ url });
  });

  // 2. Handle the Callbacks
  app.get('/api/integrations/google/callback', async (req: express.Request, res: express.Response) => {
    try {
      const { code, state } = req.query;
      if (!code || !state) {
        throw new Error('Missing code or state');
      }

      const { workspaceId } = JSON.parse(state as string);

      // Reconstruct the same redirect URI used when generating the auth URL
      const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
      const redirectUri = `${baseUrl}/api/integrations/google/callback`;

      const tokens = await exchangeCodeForTokens(code as string, redirectUri);

      // Build an auth client with the returned tokens to initialize the folder
      const auth = getOAuthClient(redirectUri);
      auth.setCredentials(tokens);

      const workspace = await db.prepare('SELECT name FROM workspaces WHERE id = ?').get(workspaceId);
      const workspaceName = workspace?.name || 'Workspace';

      const folderId = await initializeWorkspaceFolder(auth, workspaceName);

      // Save everything
      await db.prepare(`
        UPDATE workspaces 
        SET google_access_token = ?, google_refresh_token = ?, google_folder_id = ?, google_token_expiry = ?
        WHERE id = ?
      `).run(tokens.access_token, tokens.refresh_token, folderId, tokens.expiry_date, workspaceId);

      // Redirect back to frontend
      res.redirect(`/?workspaceId=${workspaceId}&drive_connected=true`);
    } catch (e) {
      console.error(e);
      res.redirect(`/?error=GoogleConnectFailed`);
    }
  });

  // 3. Status check
  app.get('/api/workspaces/:workspaceId/integrations/google/status', requireAuth, requireWorkspaceAccess, async (req: express.Request, res: express.Response) => {
    const { workspaceId } = req.params;
    const workspace = await db.prepare('SELECT google_folder_id FROM workspaces WHERE id = ?').get(workspaceId);
    
    if (workspace?.google_folder_id) {
      res.json({ connected: true, folderId: workspace.google_folder_id });
    } else {
      res.json({ connected: false });
    }
  });

  // 4. Disconnect
  app.delete('/api/workspaces/:workspaceId/integrations/google', requireAuth, requireWorkspaceAccess, async (req: express.Request, res: express.Response) => {
    const { workspaceId } = req.params;
    db.prepare(`
      UPDATE workspaces 
      SET google_access_token = NULL, google_refresh_token = NULL, google_folder_id = NULL, google_token_expiry = NULL
      WHERE id = ?
    `).run(workspaceId);
    res.json({ success: true });
  });

}
