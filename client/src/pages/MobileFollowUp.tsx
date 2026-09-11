import { ArrowLeft, ArrowRight, Check, ChevronDown, Clock3, HeartHandshake, LockKeyhole, MessageCircle, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Link, useSearch } from "wouter";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/SkillioShell";
import { trpc } from "@/lib/trpc";

const STATUS_OPTIONS: Array<{ label: string; outcomeType: "formal_employment" | "self_employment" | "apprenticeship" | "seeking_work" | "not_working" }> = [
  { label: "Working for an organisation", outcomeType: "formal_employment" },
  { label: "Running my own business", outcomeType: "self_employment" },
  { label: "Apprentice or trainee", outcomeType: "apprenticeship" },
  { label: "Looking for work", outcomeType: "seeking_work" },
  { label: "Studying or taking another course", outcomeType: "not_working" },
  { label: "Not working currently", outcomeType: "not_working" },
];

const WAGE_BANDS: Array<{ label: string; value?: string }> = [
  { label: "No regular income", value: "No income" },
  { label: "Below ₹10,000", value: "₹<10k" },
  { label: "₹10,000–₹19,999", value: "₹10k–₹19k" },
  { label: "₹20,000–₹29,999", value: "₹20k–₹29k" },
  { label: "₹30,000 or more", value: "₹30k+" },
  { label: "Prefer not to say" },
];

