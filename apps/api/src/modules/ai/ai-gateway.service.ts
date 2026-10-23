import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AuditService } from '../../core/audit/audit.service';

export interface AiRequest {
  feature: string; // "summarize" | "draft" | "extract-invoice" | "ask" — for audit
  system: string;
  user: string;
  maxTokens?: number;
  /** When set, the response is constrained to this JSON schema and parsed. */
  jsonSchema?: Record<string, unknown>;
  userId?: string;
  companyId?: string;
}

/**
 * Provider-agnostic AI gateway (docs/06). Default adapter: Claude API via the
 * official SDK. Every call is audited (action AI_CALL) with token usage.
 * Swapping providers means replacing this one service — features depend only
 * on complete().
 */
@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);
  private client: Anthropic | null = null;

  readonly model = process.env.AI_MODEL ?? 'claude-opus-4-8';

  constructor(private readonly audit: AuditService) {}

  get enabled(): boolean {
    return Boolean(
      process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN,
    );
  }

  private getClient(): Anthropic {
    if (!this.enabled) {
      throw new ServiceUnavailableException({
        code: 'AI_NOT_CONFIGURED',
        message:
          'AI is not configured — set ANTHROPIC_API_KEY in apps/api/.env and restart the API',
      });
    }
    // Zero-config constructor: resolves ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN
    this.client ??= new Anthropic();
    return this.client;
  }

  async complete<T = string>(request: AiRequest): Promise<T> {
    const client = this.getClient();
    try {
      const response = await client.messages.create({
        model: this.model,
        max_tokens: request.maxTokens ?? 4096,
        thinking: { type: 'adaptive' },
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
        ...(request.jsonSchema
          ? {
              output_config: {
                format: {
                  type: 'json_schema' as const,
                  schema: request.jsonSchema,
                },
              },
            }
          : {}),
      });

      await this.audit.log({
        userId: request.userId,
        companyId: request.companyId,
        entityType: 'ai',
        entityId: request.feature,
        action: 'AI_CALL',
        changes: {
          model: { old: null, new: this.model },
          inputTokens: { old: null, new: response.usage.input_tokens },
          outputTokens: { old: null, new: response.usage.output_tokens },
        },
      });

      if (response.stop_reason === 'refusal') {
        throw new UnprocessableEntityException({
          code: 'AI_REFUSED',
          message: 'The AI declined to answer this request',
        });
      }

      const text = response.content
        .filter(
          (block): block is Anthropic.TextBlock => block.type === 'text',
        )
        .map((block) => block.text)
        .join('');

      if (request.jsonSchema) {
        return JSON.parse(text) as T;
      }
      return text as T;
    } catch (error) {
      if (error instanceof UnprocessableEntityException) throw error;
      if (error instanceof Anthropic.AuthenticationError) {
        throw new ServiceUnavailableException({
          code: 'AI_AUTH_FAILED',
          message: 'AI provider rejected the API key — check ANTHROPIC_API_KEY',
        });
      }
      if (error instanceof Anthropic.RateLimitError) {
        throw new ServiceUnavailableException({
          code: 'AI_RATE_LIMITED',
          message: 'AI provider rate limit reached — try again shortly',
        });
      }
      if (error instanceof Anthropic.APIError) {
        this.logger.error(`AI call failed: ${error.status} ${error.message}`);
        throw new ServiceUnavailableException({
          code: 'AI_UPSTREAM_ERROR',
          message: 'AI provider error — try again shortly',
        });
      }
      this.logger.error(`AI call failed: ${String(error)}`);
      throw new ServiceUnavailableException({
        code: 'AI_UNAVAILABLE',
        message: 'AI provider unreachable',
      });
    }
  }
}
