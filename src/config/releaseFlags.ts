// Keep unfinished features out of the release UI at render time instead of
// relying on CSS selectors that can silently break when labels change.
// Temporarily hidden until real-device call reliability work resumes.
// Keep the implementation in place so it can be re-enabled with one switch.
export const CALLING_ENABLED = false;
