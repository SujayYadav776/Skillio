import {
  Activity,
  BarChart3,
  Bell,
  ChevronDown,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  LifeBuoy,
  Menu,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navigation = [
  { label: "Command centre", path: "/", icon: LayoutDashboard },
  { label: "Cohorts & providers", path: "/cohorts", icon: BarChart3 },
  { label: "Trainee journeys", path: "/trainees/asha-patil", icon: Users },
  { label: "Follow-up queue", path: "/follow-ups", icon: ClipboardCheck, count: 12 },
  { label: "Skill-gap board", path: "/skill-gaps", icon: Sparkles },
];

export default function SkillioShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#f6f8f7] text-slate-900">
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 flex w-[264px] flex-col border-r border-slate-200/80 bg-[#0d2928] text-white transition-transform duration-200 lg:translate-x-0",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
      )}>
        <div className="flex h-[86px] items-center justify-between border-b border-white/10 px-6">
          <Link href="/" onClick={() => setMobileOpen(false)} className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#b8e3d5] text-[#0d2928] shadow-[0_0_0_5px_rgba(184,227,213,0.09)]">
              <Activity className="h-5 w-5" strokeWidth={2.6} />
            </span>
            <span>
              <span className="block text-[17px] font-semibold tracking-[-0.03em]">Skillio</span>
              <span className="block text-[10px] uppercase tracking-[0.18em] text-[#8fb8ae]">Outcome intelligence</span>
            </span>
          </Link>
          <button onClick={() => setMobileOpen(false)} className="rounded-lg p-1 text-white/60 hover:bg-white/10 lg:hidden" aria-label="Close navigation">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-4 pt-7">
          <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#78a59c]">Workspace</p>
          <nav className="mt-3 space-y-1">
            {navigation.map((item) => {
              const Icon = item.icon;
              const active = item.path === "/" ? location === "/" : location.startsWith(item.path);
              return (
                <Link key={item.path} href={item.path} onClick={() => setMobileOpen(false)} className={cn(
                  "group flex items-center gap-3 rounded-xl px-3 py-3 text-[13px] transition-colors",
                  active ? "bg-[#b8e3d5] font-semibold text-[#0d2928]" : "text-white/65 hover:bg-white/8 hover:text-white",
                )}>
                  <Icon className={cn("h-[17px] w-[17px]", active ? "text-[#0d2928]" : "text-[#8fb8ae]")} />
                  <span className="flex-1">{item.label}</span>
                  {item.count ? <span className={cn("rounded-full px-2 py-0.5 text-[10px]", active ? "bg-[#0d2928]/10" : "bg-white/10 text-white/60")}>{item.count}</span> : null}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="mt-auto px-4 pb-5">
          <div className="mb-4 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-2 text-[#b8e3d5]"><ShieldCheck className="h-4 w-4" /><span className="text-xs font-semibold">Privacy mode active</span></div>
            <p className="mt-2 text-[11px] leading-5 text-white/55">Synthetic demo data. Consent and evidence freshness are visible on every record.</p>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-white/10 px-3 py-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#d7b97b] text-xs font-bold text-[#0d2928]">AD</div>
            <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">Aditi Deshmukh</p><p className="truncate text-[10px] text-white/50">State administrator</p></div>
            <ChevronDown className="h-4 w-4 text-white/40" />
          </div>
        </div>
      </aside>

      {mobileOpen ? <button className="fixed inset-0 z-40 bg-slate-900/35 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu" /> : null}

      <div className="lg:pl-[264px]">
        <header className="sticky top-0 z-30 flex h-[74px] items-center justify-between border-b border-slate-200/80 bg-[#f6f8f7]/90 px-5 backdrop-blur-md sm:px-8">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileOpen(true)} className="rounded-lg p-2 text-slate-500 hover:bg-white lg:hidden" aria-label="Open navigation"><Menu className="h-5 w-5" /></button>
            <div><p className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">Government of Maharashtra</p><p className="mt-0.5 text-sm font-semibold text-slate-800">Skills, Employment & Entrepreneurship</p></div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <span className="hidden rounded-full bg-[#e3f3ed] px-3 py-1.5 text-[11px] font-semibold text-[#247563] sm:inline-flex"><span className="mr-1.5 mt-0.5 h-1.5 w-1.5 rounded-full bg-[#43a890]" />Data updated 12 min ago</span>
            <Button variant="ghost" size="icon" className="rounded-xl text-slate-500"><Bell className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" className="rounded-xl text-slate-500"><LifeBuoy className="h-4 w-4" /></Button>
          </div>
        </header>
        <main className="min-h-[calc(100vh-74px)] px-5 py-7 sm:px-8 lg:px-10">{children}</main>
      </div>
    </div>
  );
}

export function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#278271]">{children}</p>;
}

export function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><SectionEyebrow>{eyebrow}</SectionEyebrow><h1 className="mt-2 max-w-3xl text-[28px] font-semibold tracking-[-0.045em] text-[#122f2d] sm:text-[34px]">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{description}</p></div>{action}</div>;
}

export function StatusPill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "teal" | "amber" | "rose" | "violet" | "neutral" }) {
  const classes = { teal: "bg-[#e1f4ed] text-[#247563]", amber: "bg-[#fbf0d9] text-[#a56e18]", rose: "bg-[#fce8e5] text-[#b65348]", violet: "bg-[#eee9fb] text-[#6d50ad]", neutral: "bg-slate-100 text-slate-500" };
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold", classes[tone])}>{children}</span>;
}

export function MaskedIconLabel({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 text-xs text-slate-500"><span className="h-1.5 w-1.5 rounded-full bg-[#6fb9a5]" />{children}</span>;
}

export { FileText };
