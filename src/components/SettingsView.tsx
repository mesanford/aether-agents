import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  User,
  Lock,
  LogOut,
  Globe,
  Linkedin,
  MessageSquare,
  Layout,
  Building2,
  CheckCircle2,
  Plus,
  UserPlus,
  Loader,
  Unplug,
  RefreshCw,
  Phone
} from 'lucide-react';
import { cn } from '../utils';
import { apiFetch } from '../services/apiClient';
import { toast } from 'react-hot-toast';

interface SettingsViewProps {
  user: any;
  token: string | null;
  activeWorkspaceId: number | null;
  onLogout: () => void;
  onConnectedServicesChange: React.Dispatch<React.SetStateAction<any>>;
  onUserUpdate?: (user: any) => void;
  defaultTab?: 'account' | 'integrations';
  activeWorkspaceRole?: string;
  onWorkspaceUpdate: (workspace: any) => void;
}

interface GoogleStatus {
  connected: boolean;
  gmail: boolean;
  calendar: boolean;
  drive: boolean;
}

interface WordPressStatus {
  connected: boolean;
  siteUrl: string | null;
}

interface HubSpotStatus {
  connected: boolean;
  portalId: number | null;
  accountName: string | null;
}

interface LinkedInStatus {
  connected: boolean;
  authorUrn: string | null;
  accountName: string | null;
}

interface SlackStatus {
  connected: boolean;
  defaultChannel: string | null;
  teamId: string | null;
  teamName: string | null;
  botUserId: string | null;
  updatedAt: string | null;
}

interface TeamsStatus {
  connected: boolean;
  defaultChannelName: string | null;
  updatedAt: string | null;
}

interface NotionStatus {
  connected: boolean;
  botName: string | null;
  defaultParentPageId: string | null;
  updatedAt: string | null;
}

interface TwilioStatus {
  connected: boolean;
  accountSid: string | null;
  fromNumber: string | null;
  updatedAt: string | null;
}

interface WebhookSecretProvider {
  provider: 'hubspot' | 'wordpress' | 'linkedin';
  configured: boolean;
  lastRotatedAt: string | null;
  secretPreview: string | null;
}

interface AutomationSettings {
  linkedinMode: 'off' | 'publish';
  teamsMode: 'off' | 'send';
  notionMode: 'off' | 'create';
  notionParentPageId: string | null;
  requireArtifactImage: boolean;
  approvalModeLinkedin: 'auto' | 'approval';
}

interface IntegrationHealthFailure {
  id: number;
  action: string;
  taskId: string | null;
  channel: string | null;
  error: string | null;
  createdAt: string | null;
}

interface IntegrationHealth {
  services: Record<string, { connected: boolean; lastSuccessAt: string | null; lastFailureAt: string | null; failedCount24h: number }>;
  providerTelemetry: Record<string, { rateLimited24h: number; authErrors24h: number; lastError: string | null }>;
  queue: {
    queued: number;
    running: number;
    retrying: number;
    deadLettered: number;
    deduped24h: number;
  };
  automation: any;
}

const PREBUILT_AVATARS = [
  "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=marcus&backgroundColor=f5f5f4",
  "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=sarah&backgroundColor=b6e3f4",
  "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=alex&backgroundColor=c0aede",
  "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=jessica&backgroundColor=ffdfbf",
  "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=david&backgroundColor=d1f4d1",
];

