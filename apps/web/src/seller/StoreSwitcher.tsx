import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import type { Me } from "../lib/types";
import { rememberTenant, type TenantCtx } from "./context";
import { storeHost } from "../lib/links";

export function StoreSwitcher({ me, current }: { me: Me; current: TenantCtx }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="flex w-full items-center gap-2 rounded-[12px] bg-fill-4 px-3 py-2 text-left">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-subhead font-semibold">{current.name}</span>
          <span className="block truncate text-footnote text-label-2">{storeHost(current.slug)}</span>
        </span>
        <ChevronsUpDown className="size-4 text-label-2" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={6} className="glass z-50 min-w-[240px] rounded-[16px] p-1.5">
          {me.tenants.map((t) => (
            <DropdownMenu.Item
              key={t.id}
              onSelect={() => {
                rememberTenant(t.id);
                location.assign("/");
              }}
              className="flex cursor-pointer items-center gap-2 rounded-[10px] px-3 py-2 text-body outline-none data-[highlighted]:bg-fill-3"
            >
              <span className="flex-1 truncate">{t.name}</span>
              {t.id === current.id && <Check className="size-4 text-tint" />}
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-separator" />
          <DropdownMenu.Item
            onSelect={() => location.assign("/?toko-baru=1")}
            className="flex cursor-pointer items-center gap-2 rounded-[10px] px-3 py-2 text-body text-tint-text outline-none data-[highlighted]:bg-fill-3"
          >
            <Plus className="size-4" /> Toko baru
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
