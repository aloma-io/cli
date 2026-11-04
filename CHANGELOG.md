# Changelog

## 0.3.0

### Node 22 or later (we recommend Node 26)

The CLI now supports Node 22 or later (`engines.node` is `>=22`), and we recommend Node 26, the
Active LTS release since 28 October 2026. Tests run on Node 22, 24 and 26.

Node 18 reached end of life on 30 April 2025 and Node 20 on 30 April 2026, so they no longer
receive security fixes and are not supported by this release. Node 22 reaches end of life on
30 April 2027.

If you are on Node 18 or 20, upgrade Node before you upgrade the CLI:

1. Install Node 26 (or at least Node 22) from https://nodejs.org or with your version manager.
2. Check it with `node --version`.
3. Install the CLI again with that Node: `npm install -g @aloma.io/aloma`.

If you stay on Node 18 or 20, keep using version 0.2.0 (`npm install -g @aloma.io/aloma@0.2.0`).
npm only warns about an unsupported Node version unless `engine-strict` is set, so check your
Node version rather than relying on the install to stop.
