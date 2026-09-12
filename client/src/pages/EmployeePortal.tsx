import { ArrowLeft, BriefcaseBusiness, Clock3, FileUp, GraduationCap, LockKeyhole, Share2, Trash2, WalletCards } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearch } from "wouter";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { StatusPill } from "@/components/SkillioShell";
import { PassportPanel } from "@/components/PassportPanel";
import { EmployeeJobsPanel } from "@/components/EmployeeJobsPanel";
import { BenefitsPanel } from "@/components/BenefitsPanel";
import { GrievancePanel } from "@/components/GrievancePanel";
import { trpc } from "@/lib/trpc";

const TOKEN_STORAGE_KEY = "skillio-employee-token";

const KIND_LABELS: Record<string, string> = {
  certificate: "Certificate",
  payslip: "Payslip",
  id_document: "ID document",
  other: "Document",
};

const toneClasses: Record<string, string> = {
  teal: "bg-[#e1f4ed] text-[#278271]",
  amber: "bg-[#fbf0d9] text-[#a56e18]",
  rose: "bg-[#fce8e5] text-[#b65348]",
  violet: "bg-[#eee9fb] text-[#6d50ad]",
  slate: "bg-slate-100 text-slate-500",
};

export default function EmployeePortal() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const urlToken = params.get("token");

  // The portal link is the session: keep it across refreshes.
  const [token, setToken] = useState<string | null>(urlToken);
  useEffect(() => {
    if (urlToken) {
      localStorage.setItem(TOKEN_STORAGE_KEY, urlToken);
      setToken(urlToken);
      return;
    }
    setToken(localStorage.getItem(TOKEN_STORAGE_KEY));
  }, [urlToken]);

  if (!token) {
    return <PortalMessage
      title="This employee link is incomplete."
      body="Please use the personal link sent to you — it opens your Skillio career page."
    />;
  }

  return <PortalHome token={token} />;
}

