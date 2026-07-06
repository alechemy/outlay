# Releasing

Releases are tag-driven: pushing a `vX.Y.Z` tag runs the full CI gate, publishes
to npm, and creates a GitHub release from the matching CHANGELOG section.

1. Add a `## X.Y.Z — YYYY-MM-DD` section to `CHANGELOG.md`.
2. `npm version X.Y.Z --no-git-tag-version`, then commit both files as
   `chore: release X.Y.Z`.
3. `git push`, then `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. The Release workflow does the rest. It refuses a tag that disagrees with
   `package.json`, and skips the npm publish if that version is already on the
   registry (so a re-run or a locally published version only produces the
   GitHub release).

One-time setup: the workflow needs an `NPM_TOKEN` repository secret (an npm
Automation token, so 2FA is not prompted). Without it, publish locally with
`npm publish` before pushing the tag; the workflow will skip the registry step
and still create the release.
