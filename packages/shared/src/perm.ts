export type Role = "owner" | "admin" | "staff";
export type Permission = "money" | "settings" | "team" | "reports";
export type Grants = { money?: boolean; reports?: boolean };

export const ROLE_LABEL: Record<Role, string> = { owner: "Pemilik", admin: "Admin", staff: "Staf" };

/** Staff start with orders, shopping and shipments only; money and reports are opt-in grants. */
export function can(role: Role, grants: Grants | null | undefined, perm: Permission): boolean {
  if (role === "owner") return true;
  if (perm === "team") return false;
  if (role === "admin") return true;
  if (perm === "money") return !!grants?.money;
  if (perm === "reports") return !!grants?.reports;
  return false;
}

export function parseGrants(json: string | null | undefined): Grants {
  try {
    const g = json ? (JSON.parse(json) as Grants) : {};
    return { money: !!g.money, reports: !!g.reports };
  } catch {
    return {};
  }
}
