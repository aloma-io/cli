/**
 * Step: Send email for new contact
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
  googleAdded: true
};

export const content = async () => {
if (!data.sentence) {
  data.sentence = `Thank you for signing up for the waitlist! We will be in touch with you shortly with updates.`
}
connectors.eMailSmtpOAuth.sendEmail({
  to: `${data.email}`,
  subject: 'Your on the wait list!',
  html: `
  <p>Dear ${data.firstName},</p>

  <p>${data.sentence}</p>

  <p> Kind Regards, <br>
  The team </p>
  `
});
data.emailSent = true
};
