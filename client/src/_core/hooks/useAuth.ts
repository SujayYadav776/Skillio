import { goToLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { onAuthStateChange, signOut } from "@/lib/supabase";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo } from "react";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath } = options ?? {};
  const utils = trpc.useUtils();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Re-fetch the profile whenever the Supabase session changes (sign-in,
  // token refresh, sign-out in another tab).
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    try {
      const { data } = onAuthStateChange(() => {
        void utils.auth.me.invalidate();
      });
      unsubscribe = () => data.subscription.unsubscribe();
    } catch {
      // Supabase not configured (e.g. demo mode) — no live session events.
    }
    return () => unsubscribe?.();
  }, [utils]);

  const logoutMutation = trpc.auth.logout.useMutation();

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch (error: unknown) {
      if (error instanceof TRPCClientError && error.data?.code === "UNAUTHORIZED") {
        // Already signed out server-side; nothing to do.
      } else {
        throw error;
      }
    } finally {
      try {
        await signOut();
      } catch {
        // Supabase not configured or already signed out.
      }
      utils.auth.me.setData(undefined, null);
      await utils.auth.me.invalidate();
      goToLogin();
    }
  }, [logoutMutation, utils]);

  const state = useMemo(() => {
    return {
      user: meQuery.data ?? null,
      loading: meQuery.isLoading || logoutMutation.isPending,
      error: meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(meQuery.data),
    };
  }, [
    meQuery.data,
    meQuery.error,
    meQuery.isLoading,
    logoutMutation.error,
    logoutMutation.isPending,
  ]);

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (meQuery.isLoading || logoutMutation.isPending) return;
    if (state.user) return;
    if (typeof window === "undefined") return;
    if (redirectPath && window.location.pathname === redirectPath) return;

    if (redirectPath) {
      window.location.href = redirectPath;
    } else {
      goToLogin();
    }
  }, [
    redirectOnUnauthenticated,
    redirectPath,
    logoutMutation.isPending,
    meQuery.isLoading,
    state.user,
  ]);

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    logout,
  };
}
