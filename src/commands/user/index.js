import chalk from "chalk";
import { graphQuery, getSessionData } from "../../utils.js";
import {
  FIND_COMPANY_MEMBERS_QUERY,
  INVITE_TO_COMPANY_MUTATION,
  UPDATE_COMPANY_MEMBER_MUTATION,
} from "./query.js";
import { rolesToGroups } from "./utils.js";

export async function listUsers() {
  try {
    const user = await getSessionData("user");
    if (!user?.groups?.some((g) => g === "admin" || g === "owner")) {
      console.log(
        chalk.red("Error: Only administrators or owners can list users"),
      );
      return;
    }

    const data = await graphQuery(FIND_COMPANY_MEMBERS_QUERY);
    const members = data.findCompanyMembers || [];
    const invitations = data.getCompanyInvitations || [];

    if (members.length === 0) {
      console.log(chalk.yellow("No users found in the current company."));
    } else {
      console.log(chalk.blue("\nUsers in current company:"));
      members.forEach((user) => {
        console.log(
          chalk.green(
            `- ${user.firstName || ""} ${user.lastName || ""} <${user.email}> (${user.id}) [${(user.groups || []).join(", ")}]`,
          ),
        );
      });
    }
    if (invitations.length > 0) {
      console.log(chalk.blue("\nPending Invitations:"));
      invitations.forEach((invite) => {
        console.log(
          chalk.yellow(
            `- ${invite.email} (invited at ${new Date(invite.createdAt).toLocaleString()})`,
          ),
        );
      });
    }
  } catch (error) {
    console.error(chalk.red("Error listing users:"), error.message);
  }
}

export async function inviteUsers(emails, roles = "developer") {
  try {
    const user = await getSessionData("user");
    if (!user?.groups?.some((g) => g === "admin" || g === "owner")) {
      console.log(
        chalk.red("Error: Only administrators or owners can invite users"),
      );
      return;
    }

    // Parse multiple roles and convert to groups
    const roleList = roles
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);
    let groups;
    try {
      groups = rolesToGroups(roles);
    } catch (error) {
      console.log(chalk.red(error.message));
      return;
    }

    // Parse emails
    const emailList = emails
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    if (emailList.length === 0) {
      console.log(chalk.red("No valid emails provided."));
      return;
    }
    // Send invite mutation
    await graphQuery(INVITE_TO_COMPANY_MUTATION, {
      emails: emailList,
      groups,
    });
    console.log(
      chalk.green(
        `Invited users: ${emailList.join(", ")} with roles: ${roleList.join(", ")}`,
      ),
    );
  } catch (error) {
    console.error(chalk.red("Error inviting users:"), error.message);
  }
}

export async function updateUser(userId, roles) {
  try {
    const user = await getSessionData("user");
    if (!user?.groups?.some((g) => g === "admin" || g === "owner")) {
      console.log(
        chalk.red("Error: Only administrators or owners can update users"),
      );
      return;
    }

    if (!roles) {
      console.log(chalk.red("Error: Roles parameter is required"));
      return;
    }

    // Parse multiple roles and convert to groups
    let groups;
    try {
      groups = rolesToGroups(roles);
    } catch (error) {
      console.log(chalk.red(error.message));
      return;
    }

    await graphQuery(UPDATE_COMPANY_MEMBER_MUTATION, {
      id: userId,
      groups,
    });
    console.log(chalk.green(`Updated user ${userId}`));
  } catch (error) {
    console.error(chalk.red("Error updating user:"), error.message);
  }
}

export async function removeUser(userId) {
  try {
    const user = await getSessionData("user");
    if (!user?.groups?.some((g) => g === "admin" || g === "owner")) {
      console.log(
        chalk.red("Error: Only administrators or owners can update users"),
      );
      return;
    }

    await graphQuery(UPDATE_COMPANY_MEMBER_MUTATION, {
      id: userId,
      removed: true,
    });
    console.log(chalk.green(`Removed user ${userId}`));
  } catch (error) {
    console.error(chalk.red("Error updating user:"), error.message);
  }
}
