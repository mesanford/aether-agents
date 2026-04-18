import { config } from 'dotenv';
config({ path: '.env.local', override: true });

import { END, START, StateGraph, MemorySaver } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { AgentState, customMessagesReducer } from './state';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { 
  allTools,
  queryBrainTool,
  searchGoogleDriveTool,
  draftEmailTool,
  readGoogleChatTool,
  searchWebTool,
  generateImageTool,
  scheduleSocialPostTool,
  publishBlogPostTool,
  updateCrmTool,
  linkedinOutreachTool,
  deleteTaskTool,
  writeWorkspaceFileTool,
  getWorkspaceTasksTool,
  updateWorkspaceTaskTool,
  createGenericTaskTool,
  manageTaskStatusTool
} from './tools';
import { agentRegistry, agentIds } from './agents';

// Initialize the LLM
const llm = new ChatGoogleGenerativeAI({
  model: 'gemini-3.1-flash-lite-preview',
  temperature: 0,
  apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
});

const defaultSpecialists = agentIds;

// 1. Setup Universal Tool Node
const toolNode = new ToolNode<AgentState>(allTools);

// --- Nodes ---

async function supervisorNode(state: AgentState): Promise<Partial<AgentState>> {
  console.log(`[NODE: supervisor] lastAction: ${state.sender}`);
  const messages = state.messages;

  // Determine if there is an unanswered human message by scanning all messages.
  // This is more robust than checking only the last message type, which can be
  // unreliable when messages are deserialized from the SQLite checkpoint.
  let lastHumanIdx = -1;
  let lastAiIdx = -1;
  for (let i = 0; i < messages.length; i++) {
    const type = messages[i]?.getType?.();
    if (type === 'human') lastHumanIdx = i;
    if (type === 'ai' || type === 'tool') lastAiIdx = i;
  }

  // If the last AI/tool response came after the last human message (or there is no
  // human message at all), this conversation turn is complete — stop here.
  if (lastHumanIdx === -1 || lastAiIdx > lastHumanIdx) {
    console.log('[SUPERVISOR TARGET] END');
    return { currentAssignee: 'END', sender: 'supervisor' };
  }

  const lastHumanMessage = [...messages].reverse().find(m => m?.getType?.() === 'human')?.content as string;
  if (lastHumanMessage) {
    const dmMatch = lastHumanMessage.match(/^\[Direct message to ([^\]]+)\]/);
    if (dmMatch && dmMatch[1]) {
       const baseId = dmMatch[1].split(':')[0];
       if (agentIds.includes(baseId)) {
         return { currentAssignee: baseId, sender: 'supervisor' };
       }
    }
  }

  const teamList = agentRegistry.map(a => `${a.name} (id: ${a.id})`).join(', ');
  const systemPrompt = `You are the Agency Supervisor.
Observe the client's goal and the responses from your team (${teamList}).
CRITICAL RULES:
1. If the latest turn came from the USER, assign the most appropriate team member to reply by outputting their exact ID.
2. If the latest turn came from a TEAM MEMBER and there is no explicit unfinished handoff request, return "next_assignee": "END".
3. Do NOT call tools yourself.
Output exactly JSON format: { "next_assignee": "EXACT_ID_OR_END" }`;

  // Filter out any SystemMessages from state — Gemini requires the system message
  // to be the first (and only) message of that role in the array.
  const conversationMessages = state.messages.filter(m => m?.getType?.() !== 'system');

  const response = await llm.invoke([
    new SystemMessage(systemPrompt),
    ...conversationMessages,
    new HumanMessage(`Routing context: Current Task: ${state.task}. Determine whether to end or assign the next specialist.`)
  ]);

  try {
    let rawContent = response.content as string;
    
    // Auto-clean any markdown formatting from the response
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) rawContent = jsonMatch[0];

    const payload = JSON.parse(rawContent);
    let nextAssignee = payload.next_assignee;
    
    if (nextAssignee !== 'END' && !agentIds.includes(nextAssignee)) {
      nextAssignee = 'executive-assistant';
    }
    console.log('[SUPERVISOR TARGET]', nextAssignee);
    return { currentAssignee: nextAssignee, sender: 'supervisor' };
  } catch (err) {
    console.log('[SUPERVISOR TARGET] parse fallback -> executive-assistant', err);
    return { currentAssignee: 'executive-assistant', sender: 'supervisor' };
  }
}

