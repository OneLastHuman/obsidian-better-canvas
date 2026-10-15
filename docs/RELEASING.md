# Release process

Releases are created from versioned Git tags. The Release workflow runs the checks, builds the production bundle, packages installable files, and publishes a GitHub Release with generated notes and checksums.

## Before creating a release

1. Choose the next semantic version (for example, `0.2.0` for a minor release or `0.1.1` for a patch release).
2. Set the same version in `package.json` and `manifest.json`.
3. Add or update the corresponding entry in `versions.json`. Its value must match `manifest.json`'s `minAppVersion`; keep entries for previously released versions.
4. Run the checks locally:

   ```bash
   npm install
   npm run typecheck
   npm test
   npm run build
   ```

5. Commit the version changes and merge them into `main`. Confirm the Build workflow passes on the merged commit.

## Publish

From the latest `main` commit that contains the version changes, create and push an annotated tag. Replace `0.2.0` with the version you set above:

```bash
git switch main
git pull --ff-only
git tag -a v0.2.0 -m "Better Canvas v0.2.0"
git push origin v0.2.0
```

Pushing the tag starts the Release workflow. It verifies that the tag, `package.json`, `manifest.json`, and `versions.json` agree; runs typechecking and tests; builds the production bundle; and creates a GitHub Release.

Each release includes:

- `obsidian-better-canvas.zip`, ready to extract into the Vault's `.obsidian/plugins/` directory
- `main.js`, `manifest.json`, and `styles.css` as separate files
- `SHA256SUMS` to verify the downloaded assets

Tags with a prerelease suffix, such as `v0.2.0-beta.1`, are published as GitHub prereleases. Do not move or reuse a published version tag. If a workflow fails, inspect the failed step and rerun it after fixing any release-blocking configuration or code issue.
