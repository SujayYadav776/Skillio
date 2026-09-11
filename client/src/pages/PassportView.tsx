import { BadgeCheck, BriefcaseBusiness, CalendarDays, GraduationCap, QrCode, ShieldAlert, ShieldCheck, Sparkles } from "lucide-react";
import { useParams, useSearch } from "wouter";
import { QRCodeSVG } from "qrcode.react";
import { trpc } from "@/lib/trpc";

const EVIDENCE_LABEL: Record<string, string> = {
  verified: "Verified by Skillio",
  employer_confirmed: "Employer confirmed",
  self_reported: "Self reported",
};

const KIND_META: Record<string, { label: string; icon: typeof GraduationCap }> = {
  training: { label: "Training", icon: GraduationCap },
  employment: { label: "Employment", icon: BriefcaseBusiness },
  skill: { label: "Skill", icon: Sparkles },
};

/**
 * Public verification surface for a Verified Career Passport. No login: the
 * public id alone shows the summary; a `full` share token unlocks the extra
 * fields the holder opted to share. Integrity is displayed, not implied.
 */
export default function PassportView() {
  const params = useParams<{ publicId: string }>();
  const search = useSearch();
  const shareToken = new URLSearchParams(search).get("share") ?? undefined;
  const publicId = params.publicId ?? "";

  const query = trpc.passport.view.useQuery(
    { publicId, shareToken },
    { retry: false, enabled: Boolean(publicId) }
  );

  if (query.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f1f6f4] px-5">
        <p className="text-sm text-slate-400">Checking this passport…</p>
      </div>
    );
  }

  if (query.error || !query.data) {
    return (
      <Shell>
        <div className="rounded-[28px] bg-white p-8 text-center shadow-[0_20px_70px_rgba(24,52,48,0.08)]">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#fce8e5] text-[#b65348]">
            <ShieldAlert className="h-6 w-6" />
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-[-0.05em] text-[#153633]">
            This passport link is not valid.
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            The link may have expired or been withdrawn. Ask the holder for a fresh one.
          </p>
        </div>
      </Shell>
    );
  }

  const data = query.data;
  if (data.status === "revoked") {
    return (
      <Shell>
        <div className="rounded-[28px] bg-white p-8 text-center shadow-[0_20px_70px_rgba(24,52,48,0.08)]">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#fbf0d9] text-[#a56e18]">
            <ShieldAlert className="h-6 w-6" />
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-[-0.05em] text-[#153633]">
            {data.holder.name} withdrew this passport.
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            The holder revoked the record{data.reason ? ` — ${data.reason.toLowerCase()}` : ""}. No career
            claims are shown, by their choice.
          </p>
        </div>
      </Shell>
    );
  }

  const verifyUrl = typeof window === "undefined" ? "" : `${window.location.origin}/passport/${data.publicId}`;
  const grouped = ["training", "employment", "skill"].map((kind) => ({
    kind,
    entries: data.entries.filter((entry) => entry.kind === kind),
  }));

  return (
    <Shell>
      <div className="rounded-[28px] bg-white p-6 shadow-[0_20px_70px_rgba(24,52,48,0.08)] sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#278271]">
              Verified career passport
            </p>
            <h1 className="mt-2 text-[26px] font-semibold tracking-[-0.05em] text-[#153633]">
              {data.holder.name}
            </h1>
            <p className="mt-1 text-xs text-slate-400">
              {data.holder.headlineRole ?? "Skilled worker"} · {data.holder.district}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#e1f4ed] px-2.5 py-1.5 text-[11px] font-semibold text-[#247563]">
                <BadgeCheck className="h-3.5 w-3.5" />
                {data.holder.verifiedTenureDays > 0
                  ? `${data.holder.verifiedTenureDays} verified days in work`
                  : "Verified training record"}
              </span>
              {data.share ? (
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#eee9fb] px-2.5 py-1.5 text-[11px] font-semibold text-[#6d50ad]">
                  Shared with a {data.share.scope} view
                </span>
              ) : null}
            </div>
          </div>
          <div className="hidden shrink-0 flex-col items-center gap-2 sm:flex">
            <div className="rounded-2xl border border-slate-100 p-2">
              <QRCodeSVG value={verifyUrl} size={92} level="M" />
            </div>
            <span className="max-w-[110px] text-center text-[9px] leading-3 text-slate-400">
              Scan to verify at skillio
            </span>
          </div>
        </div>
      </div>

      <div
        className={`mt-4 flex items-start gap-3 rounded-2xl border p-4 text-[11px] leading-5 ${
          data.integrity.verified
            ? "border-[#ccebe1] bg-[#edf9f4] text-[#247563]"
            : "border-rose-200 bg-rose-50 text-rose-600"
        }`}
      >
        {data.integrity.verified ? (
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        ) : (
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        )}
        <div>
          <p className="font-semibold">
            {data.integrity.verified
              ? "Integrity check passed"
              : "Integrity check failed — do not rely on these claims"}
          </p>
          <p className="mt-0.5 break-all font-mono text-[10px] opacity-80">{data.integrity.contentHash}</p>
          <p className="mt-0.5">Checked {new Date(data.integrity.checkedAt).toLocaleString()}</p>
        </div>
      </div>

      {grouped
        .filter((group) => group.entries.length > 0)
        .map((group) => {
          const meta = KIND_META[group.kind];
          const Icon = meta.icon;
          return (
            <div key={group.kind} className="mt-4 rounded-[28px] bg-white p-6 shadow-[0_20px_70px_rgba(24,52,48,0.08)]">
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-[#278271]" />
                <h2 className="text-sm font-semibold text-[#153633]">{meta.label}</h2>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                  {group.entries.length}
                </span>
              </div>
              <div className="mt-4 space-y-3">
                {group.entries.map((entry, index) => (
                  <div key={`${group.kind}-${index}`} className="rounded-2xl border border-slate-100 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-700">{entry.title}</p>
                        {entry.subtitle ? (
                          <p className="mt-0.5 text-[11px] text-slate-400">{entry.subtitle}</p>
                        ) : null}
                        {entry.wageBand ? (
                          <p className="mt-1 text-[11px] font-semibold text-[#278271]">
                            Income band {entry.wageBand}
                          </p>
                        ) : null}
                        {entry.industry ? (
                          <p className="mt-0.5 text-[11px] text-slate-400">{entry.industry}</p>
                        ) : null}
                      </div>
                      <span className="shrink-0 rounded-full bg-[#e1f4ed] px-2.5 py-1 text-[10px] font-semibold text-[#247563]">
                        {EVIDENCE_LABEL[entry.evidenceLevel] ?? entry.evidenceLevel}
                      </span>
                    </div>
                    {entry.startDate || entry.endDate ? (
                      <p className="mt-2 inline-flex items-center gap-1.5 text-[10px] text-slate-400">
                        <CalendarDays className="h-3 w-3" />
                        {entry.startDate ? entry.startDate.slice(0, 10) : "—"} →{" "}
                        {entry.endDate ? entry.endDate.slice(0, 10) : "present"}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          );
        })}

      {data.scope !== "full" ? (
        <p className="mt-4 flex items-start gap-2 rounded-2xl border border-[#eadfc7] bg-[#fffaf0] p-4 text-[11px] leading-5 text-[#8d651e]">
          <QrCode className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          More detail — employer names and income history — is available when the holder shares a full-access
          link. Everything above is verified by Skillio from the training register and employer confirmations.
        </p>
      ) : null}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f1f6f4] px-4 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-[620px]">{children}
        <p className="mt-5 pb-4 text-center text-[10px] leading-5 text-slate-400">
          Skillio · Maharashtra skilling outcomes · No personal contact details are shown on this page.
        </p>
      </div>
    </div>
  );
}
