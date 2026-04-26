import { BaseMessage } from '@langchain/core/messages';
import { messagesStateReducer } from "@langchain/langgraph";

export interface AgentState {
  task: string;
  tenantId: string;
  clientId: string;
  // Use the native message reducer that automatically deduplicates by ID and appends
  messages: BaseMessage[];
  currentAssignee: string | 'END';
  approvalRequired: boolean;
  finalResponse: string | null;
  // Add a field to track the literal last sender, helpful for router edges
  sender: string;
  // Episodic Gist Summary to maintain continuity without token explosion
  episodicGist: string;
  // Dynamic root app context
  liveDataSection: string;
  dataAccessSection: string;
  // Workspace-configured prompt profile per agent id (personality/capabilities context)
  agentProfiles: Record<string, string>;
  // Custom display names from the DB (overrides the static agent registry names)
  agentNames: Record<string, string>;
  // Raw instruction text per agent id — injected as mandatory directives, NOT soft context
  agentInstructions: Record<string, string>;
  // Dynamic tool suggestions from the supervisor to reduce prompt size
  suggestedTools?: string[];
}

export function customMessagesReducer(left: BaseMessage[], right: BaseMessage[] | any): BaseMessage[] {
  if (!Array.isArray(right) && right?.type === 'REPLACE_MESSAGES') {
    return right.messages;
  }
  return messagesStateReducer(left, right);
}
