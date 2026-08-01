import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createPasswordHash } from "./auth.js";

const port = 5184;
const password = "test-password";
const credentials = createPasswordHash(password, "ffeeddccbbaa99887766554433221100");
let childOutput = "";
const child = spawn(process.execPath, ["server.js"], {
  cwd: new URL(".", import.meta.url),
  env: {
    ...process.env,
    TEST_CLIENT_API_PORT: String(port),
    AUTH_USERNAME: "test-user",
    AUTH_PASSWORD_SALT: credentials.salt,
    AUTH_PASSWORD_HASH: credentials.hash,
    AUTH_SESSION_SECRET: "test-session-secret-with-at-least-32-characters",
    ALLOWED_ORIGINS: "https://allowed.example",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (chunk) => { childOutput += chunk; });
child.stderr.on("data", (chunk) => { childOutput += chunk; });

try {
  await waitForServer();

  const unauthenticated = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(unauthenticated.status, 401);

  const wrongLogin = await login("wrong");
  assert.equal(wrongLogin.status, 401);

  const loginResponse = await login(password);
  assert.equal(loginResponse.status, 200);
  const session = await loginResponse.json();
  assert.equal(typeof session.token, "string");
  assert.match(session.expiresAt, /^\d{4}-\d{2}-\d{2}T/);

  const health = await fetch(`http://127.0.0.1:${port}/health`, {
    headers: {
      authorization: `Bearer ${session.token}`,
      origin: "https://allowed.example",
    },
  });
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("access-control-allow-origin"), "https://allowed.example");

  const rejectedOrigin = await fetch(`http://127.0.0.1:${port}/health`, {
    headers: {
      authorization: `Bearer ${session.token}`,
      origin: "https://rejected.example",
    },
  });
  assert.equal(rejectedOrigin.status, 200);
  assert.equal(rejectedOrigin.headers.get("access-control-allow-origin"), null);
} finally {
  if (child.exitCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await exited;
  }
}

async function login(candidatePassword) {
  return fetch(`http://127.0.0.1:${port}/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://allowed.example",
    },
    body: JSON.stringify({ username: "test-user", password: candidatePassword }),
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(
        `Authentication test server exited with ${child.exitCode}: ${childOutput.trim()}`,
      );
    }
    try {
      await fetch(`http://127.0.0.1:${port}/health`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error("Authentication test server did not start.");
}
