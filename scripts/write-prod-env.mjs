import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createPasswordHash } from "../test-client/auth.js";

const outputPath = process.argv[2];
if (!outputPath) throw new Error("Output path is required.");

const username = process.env.CHAT_H_USERNAME;
const password = process.env.CHAT_H_PASSWORD;
const openRouterKey = process.env.OPENROUTER_API_KEY;
if (!username || !password || !openRouterKey) {
  throw new Error("CHAT_H_USERNAME, CHAT_H_PASSWORD, and OPENROUTER_API_KEY are required.");
}

const passwordCredentials = createPasswordHash(password);
const values = {
  OPENROUTER_API_KEY: openRouterKey,
  OPENROUTER_MODEL: process.env.OPENROUTER_MODEL ?? "xiaomi/mimo-v2-flash",
  OPENROUTER_MAX_TOKENS: process.env.OPENROUTER_MAX_TOKENS ?? "2048",
  MCP_ALLOWED_TOOLS:
    "calculate_mortgage_repayment,find_mortgage_product_rates,get_customer_support",
  MCP_ENDPOINT_LOCKED: "true",
  ALLOWED_ORIGINS: "https://chat-h-prod-ks-2026.web.app",
  AUTH_USERNAME: username,
  AUTH_PASSWORD_SALT: passwordCredentials.salt,
  AUTH_PASSWORD_HASH: passwordCredentials.hash,
  AUTH_SESSION_SECRET: randomBytes(32).toString("hex"),
  MAX_REQUEST_BYTES: "65536",
};

const quote = (value) => `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
writeFileSync(
  outputPath,
  `${Object.entries(values).map(([key, value]) => `${key}=${quote(value)}`).join("\n")}\n`,
  { mode: 0o600 },
);
