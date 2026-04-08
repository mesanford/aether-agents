export enum AgentRole {
  EXECUTIVE_ASSISTANT = 'Executive Assistant',
  SOCIAL_MEDIA_MANAGER = 'Social Media Manager',
  BLOG_WRITER = 'Blog Writer',
  SALES_ASSOCIATE = 'Sales Associate',
  LEGAL_ASSOCIATE = 'Legal Associate',
  RECEPTIONIST = 'Receptionist',
  TEAM_CHAT = 'Team Chat'
}

export enum AgentStatus {
  IDLE = 'Idle',
  THINKING = 'Thinking',
  WORKING = 'Working',
  COLLABORATING = 'Collaborating',
  OFFLINE = 'Offline'
}

export interface GuidelineItem {
  id: string;
  content: string;
  isMarkdown?: boolean;
}

export interface GuidelineSection {
  id: string;
  title: string;
  items: GuidelineItem[];
  showInput?: boolean;
}

export type AgentPersonalityTone = 'warm' | 'direct' | 'analytical' | 'playful' | 'formal';
export type AgentPersonalityStyle = 'concise' | 'balanced' | 'detailed';
export type AgentPersonalityAssertiveness = 'low' | 'medium' | 'high';
export type AgentPersonalityHumor = 'none' | 'light';
export type AgentPersonalityVerbosity = 'short' | 'medium' | 'long';

export interface AgentPersonality {
  tone: AgentPersonalityTone;
  communicationStyle: AgentPersonalityStyle;
  assertiveness: AgentPersonalityAssertiveness;
  humor: AgentPersonalityHumor;
  verbosity: AgentPersonalityVerbosity;
  signaturePhrase: string;
  doNots: string[];
}

export interface Agent {
  id: string;
  name: string;
  role: AgentRole;
  status: AgentStatus;
  description: string;
  avatar: string;
  capabilities: string[];
  lastAction?: string;
  guidelines: GuidelineSection[];
  personality?: AgentPersonality;
}

export interface Message {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  content: string;
  imageUrl?: string;
  timestamp: number;
  type: 'user' | 'agent' | 'system';
}

export interface Lead {
  id: number;
  name: string;
  role?: string;
  company?: string;
  location?: string;
  email?: string;
  status?: string;
  sequence?: string;
  linkedin_url?: string;
  avatar?: string;
  notes?: string | null;
}

export interface TaskArtifact {
  type: 'brief' | 'plan' | 'review' | 'notes';
  title: string;
  body: string;
  bullets: string[];
  imageUrl?: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  assigneeId: string;
  status: 'todo' | 'running' | 'done' | 'failed';
  dueDate: string;
  repeat?: string;
  executionType?: 'generic' | 'research' | 'draft' | 'outreach' | 'review';
  outputSummary?: string | null;
  lastError?: string | null;
  lastRunAt?: number | null;
  startedAt?: number | null;
  completedAt?: number | null;
  selectedMediaAssetId?: number | null;
  artifactType?: TaskArtifact['type'] | null;
  artifact?: TaskArtifact | null;
}

export interface Workspace {
  id: number;
  name: string;
  logo?: string;
  description?: string;
  target_audience?: string;
  role: 'owner' | 'admin' | 'member';
  created_at?: string;
  is_onboarded?: boolean;
}
