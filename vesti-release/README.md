# Vesti Release Metadata Directory

This tracked directory now keeps only the minimal public metadata that is safe to sync to `main`:

- latest checksum
- latest manifest snapshot
- latest file list snapshot

Release bundles and older mirrored artifacts are retained locally under the ignored directory
`vesti-release/_local/`.

## Current public baseline

- Version: `v1.2.0-rc.9`
- Source commit: `c2b842c7f2c5fd5fa0af86c29b3a3c4cdb9b93ee`
- Built at: `2026-08-16 13:37:07 +08:00`
- CI run: `https://github.com/abraxas914/VESTI/actions/runs/31929384427`
- SHA256: `f8c869e42b8070008c7723104eea8b62d29b31f7c4f6c11579f2d53be0a652b9`
- Size: `20.64 MB` (`21,640,117` bytes)

## Public release truth

1. GitHub Releases remain the official attachment surface.
2. CI packaging remains the provenance path through `.github/workflows/extension-package.yml`.
3. This directory is metadata-only and should not grow back into a mirrored artifact store.
