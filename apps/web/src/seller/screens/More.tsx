import { LogOut } from "lucide-react";
import { navigate } from "../../lib/router";
import type { Me } from "../../lib/types";
import { ListRow, ListSection } from "../../ui/List";
import { useTenant } from "../context";
import { navFor } from "../nav";
import { Screen } from "../Screen";
import { StoreSwitcher } from "../StoreSwitcher";
import { logout } from "./Settings";

export function More({ me }: { me: Me }) {
  const t = useTenant();
  return (
    <Screen title="Lainnya">
      <div className="mb-8">
        <StoreSwitcher me={me} current={t} />
      </div>
      <ListSection>
        {navFor(t)
          .filter((i) => !i.inTabBar && i.section !== "__tab-only")
          .map((i) => (
            <ListRow key={i.id} icon={i.icon} title={i.label} chevron onClick={() => navigate(i.path)} />
          ))}
      </ListSection>
      <ListSection footer={me.user?.email}>
        <ListRow icon={<LogOut />} iconBg="var(--red)" title="Keluar" destructive onClick={logout} />
      </ListSection>
    </Screen>
  );
}
