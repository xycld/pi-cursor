# Publishing `pi-cursor`

This project is publishable as the npm package `@xycloud/pi-cursor`. The binary entrypoint is `pi-cursor` (`bin/pi-cursor.js`).

## Prerequisites

- npm account with publish access for `@xycloud/pi-cursor`
- Trusted Publishing configured for this GitHub repository, or npm auth available for a local/manual publish
- Clean `main` branch with passing CI

## Release Checklist

1. Decide if this is a publish-worthy change.
   - Docs-only or refactors with no user-visible behavior change: do not publish.
   - User-visible changes (installer behavior, Pi extension behavior, model metadata): publish.
2. Update version in `package.json` (semver) only when publishing.
3. Build and run checks locally:
   - `npm install`
   - `npm run verify`
   - `pi --offline --list-models cursor-acp`
4. Confirm package contents:
   - `npm pack --dry-run`
5. Confirm target version is not already published:
   - `npm view @xycloud/pi-cursor version`
6. Commit and push the version bump to `main`.
7. Create and push a release tag:
   - `git tag vX.Y.Z`
   - `git push origin vX.Y.Z`

## GitHub Actions Publish Flow

The workflow in `.github/workflows/publish.yml` publishes automatically on:

- `push` tags matching `v*`
- Manual `workflow_dispatch`

Publish step:

- `npm publish --access public`

If you need a non-publish validation run, execute the same build/check steps locally and use `npm pack --dry-run`.

## Dist Tags (Optional)

Use dist-tags for pre-releases instead of publishing a rapid stream of patch versions:
- `latest`: stable releases
- `beta`: pre-release channel (for example `0.2.0-beta.1`)
