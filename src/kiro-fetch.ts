import { refreshAccessToken, KiroTokenRefreshError } from "./token.js";
import { transformToSdkRequest } from "./request.js";
import { createSdkClient } from "./sdk-client.js";
import { GenerateAssistantResponseCommand } from "@aws/codewhisperer-streaming-client";
import { transformSdkStream } from "./streaming/sdk-stream-transformer.js";
import { extractRegionFromArn } from "./constants.js";
import type { KiroAuthDetails } from "./types.js";
import { readKiroCliAuth, type KiroCliAuth } from "./kiro-cli-db.js";

const REFRESH_MARGIN_MS = 120_000;
const KIRO_URL_RE = /q\..*\.amazonaws\.com/;

export function resolveApiRegion(cliAuth: KiroCliAuth, regionOverride?: string): string {
  return regionOverride || extractRegionFromArn(cliAuth.profileArn) || cliAuth.region || "us-east-1";
}

export interface KiroFetchOptions {
  regionOverride?: string;
  /** Token already obtained by the caller (e.g. V1 auth loader). */
  initialToken?: { accessToken: string; expiresAt: number };
  /** Used for requests that are not addressed to the Kiro API. */
  fallbackFetch?: typeof fetch;
}

/**
 * Returns a fetch implementation that translates OpenAI-compatible chat requests
 * into Kiro SDK calls and streams the result back as OpenAI SSE.
 *
 * Token state lives in the closure, so a refreshed token is reused across
 * requests until it expires. Auth is re-read from the Kiro CLI DB on every
 * request to pick up rotations done by the CLI itself.
 */
export function createKiroFetch(options: KiroFetchOptions = {}): typeof fetch {
  const fallbackFetch = options.fallbackFetch ?? globalThis.fetch;
  let accessToken = options.initialToken?.accessToken;
  let expiresAt = options.initialToken?.expiresAt ?? 0;
  let lastDbToken: string | undefined;

  return async (resource, init) => {
    const url =
      typeof resource === "string" ? resource : resource instanceof URL ? resource.href : resource.url;
    if (!KIRO_URL_RE.test(url)) {
      return fallbackFetch(resource, init);
    }

    // Re-read from DB on each request to pick up token rotations from Kiro CLI
    const cliAuth = readKiroCliAuth();
    if (!cliAuth) {
      throw new KiroTokenRefreshError(
        'Kiro CLI is not authenticated. Run "kiro login" first.',
        "NOT_AUTHENTICATED",
      );
    }
    // Only adopt the DB token when the CLI rotated it; otherwise keep our refreshed one.
    if (cliAuth.accessToken !== lastDbToken) {
      lastDbToken = cliAuth.accessToken;
      if (cliAuth.expiresAt > expiresAt || !accessToken) {
        accessToken = cliAuth.accessToken;
        expiresAt = cliAuth.expiresAt;
      }
    }

    if (Date.now() >= expiresAt - REFRESH_MARGIN_MS) {
      try {
        const refreshed = await refreshAccessToken(
          cliAuth.refreshToken,
          cliAuth.clientId,
          cliAuth.clientSecret,
          cliAuth.region,
        );
        accessToken = refreshed.accessToken;
        expiresAt = refreshed.expiresAt;
      } catch (e) {
        throw new KiroTokenRefreshError(
          `Token refresh failed: ${e instanceof Error ? e.message : "Unknown error"}`,
          "REFRESH_FAILED",
        );
      }
    }

    const body = init?.body
      ? typeof init.body === "string"
        ? JSON.parse(init.body)
        : init.body
      : {};
    const model = body.model || "claude-sonnet-4-6";

    // V1 passes thinking config via providerOptions, V2 variants merge it into the body.
    const thinkingConfig = body.providerOptions?.thinkingConfig ?? body.thinkingConfig;
    const think = !!thinkingConfig;
    const budget = thinkingConfig?.thinkingBudget || 20000;

    const sdkRequest = transformToSdkRequest(
      body,
      model,
      {
        idcRegion: cliAuth.region,
        profileArn: cliAuth.profileArn,
      } as KiroAuthDetails,
      think,
      budget,
    );

    const effectiveRegion = sdkRequest.region || resolveApiRegion(cliAuth, options.regionOverride);
    const sdkClient = createSdkClient({ access: accessToken } as KiroAuthDetails, effectiveRegion);

    const maxAttempts = 3;
    let lastError: any = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const command = new GenerateAssistantResponseCommand({
          conversationState: sdkRequest.conversationState,
          profileArn: sdkRequest.profileArn,
        });
        const sdkResponse = await sdkClient.send(command, { abortSignal: init?.signal ?? undefined });
        const stream = transformSdkStream(sdkResponse, model, sdkRequest.conversationId);

        const encoder = new TextEncoder();
        const readable = new ReadableStream({
          async start(controller) {
            try {
              for await (const chunk of stream) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
              }
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            } catch (e) {
              controller.error(e);
            }
          },
        });

        return new Response(readable, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      } catch (e: any) {
        lastError = e;
        const status = e?.statusCode || e?.$metadata?.httpStatusCode || 0;
        const isRetryable = status === 429 || (status >= 500 && status < 600);

        if (!isRetryable || attempt >= maxAttempts) throw e;

        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  };
}
