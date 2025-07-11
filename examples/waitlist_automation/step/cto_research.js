/**
 * Step: CTO research
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
  jobTitle: "CTO",
  hubspotCreate: true
};

export const content = async () => {

const profilePrompt = `You are the founder of Aloma.io and a CTO has joined your waitlist for your product launch. You would like to research about the CTO.

  Please research ${data.firstName} ${data.lastName}, ${data.jobTitle} at ${data.company} and write a 50 word summary of their achievements, code contributions, career and notable press references.

  Please use LinkedIn, Reddit, GitHub, ${data.company} website and all other available research to prepare the report.

  Important: If specific requested information is not found, do not assume or generate it and do not state nothing is available. Do not add any Notes. Do not add sources. Please use UK British language.`;

const response = await connectors.perplexity.chat({
  model: 'sonar-pro',
  messages: [
    {
      role: "user",
      content: profilePrompt
    }
  ],
  stream: false
});

data.contactResearch = response.choices?.[0]?.message?.content;

data.sentence = `Thank you for taking the time to express your interest in Aloma, we really appreciate it. Our founder will reach out shortly with additional information about our new, rapid iteration approach to automation.`
};
