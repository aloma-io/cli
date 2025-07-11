/**
 * Step: Add contact to Hubspot
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
  "$via": {
    name: "Webform"
  }
};

export const content = async () => {
data.hubspotContact = {
  "properties": {
    "firstname": data.firstName,
    "lastname": data.lastName,
    "company": data.company,
    "email": data.email,
    "phone": data.phone,
    "jobtitle": data.jobTitle,
    "linkedin_url": "www.linkedin.com",
    "prospect_source": data.$via.name
  }
};
let response
try {
  response = await connectors.hubspotCom.request({
    url: `/crm/v3/objects/contacts`,
    options:
    {
      headers:
      {
        'Content-type': 'application/json'
      },
      method: 'POST',
      body: JSON.stringify(data.hubspotContact)
    }
  })
  data.result = response;
  data.hubspotCreate = true;
} catch (e) {
  if (String(e).includes('409')) {
    data.hubspotContactExists = true;
  } else {
    throw (e);
  }
}
//console.log(response);
data.result = response;
data.hubspotCreate = true;
};
