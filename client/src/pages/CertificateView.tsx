import { BadgeCheck, ShieldCheck } from "lucide-react";
import { useSearch } from "wouter";
import { trpc } from "@/lib/trpc";

export default function CertificateView() {
  const search = useSearch();
  const token = new URLSearchParams(search).get("token") ?? "";
  const query = trpc.employee.certificates.view.useQuery({ token }, { retry: false });

  if (query.isLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-[#f1f6f4] px-5"><p className="text-sm text-slate-400">Verifying certificate…</p></div>;
  }
  if (query.error || !query.data) {
    return <div className="flex min-h-screen items-center justify-center bg-[#f1f6f4] px-5 py-10"><div className="w-full max-w-[420px] rounded-[28px] bg-white p-7 text-center shadow-[0_20px_70px_rgba(24,52,48,0.08)]"><h1 className="text-xl font-semibold tracking-[-0.05em] text-[#153633]">This certificate link is not valid.</h1><p className="mt-2 text-sm text-slate-500">Share links expire after 30 days. Ask the certificate holder for a fresh one.</p></div></div>;
  }

  const certificate = query.data;
  return <div className="flex min-h-screen items-center justify-center bg-[#f1f6f4] px-4 py-10"><div className="w-full max-w-[560px]">
    <div className="rounded-[28px] border-[6px] border-[#0f766e] bg-white p-8 text-center shadow-[0_20px_70px_rgba(24,52,48,0.12)]">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0d2928] text-[#b8e3d5]"><ShieldCheck className="h-6 w-6" /></span>
      <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.2em] text-[#278271]">Skillio verified training certificate</p>
      <h1 className="mt-4 text-[26px] font-semibold tracking-[-0.05em] text-[#153633]">{certificate.name}</h1>
      <p className="mt-1 text-xs text-slate-400">{certificate.district} · Maharashtra skilling programme</p>
      <div className="mt-6 rounded-2xl bg-[#f6f8f7] p-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Has successfully completed</p>
        <p className="mt-2 text-lg font-semibold leading-6 text-[#153633]">{certificate.course}</p>
        <p className="mt-1 text-xs text-slate-500">{certificate.provider} · cohort {certificate.cohort}</p>
        {certificate.completionDate ? <p className="mt-1 text-xs text-slate-500">Completed {certificate.completionDate.slice(0, 10)}</p> : null}
      </div>
      <div className="mt-6 flex items-center justify-center gap-2">
        <BadgeCheck className={certificate.verified ? "h-5 w-5 text-[#278271]" : "h-5 w-5 text-[#a56e18]"} />
        <span className={`text-xs font-semibold ${certificate.verified ? "text-[#278271]" : "text-[#a56e18]"}`}>
          {certificate.verified ? "Employment outcome verified by Skillio" : "Outcome evidence pending verification"}
        </span>
      </div>
    </div>
    <p className="mt-4 text-center text-[10px] leading-5 text-slate-400">This page was shared by the certificate holder through Skillio. It contains only training information — no personal contact details.</p>
  </div></div>;
}
