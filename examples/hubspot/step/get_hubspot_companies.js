/**
 * Step: get hubspot companies
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
  getCompanies: true,
};

export const content = async () => {
const body = {    
  limit: 15,
  properties: ['name', 'description', 'linkedin_company_page', 'website','country', 'industry']
};


const hubspotCompanies = await connectors.hubspotCom.request({
  url: `/crm/v3/objects/companies/search`,
  options: {
    method: 'POST',
    headers: {
      "Content-type": "application/json"
    },
    body: body
  }
})

console.log('hubspotCompanies', hubspotCompanies);

if (hubspotCompanies.total === 0 || hubspotCompanies.results.length === 0) {
  console.log("No companies found. Ending task.");
  task.complete();
}

data.hubspotCompanies = hubspotCompanies.results
data.getContacts = true
};
