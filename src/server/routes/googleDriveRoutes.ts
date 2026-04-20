import express from 'express';
import { OAuth2Client } from 'google-auth-library';
import { initializeWorkspaceFolder } from '../../services/googleDriveService.ts';

export function registerGoogleDriveRoutes({ app, db, requireAuth, requireWorkspaceAccess }: any) {
  
  // 1b. Init — create the workspace Drive folder using the existing google_tokens (no new OAuth needed)
  app.post('/api/workspaces/:workspaceId/integrations/google/init', requireAuth, requireWorkspaceAccess, async (req: express.Request, res: express.Response) => {
    const { workspaceId } = req.params;
    try {
      // Look up workspace and owner's google tokens
      const workspace = await db.prepare('SELECT name, owner_id FROM workspaces WHERE id = ?').get(workspaceId) as any;
      if (!workspace) return res.status(404).json({ error: 'Workspace not found' });

      const tokenRow = await db.prepare('SELECT access_token, refresh_token, expiry_date FROM google_tokens WHERE user_id = ?').get(workspace.owner_id) as any;
      if (!tokenRow) return res.status(400).json({ error: 'Google Workspace not connected. Please connect Google first.' });

      const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
      const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
      const auth = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
      auth.setCredentials({
        access_token: tokenRow.access_token,
        refresh_token: tokenRow.refresh_token,
        expiry_date: tokenRow.expiry_date,
      });

      const folderId = await initializeWorkspaceFolder(auth, workspace.name || 'Workspace');

      await db.prepare('UPDATE workspaces SET google_folder_id = ? WHERE id = ?').run(folderId, workspaceId);

      res.json({ success: true, folderId });
    } catch (e: any) {
      console.error('[Google Drive /init] Error:', e);
      res.status(500).json({ error: e.message || 'Failed to initialize Drive folder' });
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
      SET google_folder_id = NULL
      WHERE id = ?
    `).run(workspaceId);
    res.json({ success: true });
  });

}
