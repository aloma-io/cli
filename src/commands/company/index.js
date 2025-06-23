import { getSessionData, updateSessionData } from "../../utils.js";
import chalk from "chalk";
import axios from "axios";
import { GRAPHQL_HOST } from "../../config.js";
import { graphQuery } from "../../utils.js";
import { ME_QUERY } from "../auth/query.js";
import { saveSelectedWorkspace } from "../workspace/index.js";

export const addCompany = async (name, emails) => {
  const user = await getSessionData("user");
  if (!user?.groups?.includes("company-manager")) {
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
  const user = await getSessionData("user");
  const realms = user?.realms || [];
  const currentCompany = user?.realm?.id;

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

export const switchCompany = async (identifier) => {
  try {
    let companyId = "";
    const user = await getSessionData("user");
    const realms = user?.realms || [];

    // select the company by name or id
    const company = realms.find(
      (realm) => realm.name === identifier || realm.id === identifier,
    );
    if (!company) {
      console.log(chalk.red("Company not found"));
      return;
    }
    companyId = company.id;

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
        //update the user with the new company selected
        const user = await graphQuery(ME_QUERY);
        await updateSessionData("user", user.me);
        await saveSelectedWorkspace(null);
      }
    }

    console.log(chalk.green("Successfully switched company"));
  } catch (error) {
    console.log(chalk.red("Error switching company:", error.message));
  }
};
