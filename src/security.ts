// security.ts — the app-lock + encryption policy layer. This is the ONE module
// that owns expo-secure-store / expo-crypto / expo-local-authentication, and the
// persisted security state.
//
// Why the state lives HERE and not in the `setting` table: whether the database
// is encrypted, in which key mode, the passcode hash/salt and the recoverable
// key itself must be readable *before* the DB is opened — and the DB may be the
// very thing that is encrypted (chicken-and-egg). So all of it is kept in
// expo-secure-store (Android Keystore-backed), outside the database file.
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import * as LocalAuthentication from "expo-local-authentication";
import type { KeyMaterial } from "./db";

// ── Persisted keys (secure-store) ─────────────────────────────────────────
// Namespaced; secure-store allows [A-Za-z0-9._-].
const K = {
  lockEnabled: "kairos.sec.lockEnabled",
  // encEnabled + keyMode + activeDbFile are stored TOGETHER as one JSON value so a
  // migration commit (which flips all three at once) is a single atomic write —
  // a crash is cleanly either side of it, never a half-flipped state.
  dbState: "kairos.sec.dbState",
  zkBiometric: "kairos.sec.zkBiometric",
  passcodeHash: "kairos.sec.passcodeHash",
  passcodeSalt: "kairos.sec.passcodeSalt",
  dek: "kairos.sec.dek", // recoverable data-encryption key (hex)
  zkPasscodeCache: "kairos.sec.zkPasscodeCache", // biometric-gated passcode (zk convenience)
  lockoutUntil: "kairos.sec.lockoutUntil",
  failCount: "kairos.sec.failCount", // persisted so a restart can't reset the backoff
  uiTheme: "kairos.ui.theme",
  uiLang: "kairos.ui.lang",
} as const;

// Canonical database filenames. Plaintext installs use "kairos.db" (unchanged);
// encryption migrates into an alternate slot so the source always survives until
// the destination is verified (see db.ts migrations).
export const PLAIN_DB = "kairos.db";
export const ENC_DB_A = "kairos.enc.db";
export const ENC_DB_B = "kairos.enc.b.db";

export type KeyMode = "recoverable" | "zk";

// The atomically-committed database pointer (see K.dbState).
export type DbState = {
  encEnabled: boolean;
  keyMode: KeyMode; // meaningful only when encEnabled
  activeDbFile: string;
};
const DEFAULT_DB_STATE: DbState = {
  encEnabled: false,
  keyMode: "recoverable",
  activeDbFile: PLAIN_DB,
};

export type SecurityState = {
  lockEnabled: boolean;
  encEnabled: boolean;
  keyMode: KeyMode; // meaningful only when encEnabled
  zkBiometric: boolean; // zk sub-mode: cache the passcode behind a biometric gate
  passcodeSet: boolean;
  activeDbFile: string;
  lockoutUntil: number | null;
};

const WHEN_UNLOCKED_THIS_DEVICE_ONLY: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

// ── small helpers ──────────────────────────────────────────────────────────
function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++)
    out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

async function get(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}
async function set(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value, WHEN_UNLOCKED_THIS_DEVICE_ONLY);
}
async function del(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    /* ignore */
  }
}

// ── Database pointer + encryption state (one atomic JSON value) ──────────────
export async function getDbState(): Promise<DbState> {
  const raw = await get(K.dbState);
  if (!raw) return { ...DEFAULT_DB_STATE };
  try {
    const p = JSON.parse(raw);
    return {
      encEnabled: !!p.encEnabled,
      keyMode: p.keyMode === "zk" ? "zk" : "recoverable",
      activeDbFile:
        typeof p.activeDbFile === "string" ? p.activeDbFile : PLAIN_DB,
    };
  } catch {
    return { ...DEFAULT_DB_STATE };
  }
}
export const setDbState = (s: DbState) => set(K.dbState, JSON.stringify(s));

// ── State snapshot ───────────────────────────────────────────────────────────
export async function loadSecurity(): Promise<SecurityState> {
  const [lock, ds, zkBio, pcHash, lockout] = await Promise.all([
    get(K.lockEnabled),
    getDbState(),
    get(K.zkBiometric),
    get(K.passcodeHash),
    get(K.lockoutUntil),
  ]);
  return {
    lockEnabled: lock === "1",
    encEnabled: ds.encEnabled,
    keyMode: ds.keyMode,
    zkBiometric: zkBio !== "0", // default on
    passcodeSet: !!pcHash,
    activeDbFile: ds.activeDbFile,
    lockoutUntil: lockout ? Number(lockout) : null,
  };
}

export const setLockEnabled = (b: boolean) => set(K.lockEnabled, b ? "1" : "0");
export const setZkBiometric = (b: boolean) => set(K.zkBiometric, b ? "1" : "0");