export const SettingsView: React.FC<SettingsViewProps> = ({
  user,
  token,
  activeWorkspaceId,
  onLogout,
  onConnectedServicesChange,
  onUserUpdate,
  defaultTab = 'integrations',
  activeWorkspaceRole,
  onWorkspaceUpdate
}) => {
  const [activeTab, setActiveTab] = useState<'integrations' | 'account'>(defaultTab);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showDeleteWorkspaceModal, setShowDeleteWorkspaceModal] = useState(false);
  const [isDeletingWorkspace, setIsDeletingWorkspace] = useState(false);
  const [passwordData, setPasswordData] = useState({ current: '', new: '', confirm: '' });
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar || `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${user?.name || 'marcus'}&backgroundColor=f5f5f4`);
  const [isUpdatingAvatar, setIsUpdatingAvatar] = useState(false);

  useEffect(() => {
    if (user?.avatar) {
      setAvatarUrl(user.avatar);
    }
  }, [user?.avatar]);

  const handleAvatarSelect = async (url: string) => {
    setAvatarUrl(url);
    setIsUpdatingAvatar(true);
    try {
      const { user: updatedUser } = await apiFetch(`/api/auth/me`, {
        method: "PATCH",
        token: token || undefined,
        body: JSON.stringify({ avatar: url })
      });
      if (onUserUpdate && updatedUser) onUserUpdate(updatedUser);
    } catch (err) {
      toast.error("Failed to save avatar");
    } finally {
      setIsUpdatingAvatar(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64Url = event.target?.result as string;
      await handleAvatarSelect(base64Url);
    };
    reader.readAsDataURL(file);
  };

  const [googleStatus, setGoogleStatus] = useState<GoogleStatus>({ connected: false, gmail: false, calendar: false, drive: false });
  const [wordpressStatus, setWordpressStatus] = useState<WordPressStatus>({ connected: false, siteUrl: null });
  const [hubspotStatus, setHubspotStatus] = useState<HubSpotStatus>({ connected: false, portalId: null, accountName: null });
  const [linkedinStatus, setLinkedinStatus] = useState<LinkedInStatus>({ connected: false, authorUrn: null, accountName: null });
  const [slackStatus, setSlackStatus] = useState<SlackStatus>({ connected: false, defaultChannel: null, teamId: null, teamName: null, botUserId: null, updatedAt: null });
  const [teamsStatus, setTeamsStatus] = useState<TeamsStatus>({ connected: false, defaultChannelName: null, updatedAt: null });
  const [notionStatus, setNotionStatus] = useState<NotionStatus>({ connected: false, botName: null, defaultParentPageId: null, updatedAt: null });
  const [twilioStatus, setTwilioStatus] = useState<TwilioStatus>({ connected: false, accountSid: null, fromNumber: null, updatedAt: null });
  const [webhookSecrets, setWebhookSecrets] = useState<WebhookSecretProvider[]>([]);
  const [knowledgeDriveStatus, setKnowledgeDriveStatus] = useState<any>({ connected: false, folderId: null });
  const [googleConnecting, setGoogleConnecting] = useState(false);
  const [googleDisconnecting, setGoogleDisconnecting] = useState(false);
  const [knowledgeConnecting, setKnowledgeConnecting] = useState(false);
  const [knowledgeDisconnecting, setKnowledgeDisconnecting] = useState(false);
  const [isWordPressModalOpen, setIsWordPressModalOpen] = useState(false);
  const [wordpressSaving, setWordpressSaving] = useState(false);
  const [wordpressDisconnecting, setWordpressDisconnecting] = useState(false);
  const [wordpressForm, setWordpressForm] = useState({ siteUrl: '', username: '', appPassword: '' });
  const [linkedinSaving, setLinkedinSaving] = useState(false);
  const [linkedinDisconnecting, setLinkedinDisconnecting] = useState(false);
  const [isSlackModalOpen, setIsSlackModalOpen] = useState(false);
  const [isTeamsModalOpen, setIsTeamsModalOpen] = useState(false);
  const [isNotionModalOpen, setIsNotionModalOpen] = useState(false);
  const [slackSaving, setSlackSaving] = useState(false);
  const [teamsSaving, setTeamsSaving] = useState(false);
  const [notionSaving, setNotionSaving] = useState(false);
  const [slackDisconnecting, setSlackDisconnecting] = useState(false);
  const [teamsDisconnecting, setTeamsDisconnecting] = useState(false);
  const [notionDisconnecting, setNotionDisconnecting] = useState(false);
  const [slackForm, setSlackForm] = useState({ botToken: '', defaultChannel: '' });
  const [teamsForm, setTeamsForm] = useState({ webhookUrl: '', defaultChannelName: '' });
  const [notionForm, setNotionForm] = useState({ integrationToken: '', defaultParentPageId: '' });
  const [isHubSpotModalOpen, setIsHubSpotModalOpen] = useState(false);
  const [isTwilioModalOpen, setIsTwilioModalOpen] = useState(false);
  const [hubspotSaving, setHubspotSaving] = useState(false);
  const [hubspotDisconnecting, setHubspotDisconnecting] = useState(false);
  const [hubspotToken, setHubspotToken] = useState('');
  const [twilioSaving, setTwilioSaving] = useState(false);
  const [twilioDisconnecting, setTwilioDisconnecting] = useState(false);
  const [twilioForm, setTwilioForm] = useState({ accountSid: '', authToken: '', fromNumber: '' });

  const [isGeneratingInvite, setIsGeneratingInvite] = useState<string | null>(null);

  const handleGenerateInvite = async (platform: string) => {
    if (!token || !activeWorkspaceId) return;
    setIsGeneratingInvite(platform);
    try {
      const { url } = await apiFetch<{ url: string }>(`/api/workspaces/${activeWorkspaceId}/integrations/${platform}/invite`, {
        method: 'GET',
        token,
        onAuthFailure: () => onLogout(),
      });

      await navigator.clipboard.writeText(url);
      toast.success(`${platform.charAt(0).toUpperCase() + platform.slice(1)} invite link copied to clipboard! Send this to your client.`);
    } catch (err: any) {
      console.error(`Failed to generate ${platform} invite:`, err);
      toast.error(err.message || `Failed to generate ${platform} invite.`);
    } finally {
      setIsGeneratingInvite(null);
    }
  };

  const [automationSettings, setAutomationSettings] = useState<AutomationSettings>({
    linkedinMode: 'off',
    teamsMode: 'off',
    notionMode: 'off',
    notionParentPageId: null,
    requireArtifactImage: false,
    approvalModeLinkedin: 'auto',
  });
  const [savingAutomationSettings, setSavingAutomationSettings] = useState(false);
  const [integrationsHealth, setIntegrationsHealth] = useState<IntegrationHealth | null>(null);

  const fetchStatus = async () => {
    if (!token) return;
    try {
      const data = await apiFetch<GoogleStatus>('/api/integrations/google/status', {
        token,
        onAuthFailure: () => onLogout(),
      });
      setGoogleStatus(data);

      if (activeWorkspaceId) {
        const kd = await apiFetch<any>(`/api/workspaces/${activeWorkspaceId}/integrations/google/status`, {
          token,
          onAuthFailure: () => onLogout(),
        }).catch(() => ({ connected: false, folderId: null }));
        setKnowledgeDriveStatus(kd);

        const health = await apiFetch<IntegrationHealth>(`/api/workspaces/${activeWorkspaceId}/integrations/health`, {
          token,
          onAuthFailure: () => onLogout(),
        }).catch(() => null);

        const linkedin = await apiFetch<LinkedInStatus>(`/api/workspaces/${activeWorkspaceId}/integrations/linkedin/status`, {
          token,
          onAuthFailure: () => onLogout(),
        }).catch(() => ({ connected: false, authorUrn: null, accountName: null }));
        
        const slack = await apiFetch<SlackStatus>(`/api/workspaces/${activeWorkspaceId}/integrations/slack/status`, {
          token,
          onAuthFailure: () => onLogout(),
        }).catch(() => ({ connected: false, defaultChannel: null, teamId: null, teamName: null, botUserId: null, updatedAt: null }));
        
        const teams = await apiFetch<TeamsStatus>(`/api/workspaces/${activeWorkspaceId}/integrations/teams/status`, {
          token,
          onAuthFailure: () => onLogout(),
        }).catch(() => ({ connected: false, defaultChannelName: null, updatedAt: null }));
        
        const notion = await apiFetch<NotionStatus>(`/api/workspaces/${activeWorkspaceId}/integrations/notion/status`, {
          token,
          onAuthFailure: () => onLogout(),
        }).catch(() => ({ connected: false, botName: null, defaultParentPageId: null, updatedAt: null }));
        
        const twilio = await apiFetch<TwilioStatus>(`/api/workspaces/${activeWorkspaceId}/integrations/twilio/status`, {
          token,
          onAuthFailure: () => onLogout(),
        }).catch(() => ({ connected: false, accountSid: null, fromNumber: null, updatedAt: null }));
        
        const webhookSecretResponse = await apiFetch<{ providers: WebhookSecretProvider[] }>(`/api/workspaces/${activeWorkspaceId}/integrations/webhooks/secrets`, {
          token,
          onAuthFailure: () => onLogout(),
        }).catch(() => ({ providers: [] }));
        
        const wordpress = await apiFetch<WordPressStatus>(`/api/workspaces/${activeWorkspaceId}/integrations/wordpress/status`, {
          token,
          onAuthFailure: () => onLogout(),
        });
        
        const hubspot = await apiFetch<HubSpotStatus>(`/api/workspaces/${activeWorkspaceId}/integrations/hubspot/status`, {
          token,
          onAuthFailure: () => onLogout(),
        });
        
        const automation = await apiFetch<AutomationSettings>(`/api/workspaces/${activeWorkspaceId}/automation-settings`, {
          token,
          onAuthFailure: () => onLogout(),
        }).catch(() => ({ linkedinMode: 'off', teamsMode: 'off', notionMode: 'off', notionParentPageId: null, requireArtifactImage: false }));

        setLinkedinStatus(linkedin);
        setSlackStatus(slack);
        setTeamsStatus(teams);
        setNotionStatus(notion);
        setTwilioStatus(twilio);
        setWebhookSecrets(Array.isArray(webhookSecretResponse.providers) ? webhookSecretResponse.providers : []);
        setIntegrationsHealth(health);
        setWordpressStatus(wordpress);
        setHubspotStatus(hubspot);
        setAutomationSettings({
          linkedinMode: automation.linkedinMode === 'publish' ? 'publish' : 'off',
          teamsMode: automation.teamsMode === 'send' ? 'send' : 'off',
          notionMode: automation.notionMode === 'create' ? 'create' : 'off',
          notionParentPageId: automation.notionParentPageId || null,
          requireArtifactImage: Boolean(automation.requireArtifactImage),
          approvalModeLinkedin: (automation as any).approvalModeLinkedin === 'approval' ? 'approval' : 'auto',
        });
        onConnectedServicesChange((current: any) => ({
          ...current,
          gmail: data.gmail,
          calendar: data.calendar,
          drive: data.drive,
          slack: slack.connected,
          teams: teams.connected,
          notion: notion.connected,
          linkedin: linkedin.connected,
          twilio: twilio.connected,
          wordpress: wordpress.connected,
          hubspot: hubspot.connected,
        }));
      }
    } catch {
      // ignore
    }
  };

  const handleSaveAutomationSettings = async () => {
    if (!token || !activeWorkspaceId) return;
    setSavingAutomationSettings(true);
    try {
      const result = await apiFetch<AutomationSettings>(`/api/workspaces/${activeWorkspaceId}/automation-settings`, {
        method: 'PUT',
        token,
        onAuthFailure: () => onLogout(),
        body: JSON.stringify(automationSettings),
      });
      setAutomationSettings(result);
    } catch (err) {
      console.error('Failed to save automation settings:', err);
      toast.error('Failed to save automation settings.');
    } finally {
      setSavingAutomationSettings(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, [token, activeWorkspaceId]);

  const handleConnectGoogle = async () => {
    if (!token) return;
    setGoogleConnecting(true);
    try {
      const { url } = await apiFetch<{ url: string }>('/api/integrations/google/connect', {
        token,
        onAuthFailure: () => onLogout(),
      });
      window.location.href = url;
    } catch (err) {
      console.error('Failed to start Google connect:', err);
      setGoogleConnecting(false);
    }
  };

  const handleDisconnectGoogle = async () => {
    if (!token) return;
    setGoogleDisconnecting(true);
    try {
      await apiFetch('/api/integrations/google', {
        method: 'DELETE',
        token,
        onAuthFailure: () => onLogout(),
      });
      setGoogleStatus({ connected: false, gmail: false, calendar: false, drive: false });
    } catch {
      // ignore
    } finally {
      setGoogleDisconnecting(false);
    }
  };

  const handleConnectLinkedIn = async () => {
    if (!token || !activeWorkspaceId) return;
    setLinkedinSaving(true);
    try {
      const { url } = await apiFetch<{ url: string }>(`/api/workspaces/${activeWorkspaceId}/integrations/linkedin/connect`, {
        method: 'GET',
        token,
        onAuthFailure: () => onLogout(),
      });

      const popup = window.open(url, 'linkedin-workspace-auth', 'width=500,height=650,scrollbars=yes');
      if (!popup) {
        toast.error('Your browser blocked the authentication popup. Please allow popups for this site and try again.');
        setLinkedinSaving(false);
        return;
      }

      const handleMessage = (event: MessageEvent) => {
        if (event.data?.provider !== 'linkedin') return;
        if (event.data?.type === 'WORKSPACE_AUTH_SUCCESS') {
          window.removeEventListener('message', handleMessage);
          popup?.close();
          fetchStatus();
          setLinkedinSaving(false);
        }
      };
      window.addEventListener('message', handleMessage);
    } catch (err) {
      console.error('Failed to connect LinkedIn:', err);
      setLinkedinSaving(false);
    }
  };

  const handleDisconnectLinkedIn = async () => {
    if (!token || !activeWorkspaceId) return;
    setLinkedinDisconnecting(true);
    try {
      await apiFetch(`/api/workspaces/${activeWorkspaceId}/integrations/linkedin`, {
        method: 'DELETE',
        token,
        onAuthFailure: () => onLogout(),
      });
      setLinkedinStatus({ connected: false, authorUrn: null, accountName: null });
      onConnectedServicesChange((current: any) => ({ ...current, linkedin: false }));
    } catch {
      // ignore
    } finally {
      setLinkedinDisconnecting(false);
    }
  };

  const handleConnectSlack = async () => {
    if (!token || !activeWorkspaceId) return;
    setSlackSaving(true);
    try {
      const result = await apiFetch<SlackStatus>(`/api/workspaces/${activeWorkspaceId}/integrations/slack`, {
        method: 'POST',
        token,
        onAuthFailure: () => onLogout(),
        body: JSON.stringify(slackForm),
      });
      setSlackStatus(result);
      onConnectedServicesChange((current: any) => ({ ...current, slack: result.connected }));
      setIsSlackModalOpen(false);
    } catch (err) {
      console.error('Failed to connect Slack:', err);
      toast.error('Failed to connect Slack.');
    } finally {
      setSlackSaving(false);
    }
  };

  const handleDisconnectSlack = async () => {
    if (!token || !activeWorkspaceId) return;
    setSlackDisconnecting(true);
    try {
      await apiFetch(`/api/workspaces/${activeWorkspaceId}/integrations/slack`, {
        method: 'DELETE',
        token,
        onAuthFailure: () => onLogout(),
      });
      setSlackStatus({ connected: false, defaultChannel: null, teamId: null, teamName: null, botUserId: null, updatedAt: null });
      onConnectedServicesChange((current: any) => ({ ...current, slack: false }));
    } catch {
      // ignore
    } finally {
      setSlackDisconnecting(false);
    }
  };

  const handleConnectTeams = async () => {
    if (!token || !activeWorkspaceId) return;
    setTeamsSaving(true);
    try {
      const result = await apiFetch<TeamsStatus>(`/api/workspaces/${activeWorkspaceId}/integrations/teams`, {
        method: 'POST',
        token,
        onAuthFailure: () => onLogout(),
        body: JSON.stringify(teamsForm),
      });
      setTeamsStatus(result);
      onConnectedServicesChange((current: any) => ({ ...current, teams: result.connected }));
      setIsTeamsModalOpen(false);
    } catch (err) {
      console.error('Failed to connect Teams:', err);
      toast.error('Failed to connect Teams.');
    } finally {
      setTeamsSaving(false);
    }
  };

  const handleDisconnectTeams = async () => {
    if (!token || !activeWorkspaceId) return;
    setTeamsDisconnecting(true);
    try {
      await apiFetch(`/api/workspaces/${activeWorkspaceId}/integrations/teams`, {
        method: 'DELETE',
        token,
        onAuthFailure: () => onLogout(),
      });
      setTeamsStatus({ connected: false, defaultChannelName: null, updatedAt: null });
      onConnectedServicesChange((current: any) => ({ ...current, teams: false }));
    } catch {
      // ignore
    } finally {
      setTeamsDisconnecting(false);
    }
  };

  const handleConnectNotion = async () => {
    if (!token || !activeWorkspaceId) return;
    setNotionSaving(true);
    try {
      const result = await apiFetch<NotionStatus>(`/api/workspaces/${activeWorkspaceId}/integrations/notion`, {
        method: 'POST',
        token,
        onAuthFailure: () => onLogout(),
        body: JSON.stringify(notionForm),
      });
      setNotionStatus(result);
      onConnectedServicesChange((current: any) => ({ ...current, notion: result.connected }));
      setIsNotionModalOpen(false);
    } catch (err) {
      console.error('Failed to connect Notion:', err);
      toast.error('Failed to connect Notion.');
    } finally {
      setNotionSaving(false);
    }
  };

  const handleDisconnectNotion = async () => {
    if (!token || !activeWorkspaceId) return;
    setNotionDisconnecting(true);
    try {
      await apiFetch(`/api/workspaces/${activeWorkspaceId}/integrations/notion`, {
        method: 'DELETE',
        token,
        onAuthFailure: () => onLogout(),
      });
      setNotionStatus({ connected: false, botName: null, defaultParentPageId: null, updatedAt: null });
      onConnectedServicesChange((current: any) => ({ ...current, notion: false }));
    } catch {
      // ignore
    } finally {
      setNotionDisconnecting(false);
    }
  };

  const handleDisconnectWordPress = async () => {
    if (!token || !activeWorkspaceId) return;
    setWordpressDisconnecting(true);
    try {
      await apiFetch(`/api/workspaces/${activeWorkspaceId}/integrations/wordpress`, {
        method: 'DELETE',
        token,
        onAuthFailure: () => onLogout(),
      });
      setWordpressStatus({ connected: false, siteUrl: null });
      onConnectedServicesChange((current: any) => ({ ...current, wordpress: false }));
    } catch {
      // ignore
    } finally {
      setWordpressDisconnecting(false);
    }
  };

  const handleConnectHubSpot = async () => {
    if (!token || !activeWorkspaceId) return;
    setHubspotSaving(true);
    try {
      const result = await apiFetch<HubSpotStatus>(`/api/workspaces/${activeWorkspaceId}/integrations/hubspot`, {
        method: 'POST',
        token,
        onAuthFailure: () => onLogout(),
        body: JSON.stringify({ accessToken: hubspotToken }),
      });
      setHubspotStatus(result);
      onConnectedServicesChange((current: any) => ({ ...current, hubspot: result.connected }));
      setIsHubSpotModalOpen(false);
    } catch (err) {
      console.error('Failed to connect HubSpot:', err);
      toast.error('Failed to connect HubSpot.');
    } finally {
      setHubspotSaving(false);
    }
  };

  const handleDisconnectHubSpot = async () => {
    if (!token || !activeWorkspaceId) return;
    setHubspotDisconnecting(true);
    try {
      await apiFetch(`/api/workspaces/${activeWorkspaceId}/integrations/hubspot`, {
        method: 'DELETE',
        token,
        onAuthFailure: () => onLogout(),
      });
      setHubspotStatus({ connected: false, portalId: null, accountName: null });
      onConnectedServicesChange((current: any) => ({ ...current, hubspot: false }));
    } catch {
      // ignore
    } finally {
      setHubspotDisconnecting(false);
    }
  };

  const handleConnectTwilio = async () => {
    if (!token || !activeWorkspaceId) return;
    setTwilioSaving(true);
    try {
      const result = await apiFetch<TwilioStatus>(`/api/workspaces/${activeWorkspaceId}/integrations/twilio`, {
        method: 'POST',
        token,
        onAuthFailure: () => onLogout(),
        body: JSON.stringify(twilioForm),
      });
      setTwilioStatus(result);
      onConnectedServicesChange((current: any) => ({ ...current, twilio: result.connected }));
      setIsTwilioModalOpen(false);
    } catch (err) {
      console.error('Failed to connect Twilio:', err);
      toast.error('Failed to connect Twilio.');
    } finally {
      setTwilioSaving(false);
    }
  };

  const handleDisconnectTwilio = async () => {
    if (!token || !activeWorkspaceId) return;
    setTwilioDisconnecting(true);
    try {
      await apiFetch(`/api/workspaces/${activeWorkspaceId}/integrations/twilio`, {
        method: 'DELETE',
        token,
        onAuthFailure: () => onLogout(),
      });
      setTwilioStatus({ connected: false, accountSid: null, fromNumber: null, updatedAt: null });
      onConnectedServicesChange((current: any) => ({ ...current, twilio: false }));
    } catch {
      // ignore
    } finally {
      setTwilioDisconnecting(false);
    }
  };

  const integrations = [
    {
      id: 'google-workspace',
      category: 'Team & Productivity',
      name: 'Google Workspace',
      icon: Layout,
      description: 'Gmail, Calendar, Drive, Docs & Slides',
      connected: googleStatus.connected,
      allowReconnect: false,
      services: [
        { name: 'Gmail', connected: googleStatus.gmail },
        { name: 'Calendar', connected: googleStatus.calendar },
        { name: 'Drive / Docs / Slides', connected: googleStatus.drive },
      ],
      onConnect: handleConnectGoogle,
      onDisconnect: handleDisconnectGoogle,
      isLoading: googleConnecting || googleDisconnecting,
    },
    {
      id: 'linkedin',
      category: 'Social & Content',
      name: 'LinkedIn',
      icon: Linkedin,
      description: 'Publish artifact copy directly to LinkedIn via Zernio',
      connected: Boolean(linkedinStatus?.connected),
      allowReconnect: true,
      services: [
        linkedinStatus?.accountName,
        linkedinStatus?.authorUrn,
      ].filter((val): val is string => typeof val === 'string' && val.length > 0).map((value) => ({ name: value, connected: true })),
      onConnect: handleConnectLinkedIn,
      onDisconnect: handleDisconnectLinkedIn,
      onGenerateInvite: () => handleGenerateInvite('linkedin'),
      isLoading: linkedinSaving || linkedinDisconnecting || isGeneratingInvite === 'linkedin',
    },
    {
      id: 'slack',
      category: 'Team & Productivity',
      name: 'Slack',
      icon: MessageSquare,
      description: 'Send workspace updates to Slack channels',
      connected: slackStatus.connected,
      allowReconnect: true,
      services: [
        slackStatus.teamName,
        slackStatus.defaultChannel,
      ].filter((val): val is string => typeof val === 'string' && val.length > 0).map((value) => ({ name: value, connected: true })),
      onConnect: () => setIsSlackModalOpen(true),
      onDisconnect: handleDisconnectSlack,
      isLoading: slackSaving || slackDisconnecting,
    },
    {
      id: 'teams',
      category: 'Team & Productivity',
      name: 'Microsoft Teams',
      icon: MessageSquare,
      description: 'Send workspace updates to a Teams incoming webhook',
      connected: teamsStatus.connected,
      allowReconnect: true,
      services: [
        teamsStatus.defaultChannelName,
      ].filter((val): val is string => typeof val === 'string' && val.length > 0).map((value) => ({ name: value, connected: true })),
      onConnect: () => setIsTeamsModalOpen(true),
      onDisconnect: handleDisconnectTeams,
      isLoading: teamsSaving || teamsDisconnecting,
    },
    {
      id: 'notion',
      category: 'Team & Productivity',
      name: 'Notion',
      icon: Globe,
      description: 'Save updates and artifacts to Notion pages',
      connected: notionStatus.connected,
      allowReconnect: true,
      services: [
        notionStatus.botName,
        notionStatus.defaultParentPageId ? `Parent ${notionStatus.defaultParentPageId}` : null,
      ].filter((val): val is string => typeof val === 'string' && val.length > 0).map((value) => ({ name: value, connected: true })),
      onConnect: () => setIsNotionModalOpen(true),
      onDisconnect: handleDisconnectNotion,
      isLoading: notionSaving || notionDisconnecting,
    },
    {
      id: 'hubspot',
      category: 'CRM & Communications',
      name: 'HubSpot (CRM & CMS)',
      icon: Building2,
      description: 'Sync leads into your CRM and manage blog drafts',
      connected: hubspotStatus.connected,
      allowReconnect: true,
      services: [
        hubspotStatus.accountName ? { name: hubspotStatus.accountName, connected: true } : null,
        hubspotStatus.portalId ? { name: `Portal ${hubspotStatus.portalId}`, connected: true } : null,
      ].filter((val): val is { name: string; connected: boolean } => val !== null),
      onConnect: () => setIsHubSpotModalOpen(true),
      onDisconnect: handleDisconnectHubSpot,
      isLoading: hubspotSaving || hubspotDisconnecting,
    },
    {
      id: 'twilio',
      category: 'CRM & Communications',
      name: 'Twilio (Phone & SMS)',
      icon: Phone,
      description: 'Manage phone lines and SMS workflows',
      connected: twilioStatus.connected,
      allowReconnect: true,
      services: [
        twilioStatus.accountSid ? `SID ${twilioStatus.accountSid.substring(0, 8)}...` : null,
        twilioStatus.fromNumber,
      ].filter((val): val is string => typeof val === 'string' && val.length > 0).map((value) => ({ name: value, connected: true })),
      onConnect: () => setIsTwilioModalOpen(true),
      onDisconnect: handleDisconnectTwilio,
      isLoading: twilioSaving || twilioDisconnecting,
    },
    {
      id: 'wordpress',
      category: 'Social & Content',
      name: 'WordPress',
      icon: Globe,
      description: 'Post blogs directly to your site',
      connected: wordpressStatus.connected,
      allowReconnect: true,
      services: wordpressStatus.siteUrl ? [{ name: wordpressStatus.siteUrl, connected: true }] : [],
      onConnect: () => setIsWordPressModalOpen(true),
      onDisconnect: handleDisconnectWordPress,
      isLoading: wordpressSaving || wordpressDisconnecting,
    },
  ];

  return (
    <div className="flex-1 flex flex-col bg-warm-50/50 overflow-hidden">
      <div className="px-8 py-6 bg-white border-b border-warm-200">
        <h1 className="font-display text-2xl font-bold text-stone-900">Settings</h1>
        <p className="text-stone-500 text-sm mt-1">Manage your account and connected services</p>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-4xl mx-auto space-y-8">

          {/* Tabs */}
          <div className="flex gap-1 bg-warm-100 p-1 rounded-xl w-fit">
            <button
              onClick={() => setActiveTab('account')}
              className={cn(
                "px-6 py-2 rounded-lg text-sm font-medium transition-all",
                activeTab === 'account' ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"
              )}
            >
              Account
            </button>
            <button
              onClick={() => setActiveTab('integrations')}
              className={cn(
                "px-6 py-2 rounded-lg text-sm font-medium transition-all",
                activeTab === 'integrations' ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"
              )}
            >
              Integrations
            </button>
          </div>

          {activeTab === 'account' ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <div className="bg-white rounded-2xl border border-warm-200 p-6 shadow-sm">
                <h2 className="font-display text-lg font-bold text-stone-900 mb-6 flex items-center gap-2">
                  <User className="w-5 h-5 text-brand-500" />
                  Profile Information
                </h2>

                <div className="flex flex-col md:flex-row gap-8 mb-8">
                  <div className="flex flex-col gap-4">
                    <label className="block text-xs font-bold text-stone-400 uppercase tracking-wider">Avatar</label>
                    <div className="flex gap-4 items-start">
                      <div className="w-20 h-20 rounded-full overflow-hidden bg-warm-100 border-2 border-warm-200 flex-shrink-0 relative group">
                        <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                        {isUpdatingAvatar && (
                          <div className="absolute inset-0 bg-white/50 flex items-center justify-center">
                            <Loader className="w-5 h-5 text-brand-500 animate-spin" />
                          </div>
                        )}
                        <label className="absolute inset-0 bg-stone-900/50 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity">
                          <Plus className="w-6 h-6 text-white mb-1" />
                          <span className="text-[10px] text-white font-bold uppercase tracking-wider">Upload</span>
                          <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
                        </label>
                      </div>
                      
                      <div className="flex-1">
                        <p className="text-xs text-stone-500 font-medium mb-2">Or choose a prebuilt avatar:</p>
                        <div className="flex flex-wrap gap-2">
                          {PREBUILT_AVATARS.map((url, i) => (
                            <button
                              key={i}
                              onClick={() => handleAvatarSelect(url)}
                              className={cn(
                                "w-10 h-10 rounded-full overflow-hidden border-2 transition-all hover:scale-105",
                                avatarUrl === url ? "border-brand-500 scale-110 shadow-md" : "border-warm-200 hover:border-brand-300"
                              )}
                            >
                              <img src={url} alt={`Prebuilt ${i}`} className="w-full h-full object-cover" />
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">Name</label>
                    <div className="flex items-center gap-3 p-3 bg-warm-50 rounded-xl border border-warm-200">
                      <span className="text-stone-900 font-medium">{user?.name || 'Not set'}</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">Email</label>
                    <div className="flex items-center gap-3 p-3 bg-warm-50 rounded-xl border border-warm-200">
                      <span className="text-stone-900 font-medium">{user?.email || 'Not set'}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-warm-200 p-6 shadow-sm">
                <h3 className="text-base font-bold text-stone-900 mb-1">Security</h3>
                <p className="text-sm text-stone-500 mb-4">Manage your account authentication.</p>
                <div className="flex gap-4">
                  <button
                    onClick={() => setShowPasswordModal(true)}
                    className="flex-1 rounded-xl border border-warm-200 px-4 py-3 text-sm font-bold text-stone-600 hover:bg-warm-50 transition-all flex items-center justify-center gap-2"
                  >
                    <Lock className="w-4 h-4" />
                    Change Password
                  </button>
                  <button
                    onClick={onLogout}
                    className="flex-1 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-600 hover:bg-red-100 transition-all flex items-center justify-center gap-2"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign Out
                  </button>
                </div>
              </div>

              {activeWorkspaceRole === 'owner' && (
                <div className="bg-white rounded-2xl border border-red-200 p-6 shadow-sm">
                  <h2 className="text-lg font-bold text-red-600 mb-2">Danger Zone</h2>
                  <p className="text-sm text-stone-500 mb-6">Permanently delete this workspace and all associated data.</p>
                  <button
                    onClick={() => setShowDeleteWorkspaceModal(true)}
                    className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700 transition-all"
                  >
                    Delete Workspace
                  </button>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <div className="space-y-8">
                {['Social & Content', 'Team & Productivity', 'CRM & Communications'].map((category) => {
                  const categoryIntegrations = integrations.filter(i => i.category === category);
                  if (categoryIntegrations.length === 0) return null;
                  
                  return (
                    <div key={category}>
                      <h3 className="text-sm font-bold text-stone-400 uppercase tracking-wider mb-4">{category}</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {categoryIntegrations.map((integration) => (
                          <div
                            key={integration.id}
                            className="bg-white rounded-2xl border border-warm-200 p-6 shadow-sm hover:border-brand-200 transition-all group"
                          >
                          <div className="flex items-start justify-between mb-4">
                            <div className="w-12 h-12 rounded-xl bg-warm-50 flex items-center justify-center text-stone-600 group-hover:bg-brand-50 group-hover:text-brand-600 transition-colors">
                              <Layout className="w-6 h-6" />
                            </div>
                            {integration.connected ? (
                              <span className="flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-600 rounded-lg text-[10px] font-bold uppercase tracking-wider">
                                <CheckCircle2 className="w-3 h-3" />
                                Connected
                              </span>
                            ) : (
                              <button
                                onClick={integration.onConnect}
                                disabled={integration.isLoading}
                                className="flex items-center gap-1 px-3 py-1 bg-stone-900 text-white rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-stone-800 transition-colors disabled:opacity-60"
                              >
                                {integration.isLoading ? <Loader className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                                Connect
                              </button>
                            )}
                          </div>

                          <h3 className="font-bold text-stone-900 mb-1">{integration.name}</h3>
                          <p className="text-stone-500 text-sm leading-relaxed mb-4">{integration.description}</p>

                          {integration.connected && integration.services.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mb-6">
                              {integration.services.map((svc) => (
                                <span key={svc.name} className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full", svc.connected ? "bg-emerald-50 text-emerald-700" : "bg-warm-100 text-stone-400")}>
                                  {svc.name}
                                </span>
                              ))}
                            </div>
                          )}

                          {integration.connected && (
                            <div className="flex flex-wrap items-center gap-3">
                              {integration.allowReconnect && (
                                <button onClick={integration.onConnect} className="text-xs font-medium text-stone-400 hover:text-brand-600 flex items-center gap-1 transition-colors">
                                  <RefreshCw className="w-3 h-3" /> Update
                                </button>
                              )}
                              {(integration as any).onGenerateInvite && (
                                <button onClick={(integration as any).onGenerateInvite} className="text-xs font-medium text-brand-500 hover:text-brand-700 flex items-center gap-1 transition-colors">
                                  <UserPlus className="w-3 h-3" /> Invite Client
                                </button>
                              )}
                              <button onClick={integration.onDisconnect} className="text-xs font-medium text-red-400 hover:text-red-600 flex items-center gap-1 transition-colors ml-auto">
                                <Unplug className="w-3 h-3" /> Disconnect
                              </button>
                            </div>
                          )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="bg-white rounded-2xl border border-warm-200 p-6 shadow-sm">
                <h3 className="text-base font-bold text-stone-900 mb-1">Scheduled Social Automation</h3>
                <p className="text-sm text-stone-500 mb-4">Automatically publish social artifacts when scheduled tasks complete.</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-stone-400">LinkedIn Mode</label>
                    <select
                      value={automationSettings.linkedinMode}
                      onChange={(event) => setAutomationSettings((current) => ({
                        ...current,
                        linkedinMode: event.target.value === 'publish' ? 'publish' : 'off',
                      }))}
                      className="w-full rounded-xl border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-stone-700 focus:ring-2 focus:ring-brand-500 outline-none"
                    >
                      <option value="off">Off</option>
                      <option value="publish">Auto publish</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-stone-400">LinkedIn Approval</label>
                    <select
                      value={automationSettings.approvalModeLinkedin}
                      onChange={(event) => setAutomationSettings((current) => ({
                        ...current,
                        approvalModeLinkedin: event.target.value === 'approval' ? 'approval' : 'auto',
                      }))}
                      disabled={automationSettings.linkedinMode === 'off'}
                      className="w-full rounded-xl border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-stone-700 focus:ring-2 focus:ring-brand-500 outline-none disabled:opacity-50"
                    >
                      <option value="auto">Auto-publish</option>
                      <option value="approval">Require approval</option>
                    </select>
                  </div>
                </div>

                <div className="mt-6 flex justify-end">
                  <button
                    onClick={handleSaveAutomationSettings}
                    disabled={savingAutomationSettings}
                    className="px-6 py-2 bg-stone-900 text-white rounded-xl text-sm font-bold hover:bg-stone-800 transition-all disabled:opacity-50"
                  >
                    {savingAutomationSettings ? 'Saving...' : 'Save Automation'}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {isSlackModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-stone-900/40 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white w-full max-w-md rounded-2xl shadow-xl p-6">
              <h3 className="text-xl font-bold text-stone-900 mb-4">Connect Slack</h3>
              <div className="space-y-4">
                <input placeholder="Bot Token" className="w-full p-3 bg-warm-50 border border-warm-200 rounded-xl" value={slackForm.botToken} onChange={e => setSlackForm({...slackForm, botToken: e.target.value})} />
                <input placeholder="Default Channel" className="w-full p-3 bg-warm-50 border border-warm-200 rounded-xl" value={slackForm.defaultChannel} onChange={e => setSlackForm({...slackForm, defaultChannel: e.target.value})} />
                <div className="flex justify-end gap-3 pt-4">
                  <button onClick={() => setIsSlackModalOpen(false)} className="px-4 py-2 text-stone-500 font-bold">Cancel</button>
                  <button onClick={handleConnectSlack} disabled={slackSaving} className="px-4 py-2 bg-stone-900 text-white rounded-xl font-bold">Connect</button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
        {/* ... Other Modals ... */}
      </AnimatePresence>
    </div>
  );
};
