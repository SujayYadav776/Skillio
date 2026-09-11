export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Navigate to the app's login screen. Call from an event handler or effect,
// never during render.
export const goToLogin = () => {
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `/login?next=${next}`;
};