// ── UI preference mirror (so pre-DB screens paint the right theme/lang) ──────
export async function getUiPrefs(): Promise<{
  theme: string | null;
  lang: string | null;
}> {
  const [theme, lang] = await Promise.all([get(K.uiTheme), get(K.uiLang)]);
  return { theme, lang };
}
export const setUiTheme = (v: string) => set(K.uiTheme, v);
export const setUiLang = (v: string) => set(K.uiLang, v);

// ── Passcode (hash+salt; the plaintext code never persists in recoverable mode) ─
// The code is trimmed at every boundary (set / verify / zk key) so a stray
// trailing space or newline inserted by the keyboard/IME can't cause the very
// same passcode to fail to match.
export async function setPasscode(code: string): Promise<void> {
  const c = code.trim();
  const salt = toHex(await Crypto.getRandomBytesAsync(16));
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    salt + c,
  );
  await set(K.passcodeSalt, salt);
  await set(K.passcodeHash, hash);
  console.log(`[KAIROS] setPasscode len=${c.length} raw=${code.length}`);
}
export async function verifyPasscode(code: string): Promise<boolean> {
  const c = code.trim();
  const [salt, hash] = await Promise.all([
    get(K.passcodeSalt),
    get(K.passcodeHash),
  ]);
  if (!salt || !hash) {
    console.log(`[KAIROS] verifyPasscode: salt/hash missing`);
    return false;
  }
  const test = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    salt + c,
  );
  const ok = test === hash;
  console.log(`[KAIROS] verifyPasscode len=${c.length} raw=${code.length} match=${ok}`);
  return ok;
}
export async function isPasscodeSet(): Promise<boolean> {
  return !!(await get(K.passcodeHash));
}
export async function clearPasscode(): Promise<void> {
  await del(K.passcodeHash);
  await del(K.passcodeSalt);
}

// ── Recoverable data-encryption key (random, Keystore-backed) ────────────────
// Stored WITHOUT requireAuthentication ON PURPOSE: keys flagged
// requireAuthentication are invalidated by the OS when biometrics change, which
// would silently destroy the user's only data copy. The app lock is enforced by
// our own unlock screen instead.
export async function ensureRecoverableKey(): Promise<string> {
  const existing = await get(K.dek);
  if (existing) return existing;
  const hex = toHex(await Crypto.getRandomBytesAsync(32));
  await set(K.dek, hex);
  return hex;
}
export const getRecoverableKey = () => get(K.dek);
export const deleteRecoverableKey = () => del(K.dek);
export const recoverableKeyMaterial = (hex: string): KeyMaterial => ({
  form: "raw",
  hex,
});
export const passcodeKeyMaterial = (code: string): KeyMaterial => ({
  form: "passphrase",
  secret: code.trim(),
});

// ── Zero-knowledge biometric convenience cache ───────────────────────────────
// The passcode (the zk key source) cached behind a biometric gate so fingerprint
// unlock can retrieve it. This IS on the device (Keystore-protected) — it weakens
// the "nothing can decrypt" guarantee, which is spelled out to the user. The
// cache is expendable: a biometric change invalidates it, forcing passcode
// re-entry, never data loss.
export async function cacheZkPasscode(code: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(K.zkPasscodeCache, code, {
      ...WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      requireAuthentication: true,
      authenticationPrompt: "Déverrouiller Kairos",
    });
  } catch {
    /* biometric unavailable — silently skip; passcode path still works */
  }
}
export async function readZkPasscodeCache(
  prompt: string,
): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(K.zkPasscodeCache, {
      requireAuthentication: true,
      authenticationPrompt: prompt,
    });
  } catch {
    return null; // cancelled, invalidated, or unavailable → fall back to passcode
  }
}
export const clearZkPasscodeCache = () => del(K.zkPasscodeCache);

// ── Biometric capability + explicit gate (for lock-only / recoverable unlock) ──
export async function biometricAvailable(): Promise<boolean> {
  try {
    return (
      (await LocalAuthentication.hasHardwareAsync()) &&
      (await LocalAuthentication.isEnrolledAsync())
    );
  } catch {
    return false;
  }
}
export async function authenticate(prompt: string): Promise<boolean> {
  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: prompt,
      disableDeviceFallback: false, // allow the phone PIN/pattern as a fallback
    });
    return res.success;
  } catch {
    return false;
  }
}

// ── Lockout (brute-force backoff), persisted so it survives an app kill ───────
export const setLockoutUntil = (ms: number | null) =>
  ms ? set(K.lockoutUntil, String(ms)) : del(K.lockoutUntil);
// Fail count is persisted too: otherwise killing + relaunching the app before the
// threshold would reset the counter and defeat the backoff entirely.
export const getFailCount = async () => Number((await get(K.failCount)) || "0");
export const setFailCount = (n: number) =>
  n > 0 ? set(K.failCount, String(n)) : del(K.failCount);

// ── Full wipe of all security state (used by the destructive recovery reset) ──
export async function wipeSecurity(): Promise<void> {
  await Promise.all(Object.values(K).map((k) => del(k)));
}
