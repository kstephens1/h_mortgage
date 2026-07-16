import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("./server.js", import.meta.url));
const vitePath = fileURLToPath(
  new URL("../node_modules/vite/bin/vite.js", import.meta.url),
);

const children = [
  spawn(process.execPath, [serverPath], { stdio: "inherit", env: process.env }),
  spawn(
    process.execPath,
    [vitePath, "--host", "127.0.0.1", "--port", "5173", "--strictPort"],
    { stdio: "inherit", env: process.env },
  ),
];

let shuttingDown = false;

for (const child of children) {
  child.on("exit", (code) => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const other of children) {
      if (other !== child && !other.killed) {
        other.kill("SIGTERM");
      }
    }
    process.exit(code ?? 0);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    shuttingDown = true;
    for (const child of children) {
      if (!child.killed) child.kill(signal);
    }
  });
}
