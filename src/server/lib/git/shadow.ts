import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execAsync = promisify(exec);
// Resolve exact absolute workspace path relative to the NextJS root.
const SHADOW_DIR = path.resolve(process.cwd(), '.shadow-workspace');

export const ShadowGitServer = {
  
  /**
   * Idempotent initialization of the hidden Git filesystem
   */
  async init(): Promise<void> {
    if (!fs.existsSync(SHADOW_DIR)) {
      fs.mkdirSync(SHADOW_DIR);
    }
    
    try {
      // Check if git is initialized
      const hasGit = fs.existsSync(path.join(SHADOW_DIR, '.git'));
      if (!hasGit) {
        await execAsync('git init', { cwd: SHADOW_DIR });
        // Set up isolated user locally within the repo so global config isn't mandatory
        await execAsync('git config user.email "ai@agencyos.local"', { cwd: SHADOW_DIR });
        await execAsync('git config user.name "AgencyOS Autonomous Root"', { cwd: SHADOW_DIR });
      }
    } catch (error) {
      console.error('Failed to initialize Shadow Git:', error);
      throw error;
    }
  },

  /**
   * Commit specific modifications authored by particular LangGraph agents
   */
  async commitAction(agentName: string, message: string): Promise<string> {
    await this.init();
    try {
      await execAsync('git add .', { cwd: SHADOW_DIR });
      
      // Check if there are actually changes before attempting commit
      const { stdout: statusOut } = await execAsync('git status --porcelain', { cwd: SHADOW_DIR });
      if (!statusOut.trim()) {
         return 'No file changes detected, skipped commit.';
      }

      const commitMessage = `[Agent: ${agentName}] ${message}`;
      const escapedMessage = commitMessage.replace(/"/g, '\\"');
      
      const { stdout: commitOut } = await execAsync(`git commit -m "${escapedMessage}"`, { cwd: SHADOW_DIR });
      
      // Return the short hash for frontend tracking
      const { stdout: hashOut } = await execAsync('git rev-parse --short HEAD', { cwd: SHADOW_DIR });
      return hashOut.trim();
    } catch (error: any) {
      console.error(`Shadow Git Commit Error: ${error.message}`);
      throw error;
    }
  },

  /**
   * Retrieves array of commits to display in User Dashboards
   */
  async getHistory(): Promise<Array<{ hash: string, message: string, date: string }>> {
    await this.init();
    try {
      // Format: hash|message|date
      const { stdout } = await execAsync('git log --pretty=format:"%h|%s|%ad" --date=short -n 20', { cwd: SHADOW_DIR });
      
      if (!stdout.trim()) return [];
      
      return stdout.split('\n').map(line => {
        const [hash, message, date] = line.split('|');
        return { hash, message, date };
      });
    } catch (error: any) {
      // If repository has no commits yet, git log throws
      if (error.message.includes('does not have any commits yet')) return [];
      console.error(error);
      return [];
    }
  },

  /**
   * Total atomic reset to a previous point in history
   */
  async rollback(commitHash: string): Promise<boolean> {
    await this.init();
    try {
      await execAsync(`git reset --hard ${commitHash}`, { cwd: SHADOW_DIR });
      // Add a clean-up commit noting the human UI override 
      await execAsync('git commit --allow-empty -m "[Human Intervention] Restored to previous strategic state."', { cwd: SHADOW_DIR });
      return true;
    } catch(error) {
      console.error(error);
      return false;
    }
  }

};
