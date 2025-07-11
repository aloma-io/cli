/**
 * Step: Post to slack when new contact
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
  emailSent: true
};

export const content = async () => {
  const slackChannel = task.config("SLACK_CHANNEL")
data.message = data.firstName + ' ' + data.lastName + ' ' + ' requested to join the wait list';

connectors.slackCom.send({ text: data.message, channel: slackChannel })

task.complete()
};
