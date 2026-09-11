import { BadgeCheck, Check, CircleDollarSign, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const STATUS_LABEL: Record<string, string> = {
  eligible: "Eligible",
  applied: "Applied",
  approved: "Approved",
  received: "Received",
};

/**
 * Benefits & scheme eligibility (A3). Every scheme shows the exact checks that
 * produced the fit — no black-box ranking, so a worker can push back if wrong.
 */
export function BenefitsPanel({ token }: { token: string }) {
  const utils = trpc.useUtils();
  const benefitsQuery = trpc.benefits.mine.useQuery({ token }, { retry: false });
  const applyMutation = trpc.benefits.applyToScheme.useMutation({
    onSuccess: () => {
      toast.success("Application sent — a counsellor will guide you on the next step.");
      void utils.benefits.mine.invalidate({ token });
    },
    onError: (error) => toast.error(error.message),
  });

  if (benefitsQuery.isLoading) {
    return <Section><p className="text-[11px] text-slate-400">Checking which schemes you may be eligible for…</p></Section>;
  }

  const benefits = benefitsQuery.data?.items ?? [];
  if (benefits.length === 0) {
    return (
      <Section>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#278271]">Benefits for you</p>
        <h2 className="mt-1 text-sm font-semibold text-[#153633]">No schemes published yet</h2>
        <p className="mt-2 text-[11px] leading-5 text-slate-500">
          Government and private support schemes for your situation will appear here as they are added.
        </p>
      </Section>
    );
  }

  return (
    <Section>
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#278271]">Benefits for you</p>
      <h2 className="mt-1 text-sm font-semibold text-[#153633]">
        {benefits.filter((b) => b.eligible).length} scheme{benefits.filter((b) => b.eligible).length === 1 ? "" : "s"} you may be eligible for
      </h2>
      <div className="mt-3 space-y-3">
        {benefits.map((benefit) => {
          const canApply = benefit.eligible && !benefit.status;
          return (
            <div key={benefit.schemeId} className="rounded-2xl border border-slate-100 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-700">{benefit.title}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {benefit.agency}
                    {benefit.eligible && benefit.status ? ` · ${STATUS_LABEL[benefit.status]}` : ""}
                  </p>
                </div>
                {canApply ? (
                  <button
                    onClick={() => applyMutation.mutate({ token, schemeId: benefit.schemeId })}
                    disabled={applyMutation.isPending}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[#0f766e] px-3 py-2 text-[10px] font-semibold text-white hover:bg-[#0b625c] disabled:opacity-50"
                  >
                    <CircleDollarSign className="h-3.5 w-3.5" />Apply
                  </button>
                ) : benefit.status ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#e1f4ed] px-2.5 py-1 text-[10px] font-semibold text-[#247563]">
                    <BadgeCheck className="h-3 w-3" />{STATUS_LABEL[benefit.status]}
                  </span>
                ) : null}
              </div>
              {benefit.description ? (
                <p className="mt-2 text-[11px] leading-5 text-slate-500">{benefit.description}</p>
              ) : null}
              <ul className="mt-3 space-y-1 border-t border-slate-50 pt-3">
                {benefit.checks.map((check) => (
                  <li key={check.label} className="flex items-start gap-1.5 text-[10px] text-slate-400">
                    {check.met ? (
                      <Check className="mt-0.5 h-3 w-3 shrink-0 text-[#10b981]" />
                    ) : (
                      <X className="mt-0.5 h-3 w-3 shrink-0 text-slate-300" />
                    )}
                    {check.label}
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
  return <div className="rounded-[26px] bg-white p-6 shadow-[0_20px_70px_rgba(24,52,48,0.08)]">{children}</div>;
}