import { createServer } from 'node:http';
import { Writable } from 'node:stream';
import { pinoHttp } from 'pino-http';
import { describe, expect, it } from 'vitest';
import { LOG_REDACTION, serializeRequest } from './log-redaction';

describe('#24 request log redaction', () => {
  it('never writes cookies, CSRF tokens or Set-Cookie values to the log stream', async () => {
    let output = '';
    const stream = new Writable({ write(chunk, _enc, cb) { output += chunk.toString(); cb(); } });
    const logger = pinoHttp({ redact: LOG_REDACTION, serializers: { req: serializeRequest } }, stream);
    const server = createServer((req, res) => {
      logger(req, res);
      res.setHeader('Set-Cookie', '__Host-bms_session=SESSIONSECRETVALUE; HttpOnly; Secure');
      req.log.info({ password: 'hunter2hunter2', code: '123456', recoveryCodes: ['ABCDE-FGHJK'], nested: { manualKey: 'JBSW Y3DP' } }, 'diag');
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as { port: number };
    await fetch(`http://127.0.0.1:${port}/api/v1/auth/oidc/callback?code=OIDCCODESECRET&state=STATESECRET`, {
      headers: { Cookie: '__Host-bms_session=SESSIONSECRETVALUE; __Host-bms_preauth=PREAUTHSECRET', 'X-CSRF-Token': 'CSRFSECRET', Authorization: 'Bearer JWTSECRET' },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    server.close();
    expect(output).toContain('request completed');
    expect(output).toContain('/api/v1/auth/oidc/callback');
    for (const secret of ['OIDCCODESECRET', 'STATESECRET', 'SESSIONSECRETVALUE', 'PREAUTHSECRET', 'CSRFSECRET', 'JWTSECRET', 'hunter2hunter2', '123456', 'ABCDE-FGHJK', 'JBSW Y3DP']) {
      expect(output).not.toContain(secret);
    }
  });
});
