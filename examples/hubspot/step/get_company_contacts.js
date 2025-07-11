/**
 * Step: get company contacts
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
  getContacts: true,
};

export const content = async () => {
for (const company of data.hubspotCompanies) {
  const companyId = company.id;

  const associateContacts = await connectors.hubspotCom.request({
    url: `/crm/v3/objects/companies/${companyId}/associations/contacts`,
    options: {
      method: 'GET',
      headers: {
        "Content-type": "application/json"
      },
    }
  });

  const contactIds = associateContacts?.results?.map(contact => contact.id) || [];

  const contactsData = contactIds.length > 0
    ? await connectors.hubspotCom.request({
      url: `/crm/v3/objects/contacts/batch/read`,
      options: {
        method: 'POST',
        headers: {
          "Content-type": "application/json"
        },
        body: JSON.stringify({
          properties: ["firstname", "lastname", "email", "phone", "linkedin_url","hubspot_owner_id", "do_not_contact", "neverbouncevalidationresult", "ai_sequence_enrollment"],
          inputs: contactIds.map(id => ({ id }))
        })
      }
    })
    : null;
  if (contactsData) {
    console.log('contactsData', contactsData);
  } else {
    console.log('no contacts found for company', company.properties.name);
  }
}
  task.complete();
};
