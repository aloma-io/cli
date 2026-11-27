// Cut the condition and content out of a step file exactly as written (PLAT-287). The text is
// sliced from the source by position, never regenerated, so it is the text that gets validated and pushed.
import parser from "@babel/parser";

// The file lays a content body out as `{\n<body>\n}`: one line break after the brace and one before the
// closing brace (with the indent of that brace) are layout, everything else is the body.
const layoutBreaks = (inner) =>
  inner.replace(/^\r?\n/, "").replace(/\r?\n[ \t]*$/, "");

export function splitStepSource(source) {
  const ast = parser.parse(source, {
    sourceType: "module",
    plugins: [
      "jsx",
      "asyncGenerators",
      "classProperties",
      "dynamicImport",
      "objectRestSpread",
    ],
  });

  let condition = null;
  let content = null;

  for (const node of ast.program.body) {
    if (
      node.type !== "ExportNamedDeclaration" ||
      node.declaration?.type !== "VariableDeclaration"
    ) {
      continue;
    }
    for (const decl of node.declaration.declarations) {
      if (decl.id.name === "condition" && decl.init) {
        condition = source.slice(decl.init.start, decl.init.end);
      }
      if (
        decl.id.name === "content" &&
        decl.init?.type === "ArrowFunctionExpression"
      ) {
        const body = decl.init.body;
        content =
          body.type === "BlockStatement"
            ? layoutBreaks(source.slice(body.start + 1, body.end - 1))
            : source.slice(body.start, body.end);
      }
    }
  }

  if (condition === null)
    throw new Error("Could not parse condition from file");
  // As before: a content function with nothing in it is "no content", not an empty step
  if (content === null || content.trim() === "")
    throw new Error("Could not parse content from file");
  return { condition, content };
}
