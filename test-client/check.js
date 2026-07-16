import { spawnSync } from "node:child_process";

const files = ["src/app.js", "server.js", "dev.js"];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
