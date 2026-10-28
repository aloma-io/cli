// Mutation check for the security fixes: each mutant undoes one fix (or one layer of it), applied
// alone; the listed test files are run; the file is restored before the next mutant.
// A mutant is killed when at least one test fails.
//
//   node tests/helpers/run-security-mutations.mjs [--md] [IDs...]
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const AUTH = ["tests/auth-storage.test.js", "tests/auth-config.test.js", "tests/auth-signin.test.js", "tests/auth-security.test.js", "tests/auth-company.test.js", "tests/auth-logout.test.js", "tests/session-exchange.test.js"];
const PKG = ["tests/package-security.test.js"];
// PLAT-117: the HTTP client's own tests, the auth suites, and the company switch through the commands harness
const HTTP = ["tests/http.test.js", ...AUTH, "tests/commands-company-user.test.js"];

// [id, finding, file, description, from, to, tests]
const MUTANTS = [
  ["S01", 1, "src/paths.js", "config and session folder taken from the cwd's node_modules again",
    'return path.join(os.homedir(), ".config", "aloma");',
    'return path.join(process.cwd(), "node_modules", "@aloma.io", "aloma", ".config");', AUTH],
  ["S02", 1, "src/config.js", "configuration read from the cwd's package tree",
    'join(getConfigDir(), "config.json"),',
    'join(process.cwd(), "node_modules", "@aloma.io", "aloma", ".config", "config.json"),', AUTH],
  ["S03", 1, "src/paths.js", "legacy session imported from the cwd (not the running package)",
    'export const OWN_PACKAGE_ROOT = path.resolve(\n  path.dirname(fileURLToPath(import.meta.url)),\n  "..",\n);',
    'export const OWN_PACKAGE_ROOT = path.join(process.cwd(), "node_modules", "@aloma.io", "aloma");', AUTH],
  ["S04", 1, "src/utils.js", "no migration of an older version's session",
    "  await migrateLegacySession(dir);\n", "", AUTH],
  ["S05", 1, "src/utils.js", "migration overwrites an existing per-user session",
    'flag: "wx",', 'flag: "w",', AUTH],
  ["S06", 2, "src/utils.js", "migration leaves the world-readable old copy behind",
    "    await fs.unlink(legacyPath);\n", "", AUTH],
  ["S07", 2, "src/paths.js", "session file created 0644",
    "export const PRIVATE_FILE_MODE = 0o600;", "export const PRIVATE_FILE_MODE = 0o644;", AUTH],
  ["S08", 2, "src/paths.js", "config folder created 0755",
    "export const PRIVATE_DIR_MODE = 0o700;", "export const PRIVATE_DIR_MODE = 0o755;", AUTH],
  ["S09", 2, "src/paths.js", "existing files and folders never tightened",
    "if ((st.mode & 0o077) !== 0) await fs.chmod(file, mode);", "if (false) await fs.chmod(file, mode);", AUTH],
  ["S10", 2, "src/utils.js", "existing session file not tightened on read",
    "    await tighten(sessionPath, PRIVATE_FILE_MODE);\n    const sessionData", "    const sessionData", AUTH],
  ["S11", 3, "src/pull-safety.js", "containment removed entirely (segment and resolved-path checks)",
    "  const segments = name.split(\"/\");\n  for (const seg of segments) {",
    "  const segments = name.split(\"/\");\n  return path.join(folder, ...segments.slice(0, -1), `${segments[segments.length - 1]}.js`);\n  for (const seg of segments) {",
    ["tests/commands-step.test.js", "tests/commands-library.test.js"]],
  ["S12", 3, "src/pull-safety.js", "segment checks removed (resolved-path check kept)",
    '      seg === "" ||\n      seg === "." ||\n      seg === ".." ||\n      seg.includes("\\\\") ||\n      CONTROL.test(seg)',
    "      false", ["tests/commands-step.test.js", "tests/commands-library.test.js"]],
  ["S13", 3, "src/pull-safety.js", "resolved-path check removed (segment checks kept)",
    '    rel === "" ||\n    rel === ".." ||\n    rel.startsWith(`..${path.sep}`) ||\n    path.isAbsolute(rel)',
    "    false", ["tests/commands-step.test.js", "tests/commands-library.test.js"]],
  ["S14", 3, "src/pull-safety.js", "'*/' no longer stripped from header text",
    '    .replace(/\\*\\//g, "* /")\n', "", ["tests/commands-step.test.js", "tests/commands-library.test.js"]],
  ["S15", 3, "src/pull-safety.js", "line breaks no longer stripped from header text",
    '    .replace(/[\\r\\n\\u2028\\u2029]+/g, " ");', ";", ["tests/commands-step.test.js", "tests/commands-library.test.js"]],
  ["S16", 3, "src/commands/step/index.js", "step pull header uses the raw name and id",
    '  await fs.mkdir(path.dirname(filePath), { recursive: true });\n\n  const fileContent = `/**\n * Step: ${headerText(step.name)}\n * ID: ${headerText(step.id)}',
    '  await fs.mkdir(path.dirname(filePath), { recursive: true });\n\n  const fileContent = `/**\n * Step: ${step.name}\n * ID: ${step.id}',
    ["tests/commands-step.test.js"]],
  ["S17", 3, "src/commands/library/index.js", "library header uses the raw name and id",
    " * Library: ${headerText(library.name)}\n * ID: ${headerText(library.id)}", " * Library: ${library.name}\n * ID: ${library.id}", ["tests/commands-library.test.js"]],
  ["S18", 3, "src/commands/step/index.js", "an unsafe name aborts the whole pull instead of being skipped",
    "if (!(error instanceof UnsafeNameError)) throw error;", "throw error;", ["tests/commands-step.test.js"]],
  ["S19", 4, "package-lock.json", "js-yaml locked back at 4.1.0",
    '"node_modules/js-yaml": {\n      "version": "4.3.2"', '"node_modules/js-yaml": {\n      "version": "4.1.0"', PKG],
  ["S20", 4, ".github/workflows/test.yml", "audit step removed from CI",
    "      - name: Audit dependencies\n        run: npm audit --audit-level=low\n", "", PKG],
  ["S21", 4, ".github/workflows/publish.yml", "audit step removed before publish",
    "      - name: Audit dependencies\n        run: npm audit --audit-level=low\n", "", PKG],
  // PLAT-117: the transport rules live in src/http.js only; S22-S25, S29, S30 and S37 are the deliberate breaks.
  ["S22", 5, "src/http.js", "http.js lets fetch follow redirects (redirect: \"follow\")",
    'redirect: "manual",', 'redirect: "follow",', HTTP],
  ["S23", 5, "src/http.js", "http.js does not refuse a 3xx",
    "  refuseRedirect(response.status, what);\n", "", HTTP],
  ["S24", 5, "src/commands/auth/session.js", "session exchange skips http.js (calls fetch directly)",
    '  const response = await postJson(\n    url,\n    { id_token: idToken },\n    {\n      headers: { Accept: "application/json", "User-Agent": "Aloma CLI" },\n      what: "Aloma sign-in",\n    },\n  );',
    '  const response = await fetch(url, {\n    method: "POST",\n    redirect: "manual",\n    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "Aloma CLI" },\n    body: JSON.stringify({ id_token: idToken }),\n  });', HTTP],
  ["S25", 5, "src/utils.js", "graphQuery skips http.js (calls fetch directly)",
    "    return await graphql(query, variables, { auth: tokenData });",
    '    const response = await fetch(process.env.ALOMA_GRAPHQL_URL, {\n      method: "POST",\n      redirect: "manual",\n      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenData}` },\n      body: JSON.stringify({ query, variables }),\n    });\n    return (await response.json()).data;', HTTP],
  ["S26", 5, "src/net-security.js", "http accepted for any host",
    'if (u.protocol === "https:") return u;', 'if (u.protocol === "https:" || u.protocol === "http:") return u;', AUTH],
  ["S27", 5, "src/net-security.js", "loopback opt-in also allows non-loopback http",
    'process.env.ALOMA_ALLOW_HTTP_LOOPBACK === "1" &&\n    isLoopbackHost(u.hostname)', 'process.env.ALOMA_ALLOW_HTTP_LOOPBACK === "1"', AUTH],
  ["S28", 5, "src/net-security.js", "http allowed without the opt-in",
    'process.env.ALOMA_ALLOW_HTTP_LOOPBACK === "1" &&\n    isLoopbackHost(u.hostname)', "isLoopbackHost(u.hostname)", AUTH],
  ["S29", 5, "src/http.js", "assertSecureUrl removed from http.js",
    "  assertSecureUrl(url, `${what} URL`);\n", "", HTTP],
  ["S30", 5, "src/commands/company/index.js", "company switch skips http.js (calls fetch directly)",
    '    const response = await postJson(\n      `https://${GRAPHQL_HOST}/realm?realm=${encodeURIComponent(companyId)}`,\n      {},\n      { auth: await getSessionData("token"), what: "company switch" },\n    );',
    '    const response = await fetch(\n      `https://${GRAPHQL_HOST}/realm?realm=${encodeURIComponent(companyId)}`,\n      { method: "POST", redirect: "manual", headers: { Authorization: `Bearer ${await getSessionData("token")}` }, body: "{}" },\n    );', HTTP],
  ["S31", 6, "src/commands/auth/index.js", "callback listens on all interfaces",
    "srv.listen(callbackPort, host);", "srv.listen(callbackPort);", AUTH],
  ["S32", 6, "src/commands/auth/index.js", "non-loopback redirect URI accepted",
    '!u || u.protocol !== "http:" || !isLoopbackHost(u.hostname) || !u.port', "!u || !u.port", AUTH],
  ["S33", 6, "src/commands/auth/index.js", "error page not HTML-escaped",
    "<pre>${escapeHtml(err.message)}</pre>", "<pre>${err.message}</pre>", AUTH],
  ["S34", 7, "src/commands/secret/index.js", "plain values shown without --reveal",
    "          : reveal\n            ? secret.value\n            : HIDDEN_VALUE;", "          : secret.value;", ["tests/commands-webhook-secret.test.js"]],
  ["S35", 7, "src/cli.js", "--reveal ignored",
    "reveal: options.reveal === true,", "reveal: false,", ["tests/commands-webhook-secret.test.js"]],
  ["S36", 8, "package.json", "postinstall script restored",
    '"audit": "npm audit --audit-level=low"', '"audit": "npm audit --audit-level=low",\n    "postinstall": "node src/cli.js setup || true"', PKG],
  ["S37", 5, "src/http.js", "http.js follows a 3xx itself, attaching the auth to the redirect target",
    "  refuseRedirect(response.status, what);\n  return response;",
    '  const location = response.headers.get("location");\n  if (location) {\n    return fetch(new URL(location, url), {\n      method,\n      redirect: "manual",\n      headers: auth ? { ...headers, ...authHeaders(auth) } : headers,\n      body,\n    });\n  }\n  refuseRedirect(response.status, what);\n  return response;', HTTP],
];

