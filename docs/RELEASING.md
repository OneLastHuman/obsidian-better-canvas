# Release process

Releases are created from versioned Git tags. The Release workflow runs the checks, builds the production bundle, packages installable files, and publishes a GitHub Release with generated notes and checksums.

## Before creating a release

1. Choose the next semantic version (for example, `0.2.0` for a minor release or `0.1.1` for a patch release).
2. Set the same version in `package.json` and `manifest.json`.
3. Add or update the corresponding entry in `versions.json`. Its value must match `manifest.json`'s `minAppVersion`; keep entries for previously released versions.
4. Run the [standard local checks](TESTING.md#3-本项目的标准本地检查), including lint and metadata validation. Record runtime checks separately as required by that guide.
5. Submit the version changes through a PR under the [repository governance rules](REPOSITORY_GOVERNANCE.md). After the maintainer merges it into `main`, confirm the Build workflow passes on the merged commit.

## Publish

From the latest `main` commit that contains the version changes, create and push an annotated tag. The tag must match the version in `manifest.json` exactly, without a `v` prefix. Replace `0.2.0` with the version you set above:

```bash
git switch main
git pull --ff-only
git tag -a 0.2.0 -m "Better Canvas 0.2.0"
git push origin 0.2.0
```

Pushing the tag starts the Release workflow. It verifies that the tag, `package.json`, `manifest.json`, and `versions.json` agree; runs typechecking and tests; builds the production bundle; and creates a GitHub Release.

Each release includes:

- `better-canvas.zip`, ready to extract into the Vault's `.obsidian/plugins/` directory
- `main.js`, `manifest.json`, and `styles.css` as separate files
- `SHA256SUMS` to verify the downloaded assets

Tags with a prerelease suffix, such as `0.2.0-beta.1`, are published as GitHub prereleases. Do not move or reuse a published version tag. If a workflow fails, inspect the failed step and rerun it after fixing any release-blocking configuration or code issue.

## Submit to the Obsidian community directory

The first public release also needs to be submitted to the Obsidian community directory. Before submitting:

1. Make the GitHub repository public.
2. Confirm `README.md`, `LICENSE`, `manifest.json`, and `versions.json` are in the root of the default branch.
3. Confirm `manifest.json`'s `id` does not contain `obsidian`, its `description` is at most 250 characters and ends with a period, and `isDesktopOnly` matches the implementation.
4. Confirm the GitHub Release tag matches `manifest.json`'s version and includes `main.js`, `manifest.json`, and `styles.css` as individual assets.
5. Sign in at [community.obsidian.md](https://community.obsidian.md), link the GitHub account, and submit the repository.

After submission, fix any automated review findings and publish a new version with an incremented version number. Users can install the plugin from Obsidian only after the review passes.
