# Mutation check: security fixes

Date: 2026-10-24. Re-run: `node tests/helpers/run-security-mutations.mjs --md` (mutant list in that script; each
mutant is applied alone, the relevant test files run, the file restored).

Each mutant undoes one fix, or one layer of it. A mutant is killed when at least one test fails.

**Result: 36 of 37 killed.** S13 survives by design: it removes the second containment layer (the resolved-path
check) while the segment checks stay, and on POSIX no name passes the segment checks yet resolves outside the
target, so it is an equivalent mutant. The layer is kept as defence in depth (it is what holds if a segment rule
is ever loosened). S11 (both layers removed) and S12 (segment checks removed) are killed.

PLAT-117 (2026-10-28): the transport rules moved into `src/http.js`; S22-S25, S29 and S30 were retargeted at it and
S37 added (the four deliberate breaks: a call site calling fetch directly, `redirect: "follow"`, `assertSecureUrl`
removed, auth sent to a redirect target). Those seven were re-run alone (`... S22 S23 S24 S25 S29 S30 S37`): 7 of 7
killed. The other rows are from 2026-10-24. The failing-test count of the re-run rows is not recorded.

The held command-suite mutation check (`run-mutations.mjs`) still kills 38 of 38 against the fixed code; M15 was
re-targeted to the new pull code (the line it mutated was replaced by the containment fix).

| ID | Finding | File | Mutant (undoes the fix) | Result | Failing tests | First failing test |
|---|---|---|---|---|---|---|
| S01 | 1 | `src/paths.js` | config and session folder taken from the cwd's node_modules again | killed | 65 | switch by ID: asks for the company's session, stores it, picks a workspace with it |
| S02 | 1 | `src/config.js` | configuration read from the cwd's package tree | killed | 40 | switch by ID: asks for the company's session, stores it, picks a workspace with it |
| S03 | 1 | `src/paths.js` | legacy session imported from the cwd (not the running package) | killed | 4 | SECURITY: a config and session planted in the current directory's node_modules are ignored |
| S04 | 1 | `src/utils.js` | no migration of an older version's session | killed | 2 | migration: a session kept by an older version in the installed package moves to HOME, owner-only |
| S05 | 1 | `src/utils.js` | migration overwrites an existing per-user session | killed | 1 | migration: an existing HOME session wins; the old copy is still removed |
| S06 | 2 | `src/utils.js` | migration leaves the world-readable old copy behind | killed | 2 | migration: a session kept by an older version in the installed package moves to HOME, owner-only |
| S07 | 2 | `src/paths.js` | session file created 0644 | killed | 5 | the session token is written as plain JSON in an owner-only file |
| S08 | 2 | `src/paths.js` | config folder created 0755 | killed | 2 | SECURITY: the session file is created owner-only (0600) in an owner-only folder (0700) |
| S09 | 2 | `src/paths.js` | existing files and folders never tightened | killed | 3 | SECURITY: the session file is created owner-only (0600) in an owner-only folder (0700) |
| S10 | 2 | `src/utils.js` | existing session file not tightened on read | killed | 1 | SECURITY: an existing world-readable session file and folder are made owner-only on read |
| S11 | 3 | `src/pull-safety.js` | containment removed entirely (segment and resolved-path checks) | killed | 5 | SECURITY: library pull never writes outside the target folder |
| S12 | 3 | `src/pull-safety.js` | segment checks removed (resolved-path check kept) | killed | 3 | SECURITY: library pull: a name with control characters (newlines) is skipped |
| S13 | 3 | `src/pull-safety.js` | resolved-path check removed (segment checks kept) | SURVIVED | 0 |  |
| S14 | 3 | `src/pull-safety.js` | '*/' no longer stripped from header text | killed | 2 | SECURITY: library pull: name and id cannot break out of the header comment |
| S15 | 3 | `src/pull-safety.js` | line breaks no longer stripped from header text | killed | 2 | SECURITY: library pull: name and id cannot break out of the header comment |
| S16 | 3 | `src/commands/step/index.js` | step pull header uses the raw name and id | killed | 1 | SECURITY: step pull: name and id cannot break out of the header comment |
| S17 | 3 | `src/commands/library/index.js` | library header uses the raw name and id | killed | 1 | SECURITY: library pull: name and id cannot break out of the header comment |
| S18 | 3 | `src/commands/step/index.js` | an unsafe name aborts the whole pull instead of being skipped | killed | 2 | SECURITY: step pull never writes outside the target folder |
| S19 | 4 | `package-lock.json` | js-yaml locked back at 4.1.0 | killed | 1 | SECURITY: js-yaml is locked at a patched version (>= 4.3.2) |
| S20 | 4 | `.github/workflows/test.yml` | audit step removed from CI | killed | 1 | SECURITY: the test workflow runs npm audit and installs with --ignore-scripts |
| S21 | 4 | `.github/workflows/publish.yml` | audit step removed before publish | killed | 1 | SECURITY: the publish workflow audits before publishing |
| S22 | 5 | `src/http.js` | http.js lets fetch follow redirects (redirect: "follow") | killed | | SECURITY: a redirect to another host is refused; the session is not forwarded |
| S23 | 5 | `src/http.js` | http.js does not refuse a 3xx | killed | | SECURITY: a redirect to another host is refused; the session is not forwarded |
| S24 | 5 | `src/commands/auth/session.js` | session exchange skips http.js (calls fetch directly) | killed | | SECURITY: only src/http.js sends HTTP requests; no file imports node-fetch or axios |
| S25 | 5 | `src/utils.js` | graphQuery skips http.js (calls fetch directly) | killed | | switch by ID: asks for the company's session, stores it, picks a workspace with it |
| S26 | 5 | `src/net-security.js` | http accepted for any host | killed | 4 | SECURITY: the exchange refuses a plain-http session URL that is not loopback |
| S27 | 5 | `src/net-security.js` | loopback opt-in also allows non-loopback http | killed | 2 | SECURITY: the exchange refuses a plain-http session URL that is not loopback |
| S28 | 5 | `src/net-security.js` | http allowed without the opt-in | killed | 2 | SECURITY: without the loopback opt-in even a loopback http session URL is refused |
| S29 | 5 | `src/http.js` | assertSecureUrl removed from http.js | killed | | SECURITY: only src/http.js sends HTTP requests; no file imports node-fetch or axios |
| S30 | 5 | `src/commands/company/index.js` | company switch skips http.js (calls fetch directly) | killed | | SECURITY: an untrusted certificate is refused; the session is not sent |
| S31 | 6 | `src/commands/auth/index.js` | callback listens on all interfaces | killed | 1 | SECURITY: the callback server listens on loopback only |
| S32 | 6 | `src/commands/auth/index.js` | non-loopback redirect URI accepted | killed | 1 | SECURITY: a redirect URI that is not loopback http is refused before anything listens |
| S33 | 6 | `src/commands/auth/index.js` | error page not HTML-escaped | killed | 1 | SECURITY: an error from the login service is HTML-escaped in the page |
| S34 | 7 | `src/commands/secret/index.js` | plain values shown without --reveal | killed | 2 | SECURITY: secret list masks plain values by default, hides encrypted ones |
| S35 | 7 | `src/cli.js` | --reveal ignored | killed | 1 | secret list --reveal shows plain values (encrypted ones stay hidden) |
| S36 | 8 | `package.json` | postinstall script restored | killed | 1 | SECURITY: the package has no install-time scripts |
| S37 | 5 | `src/http.js` | http.js follows a 3xx itself, attaching the auth to the redirect target | killed | | SECURITY: a redirect to another host is refused; the session is not forwarded |

35 of 36 mutants killed
