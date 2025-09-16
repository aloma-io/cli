import { getSessionData, updateSessionData } from "../../utils.js";
import chalk from "chalk";
import axios from "axios";
import { GRAPHQL_HOST } from "../../config.js";
import { graphQuery } from "../../utils.js";
import { ME_QUERY } from "../auth/query.js";
import { saveSelectedWorkspace } from "../workspace/index.js";
import readline from "readline";

export const addCompany = async (name, emails) => {
  const user = await graphQuery(ME_QUERY);
  if (!user?.me?.groups?.includes("company-manager")) {
    console.log(chalk.red("Error: Only administrators can add companies"));
    return;
  }

  try {
    //replace with graphql mutation
    // const response = await axios.post('/api/companies', {
    //   name,
    //   emails: emails.split(',').map(email => email.trim())
    // });
    console.log(chalk.green(`Company "${name}" created successfully!`));
  } catch (error) {
    console.log(chalk.red("Error creating company:", error.message));
  }
};

export const listCompanies = async () => {
  const user = await graphQuery(ME_QUERY);
  const realms = user?.me?.realms || [];
  const currentCompany = user?.me?.realm?.id;

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
    const user = await graphQuery(ME_QUERY);
    const realms = user?.me?.realms || [];
    const currentCompanyId = user?.me?.realm?.id;

    if (realms.length === 0) {
      console.log(chalk.yellow("No companies found."));
      return null;
    }

    let selectedIndex = 0;

    // Find current company index
    if (currentCompanyId) {
      const currentIndex = realms.findIndex(realm => realm.id === currentCompanyId);
      if (currentIndex !== -1) {
        selectedIndex = currentIndex;
      }
    }

    console.log(chalk.blue("\nSelect a company to switch to:"));
    console.log(chalk.gray("Use ↑/↓ arrows to navigate, Enter to select, Ctrl+C to cancel\n"));

    // Create readline interface
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Set raw mode for key capture
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    return new Promise((resolve) => {
      const displayCompanies = () => {
        // Clear screen and move cursor to top
        process.stdout.write('\x1B[2J\x1B[0f');
        console.log(chalk.blue("Select a company to switch to:"));
        console.log(chalk.gray("Use ↑/↓ arrows to navigate, Enter to select, Ctrl+C to cancel\n"));

        realms.forEach((realm, index) => {
          const isSelected = index === selectedIndex;
          const isCurrent = realm.id === currentCompanyId;
          const prefix = isSelected ? chalk.cyan('❯ ') : '  ';
          const name = isSelected ? chalk.cyan.bold(realm.name) : chalk.white(realm.name);
          const current = isCurrent ? chalk.green(' [current]') : '';
          const id = chalk.gray(` (ID: ${realm.id})`);
          
          console.log(`${prefix}${name}${id}${current}`);
        });
      };

      displayCompanies();

      const handleKeyPress = (key) => {
        if (key === '\u0003') { // Ctrl+C
          process.stdin.setRawMode(false);
          rl.close();
          console.log(chalk.yellow('\nSelection cancelled.'));
          resolve(null);
          return;
        }

        if (key === '\r' || key === '\n') { // Enter
          process.stdin.setRawMode(false);
          rl.close();
          const selectedCompany = realms[selectedIndex];
          console.log(chalk.green(`\nSelected: ${selectedCompany.name}`));
          resolve(selectedCompany);
          return;
        }

        if (key === '\u001b[A') { // Up arrow
          selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : realms.length - 1;
          displayCompanies();
        } else if (key === '\u001b[B') { // Down arrow
          selectedIndex = selectedIndex < realms.length - 1 ? selectedIndex + 1 : 0;
          displayCompanies();
        }
      };

      process.stdin.on('data', handleKeyPress);
    });
  } catch (error) {
    console.error(chalk.red("Error fetching companies:"), error.message);
    return null;
  }
}

export const switchCompany = async (identifier) => {
  try {
    let company = null;

    if (!identifier) {
      // Interactive selection
      company = await selectCompanyInteractive();
      if (!company) {
        return;
      }
    } else {
      // Direct selection by identifier
      const user = await graphQuery(ME_QUERY);
      const realms = user?.me?.realms || [];

      if (realms.length === 0) {
        console.log(chalk.yellow("No companies found."));
        return;
      }

      // select the company by name or id
      company = realms.find(
        (realm) => realm.name === identifier || realm.id === identifier,
      );
      if (!company) {
        console.log(chalk.red("Company not found"));
        return;
      }
    }

    // Switch to the selected company
    const companyId = company.id;
    const response = await axios.post(
      `https://${GRAPHQL_HOST}/realm?realm=${encodeURIComponent(companyId)}`,
      {},
      {
        withCredentials: true,
        headers: {
          Authorization: `Bearer ${await getSessionData("token")}`,
        },
      },
    );

    // Get the new token from the response cookies
    const cookies = response.headers["set-cookie"];
    if (cookies) {
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
        await updateSessionData("selectedWorkspace", null);
        await saveSelectedWorkspace(null);
      }
    }

    console.log(chalk.green(`Successfully switched to company [${company.name}]`));
  } catch (error) {
    console.log(chalk.red("Error switching company:", error.message));
  }
};
