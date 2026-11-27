// The step descriptor (PLAT-118): how the one pull / sync / ensure engine lists, reads, creates, saves,
// writes and parses steps. A step is keyed by its name (unique per workspace, PLAT-115/116).
import fs from "fs/promises";
import { graphQuery } from "../utils.js";
import { splitStepSource } from "../step-source.js";
import { pullTargetFile, headerText } from "../pull-safety.js";
import {
  LIST_STEPS_QUERY,
  CREATE_STEP_MUTATION,
  GET_STEP_QUERY,
  SAVE_STEP_MUTATION,
  VALIDATE_IF_QUERY,
} from "../commands/step/query.js";

// Parse a step file: `export const condition = {...}` and `export const content = async () => {...}`.
// The condition is checked by the backend (a read).
export async function parseStepFile(filePath) {
  try {
    const fileContent = await fs.readFile(filePath, "utf8");
    // The text as written: what is validated below is what the caller pushes (PLAT-287)
    const { condition: conditionStr, content: contentStr } =
      splitStepSource(fileContent);

    // Validate the condition using the backend
    const validateRes = await graphQuery(VALIDATE_IF_QUERY, {
      content: conditionStr,
    });
    if (!validateRes.validateAutomationIf) {
      throw new Error("Condition is invalid, not a valid JSON object");
    }
    return {
      condition: conditionStr,
      content: contentStr,
    };
  } catch (error) {
    throw new Error(`Error parsing step file. ${error.message}`);
  }
}

function renderStepFile(step) {
  return `/**
 * Step: ${headerText(step.name)}
 * ID: ${headerText(step.id)}
 * 
 * Edit the condition and content below.
 * The condition should be a valid JavaScript object (trailing commas are allowed).
 * The content should be JavaScript code that will be executed.
 * 
 * Example:
 * condition = {
 *   newStep: true,  // trailing commas are fine
 *   status: "active"
 * };
 * 
 * content = async () => {
 *   console.log('running step');
 *   data.newStep = true;
 * };
 */

export const condition = ${step.content?.if || "{}"};

export const content = async () => {
${step.content?.do || ""}
};
`;
}

export const stepResource = {
  kind: "step",
  plural: "steps",
  title: "Step",
  titlePlural: "Steps",

  // Every step in the workspace, disabled ones too: what step names are resolved against (PLAT-115).
  async list(workspaceId) {
    const data = await graphQuery(LIST_STEPS_QUERY, {
      id: workspaceId,
      includeDisabled: true,
    });
    return data.listAutomationSteps || [];
  },

  async get(id) {
    const data = await graphQuery(GET_STEP_QUERY, { id });
    return data.getAutomationStep;
  },

  async create(name, workspaceId, desired = {}) {
    const data = await graphQuery(CREATE_STEP_MUTATION, {
      name,
      environment_id: workspaceId,
      nocode_type: desired.nocode_type ?? null,
    });
    return data.createAutomationStep;
  },

  async save(vars) {
    const data = await graphQuery(SAVE_STEP_MUTATION, vars);
    return data.saveAutomationStep;
  },

  filePath: (name, folder) => pullTargetFile(name, folder, "step"),
  render: renderStepFile,
  parse: parseStepFile,
  key: (desired) => desired.name,

  // A step just created: enabled, version 0, no nocode or config content.
  blank: (id, name) => ({
    id,
    name,
    enabled: true,
    version: 0,
    nocode_content: null,
    config_content: null,
  }),

  // The save variables for `step` with the desired condition, content and enabled flag laid over it.
  saveVars: (step, desired = {}) => ({
    id: step.id,
    name: step.name,
    if: desired.condition ?? step.content?.if ?? "{}",
    do: desired.content ?? step.content?.do ?? "",
    enabled: desired.enabled ?? step.enabled,
    version: step.version,
    nocode_content: step.nocode_content,
    config_content: step.config_content,
  }),

  // A new step is only saved when there is content for it (step add without -f creates an empty step).
  saveAfterCreate: (desired) => desired.condition !== undefined,
};
