import { z } from 'zod';

/**
 * Kiro configuration schema (IDC-only minimal version)
 */
export const KiroConfigSchema = z.object({
  default_region: z.string().describe('Default AWS region'),
  idc_start_url: z.string().url().describe('IDC start URL'),
  idc_region: z.string().describe('IDC region'),
  idc_profile_arn: z.string().optional().describe('Optional IDC profile ARN'),
});

export type KiroConfig = z.infer<typeof KiroConfigSchema>;

/**
 * Supported AWS regions
 */
export type KiroRegion = 'us-east-1' | 'us-west-2' | 'eu-central-1' | 'eu-west-1' | 'ap-southeast-1';

/**
 * IDC auth details stored in opencode's auth.json
 */
export interface KiroAuthDetails {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  idcRegion: string;
  expiresAt: number;
  access: string;
}

/**
 * Tool call structure
 */
export interface ToolCall {
  toolUseId: string;
  name: string;
  input: any;
}

/**
 * CodeWhisperer message structure (supports both user and assistant messages)
 */
export interface CodeWhispererMessage {
  userInputMessage?: {
    content: string;
    modelId: string;
    origin: string;
    images?: any[];
    userInputMessageContext?: {
      toolResults?: any[];
      tools?: any[];
    };
  };
  assistantResponseMessage?: {
    content: string;
    toolUses?: Array<{
      toolUseId: string;
      name: string;
      input: any;
    }>;
  };
}

export interface CodeWhispererRequest {
  conversationState: {
    chatTriggerType: string;
    conversationId: string;
    currentMessage: {
      userInputMessage: {
        content: string;
        modelId: string;
        origin: string;
        images?: any[];
        userInputMessageContext?: {
          toolResults?: any[];
          tools?: any[];
        };
      };
    };
    history?: CodeWhispererMessage[];
  };
  idcRegion?: string;
}

export interface CodeWhispererResponse {
  content: string;
  stopReason?: string;
}
