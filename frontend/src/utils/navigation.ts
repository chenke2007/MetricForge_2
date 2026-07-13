/**
 * Navigate to an external (non-React Router) URL.
 * Wrapped in a function so it can be mocked in tests.
 */
export function navigateToExternal(url: string) {
  window.location.assign(url)
}
