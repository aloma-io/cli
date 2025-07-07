/**
 * Step: New cli step
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
 * content = () => {
 *   console.log('running step');
 *   data.newStep = true;
 * };
 */

export const condition = {
  "cliStep": true,
  "Step": 1
};

export const content = () => {
  console.log("running a cli updated step");
  const message = "This is a test message ";
  console.log(message);
  task.complete();
};