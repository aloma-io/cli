/**
 * Step: Example Step
 * ID: example-123
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

export const condition = {
  "status": "active",
  "type": "example"
};

export const content = async () => {
  console.log('Running example step');
  data.processed = true;
  data.timestamp = new Date().toISOString();
}; 