export default function MobileFollowUp() {
  const search = useSearch();
  // The signed pulse link is the authorisation, so the register stays closed to
  // enumeration. An expired or revoked link is indistinguishable from a bad one.
  const token = new URLSearchParams(search).get("t") ?? "";
  const traineeQuery = trpc.outcomes.traineePulse.useQuery(
    { token },
    { retry: false, enabled: Boolean(token) }
  );
  const submitMutation = trpc.followUps.submitPulseResponse.useMutation();

  const [step, setStep] = useState(1);
  const [status, setStatus] = useState("");
  const [wage, setWage] = useState("");
  const [relevance, setRelevance] = useState(0);
  const [permission, setPermission] = useState(true);
  const [submitted, setSubmitted] = useState(false);

  const firstName = (traineeQuery.data?.trainee.name ?? "there").split(" ")[0];
  const selectedStatus = STATUS_OPTIONS.find((option) => option.label === status);

  const next = () => {
    if (step === 1 && !status) return;
    if (step === 2 && !wage) return;
    if (step === 3) {
      if (!selectedStatus) return;
      submitMutation.mutate(
        {
          token,
          outcomeType: selectedStatus.outcomeType,
          wageBand: WAGE_BANDS.find((band) => band.label === wage)?.value,
          relevance: relevance >= 1 ? relevance : undefined,
          consentToContact: permission,
        },
        {
          onSuccess: () => setSubmitted(true),
          onError: (error) => toast.error(error.message),
        }
      );
      return;
    }
    setStep((current) => current + 1);
  };

  if (submitted) return <div className="flex min-h-screen items-center justify-center bg-[#edf9f4] px-5 py-10"><div className="w-full max-w-[420px] rounded-[28px] bg-white p-7 text-center shadow-[0_20px_70px_rgba(24,52,48,0.12)]"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#d9f1e6] text-[#247563]"><Check className="h-8 w-8" /></div><p className="mt-6 text-[10px] font-bold uppercase tracking-[0.18em] text-[#278271]">Thank you, {firstName}</p><h1 className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-[#153633]">Your outcome pulse is saved.</h1><p className="mt-3 text-sm leading-6 text-slate-500">Your response helps Skillio understand what happens after training. You can manage your consent at any time.</p><div className="mt-6 rounded-2xl bg-[#f6f8f7] p-4 text-left"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Recorded</p><div className="mt-3 flex items-center justify-between text-xs"><span className="text-slate-500">Current status</span><strong className="text-[#153633]">{status || "Working for an organisation"}</strong></div><div className="mt-2 flex items-center justify-between text-xs"><span className="text-slate-500">Income band</span><strong className="text-[#153633]">{wage || "Prefer not to say"}</strong></div></div><p className="mt-6 text-[11px] leading-5 text-slate-400">You can close this page. Your counsellor will see your answer and follow up only if you asked for it.</p></div></div>;
  if (!token || traineeQuery.error) return <div className="flex min-h-screen items-center justify-center bg-[#f1f6f4] px-5 py-10"><div className="w-full max-w-[420px] rounded-[28px] bg-white p-7 text-center shadow-[0_20px_70px_rgba(24,52,48,0.08)]"><h1 className="text-xl font-semibold tracking-[-0.05em] text-[#153633]">This follow-up link is not valid.</h1><p className="mt-2 text-sm text-slate-500">Open the personal link from your WhatsApp message. Links expire, so ask your counsellor for a fresh one.</p></div></div>;
  return <div className="min-h-screen bg-[#f1f6f4] px-4 py-5 sm:py-10"><div className="mx-auto w-full max-w-[430px]"><div className="mb-5 flex items-center justify-between">        <span className="flex items-center gap-2 text-xs font-semibold text-slate-400"><ArrowLeft className="h-4 w-4" />Private check-in</span><div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#0d2928] text-[#b8e3d5]"><HeartHandshake className="h-4 w-4" /></span><span className="text-sm font-semibold tracking-[-0.03em] text-[#153633]">Skillio</span></div><span className="text-[10px] text-slate-400">{step}/3</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-[#0f766e] transition-all" style={{ width: `${(step / 3) * 100}%` }} /></div><div className="mt-5 flex items-center gap-2 rounded-xl border border-[#ccebe1] bg-[#edf9f4] px-3 py-2.5 text-[11px] text-[#247563]"><LockKeyhole className="h-3.5 w-3.5" />Your answers are private and used only for the selected purpose.</div><div className="mt-4 rounded-[26px] bg-white p-6 shadow-[0_20px_70px_rgba(24,52,48,0.08)]"><div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#278271]">90-day outcome pulse</p><h1 className="mt-2 text-[25px] font-semibold tracking-[-0.055em] text-[#153633]">{step === 1 ? "How is work going?" : step === 2 ? "Tell us about your work" : "One last check-in"}</h1></div><StatusPill tone="teal">2 min</StatusPill></div><p className="mt-3 text-sm leading-6 text-slate-500">Hi {firstName}. Your feedback helps improve training and support for learners across Maharashtra.</p>{step === 1 ? <div className="mt-6 space-y-2.5">{STATUS_OPTIONS.map((option) => <button key={option.label} onClick={() => setStatus(option.label)} className={`flex w-full items-center justify-between rounded-xl border px-4 py-3.5 text-left text-xs font-medium transition-colors ${status === option.label ? "border-[#78c1ae] bg-[#edf9f4] text-[#247563]" : "border-slate-200 text-slate-600 hover:border-[#b8e3d5]"}`}>{option.label}<span className={`h-4 w-4 rounded-full border ${status === option.label ? "border-[5px] border-[#0f766e]" : "border-slate-300"}`} /></button>)}</div> : step === 2 ? <div className="mt-6 space-y-6"><div><label className="text-xs font-semibold text-slate-700">Approximate monthly income</label><div className="mt-2 space-y-2">{WAGE_BANDS.map((band) => <button key={band.label} onClick={() => setWage(band.label)} className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-xs font-medium transition-colors ${wage === band.label ? "border-[#78c1ae] bg-[#edf9f4] text-[#247563]" : "border-slate-200 text-slate-600 hover:border-[#b8e3d5]"}`}>{band.label}<span className={`h-4 w-4 rounded-full border ${wage === band.label ? "border-[5px] border-[#0f766e]" : "border-slate-300"}`} /></button>)}</div></div><div><label className="text-xs font-semibold text-slate-700">How useful was your training?</label><div className="mt-3 flex justify-between gap-2">{[1, 2, 3, 4, 5].map((rating) => <button key={rating} onClick={() => setRelevance(rating)} className={`flex h-10 flex-1 items-center justify-center rounded-lg border text-xs font-semibold ${relevance === rating ? "border-[#78c1ae] bg-[#edf9f4] text-[#247563]" : "border-slate-200 text-slate-500"}`}>{rating}</button>)}</div><div className="mt-1 flex justify-between text-[9px] text-slate-400"><span>Not useful</span><span>Extremely useful</span></div></div></div> : <div className="mt-6 space-y-5"><div className="rounded-2xl bg-[#f6f8f7] p-4"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#278271]" /><div><p className="text-xs font-semibold text-slate-700">May Skillio contact you again?</p><p className="mt-1 text-[11px] leading-5 text-slate-500">We will use your answer only to understand your training and work outcome.</p></div></div><button onClick={() => setPermission((current) => !current)} className={`mt-4 flex w-full items-center justify-between rounded-xl border px-3 py-3 text-xs font-semibold ${permission ? "border-[#78c1ae] bg-white text-[#247563]" : "border-slate-200 bg-white text-slate-500"}`}><span>{permission ? "Yes, contact me about my outcome" : "No, stop future optional follow-ups"}</span><span className={`h-4 w-4 rounded-full border ${permission ? "border-[5px] border-[#0f766e]" : "border-slate-300"}`} /></button></div><div className="rounded-2xl border border-[#eadfc7] bg-[#fffaf0] p-4"><p className="text-xs font-semibold text-[#8d651e]">Want support?</p><p className="mt-1 text-[11px] leading-5 text-slate-500">You can ask a counsellor to contact you about placement, skills, or other work barriers.</p><button className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#a56e18]">Request a counsellor <MessageCircle className="h-3.5 w-3.5" /></button></div></div>}<Button onClick={next} disabled={(step === 1 && !status) || (step === 2 && !wage) || submitMutation.isPending} className="mt-7 h-12 w-full rounded-xl bg-[#0f766e] text-xs font-semibold hover:bg-[#0b625c] disabled:cursor-not-allowed disabled:opacity-40">{submitMutation.isPending ? "Saving…" : step === 3 ? "Save my response" : "Continue"}<ArrowRight className="ml-2 h-4 w-4" /></Button><div className="mt-4 flex items-center justify-center gap-1.5 text-[10px] text-slate-400"><Clock3 className="h-3 w-3" />No exact salary or unnecessary personal details required</div></div><p className="mt-5 text-center text-[10px] leading-5 text-slate-400">Skillio · Maharashtra skilling outcomes · <button className="font-semibold text-[#278271]">Manage consent</button></p></div></div>;
}
