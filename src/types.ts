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
 * IDC auth details stored in opencode's auth.json
 */
export interface KiroAuthDetails {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  idcRegion: string;
  expiresAt: number;
}

/**
 * CodeWhisperer types
 */
export interface CodeWhispererMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CodeWhispererRequest {
  messages: CodeWhispererMessage[];
  maxTokens?: number;
}

export interface CodeWhispererResponse {
  content: string;
  stopReason?: string;
}
