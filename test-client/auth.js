import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const SESSION_DURATION_SECONDS = 12 * 60 * 60;
const SCRYPT_KEY_LENGTH = 32;

export function createPasswordHash(password, salt = randomBytes(16).toString("hex")) {
  return {
    salt,
    hash: scryptSync(password, salt, SCRYPT_KEY_LENGTH).toString("hex"),
  };
}

export function createSessionAuth({
  username,
  passwordSalt,
  passwordHash,
  sessionSecret,
  sessionDurationSeconds = SESSION_DURATION_SECONDS,
  now = () => Date.now(),
}) {
  assertConfigured("AUTH_USERNAME", username);
  assertHex("AUTH_PASSWORD_SALT", passwordSalt, 16);
  assertHex("AUTH_PASSWORD_HASH", passwordHash, SCRYPT_KEY_LENGTH);
  assertConfigured("AUTH_SESSION_SECRET", sessionSecret, 32);

  const expectedUsername = Buffer.from(username);
  const expectedPasswordHash = Buffer.from(passwordHash, "hex");

  function verifyCredentials(candidateUsername, candidatePassword) {
    const suppliedUsername = Buffer.from(String(candidateUsername ?? ""));
    const suppliedPasswordHash = scryptSync(
      String(candidatePassword ?? ""),
      passwordSalt,
      SCRYPT_KEY_LENGTH,
    );

    return safeEqual(suppliedUsername, expectedUsername) &&
      timingSafeEqual(suppliedPasswordHash, expectedPasswordHash);
  }

  function issueToken(subject = username) {
    const issuedAt = Math.floor(now() / 1000);
    const expiresAt = issuedAt + sessionDurationSeconds;
    const payload = toBase64Url(JSON.stringify({
      sub: subject,
      iat: issuedAt,
      exp: expiresAt,
      nonce: randomBytes(12).toString("hex"),
    }));
    const signature = sign(payload, sessionSecret);

    return {
      token: `${payload}.${signature}`,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    };
  }

  function verifyToken(token) {
    if (typeof token !== "string") return null;
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra) return null;

    const expectedSignature = sign(payload, sessionSecret);
    if (!safeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      return null;
    }

    try {
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      const currentTime = Math.floor(now() / 1000);
      if (
        claims?.sub !== username ||
        !Number.isInteger(claims?.iat) ||
        !Number.isInteger(claims?.exp) ||
        claims.iat > currentTime + 60 ||
        claims.exp <= currentTime
      ) {
        return null;
      }
      return claims;
    } catch {
      return null;
    }
  }

  return { verifyCredentials, issueToken, verifyToken };
}

export function getBearerToken(header) {
  const match = String(header ?? "").match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/);
  return match?.[1] ?? null;
}

function sign(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function toBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function safeEqual(left, right) {
  if (left.length !== right.length) {
    timingSafeEqual(right, right);
    return false;
  }
  return timingSafeEqual(left, right);
}

function assertConfigured(name, value, minimumLength = 1) {
  if (typeof value !== "string" || value.length < minimumLength) {
    throw new Error(`${name} must be configured with at least ${minimumLength} characters.`);
  }
}

function assertHex(name, value, expectedBytes) {
  if (
    typeof value !== "string" ||
    value.length !== expectedBytes * 2 ||
    !/^[a-f0-9]+$/i.test(value)
  ) {
    throw new Error(`${name} must be ${expectedBytes} bytes encoded as hexadecimal.`);
  }
}
