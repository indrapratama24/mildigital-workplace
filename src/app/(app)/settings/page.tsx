import { redirect } from "next/navigation";
import { requirePageUser } from "@/server/auth/guard";
import { can } from "@/server/authz";
import { SETTINGS_NAV } from "./nav";

export default async function SettingsIndex() {
  const me = await requirePageUser();
  redirect(SETTINGS_NAV.find((n) => can(me, n.perm))?.href ?? "/overview");
}
