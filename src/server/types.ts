import express from "express";

export type AuthenticatedRequest = express.Request & {
  userId?: number;
  workspaceId?: number;
  workspaceRole?: string;
};

export type LiveContext = {
  emails?: Array<{ from: string; subject: string; date: string; snippet: string }>;
  events?: Array<{ summary: string; start: string; end: string; location?: string; attendees?: string[] }>;
  files?: Array<{ name: string; type: string; modifiedTime: string; webViewLink: string }>;
  analyticsRows?: Array<{ date: string; sessions: number; users: number; pageViews: number }>;
  searchConsoleRows?: Array<{ query: string; clicks: number; impressions: number; ctr: number; position: number }>;
};

export type ConnectedServices = {
  gmail?: boolean;
  calendar?: boolean;
  drive?: boolean;
  slack?: boolean;
  teams?: boolean;
  notion?: boolean;
  linkedin?: boolean;
  buffer?: boolean;
  twilio?: boolean;
  wordpress?: boolean;
  hubspot?: boolean;
  analytics?: boolean;
  searchConsole?: boolean;
};
