export const ROLES = {
  base: ["viewer", "developer", "integrator", "audit"],
  developer: [],
  admin: ["admin"],
  owner: ["admin", "owner"],
  business: ["business"],
};

export const allowedRoles = ["developer", "admin", "business"];

/**
 * Convert comma-separated roles string to groups array without duplicates
 * @param {string} roles - Comma-separated roles string
 * @returns {Array} Array of groups
 */
export function rolesToGroups(roles) {
  // Parse multiple roles
  const roleList = roles
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);

  // Validate all roles
  const invalidRoles = roleList.filter((role) => !allowedRoles.includes(role));
  if (invalidRoles.length > 0) {
    throw new Error(
      `Invalid roles: ${invalidRoles.join(", ")}. Allowed roles are: ${allowedRoles.join(", ")}`,
    );
  }

  // Compose groups from all roles without duplicates
  const allGroups = new Set(ROLES.base);
  roleList.forEach((role) => {
    if (ROLES[role]) {
      ROLES[role].forEach((group) => allGroups.add(group));
    }
  });

  return Array.from(allGroups);
}
