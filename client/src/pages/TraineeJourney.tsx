import { ArrowLeft, BriefcaseBusiness, CalendarDays, Check, ChevronRight, Clock3, Edit3, ExternalLink, MessageCircle, Phone, ShieldCheck, Sparkles, UserRound, WalletCards } from "lucide-react";
import { Link, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { PageHeading, SectionEyebrow, StatusPill } from "@/components/SkillioShell";
import { useState } from "react";

const toneClasses = { teal: "bg-[#e1f4ed] text-[#278271]", amber: "bg-[#fbf0d9] text-[#a56e18]", rose: "bg-[#fce8e5] text-[#b65348]", violet: "bg-[#eee9fb] text-[#6d50ad]", slate: "bg-slate-100 text-slate-500" };

export default function TraineeJourney() {
  const { id } = useParams<{ id: string }>();
  const utils = trpc.useUtils();
  const journeyQuery = trpc.outcomes.traineeJourney.useQuery(
    { id: id ?? "" },
    { retry: false, enabled: Boolean(id) }
  );
  const withdrawMutation = trpc.consent.withdraw.useMutation({
    onSuccess: () => {
      void utils.outcomes.traineeJourney.invalidate({ id: id ?? "" });
    },
  });
  const createLinkMutation = trpc.verification.createLink.useMutation({
    onSuccess: async (result) => {
      try {
        await navigator.clipboard.writeText(`${window.location.origin}${result.url}`);
        showToast("One-time verification link copied to clipboard.");
      } catch {
        showToast("Verification link created — clipboard unavailable.");
      }
    },
    onError: (error) => showToast(error.message),
  });
  const createPortalLinkMutation = trpc.employee.createLink.useMutation({
    onSuccess: async (result) => {
      try {
        await navigator.clipboard.writeText(`${window.location.origin}${result.url}`);
        showToast("Employee portal link copied to clipboard.");
      } catch {
        showToast("Employee portal link created — clipboard unavailable.");
      }
    },
    onError: (error) => showToast(error.message),
  });
  const [toast, setToast] = useState("");
  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(""), 3500);
  };

  if (journeyQuery.isLoading) {
    return <div className="mx-auto max-w-[1220px]"><Card className="border-slate-200/80 bg-white shadow-[0_8px_28px_rgba(24,52,48,0.035)]"><CardContent className="p-10 text-center text-xs text-slate-400">Loading trainee journey…</CardContent></Card></div>;
  }
  if (journeyQuery.error || !journeyQuery.data) {
    const missing = journeyQuery.error?.data?.code === "NOT_FOUND";
    return <div className="mx-auto max-w-[1220px]"><Link href="/cohorts" className="mb-5 inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-[#278271]"><ArrowLeft className="h-3.5 w-3.5" />Back to cohort explorer</Link><Card className="border-slate-200/80 bg-white shadow-[0_8px_28px_rgba(24,52,48,0.035)]"><CardContent className="p-10 text-center"><p className="text-sm font-semibold text-[#153633]">{missing ? "Trainee journey not found" : "Something went wrong"}</p><p className="mt-1 text-xs text-slate-400">{missing ? "This journey does not exist or has been removed." : journeyQuery.error?.message}</p></CardContent></Card></div>;
  }

  const trainee = journeyQuery.data.trainee;
  const timeline = journeyQuery.data.timeline;
  const consentActive = trainee.consent === "active";
  const updateConsent = () => {
    if (!consentActive) {
      showToast("Re-consent must be captured from the trainee directly.");
      return;
    }
    withdrawMutation.mutate({ traineeId: trainee.id, purposeCode: "outcome_follow_up" });
    showToast("Outcome follow-up consent withdrawn. Future messages are paused.");
  };
  return <div className="mx-auto max-w-[1220px]"><Link href="/cohorts" className="mb-5 inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-[#278271]"><ArrowLeft className="h-3.5 w-3.5" />Back to cohort explorer</Link><PageHeading eyebrow="Trainee journey" title={trainee.name} description={`${trainee.course} · ${trainee.provider} · ${trainee.district}`} action={<div className="flex gap-2"><Button variant="outline" className="h-10 gap-2 rounded-xl border-slate-200 bg-white text-xs text-slate-600"><Edit3 className="h-3.5 w-3.5" />Update record</Button><Button className="h-10 gap-2 rounded-xl bg-[#0f766e] text-xs hover:bg-[#0b625c]"><MessageCircle className="h-3.5 w-3.5" />Start follow-up</Button></div>} />
    {toast ? <div className="mb-5 flex items-center gap-2 rounded-xl border border-[#b8e3d5] bg-[#edf9f4] px-4 py-3 text-xs font-medium text-[#247563]"><Check className="h-4 w-4" />{toast}</div> : null}
    <div className="grid gap-4 lg:grid-cols-[1fr_310px]"><div className="space-y-4"><Card className="border-slate-200/80 bg-white shadow-[0_8px_28px_rgba(24,52,48,0.035)]"><CardContent className="p-5"><div className="flex flex-col gap-5 sm:flex-row sm:items-start"><div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-[#dbeee7] text-lg font-semibold text-[#247563]">{trainee.initials}</div><div className="flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold tracking-[-0.03em] text-[#153633]">{trainee.name}</h2><StatusPill tone={trainee.statusColor === "teal" ? "teal" : trainee.statusColor === "rose" ? "rose" : trainee.statusColor === "amber" ? "amber" : "violet"}>{trainee.statusLabel}</StatusPill></div><p className="mt-1 text-xs text-slate-400">Reference {trainee.ref} · Preferred language: {trainee.language}</p><div className="mt-4 flex flex-wrap gap-2"><span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-500"><CalendarDays className="h-3.5 w-3.5" />Cohort {trainee.cohort}</span><span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-500"><WalletCards className="h-3.5 w-3.5" />{trainee.wageBand}</span><span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-500"><Clock3 className="h-3.5 w-3.5" />{trainee.retentionDays ? `${trainee.retentionDays} days in outcome` : "No placement yet"}</span></div></div></div></CardContent></Card>
      <Card className="border-slate-200/80 bg-white shadow-[0_8px_28px_rgba(24,52,48,0.035)]"><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3"><div><CardTitle className="text-sm font-semibold text-[#153633]">Journey timeline</CardTitle><p className="mt-1 text-xs text-slate-400">Events are preserved; new updates never overwrite history</p></div><StatusPill tone="teal">{timeline.length} events</StatusPill></CardHeader><CardContent><div className="relative ml-2 border-l border-slate-200 pl-7">{timeline.map((event, index) => <div key={event.id} className="relative pb-7 last:pb-1"><span className={`absolute -left-[39px] top-0 flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-white ${toneClasses[event.tone]}`}><span className="h-2 w-2 rounded-full bg-current" /></span><div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-semibold text-slate-700">{event.title}</p><p className="mt-1 max-w-xl text-xs leading-5 text-slate-500">{event.description}</p></div><span className="shrink-0 text-[10px] font-medium text-slate-400">{event.date}</span></div>{index < timeline.length - 1 ? <div className="mt-5" /> : null}</div>)}</div></CardContent></Card>
      </div><div className="space-y-4"><Card className="border-[#ccebe1] bg-[#edf9f4] shadow-[0_8px_28px_rgba(24,52,48,0.035)]"><CardHeader className="pb-2"><div className="flex items-center gap-2 text-[#247563]"><Sparkles className="h-4 w-4" /><CardTitle className="text-sm font-semibold">Next best action</CardTitle></div></CardHeader><CardContent><p className="text-sm font-semibold leading-6 text-[#153633]">{trainee.barrier === "Transport cost" ? "Connect to nearby employers and transport support." : trainee.barrier === "Role mismatch" ? "Invite trainee to a course relevance interview." : "Check in on outcome and offer marketplace support."}</p><p className="mt-2 text-xs leading-5 text-slate-500">Generated from the latest response, evidence level, and barrier signal.</p><Button className="mt-4 h-9 w-full rounded-lg bg-[#0f766e] text-xs hover:bg-[#0b625c]"><Phone className="mr-2 h-3.5 w-3.5" />Assign to counsellor</Button></CardContent></Card>
      <Card className="border-slate-200/80 bg-white shadow-[0_8px_28px_rgba(24,52,48,0.035)]"><CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-[#153633]">Evidence confidence</CardTitle><p className="mt-1 text-xs text-slate-400">Confidence is explainable, not a claim of truth</p></CardHeader><CardContent><div className="flex items-end justify-between"><span className="text-3xl font-semibold tracking-[-0.06em] text-[#153633]">{trainee.outcomeStatus === "verified" ? "0.91" : trainee.outcomeStatus === "pending" ? "0.64" : "0.58"}</span><StatusPill tone={trainee.outcomeStatus === "verified" ? "teal" : trainee.outcomeStatus === "pending" ? "amber" : "neutral"}>{trainee.outcomeStatus.replace("_", " ")}</StatusPill></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#4ca58f]" style={{ width: `${trainee.outcomeStatus === "verified" ? 91 : trainee.outcomeStatus === "pending" ? 64 : 58}%` }} /></div><div className="mt-4 space-y-2 text-[11px] text-slate-500"><p className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-[#278271]" />Self-report captured</p>{trainee.outcomeStatus === "verified" ? <p className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-[#278271]" />Employer confirmation received</p> : <p className="flex items-center gap-2"><Clock3 className="h-3.5 w-3.5 text-[#a56e18]" />Employer confirmation pending</p>}<p className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-[#278271]" />Updated {trainee.lastUpdated}</p></div></CardContent></Card>
      <Card className="border-slate-200/80 bg-white shadow-[0_8px_28px_rgba(24,52,48,0.035)]"><CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-[#153633]">Consent & privacy</CardTitle><p className="mt-1 text-xs text-slate-400">Purpose-specific permissions</p></CardHeader><CardContent><div className="flex items-start gap-3"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#e1f4ed] text-[#278271]"><ShieldCheck className="h-4 w-4" /></div><div className="flex-1"><p className="text-xs font-semibold text-slate-700">Outcome follow-up</p><p className="mt-1 text-[11px] leading-4 text-slate-400">{consentActive ? "Active · outcome pulses enabled" : "Withdrawn · future messages paused"}</p></div><button onClick={updateConsent} disabled={withdrawMutation.isPending} className={`relative h-6 w-10 rounded-full transition-colors ${consentActive ? "bg-[#0f766e]" : "bg-slate-300"}`} aria-label="Toggle outcome follow-up consent"><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${consentActive ? "left-5" : "left-1"}`} /></button></div><div className="my-4 border-t border-slate-100" /><div className="flex items-center justify-between"><span className="text-[11px] text-slate-500">Programme improvement</span><span className="text-[11px] font-semibold text-[#278271]">De-identified only</span></div><button className="mt-4 inline-flex items-center gap-1 text-[11px] font-semibold text-[#278271] hover:underline">View consent receipt <ExternalLink className="h-3 w-3" /></button></CardContent></Card>
      <Link href={`/follow-ups?trainee=${trainee.id}`} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-semibold text-slate-600 shadow-[0_8px_28px_rgba(24,52,48,0.025)] hover:border-[#b8e3d5] hover:text-[#278271]">View follow-up history <ChevronRight className="h-4 w-4" /></Link>
      <button onClick={() => createLinkMutation.mutate({ traineeRef: trainee.ref })} disabled={createLinkMutation.isPending} className="flex w-full items-center justify-between rounded-xl border border-[#ccebe1] bg-[#edf9f4] px-4 py-3 text-xs font-semibold text-[#247563] shadow-[0_8px_28px_rgba(24,52,48,0.025)] hover:border-[#78c1ae] disabled:opacity-50">{createLinkMutation.isPending ? "Creating link…" : "Send employer verification link"}<ShieldCheck className="h-4 w-4" /></button>
      <button onClick={() => createPortalLinkMutation.mutate({ traineeRef: trainee.ref })} disabled={createPortalLinkMutation.isPending} className="flex w-full items-center justify-between rounded-xl border border-[#ccebe1] bg-[#edf9f4] px-4 py-3 text-xs font-semibold text-[#247563] shadow-[0_8px_28px_rgba(24,52,48,0.025)] hover:border-[#78c1ae] disabled:opacity-50">{createPortalLinkMutation.isPending ? "Creating link…" : "Send employee career page link"}<BriefcaseBusiness className="h-4 w-4" /></button>
    </div></div>
  </div>;
}