function PortalHome({ token }: { token: string }) {
  const utils = trpc.useUtils();
  const portalQuery = trpc.employee.me.useQuery({ token }, { retry: false });
  const documentsQuery = trpc.employee.documents.list.useQuery({ token });
  const urlMutation = trpc.employee.documents.url.useMutation({
    onSuccess: (result) => window.open(result.url, "_blank"),
    onError: (error) => toast.error(error.message),
  });
  const deleteMutation = trpc.employee.documents.delete.useMutation({
    onSuccess: () => {
      toast.success("Document deleted");
      void utils.employee.documents.list.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const shareMutation = trpc.employee.certificates.createShareLink.useMutation({
    onSuccess: async (result) => {
      try {
        await navigator.clipboard.writeText(`${window.location.origin}${result.url}`);
        toast.success("Certificate link copied — anyone with it can verify your certificate for 30 days.");
      } catch {
        toast.error("Could not copy the link. Try again.");
      }
    },
    onError: (error) => toast.error(error.message),
  });
  const uploadMutation = trpc.employee.documents.upload.useMutation({
    onSuccess: () => {
      toast.success("Document saved to your vault");
      setUploadKind("certificate");
      setUploadTitle("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      void utils.employee.documents.list.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadKind, setUploadKind] = useState<"certificate" | "payslip" | "id_document" | "other">("certificate");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  // Guards live AFTER every hook so the hook order is identical on all renders.
  if (portalQuery.isLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-[#f1f6f4] px-5"><p className="text-sm text-slate-400">Opening your career page…</p></div>;
  }
  if (portalQuery.error || !portalQuery.data) {
    return <PortalMessage
      title="This link is no longer valid."
      body="Employee links expire after 30 days. Ask your Skillio counsellor for a fresh one."
    />;
  }
  const { profile, wageHistory, timeline } = portalQuery.data;

  const upload = () => {
    if (!uploadFile || !uploadTitle.trim()) {
      toast.error("Choose a file and give it a title first.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataBase64 = (reader.result as string).split(",")[1] ?? "";
      uploadMutation.mutate({
        token,
        kind: uploadKind,
        title: uploadTitle.trim(),
        fileName: uploadFile.name,
        mimeType: uploadFile.type || "application/octet-stream",
        dataBase64,
      });
    };
    reader.readAsDataURL(uploadFile);
  };

  const firstName = profile.name.split(" ")[0];
  const chartData = wageHistory
    .filter((point) => point.value !== null)
    .map((point) => ({ ...point, label: point.band }));

  return <div className="min-h-screen bg-[#f1f6f4] px-4 py-6 sm:py-10"><div className="mx-auto w-full max-w-[460px] space-y-4">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0d2928] text-[#b8e3d5]"><BriefcaseBusiness className="h-4 w-4" /></span>
        <span className="text-sm font-semibold tracking-[-0.03em] text-[#153633]">Skillio Careers</span>
      </div>
      <span className="text-[10px] text-slate-400">Ref {profile.traineeRef}</span>
    </div>

    <div className="rounded-[26px] bg-white p-6 shadow-[0_20px_70px_rgba(24,52,48,0.08)]">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#278271]">Your career page</p>
          <h1 className="mt-1 text-[24px] font-semibold tracking-[-0.05em] text-[#153633]">Hi {firstName} 👋</h1>
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#dbeee7] text-sm font-semibold text-[#247563]">{profile.initials}</div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <StatusPill tone="teal">{profile.statusLabel}</StatusPill>
        {profile.roleCategory ? <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-500"><BriefcaseBusiness className="h-3.5 w-3.5" />{profile.roleCategory}</span> : null}
        {profile.industry ? <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-500">{profile.industry}</span> : null}
        {profile.wageBand ? <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-500"><WalletCards className="h-3.5 w-3.5" />{profile.wageBand}</span> : null}
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-500"><Clock3 className="h-3.5 w-3.5" />{profile.retentionDays ? `${profile.retentionDays} days in work` : "Starting out"}</span>
      </div>
    </div>

    <PassportPanel token={token} />

    <EmployeeJobsPanel token={token} />

    <BenefitsPanel token={token} />

    <GrievancePanel token={token} />

    {chartData.length > 1 ? (
      <div className="rounded-[26px] bg-white p-6 shadow-[0_20px_70px_rgba(24,52,48,0.08)]">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#278271]">Income progression</p>
        <h2 className="mt-1 text-sm font-semibold text-[#153633]">How your monthly band has grown</h2>
        <div className="mt-3 h-[160px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#edf1ef" vertical={false} />
              <XAxis dataKey="band" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={(value) => `₹${value}k`} />
              <Tooltip formatter={(value) => [`₹${value}k`, "Band mid-point"]} contentStyle={{ borderRadius: 12, fontSize: 12, border: "1px solid #e2e8e5" }} cursor={{ fill: "#f6f8f7" }} />
              <Bar dataKey="value" radius={[7, 7, 2, 2]} barSize={34}>
                {chartData.map((entry, index) => <Cell key={index} fill={index === chartData.length - 1 ? "#0f766e" : "#d7b97b"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    ) : null}

    <div className="rounded-[26px] bg-white p-6 shadow-[0_20px_70px_rgba(24,52,48,0.08)]">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#278271]">Your journey</p>
      <h2 className="mt-1 text-sm font-semibold text-[#153633]">Everything you have achieved</h2>
      <div className="relative ml-2 mt-4 border-l border-slate-200 pl-6">
        {timeline.map((event, index) => (
          <div key={event.id} className="relative pb-5 last:pb-0">
            <span className={`absolute -left-[33px] top-0 flex h-5 w-5 items-center justify-center rounded-full ring-4 ring-white ${toneClasses[event.tone] ?? toneClasses.slate}`}><span className="h-1.5 w-1.5 rounded-full bg-current" /></span>
            <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-700">{event.title}</p>
                <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{event.description}</p>
              </div>
              <span className="shrink-0 text-[10px] text-slate-400">{event.date}</span>
            </div>
            {index < timeline.length - 1 ? <div className="mt-4" /> : null}
          </div>
        ))}
      </div>
    </div>

    <div className="rounded-[26px] bg-white p-6 shadow-[0_20px_70px_rgba(24,52,48,0.08)]">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#278271]">Your skills</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {profile.skills.map((skill) => <span key={skill} className="inline-flex items-center gap-1.5 rounded-xl border border-[#ccebe1] bg-[#edf9f4] px-3 py-2 text-[11px] font-medium text-[#247563]"><GraduationCap className="h-3.5 w-3.5" />{skill}</span>)}
      </div>
    </div>

    <div className="rounded-[26px] bg-white p-6 shadow-[0_20px_70px_rgba(24,52,48,0.08)]">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#278271]">Shareable certificates</p>
      <h2 className="mt-1 text-sm font-semibold text-[#153633]">Prove your training anywhere</h2>
      <div className="mt-3 space-y-3">
        {portalQuery.data.certificates.map((certificate) => (
          <div key={certificate.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 p-3">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-slate-700">{certificate.course}</p>
              <p className="mt-0.5 text-[10px] text-slate-400">{certificate.provider} · completed {certificate.completionDate.slice(0, 10)}</p>
            </div>
            <button onClick={() => shareMutation.mutate({ token, trainingRecordId: certificate.id })} disabled={shareMutation.isPending} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#0f766e] px-3 py-2 text-[10px] font-semibold text-white hover:bg-[#0b625c] disabled:opacity-50"><Share2 className="h-3.5 w-3.5" />Share</button>
          </div>
        ))}
        {portalQuery.data.certificates.length === 0 ? <p className="text-[11px] text-slate-400">Certificates appear here once your training completion is recorded.</p> : null}
      </div>
    </div>

    <div className="rounded-[26px] bg-white p-6 shadow-[0_20px_70px_rgba(24,52,48,0.08)]">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#278271]">Document vault</p>
      <h2 className="mt-1 text-sm font-semibold text-[#153633]">Your papers, always with you</h2>

      <div className="mt-3 space-y-2">
        {documentsQuery.isLoading ? <p className="text-[11px] text-slate-400">Loading your documents…</p> : (documentsQuery.data ?? []).length === 0 ? <p className="text-[11px] text-slate-400">Nothing uploaded yet. Certificates, payslips, or ID documents — your choice.</p> : (documentsQuery.data ?? []).map((document) => (
          <div key={document.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 p-3">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-slate-700">{document.title}</p>
              <p className="mt-0.5 text-[10px] text-slate-400">{KIND_LABELS[document.kind] ?? document.kind} · {(document.sizeBytes / 1024).toFixed(0)} KB · {document.createdAt.slice(0, 10)}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button onClick={() => urlMutation.mutate({ token, documentId: document.id })} disabled={urlMutation.isPending} className="rounded-lg border border-[#b8e3d5] px-2.5 py-1.5 text-[10px] font-semibold text-[#278271] hover:bg-[#edf9f4] disabled:opacity-50">Open</button>
              <button onClick={() => deleteMutation.mutate({ token, documentId: document.id })} disabled={deleteMutation.isPending} className="rounded-lg border border-rose-100 px-2 py-1.5 text-rose-500 hover:bg-rose-50 disabled:opacity-50" aria-label={`Delete ${document.title}`}><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-2xl bg-[#f6f8f7] p-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Add a document</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <select value={uploadKind} onChange={(event) => setUploadKind(event.target.value as typeof uploadKind)} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-[#b8e3d5]">
            <option value="certificate">Certificate</option>
            <option value="payslip">Payslip</option>
            <option value="id_document">ID document</option>
            <option value="other">Other</option>
          </select>
          <input value={uploadTitle} onChange={(event) => setUploadTitle(event.target.value)} placeholder="Title (e.g. TSC certificate)" className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs outline-none focus:border-[#80c6b4]" />
        </div>
        <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)} className="mt-2 block w-full text-[10px] text-slate-500 file:mr-2 file:rounded-lg file:border-0 file:bg-[#0f766e] file:px-3 file:py-2 file:text-[10px] file:font-semibold file:text-white" />
        <button onClick={upload} disabled={uploadMutation.isPending} className="mt-3 h-10 w-full rounded-lg bg-[#0f766e] text-xs font-semibold text-white hover:bg-[#0b625c] disabled:opacity-50"><FileUp className="mr-2 inline h-4 w-4" />{uploadMutation.isPending ? "Saving…" : "Save to my vault"}</button>
        <p className="mt-2 text-[10px] leading-4 text-slate-400">PDF, JPEG, PNG or WebP up to 5 MB. Certificates are kept until you delete them; other documents expire after 24 months. Uploading records your consent to store the document for your career page.</p>
      </div>
    </div>

    <div className="flex items-start gap-2 rounded-xl border border-[#ccebe1] bg-[#edf9f4] px-3 py-2.5 text-[11px] text-[#247563]"><LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />This page is only for you. Skillio never shares your details without your consent — manage it any time.</div>
    <p className="pb-4 text-center text-[10px] text-slate-400">Skillio · Maharashtra skilling outcomes</p>
  </div></div>;
}

function PortalMessage({ title, body }: { title: string; body: string }) {
  return <div className="flex min-h-screen items-center justify-center bg-[#f1f6f4] px-5 py-10"><div className="w-full max-w-[420px] rounded-[28px] bg-white p-7 text-center shadow-[0_20px_70px_rgba(24,52,48,0.08)]"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0d2928] text-[#b8e3d5]"><ArrowLeft className="h-5 w-5" /></span><h1 className="mt-4 text-xl font-semibold tracking-[-0.05em] text-[#153633]">{title}</h1><p className="mt-2 text-sm leading-6 text-slate-500">{body}</p></div></div>;
}
