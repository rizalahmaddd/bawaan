import { ROLE_LABEL, type Grants, type Role } from "@bawaan/shared";
import { Copy, MessageCircle, Plus, UserRound } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { fmtRelative } from "../../lib/format";
import { navigate } from "../../lib/router";
import { Button } from "../../ui/Button";
import { ask, ErrorState, SkeletonRows, useHud } from "../../ui/Feedback";
import { Field, Input } from "../../ui/Form";
import { ListRow, ListSection } from "../../ui/List";
import { Segmented } from "../../ui/Segmented";
import { Sheet } from "../../ui/Sheet";
import { Switch } from "../../ui/Switch";
import { useTenant } from "../context";
import { useTenantAction, useTenantQuery } from "../hooks";
import { Screen } from "../Screen";

type Member = { userId: string; name: string; email: string; avatarUrl: string | null; role: Role; permissions: Grants };
type TeamData = { members: Member[]; invites: Array<{ id: string; email: string; role: Role; expiresAt: number; createdAt: number }>; me: string };

const grantText = (m: { role: Role; permissions: Grants }) =>
  m.role !== "staff" ? null : [m.permissions.money && "boleh terima pembayaran", m.permissions.reports && "boleh lihat laporan"].filter(Boolean).join(", ") || "pesanan, belanja, pengiriman";

export function Team() {
  const t = useTenant();
  const q = useTenantQuery<TeamData>(["team"], "/team");
  const cancel = useTenantAction<string>("del", (id) => `/team/invites/${id}`, "Undangan dibatalkan");
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const back = { label: "Pengaturan", to: "/pengaturan" };

  if (q.isPending) return <Screen title="Tim" back={back}><SkeletonRows /></Screen>;
  if (q.isError) return <Screen title="Tim" back={back}><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Screen>;
  const { members, invites, me } = q.data;

  return (
    <Screen title="Tim" back={back}>
      <ListSection footer="Pemilik bisa semua hal. Admin mengelola toko kecuali tim. Staf mengurus pesanan, belanja, dan pengiriman; akses uang dan laporan bisa diberikan terpisah.">
        {members.map((m) => (
          <ListRow
            key={m.userId}
            icon={m.avatarUrl ? <img src={m.avatarUrl} alt="" className="size-full rounded-[8px] object-cover" /> : <UserRound />}
            iconBg={m.avatarUrl ? "transparent" : "var(--gray)"}
            title={`${m.name}${m.userId === me ? " (kamu)" : ""}`}
            subtitle={[m.email, grantText(m)].filter(Boolean).join(" · ")}
            value={ROLE_LABEL[m.role]}
            chevron={t.canTeam || m.userId === me}
            onClick={t.canTeam || m.userId === me ? () => setEditing(m) : undefined}
          />
        ))}
        {t.canTeam && <ListRow icon={<Plus />} title="Undang anggota" onClick={() => setInviting(true)} />}
      </ListSection>

      {invites.length > 0 && (
        <ListSection header="Menunggu diterima">
          {invites.map((i) => (
            <ListRow
              key={i.id}
              title={i.email}
              subtitle={`${ROLE_LABEL[i.role]} · berlaku sampai ${fmtRelative(i.expiresAt)}`}
              trailing={
                t.canTeam ? (
                  <Button size="sm" variant="gray" onClick={() => cancel.mutate(i.id)}>
                    Batalkan
                  </Button>
                ) : undefined
              }
            />
          ))}
        </ListSection>
      )}

      {inviting && <InviteSheet onClose={() => setInviting(false)} />}
      {editing && <MemberSheet member={editing} isMe={editing.userId === me} canTeam={t.canTeam} onClose={() => setEditing(null)} />}
    </Screen>
  );
}

