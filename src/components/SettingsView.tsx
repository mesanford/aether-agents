import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  User,
  Lock,
  LogOut,
  Globe,
  FileText,
  Linkedin,
  Mail,
  MessageSquare,
  Layout,
  Building2,
  CheckCircle2,
  Plus,
  ExternalLink,
  Loader,
  Unplug,
  RefreshCw
} from 'lucide-react';
import { cn } from '../utils';
import { apiFetch } from '../services/apiClient';

interface SettingsViewProps {
  user: any;
  token: string | null;
  activeWorkspaceId: number | null;
  onLogout: () => void;
  onConnectedServicesChange: React.Dispatch<React.SetStateAction<any>>;
  onGoogleDefaultsChange: (defaults: GoogleDefaults) => void;
}

interface GoogleStatus {
  connected: boolean;
  gmail: boolean;
  calendar: boolean;
  drive: boolean;
  analytics: boolean;
  searchConsole: boolean;
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

interface BufferProfile {
  id: string;
  service: string;
  serviceUsername: string | null;
  formattedUsername: string | null;
  isDefault?: boolean;
}

interface BufferStatus {
  connected: boolean;
  profiles: BufferProfile[];
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

interface AnalyticsProperty {
  propertyId: string;
  displayName: string;
  account?: string;
}

interface SearchConsoleSite {
  siteUrl: string;
  permissionLevel?: string;
}

interface GoogleDefaults {
  analyticsPropertyId: string | null;
  searchConsoleSiteUrl: string | null;
}

interface AutomationSettings {
  linkedinMode: 'off' | 'publish';
  bufferMode: 'off' | 'queue';
  teamsMode: 'off' | 'send';
  notionMode: 'off' | 'create';
  bufferProfileId: string | null;
  notionParentPageId: string | null;
  requireArtifactImage: boolean;
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
  services: {
    linkedin: { connected: boolean; lastSuccessAt: string | null; lastFailureAt: string | null; failedCount24h: number };
    buffer: { connected: boolean; lastSuccessAt: string | null; lastFailureAt: string | null; failedCount24h: number };
    wordpress: { connected: boolean; lastSuccessAt: string | null; lastFailureAt: string | null; failedCount24h: number };
    hubspot: { connected: boolean; lastSuccessAt: string | null; lastFailureAt: string | null; failedCount24h: number };
    teams: { connected: boolean; lastSuccessAt: string | null; lastFailureAt: string | null; failedCount24h: number };
    notion: { connected: boolean; lastSuccessAt: string | null; lastFailureAt: string | null; failedCount24h: number };
  };
  providerTelemetry: {
    linkedin: { rateLimited24h: number; authErrors24h: number; lastError: string | null };
    buffer: { rateLimited24h: number; authErrors24h: number; lastError: string | null };
    wordpress: { rateLimited24h: number; authErrors24h: number; lastError: string | null };
    hubspot: { rateLimited24h: number; authErrors24h: number; lastError: string | null };
    teams: { rateLimited24h: number; authErrors24h: number; lastError: string | null };
    notion: { rateLimited24h: number; authErrors24h: number; lastError: string | null };
  };
  queue: {
    queued: number;
    running: number;
    retrying: number;
    deadLettered: number;
    deduped24h: number;
  };
  automation: {
    linkedinMode: 'off' | 'publish';
    bufferMode: 'off' | 'queue';
    teamsMode: 'off' | 'send';
    notionMode: 'off' | 'create';
    requireArtifactImage: boolean;
    recentFailures: IntegrationHealthFailure[];
  };
}

export const SettingsView: React.FC<SettingsViewProps> = ({ user, token, activeWorkspaceId, onLogout, onConnectedServicesChange, onGoogleDefaultsChange }) => {
  const [activeTab, setActiveTab] = useState<'account' | 'integrations'>('account');
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus>({ connected: false, gmail: false, calendar: false, drive: false, analytics: false, searchConsole: false });
  const [wordpressStatus, setWordpressStatus] = useState<WordPressStatus>({ connected: false, siteUrl: null });
  const [hubspotStatus, setHubspotStatus] = useState<HubSpotStatus>({ connected: false, portalId: null, accountName: null });
  const [linkedinStatus, setLinkedinStatus] = useState<LinkedInStatus>({ connected: false, authorUrn: null, accountName: null });
  const [bufferStatus, setBufferStatus] = useState<BufferStatus>({ connected: false, profiles: [] });
  const [slackStatus, setSlackStatus] = useState<SlackStatus>({ connected: false, defaultChannel: null, teamId: null, teamName: null, botUserId: null, updatedAt: null });
  const [teamsStatus, setTeamsStatus] = useState<TeamsStatus>({ connected: false, defaultChannelName: null, updatedAt: null });
  const [notionStatus, setNotionStatus] = useState<NotionStatus>({ connected: false, botName: null, defaultParentPageId: null, updatedAt: null });
  const [twilioStatus, setTwilioStatus] = useState<TwilioStatus>({ connected: false, accountSid: null, fromNumber: null, updatedAt: null });
  const [webhookSecrets, setWebhookSecrets] = useState<WebhookSecretProvider[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [isWordPressModalOpen, setIsWordPressModalOpen] = useState(false);
  const [wordpressSaving, setWordpressSaving] = useState(false);
  const [wordpressDisconnecting, setWordpressDisconnecting] = useState(false);
  const [wordpressForm, setWordpressForm] = useState({ siteUrl: '', username: '', appPassword: '' });
  const [isLinkedInModalOpen, setIsLinkedInModalOpen] = useState(false);
  const [linkedinSaving, setLinkedinSaving] = useState(false);
  const [linkedinDisconnecting, setLinkedinDisconnecting] = useState(false);
  const [linkedinForm, setLinkedinForm] = useState({ accessToken: '', authorUrn: '' });
  const [isBufferModalOpen, setIsBufferModalOpen] = useState(false);
  const [isSlackModalOpen, setIsSlackModalOpen] = useState(false);
  const [isTeamsModalOpen, setIsTeamsModalOpen] = useState(false);
  const [isNotionModalOpen, setIsNotionModalOpen] = useState(false);
  const [bufferSaving, setBufferSaving] = useState(false);
  const [slackSaving, setSlackSaving] = useState(false);
  const [teamsSaving, setTeamsSaving] = useState(false);
  const [notionSaving, setNotionSaving] = useState(false);
  const [bufferDisconnecting, setBufferDisconnecting] = useState(false);
  const [slackDisconnecting, setSlackDisconnecting] = useState(false);
  const [teamsDisconnecting, setTeamsDisconnecting] = useState(false);
  const [notionDisconnecting, setNotionDisconnecting] = useState(false);
  const [bufferAccessToken, setBufferAccessToken] = useState('');
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
  const [analyticsProperties, setAnalyticsProperties] = useState<AnalyticsProperty[]>([]);
  const [searchConsoleSites, setSearchConsoleSites] = useState<SearchConsoleSite[]>([]);
  const [googleDefaults, setGoogleDefaults] = useState<GoogleDefaults>({
    analyticsPropertyId: null,
    searchConsoleSiteUrl: null,
  });
  const [savingGoogleDefaults, setSavingGoogleDefaults] = useState(false);
  const [automationSettings, setAutomationSettings] = useState<AutomationSettings>({
    linkedinMode: 'off',
    bufferMode: 'off',
    teamsMode: 'off',
    notionMode: 'off',
    bufferProfileId: null,
    notionParentPageId: null,
    requireArtifactImage: false,
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
        const health = await apiFetch<IntegrationHealth>(`/api/workspaces/${activeWorkspaceId}/integrations/health`, {
          token,
          onAuthFailure: () => onLogout(),
        }).catch(() => null);

        const linkedin = await apiFetch<LinkedInStatus>(`/api/workspaces/${activeWorkspaceId}/integrations/linkedin/status`, {
          token,
          onAuthFailure: () => onLogout(),
        }).catch(() => ({ connected: false, authorUrn: null, accountName: null }));
        const buffer = await apiFetch<BufferStatus>(`/api/workspaces/${activeWorkspaceId}/integrations/buffer/status`, {
          token,
          onAuthFailure: () => onLogout(),
        }).catch(() => ({ connected: false, profiles: [] }));
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
        const defaults = await apiFetch<GoogleDefaults>(`/api/workspaces/${activeWorkspaceId}/integrations/google/defaults`, {
          token,
          onAuthFailure: () => onLogout(),
        }).catch(() => ({ analyticsPropertyId: null, searchConsoleSiteUrl: null }));
        const automation = await apiFetch<AutomationSettings>(`/api/workspaces/${activeWorkspaceId}/automation-settings`, {
          token,
          onAuthFailure: () => onLogout(),
        }).catch(() => ({ linkedinMode: 'off', bufferMode: 'off', teamsMode: 'off', notionMode: 'off', bufferProfileId: null, notionParentPageId: null, requireArtifactImage: false }));

        const propertiesData = data.analytics
          ? await apiFetch<{ properties?: AnalyticsProperty[] }>('/api/integrations/analytics/properties', {
              token,
              onAuthFailure: () => onLogout(),
            }).catch(() => ({ properties: [] }))
          : { properties: [] };

        const sitesData = data.searchConsole
          ? await apiFetch<{ sites?: SearchConsoleSite[] }>('/api/integrations/search-console/sites', {
              token,
              onAuthFailure: () => onLogout(),
            }).catch(() => ({ sites: [] }))
          : { sites: [] };

  setLinkedinStatus(linkedin);
  setBufferStatus({ connected: buffer.connected, profiles: Array.isArray(buffer.profiles) ? buffer.profiles : [] });
      setSlackStatus(slack);
  setTeamsStatus(teams);
        setNotionStatus(notion);
      setTwilioStatus(twilio);
      setWebhookSecrets(Array.isArray(webhookSecretResponse.providers) ? webhookSecretResponse.providers : []);
      setIntegrationsHealth(health);
        setWordpressStatus(wordpress);
        setHubspotStatus(hubspot);
        setAnalyticsProperties(Array.isArray(propertiesData.properties) ? propertiesData.properties : []);
        setSearchConsoleSites(Array.isArray(sitesData.sites) ? sitesData.sites : []);
        setGoogleDefaults({
          analyticsPropertyId: defaults.analyticsPropertyId,
          searchConsoleSiteUrl: defaults.searchConsoleSiteUrl,
        });
        setAutomationSettings({
          linkedinMode: automation.linkedinMode === 'publish' ? 'publish' : 'off',
          bufferMode: automation.bufferMode === 'queue' ? 'queue' : 'off',
          teamsMode: automation.teamsMode === 'send' ? 'send' : 'off',
          notionMode: automation.notionMode === 'create' ? 'create' : 'off',
          bufferProfileId: automation.bufferProfileId || null,
          notionParentPageId: automation.notionParentPageId || null,
          requireArtifactImage: Boolean(automation.requireArtifactImage),
        });
        onGoogleDefaultsChange({
          analyticsPropertyId: defaults.analyticsPropertyId,
          searchConsoleSiteUrl: defaults.searchConsoleSiteUrl,
        });
        onConnectedServicesChange((current: any) => ({
          ...current,
          gmail: data.gmail,
          calendar: data.calendar,
          drive: data.drive,
          analytics: data.analytics,
          searchConsole: data.searchConsole,
          slack: slack.connected,
          teams: teams.connected,
          notion: notion.connected,
          linkedin: linkedin.connected,
          buffer: buffer.connected,
          twilio: twilio.connected,
          wordpress: wordpress.connected,
          hubspot: hubspot.connected,
        }));
      }
    } catch {
      // ignore
    }
  };

  const handleSaveGoogleDefaults = async () => {
    if (!token || !activeWorkspaceId) return;
    setSavingGoogleDefaults(true);
    try {
      const result = await apiFetch<GoogleDefaults>(`/api/workspaces/${activeWorkspaceId}/integrations/google/defaults`, {
        method: 'PUT',
        token,
        onAuthFailure: () => onLogout(),
        body: JSON.stringify(googleDefaults),
      });
      setGoogleDefaults(result);
      onGoogleDefaultsChange(result);
    } catch (err) {
      console.error('Failed to save Google defaults:', err);
      alert('Failed to save Google defaults.');
    } finally {
      setSavingGoogleDefaults(false);
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
      setAutomationSettings({
        linkedinMode: result.linkedinMode,
        bufferMode: result.bufferMode,
        teamsMode: result.teamsMode,
        notionMode: result.notionMode,
        bufferProfileId: result.bufferProfileId,
        notionParentPageId: result.notionParentPageId,
        requireArtifactImage: result.requireArtifactImage,
      });
    } catch (err) {
      console.error('Failed to save automation settings:', err);
      alert('Failed to save automation settings.');
    } finally {
      setSavingAutomationSettings(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, [token, activeWorkspaceId]);

  const handleConnectGoogle = async () => {
    if (!token) return;
    setConnecting(true);
    try {
      const { url } = await apiFetch<{ url: string }>('/api/integrations/google/connect', {
        token,
        onAuthFailure: () => onLogout(),
      });

      const popup = window.open(url, 'google-workspace-auth', 'width=500,height=650,scrollbars=yes');

      const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === 'WORKSPACE_AUTH_SUCCESS') {
          window.removeEventListener('message', handleMessage);
          popup?.close();
          fetchStatus();
          setConnecting(false);
        } else if (event.data?.type === 'WORKSPACE_AUTH_ERROR') {
          window.removeEventListener('message', handleMessage);
          popup?.close();
          alert(`Connection failed: ${event.data.error}`);
          setConnecting(false);
        }
      };
      window.addEventListener('message', handleMessage);

      // Poll for popup close
      const timer = setInterval(() => {
        if (popup?.closed) {
          clearInterval(timer);
          window.removeEventListener('message', handleMessage);
          setConnecting(false);
          fetchStatus();
        }
      }, 500);
    } catch (err) {
      console.error('Failed to start Google connect:', err);
      setConnecting(false);
    }
  };

  const handleDisconnectGoogle = async () => {
    if (!token) return;
    setDisconnecting(true);
    try {
      await apiFetch('/api/integrations/google', {
        method: 'DELETE',
        token,
        onAuthFailure: () => onLogout(),
      });
      setGoogleStatus({ connected: false, gmail: false, calendar: false, drive: false, analytics: false, searchConsole: false });
    } catch {
      // ignore
    } finally {
      setDisconnecting(false);
    }
  };

  const handleConnectWordPress = async () => {
    if (!token || !activeWorkspaceId) return;
    setWordpressSaving(true);
    try {
      const result = await apiFetch<WordPressStatus>(`/api/workspaces/${activeWorkspaceId}/integrations/wordpress`, {
        method: 'POST',
        token,
        onAuthFailure: () => onLogout(),
        body: JSON.stringify(wordpressForm),
      });
      setWordpressStatus(result);
      onConnectedServicesChange((current: any) => ({ ...current, wordpress: result.connected }));
      setIsWordPressModalOpen(false);
      setWordpressForm({ siteUrl: '', username: '', appPassword: '' });
    } catch (err) {
      console.error('Failed to connect WordPress:', err);
      alert('Failed to connect WordPress. Verify the site URL, username, and application password.');
    } finally {
      setWordpressSaving(false);
    }
  };

  const handleConnectLinkedIn = async () => {
    if (!token || !activeWorkspaceId) return;
    setLinkedinSaving(true);
    try {
      const result = await apiFetch<LinkedInStatus>(`/api/workspaces/${activeWorkspaceId}/integrations/linkedin`, {
        method: 'POST',
        token,
        onAuthFailure: () => onLogout(),
        body: JSON.stringify(linkedinForm),
      });
      setLinkedinStatus(result);
      onConnectedServicesChange((current: any) => ({ ...current, linkedin: result.connected }));
      setIsLinkedInModalOpen(false);
      setLinkedinForm({ accessToken: '', authorUrn: '' });
    } catch (err) {
      console.error('Failed to connect LinkedIn:', err);
      alert('Failed to connect LinkedIn. Use a token with the Share on LinkedIn product and w_member_social scope.');
    } finally {
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

  const handleConnectBuffer = async () => {
    if (!token || !activeWorkspaceId) return;
    setBufferSaving(true);
    try {
      const result = await apiFetch<BufferStatus>(`/api/workspaces/${activeWorkspaceId}/integrations/buffer`, {
        method: 'POST',
        token,
        onAuthFailure: () => onLogout(),
        body: JSON.stringify({ accessToken: bufferAccessToken }),
      });
      setBufferStatus({ connected: result.connected, profiles: Array.isArray(result.profiles) ? result.profiles : [] });
      onConnectedServicesChange((current: any) => ({ ...current, buffer: result.connected }));
      setIsBufferModalOpen(false);
      setBufferAccessToken('');
    } catch (err) {
      console.error('Failed to connect Buffer:', err);
      alert('Failed to connect Buffer. Verify the access token and that the account has connected profiles.');
    } finally {
      setBufferSaving(false);
    }
  };

  const handleDisconnectBuffer = async () => {
    if (!token || !activeWorkspaceId) return;
    setBufferDisconnecting(true);
    try {
      await apiFetch(`/api/workspaces/${activeWorkspaceId}/integrations/buffer`, {
        method: 'DELETE',
        token,
        onAuthFailure: () => onLogout(),
      });
      setBufferStatus({ connected: false, profiles: [] });
      onConnectedServicesChange((current: any) => ({ ...current, buffer: false }));
    } catch {
      // ignore
    } finally {
      setBufferDisconnecting(false);
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
      setSlackForm({ botToken: '', defaultChannel: '' });
    } catch (err) {
      console.error('Failed to connect Slack:', err);
      alert('Failed to connect Slack. Verify bot token and channel settings.');
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
      setTeamsForm({ webhookUrl: '', defaultChannelName: '' });
    } catch (err) {
      console.error('Failed to connect Teams:', err);
      alert('Failed to connect Teams. Verify the incoming webhook URL.');
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
      setNotionForm({ integrationToken: '', defaultParentPageId: '' });
    } catch (err) {
      console.error('Failed to connect Notion:', err);
      alert('Failed to connect Notion. Verify the integration token and permissions.');
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
      setHubspotToken('');
    } catch (err) {
      console.error('Failed to connect HubSpot:', err);
      alert('Failed to connect HubSpot. Verify the private app token and scopes.');
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
      setTwilioStatus({
        connected: true,
        accountSid: result.accountSid,
        fromNumber: result.fromNumber,
        updatedAt: result.updatedAt,
      });
      onConnectedServicesChange((current: any) => ({ ...current, twilio: true }));
      setIsTwilioModalOpen(false);
      setTwilioForm({ accountSid: '', authToken: '', fromNumber: '' });
    } catch (err) {
      console.error('Failed to connect Twilio:', err);
      alert('Failed to connect Twilio. Verify Account SID, Auth Token, and sender number.');
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

  const handleRotateWebhookSecret = async (provider: 'hubspot' | 'wordpress' | 'linkedin') => {
    if (!token || !activeWorkspaceId) return;
    try {
      const result = await apiFetch<{ success: boolean; secret: string }>(`/api/workspaces/${activeWorkspaceId}/integrations/webhooks/secrets/${provider}/rotate`, {
        method: 'POST',
        token,
        onAuthFailure: () => onLogout(),
      });
      if (result?.secret) {
        window.alert(`New ${provider} webhook secret (save now): ${result.secret}`);
      }
      fetchStatus();
    } catch (err) {
      console.error(`Failed to rotate ${provider} webhook secret:`, err);
      alert('Failed to rotate webhook secret.');
    }
  };

  const integrations = [
    {
      id: 'google-workspace',
      name: 'Google Workspace',
      icon: Layout,
      description: 'Gmail, Calendar, Drive, Docs & Slides',
      connected: googleStatus.connected,
      allowReconnect: false,
      services: [
        { name: 'Gmail', connected: googleStatus.gmail },
        { name: 'Calendar', connected: googleStatus.calendar },
        { name: 'Drive / Docs / Slides', connected: googleStatus.drive },
        { name: 'Google Analytics', connected: googleStatus.analytics },
        { name: 'Search Console', connected: googleStatus.searchConsole },
      ],
      onConnect: handleConnectGoogle,
      onDisconnect: handleDisconnectGoogle,
      isLoading: connecting || disconnecting,
    },
    {
      id: 'linkedin',
      name: 'LinkedIn',
      icon: Linkedin,
      description: 'Publish artifact copy directly to LinkedIn',
      connected: linkedinStatus.connected,
      allowReconnect: true,
      services: [
        linkedinStatus.accountName,
        linkedinStatus.authorUrn,
      ].filter(Boolean).map((value) => ({ name: String(value), connected: true })),
      onConnect: () => setIsLinkedInModalOpen(true),
      onDisconnect: handleDisconnectLinkedIn,
      isLoading: linkedinSaving || linkedinDisconnecting,
    },
    {
      id: 'buffer',
      name: 'Buffer',
      icon: ExternalLink,
      description: 'Queue social posts to your connected Buffer channels',
      connected: bufferStatus.connected,
      allowReconnect: true,
      services: bufferStatus.profiles.map((profile) => ({
        name: profile.formattedUsername || profile.serviceUsername || `${profile.service} profile`,
        connected: true,
      })),
      onConnect: () => setIsBufferModalOpen(true),
      onDisconnect: handleDisconnectBuffer,
      isLoading: bufferSaving || bufferDisconnecting,
    },
    {
      id: 'slack',
      name: 'Slack',
      icon: MessageSquare,
      description: 'Send workspace updates to Slack channels',
      connected: slackStatus.connected,
      allowReconnect: true,
      services: [
        slackStatus.teamName,
        slackStatus.defaultChannel,
      ].filter(Boolean).map((value) => ({ name: String(value), connected: true })),
      onConnect: () => setIsSlackModalOpen(true),
      onDisconnect: handleDisconnectSlack,
      isLoading: slackSaving || slackDisconnecting,
    },
    {
      id: 'teams',
      name: 'Microsoft Teams',
      icon: MessageSquare,
      description: 'Send workspace updates to a Teams incoming webhook',
      connected: teamsStatus.connected,
      allowReconnect: true,
      services: [
        teamsStatus.defaultChannelName,
      ].filter(Boolean).map((value) => ({ name: String(value), connected: true })),
      onConnect: () => setIsTeamsModalOpen(true),
      onDisconnect: handleDisconnectTeams,
      isLoading: teamsSaving || teamsDisconnecting,
    },
    {
      id: 'notion',
      name: 'Notion',
      icon: FileText,
      description: 'Save updates and artifacts to Notion pages',
      connected: notionStatus.connected,
      allowReconnect: true,
      services: [
        notionStatus.botName,
        notionStatus.defaultParentPageId ? `Parent ${notionStatus.defaultParentPageId}` : null,
      ].filter(Boolean).map((value) => ({ name: String(value), connected: true })),
      onConnect: () => setIsNotionModalOpen(true),
      onDisconnect: handleDisconnectNotion,
      isLoading: notionSaving || notionDisconnecting,
    },
    {
      id: 'hubspot',
      name: 'HubSpot',
      icon: Building2,
      description: 'Sync leads into your CRM',
      connected: hubspotStatus.connected,
      allowReconnect: true,
      services: hubspotStatus.accountName
        ? [{ name: hubspotStatus.accountName, connected: true }]
        : hubspotStatus.portalId
          ? [{ name: `Portal ${hubspotStatus.portalId}`, connected: true }]
          : [],
      onConnect: () => setIsHubSpotModalOpen(true),
      onDisconnect: handleDisconnectHubSpot,
      isLoading: hubspotSaving || hubspotDisconnecting,
    },
    {
      id: 'twilio',
      name: 'Twilio SMS',
      icon: Mail,
      description: 'Send SMS updates and notifications from agent workflows',
      connected: twilioStatus.connected,
      allowReconnect: true,
      services: [
        twilioStatus.accountSid ? `SID ${twilioStatus.accountSid}` : null,
        twilioStatus.fromNumber,
      ].filter(Boolean).map((value) => ({ name: String(value), connected: true })),
      onConnect: () => setIsTwilioModalOpen(true),
      onDisconnect: handleDisconnectTwilio,
      isLoading: twilioSaving || twilioDisconnecting,
    },
    {
      id: 'wordpress',
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
    <div className="flex-1 flex flex-col bg-slate-50/50 overflow-hidden">
      <div className="px-8 py-6 bg-white border-b border-slate-100">
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-slate-500 text-sm mt-1">Manage your account and connected services</p>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-4xl mx-auto space-y-8">

          {/* Tabs */}
          <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
            <button
              onClick={() => setActiveTab('account')}
              className={cn(
                "px-6 py-2 rounded-lg text-sm font-medium transition-all",
                activeTab === 'account' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              Account
            </button>
            <button
              onClick={() => setActiveTab('integrations')}
              className={cn(
                "px-6 py-2 rounded-lg text-sm font-medium transition-all",
                activeTab === 'integrations' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
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
              <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
                <h2 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
                  <User className="w-5 h-5 text-brand-500" />
                  Profile Information
                </h2>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Name</label>
                    <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <span className="text-slate-900 font-medium">{user.name}</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Email</label>
                    <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <span className="text-slate-900 font-medium">{user.email}</span>
                    </div>
                  </div>

                  <div className="pt-4">
                    <button
                      onClick={() => alert('Password change functionality coming soon!')}
                      className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      <Lock className="w-4 h-4" />
                      Change Password
                    </button>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
                <h2 className="text-lg font-bold text-slate-900 mb-4">Session</h2>
                <p className="text-slate-500 text-sm mb-6">Manage your active session and security</p>

                <button
                  onClick={onLogout}
                  className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-xl text-sm font-medium hover:bg-red-100 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Log Out
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              {integrationsHealth && (
                <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
                  <h3 className="text-base font-bold text-slate-900 mb-1">Integrations Health</h3>
                  <p className="text-sm text-slate-500 mb-4">Live workspace integration status, queue pressure, and recent automation failures.</p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4">
                    {[
                      ['LinkedIn', integrationsHealth.services.linkedin],
                      ['Buffer', integrationsHealth.services.buffer],
                      ['WordPress', integrationsHealth.services.wordpress],
                      ['HubSpot', integrationsHealth.services.hubspot],
                      ['Teams', integrationsHealth.services.teams],
                      ['Notion', integrationsHealth.services.notion],
                    ].map(([label, service]) => (
                      <div key={String(label)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className={cn(
                          'text-[11px] font-semibold',
                          service.connected ? 'text-emerald-700' : 'text-slate-500',
                        )}>
                          {label}: {service.connected ? 'Connected' : 'Disconnected'}
                        </p>
                        <p className="text-[11px] text-slate-500 mt-1">
                          Last success: {service.lastSuccessAt || 'n/a'}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          Last failure: {service.lastFailureAt || 'n/a'} · 24h failures: {service.failedCount24h}
                        </p>
                      </div>
                    ))}
                  </div>

                  <p className="text-xs text-slate-500 mb-3">
                    Automation modes: LinkedIn {integrationsHealth.automation.linkedinMode} · Buffer {integrationsHealth.automation.bufferMode}
                    {' · '}Teams {integrationsHealth.automation.teamsMode} · Notion {integrationsHealth.automation.notionMode}
                    {integrationsHealth.automation.requireArtifactImage ? ' · Image required' : ''}
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4">
                    {[
                      ['LinkedIn', integrationsHealth.providerTelemetry.linkedin],
                      ['Buffer', integrationsHealth.providerTelemetry.buffer],
                      ['WordPress', integrationsHealth.providerTelemetry.wordpress],
                      ['HubSpot', integrationsHealth.providerTelemetry.hubspot],
                      ['Teams', integrationsHealth.providerTelemetry.teams],
                      ['Notion', integrationsHealth.providerTelemetry.notion],
                    ].map(([label, telemetry]) => (
                      <div key={String(label)} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                        <p className="text-[11px] font-semibold text-slate-700">{label} telemetry</p>
                        <p className="text-[11px] text-slate-500 mt-1">
                          24h rate-limited: {telemetry.rateLimited24h} · 24h auth errors: {telemetry.authErrors24h}
                        </p>
                        <p className="text-[11px] text-slate-500">Last error: {telemetry.lastError || 'n/a'}</p>
                      </div>
                    ))}
                  </div>

                  <p className="text-xs text-slate-500 mb-3">
                    Queue: queued {integrationsHealth.queue.queued} · running {integrationsHealth.queue.running} · retrying {integrationsHealth.queue.retrying} · dead-lettered {integrationsHealth.queue.deadLettered} · deduped (24h) {integrationsHealth.queue.deduped24h}
                  </p>

                  {integrationsHealth.automation.recentFailures.length > 0 ? (
                    <div className="space-y-2">
                      {integrationsHealth.automation.recentFailures.map((failure) => (
                        <div key={failure.id} className="rounded-xl border border-rose-100 bg-rose-50/60 px-3 py-2">
                          <p className="text-xs font-semibold text-rose-700">
                            {failure.channel || 'automation'} failure · {failure.createdAt || 'unknown time'}
                          </p>
                          <p className="text-xs text-rose-600 mt-1">
                            {failure.taskId ? `Task ${failure.taskId}: ` : ''}{failure.error || failure.action}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">No recent automation failures recorded.</p>
                  )}
                </div>
              )}

              <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
                <h3 className="text-base font-bold text-slate-900 mb-1">Webhook Secrets</h3>
                <p className="text-sm text-slate-500 mb-4">Rotate provider-scoped secrets used by inbound webhook endpoints.</p>

                <div className="space-y-2">
                  {webhookSecrets.map((entry) => (
                    <div key={entry.provider} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">{entry.provider}</p>
                        <p className="text-xs text-slate-500">
                          {entry.configured ? `Configured ${entry.secretPreview || ''}` : 'Not configured'}
                          {entry.lastRotatedAt ? ` · Rotated ${entry.lastRotatedAt}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRotateWebhookSecret(entry.provider)}
                        className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        Rotate
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {integrations.map((integration) => (
                  <div
                    key={integration.id}
                    className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm hover:border-brand-200 transition-all group"
                  >
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center text-slate-600 group-hover:bg-brand-50 group-hover:text-brand-600 transition-colors">
                      <integration.icon className="w-6 h-6" />
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
                        className="flex items-center gap-1 px-3 py-1 bg-slate-900 text-white rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-slate-800 transition-colors disabled:opacity-60"
                      >
                        {integration.isLoading ? (
                          <Loader className="w-3 h-3 animate-spin" />
                        ) : (
                          <Plus className="w-3 h-3" />
                        )}
                        {integration.isLoading ? 'Connecting...' : 'Connect'}
                      </button>
                    )}
                  </div>

                  <h3 className="font-bold text-slate-900 mb-1">{integration.name}</h3>
                  <p className="text-slate-500 text-sm leading-relaxed mb-3">{integration.description}</p>

                  {/* Show per-service status when connected */}
                  {integration.connected && integration.services.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-4">
                      {integration.services.map((svc) => (
                        <span
                          key={svc.name}
                          className={cn(
                            "text-[10px] font-medium px-2 py-0.5 rounded-full",
                            svc.connected ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400"
                          )}
                        >
                          {svc.name}
                        </span>
                      ))}
                    </div>
                  )}

                  {integration.connected && (
                    <div className="flex items-center gap-4">
                      {integration.allowReconnect && (
                        <button
                          onClick={integration.onConnect}
                          disabled={integration.isLoading}
                          className="text-xs font-medium text-slate-400 hover:text-brand-600 flex items-center gap-1 transition-colors disabled:opacity-60"
                        >
                          <RefreshCw className="w-3 h-3" />
                          Update Credentials
                        </button>
                      )}
                      <button
                        onClick={integration.onDisconnect ?? undefined}
                        disabled={integration.isLoading}
                        className="text-xs font-medium text-red-400 hover:text-red-600 flex items-center gap-1 transition-colors disabled:opacity-60"
                      >
                        <Unplug className="w-3 h-3" />
                        {integration.isLoading ? 'Disconnecting...' : 'Disconnect'}
                      </button>
                    </div>
                  )}
                  </div>
                ))}
              </div>

              {googleStatus.connected && (googleStatus.analytics || googleStatus.searchConsole) && (
                <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
                  <h3 className="text-base font-bold text-slate-900 mb-1">Google Data Defaults</h3>
                  <p className="text-sm text-slate-500 mb-4">Choose which GA4 property and Search Console site agents should use by default.</p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">Default GA4 Property</label>
                      <select
                        value={googleDefaults.analyticsPropertyId || ''}
                        onChange={(event) => setGoogleDefaults((current) => ({
                          ...current,
                          analyticsPropertyId: event.target.value || null,
                        }))}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:border-transparent focus:ring-2 focus:ring-brand-500 outline-none"
                      >
                        <option value="">Auto-select first available property</option>
                        {analyticsProperties.map((property) => (
                          <option key={property.propertyId} value={property.propertyId}>
                            {property.displayName}{property.account ? ` (${property.account})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">Default Search Console Site</label>
                      <select
                        value={googleDefaults.searchConsoleSiteUrl || ''}
                        onChange={(event) => setGoogleDefaults((current) => ({
                          ...current,
                          searchConsoleSiteUrl: event.target.value || null,
                        }))}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:border-transparent focus:ring-2 focus:ring-brand-500 outline-none"
                      >
                        <option value="">Auto-select first available site</option>
                        {searchConsoleSites.map((site) => (
                          <option key={site.siteUrl} value={site.siteUrl}>
                            {site.siteUrl}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={handleSaveGoogleDefaults}
                      disabled={savingGoogleDefaults}
                      className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                    >
                      {savingGoogleDefaults ? 'Saving...' : 'Save Defaults'}
                    </button>
                  </div>
                </div>
              )}

              <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
                <h3 className="text-base font-bold text-slate-900 mb-1">Scheduled Social Automation</h3>
                <p className="text-sm text-slate-500 mb-4">Automatically publish or queue social artifacts when scheduled tasks complete.</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">LinkedIn Mode</label>
                    <select
                      value={automationSettings.linkedinMode}
                      onChange={(event) => setAutomationSettings((current) => ({
                        ...current,
                        linkedinMode: event.target.value === 'publish' ? 'publish' : 'off',
                      }))}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:border-transparent focus:ring-2 focus:ring-brand-500 outline-none"
                    >
                      <option value="off">Off</option>
                      <option value="publish">Auto publish</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">Buffer Mode</label>
                    <select
                      value={automationSettings.bufferMode}
                      onChange={(event) => setAutomationSettings((current) => ({
                        ...current,
                        bufferMode: event.target.value === 'queue' ? 'queue' : 'off',
                      }))}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:border-transparent focus:ring-2 focus:ring-brand-500 outline-none"
                    >
                      <option value="off">Off</option>
                      <option value="queue">Auto queue</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">Teams Mode</label>
                    <select
                      value={automationSettings.teamsMode}
                      onChange={(event) => setAutomationSettings((current) => ({
                        ...current,
                        teamsMode: event.target.value === 'send' ? 'send' : 'off',
                      }))}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:border-transparent focus:ring-2 focus:ring-brand-500 outline-none"
                    >
                      <option value="off">Off</option>
                      <option value="send">Auto send</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">Notion Mode</label>
                    <select
                      value={automationSettings.notionMode}
                      onChange={(event) => setAutomationSettings((current) => ({
                        ...current,
                        notionMode: event.target.value === 'create' ? 'create' : 'off',
                      }))}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:border-transparent focus:ring-2 focus:ring-brand-500 outline-none"
                    >
                      <option value="off">Off</option>
                      <option value="create">Auto create page</option>
                    </select>
                  </div>

                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">Default Buffer Profile</label>
                    <select
                      value={automationSettings.bufferProfileId || ''}
                      onChange={(event) => setAutomationSettings((current) => ({
                        ...current,
                        bufferProfileId: event.target.value || null,
                      }))}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:border-transparent focus:ring-2 focus:ring-brand-500 outline-none"
                    >
                      <option value="">Use Buffer default profile</option>
                      {bufferStatus.profiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.formattedUsername || profile.serviceUsername || `${profile.service} profile`}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">Default Notion Parent Page ID</label>
                    <input
                      value={automationSettings.notionParentPageId || ''}
                      onChange={(event) => setAutomationSettings((current) => ({
                        ...current,
                        notionParentPageId: event.target.value || null,
                      }))}
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:border-transparent focus:ring-2 focus:ring-brand-500 outline-none"
                    />
                  </div>
                </div>

                <label className="mt-4 inline-flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={automationSettings.requireArtifactImage}
                    onChange={(event) => setAutomationSettings((current) => ({
                      ...current,
                      requireArtifactImage: event.target.checked,
                    }))}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  Only auto-dispatch artifacts that include an image.
                </label>

                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={handleSaveAutomationSettings}
                    disabled={savingAutomationSettings}
                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
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
        {isLinkedInModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-6"
            onClick={() => !linkedinSaving && setIsLinkedInModalOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-6">
                <h2 className="text-xl font-bold text-slate-900">{linkedinStatus.connected ? 'Update LinkedIn Credentials' : 'Connect LinkedIn'}</h2>
                <p className="mt-1 text-sm text-slate-500">{linkedinStatus.connected ? 'Replace the stored access token with a new one.' : 'Paste a LinkedIn member token with the Share on LinkedIn product and `w_member_social` scope.'}</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">Access Token</label>
                  <textarea
                    value={linkedinForm.accessToken}
                    onChange={(event) => setLinkedinForm((current) => ({ ...current, accessToken: event.target.value }))}
                    rows={4}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">Author URN (optional)</label>
                  <input
                    value={linkedinForm.authorUrn}
                    onChange={(event) => setLinkedinForm((current) => ({ ...current, authorUrn: event.target.value }))}
                    placeholder="urn:li:person:abc123"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-brand-500"
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsLinkedInModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConnectLinkedIn}
                  disabled={linkedinSaving}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                >
                  {linkedinSaving ? 'Saving...' : linkedinStatus.connected ? 'Update LinkedIn' : 'Connect LinkedIn'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
        {isBufferModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-6"
            onClick={() => !bufferSaving && setIsBufferModalOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-6">
                <h2 className="text-xl font-bold text-slate-900">{bufferStatus.connected ? 'Update Buffer Credentials' : 'Connect Buffer'}</h2>
                <p className="mt-1 text-sm text-slate-500">{bufferStatus.connected ? 'Replace the stored access token. Profiles will be refreshed.' : 'Paste a Buffer access token. We will load the connected publishing profiles for this workspace.'}</p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">Access Token</label>
                <textarea
                  value={bufferAccessToken}
                  onChange={(event) => setBufferAccessToken(event.target.value)}
                  rows={4}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsBufferModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConnectBuffer}
                  disabled={bufferSaving}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                >
                  {bufferSaving ? 'Saving...' : bufferStatus.connected ? 'Update Buffer' : 'Connect Buffer'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
        {isSlackModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-6"
            onClick={() => !slackSaving && setIsSlackModalOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-6">
                <h2 className="text-xl font-bold text-slate-900">{slackStatus.connected ? 'Update Slack Credentials' : 'Connect Slack'}</h2>
                <p className="mt-1 text-sm text-slate-500">{slackStatus.connected ? 'Replace the stored bot token and channel settings.' : 'Use a Slack bot token to allow agents to post channel updates.'}</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">Bot Token</label>
                  <textarea
                    value={slackForm.botToken}
                    onChange={(event) => setSlackForm((current) => ({ ...current, botToken: event.target.value }))}
                    rows={4}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">Default Channel (optional)</label>
                  <input
                    value={slackForm.defaultChannel}
                    onChange={(event) => setSlackForm((current) => ({ ...current, defaultChannel: event.target.value }))}
                    placeholder="#notifications"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-brand-500"
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsSlackModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConnectSlack}
                  disabled={slackSaving}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                >
                  {slackSaving ? 'Saving...' : slackStatus.connected ? 'Update Slack' : 'Connect Slack'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
        {isTeamsModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-6"
            onClick={() => !teamsSaving && setIsTeamsModalOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-6">
                <h2 className="text-xl font-bold text-slate-900">{teamsStatus.connected ? 'Update Teams Credentials' : 'Connect Microsoft Teams'}</h2>
                <p className="mt-1 text-sm text-slate-500">{teamsStatus.connected ? 'Replace the incoming webhook URL and channel name.' : 'Paste an incoming webhook URL to let agents post updates in Teams.'}</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">Incoming Webhook URL</label>
                  <textarea
                    value={teamsForm.webhookUrl}
                    onChange={(event) => setTeamsForm((current) => ({ ...current, webhookUrl: event.target.value }))}
                    rows={4}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">Channel Name (optional)</label>
                  <input
                    value={teamsForm.defaultChannelName}
                    onChange={(event) => setTeamsForm((current) => ({ ...current, defaultChannelName: event.target.value }))}
                    placeholder="Marketing Alerts"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-brand-500"
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsTeamsModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConnectTeams}
                  disabled={teamsSaving}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                >
                  {teamsSaving ? 'Saving...' : teamsStatus.connected ? 'Update Teams' : 'Connect Teams'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
        {isNotionModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-6"
            onClick={() => !notionSaving && setIsNotionModalOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-6">
                <h2 className="text-xl font-bold text-slate-900">{notionStatus.connected ? 'Update Notion Credentials' : 'Connect Notion'}</h2>
                <p className="mt-1 text-sm text-slate-500">{notionStatus.connected ? 'Replace the stored integration token and parent page settings.' : 'Use an internal integration token and optional default parent page ID.'}</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">Integration Token</label>
                  <textarea
                    value={notionForm.integrationToken}
                    onChange={(event) => setNotionForm((current) => ({ ...current, integrationToken: event.target.value }))}
                    rows={4}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">Default Parent Page ID (optional)</label>
                  <input
                    value={notionForm.defaultParentPageId}
                    onChange={(event) => setNotionForm((current) => ({ ...current, defaultParentPageId: event.target.value }))}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-brand-500"
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsNotionModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConnectNotion}
                  disabled={notionSaving}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                >
                  {notionSaving ? 'Saving...' : notionStatus.connected ? 'Update Notion' : 'Connect Notion'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
        {isHubSpotModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-6"
            onClick={() => !hubspotSaving && setIsHubSpotModalOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-6">
                <h2 className="text-xl font-bold text-slate-900">{hubspotStatus.connected ? 'Update HubSpot Credentials' : 'Connect HubSpot'}</h2>
                <p className="mt-1 text-sm text-slate-500">{hubspotStatus.connected ? 'Replace the stored private app token.' : 'Paste a private app token with CRM contacts write access.'}</p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">Private App Token</label>
                <textarea
                  value={hubspotToken}
                  onChange={(event) => setHubspotToken(event.target.value)}
                  rows={4}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsHubSpotModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConnectHubSpot}
                  disabled={hubspotSaving}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                >
                  {hubspotSaving ? 'Saving...' : hubspotStatus.connected ? 'Update HubSpot' : 'Connect HubSpot'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
        {isTwilioModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-6"
            onClick={() => !twilioSaving && setIsTwilioModalOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-6">
                <h2 className="text-xl font-bold text-slate-900">{twilioStatus.connected ? 'Update Twilio Credentials' : 'Connect Twilio SMS'}</h2>
                <p className="mt-1 text-sm text-slate-500">{twilioStatus.connected ? 'Replace the stored Twilio credentials for this workspace.' : 'Provide Twilio credentials to allow SMS notifications from this workspace.'}</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">Account SID</label>
                  <input
                    value={twilioForm.accountSid}
                    onChange={(event) => setTwilioForm((current) => ({ ...current, accountSid: event.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">Auth Token</label>
                  <input
                    type="password"
                    value={twilioForm.authToken}
                    onChange={(event) => setTwilioForm((current) => ({ ...current, authToken: event.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">From Number</label>
                  <input
                    value={twilioForm.fromNumber}
                    onChange={(event) => setTwilioForm((current) => ({ ...current, fromNumber: event.target.value }))}
                    placeholder="+15555550123"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-brand-500"
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsTwilioModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConnectTwilio}
                  disabled={twilioSaving}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                >
                  {twilioSaving ? 'Saving...' : twilioStatus.connected ? 'Update Twilio' : 'Connect Twilio'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
        {isWordPressModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-6"
            onClick={() => !wordpressSaving && setIsWordPressModalOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-6">
                <h2 className="text-xl font-bold text-slate-900">{wordpressStatus.connected ? 'Update WordPress Credentials' : 'Connect WordPress'}</h2>
                <p className="mt-1 text-sm text-slate-500">{wordpressStatus.connected ? 'Replace the stored site credentials. The site URL must match the existing connection.' : 'Use a WordPress application password to let agents save blog drafts to your site.'}</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">Site URL</label>
                  <input
                    value={wordpressForm.siteUrl}
                    onChange={(event) => setWordpressForm((current) => ({ ...current, siteUrl: event.target.value }))}
                    placeholder="https://example.com"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">Username</label>
                  <input
                    value={wordpressForm.username}
                    onChange={(event) => setWordpressForm((current) => ({ ...current, username: event.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">Application Password</label>
                  <input
                    type="password"
                    value={wordpressForm.appPassword}
                    onChange={(event) => setWordpressForm((current) => ({ ...current, appPassword: event.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-brand-500"
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsWordPressModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConnectWordPress}
                  disabled={wordpressSaving}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                >
                  {wordpressSaving ? 'Saving...' : wordpressStatus.connected ? 'Update WordPress' : 'Connect WordPress'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
