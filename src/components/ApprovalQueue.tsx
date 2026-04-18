import React, { useState } from 'react';
import { CheckCircle, XCircle, Clock, Linkedin, Twitter, Instagram, Facebook, Rss, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { apiFetch } from '../services/apiClient';

type ApprovalPayload = {
  text?: string;
  link?: string;
  imageUrl?: string;
  title?: string;
  description?: string;
};

type ApprovalRequest = {
  id: number;
  workspace_id: number;
  task_id: string | null;
  agent_id: string;
  agent_name: string | null;
  action_type: string;
  payload: ApprovalPayload | null;
  status: 'pending' | 'approved' | 'rejected';
  requested_at: string;
  reviewed_at: string | null;
  rejection_reason: string | null;
};

type ApprovalQueueProps = {
  workspaceId: number;
  token: string | null;
  approvals: ApprovalRequest[];
  onApprovalChange: () => void;
  onAuthFailure: () => void;
};

const PLATFORM_META: Record<string, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  linkedin_post: { label: 'LinkedIn', icon: Linkedin, color: 'text-blue-700', bg: 'bg-blue-50' },
  buffer_post:   { label: 'Buffer',   icon: Rss,      color: 'text-orange-600', bg: 'bg-orange-50' },
  instagram_post:{ label: 'Instagram',icon: Instagram, color: 'text-pink-600',  bg: 'bg-pink-50' },
  twitter_post:  { label: 'X/Twitter',icon: Twitter,   color: 'text-stone-800', bg: 'bg-warm-100' },
  facebook_post: { label: 'Facebook', icon: Facebook,  color: 'text-blue-600',  bg: 'bg-blue-50' },
};

function getAgentInitials(agentId: string, agentName: string | null): string {
  if (agentName) return agentName.slice(0, 2).toUpperCase();
  const parts = agentId.split(/[:-]/);
  return (parts[0] || 'AG').slice(0, 2).toUpperCase();
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function ApprovalCard({
  approval,
  onApprove,
  onReject,
}: {
  approval: ApprovalRequest;
  onApprove: (id: number) => Promise<void>;
  onReject: (id: number, reason: string) => Promise<void>;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const meta = PLATFORM_META[approval.action_type] ?? {
    label: approval.action_type,
    icon: Rss,
    color: 'text-stone-600',
    bg: 'bg-warm-50',
  };
  const PlatformIcon = meta.icon;
  const text = approval.payload?.text || '';
  const imageUrl = approval.payload?.imageUrl;

  const handleApprove = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      await onApprove(approval.id);
    } catch (err: any) {
      setError(err?.message || 'Failed to approve');
      setIsSubmitting(false);
    }
  };

  const handleReject = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      await onReject(approval.id, rejectReason);
    } catch (err: any) {
      setError(err?.message || 'Failed to reject');
      setIsSubmitting(false);
    }
  };

  if (approval.status !== 'pending') return null;

  return (
    <div className="bg-white border border-warm-200 rounded-xl overflow-hidden shadow-sm">
      {/* Card Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-warm-200">
        <div className="w-8 h-8 rounded-full bg-warm-100 flex items-center justify-center text-xs font-bold text-stone-600 flex-shrink-0">
          {getAgentInitials(approval.agent_id, approval.agent_name)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-stone-800">
              {approval.agent_name || approval.agent_id.split(':')[0]}
            </span>
            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${meta.bg} ${meta.color}`}>
              <PlatformIcon className="w-3 h-3" />
              {meta.label}
            </span>
          </div>
          <p className="text-xs text-stone-400">{formatRelativeTime(approval.requested_at)}</p>
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-1 text-stone-400 hover:text-stone-600"
        >
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="px-4 py-3 space-y-3">
          {imageUrl && (
            <img
              src={imageUrl}
              alt="Post media"
              className="w-full max-h-48 object-cover rounded-lg border border-warm-200"
            />
          )}
          <p className="text-sm text-stone-700 whitespace-pre-wrap leading-relaxed">
            {text.length > 400 ? `${text.slice(0, 400)}…` : text}
          </p>
          {approval.payload?.link && (
            <p className="text-xs text-blue-600 truncate">{approval.payload.link}</p>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mx-4 mb-3 flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 px-4 pb-4">
        <button
          onClick={handleApprove}
          disabled={isSubmitting}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors min-h-[44px]"
        >
          <CheckCircle className="w-4 h-4" />
          Approve & Publish
        </button>
        <button
          onClick={() => setShowRejectModal(true)}
          disabled={isSubmitting}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-warm-100 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 text-stone-600 text-sm font-medium rounded-lg transition-colors min-h-[44px]"
        >
          <XCircle className="w-4 h-4" />
          Reject
        </button>
      </div>

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-4">
            <h3 className="font-semibold text-stone-900">Reject post?</h3>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason (optional)"
              rows={3}
              className="w-full text-sm border border-warm-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setShowRejectModal(false)}
                className="flex-1 py-2.5 text-sm text-stone-600 bg-warm-100 hover:bg-warm-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setShowRejectModal(false);
                  await handleReject();
                }}
                disabled={isSubmitting}
                className="flex-1 py-2.5 text-sm text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 rounded-lg transition-colors"
              >
                Confirm Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ApprovalQueue({
  workspaceId,
  token,
  approvals,
  onApprovalChange,
  onAuthFailure,
}: ApprovalQueueProps) {
  const pending = approvals.filter((a) => a.status === 'pending');

  const handleApprove = async (approvalId: number) => {
    await apiFetch(`/api/workspaces/${workspaceId}/approvals/${approvalId}/approve`, {
      method: 'POST',
      token,
      onAuthFailure,
    });
    onApprovalChange();
  };

  const handleReject = async (approvalId: number, reason: string) => {
    await apiFetch(`/api/workspaces/${workspaceId}/approvals/${approvalId}/reject`, {
      method: 'POST',
      token,
      onAuthFailure,
      body: JSON.stringify({ reason }),
    });
    onApprovalChange();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-5 border-b border-warm-200">
        <div className="flex items-center gap-3">
          <Clock className="w-5 h-5 text-amber-500" />
          <div>
            <h2 className="font-semibold text-stone-900">Approval Queue</h2>
            <p className="text-xs text-stone-400 mt-0.5">
              {pending.length === 0
                ? 'All caught up'
                : `${pending.length} post${pending.length === 1 ? '' : 's'} waiting for review`}
            </p>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
        {pending.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <CheckCircle className="w-10 h-10 text-emerald-400 mb-3" />
            <p className="font-medium text-stone-600">Nothing to review</p>
            <p className="text-sm text-stone-400 mt-1">
              Agent posts set to "Require Approval" will appear here.
            </p>
          </div>
        ) : (
          pending.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          ))
        )}
      </div>
    </div>
  );
}
