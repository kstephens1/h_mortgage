import { randomBytes } from "node:crypto";
import { createPasswordHash } from "../test-client/auth.js";

const username = process.env.CHAT_H_USERNAME ?? "hsbc";
const password = process.env.CHAT_H_PASSWORD;
if (!password) {
  throw new Error("Set CHAT_H_PASSWORD to generate local authentication values.");
}

const credentials = createPasswordHash(password);
console.log(`AUTH_USERNAME=${username}`);
console.log(`AUTH_PASSWORD_SALT=${credentials.salt}`);
console.log(`AUTH_PASSWORD_HASH=${credentials.hash}`);
console.log(`AUTH_SESSION_SECRET=${randomBytes(32).toString("hex")}`);
