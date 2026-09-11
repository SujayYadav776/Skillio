import { MessageSquarePlus, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const KIND_LABELS: Record<"grievance" | "wage_dispute" | "harassment" | "benefit" | "other", string> = {
  grievance: "General concern",
  wage_dispute: "Wage / payment dispute",
  harassment: "Safety / harassment",
  benefit: "A problem with a benefit",
  other: "Something else",
};

type GrievanceKind = keyof typeof KIND_LABELS;

/**
 * Grievance & support desk (A4). A worker can raise a concern and follow the
 * conversation with staff in one place — no phone number needed.
 */
export function GrievancePanel({ token }: { token: string }) {
  const utils = trpc.useUtils();
  const myCasesQuery = trpc.grievance.mine.useQuery({ token }, { retry: false });

  const [kind, setKind] = useState<GrievanceKind>("grievance");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const openMutation = trpc.grievance.open.useMutation({
    onSuccess: (result) => {
      toast.success("Your concern has been logged. A counsellor will reply here.");
      setSubject("");
      setBody("");
      void utils.grievance.mine.invalidate({ token });
      void utils.grievance.myCase.invalidate({ token, caseId: result.caseId });
    },
    onError: (error) => toast.error(error.message),
  });

  const open = () => {
    if (!subject.trim() || !body.trim()) {
      toast.error("Please add both a short subject and a message.");
      return;
    }
    openMutation.mutate({ token, kind, subject, body });
  };

  const cases = myCasesQuery.data ?? [];
  const hasOpen = cases.some((c) => c.status === "open" || c.status === "assigned");

  return (
    <div className="rounded-[26px] bg-white p-6 shadow-[0_20px_70px_rgba(24,52,48,0.08)]">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#278271]">Support & concerns</p>
      <h2 className="mt-1 text-sm font-semibold text-[#153633]">Raise a concern or get help</h2>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value as GrievanceKind)}
          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-[#b8e3d5]"
        >
          {Object.entries(KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <input
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          maxLength={160}
          placeholder="Short subject (e.g. wages not received)"
          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs outline-none focus:border-[#80c6b4]"
        />
      </div>
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={3}
        placeholder="Tell us what happened, so the right person can help."
        className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs outline-none focus:border-[#80c6b4]"
      />
      <button
        onClick={open}
        disabled={openMutation.isPending}
        className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#0f766e] px-3 py-2 text-[10px] font-semibold text-white hover:bg-[#0b625c] disabled:opacity-50"
      >
        <MessageSquarePlus className="h-3.5 w-3.5" />{openMutation.isPending ? "Sending…" : "Submit concern"}
      </button>

      {hasOpen && <MyCases token={token} cases={cases} />}
    </div>
  );

function MyCases({
  token,
  cases,
}: {
  token: string;
  cases: Array<{ id: number; title: string; status: string; createdAt: string }>;
}) {
  const [selected, setSelected] = useState<number | null>(cases[0]?.id ?? null);
  const threadQuery = trpc.grievance.myCase.useQuery(
    { token, caseId: selected ?? 0 },
    { enabled: selected != null, retry: false }
  );
  const replyMutation = trpc.grievance.reply.useMutation({
    onSuccess: () => {
      toast.success("Reply sent.");
      void threadQuery.refetch();
    },
    onError: (error) => toast.error(error.message),
  });
  const [draft, setDraft] = useState("");

  return cases.length === 0 ? null : (
    <div className="mt-5 rounded-2xl bg-[#f6f8f7] p-4">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Your conversations</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {cases.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelected(c.id)}
            className={
              "rounded-lg px-2.5 py-1.5 text-[10px] font-semibold " +
              (selected === c.id ? "bg-[#0f766e] text-white" : "bg-white text-slate-600 border border-slate-200")
            }
          >
            {c.title}
            <span className="ml-1.5 opacity-70">{c.status}</span>
          </button>
        ))}
      </div>

      {threadQuery.data && (
        <div className="mt-3 space-y-2">
          {threadQuery.data.messages.map((message) => (
            <div
              key={message.id}
              className={
                "max-w-[85%] rounded-xl px-3 py-2 text-[11px] leading-5 " +
                (message.author === "employee" ? "ml-auto bg-[#e1f4ed] text-[#1e5a4d]" : "bg-white text-slate-600 border border-slate-100")
              }
            >
              <p className="text-[9px] font-bold uppercase tracking-wider opacity-60">
                {message.author === "employee" ? "You" : message.authorName ?? "Skillio team"}
              </p>
              {message.body}
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Reply to this conversation…"
              className="h-9 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-xs outline-none focus:border-[#80c6b4]"
            />
            <button
              onClick={() => {
                if (selected != null && draft.trim()) {
                  replyMutation.mutate({ token, caseId: selected, body: draft });
                  setDraft("");
                }
              }}
              disabled={replyMutation.isPending}
              className="inline-flex h-9 items-center rounded-lg bg-[#0f766e] px-3 text-[10px] font-semibold text-white hover:bg-[#0b625c] disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
}