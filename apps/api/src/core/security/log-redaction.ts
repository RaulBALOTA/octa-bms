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