function InviteSheet({ onClose }: { onClose: () => void }) {
  const t = useTenant();
  const hud = useHud();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("staff");
  const [grants, setGrants] = useState<Grants>({});
  const [link, setLink] = useState<string | null>(null);
  const invite = useTenantAction<object, { link: string }>("post", "/team/invites");
  const text = link ? `Halo, kamu diundang bergabung ke tim ${t.name} di Bawaan. Masuk pakai Google (${email}) lewat link ini: ${link}` : "";

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Undang anggota" detents={["large"]}>
      {!link ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            invite.mutate({ email: email.trim(), role, permissions: grants }, { onSuccess: (r) => setLink(r.link) });
          }}
        >
          <ListSection footer="Undangan hanya bisa dipakai oleh akun Google dengan email ini, berlaku 7 hari.">
            <Field label="Email Gmail">{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nama@gmail.com" autoComplete="email" autoFocus />}</Field>
          </ListSection>
          <ListSection
            header="Peran"
            footer={role === "owner" ? "Pemilik kedua berguna kalau akun Google utama hilang. Pemilik bisa menghapus toko dan mengatur tim." : undefined}
          >
            <div className="p-4">
              <Segmented label="Peran" value={role} onChange={setRole} options={(["staff", "admin", "owner"] as Role[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
            </div>
          </ListSection>
          {role === "staff" && <GrantFields grants={grants} onChange={setGrants} />}
          <Button type="submit" size="lg" block disabled={!/^\S+@\S+\.\S+$/.test(email.trim()) || invite.isPending}>
            Buat undangan
          </Button>
        </form>
      ) : (
        <>
          <ListSection footer="Kirim link ini ke orangnya. Belum ada email otomatis, jadi kirim lewat WhatsApp atau chat lain.">
            <p className="break-all p-4 text-subhead">{link}</p>
          </ListSection>
          <div className="flex gap-3">
            <Button variant="gray" className="flex-1" icon={<Copy className="size-4" />} onClick={() => navigator.clipboard?.writeText(link).then(() => hud("Link disalin"))}>
              Salin
            </Button>
            <Button className="flex-1" icon={<MessageCircle className="size-4" />} onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener")}>
              WhatsApp
            </Button>
          </div>
        </>
      )}
    </Sheet>
  );
}

function GrantFields({ grants, onChange }: { grants: Grants; onChange: (g: Grants) => void }) {
  return (
    <ListSection header="Akses tambahan untuk staf">
      <Field label="Terima pembayaran" hint="Verifikasi bukti bayar, catat pembayaran, ubah saldo">
        {(id) => (
          <div className="flex justify-end">
            <Switch id={id} checked={!!grants.money} onChange={(e) => onChange({ ...grants, money: e.target.checked })} />
          </div>
        )}
      </Field>
      <Field label="Lihat laporan" hint="Omzet, modal, dan laba per trip">
        {(id) => (
          <div className="flex justify-end">
            <Switch id={id} checked={!!grants.reports} onChange={(e) => onChange({ ...grants, reports: e.target.checked })} />
          </div>
        )}
      </Field>
    </ListSection>
  );
}

function MemberSheet({ member, isMe, canTeam, onClose }: { member: Member; isMe: boolean; canTeam: boolean; onClose: () => void }) {
  const t = useTenant();
  const hud = useHud();
  const [role, setRole] = useState(member.role);
  const [grants, setGrants] = useState<Grants>(member.permissions);
  const save = useTenantAction<object>("patch", `/team/${member.userId}`, "Tersimpan");
  const [removing, setRemoving] = useState(false);

  async function remove() {
    if (!(await ask(isMe ? `Keluar dari tim ${t.name}?` : `Keluarkan ${member.name} dari tim?`, { action: isMe ? "Keluar" : "Keluarkan", destructive: true }))) return;
    setRemoving(true);
    try {
      await api.del(`${t.base}/team/${member.userId}`);
      if (isMe) location.assign("/");
      else {
        hud("Dikeluarkan dari tim");
        onClose();
        navigate("/tim", { replace: true });
      }
    } catch (e) {
      hud(errorMessage(e), "error");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={member.name} detents={["large"]}>
      <p className="mb-4 text-center text-subhead text-label-2">{member.email}</p>
      {canTeam && (
        <>
          <ListSection header="Peran">
            <div className="p-4">
              <Segmented label="Peran" value={role} onChange={setRole} options={(["staff", "admin", "owner"] as Role[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
            </div>
          </ListSection>
          {role === "staff" && <GrantFields grants={grants} onChange={setGrants} />}
          <Button size="lg" block className="mb-4" disabled={save.isPending} onClick={() => save.mutate({ role, permissions: grants }, { onSuccess: onClose })}>
            Simpan
          </Button>
        </>
      )}
      {(canTeam || isMe) && (
        <Button variant="destructive" block disabled={removing} onClick={remove}>
          {isMe ? "Keluar dari tim" : "Keluarkan dari tim"}
        </Button>
      )}
    </Sheet>
  );
}

/** Opened from the invite link. The user is already signed in by the time this renders. */
export function AcceptInvite({ token, onDone }: { token: string; onDone: (tenantId: string) => void }) {
  const hud = useHud();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-fill-3 text-tint">
        <UserRound className="size-8" />
      </div>
      <h1 className="text-title2">Undangan tim</h1>
      <p className="mt-2 text-subhead text-label-2">Terima undangan untuk mulai membantu mengelola toko ini.</p>
      {error && <p className="mt-4 text-subhead text-red-text">{error}</p>}
      <Button
        size="lg"
        className="mt-8"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await api.post<{ tenantId: string; name: string }>("/api/tenants/invites/accept", { token });
            hud(`Bergabung dengan ${r.name}`);
            onDone(r.tenantId);
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Terima undangan
      </Button>
      <button type="button" className="mt-4 text-body text-tint-text" onClick={() => location.assign("/")}>
        Nanti saja
      </button>
    </div>
  );
}
