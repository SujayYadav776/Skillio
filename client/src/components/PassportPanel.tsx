import { Check, Copy, Link2, Lock, QrCode, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import { trpc } from "@/lib/trpc";

const EVIDENCE_LABEL: Record<string, string> = {
  verified: "Verified",
  employer_confirmed: "Employer confirmed",
  self_reported: "Self reported",
};

/**
 * The headline feature, employee side: publish a Verified Career Passport, then
 * hand out revocable links. Everything is opt-in and reversible, and the panel
 * says so plainly — that is the whole basis of trust in the document.
 */
export function PassportPanel({ token }: { token: string }) {
  const utils = trpc.useUtils();
  const passportQuery = trpc.passport.me.useQuery({ token }, { retry: false });

  const [shareWageBands, setShareWageBands] = useState(false);
  const [shareEmployerNames, setShareEmployerNames] = useState(false);
  const [shareScope, setShareScope] = useState<"summary" | "full">("summary");
  const [recipient, setRecipient] = useState("");
  const [lastLink, setLastLink] = useState("");

  const publishMutation = trpc.passport.publish.useMutation({
    onSuccess: (result) => {
      toast.success(`Passport published — ${result.entryCount} verified claims.`);
      void utils.passport.me.invalidate({ token });
    },
    onError: (error) => toast.error(error.message),
  });

  const shareMutation = trpc.passport.createShare.useMutation({
    onSuccess: async (result) => {
      const url = `${window.location.origin}${result.url}`;
      setLastLink(url);
      try {
        await navigator.clipboard.writeText(url);
        toast.success("Share link copied to your clipboard.");
      } catch {
        toast.success("Share link created — copy it from the card below.");
      }
      setRecipient("");
      void utils.passport.me.invalidate({ token });
    },
    onError: (error) => toast.error(error.message),
  });

  const revokeMutation = trpc.passport.revokeShare.useMutation({
    onSuccess: () => {
      toast.success("Share link revoked.");
      void utils.passport.me.invalidate({ token });
    },
    onError: (error) => toast.error(error.message),
  });

  if (passportQuery.isLoading) {
    return (
      <Section>
        <p className="text-[11px] text-slate-400">Loading your passport…</p>
      </Section>
    );
  }

  if (passportQuery.error || !passportQuery.data) {
    return (
      <Section>
        <p className="text-[11px] text-slate-400">
          Your passport will appear here once your record is available.
        </p>
      </Section>
    );
  }

  const { passport, preview, shares } = passportQuery.data;
  const published = passport?.status === "published";
  const publicUrl = passport ? `${window.location.origin}${passport.url}` : "";

  return (
    <Section>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#278271]">
            Career passport
          </p>
          <h2 className="mt-1 text-sm font-semibold text-[#153633]">
            Proof of your skills, that you can never lose
          </h2>
        </div>
        {published ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#e1f4ed] px-2.5 py-1 text-[10px] font-semibold text-[#247563]">
            <ShieldCheck className="h-3 w-3" />Published
          </span>
        ) : passport?.status === "revoked" ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#fbf0d9] px-2.5 py-1 text-[10px] font-semibold text-[#a56e18]">
            <ShieldAlert className="h-3 w-3" />Withdrawn
          </span>
        ) : null}
      </div>

      <p className="mt-2 text-[11px] leading-5 text-slate-500">
        Only verified claims are included: completed training from the provider register and work
        confirmed by an employer. Your own reported answers are never published.
      </p>

      {passport?.status === "revoked" ? (
        <p className="mt-3 rounded-xl border border-[#eadfc7] bg-[#fffaf0] p-3 text-[11px] leading-5 text-[#8d651e]">
          This passport was withdrawn{passport.revokeReason ? `: ${passport.revokeReason}` : ""}. You can
          publish a fresh one at any time.
        </p>
      ) : null}

      <div className="mt-3 rounded-2xl bg-[#f6f8f7] p-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
          What goes in ({preview.length} claims)
        </p>
        <div className="mt-2 space-y-1.5">
          {preview.slice(0, 6).map((entry, index) => (
            <div key={`${entry.kind}-${index}`} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[11px] text-slate-600">
                <span className="mr-1.5 rounded bg-white px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
                  {entry.kind}
                </span>
                {entry.title}
              </span>
              <span className="shrink-0 text-[10px] font-semibold text-[#278271]">
                {EVIDENCE_LABEL[entry.evidenceLevel] ?? entry.evidenceLevel}
              </span>
            </div>
          ))}
          {preview.length === 0 ? (
            <p className="text-[11px] text-slate-400">
              Nothing verified yet. Complete a course or have an employer confirm your job and it will appear
              here.
            </p>
          ) : null}
          {preview.length > 6 ? (
            <p className="text-[10px] text-slate-400">+{preview.length - 6} more</p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <Toggle
          checked={shareWageBands}
          onChange={setShareWageBands}
          label="Include my income bands (only for full-access links)"
        />
        <Toggle
          checked={shareEmployerNames}
          onChange={setShareEmployerNames}
          label="Include my employer names (only for full-access links)"
        />
      </div>

      <button
        onClick={() =>
          publishMutation.mutate({ token, shareWageBands, shareEmployerNames })
        }
        disabled={publishMutation.isPending || preview.length === 0}
        className="mt-3 h-10 w-full rounded-lg bg-[#0f766e] text-xs font-semibold text-white hover:bg-[#0b625c] disabled:opacity-50"
      >
        {publishMutation.isPending
          ? "Publishing…"
          : published
            ? "Update my passport"
            : "Publish my passport"}
      </button>

      {published && passport ? (
        <>
          <div className="mt-4 flex items-start gap-4 rounded-2xl border border-[#ccebe1] bg-[#edf9f4] p-4">
            <div className="hidden shrink-0 rounded-xl bg-white p-1.5 sm:block">
              <QRCodeSVG value={publicUrl} size={78} level="M" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#4a927f]">
                <QrCode className="h-3 w-3" />Your public link
              </p>
              <p className="mt-1 break-all text-[11px] text-[#247563]">{publicUrl}</p>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(publicUrl);
                    toast.success("Public link copied.");
                  } catch {
                    toast.error("Could not copy the link.");
                  }
                }}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#0f766e] px-3 py-2 text-[10px] font-semibold text-white hover:bg-[#0b625c]"
              >
                <Copy className="h-3.5 w-3.5" />Copy link
              </button>
              <p className="mt-2 text-[10px] leading-4 text-[#4a927f]">
                Anyone with this link sees your verified summary. Integrity hash{" "}
                <span className="font-mono">{passport.contentHash?.slice(0, 12)}…</span>
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-2xl bg-[#f6f8f7] p-4">
            <p className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
              <Link2 className="h-3 w-3" />Share with one person
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
              <input
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                placeholder="Who is this for? (e.g. Sharma Enterprises)"
                className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs outline-none focus:border-[#80c6b4]"
              />
              <select
                value={shareScope}
                onChange={(event) => setShareScope(event.target.value as "summary" | "full")}
                className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none"
              >
                <option value="summary">Summary view</option>
                <option value="full">Full detail</option>
              </select>
              <button
                onClick={() =>
                  shareMutation.mutate({
                    token,
                    recipientLabel: recipient.trim() || undefined,
                    scope: shareScope,
                    ttlDays: 30,
                  })
                }
                disabled={shareMutation.isPending}
                className="h-9 rounded-lg bg-[#0f766e] px-3 text-[10px] font-semibold text-white hover:bg-[#0b625c] disabled:opacity-50"
              >
                {shareMutation.isPending ? "Creating…" : "Create link"}
              </button>
            </div>
            {lastLink ? (
              <p className="mt-2 break-all rounded-lg border border-[#ccebe1] bg-white px-2 py-1.5 text-[10px] text-[#247563]">
                {lastLink}
              </p>
            ) : null}
            <p className="mt-2 inline-flex items-center gap-1.5 text-[10px] text-slate-400">
              <Lock className="h-3 w-3" />Links expire after 30 days and you can revoke any of them.
            </p>
          </div>

          <div className="mt-3 space-y-2">
            {shares.length === 0 ? (
              <p className="text-[11px] text-slate-400">No share links yet.</p>
            ) : (
              shares.map((share) => (
                <div
                  key={share.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-semibold text-slate-700">
                      {share.recipientLabel ?? "Unlabelled link"}{" "}
                      <span className="font-normal text-slate-400">· {share.scope} view</span>
                    </p>
                    <p className="mt-0.5 text-[10px] text-slate-400">
                      {share.revokedAt
                        ? "Revoked"
                        : share.live
                          ? `${share.viewCount} view${share.viewCount === 1 ? "" : "s"}${
                              share.lastViewedAt ? ` · last ${share.lastViewedAt.slice(0, 10)}` : ""
                            }`
                          : "Expired"}{" "}
                      · until {share.expiresAt.slice(0, 10)}
                    </p>
                  </div>
                  {share.live ? (
                    <button
                      onClick={() => revokeMutation.mutate({ token, shareId: share.id })}
                      disabled={revokeMutation.isPending}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-rose-100 px-2.5 py-1.5 text-[10px] font-semibold text-rose-500 hover:bg-rose-50 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />Revoke
                    </button>
                  ) : (
                    <span className="inline-flex shrink-0 items-center gap-1 text-[10px] text-slate-400">
                      <Check className="h-3 w-3" />Closed
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      ) : null}
    </Section>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-[11px] font-medium ${
        checked ? "border-[#78c1ae] bg-[#edf9f4] text-[#247563]" : "border-slate-200 bg-white text-slate-500"
      }`}
    >
      {label}
      <span
        className={`h-4 w-4 shrink-0 rounded-full border ${checked ? "border-[5px] border-[#0f766e]" : "border-slate-300"}`}
      />
    </button>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[26px] bg-white p-6 shadow-[0_20px_70px_rgba(24,52,48,0.08)]">{children}</div>
  );
}
