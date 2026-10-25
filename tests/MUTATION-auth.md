# Mutation check: sign-in, session and token handling

Date: 2026-10-24. Suite: `node --test tests/*.test.js` (80 tests). Node 22.

Method: each mutation below is one single-point change to the product code, applied alone; the
whole suite is run; the file is restored before the next one (`git diff src` empty afterwards).
A mutation is **killed** when at least one test fails.

**Result: 24 killed / 24 total.**

| # | File | Mutation | Result | Tests that caught it (examples) |
|---|------|----------|--------|------------------------------|
| 1 | src/commands/auth/session.js | drop the `id-` session prefix check | KILLED | API answering with something that is not a session; an answer that is not a session is refused |
| 2 | src/commands/auth/session.js | ignore a refused (non-2xx) answer | KILLED | API refusing the exchange; a refused sign-in fails without echoing the token |
| 3 | src/commands/auth/session.js | put the ID token in the query string | KILLED | exchange: the ID token goes in the JSON body, not the URL (6 tests) |
| 4 | src/commands/auth/session.js | echo the ID token in the error message | KILLED | a refused sign-in fails without echoing the token |
| 5 | src/commands/auth/index.js | skip the `state` check on the callback | KILLED | a callback with the wrong state is refused; stray request aborts sign-in |
| 6 | src/commands/auth/index.js | stop passing `nonce` to the ID token checks | KILLED | happy path and 10 others (ID token refused) |
| 7 | src/commands/auth/index.js | PKCE `plain` instead of `S256` | KILLED | authorization request: code flow, PKCE S256 |
| 8 | src/commands/auth/index.js | fixed, predictable `state` | KILLED | authorization request; each sign-in uses a fresh state |
| 9 | src/commands/auth/index.js | store the login service's access token instead of the API session | KILLED | happy path; SECURITY access/refresh tokens are not stored (5 tests) |
| 10 | src/commands/auth/index.js | print the session token after sign-in | KILLED | SECURITY no token printed; SECURITY no log statement prints a token variable |
| 11 | src/commands/auth/index.js | accept a token set without an access token | KILLED | no access token from the login service |
| 12 | src/commands/auth/index.js | bind the callback server to 127.0.0.1 only (behaviour change) | KILLED | PINS SUSPECT callback listens on all interfaces |
| 13 | src/commands/auth/index.js | logout does not remove the session file | KILLED | signed in: session file removed (6 tests) |
| 14 | src/commands/auth/index.js | logout sends the session to the login service | KILLED | PINS SUSPECT logout sends no token anywhere |
| 15 | src/utils.js | create the session file owner-only, mode 0600 (behaviour change) | KILLED | SECURITY PINS SUSPECT session file is world-readable |
| 16 | src/utils.js | stop sending the `Authorization: Bearer` header | KILLED | company switch by ID; redirect/TLS checks (6 tests) |
| 17 | src/utils.js | return an empty property as-is instead of `null` | KILLED | reading: a missing or empty property gives null |
| 18 | src/utils.js | call the API with no stored session | KILLED | not signed in: refused locally with a sign-in hint (2 tests) |
| 19 | src/utils.js | overwrite a corrupt session file | KILLED | PINS SUSPECT corrupt session file makes sign-in fail; corrupt file refused |
| 20 | src/commands/company/index.js | keep `=` in the switched session cookie | KILLED | PINS SUSPECT cookie is parsed loosely |
| 21 | src/commands/company/index.js | do not store the switched session | KILLED | switch by ID; switch by name (3 tests) |
| 22 | src/commands/company/index.js | put the session in the `/realm` query string | KILLED | SECURITY the session is not put in the URL (4 tests) |
| 23 | src/config.js | session URL relative to the GraphQL path | KILLED | the session URL sits next to GraphQL |
| 24 | src/config.js | config file wins over `ALOMA_GRAPHQL_URL` | KILLED | environment overrides the file (8 tests) |

Mutations 12 and 15 are the fixes for two pinned suspect behaviours: they are expected to be
killed, and the pinned tests must be updated on purpose when those fixes are made.

Update (security fixes): mutations 12 and 15 above are now the fixes for those pinned behaviours; their pinned
tests were flipped to the fixed behaviour (callback on loopback only; session file 0600). See MUTATION-security.md.
