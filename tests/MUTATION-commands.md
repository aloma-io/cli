# Mutation check: command regression tests

Result: **38 of 38 mutants killed** (single-point bugs, each applied alone, restored afterwards).

Re-run: `node tests/helpers/run-mutations.mjs --md` (mutation list lives in that script; it runs only the
`tests/commands-<group>*.test.js` files relevant to each mutant and restores the source file after every run).

One mutant (M21, `<` to `<=` in `task clone --step`) first survived an earlier draft of the tests; boundary
assertions (index equal to the history length, and -1) were added to `commands-task.test.js` and it is now killed.

Not covered by mutation or tests: the 10-second wait in `connector add` with tags/config when the new
connector is found in the list (would add 10 s per test), and the interactive arrow-key pickers of
`workspace switch` / `company switch` (need a TTY; only the non-TTY failure is pinned).

| ID | File | Bug | Result | First failing test |
|---|---|---|---|---|
| M01 | `commands/workspace/index.js` | workspace add no longer trims the name | killed | workspace add: creates, then selects the new workspace |
| M02 | `commands/workspace/index.js` | workspace delete sends delete=false | killed | workspace delete: starts deletion with the default 30 days |
| M03 | `commands/workspace/index.js` | workspace archive sends archive=false | killed | workspace archive / --unarchive |
| M04 | `commands/workspace/index.js` | -w <name> no longer resolved to the id | killed | -w <name>: resolves the name case-insensitively through the list query |
| M05 | `commands/workspace/index.js` | workspace update drops existing tags | killed | workspace update: only the given fields change, the rest come from the current state |
| M06 | `commands/workspace/index.js` | workspace sync no longer sets source_do_sync | killed | workspace sync: triggers a sync with source_do_sync and a blank apikey |
| M07 | `commands/workspace/index.js` | selected workspace is never read back from the session | killed | workspace list: sends the list query with no filters and marks the current workspace |
| M08 | `cli.js` | workspace update --health-enabled inverted | killed | workspace update: only the given fields change, the rest come from the current state |
| M09 | `cli.js` | workspace delete --days sent as a string | killed | workspace delete: starts deletion with the default 30 days |
| M10 | `commands/step/index.js` | step add -f saves the step disabled | killed | step add -f: parses the file, validates the condition, saves content as version 0 |
| M11 | `commands/step/index.js` | step delete sends the step id as the workspace | killed | step delete: sends id and workspace; reports success and refusal |
| M12 | `commands/step/index.js` | step sync -s: confirmation inverted | killed | step sync -s <id>: syncs one step from <path>/<last name segment>.js |
| M13 | `commands/step/index.js` | step sync keeps the .js extension in the step name | killed | step sync (all): updates matching names, creates the rest, after one y/N prompt |
| M14 | `commands/step/index.js` | step pull skips disabled steps | killed | step pull (all): lists with includeDisabled, fetches each, writes <name>.js into the cwd |
| M15 | `commands/step/index.js` | step pull flattens nested step names | killed | step pull (all): lists with includeDisabled, fetches each, writes <name>.js into the cwd |
| M16 | `commands/library/index.js` | library add -f saves with version 1 | killed | library add: creates the library; with --file also saves types and content |
| M17 | `commands/library/index.js` | library parser joins statements with a space | killed | library add: creates the library; with --file also saves types and content |
| M18 | `commands/library/index.js` | library sync derives the namespace from the wrong segment | killed | library sync (all): updates by name, creates new ones with the first path segment as namespace |
| M19 | `commands/library/index.js` | library update ignores --enabled | killed | library update: only the given fields change; content/types/version come from the stored library |
| M20 | `commands/task/index.js` | task list pages off by one | killed | task list: first page, 10 per page, prints status/duration/steps/tags/created |
| M21 | `commands/task/index.js` | task clone --step accepts one index too many | killed | task clone --step: out-of-range step; API error |
| M22 | `commands/task/index.js` | task new -f no longer reads .json files | killed | task new -f: .json and .yaml/.yml files |
| M23 | `commands/webhook/index.js` | webhook list exits 0 on error | killed | webhook list: errors exit with code 1 |
| M24 | `commands/webhook/index.js` | webhook list prints the URL without the key | killed | webhook list: prints each webhook with its URL (no region) |
| M25 | `commands/secret/index.js` | secret delete keeps the secret | killed | secret delete: removes the key and saves the rest |
| M26 | `commands/secret/index.js` | secret add ignores --encrypted | killed | secret add: merges the new secret into the existing config and saves the whole object |
| M27 | `commands/user/utils.js` | admin role no longer adds the admin group | killed | user invite --roles admin,business adds their groups without duplicates |
| M28 | `commands/user/index.js` | owners can no longer manage users | killed | user list: empty company, and permission check (owner allowed, developer refused) |
| M29 | `commands/company/index.js` | company list marks the wrong company | killed | company list: numbers the companies and marks the current one |
| M30 | `commands/company/index.js` | company switch stores the token with its Bearer%20 prefix | killed | company switch <name>: posts to the realm endpoint, stores the new token and resets the workspace |
| M31 | `commands/connector/index.js` | connector update: flag beats file for the name | killed | connector update --file (JSON and YAML): file values override command-line flags |
| M32 | `commands/connector/index.js` | connector config encrypted for the wrong audience | killed | connector update --config: values are encrypted for the connector's market id, plain fields are not |
| M33 | `commands/connector/index.js` | connector list-available asks only for my connectors | killed | connector list-available: uses the selected workspace, mine=false, empty name by default |
| M34 | `commands/deploy/index.js` | deploy library namespace from the wrong segment | killed | deploy: libraries — namespace defaults to the first path segment of the name |
| M35 | `commands/deploy/index.js` | deploy syncPath asks for confirmation | killed | deploy: steps from name+file and from syncPath (no prompt) |
| M36 | `utils.js` | requests send the wrong Authorization scheme | killed | every request is a POST with JSON body, bearer header and cookie |
| M37 | `utils.js` | GraphQL errors are ignored | killed | workspace list: empty result and API error |
| M38 | `cli.js` | library add --enabled inverted | killed | library add: creates the library; with --file also saves types and content |
