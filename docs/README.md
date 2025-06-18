# aloma Package Documentation

This document outlines the structure and decisions for the `aloma` package. This package provides utilities and a CLI for interacting with Aloma services.

## Project Structure

- `/src/cli.js`: The entry point for the `aloma` command-line interface.
- `/src/auth.js`: Contains the logic for Keycloak OAuth authentication and secure token storage.
- `/src/metrics.js`: Contains mock task data and functions to display formatted metrics tables in the console.
- `/src/logs.js`: Implements a log tailing system with random log generation for simulating real-time task logs.
- `/src/setup.js`: Implements project creation functionality for generating new Aloma automation projects.
- `/index.js`: The main entry point for using the package as a Node.js module.
- `/package.json`: NPM package configuration, including dependencies and CLI definition.
- `/node_modules/`: Directory where dependencies are installed.
- `/docs/README.md`: This documentation file.
- `/tests/`: Directory containing test files.

## Files

- **src/cli.js**: Implements the command-line interface using `commander`. Defines `auth`, `logout`, `status`, `metrics`, `logs`, and `create` commands, delegating logic to respective files.
- **src/auth.js**: Handles the OAuth 2.0 Authorization Code flow with PKCE:
    - Uses `openid-client@4.9.1` to discover Keycloak endpoints and handle the protocol.
    - Starts a temporary local HTTP server to receive the callback from Keycloak.
    - Uses `open` to launch the user's browser for login.
    - Uses `keytar` to securely store the obtained token (currently access token) in the system keychain.
    - Implements a fallback mechanism to store the token in `~/.aloma/token` if keychain access fails.
    - Configured to use the development Keycloak instance at `accounts-dev.aloma.io`.
    - Contains placeholders for `CLIENT_ID` that **can be configured** if needed.
- **src/metrics.js**: Contains mock task data and functions to display formatted metrics tables in the console.
- **src/logs.js**: Implements a log tailing system with random log generation for simulating real-time task logs.
- **src/setup.js**: Handles the creation of new Aloma automation projects:
    - Creates a project directory with a predefined structure.
    - Initializes a new npm project with the necessary dependencies.
    - Generates template files including example automations, configuration, and documentation.
    - Uses `ora` for displaying progress spinners during project creation.
    - Uses `chalk` for colorized console output.
- **index.js**: Contains exported functions for programmatic use (currently placeholder `helloAloma`).
- **package.json**: Defines metadata, dependencies (`commander`, `open`, `openid-client@4.9.1`, `keytar`, `chalk`, `ora`), the `bin` entry (`aloma`), and `setup` script.
- **tests/test-openid.js**: Test script to verify that the `openid-client` module loads correctly.

## CLI Usage

Running `aloma` with no arguments (or with `-h` or `--help`) displays the main help message.

### Authentication (`aloma auth` or `aloma login`)

Initiates the browser-based OAuth 2.0 Authorization Code flow with Keycloak.
1.  Starts a local server on `http://localhost:8989` (defined in `auth.js`).
2.  Displays the authentication URL in the console and attempts to open your default browser automatically. If automatic opening fails, you can copy and paste the URL manually.
3.  After successful login, Keycloak redirects back to the local server.
4.  The server receives the authorization code, exchanges it for tokens.
5.  The access token (or other configured token) is stored securely. It first attempts to use the system keychain (`keytar`). If that fails, it falls back to storing the token in a file at `~/.aloma/token`.
6.  A success message is printed, and the local server shuts down.

**Requires Configuration:**
-   The Keycloak Realm URL is pre-configured to use the development environment at `accounts-dev.aloma.io/realms/master`.
-   The CLIENT_ID is set to `graph` but can be changed if needed.
-   The Keycloak client specified by `CLIENT_ID` **must** have `http://localhost:8989` listed as a valid Redirect URI.
-   The Keycloak client should ideally be configured as 'public' (no client secret required). The code assumes this by default but can be adjusted if a `CLIENT_SECRET` is provided in `src/auth.js`.

### Logout (`aloma logout`)

Removes the stored Aloma token from both the system keychain (`keytar`) and the fallback file (`~/.aloma/token`).

### Status (`aloma status` or `aloma whoami`)