// Factory to create Tool-Calling Specialist Nodes
const agentToolMapping: Record<string, any[]> = {
  'executive-assistant': [queryBrainTool, getWorkspaceTasksTool, draftEmailTool, readGoogleChatTool, searchWebTool, createGenericTaskTool, manageTaskStatusTool, updateWorkspaceTaskTool, deleteTaskTool],
  'sales-associate': [queryBrainTool, getWorkspaceTasksTool, updateCrmTool, linkedinOutreachTool, searchWebTool],
  'blog-writer': [queryBrainTool, getWorkspaceTasksTool, generateImageTool, publishBlogPostTool, searchWebTool, manageTaskStatusTool, deleteTaskTool],
  'social-media-manager': [queryBrainTool, getWorkspaceTasksTool, generateImageTool, scheduleSocialPostTool, searchWebTool, manageTaskStatusTool, deleteTaskTool],
  'legal-associate': [queryBrainTool, getWorkspaceTasksTool, searchGoogleDriveTool, publishBlogPostTool, writeWorkspaceFileTool, searchWebTool],
  'receptionist': [queryBrainTool, getWorkspaceTasksTool, searchWebTool],
  'team-chat': [queryBrainTool, getWorkspaceTasksTool]
};

function createAgentNode(agentConfig: typeof agentRegistry[0]) {
  const agentTools = agentToolMapping[agentConfig.id] || allTools;
  const agentLLM = llm.bindTools(agentTools);

  return async (state: AgentState): Promise<Partial<AgentState>> => {
    console.log(`[NODE: agent] specialist: ${agentConfig.name} (sender: ${agentConfig.id})`);
    const workspaceProfile = state.agentProfiles?.[agentConfig.id] || '';
    const prompt = `You are the ${agentConfig.name}. ${agentConfig.roleDescription}
Client ID: ${state.clientId} Tenant: ${state.tenantId}.

Personality & Tone:
${agentConfig.personality}

${workspaceProfile ? `Workspace-Specific Prompt Profile:\n${workspaceProfile}` : ''}

${state.dataAccessSection || ''}
${state.liveDataSection || ''}

Guidelines:
1. You have the freedom to converse naturally with the user. If you need clarification before using a tool, or just want to greet them or update them, respond directly in character.
2. To perform any system action, use the relevant tools provided natively. Never output a draft as a conversational chat message — always use the appropriate tool so content saves to the client's UI.`;

    const conversationMessages = state.messages.filter(m => m?.getType?.() !== 'system');
    const response = await agentLLM.invoke([
      new SystemMessage(prompt),
      ...conversationMessages
    ]);

    // We MUST clone the AIMessage providing 'name' in its instantiation kwargs, 
    // otherwise the Sqlite Checkpointer serialization will drop the randomly mutated field!
    const namedResponse = new AIMessage({
      content: response.content,
      name: agentConfig.id,
      tool_calls: response.tool_calls,
      additional_kwargs: response.additional_kwargs
    });

    return {
      messages: [namedResponse],
      sender: agentConfig.id,
    };
  };
}

// --- Graph Routing Logic ---

// Router after any Specialist acts: Is it a Tool Call or finished?
function router(state: AgentState): 'tool_node' | 'compaction_node' | 'approval_node' {
  const messages = state.messages;
  const lastMessage = messages[messages.length - 1] as AIMessage;
  
  if (lastMessage?.tool_calls?.length) {
    const isRisky = lastMessage.tool_calls.some(call => {
      return call.name === 'write_workspace_file';
    });

    if (isRisky && !state.approvalRequired) {
      return 'approval_node';
    }
    return 'tool_node';
  }
  return 'compaction_node';
}

// --- Graph Construction ---

const builder = new StateGraph<AgentState>({
  channels: {
    task: { value: (x, y) => y ?? x, default: () => '' },
    tenantId: { value: (x, y) => y ?? x, default: () => '' },
    clientId: { value: (x, y) => y ?? x, default: () => '' },
    messages: { value: customMessagesReducer, default: () => [] },
    currentAssignee: { value: (x, y) => y ?? x, default: () => 'supervisor' },
    approvalRequired: { value: (x, y) => y ?? x, default: () => false },
    finalResponse: { value: (x, y) => y ?? x, default: () => null },
    sender: { value: (x, y) => y ?? x, default: () => 'user' },
    episodicGist: { value: (x, y) => y ?? x, default: () => '' },
    liveDataSection: { value: (x, y) => y ?? x, default: () => '' },
    dataAccessSection: { value: (x, y) => y ?? x, default: () => '' },
    agentProfiles: { value: (x, y) => y ?? x, default: () => ({}) },
  }
});

// --- Compaction Stage ---

