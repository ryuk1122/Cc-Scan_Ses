/**
 * Device ID: stable per install. Persisted in AsyncStorage via @/src/utils/storage.
 */
import { storage } from "@/src/utils/storage";

const KEY = "cs_device_id";

function rnd(len = 10): string {
  const c = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += c[Math.floor(Math.random() * c.length)];
  return out;
}

export async function getDeviceId(): Promise<string> {
  const existing = await storage.getItem<string>(KEY, "");
  if (existing) return existing;
  const id = `dev_${rnd(12)}`;
  await storage.setItem(KEY, id);
  return id;
}

export function newNonce(): string {
  // 32-hex random (uuid-like)
  let s = "";
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}
