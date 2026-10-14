import crypto from "node:crypto";

const ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET || "rems-dev-jwt-access-secret-change-in-production-2026";
const REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || "rems-dev-jwt-refresh-secret-change-in-production-2026";

export interface JwtPayload {
  sub: string; // userId
  email: string;
  fullName: string;
  organizationId: string;
  organizationSlug: string;
  branchId: string | null;
  roleId: string;
  roleSlug: string;
  permissions: string[];
  iat?: number;
  exp?: number;
}

/**
 * Hash a password using PBKDF2-HMAC-SHA256 with a random or deterministic salt.
 */
export function hashPassword(password: string, explicitSalt?: string): string {
  const salt = explicitSalt || crypto.randomBytes(16).toString("hex");
  const derived = crypto.pbkdf2Sync(password, salt, 10000, 32, "sha256").toString("hex");
  return `pbkdf2$10000$${salt}$${derived}`;
}

/**
 * Verify a plaintext password against a stored PBKDF2 hash in constant time.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") {
    return false;
  }
  const iterations = parseInt(parts[1], 10);
  const salt = parts[2];
  const originalHex = parts[3];
  const candidateHex = crypto
    .pbkdf2Sync(password, salt, iterations, 32, "sha256")
    .toString("hex");

  const a = Buffer.from(originalHex, "hex");
  const b = Buffer.from(candidateHex, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(input: string): string {
  let str = input.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4 !== 0) {
    str += "=";
  }
  return Buffer.from(str, "base64").toString("utf8");
}

/**
 * Sign a JWT Access Token using HMAC-SHA256.
 */
export function signAccessToken(
  payload: Omit<JwtPayload, "iat" | "exp">,
  expiresInSeconds = 900
): string {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(fullPayload));
  const signature = base64UrlEncode(
    crypto.createHmac("sha256", ACCESS_SECRET).update(`${header}.${body}`).digest()
  );
  return `${header}.${body}.${signature}`;
}

/**
 * Verify and decode a JWT Access Token.
 */
export function verifyAccessToken(token: string): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expectedSig = base64UrlEncode(
      crypto.createHmac("sha256", ACCESS_SECRET).update(`${header}.${body}`).digest()
    );
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    const decoded = JSON.parse(base64UrlDecode(body)) as JwtPayload;
    const now = Math.floor(Date.now() / 1000);
    if (decoded.exp && decoded.exp < now) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Generate a cryptographically random refresh token and its SHA-256 hash.
 */
export function generateRefreshToken(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(40).toString("hex");
  const tokenHash = hashRefreshToken(rawToken);
  return { rawToken, tokenHash };
}

export function hashRefreshToken(rawToken: string): string {
  return crypto.createHmac("sha256", REFRESH_SECRET).update(rawToken).digest("hex");
}

// ============================================================================
// RFC 6238 TOTP Two-Factor Authentication (2FA)
// ============================================================================

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(length = 20): string {
  const bytes = crypto.randomBytes(length);
  let secret = "";
  for (let i = 0; i < bytes.length; i++) {
    secret += BASE32_ALPHABET[bytes[i] % 32];
  }
  return secret;
}

function base32ToBuffer(base32: string): Buffer {
  const cleaned = base32.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const ch of cleaned) {
    const val = BASE32_ALPHABET.indexOf(ch);
    if (val >= 0) {
      bits += val.toString(2).padStart(5, "0");
    }
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/**
 * Generate a 6-digit TOTP code for a given Base32 secret and timestamp.
 */
export function generateTotpCode(secret: string, timestampMs = Date.now(), stepSeconds = 30): string {
  const counter = Math.floor(timestampMs / 1000 / stepSeconds);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigInt64BE(BigInt(counter), 0);

  const key = base32ToBuffer(secret);
  const hmac = crypto.createHmac("sha1", key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const otp = binary % 1000000;
  return otp.toString().padStart(6, "0");
}

/**
 * Verify a 6-digit TOTP code allowing +/- 1 time step window for clock skew.
 */
export function verifyTotpCode(secret: string, code: string, timestampMs = Date.now()): boolean {
  const normalized = code.trim();
  if (!/^\d{6}$/.test(normalized)) return false;
  for (const offsetSteps of [-1, 0, 1]) {
    const candidate = generateTotpCode(secret, timestampMs + offsetSteps * 30000);
    if (candidate === normalized) {
      return true;
    }
  }
  return false;
}

export function buildOtpAuthUri(email: string, secret: string, issuer = "PakLand-REMS"): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const encodedIssuer = encodeURIComponent(issuer);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
}
