import { liteLLM, liteLLMFallback } from './models';
import { HumanMessage } from '@langchain/core/messages';

export interface SOPPlan {
  agentId: string;
  action: string;
  priority: 'high' | 'medium' | 'low';
}

const COMMON_SOPS: Record<string, SOPPlan[]> = {
  'schedule meeting': [
    { agentId: 'executive-assistant', action: 'Check availability on calendar', priority: 'high' },
    { agentId: 'executive-assistant', action: 'Draft calendar invitation', priority: 'medium' }
  ],
  'blog post': [
    { agentId: 'blog-writer', action: 'Research topic and keywords', priority: 'high' },
    { agentId: 'blog-writer', action: 'Draft first version of article', priority: 'medium' },
    { agentId: 'blog-writer', action: 'Generate cover image', priority: 'low' }
  ],
  'sales outreach': [
    { agentId: 'sales-associate', action: 'Research lead in CRM', priority: 'high' },
    { agentId: 'sales-associate', action: 'Draft personalized outreach email', priority: 'medium' }
  ],
  'social media': [
    { agentId: 'social-media-manager', action: 'Draft social media post', priority: 'high' },
    { agentId: 'social-media-manager', action: 'Generate high-quality graphic', priority: 'medium' },
    { agentId: 'social-media-manager', action: 'Schedule post for optimal time', priority: 'low' }
  ]
};

/**
 * Rapidly classifies a task and returns a pre-defined SOP plan if a match is found.
 * Uses a single fast Lite LLM call for semantic matching.
 */
export async function getSemanticPlan(taskDescription: string): Promise<SOPPlan[] | null> {
  const taskLower = taskDescription.toLowerCase();
  
  // 1. Quick Keyword check for exact/near matches
  for (const [key, plan] of Object.entries(COMMON_SOPS)) {
    if (taskLower.includes(key)) return plan;
  }

  // 2. Semantic check with Lite model for more nuanced matches
  const prompt = `Classify this task into one of the following categories or "NONE":
Categories: ${Object.keys(COMMON_SOPS).join(', ')}
Task: "${taskDescription}"
Output only the category name or "NONE":`;

  try {
    const response = await liteLLM.withFallbacks([liteLLMFallback]).invoke([new HumanMessage(prompt)]);
    const category = (response.content as string).trim().toLowerCase();
    
    if (COMMON_SOPS[category]) {
      return COMMON_SOPS[category];
    }
  } catch (err) {
    console.error("Semantic routing error:", err);
  }

  return null;
}
