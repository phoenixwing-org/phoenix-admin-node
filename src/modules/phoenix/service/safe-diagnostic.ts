const SENSITIVE_QUERY =
  /([?&](?:access_?token|refresh_?token|token|password|verifyCode|captcha|code|state|ticket)=)[^&\s]*/gi;
const LOCAL_PATH = /(?:[A-Za-z]:\\|\/Users\/|\/home\/)[^\s'"\])]+/g;

export function safeStartupDiagnostic(error: unknown) {
  const raw =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === 'string'
      ? error
      : 'unknown startup error';
  return raw
    .replace(/(Bearer\s+)\S+/gi, '$1[redacted]')
    .replace(SENSITIVE_QUERY, '$1[redacted]')
    .replace(LOCAL_PATH, '[local-path]')
    .slice(0, 300);
}
