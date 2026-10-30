import { createContext, useContext, type ReactNode } from "react";
import { back as goBack } from "../lib/router";
import { NavBackButton, NavBar } from "../ui/NavBar";

export const SidebarToggleContext = createContext<ReactNode>(null);

export function BackButton({ label, to }: { label: string; to: string }) {
  return <NavBackButton label={label} onClick={() => goBack(to)} />;
}

/** Page frame: nav bar (with the sidebar toggle on tablets) and a readable max width. */
export function Screen({
  title,
  trailing,
  accessory,
  back,
  largeTitle = true,
  children,
}: {
  title: string;
  trailing?: ReactNode;
  accessory?: ReactNode;
  back?: { label: string; to: string };
  largeTitle?: boolean;
  children: ReactNode;
}) {
  const toggle = useContext(SidebarToggleContext);
  return (
    <div className="mx-auto max-w-[960px] pb-10">
      <NavBar title={title} largeTitle={largeTitle} leading={back ? <BackButton {...back} /> : toggle} trailing={trailing} accessory={accessory} />
      <div className="px-[max(var(--gutter),var(--safe-left))]">{children}</div>
    </div>
  );
}
