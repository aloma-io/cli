/**
 * Step: Add to google sheet
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
hubspotCreate: true
};

export const content = async () => {
const spreadsheetId = task.config("WAIT_LIST_SPREADSHEET")
const hubspotAccountID = task.config("HUBSPOT_ACCOUNT_ID")
const cell = (what, isFormula = false) => (
  isFormula
    ? { userEnteredValue: { formulaValue: what } }
    : { userEnteredValue: { stringValue: what } }
);
const sheetId = 0;
const date = new Date().toISOString().split('.')[0].replace('T', ' ');
const rowData = {
  values: [
    cell(date),
    cell(data?.firstName),
    cell(data?.lastName),
    cell(data?.fullName),
    cell(data?.email),    
    cell(data?.company),
    cell(data?.phone),
    cell(data?.jobTitle),
    cell(data?.message),
    cell(data?.contactResearch),
    cell(`=HYPERLINK("https://app-eu1.hubspot.com/contacts/${hubspotAccountID}/record/0-1/${data?.result?.id}", "https://app-eu1.hubspot.com/contacts/${hubspotAccountID}/record/0-1/${data?.result?.id}")`, true)
  ]
};

const body = {
  requests: [
    {
      appendCells: {
        sheetId: sheetId, 
        rows: [rowData],
        fields: '*'
      }
    }
  ]
};

const result = connectors.googleSheets.request({
  url: `/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
  options: {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json'
    }
  }
})
data.googleAdded = true
};
