import { Building2, Check, CheckCircle2, ClipboardCheck, ExternalLink, LockKeyhole, ShieldCheck, UserRound } from "lucide-react";
import { useState } from "react";
import { useSearch } from "wouter";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/SkillioShell";
import { trpc } from "@/lib/trpc";

const WAGE_BAND_MAP: Record<string, string | undefined> = {
  "₹10,000–₹19,999": "₹10k–₹19k",
  "₹20,000–₹29,999": "₹20k–₹29k",
  "Prefer not to say": undefined,
};

export default function EmployerVerification() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const traineeRef = params.get("ref") ?? "SKL-1D8Q9P";
  const token = params.get("token");

  const [verified, setVerified] = useState<null | { outcomeEventId: number | null }>(null);
  const [current, setCurrent] = useState("Yes");
  const [role, setRole] = useState("Solar installation assistant");
  const [wage, setWage] = useState("₹10,000–₹19,999");
  const submitMutation = trpc.verification.submit.useMutation({
    onSuccess: (result) => {
      setVerified({ outcomeEventId: result.outcomeEventId });
    },
    onError: (error) => toast.error(error.message),
  });

  const submit = () => {
    if (!token) return;
    submitMutation.mutate({
      token,
      stillEmployed: current === "Yes",
      roleCategory: role,
      wageBand: WAGE_BAND_MAP[wage],
    });
  };

  if (!token) return <div className="flex min-h-screen items-center justify-center bg-[#f1f6f4] px-5 py-10"><div className="w-full max-w-[420px] rounded-[28px] bg-white p-7 text-center shadow-[0_20px_70px_rgba(24,52,48,0.08)]"><h1 className="text-xl font-semibold tracking-[-0.05em] text-[#153633]">This verification link is incomplete.</h1><p className="mt-2 text-sm text-slate-500">Please use the secure one-time link sent to you — it contains a verification token.</p></div></div>;
  if (verified) return <div className="flex min-h-screen items-center justify-center bg-[#f1f6f4] px-5 py-10"><div className="w-full max-w-[530px] rounded-[28px] bg-white p-8 text-center shadow-[0_20px_70px_rgba(24,52,48,0.1)]"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#d9f1e6] text-[#247563]"><Check className="h-8 w-8" /></div><p className="mt-6 text-[10px] font-bold uppercase tracking-[0.18em] text-[#278271]">Verification recorded</p><h1 className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-[#153633]">Thank you for confirming.</h1><p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-500">Skillio has updated the evidence level for this outcome. No additional information was shared with you.</p><div className="mt-6 rounded-2xl bg-[#f6f8f7] p-4 text-left"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Confirmation</p><div className="mt-3 flex items-center justify-between text-xs"><span className="text-slate-500">Trainee reference</span><strong className="text-[#153633]">{traineeRef}</strong></div><div className="mt-2 flex items-center justify-between text-xs"><span className="text-slate-500">Verification status</span><StatusPill tone={verified.outcomeEventId ? "teal" : "amber"}>{verified.outcomeEventId ? "Employer confirmed" : "Marked as not current"}</StatusPill></div></div><p className="mt-5 text-[10px] text-slate-400">This secure link expires after one submission.</p></div></div>;
  return <div className="min-h-screen bg-[#f1f6f4] px-5 py-10"><div className="mx-auto max-w-[580px]"><div className="mb-8 flex items-center justify-between"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0d2928] text-[#b8e3d5]"><ClipboardCheck className="h-5 w-5" /></span><span className="text-lg font-semibold tracking-[-0.04em] text-[#153633]">Skillio</span></div><div className="flex items-center gap-1.5 text-[10px] text-slate-400"><LockKeyhole className="h-3.5 w-3.5 text-[#278271]" />Secure verification</div></div><div className="rounded-[28px] bg-white p-7 shadow-[0_20px_70px_rgba(24,52,48,0.08)] sm:p-9"><div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#278271]">Employer confirmation</p><h1 className="mt-2 text-[27px] font-semibold tracking-[-0.055em] text-[#153633]">Confirm one work outcome.</h1></div><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#fbf0d9] text-[#a56e18]"><Building2 className="h-5 w-5" /></span></div><p className="mt-3 text-sm leading-6 text-slate-500">A trainee has reported a work outcome connected to a Maharashtra skilling programme. Please confirm only the fields you know.</p><div className="mt-7 rounded-2xl border border-slate-100 bg-[#f8faf9] p-4"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#dbeee7] text-xs font-bold text-[#247563]">IS</div><div><p className="text-xs font-semibold text-slate-700">Trainee reference {traineeRef}</p><p className="mt-1 text-[10px] text-slate-400">Reference only · no personal contact details shown</p></div></div></div><div className="mt-7 space-y-5"><div><label className="flex items-center gap-2 text-xs font-semibold text-slate-700"><UserRound className="h-3.5 w-3.5 text-slate-400" />Does this person currently work here?</label><div className="mt-2 grid grid-cols-2 gap-2">{["Yes", "No / not sure"].map((item) => <button key={item} onClick={() => setCurrent(item)} className={`rounded-xl border px-3 py-3 text-left text-xs font-medium ${current === item ? "border-[#78c1ae] bg-[#edf9f4] text-[#247563]" : "border-slate-200 text-slate-500"}`}>{item}</button>)}</div></div><div><label className="text-xs font-semibold text-slate-700">Role category</label><select value={role} onChange={(event) => setRole(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-[#dff2eb]"><option>Solar installation assistant</option><option>Field technician</option><option>Operations support</option><option>Other</option></select></div><div><label className="text-xs font-semibold text-slate-700">Approximate monthly income band</label><select value={wage} onChange={(event) => setWage(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-[#dff2eb]"><option>₹10,000–₹19,999</option><option>₹20,000–₹29,999</option><option>Prefer not to say</option></select></div></div><div className="mt-7 flex items-start gap-3 rounded-2xl border border-[#ccebe1] bg-[#edf9f4] p-4"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#278271]" /><p className="text-[11px] leading-5 text-slate-500">Your response will update the trainee’s evidence status. Skillio will not use this form to contact you for unrelated purposes.</p></div><Button onClick={submit} disabled={submitMutation.isPending} className="mt-6 h-12 w-full rounded-xl bg-[#0f766e] text-xs font-semibold hover:bg-[#0b625c]"><CheckCircle2 className="mr-2 h-4 w-4" />{submitMutation.isPending ? "Submitting…" : "Submit confirmation"}</Button><p className="mt-5 text-center text-[10px] text-slate-400">Questions? <a href="mailto:support@skillio.example" className="font-semibold text-[#278271]">Contact the Skillio team</a> <ExternalLink className="ml-0.5 inline h-3 w-3" /></p></div><p className="mt-5 text-center text-[10px] text-slate-400">This link is single-use and expires automatically.</p></div></div>;
}
