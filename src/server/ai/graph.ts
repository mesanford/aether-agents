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
  readWebsiteTool,
  generateImageTool,
  scheduleSocialPostTool,
  publishBlogPostTool,
  updateCrmTool,
  linkedinOutreachTool,
  createSequenceTool,
  getSequencesTool,
  deleteTaskTool,
  writeWorkspaceFileTool,
  getWorkspaceTasksTool,
  updateWorkspaceTaskTool,
  createGenericTaskTool,
  manageTaskStatusTool,
  manageCalendarTool,
  sendSlackMessageTool,
  listSlackChannelsTool,
  sendTeamsMessageTool,
  manageNotionTool,
  sendSmsTool,
  publishHubspotPostTool,
  syncHubspotLeadTool,
  listLocalLeadsTool,
  updateAgentScheduleTool
} from './tools';
import { agentRegistry, agentIds } from './agents';

// Initialize the LLMs
const llm = new ChatGoogleGenerativeAI({
  model: 'gemini-3-flash-preview',
  temperature: 0,
  apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
});

// A faster, cheaper model for utility tasks like history compaction
const liteLLM = new ChatGoogleGenerativeAI({
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

  let lastHumanIdx = -1;
  let lastAiIdx = -1;
  for (let i = 0; i < messages.length; i++) {
    const type = messages[i]?.getType?.();
    if (type === 'human') lastHumanIdx = i;
    if (type === 'ai' || type === 'tool') lastAiIdx = i;
  }

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
Current Date/Time: ${new Date().toLocaleString()}
Observe the client's goal and the responses from your team (${teamList}).
${state.episodicGist ? `Memory of previous conversation: ${state.episodicGist}` : ''}
CRITICAL RULES:
1. If the latest turn came from the USER, assign the most appropriate team member to reply by outputting their exact ID.
2. If the latest turn came from a TEAM MEMBER and there is no explicit unfinished handoff request, return "next_assignee": "END".
3. Do NOT call tools yourself.
Output exactly JSON format: { "next_assignee": "EXACT_ID_OR_END" }`;

  const conversationMessages = state.messages.filter(m => m?.getType?.() !== 'system');
  const lastMsg = conversationMessages[conversationMessages.length - 1];
  const isHuman = lastMsg?.getType() === 'human';

  const finalMessages = [
    new SystemMessage(systemPrompt),
    ...conversationMessages
  ];

  if (isHuman) {
    finalMessages.push(new HumanMessage(`Routing context: Current Task: ${state.task}. Determine whether to end or assign the next specialist.`));
  }

  const response = await llm.invoke(finalMessages);

  try {
    let rawContent = response.content as string;
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

const agentToolMapping: Record<string, any[]> = {
  'executive-assistant': [queryBrainTool, getWorkspaceTasksTool, draftEmailTool, readGoogleChatTool, searchWebTool, readWebsiteTool, createGenericTaskTool, manageTaskStatusTool, updateWorkspaceTaskTool, deleteTaskTool, manageCalendarTool, sendSlackMessageTool, listSlackChannelsTool, sendTeamsMessageTool, sendSmsTool, updateAgentScheduleTool],
  'sales-associate': [queryBrainTool, getWorkspaceTasksTool, updateCrmTool, linkedinOutreachTool, createSequenceTool, getSequencesTool, searchWebTool, readWebsiteTool, sendSlackMessageTool, listSlackChannelsTool, sendSmsTool, syncHubspotLeadTool, listLocalLeadsTool, updateAgentScheduleTool],
  'blog-writer': [queryBrainTool, getWorkspaceTasksTool, generateImageTool, publishBlogPostTool, searchWebTool, readWebsiteTool, manageTaskStatusTool, deleteTaskTool, sendSlackMessageTool, listSlackChannelsTool, manageNotionTool, publishHubspotPostTool, updateAgentScheduleTool],
  'social-media-manager': [queryBrainTool, getWorkspaceTasksTool, generateImageTool, scheduleSocialPostTool, searchWebTool, readWebsiteTool, manageTaskStatusTool, deleteTaskTool, sendSlackMessageTool, listSlackChannelsTool, updateAgentScheduleTool],
  'legal-associate': [queryBrainTool, getWorkspaceTasksTool, searchGoogleDriveTool, publishBlogPostTool, writeWorkspaceFileTool, searchWebTool, readWebsiteTool, sendSlackMessageTool, listSlackChannelsTool, manageNotionTool, publishHubspotPostTool, updateAgentScheduleTool],
  'receptionist': [queryBrainTool, getWorkspaceTasksTool, searchWebTool, readWebsiteTool, manageCalendarTool, sendSlackMessageTool, listSlackChannelsTool, sendSmsTool, listLocalLeadsTool, updateAgentScheduleTool],
  'team-chat': [queryBrainTool, getWorkspaceTasksTool, sendSlackMessageTool, listSlackChannelsTool, sendTeamsMessageTool, manageNotionTool, updateAgentScheduleTool]
};

function createAgentNode(agentConfig: typeof agentRegistry[0]) {
  const agentTools = agentToolMapping[agentConfig.id] || allTools;
  const agentLLM = llm.bindTools(agentTools);

  return async (state: AgentState): Promise<Partial<AgentState>> => {
    console.log(`[NODE: agent] specialist: ${agentConfig.name} (sender: ${agentConfig.id})`);
    const workspaceProfile = state.agentProfiles?.[agentConfig.id] || '';
    const prompt = `You are the ${agentConfig.name}. ${agentConfig.roleDescription}
Current Date/Time: ${new Date().toLocaleString()}
Client ID: ${state.clientId} Tenant: ${state.tenantId}.

Personality & Tone:
${agentConfig.personality}

${state.episodicGist ? `Memory of previous conversation: ${state.episodicGist}` : ''}

${workspaceProfile ? `Workspace-Specific Prompt Profile:\n${workspaceProfile}` : ''}

${state.dataAccessSection || ''}
${state.liveDataSection || ''}

Guidelines:
1. When the user's intent clearly maps to a tool action described in your role, use the tool IMMEDIATELY.
2. Any instruction in your role description containing "MUST use", "you MUST", or "MUST first use" is an absolute rule.
3. To perform any system action, use the relevant tools provided natively.
4. If the user provides a URL or asks you to "look at" a site, use 'read_website' immediately.
5. After using a tool or completing a task, briefly discuss 1-2 interesting findings and recommend a concrete next action.
6. Never output a draft as a chat message if a specific tool exists.
7. If a tool fails, report the error and ask for guidance.

CRITICAL GUARDRAIL:
- Any instruction in your role description containing "MUST use", "you MUST", or "MUST FIRST use" is an absolute rule.
- You MUST execute the full tool sequence exactly as described.
- You MUST capture IDs from one tool (like MEDIA_ASSET_ID) and pass them into the next tool.`;

    const conversationMessages = state.messages.filter(m => m?.getType?.() !== 'system');
    const response = await agentLLM.invoke([
      new SystemMessage(prompt),
      ...conversationMessages
    ]);

    const namedResponse = new AIMessage({
      content: response.content,
      name: agentConfig.id,
      tool_calls: response.tool_calls,
      additional_kwargs: {
        ...response.additional_kwargs,
        timestamp: Date.now()
      }
    });

    return {
      messages: [namedResponse],
      sender: agentConfig.id,
    };
  };
}

function router(state: AgentState): 'tool_node' | 'compaction_node' | 'approval_node' {
  const messages = state.messages;
  const lastMessage = messages[messages.length - 1] as AIMessage;
  
  if (lastMessage?.tool_calls?.length) {
    const isRisky = lastMessage.tool_calls.some(call => call.name === 'write_workspace_file');
    if (isRisky && !state.approvalRequired) return 'approval_node';
    return 'tool_node';
  }
  return 'compaction_node';
}

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

async function compactionNode(state: AgentState): Promise<Partial<AgentState>> {
  const msgs = state.messages;
  
  let consecutiveTools = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
     if (msgs[i].getType() === 'tool') consecutiveTools++;
     else break;
  }

  if (consecutiveTools >= 6) {
     return {
        messages: {
           type: 'REPLACE_MESSAGES',
           messages: [...msgs, new HumanMessage("SYSTEM GUARDRAIL: You are trapped in a tool exploration spiral. Conclude your thoughts and take definitive action immediately without using another tool.")]
        }
     } as any;
  }

  const totalChars = msgs.reduce((acc, m) => acc + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length), 0);
  const estimatedTokens = totalChars / 4;

  if (estimatedTokens > 60000 && msgs.length > 10) {
     let sliceIdx = msgs.length - 4;
     while (sliceIdx > 0) {
        if (msgs[sliceIdx].getType() === 'human') break;
        sliceIdx--;
     }
     if (sliceIdx <= 0) sliceIdx = Math.max(0, msgs.length - 4);

     const workingMemory = msgs.slice(sliceIdx);
     const oldMemory = msgs.slice(0, sliceIdx);
     
     const formattedOldMemory = oldMemory.map(m => {
        const type = m.getType();
        let content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        if (content.length > 10000) content = content.substring(0, 10000) + "... [TRUNCATED]";
        return `[${type}]: ${content}`;
     }).join('\n');

     const summaryPrompt = `Summarize:\nPrevious: ${state.episodicGist || 'None'}\nNew:\n${formattedOldMemory}`;

     try {
       const gistResponse = await liteLLM.invoke([new HumanMessage(summaryPrompt)]);
       return {
          episodicGist: gistResponse.content as string,
          messages: { type: 'REPLACE_MESSAGES', messages: workingMemory }
       } as any;
     } catch (err) {
       let fbIdx = Math.floor(msgs.length / 2);
       while (fbIdx > 0 && msgs[fbIdx]?.getType() === 'tool') fbIdx--;
       return { messages: { type: 'REPLACE_MESSAGES', messages: msgs.slice(fbIdx) } } as any;
     }
  }
  return {};
}

async function approvalNode(state: AgentState): Promise<Partial<AgentState>> {
  return { approvalRequired: true };
}

builder.addNode('approval_node', approvalNode);
builder.addNode('compaction_node', compactionNode);
builder.addNode('supervisor', supervisorNode);
agentRegistry.forEach(agent => {
  builder.addNode(agent.id as any, createAgentNode(agent));
});
builder.addNode('tool_node', toolNode);

builder.addConditionalEdges(START, (state: AgentState) => {
  const lastMsg = state.messages[state.messages.length - 1];
  if (lastMsg && typeof lastMsg.content === 'string' && lastMsg.content.includes('[Direct message to ')) {
      const match = lastMsg.content.match(/\[Direct message to ([^\]]+)\]/);
      if (match && match[1]) {
        const baseId = match[1].split(':')[0];
        if (agentIds.includes(baseId)) return baseId as any;
      }
  }
  return 'supervisor' as any;
});

const supervisorEdgeMap: Record<string, string> = { [END]: END };
agentIds.forEach(id => { supervisorEdgeMap[id] = id; });

builder.addConditionalEdges('supervisor' as any, 
  (state) => state.currentAssignee === 'END' ? END : state.currentAssignee, 
  supervisorEdgeMap as any
);

defaultSpecialists.forEach(specialist => {
  builder.addConditionalEdges(specialist as any, router as any, {
    tool_node: 'tool_node',
    compaction_node: 'compaction_node',
    approval_node: 'approval_node'
  } as any);
});

builder.addEdge('compaction_node' as any, 'supervisor' as any);
builder.addEdge('approval_node' as any, 'tool_node' as any);

const toolEdgeMap: Record<string, string> = {};
agentIds.forEach(id => { toolEdgeMap[id] = id; });
builder.addConditionalEdges('tool_node' as any, (state) => state.sender, toolEdgeMap as any);

export const checkpointer = new MemorySaver();
export const workflow = builder.compile({ 
  checkpointer,
  interruptBefore: ['approval_node' as any]
});