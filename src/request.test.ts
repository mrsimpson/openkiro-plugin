import { describe, it, expect } from "vitest";
import { transformToSdkRequest } from "./request.js";

describe("request", () => {
  describe("profileArn handling", () => {
    it("should include profileArn when auth has one", () => {
      const auth = {
        refreshToken: "rt",
        clientId: "cid",
        clientSecret: "csec",
        idcRegion: "us-east-1",
        expiresAt: Date.now() + 3600000,
        profileArn: "arn:aws:codewhisperer:us-east-1:123456789012:profile/ABCDEF",
      };

      const result = transformToSdkRequest(
        JSON.stringify({
          messages: [{ role: "user", content: "test" }],
          model: "claude-sonnet-4-5",
        }),
        "claude-sonnet-4-5",
        auth as any,
      );

      expect(result.profileArn).toBe("arn:aws:codewhisperer:us-east-1:123456789012:profile/ABCDEF");
    });

    it("should derive region from profileArn when available", () => {
      const auth = {
        refreshToken: "rt",
        clientId: "cid",
        clientSecret: "csec",
        idcRegion: "us-east-1",
        expiresAt: Date.now() + 3600000,
        profileArn: "arn:aws:codewhisperer:eu-central-1:123456789012:profile/ABCDEF",
      };

      const result = transformToSdkRequest(
        JSON.stringify({
          messages: [{ role: "user", content: "test" }],
          model: "claude-sonnet-4-5",
        }),
        "claude-sonnet-4-5",
        auth as any,
      );

      expect(result.region).toBe("eu-central-1");
    });
  });

  describe("thinking mode detection", () => {
    it("should enable thinking for models ending in -thinking", () => {
      const auth = {
        refreshToken: "rt",
        clientId: "cid",
        clientSecret: "csec",
        idcRegion: "us-east-1",
        expiresAt: Date.now() + 3600000,
      };

      const result = transformToSdkRequest(
        JSON.stringify({
          messages: [{ role: "user", content: "think about this" }],
          model: "claude-sonnet-4-5-thinking",
        }),
        "claude-sonnet-4-5-thinking",
        auth,
      );

      const history = result.conversationState.history || [];
      const firstMsg = history[0];
      const systemContent = firstMsg?.userInputMessage?.content || "";

      expect(systemContent).toContain("<thinking_mode>enabled</thinking_mode>");
    });

    it("should enable thinking when think=true with custom budget", () => {
      const auth = {
        refreshToken: "rt",
        clientId: "cid",
        clientSecret: "csec",
        idcRegion: "us-east-1",
        expiresAt: Date.now() + 3600000,
      };

      const result = transformToSdkRequest(
        JSON.stringify({
          messages: [{ role: "user", content: "think about this" }],
          model: "claude-sonnet-4-5",
        }),
        "claude-sonnet-4-5",
        auth,
        true,
        50000,
      );

      const history = result.conversationState.history || [];
      const firstMsg = history[0];
      const systemContent = firstMsg?.userInputMessage?.content || "";

      expect(systemContent).toContain("<thinking_mode>enabled</thinking_mode>");
      expect(systemContent).toContain("<max_thinking_length>50000</max_thinking_length>");
    });
  });

  describe("model resolution", () => {
    it("should resolve model aliases via MODEL_MAPPING", () => {
      const auth = {
        refreshToken: "rt",
        clientId: "cid",
        clientSecret: "csec",
        idcRegion: "us-east-1",
        expiresAt: Date.now() + 3600000,
      };

      const result = transformToSdkRequest(
        JSON.stringify({
          messages: [{ role: "user", content: "hi" }],
          model: "auto",
        }),
        "auto",
        auth,
      );

      expect(result.effectiveModel).toBe("auto");
    });

    it("should reject unsupported model names", () => {
      const auth = {
        refreshToken: "rt",
        clientId: "cid",
        clientSecret: "csec",
        idcRegion: "us-east-1",
        expiresAt: Date.now() + 3600000,
      };

      expect(() =>
        transformToSdkRequest(
          JSON.stringify({
            messages: [{ role: "user", content: "hi" }],
            model: "gpt-4-nonexistent",
          }),
          "gpt-4-nonexistent",
          auth,
        ),
      ).toThrow();
    });
  });
});
