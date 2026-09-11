import { Award, BarChart3, Info, ShieldCheck } from "lucide-react";
import { useParams, Link } from "wouter";
import { trpc } from "@/lib/trpc";

/**
 * Public accountability surface: how each training provider's graduates fare in
 * work. Providers with fewer than ten completions are listed but suppressed, so
 * publishing never identifies an individual.
 */
export default function Scorecards() {
  const params = useParams<{ slug?: string }>();
  const slug = params.slug;
  const listQuery = trpc.scorecards.list.useQuery();
  const detailQuery = trpc.scorecards.byProvider.useQuery({ slug: slug ?? "" }, { enabled: Boolean(slug) });

  if (slug) {
    if (detailQuery.isLoading) {
      return <Shell><p className="text-sm text-slate-400">Loading scorecard…</p></Shell>;
    }
    if (detailQuery.error || !detailQuery.data) {
      return (
        <Shell>
          <div className="rounded-[28px] bg-white p-8 text-center shadow-[0_20px_70px_rgba(24,52,48,0.08)]">
            <h1 className="text-xl font-semibold tracking-[-0.05em] text-[#153633]">Provider not found</h1>
            <p className="mt-2 text-sm text-slate-500">No scorecard exists for this provider.</p>
            <Link href="/scorecards" className="mt-4 inline-block text-xs font-semibold text-[#278271] hover:underline">
              View all scorecards
            </Link>
          </div>
        </Shell>
      );
    }
    const card = detailQuery.data;
    return (
      <Shell>
        <div className="rounded-[28px] bg-white p-6 shadow-[0_20px_70px_rgba(24,52,48,0.08)] sm:p-8">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#278271]">Provider scorecard</p>
          <h1 className="mt-2 text-[26px] font-semibold tracking-[-0.05em] text-[#153633]">{card.provider}</h1>
          <p className="mt-1 text-xs text-slate-400">
            {card.completed} recorded completions · {card.districts.join(" · ")}
          </p>
          {card.published ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <Figure label="Verified outcomes" value={`${card.verified}%`} />
              <Figure label="90-day retention" value={`${card.retention}%`} />
              <Figure label="Average relevance" value={card.relevance !== null ? `${card.relevance}/5` : "—"} />
            </div>
          ) : (
            <p className="mt-5 rounded-2xl border border-[#eadfc7] bg-[#fffaf0] p-4 text-[11px] leading-5 text-[#8d651e]">
              {card.suppressionNote}
            </p>
          )}
          <Link href="/scorecards" className="mt-5 inline-block text-xs font-semibold text-[#278271] hover:underline">
            ← All providers
          </Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="rounded-[28px] bg-white p-6 shadow-[0_20px_70px_rgba(24,52,48,0.08)] sm:p-8">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#278271]">
          Public accountability
        </p>
        <h1 className="mt-2 text-[26px] font-semibold tracking-[-0.05em] text-[#153633]">
          How training providers perform
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
          These figures come from the same verified outcome register the state dashboard uses: employment
          confirmed by employers, retention at 90 days, and how relevant graduates found their roles.
        </p>
        <p className="mt-3 inline-flex items-start gap-2 rounded-xl border border-[#ccebe1] bg-[#edf9f4] px-3 py-2.5 text-[11px] leading-5 text-[#247563]">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Providers with fewer than ten completions are listed without figures, so no individual can be identified.
        </p>
      </div>

      <div className="mt-4 space-y-3">
        {listQuery.isLoading ? (
          <p className="rounded-[28px] bg-white p-8 text-center text-sm text-slate-400 shadow-[0_20px_70px_rgba(24,52,48,0.08)]">
            Loading provider performance…
          </p>
        ) : (listQuery.data ?? []).length === 0 ? (
          <p className="rounded-[28px] bg-white p-8 text-center text-sm text-slate-400 shadow-[0_20px_70px_rgba(24,52,48,0.08)]">
            No provider data yet.
          </p>
        ) : (
          (listQuery.data ?? []).map((card) => (
            <Link
              key={card.slug}
              href={`/scorecards/${card.slug}`}
              className="block rounded-[24px] bg-white p-5 shadow-[0_20px_70px_rgba(24,52,48,0.08)] transition-colors hover:bg-[#fbfffd]"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e1f4ed] text-[#247563]">
                    <Award className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-slate-700">{card.provider}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {card.completed} completions · {card.districts.join(" · ") || "district unrecorded"}
                    </p>
                  </div>
                </div>
                {card.published ? (
                  <div className="flex gap-4">
                    <Mini label="Verified" value={`${card.verified}%`} />
                    <Mini label="Retention" value={`${card.retention}%`} />
                    <Mini
                      label="Relevance"
                      value={card.relevance !== null ? `${card.relevance}/5` : "—"}
                    />
                  </div>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-[10px] font-semibold text-slate-500">
                    <Info className="h-3 w-3" />Figures suppressed
                  </span>
                )}
              </div>
            </Link>
          ))
        )}
      </div>

      <p className="mt-5 flex items-center justify-center gap-2 pb-4 text-[10px] text-slate-400">
        <BarChart3 className="h-3 w-3" />
        Skillio · Maharashtra skilling outcomes · Updated from the live register
      </p>
    </Shell>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-[#f6f8f7] p-4">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-[-0.06em] text-[#153633]">{value}</p>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className="text-sm font-semibold text-[#153633]">{value}</p>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f1f6f4] px-4 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-[820px]">{children}</div>
    </div>
  );
}
