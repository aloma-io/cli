/**
 * Step: Update Hubspot with CTO research
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
  hubspotCreate: true,
  contactResearch: String
};

export const content = async () => {

const updateContact = await connectors.hubspotCom.request({
  url: `/crm/v3/objects/contacts/${data.result.id}`,
  options: {
    method: 'PATCH',
    body: {
      properties: {
        "research_profile": `${data.contactResearch}`
      }
    },
    headers: {
      'Content-type': 'application/json'
    },
  }
});
};