const md = process.argv.includes("--md");
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const rows = [];
for (const [id, finding, file, desc, from, to, tests] of MUTANTS) {
  if (only.length && !only.includes(id)) continue;
  const abs = path.join(REPO, file);
  const orig = readFileSync(abs, "utf8");
  const n = orig.split(from).length - 1;
  if (n !== 1) {
    rows.push({ id, finding, file, desc, result: `NOT APPLIED (${n} matches)`, first: "" });
    continue;
  }
  writeFileSync(abs, orig.replace(from, to));
  let r;
  try {
    r = spawnSync(process.execPath, ["--test", ...tests], { cwd: REPO, encoding: "utf8", maxBuffer: 64 << 20 });
  } finally {
    writeFileSync(abs, orig);
  }
  const out = `${r.stdout}${r.stderr}`;
  const failed = [...out.matchAll(/^not ok \d+ - (.*)$/gm)].map((m) => m[1]);
  const killed = r.status !== 0;
  rows.push({ id, finding, file, desc, result: killed ? "killed" : "SURVIVED", first: failed[0] ?? "", count: failed.length });
  if (!md) console.log(`${id} ${killed ? "killed" : "SURVIVED"} ${desc}${failed[0] ? ` -> ${failed[0]}` : ""}`);
}
if (md) {
  console.log("| ID | Finding | File | Mutant (undoes the fix) | Result | Failing tests | First failing test |");
  console.log("|---|---|---|---|---|---|---|");
  for (const r of rows) console.log(`| ${r.id} | ${r.finding} | \`${r.file}\` | ${r.desc} | ${r.result} | ${r.count ?? ""} | ${r.first} |`);
}
const killed = rows.filter((r) => r.result === "killed").length;
console.log(`\n${killed} of ${rows.length} mutants killed`);
