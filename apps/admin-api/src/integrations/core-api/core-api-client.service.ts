import { HttpService } from '@nestjs/axios';
import {
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { AppConfig } from '../../config/configuration';
import { CORRELATION_ID_HEADER } from '../../common/constants';

interface CoreApiErrorBody {
  error?: { code?: string; message?: string; details?: unknown };
}

/**
 * The one place admin-api is allowed to trigger a business-state mutation
 * — by asking core-api's own domain logic to do it, never by writing to
 * core-api's tables directly. See the critical architecture rule in
 * docs/admin-api/overview.md and
 * docs/decisions/0010-internal-service-authentication.md for the shared-
 * secret transport auth this relies on.
 *
 * core-api's error envelope (`{ error: { code, message, ... } }`) is
 * reshaped into the `{ message, code }` HttpException body shape
 * AllExceptionsFilter already knows how to render — so a core-api
 * `driver_not_found` 404 surfaces to admin-web as admin-api's own
 * `driver_not_found` 404, not a generic wrapper error.
 */
@Injectable()
export class CoreApiClientService {
  private readonly logger = new Logger(CoreApiClientService.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly internalToken: string;

  constructor(
    private readonly http: HttpService,
    config: ConfigService<AppConfig, true>,
  ) {
    const coreApi = config.get('coreApi', { infer: true });
    this.baseUrl = coreApi.baseUrl;
    this.timeoutMs = coreApi.timeoutMs;
    this.internalToken = coreApi.internalToken;
  }

  async patch<T>(
    path: string,
    body: Record<string, unknown>,
    correlationId?: string,
  ): Promise<T> {
    const url = new URL(path, this.baseUrl).toString();

    try {
      const response = await firstValueFrom(
        this.http.patch<T>(url, body, {
          timeout: this.timeoutMs,
          headers: this.headers(correlationId),
        }),
      );
      return response.data;
    } catch (error) {
      throw this.toAdminApiException(error, url);
    }
  }

  /** Reads (dashboard/drivers/rides/trips/payments/admin accounts) go
   * through the same shared-secret internal/v1 boundary as commands — see
   * ADR 0010's own note that internal/v1 is "service-to-service, no end
   * user," not specifically "mutations only." Every query module
   * (drivers.service.ts etc.) calls this directly and synchronously —
   * admin-api keeps no local read model of its own; admin traffic is
   * low-volume enough that a plain request/response round trip per list
   * page is simpler and more honest than eventual consistency through a
   * Kafka-projected copy only this one caller ever read (see
   * docs/admin-api/query-apis.md). `undefined` params are dropped rather
   * than serialized as the literal string "undefined". */
  async get<T>(
    path: string,
    params?: Record<string, string | number | undefined>,
    correlationId?: string,
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    try {
      const response = await firstValueFrom(
        this.http.get<T>(url.toString(), {
          timeout: this.timeoutMs,
          headers: this.headers(correlationId),
        }),
      );
      return response.data;
    } catch (error) {
      throw this.toAdminApiException(error, url.toString());
    }
  }

  private headers(correlationId?: string): Record<string, string> {
    return {
      'X-Internal-Service-Token': this.internalToken,
      ...(correlationId ? { [CORRELATION_ID_HEADER]: correlationId } : {}),
    };
  }

  private toAdminApiException(error: unknown, url: string): Error {
    if (!(error instanceof AxiosError)) {
      return error instanceof Error ? error : new Error('Unknown error');
    }

    if (!error.response) {
      // Network error, connection refused, or timeout — core-api itself
      // never ran the request, so there's nothing to pass through.
      this.logger.error(`core-api unreachable: ${error.message} (${url})`);
      return new ServiceUnavailableException({
        code: 'core_api_unavailable',
        message: 'core-api is unreachable.',
      });
    }

    const status = error.response.status;
    const body = error.response.data as CoreApiErrorBody | undefined;

    if (body?.error?.message) {
      return new HttpException(
        {
          message: body.error.message,
          code: body.error.code ?? 'core_api_error',
          ...(body.error.details !== undefined
            ? { details: body.error.details }
            : {}),
        },
        status,
      );
    }

    return new HttpException(
      {
        message: 'core-api returned an unexpected error.',
        code: 'core_api_error',
      },
      status >= 400 && status < 600 ? status : 502,
    );
  }
}
