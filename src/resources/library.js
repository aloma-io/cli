// The library descriptor (PLAT-118): how the one pull / sync / ensure engine lists, reads, creates, saves,
// writes and parses libraries. A library is keyed by its name alone (unique per workspace, PLAT-115/116):
// the namespace is not given at create time and can be changed later, so it is an attribute, not the key.
import fs from "fs/promises";
import parser from "@babel/parser";
import generate from "@babel/generator";
import { graphQuery } from "../utils.js";
import { pullTargetFile, headerText } from "../pull-safety.js";
import {
  LIST_AUTOMATION_LIBS_QUERY,
  ADD_AUTOMATION_LIB_MUTATION,
  UPDATE_AUTOMATION_LIB_MUTATION,
  GET_AUTOMATION_LIB_QUERY,
} from "../commands/library/query.js";

// Parse a library file: `export const types = () => { return `...`; }` and `export const content = () => {...}`.
export async function parseLibraryFile(filePath) {
  try {
    const fileContent = await fs.readFile(filePath, "utf8");
    const ast = parser.parse(fileContent, {
      sourceType: "module",
      plugins: [
        "jsx",
        "asyncGenerators",
        "classProperties",
        "dynamicImport",
        "objectRestSpread",
      ],
    });

    let typesStr = null;
    let contentStr = null;

    for (const node of ast.program.body) {
      // Extract export const types = ...
      if (
        node.type === "ExportNamedDeclaration" &&
        node.declaration &&
        node.declaration.type === "VariableDeclaration"
      ) {
        for (const decl of node.declaration.declarations) {
          if (decl.id.name === "types") {
            // Handle types as a function that returns a string
            if (
              decl.init.type === "ArrowFunctionExpression" ||
              decl.init.type === "FunctionExpression"
            ) {
              // Extract the return statement content
              const body = decl.init.body;
              if (body.type === "BlockStatement") {
                // Look for return statement
                for (const stmt of body.body) {
                  if (stmt.type === "ReturnStatement" && stmt.argument) {
                    typesStr = generate.default(stmt.argument).code;
                    // Remove quotes if it's a string literal, but preserve template literals
                    if (typesStr.startsWith('"') && typesStr.endsWith('"')) {
                      typesStr = typesStr.slice(1, -1);
                    } else if (
                      typesStr.startsWith("'") &&
                      typesStr.endsWith("'")
                    ) {
                      typesStr = typesStr.slice(1, -1);
                    } else if (
                      typesStr.startsWith("`") &&
                      typesStr.endsWith("`")
                    ) {
                      // Keep template literal as-is, just remove the backticks
                      typesStr = typesStr.slice(1, -1);
                    }
                    break;
                  }
                }
              } else if (body.type === "StringLiteral") {
                // Arrow function with implicit return
                typesStr = body.value;
              }
            } else if (decl.init.type === "StringLiteral") {
              // Fallback: direct string assignment
              typesStr = decl.init.value;
            }
          }
          if (decl.id.name === "content") {
            // Handle content as a function that contains the code
            if (
              decl.init.type === "ArrowFunctionExpression" ||
              decl.init.type === "FunctionExpression"
            ) {
              const body = decl.init.body;
              if (body.type === "BlockStatement") {
                // Extract all statements and convert them to code
                const statements = body.body.map(
                  (stmt) => generate.default(stmt).code,
                );
                contentStr = statements.join("\n");
              } else if (body.type === "StringLiteral") {
                // Arrow function with implicit return
                contentStr = body.value;
              }
            } else if (decl.init.type === "StringLiteral") {
              // Fallback: direct string assignment
              contentStr = decl.init.value;
            }
          }
        }
      }
    }

    if (!typesStr) throw new Error("Could not parse types from file");
    if (!contentStr) throw new Error("Could not parse content from file");

    return {
      types: typesStr,
      content: contentStr,
    };
  } catch (error) {
    throw new Error(`Error parsing library file. ${error.message}`);
  }
}

function renderLibraryFile(library) {
  return `/**
 * Library: ${headerText(library.name)}
 * ID: ${headerText(library.id)}
 * 
 * Edit the types and content below.
 * The types should be a function that returns type definitions.
 * The content should be JavaScript code with function implementations and exports.
 * 
 * Example:
 * types = () => {
 *   return "function processData(data: any): any";
 * };
 * 
 * content = () => {
 *   const processData = (data) => {
 *     return data.map(item => ({ ...item, processed: true }));
 *   };
 *   module.exports = { processData };
 * };
 */

export const types = () => {
  return \`${library.types || ""}\`;
};

export const content = () => {
${library.content.content || ""}
};
`;
}

// A new library's namespace when none is given: the first segment of its name.
export const defaultNamespace = (name) => name.split("/")[0] || "default";

export const libraryResource = {
  kind: "library",
  plural: "libraries",
  title: "Library",
  titlePlural: "Libraries",

  // Every library in the workspace: what library names are resolved against (PLAT-115).
  async list(workspaceId) {
    const data = await graphQuery(LIST_AUTOMATION_LIBS_QUERY, {
      id: workspaceId,
    });
    return data.listAutomationLibs || [];
  },

  async get(id) {
    const data = await graphQuery(GET_AUTOMATION_LIB_QUERY, { id });
    return data.getAutomationLib;
  },

  async create(name, workspaceId) {
    const data = await graphQuery(ADD_AUTOMATION_LIB_MUTATION, {
      name,
      environment_id: workspaceId,
    });
    return data.createAutomationLib;
  },

  async save(vars) {
    const data = await graphQuery(UPDATE_AUTOMATION_LIB_MUTATION, vars);
    return data.saveAutomationLib;
  },

  filePath: (name, folder) => pullTargetFile(name, folder, "library"),
  render: renderLibraryFile,
  parse: parseLibraryFile,
  key: (desired) => desired.name,

  // A library just created: no content yet, version 0, no tags, enabled, namespace from the name.
  blank: (id, name) => ({
    id,
    name,
    namespace: defaultNamespace(name),
    content: { content: "" },
    types: "",
    version: 0,
    tags: [],
    enabled: true,
  }),

  // The save variables for `library` with the desired fields laid over it.
  saveVars: (library, desired = {}) => ({
    id: library.id,
    name: library.name,
    namespace: desired.namespace ?? library.namespace,
    content: desired.content ?? library.content?.content ?? "",
    types: desired.types ?? library.types ?? "",
    version: library.version,
    tags: desired.tags ?? library.tags ?? [],
    enabled: desired.enabled ?? library.enabled,
  }),

  // A new library is always saved: its namespace, tags and enabled flag only reach the API that way (M17).
  saveAfterCreate: () => true,
};
