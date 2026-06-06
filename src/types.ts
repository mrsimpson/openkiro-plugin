export interface KiroAuthDetails {
  idcRegion: string;
  profileArn?: string;
  access?: string;
}

export interface ToolCall {
  toolUseId: string;
  name: string;
  input: any;
}

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
  profileArn?: string;
}

export interface CodeWhispererResponse {
  content: string;
  stopReason?: string;
}
