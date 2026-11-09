// Loaded with --import next to the fetch preload: gives a piped stdin a no-op setRawMode, so the
// arrow-key picker can be driven by the keys a test sends to the child's stdin.
process.stdin.setRawMode = () => process.stdin;