async function compactionNode(state: AgentState): Promise<Partial<AgentState>> {
  const msgs = state.messages;
  
  // 1. Event Detector: Exploration Spiral (consecutive tools with no AIMessage breakdown)
  let consecutiveTools = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
     if (msgs[i].getType() === 'tool') consecutiveTools++;
     else break;
  }

  console.log(`[COMPACTION] consecutiveTools=${consecutiveTools} | totalMessages=${msgs.length}`);
  if (consecutiveTools >= 6) {
    console.warn(`[COMPACTION] GUARDRAIL TRIGGERED | consecutiveTools=${consecutiveTools}`);
     return {
        messages: {
           type: 'REPLACE_MESSAGES',
           messages: [...msgs, new HumanMessage("SYSTEM GUARDRAIL: You are trapped in a tool exploration spiral. Conclude your thoughts and take definitive action immediately without using another tool.")]
        }
     } as any; // Type override for our custom Array reduction trick
  }

  // 2. Full LLM Compaction: Squashing Working Memory into Episodic Memory when history bloats
  // Token Estimation: 1 token ~= 4 characters. Trigger compaction if over 6000 estimated tokens.
  const totalChars = msgs.reduce((acc, m) => acc + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length), 0);
  const estimatedTokens = totalChars / 4;

  if (estimatedTokens > 6000 && msgs.length > 4) {
     const workingMemory = msgs.slice(-4);
     const oldMemory = msgs.slice(0, -4);
     
     const summaryPrompt = `Summarize the following agent conversation into a highly concise strategic gist. 
Preserve core identifiers (Paths, API keys, Campaign IDs).
Previous Gist to merge: ${state.episodicGist}

New events to merge:
${oldMemory.map(m => `[${m.getType()}]: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n')}`;

     const gistResponse = await llm.invoke([new HumanMessage(summaryPrompt)]);

     return {
        episodicGist: gistResponse.content as string,
        messages: { type: 'REPLACE_MESSAGES', messages: workingMemory }
     } as any;
  }

  return {};
}

// Intercepts and flags approval requirement. Because interruptBefore triggers before this starts,
// When the Server resumes the thread, this resets the gate and lets tool_node proceed normally
async function approvalNode(state: AgentState): Promise<Partial<AgentState>> {
  return { approvalRequired: true };
}

// Build Nodes
builder.addNode('approval_node', approvalNode);
builder.addNode('compaction_node', compactionNode);
builder.addNode('supervisor', supervisorNode);
agentRegistry.forEach(agent => {
  builder.addNode(agent.id as any, createAgentNode(agent));
});
builder.addNode('tool_node', toolNode);

// Add primary edge for starting
builder.addConditionalEdges(START, (state: AgentState) => {
  // If the message is a direct [Direct message to agentId], route directly to that agent to save tokens
  const lastMsg = state.messages[state.messages.length - 1];
  if (lastMsg && typeof lastMsg.content === 'string' && lastMsg.content.includes('[Direct message to ')) {
      const match = lastMsg.content.match(/\[Direct message to ([^\]]+)\]/);
      if (match && match[1]) {
        const baseId = match[1].split(':')[0];
        if (agentIds.includes(baseId)) {
          return baseId as any;
        }
      }
  }
  return 'supervisor' as any;
});

// The Supervisor dynamically dispatches
const supervisorEdgeMap: Record<string, string> = { [END]: END };
agentIds.forEach(id => { supervisorEdgeMap[id] = id; });

builder.addConditionalEdges('supervisor' as any, 
  (state) => state.currentAssignee === 'END' ? END : state.currentAssignee, 
  supervisorEdgeMap as any
);

// All specialists conditionally route to Tools or to the Compactor
defaultSpecialists.forEach(specialist => {
  builder.addConditionalEdges(specialist as any, router as any, {
    tool_node: 'tool_node',
    compaction_node: 'compaction_node',
    approval_node: 'approval_node'
  } as any);
});

// The Compactor is guaranteed to drop the clean message payload directly to the Supervisor
builder.addEdge('compaction_node' as any, 'supervisor' as any);

// The Approval Node blindly hands the baton over to the Tool Node once the human unpauses
builder.addEdge('approval_node' as any, 'tool_node' as any);

// Tool Node strictly routes BACK to the last sender who requested the tool
const toolEdgeMap: Record<string, string> = {};
agentIds.forEach(id => { toolEdgeMap[id] = id; });

builder.addConditionalEdges('tool_node' as any, 
  (state) => state.sender, 
  toolEdgeMap as any
);

// Compile Graph
// Global memory checkpointer tracks thread_id persistently
export const checkpointer = new MemorySaver();
export const workflow = builder.compile({ 
  checkpointer,
  interruptBefore: ['approval_node' as any]
});
