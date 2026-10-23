import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildPath = path.join(root, ".github/workflows/build.yml");
const cleanupPath = path.join(root, ".github/workflows/artifact-cleanup.yml");
const releasePath = path.join(root, ".github/workflows/release.yml");
const buildSource = fs.readFileSync(buildPath, "utf8");
const cleanupSource = fs.readFileSync(cleanupPath, "utf8");
const releaseSource = fs.readFileSync(releasePath, "utf8");
const publishMatch = buildSource.match(/^  publish-installable-bundle:\r?$/m);
if (!publishMatch || publishMatch.index === undefined) {
  throw new Error("Build workflow is missing publish-installable-bundle.");
}
const publishSource = buildSource.slice(publishMatch.index);

if (buildSource.includes("upload-artifact")) {
  throw new Error("Build workflow must not upload artifacts.");
}
if (publishSource.includes("download-artifact")) {
  throw new Error("Main bundle sync must rebuild instead of downloading an artifact.");
}
if (!/^      - run: npm run build\r?$/m.test(publishSource)) {
  throw new Error("Main bundle sync must rebuild the production entrypoint.");
}
if (!releaseSource.includes("dist/obsidian-better-canvas.zip")) {
  throw new Error("Release workflow must publish the installable ZIP.");
}

for (const required of [
  "MAX_ARTIFACT_BYTES",
  "MIN_RETENTION_DAYS",
  "KEEP_NEWEST_ARTIFACTS",
  "sort_by(.created_at) | reverse",
  "actions/artifacts/$artifact_id",
]) {
  if (!cleanupSource.includes(required)) {
    throw new Error(`Artifact cleanup script is missing: ${required}`);
  }
}
if (!cleanupSource.includes('MAX_ARTIFACT_BYTES: "314572800"')) {
  throw new Error("Artifact budget must be 300 MiB.");
}
if (!cleanupSource.includes('MIN_RETENTION_DAYS: "3"')) {
  throw new Error("Artifact retention floor must be 3 days.");
}
if (!cleanupSource.includes('KEEP_NEWEST_ARTIFACTS: "10"')) {
  throw new Error("Artifact cleanup must protect the 10 newest artifacts.");
}

const linkedFiles = [
  "docs/TESTING.md",
  "docs/INSTALLATION.md",
  "docs/INTEGRATION_MATRIX.md",
  ".github/pull_request_template.md",
];
const brokenLinks = [];
for (const relativeFile of linkedFiles) {
  const filePath = path.join(root, relativeFile);
  const source = fs.readFileSync(filePath, "utf8");
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (!target || /^(?:https?:|mailto:|#)/.test(target)) {
      continue;
    }
    const resolved = path.resolve(path.dirname(filePath), decodeURI(target));
    if (!fs.existsSync(resolved)) {
      brokenLinks.push(`${relativeFile} -> ${target}`);
    }
  }
}
if (brokenLinks.length > 0) {
  throw new Error(`Broken local links:\n${brokenLinks.join("\n")}`);
}

const obsoletePatterns = [
  /upload-artifact/,
  /download-artifact/,
  /obsidian-better-canvas-install/,
  /CI 工件保留 14 天/,
  /Pull Request 构建只负责验证和打包/,
  /creates the installable ZIP artifact/,
];
const documentationFiles = linkedFiles.filter((file) => file.startsWith("docs/"));
for (const relativeFile of documentationFiles) {
  const source = fs.readFileSync(path.join(root, relativeFile), "utf8");
  for (const pattern of obsoletePatterns) {
    if (pattern.test(source)) {
      throw new Error(`${relativeFile} contains obsolete artifact guidance: ${pattern}`);
    }
  }
}

console.log("Workflow artifact policy verified.");
