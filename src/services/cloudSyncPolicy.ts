/** Build-time data-sync policy, independent of Supabase authentication and server AI. */
export function isCloudSyncEnabled(): boolean {
  return import.meta.env.VITE_ENABLE_CLOUD_SYNC?.trim().toLowerCase() !== "false";
}

export const CLOUD_SYNC_DISABLED_MESSAGE = "Cloud sync and cloud history are off for this build. Records saved on this device remain available here.";

export function assertCloudSyncEnabled(): void {
  if (!isCloudSyncEnabled()) throw new Error(CLOUD_SYNC_DISABLED_MESSAGE);
}
