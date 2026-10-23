import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';

/**
 * Outbound Microsoft integration:
 *  - Teams: posts cards to a channel via an Incoming Webhook (TEAMS_WEBHOOK_URL)
 *  - Graph mail: sends email as GRAPH_SENDER_UPN via app-only client
 *    credentials (reuses the Entra app registration: ENTRA_TENANT_ID /
 *    ENTRA_CLIENT_ID / ENTRA_CLIENT_SECRET + Mail.Send application permission)
 * Both are optional; features check enablement and no-op otherwise.
 */
@Injectable()
export class OutboundService {
  private readonly logger = new Logger(OutboundService.name);
  private graphToken: { value: string; expiresAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  get teamsEnabled(): boolean {
    return Boolean(process.env.TEAMS_WEBHOOK_URL);
  }

  get graphMailEnabled(): boolean {
    return Boolean(
      process.env.ENTRA_TENANT_ID &&
        process.env.ENTRA_CLIENT_ID &&
        process.env.ENTRA_CLIENT_SECRET &&
        process.env.GRAPH_SENDER_UPN,
    );
  }

  // ------------------------------------------------------------------ Teams

  async postToTeams(title: string, text: string): Promise<boolean> {
    if (!this.teamsEnabled) return false;
    try {
      const response = await fetch(process.env.TEAMS_WEBHOOK_URL!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          '@type': 'MessageCard',
          '@context': 'http://schema.org/extensions',
          themeColor: '2563EB',
          summary: title,
          title,
          text,
        }),
      });
      if (!response.ok) {
        this.logger.warn(`Teams webhook returned ${response.status}`);
        return false;
      }
      return true;
    } catch (error) {
      this.logger.warn(`Teams webhook failed: ${String(error)}`);
      return false;
    }
  }

  /** Company announcements are mirrored to the Teams channel automatically. */
  @OnEvent('corporate.announcement.created')
  async onAnnouncement(payload: { title: string; content: string }) {
    await this.postToTeams(`📢 ${payload.title}`, payload.content);
  }

  // ------------------------------------------------------------- Graph mail

  private async getGraphToken(): Promise<string | null> {
    if (!this.graphMailEnabled) return null;
    if (this.graphToken && this.graphToken.expiresAt > Date.now() + 60_000) {
      return this.graphToken.value;
    }
    try {
      const response = await fetch(
        `https://login.microsoftonline.com/${process.env.ENTRA_TENANT_ID}/oauth2/v2.0/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: process.env.ENTRA_CLIENT_ID!,
            client_secret: process.env.ENTRA_CLIENT_SECRET!,
            grant_type: 'client_credentials',
            scope: 'https://graph.microsoft.com/.default',
          }),
        },
      );
      if (!response.ok) {
        this.logger.warn(`Graph token request failed: ${response.status}`);
        return null;
      }
      const data = (await response.json()) as {
        access_token: string;
        expires_in: number;
      };
      this.graphToken = {
        value: data.access_token,
        expiresAt: Date.now() + data.expires_in * 1000,
      };
      return data.access_token;
    } catch (error) {
      this.logger.warn(`Graph token request failed: ${String(error)}`);
      return null;
    }
  }

  async sendMail(to: string, subject: string, body: string): Promise<boolean> {
    const token = await this.getGraphToken();
    if (!token) return false;
    try {
      const response = await fetch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(process.env.GRAPH_SENDER_UPN!)}/sendMail`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              subject,
              body: { contentType: 'Text', content: body },
              toRecipients: [{ emailAddress: { address: to } }],
            },
            saveToSentItems: true,
          }),
        },
      );
      if (!response.ok && response.status !== 202) {
        this.logger.warn(`Graph sendMail failed: ${response.status}`);
        return false;
      }
      return true;
    } catch (error) {
      this.logger.warn(`Graph sendMail failed: ${String(error)}`);
      return false;
    }
  }
}
