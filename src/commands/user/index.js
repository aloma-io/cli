import chalk from "chalk";
import { graphQuery } from "../../utils.js";
import {
  FIND_COMPANY_MEMBERS_QUERY,
  INVITE_TO_COMPANY_MUTATION,
  UPDATE_COMPANY_MEMBER_MUTATION,
} from "./query.js";
import { rolesToGroups } from "./utils.js";
import { getMe } from "../../context.js";
import { CliError, UsageError, failure } from "../../runtime.js";

async function checkAdminOrOwnerPermission(action) {
  const me = await getMe();
  if (!me?.groups?.some((g) => g === "admin" || g === "owner")) {
    throw new CliError(`Error: Only administrators or owners can ${action}`);
  }
}

export async function listUsers() {
  try {
    await checkAdminOrOwnerPermission("list users");

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
    throw failure("Error listing users:", error);
  }
}

export async function inviteUsers(emails, roles = "developer") {
  try {
    await checkAdminOrOwnerPermission("invite users");

    // Parse multiple roles and convert to groups
    const roleList = roles
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);
    let groups;
    try {
      groups = rolesToGroups(roles);
    } catch (error) {
      throw new UsageError(error.message);
    }

    // Parse emails
    const emailList = emails
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    if (emailList.length === 0) {
      throw new UsageError("No valid emails provided.");
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
    throw failure("Error inviting users:", error);
  }
}

export async function updateUser(userId, roles) {
  try {
    await checkAdminOrOwnerPermission("update users");

    if (!roles) {
      throw new UsageError("Error: Roles parameter is required");
    }

    // Parse multiple roles and convert to groups
    let groups;
    try {
      groups = rolesToGroups(roles);
    } catch (error) {
      throw new UsageError(error.message);
    }

    await graphQuery(UPDATE_COMPANY_MEMBER_MUTATION, {
      id: userId,
      groups,
    });
    console.log(chalk.green(`Updated user ${userId}`));
  } catch (error) {
    throw failure("Error updating user:", error);
  }
}

export async function removeUser(userId) {
  try {
    await checkAdminOrOwnerPermission("remove users");

    await graphQuery(UPDATE_COMPANY_MEMBER_MUTATION, {
      id: userId,
      removed: true,
    });
    console.log(chalk.green(`Removed user ${userId}`));
  } catch (error) {
    throw failure("Error updating user:", error);
  }
}
