import assert from "node:assert/strict";
import { createPasswordHash, createSessionAuth, getBearerToken } from "./auth.js";

const credentials = createPasswordHash("correct horse", "00112233445566778899aabbccddeeff");
let now = Date.parse("2026-07-30T10:00:00.000Z");
const auth = createSessionAuth({
  username: "hsbc",
  passwordSalt: credentials.salt,
  passwordHash: credentials.hash,
  sessionSecret: "0123456789abcdef0123456789abcdef",
  sessionDurationSeconds: 60,
  now: () => now,
});

assert.equal(auth.verifyCredentials("hsbc", "correct horse"), true);
assert.equal(auth.verifyCredentials("HSBC", "correct horse"), false);
assert.equal(auth.verifyCredentials("hsbc", "wrong"), false);

const session = auth.issueToken();
assert.equal(auth.verifyToken(session.token)?.sub, "hsbc");
assert.equal(getBearerToken(`Bearer ${session.token}`), session.token);
assert.equal(auth.verifyToken(`${session.token}x`), null);

now += 60_000;
assert.equal(auth.verifyToken(session.token), null);
