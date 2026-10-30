import { readFile } from "node:fs/promises";

async function readJson(path) {
  return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
}

async function main() {
  const [packageJson, manifest, versions] = await Promise.all([
    readJson("package.json"),
    readJson("manifest.json"),
    readJson("versions.json"),
  ]);

  const errors = [];

  if (typeof manifest.id !== "string" || !/^[a-z0-9-]+$/.test(manifest.id)) {
    errors.push("manifest.json id must contain only lowercase letters, digits, and hyphens.");
  } else if (/obsidian/i.test(manifest.id)) {
    errors.push('manifest.json id must not contain "obsidian".');
  }

  if (typeof manifest.name !== "string" || /obsidian|plugin/i.test(manifest.name)) {
    errors.push('manifest.json name must not contain "Obsidian" or "Plugin".');
  }

  if (
    typeof manifest.description !== "string" ||
    manifest.description.length > 250 ||
    !manifest.description.endsWith(".")
  ) {
    errors.push("manifest.json description must be at most 250 characters and end with a period.");
  }

  if (typeof manifest.minAppVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(manifest.minAppVersion)) {
    errors.push("manifest.json minAppVersion must use the x.y.z format.");
  }

  if (typeof manifest.isDesktopOnly !== "boolean") {
    errors.push("manifest.json isDesktopOnly must be a boolean.");
  }

  if (packageJson.version !== manifest.version) {
    errors.push(
      `package.json version (${packageJson.version}) does not match manifest.json version (${manifest.version}).`,
    );
  }

  if (!versions || typeof versions !== "object" || Array.isArray(versions)) {
    errors.push("versions.json must contain an object mapping plugin versions to minimum Obsidian versions.");
  } else {
    const minimumVersion = versions[manifest.version];

    if (typeof minimumVersion !== "string" || minimumVersion.length === 0) {
      errors.push(`versions.json is missing a minimum Obsidian version for plugin version ${manifest.version}.`);
    } else if (minimumVersion !== manifest.minAppVersion) {
      errors.push(
        `versions.json maps ${manifest.version} to ${minimumVersion}, but manifest.json declares minAppVersion ${manifest.minAppVersion}.`,
      );
    }

    for (const [version, minAppVersion] of Object.entries(versions)) {
      if (typeof minAppVersion !== "string" || minAppVersion.length === 0) {
        errors.push(`versions.json entry ${version} must have a non-empty minimum Obsidian version.`);
      }
    }
  }

  if (errors.length > 0) {
    console.error("Plugin release metadata validation failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log("Plugin release metadata is consistent.");
}

main().catch((error) => {
  console.error("Unable to validate plugin release metadata:", error);
  process.exitCode = 1;
});
