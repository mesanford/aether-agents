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

export interface Task {
  id: string;
  title: string;
  description: string;
  assigneeId: string;
  status: 'todo' | 'running' | 'done' | 'failed';
  dueDate: string;
  repeat?: string;
}

export interface Workspace {
  id: number;
  name: string;
  role: 'owner' | 'admin' | 'member';
  created_at?: string;
}
