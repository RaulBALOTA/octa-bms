/**
 * pino redaction for request logs: credentials, cookies, CSRF tokens and any secret-shaped
 * field never reach stdout/APM. pino-http does not log request bodies.
 */
const SECRET_KEYS = ['password', 'currentPassword', 'newPassword', 'code', 'token', 'recoveryCodes', 'manualKey', 'qrSvg', 'csrfToken', 'secret'];

export const LOG_REDACTION = {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["x-csrf-token"]',
    'res.headers["set-cookie"]',
    ...SECRET_KEYS,
    ...SECRET_KEYS.map((key) => `*.${key}`),
  ],
  censor: '[redacted]',
};

/**
 * Request serializer: logs the path without its query string (OIDC `code`/`state`, any
 * token someone put in a URL) and never the parsed query object.
 */
export function serializeRequest(req: Record<string, unknown>) {
  const url = typeof req.url === 'string' ? req.url.split('?')[0] : req.url;
  const { query: _query, ...rest } = req;
  return { ...rest, url };
}
