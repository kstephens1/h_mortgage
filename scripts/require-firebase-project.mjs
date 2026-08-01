import { readFileSync } from "node:fs";

const expectedProject = process.argv[2];
const input = JSON.parse(readFileSync(0, "utf8"));
const projects = input?.result ?? [];

if (!projects.some((project) => project.projectId === expectedProject && project.state === "ACTIVE")) {
  console.error(
    `Firebase project ${expectedProject} is not active for the current account. ` +
    "Create that exact project before deployment; no fallback project is permitted.",
  );
  process.exit(1);
}