Checks if a token is currently stored, first checking the system keychain (`keytar`) and then the fallback file (`~/.aloma/token`). Prints the status (Authenticated or Not authenticated).

Additionally, displays a comprehensive overview of your automation tasks and their metrics including:
- Task status table showing ID, name, status, type, last run time, next run time, and success rate
- Detailed metrics showing task performance, durations, error counts, and data processed
- System overview with aggregate statistics

Options:
- `-m, --metrics-only`: Display only metrics without checking authentication
- `-a, --auth-only`: Display only authentication status without metrics

### Metrics (`aloma metrics`)

Dedicated command to display task metrics and system overview without checking authentication status. Shows the same metrics tables as the `status` command with the metrics-only option.

### Logs (`aloma logs [taskId]`)

Displays and tails logs for a specific task in real-time with simulated random log generation.

When run with a task ID:
- Shows a continuous stream of simulated logs for the specified task
- Each log has a timestamp, level indicator (with emoji), colored log level, task ID, and message
- The log content is contextually related to the task type
- Logs will continue to stream until interrupted with Ctrl+C

When run without a task ID, lists all available tasks and their IDs.

Options:
- `-i, --interval <ms>`: Set the interval between log entries in milliseconds (default: 1000ms)
- `-l, --limit <number>`: Limit the number of log entries to display (default: unlimited)
- `-f, --filter <level>`: Filter logs by level (INFO, DEBUG, WARN, ERROR, SUCCESS)

Examples:
```
aloma logs                    # List all available tasks
aloma logs task1              # Tail logs for task1
aloma logs task2 --interval 500   # Tail logs for task2 with faster output
aloma logs task3 --limit 20       # Show only 20 log entries
aloma logs task4 --filter ERROR   # Show only ERROR level logs
```

### Create (`aloma create <name>`)

Creates a new Aloma automation project with a predefined structure and template files.

When run with a project name:
- Creates a directory with the specified project name (or custom directory with `--directory` option)
- Initializes a new npm project with the Aloma dependency
- Generates template files including example automations, configuration, and a README
- Creates a standard project structure with directories for automations, config, and logs

Options:
- `-d, --directory <path>`: Set a custom directory path for the project (default: project name)
- `-f, --force`: Overwrite existing directory if it already exists

Examples:
```
aloma create my-automation          # Create a new project in ./my-automation
aloma create tasks --directory ./projects/tasks   # Create in a custom directory
aloma create backup --force         # Overwrite existing directory
```

The project structure created includes:
- `/automations/`: Directory for automation task definitions with an example task
- `/config/`: Directory for configuration files with a default config
- `/logs/`: Directory for log files (created automatically)
- `index.js`: Main entry point that initializes the Aloma engine
- `package.json`: NPM package configuration with Aloma dependency
- `.gitignore`: Default git ignore file
- `README.md`: Documentation with usage instructions

### Local Development Testing

1.  Navigate to the `aloma-io` directory.
2.  Configure `KEYCLOAK_REALM_URL` and `CLIENT_ID` in `auth.js`.
3.  Run `npm run link-global` (or `npm link`).
4.  Run commands like `aloma auth`, `aloma status`, `aloma logout`.
5.  To remove the link: `npm unlink aloma`.

## Decisions

- **Package Name**: `aloma`.
- **CLI Implementation**: Using `commander`.
- **Authentication Strategy**: OAuth 2.0 Authorization Code flow with PKCE via a local HTTP server callback. This is a standard and secure method for CLI apps.
    - Dependencies: `openid-client@4.9.1` for robust OIDC handling, `open` for browser interaction.
- **Token Storage**: Using `keytar` to leverage secure system credential storage (Keychain on macOS, Credential Manager on Windows, etc.). Implemented a fallback to storing the token in `~/.aloma/token` if keychain access fails, similar to the strategy mentioned in the WorkOS blog post. Service name: `aloma-cli`.
- **Modularity**: Separated authentication logic into `auth.js`.
- **Metrics Display**: Implemented colorful, formatted tables to show task metrics with intuitive status colors.
- **Log Tailing**: Created a simulated log tailing system with contextual log messages for each task type.
- **Project Creation**: Implemented a scaffolding system in `setup.js` to generate new Aloma automation projects with a standardized structure and example code, improving the developer experience for new users.