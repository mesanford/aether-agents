import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { AgentPersonality } from './types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type BuildAgentPromptContextInput = {
  description?: string | null;
  capabilities?: string[] | null;
  instructions?: string | null;
  personality?: Partial<AgentPersonality> | null;
};

export const DEFAULT_AGENT_PERSONALITY: AgentPersonality = {
  tone: 'direct',
  communicationStyle: 'balanced',
  assertiveness: 'medium',
  humor: 'none',
  verbosity: 'medium',
  signaturePhrase: '',
  doNots: [],
};

export function normalizeAgentPersonality(personality?: Partial<AgentPersonality> | null): AgentPersonality {
  const tone = personality?.tone;
  const communicationStyle = personality?.communicationStyle;
  const assertiveness = personality?.assertiveness;
  const humor = personality?.humor;
  const verbosity = personality?.verbosity;

  return {
    tone: tone === 'warm' || tone === 'direct' || tone === 'analytical' || tone === 'playful' || tone === 'formal'
      ? tone
      : DEFAULT_AGENT_PERSONALITY.tone,
    communicationStyle: communicationStyle === 'concise' || communicationStyle === 'balanced' || communicationStyle === 'detailed'
      ? communicationStyle
      : DEFAULT_AGENT_PERSONALITY.communicationStyle,
    assertiveness: assertiveness === 'low' || assertiveness === 'medium' || assertiveness === 'high'
      ? assertiveness
      : DEFAULT_AGENT_PERSONALITY.assertiveness,
    humor: humor === 'none' || humor === 'light' ? humor : DEFAULT_AGENT_PERSONALITY.humor,
    verbosity: verbosity === 'short' || verbosity === 'medium' || verbosity === 'long'
      ? verbosity
      : DEFAULT_AGENT_PERSONALITY.verbosity,
    signaturePhrase: typeof personality?.signaturePhrase === 'string' ? personality.signaturePhrase.trim() : '',
    doNots: Array.isArray(personality?.doNots)
      ? personality.doNots
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0)
        .slice(0, 5)
      : [],
  };
}

export function buildAgentPersonalityContext(personality?: Partial<AgentPersonality> | null): string {
  const normalized = normalizeAgentPersonality(personality);
  const lines = [
    'Personality:',
    `- Tone: ${normalized.tone}`,
    `- Style: ${normalized.communicationStyle}`,
    `- Assertiveness: ${normalized.assertiveness}`,
    `- Humor: ${normalized.humor}`,
    `- Verbosity: ${normalized.verbosity}`,
  ];

  if (normalized.signaturePhrase) {
    lines.push(`- Signature: ${normalized.signaturePhrase}`);
  }

  if (normalized.doNots.length > 0) {
    lines.push(`- Avoid: ${normalized.doNots.join('; ')}`);
  }

  return lines.join('\n');
}

export function buildAgentPromptContext({
  description,
  capabilities,
  instructions,
  personality,
}: BuildAgentPromptContextInput) {
  const normalizedDescription = typeof description === 'string' ? description : '';
  const normalizedCapabilities = Array.isArray(capabilities) ? capabilities.filter((item) => typeof item === 'string' && item.trim().length > 0) : [];
  
  const capabilityLine = normalizedCapabilities.length > 0
    ? `Capabilities: ${normalizedCapabilities.join(', ')}`
    : 'Capabilities: none configured';

  const guidelineBlock = instructions?.trim()
    ? `Instructions:\n${instructions.trim()}`
    : 'Instructions: none configured';

  const personalityBlock = buildAgentPersonalityContext(personality);

  return `${normalizedDescription}\n\n${personalityBlock}\n\n${capabilityLine}\n\n${guidelineBlock}`.trim();
}
