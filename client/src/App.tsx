import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { Suspense, lazy } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import SkillioShell from "./components/SkillioShell";

// Route-level code splitting keeps the dashboard bundle off the public flows.
const Login = lazy(() => import("./pages/Login"));
const CommandCentre = lazy(() => import("./pages/CommandCentre"));
const Cohorts = lazy(() => import("./pages/Cohorts"));
const TraineeJourney = lazy(() => import("./pages/TraineeJourney"));
const FollowUps = lazy(() => import("./pages/FollowUps"));
const MobileFollowUp = lazy(() => import("./pages/MobileFollowUp"));
const EmployerVerification = lazy(() => import("./pages/EmployerVerification"));
const SkillGaps = lazy(() => import("./pages/SkillGaps"));
const EmployeePortal = lazy(() => import("./pages/EmployeePortal"));
const CertificateView = lazy(() => import("./pages/CertificateView"));

function RouteFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-slate-400">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      <span className="text-xs font-medium">Loading…</span>
    </div>
  );
}

function Router() {
  return <Suspense fallback={<RouteFallback />}><Switch>
    <Route path="/login" component={Login} />
    <Route path="/me" component={EmployeePortal} />
    <Route path="/certificates" component={CertificateView} />
    <Route path="/follow-up/mobile" component={MobileFollowUp} />
    <Route path="/verify/employer" component={EmployerVerification} />
    <Route path="/" component={CommandCentre} />
    <Route path="/cohorts" component={Cohorts} />
    <Route path="/trainees/:id" component={TraineeJourney} />
    <Route path="/follow-ups" component={FollowUps} />
    <Route path="/skill-gaps" component={SkillGaps} />
    <Route path="/404" component={NotFound} />
    <Route component={NotFound} />
  </Switch></Suspense>;
}

function App() {
  const [location] = useLocation();
  const focusedFlow = location.startsWith("/login") || location.startsWith("/me") || location.startsWith("/certificates") || location.startsWith("/follow-up/mobile") || location.startsWith("/verify/employer");
  return <ErrorBoundary><ThemeProvider defaultTheme="light"><TooltipProvider><Toaster />{focusedFlow ? <Router /> : <SkillioShell><Router /></SkillioShell>}</TooltipProvider></ThemeProvider></ErrorBoundary>;
}

export default App;
