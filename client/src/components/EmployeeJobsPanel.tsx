import { BriefcaseBusiness, CheckCircle2, MapPin, Send, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const APPLICATION_LABEL: Record<string, string> = {
  matched: "Matched",
  referred: "Referred by your counsellor",
  applied: "Applied",
  interviewing: "Interviewing",
  placed: "Placed 🎉",
  rejected: "Not selected",
  withdrawn: "Withdrawn",
};

/**
 * Matched openings on the career page. The score is shown with its reasons, so
 * a worker can judge a match instead of trusting a number.
 */
export function EmployeeJobsPanel({ token }: { token: string }) {
  const utils = trpc.useUtils();
  const matchesQuery = trpc.exchange.matches.useQuery({ token }, { retry: false });
  const applyMutation = trpc.exchange.applyToPosting.useMutation({
    onSuccess: (result) => {
      toast.success(result.updated ? "Application sent." : "You have already applied to this role.");
      void utils.exchange.matches.invalidate({ token });
    },
    onError: (error) => toast.error(error.message),
  });

  if (matchesQuery.isLoading) {
    return <Section><p className="text-[11px] text-slate-400">Looking for roles that fit you…</p></Section>;
  }

  const matches = matchesQuery.data ?? [];
  if (matches.length === 0) {
    return (
      <Section>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#278271]">Jobs for you</p>
        <h2 className="mt-1 text-sm font-semibold text-[#153633]">No open roles right now</h2>
        <p className="mt-2 text-[11px] leading-5 text-slate-500">
          When employers post roles that fit your trade and district, they will appear here.
        </p>
      </Section>
    );
  }

  return (
    <Section>
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#278271]">Jobs for you</p>
      <h2 className="mt-1 text-sm font-semibold text-[#153633]">
        {matches.length} role{matches.length === 1 ? "" : "s"} matched to your record
      </h2>
      <div className="mt-3 space-y-3">
        {matches.map((match) => {
          const applied = match.application && match.application.status !== "matched";
          return (
            <div key={match.postingId} className="rounded-2xl border border-slate-100 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-700">{match.title}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">{match.employer}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" />{match.district}
                    </span>
                    {match.wageBand ? (
                      <span className="inline-flex items-center gap-1">
                        <WalletCards className="h-3 w-3" />{match.wageBand}
                      </span>
                    ) : null}
                    <span className="inline-flex items-center gap-1 font-semibold text-[#278271]">
                      <BriefcaseBusiness className="h-3 w-3" />{match.score}% fit
                    </span>
                  </div>
                </div>
                {applied ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#e1f4ed] px-2.5 py-1 text-[10px] font-semibold text-[#247563]">
                    <CheckCircle2 className="h-3 w-3" />
                    {APPLICATION_LABEL[match.application!.status] ?? match.application!.status}
                  </span>
                ) : (
                  <button
                    onClick={() => applyMutation.mutate({ token, postingId: match.postingId })}
                    disabled={applyMutation.isPending}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#0f766e] px-3 py-2 text-[10px] font-semibold text-white hover:bg-[#0b625c] disabled:opacity-50"
                  >
                    <Send className="h-3.5 w-3.5" />Apply
                  </button>
                )}
              </div>
              <ul className="mt-3 space-y-1 border-t border-slate-50 pt-3">
                {match.factors.slice(0, 3).map((factor) => (
                  <li key={factor.label} className="text-[10px] text-slate-400">
                    <span className="font-semibold text-slate-500">{factor.label}</span> — {factor.detail}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[26px] bg-white p-6 shadow-[0_20px_70px_rgba(24,52,48,0.08)]">{children}</div>
  );
}
