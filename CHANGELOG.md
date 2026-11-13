# Changelog

## Unreleased

### Step files are sent exactly as written (PLAT-78)

- `step sync`, `step edit`, `step add -f` and `deploy` no longer re-print a step's condition and content: the
  text between the markers of the file is sent byte for byte, and `step pull` followed by `step sync` changes nothing.
- `step sync` skips a step whose `content_hash` equals the hash of the file (and, as before, one whose stored text
  is equal): no save, no version bump, no refresh.
- A condition with a `$` operator is named per step before `step sync` writes anything; nothing is half synced.

### File access stays inside the working folder

- `aloma deploy <file.yaml>`: every file the YAML names (`file:` and `syncPath:` of steps and libraries,
  `file:` of tasks and connectors) is now read relative to the folder of the YAML file, not the current
  directory. A path that is absolute, or that leads outside that folder (also through a symbolic link), is
  refused with an error naming it. Move such files into the YAML's folder (subfolders are fine).
- `step pull` and `library pull`: a name whose file would land outside the target folder (for example through
  a symbolic link) is refused and named; nothing is written there.
- `step edit` keeps its temporary file in a private folder created for the edit and removes it afterwards.

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
