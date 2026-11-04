# Release process

Releases are created from versioned Git tags. The Release workflow runs the checks, builds the production bundle, packages installable files, and publishes a GitHub Release with generated notes and checksums.

## Before creating a release

1. Choose the next semantic version (for example, `0.2.0` for a minor release or `0.1.1` for a patch release).
2. Set the same version in `package.json` and `manifest.json`.
3. Add or update the corresponding entry in `versions.json`. Its value must match `manifest.json`'s `minAppVersion`; keep entries for previously released versions.
4. Run the [standard local checks](TESTING.md#3-本项目的标准本地检查), including lint and metadata validation. Record runtime checks separately as required by that guide.
5. Submit the version changes through a PR under the [repository governance rules](REPOSITORY_GOVERNANCE.md). After the maintainer merges it into `main`, confirm the Build workflow passes on the merged commit.

## Preview the community review

Before publishing a fix, open the plugin in the authenticated [Obsidian Community developer dashboard](https://community.obsidian.md/) and choose **Review branch → Run preview scan**. Select the exact branch, tag, or commit being reviewed. A preview does not publish a release. See the [official review guidance](https://obsidian.md/blog/future-of-plugins/).

Keep local checks, preview findings, and the public latest-release scorecard separate. The public **Risks** label is not proof of malware, and a local lint pass does not clear it. Obsidian does not publish an exact numeric threshold; network and clipboard capabilities remain disclosures when those features are present.

The warning fixes preserve existing rendering and streaming behavior:

- AI streaming and legacy MCP SSE use the desktop Electron network session through `requestStream`, including incremental response bodies and cancellation. Buffered requests continue to use `requestUrl`; its public response has no stream or abort signal. The streaming adapter uses the current window's Electron session so configured proxies remain available.
- The published [scanner implementation](https://github.com/obsidianmd/obsidian-workflows/blob/main/src/lint.ts) maps the plugin minimum of Obsidian 1.14.4 to its newest known Electron bucket, labelled Obsidian 1.11.4. Its compatibility detector flags whole feature families. Declaration-local `doiuse-disable` / `doiuse-enable` pairs document the supported syntax: `polygon()`, `path()` and same-document SVG clips, plus decoration line/color/thickness. Can I Use's partial-support notes concern [external SVG clips](https://caniuse.com/css-clip-path) and unused [`text-decoration-skip` values](https://caniuse.com/text-decoration). These exceptions do not disable other rules or later declarations. Keep `release/styles.css` synchronized so generated copies do not repeat the same findings.
- Website grids use `gap: 0 <column spacing>` rather than `column-gap`, preserving zero row spacing and avoiding the detector's multicolumn classification.
- GPL licensing, base64 media handling, Vault enumeration and clipboard access remain capability disclosures. The ZIP/checksum asset recommendation is explained below.

After the reviewed fix is merged and a new version is published through the workflow below, check the new release's actual scan result. Do not move an existing version tag or claim that a preview changed the public latest-release scorecard.

## Publish

From the latest `main` commit that contains the version changes, create and push an annotated tag. The tag must match the version in `manifest.json` exactly, without a `v` prefix. Replace `0.2.0` with the version you set above:

```bash
git switch main
git pull --ff-only
git tag -a 0.2.0 -m "Better Canvas 0.2.0"
git push origin 0.2.0
```

Pushing the tag starts the Release workflow. It verifies that the tag, `package.json`, `manifest.json`, and `versions.json` agree; runs typechecking and tests; builds the production bundle; creates provenance attestations for the built release files; and creates a GitHub Release.

Each release includes:

- `better-canvas.zip`, ready to extract into the Vault's `.obsidian/plugins/` directory
- `main.js`, `manifest.json`, and `styles.css` as separate files
- `SHA256SUMS` to verify the downloaded assets

The workflow creates GitHub artifact attestations for `main.js`, `manifest.json`, `styles.css`, and `better-canvas.zip`. To verify a downloaded file, install the [GitHub CLI](https://cli.github.com/) and run `gh attestation verify <file> --repo OneLastHuman/obsidian-better-canvas`.

Artifact attestations work in public repositories on GitHub Free, Pro, and Team plans. Private or internal repositories need GitHub Enterprise Cloud, and legacy plans do not support attestations. On plans that only support public repositories, make the repository public before pushing a release tag; otherwise the attestation step fails the workflow.

The Obsidian review recommendation that flags `better-canvas.zip` and `SHA256SUMS` as extra release files is informational: Obsidian only consumes `main.js`, `manifest.json`, and `styles.css` for its plugin installation flow. The ZIP remains useful for manual installation, and `SHA256SUMS` lets manual downloaders check asset integrity, so both remain attached to the GitHub Release.

Tags with a prerelease suffix, such as `0.2.0-beta.1`, are published as GitHub prereleases. Do not move or reuse a published version tag. If a workflow fails, inspect the failed step and rerun it after fixing any release-blocking configuration or code issue.

## Submit to the Obsidian community directory

The first public release also needs to be submitted to the Obsidian community directory. Before submitting:

1. Make the GitHub repository public.
2. Confirm `README.md`, `LICENSE`, `manifest.json`, and `versions.json` are in the root of the default branch.
3. Confirm `manifest.json`'s `id` does not contain `obsidian`, its `description` is at most 250 characters and ends with a period, and `isDesktopOnly` matches the implementation.
4. Confirm the GitHub Release tag matches `manifest.json`'s version and includes `main.js`, `manifest.json`, and `styles.css` as individual assets.
5. Sign in at [community.obsidian.md](https://community.obsidian.md), link the GitHub account, and submit the repository.

After submission, fix any automated review findings and publish a new version with an incremented version number. Users can install the plugin from Obsidian only after the review passes.
