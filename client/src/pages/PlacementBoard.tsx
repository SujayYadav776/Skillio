import { BriefcaseBusiness, CheckCircle2, MapPin, Send, Sparkles, Target, TrendingUp } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeading, StatusPill } from "@/components/SkillioShell";
import { trpc } from "@/lib/trpc";

const STATUS_TONE: Record<string, "teal" | "amber" | "rose" | "violet" | "neutral"> = {
  matched: "neutral",
  referred: "amber",
  applied: "violet",
  interviewing: "violet",
  placed: "teal",
  rejected: "rose",
  withdrawn: "neutral",
};

/**
 * Employment exchange, staff side: every job seeker against every open posting,
 * with the match factors visible. A referral sends the outreach through the
 * messaging adapter; confirming a placement writes a verified outcome event.
 */
export default function PlacementBoard() {
  const utils = trpc.useUtils();
  const boardQuery = trpc.exchange.board.useQuery();
  const applicationsQuery = trpc.exchange.applications.useQuery();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    employerName: "",
    district: "",
    title: "",
    roleCategory: "",
    wageBand: "₹10k–₹19k",
    courseTags: "",
    seats: 1,
  });

  const invalidate = () => {
    void utils.exchange.board.invalidate();
    void utils.exchange.applications.invalidate();
    void utils.exchange.postings.invalidate();
  };

  const createPosting = trpc.exchange.createPosting.useMutation({
    onSuccess: () => {
      toast.success("Posting added to the exchange.");
      setForm({ ...form, employerName: "", title: "", roleCategory: "", courseTags: "" });
      setShowForm(false);
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const refer = trpc.exchange.refer.useMutation({
    onSuccess: (result) => {
      toast.success(
        result.duplicate
          ? "Already referred to this posting."
          : `Referral queued (${result.matchScore}% fit) — outreach sent.`
      );
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const confirm = trpc.exchange.confirmPlacement.useMutation({
    onSuccess: (result) =>
      toast.success(
        result.alreadyPlaced
          ? "This placement was already recorded."
          : "Placement confirmed — a verified outcome event was appended."
      ),
    onError: (error) => toast.error(error.message),
  });

  const board = boardQuery.data;
  const applications = applicationsQuery.data ?? [];
  const placed = applications.filter((application) => application.status === "placed").length;

  return (
    <div className="mx-auto max-w-[1280px]">
      <PageHeading
        eyebrow="Employment exchange"
        title="Match people to real jobs, and prove it."
        description="Every match shows the factors behind it. A referral sends the outreach through WhatsApp; a confirmed hire writes a verified outcome event into the trainee's record."
        action={
          <Button
            onClick={() => setShowForm((current) => !current)}
            className="h-10 gap-2 rounded-xl bg-[#0f766e] text-xs hover:bg-[#0b625c]"
          >
            <BriefcaseBusiness className="h-3.5 w-3.5" />
            {showForm ? "Cancel posting" : "Add job posting"}
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Stat label="Job seekers" value={board ? String(board.seekers) : "…"} detail="trainees looking for work" tone="teal" icon={Target} />
        <Stat label="Open postings" value={board ? String(board.postings) : "…"} detail="roles accepting referrals" tone="violet" icon={BriefcaseBusiness} />
        <Stat label="Placed this cycle" value={String(placed)} detail="employer-confirmed hires" tone="amber" icon={TrendingUp} />
      </div>

      {showForm ? (
        <Card className="mb-5 border-slate-200/80 bg-white shadow-[0_8px_28px_rgba(24,52,48,0.035)]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-[#153633]">New posting</CardTitle>
            <p className="mt-1 text-xs text-slate-400">
              Employers are created by name and reused across postings; the matcher uses the course tags.
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Employer">
                <input value={form.employerName} onChange={(e) => setForm({ ...form, employerName: e.target.value })} placeholder="Sharma Enterprises" className={inputClass} />
              </Field>
              <Field label="District">
                <input value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} placeholder="Pune" className={inputClass} />
              </Field>
              <Field label="Role title">
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="CNC Operator" className={inputClass} />
              </Field>
              <Field label="Role category">
                <input value={form.roleCategory} onChange={(e) => setForm({ ...form, roleCategory: e.target.value })} placeholder="Machining" className={inputClass} />
              </Field>
              <Field label="Wage band">
                <select value={form.wageBand} onChange={(e) => setForm({ ...form, wageBand: e.target.value })} className={inputClass}>
                  <option>₹&lt;10k</option>
                  <option>₹10k–₹19k</option>
                  <option>₹20k–₹29k</option>
                  <option>₹30k+</option>
                </select>
              </Field>
              <Field label="Course tags (comma separated)">
                <input value={form.courseTags} onChange={(e) => setForm({ ...form, courseTags: e.target.value })} placeholder="CNC Machining, Machining" className={inputClass} />
              </Field>
              <Field label="Seats">
                <input type="number" min={1} value={form.seats} onChange={(e) => setForm({ ...form, seats: Number(e.target.value) })} className={inputClass} />
              </Field>
            </div>
            <Button
              onClick={() =>
                createPosting.mutate({
                  employerName: form.employerName.trim(),
                  district: form.district.trim(),
                  title: form.title.trim(),
                  roleCategory: form.roleCategory.trim(),
                  wageBand: form.wageBand,
                  courseTags: form.courseTags
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                  seats: form.seats,
                })
              }
              disabled={
                createPosting.isPending ||
                !form.employerName.trim() ||
                !form.district.trim() ||
                !form.title.trim() ||
                !form.roleCategory.trim()
              }
              className="mt-4 h-9 rounded-lg bg-[#0f766e] text-xs hover:bg-[#0b625c]"
            >
              {createPosting.isPending ? "Saving…" : "Create posting"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-slate-200/80 bg-white shadow-[0_8px_28px_rgba(24,52,48,0.035)]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-[#153633]">Best matches</CardTitle>
          <p className="mt-1 text-xs text-slate-400">
            Ranked by district, course overlap, wage fit and open barriers — no black-box ranking.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {boardQuery.isLoading ? (
            <p className="py-8 text-center text-xs text-slate-400">Loading matches…</p>
          ) : !board || board.rows.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-400">
              No matches yet. Add a posting or check back when job seekers are registered.
            </p>
          ) : (
            board.rows.slice(0, 12).map((row) => (
              <div
                key={`${row.trainee.ref}-${row.posting.id}`}
                className="grid gap-4 rounded-2xl border border-slate-100 p-4 lg:grid-cols-[1.4fr_1.4fr_1fr_auto] lg:items-center"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#e6f0ed] text-xs font-bold text-[#247563]">
                    {row.trainee.initials}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-slate-700">{row.trainee.name}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-400">
                      <MapPin className="h-3 w-3" />
                      {row.trainee.district} · {row.trainee.course}
                    </p>
                    {row.trainee.barrier ? (
                      <p className="mt-1 text-[10px] text-[#a56e18]">Barrier: {row.trainee.barrier}</p>
                    ) : null}
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-slate-700">{row.posting.title}</p>
                  <p className="mt-0.5 truncate text-[11px] text-slate-400">
                    {row.posting.employer} · {row.posting.district}
                    {row.posting.wageBand ? ` · ${row.posting.wageBand}` : ""}
                  </p>
                  <ul className="mt-1.5 space-y-0.5">
                    {row.match.factors.slice(0, 3).map((factor) => (
                      <li key={factor.label} className="text-[10px] text-slate-400">
                        <span className="font-semibold text-slate-500">{factor.label}</span> — {factor.detail}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#e1f4ed] px-2.5 py-1.5 text-[11px] font-semibold text-[#247563]">
                    <Sparkles className="h-3.5 w-3.5" />
                    {row.match.score}% fit
                  </span>
                  {row.application ? (
                    <StatusPill tone={STATUS_TONE[row.application.status] ?? "neutral"}>
                      {row.application.status}
                    </StatusPill>
                  ) : null}
                </div>
                <div className="flex justify-end">
                  {row.application ? (
                    <span className="text-[10px] text-slate-400">Already in pipeline</span>
                  ) : (
                    <Button
                      onClick={() =>
                        refer.mutate({ traineeRef: row.trainee.ref, postingId: row.posting.id })
                      }
                      disabled={refer.isPending}
                      className="h-8 gap-1.5 rounded-lg bg-[#0f766e] px-3 text-[10px] hover:bg-[#0b625c]"
                    >
                      <Send className="h-3.5 w-3.5" />
                      Refer
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="mt-4 border-slate-200/80 bg-white shadow-[0_8px_28px_rgba(24,52,48,0.035)]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-[#153633]">Pipeline</CardTitle>
          <p className="mt-1 text-xs text-slate-400">
            Confirming a placement appends a verified outcome event, which updates the dashboard, the
            trainee's journey and their career passport.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {applicationsQuery.isLoading ? (
            <p className="py-6 text-center text-xs text-slate-400">Loading the pipeline…</p>
          ) : applications.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No referrals yet.</p>
          ) : (
            applications.map((application) => (
              <div
                key={application.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 p-4"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-700">
                    {application.traineeName}{" "}
                    <span className="font-normal text-slate-400">→ {application.postingTitle}</span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {application.employer} · {application.district} · {application.matchScore}% fit ·{" "}
                    {application.createdAt.slice(0, 10)}
                    {application.referredBy ? ` · referred by ${application.referredBy}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill tone={STATUS_TONE[application.status] ?? "neutral"}>
                    {application.status}
                  </StatusPill>
                  {application.status !== "placed" ? (
                    <Button
                      variant="outline"
                      onClick={() => confirm.mutate({ applicationId: application.id })}
                      disabled={confirm.isPending}
                      className="h-8 gap-1.5 rounded-lg border-[#b8e3d5] px-3 text-[10px] text-[#278271]"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Confirm placement
                    </Button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const inputClass =
  "h-9 w-full rounded-lg border border-slate-200 bg-[#f8faf9] px-3 text-xs text-slate-700 outline-none focus:border-[#80c6b4] focus:ring-2 focus:ring-[#dff2eb]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

function Stat({
  label,
  value,
  detail,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  tone: "teal" | "violet" | "amber";
  icon: typeof Target;
}) {
  const tones = {
    teal: "bg-[#e1f4ed] text-[#247563]",
    violet: "bg-[#eee9fb] text-[#6d50ad]",
    amber: "bg-[#fbf0d9] text-[#a56e18]",
  };
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_8px_28px_rgba(24,52,48,0.025)]">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{label}</span>
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${tones[tone]}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.06em] text-[#153633]">{value}</p>
      <p className="mt-1 text-[11px] text-slate-500">{detail}</p>
    </div>
  );
}
