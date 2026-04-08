import { Storage } from '@google-cloud/storage';
import type Database from "better-sqlite3";

// Determine if we are running with valid Google Cloud credentials in the environment
const bucketName = process.env.GCS_MEDIA_BUCKET_NAME || 'agencyos-media-bucket';

let storage: Storage;
try {
  storage = new Storage();
} catch (e) {
  console.warn('[GCP Storage] Initialized without explicit credentials.');
  storage = new Storage();
}

/**
 * Helper to identify if a path in the database is an internal GCS reference.
 */
export const isGcsPath = (path: string) => path.startsWith('gcs://');

/**
 * Uploads a raw base64 data string to Google Cloud Storage.
 * @returns the internal GCS string reference, e.g. "gcs://workspace_123/12345.png"
 */
export async function uploadBase64ToGCS(base64String: string, workspaceId: number | string, fileExtension: string = 'png'): Promise<string> {
  const bucket = storage.bucket(bucketName);
  
  // Strip the URI prefix (e.g., "data:image/png;base64,") before converting to Buffer
  const base64Data = base64String.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Data, 'base64');
  
  const fileName = `workspace_${workspaceId}/${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileExtension}`;
  const file = bucket.file(fileName);
  
  await file.save(buffer, {
    metadata: {
      contentType: `image/${fileExtension}`,
      cacheControl: 'public, max-age=31536000',
    },
  });
  
  return `gcs://${fileName}`;
}

/**
 * Converts a "gcs://..." reference into a time-limited Signed URL.
 * Returns the original string if it is already a standard http URL.
 */
export async function getSignedUrlForGcs(gcsPath: string): Promise<string> {
  if (!isGcsPath(gcsPath)) return gcsPath;
  
  const fileName = gcsPath.replace('gcs://', '');
  
  try {
    const [url] = await storage.bucket(bucketName).file(fileName).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 12 * 60 * 60 * 1000, // 12 hours from now
    });
    return url;
  } catch (err: any) {
    console.warn(`[GCP Storage] Failed to sign URL for ${fileName}. Ensure GCP credentials are active: ${err.message}`);
    // Fallback for local development if credentials aren't set up yet
    return 'https://placehold.co/600x400/png?text=GCP+Mock+Image';
  }
}

/**
 * Deletes a file from the bucket based on its internal GCS reference.
 */
export async function deleteGCSFile(gcsPath: string): Promise<void> {
  if (!isGcsPath(gcsPath)) return;
  const fileName = gcsPath.replace('gcs://', '');
  
  try {
    await storage.bucket(bucketName).file(fileName).delete();
  } catch (err: any) {
    if (err.code !== 404) {
      console.warn(`[GCP Storage] Failed to delete GCS file ${fileName}:`, err.message);
    }
  }
}

/**
 * Searches the SQLite database for any media_assets currently stored as raw base64.
 * Uploads them to GCS and mutates the DB row to point to the new GCS reference.
 */
export async function migrateBase64ToGCS(db: Database.Database): Promise<void> {
  const rows = db.prepare("SELECT id, workspace_id, thumbnail FROM media_assets WHERE thumbnail LIKE 'data:image/%'").all() as any[];
  
  if (rows.length === 0) return;
  console.log(`[Migration] Found ${rows.length} base64 media assets requiring GCS migration...`);
  
  for (const row of rows) {
    try {
       console.log(`[Migration] Uploading asset ${row.id}...`);
       const gcsPath = await uploadBase64ToGCS(row.thumbnail, row.workspace_id);
       
       db.prepare("UPDATE media_assets SET thumbnail = ? WHERE id = ?").run(gcsPath, row.id);
       
       console.log(`[Migration] Converted asset ${row.id} to GCS successfully.`);
    } catch (err: any) {
       console.error(`[Migration] Halted migration on asset ${row.id} due to upload error: ${err.message}`);
       // Stop the migration loop if there is an auth/bucket error so we don't spam the console.
       break;
    }
  }
}
