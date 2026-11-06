import { Command } from "commander";
import { getSessionData, updateSessionData } from "../../utils.js";
import chalk from "chalk";
import { GRAPHQL_HOST } from "../../config.js";
import {
  getMe,
  forgetMe,
  resolveCompany,
  saveSelectedWorkspace,
  selectDefaultWorkspace,
} from "../../context.js";
import { postJson } from "../../http.js";
import { selectFromList } from "../../ui/select.js";
import { CliError, failure } from "../../runtime.js";

export const addCompany = async (name, emails) => {
  const me = await getMe();
  if (!me?.groups?.includes("company-manager")) {
    throw new CliError("Error: Only administrators can add companies");
  }

  try {
    //replace with graphql mutation
    // const response = await axios.post('/api/companies', {
    //   name,
    //   emails: emails.split(',').map(email => email.trim())
    // });
    console.log(chalk.green(`Company "${name}" created successfully!`));
  } catch (error) {
    throw failure("Error creating company:", error);
  }
};

export const listCompanies = async () => {
  const me = await getMe();
  const realms = me?.realms || [];
  const currentCompany = me?.realm?.id;

  if (realms.length === 0) {
    console.log(chalk.yellow("No companies found"));
    return;
  }

  console.log(chalk.blue("\nAvailable companies:"));
  realms.forEach((realm, index) => {
    console.log(
      `${index + 1}. ${realm.name} ${currentCompany === realm.id ? "[*]" : ""}`,
    );
  });
};

// Interactive company selection
async function selectCompanyInteractive() {
  try {
    const me = await getMe();
    const realms = me?.realms || [];
    const currentCompanyId = me?.realm?.id;

    if (realms.length === 0) {
      throw new CliError("No companies found.");
    }

    return await selectFromList({
      title: "Select a company to switch to:",
      items: realms,
      currentId: currentCompanyId,
    });
  } catch (error) {
    throw failure("Error fetching companies:", error);
  }
}

export const switchCompany = async (identifier) => {
  try {
    let company = null;

    if (!identifier) {
      // Interactive selection
      company = await selectCompanyInteractive();
    } else {
      // Direct selection by id, then name in any case (PLAT-116)
      company = await resolveCompany(identifier);
    }

    // Switch to the selected company
    const companyId = company.id;
    // https only, no redirect, session attached: see src/http.js
    const response = await postJson(
      `https://${GRAPHQL_HOST}/realm?realm=${encodeURIComponent(companyId)}`,
      {},
      { auth: await getSessionData("token"), what: "company switch" },
    );
    if (!response.ok) {
      throw new Error(`Request failed with status code ${response.status}`);
    }

    // Get the new token from the response cookies
    const cookies = response.headers.getSetCookie();
    if (cookies.length) {
      const authCookie = cookies.find((cookie) =>
        cookie.startsWith("Authorization="),
      );
      if (authCookie) {
        const token = authCookie
          .split(";")[0]
          .split("=")[1]
          .replace("Bearer%20", "");
        // Update the session with the new token
        await updateSessionData("token", token);
        forgetMe();
        // Reset the selected workspace
        await updateSessionData("selectedWorkspace", null);
        await saveSelectedWorkspace(null);
        await selectDefaultWorkspace();
      }
    }

    console.log(
      chalk.green(`Successfully switched to company [${company.name}]`),
    );
  } catch (error) {
    throw failure("Error switching company:", error);
  }
};

export function register(program) {
  program
    .command("company")
    .description("Manage Aloma companies")
    .addCommand(
      new Command("list")
        .description("List all available companies")
        .action(async () => {
          await listCompanies();
        }),
    )
    .addCommand(
      new Command("switch")
        .argument(
          "[identifier]",
          "Company name or ID (optional - will show interactive selection if not provided)",
        )
        .description("Switch to a different company by name or ID")
        .action(async (identifier) => {
          await switchCompany(identifier);
        }),
    )
    .addCommand(
      new Command("add")
        .argument("<name>", "Company name")
        .description("Create a new company (admin only)")
        .option(
          "-e, --emails <emails>",
          "Comma-separated list of emails to invite",
        )
        .action(async (name, options) => {
          await addCompany(name, options.emails);
        }),
    );
}
