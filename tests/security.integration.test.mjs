import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TEST_PORT = 4312;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

let serverProcess;

async function waitForServerReady(url, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (serverProcess?.exitCode !== null) {
      throw new Error(`Server process exited early with code ${serverProcess.exitCode}`);
    }

    try {
      const res = await fetch(url);
      if (res.status < 500) {
        return;
      }
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Timed out waiting for server to start');
}

async function api(pathname, { method = 'GET', token, body } = {}) {
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (body !== undefined) headers.set('Content-Type', 'application/json');

  const res = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let payload = null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    payload = await res.json();
  } else {
    payload = await res.text();
  }

  return { res, payload };
}

async function registerUser(email, name) {
  const { res, payload } = await api('/api/auth/register', {
    method: 'POST',
    body: { email, password: 'P@ssword123!', name },
  });
  assert.equal(res.status, 200, `registration failed: ${JSON.stringify(payload)}`);
  return payload.token;
}

async function firstWorkspaceId(token) {
  const { res, payload } = await api('/api/workspaces', { token });
  assert.equal(res.status, 200, `workspace fetch failed: ${JSON.stringify(payload)}`);
  assert.ok(Array.isArray(payload) && payload.length > 0, 'expected at least one workspace');
  return payload[0].id;
}

async function me(token) {
  const { res, payload } = await api('/api/auth/me', { token });
  assert.equal(res.status, 200, `me fetch failed: ${JSON.stringify(payload)}`);
  return payload.user;
}

before(async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'aether-agents-test-'));
  const dbPath = path.join(tempDir, 'integration.db');

  serverProcess = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(TEST_PORT),
      DATABASE_PATH: dbPath,
      JWT_SECRET: 'integration-test-secret',
      APP_URL: BASE_URL,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await waitForServerReady(`${BASE_URL}/api/workspaces`);
});

after(async () => {
  if (!serverProcess) return;
  await new Promise((resolve) => {
    serverProcess.once('exit', resolve);
    serverProcess.kill('SIGTERM');
    setTimeout(() => {
      if (!serverProcess.killed) serverProcess.kill('SIGKILL');
    }, 2000);
  });
});

test('protected routes reject unauthenticated access', async () => {
  const checks = [
    '/api/workspaces',
    '/api/workspaces/1/tasks',
    '/api/workspaces/1/messages',
    '/api/workspaces/1/leads',
  ];

  for (const route of checks) {
    const { res } = await api(route);
    assert.equal(res.status, 401, `expected 401 for ${route}`);
  }
});

test('ai endpoints reject unauthenticated access', async () => {
  const respond = await api('/api/workspaces/1/ai/respond', {
    method: 'POST',
    body: {
      role: 'Executive Assistant',
      message: 'Hello',
    },
  });
  assert.equal(respond.res.status, 401);

  const orchestrate = await api('/api/workspaces/1/ai/orchestrate', {
    method: 'POST',
    body: {
      taskDescription: 'Do work',
      agents: ['executive-assistant'],
    },
  });
  assert.equal(orchestrate.res.status, 401);
});

test('workspace isolation blocks cross-tenant data access', async () => {
  const tokenA = await registerUser('isolation-a@example.com', 'Isolation A');
  const wsA = await firstWorkspaceId(tokenA);

  const createLead = await api(`/api/workspaces/${wsA}/leads`, {
    method: 'POST',
    token: tokenA,
    body: {
      name: 'Tenant A Lead',
      company: 'Tenant A Co',
      email: 'lead-a@example.com',
      status: 'New Lead',
    },
  });
  assert.equal(createLead.res.status, 200, `lead creation failed: ${JSON.stringify(createLead.payload)}`);

  const tokenB = await registerUser('isolation-b@example.com', 'Isolation B');
  const wsB = await firstWorkspaceId(tokenB);

  const aLeads = await api(`/api/workspaces/${wsA}/leads`, { token: tokenA });
  assert.equal(aLeads.res.status, 200);
  assert.ok(Array.isArray(aLeads.payload));
  assert.ok(aLeads.payload.some((lead) => lead.name === 'Tenant A Lead'));

  const bToA = await api(`/api/workspaces/${wsA}/leads`, { token: tokenB });
  assert.equal(bToA.res.status, 403, `expected 403 when tenant B requests tenant A leads`);

  const aToBTasks = await api(`/api/workspaces/${wsB}/tasks`, { token: tokenA });
  assert.equal(aToBTasks.res.status, 403, `expected 403 when tenant A requests tenant B tasks`);
});

test('validation rejects malformed task, message, and agent updates', async () => {
  const token = await registerUser('validation@example.com', 'Validation User');
  const workspaceId = await firstWorkspaceId(token);

  const badTaskCreate = await api(`/api/workspaces/${workspaceId}/tasks`, {
    method: 'POST',
    token,
    body: { description: 'missing title and assignee' },
  });
  assert.equal(badTaskCreate.res.status, 400);

  const badMessageCreate = await api(`/api/workspaces/${workspaceId}/messages`, {
    method: 'POST',
    token,
    body: {
      agentId: 'placeholder-agent-id',
      senderId: 'user',
      senderName: 'Validation User',
      content: 'hello',
      type: 'not-a-valid-type',
    },
  });
  assert.equal(badMessageCreate.res.status, 400);

  const badAgentPatch = await api(`/api/workspaces/${workspaceId}/agents/placeholder-agent-id`, {
    method: 'PATCH',
    token,
    body: { status: 'unknown-status' },
  });
  assert.equal(badAgentPatch.res.status, 400);
});

test('rbac blocks member from admin-only workspace mutations', async () => {
  const ownerToken = await registerUser('rbac-owner@example.com', 'RBAC Owner');
  const workspaceId = await firstWorkspaceId(ownerToken);

  const ownerAgents = await api(`/api/workspaces/${workspaceId}/agents`, { token: ownerToken });
  assert.equal(ownerAgents.res.status, 200, `agents fetch failed: ${JSON.stringify(ownerAgents.payload)}`);
  assert.ok(Array.isArray(ownerAgents.payload) && ownerAgents.payload.length > 0, 'expected seeded agents');
  const assigneeId = ownerAgents.payload[0].id;

  const memberToken = await registerUser('rbac-member@example.com', 'RBAC Member');
  const memberUser = await me(memberToken);

  const addMember = await api(`/api/workspaces/${workspaceId}/members`, {
    method: 'POST',
    token: ownerToken,
    body: {
      email: memberUser.email,
      role: 'member',
    },
  });
  assert.equal(addMember.res.status, 200, `add member failed: ${JSON.stringify(addMember.payload)}`);

  const memberTaskCreate = await api(`/api/workspaces/${workspaceId}/tasks`, {
    method: 'POST',
    token: memberToken,
    body: {
      title: 'Member should not create this',
      assigneeId,
    },
  });
  assert.equal(memberTaskCreate.res.status, 403);

  const memberLeadCreate = await api(`/api/workspaces/${workspaceId}/leads`, {
    method: 'POST',
    token: memberToken,
    body: {
      name: 'Not Allowed Lead',
      company: 'Blocked Co',
    },
  });
  assert.equal(memberLeadCreate.res.status, 403);

  const memberAgentPatch = await api(`/api/workspaces/${workspaceId}/agents/executive-assistant:${workspaceId}`, {
    method: 'PATCH',
    token: memberToken,
    body: { status: 'running' },
  });
  assert.equal(memberAgentPatch.res.status, 403);

  const ownerTaskCreate = await api(`/api/workspaces/${workspaceId}/tasks`, {
    method: 'POST',
    token: ownerToken,
    body: {
      title: 'Owner can create',
      assigneeId,
    },
  });
  assert.equal(ownerTaskCreate.res.status, 200, `owner task create failed: ${JSON.stringify(ownerTaskCreate.payload)}`);
});

test('ai validation rejects oversized payloads before model invocation', async () => {
  const token = await registerUser('ai-validation@example.com', 'AI Validation');
  const workspaceId = await firstWorkspaceId(token);

  const tooLongMessage = 'x'.repeat(4001);
  const oversizedRespond = await api(`/api/workspaces/${workspaceId}/ai/respond`, {
    method: 'POST',
    token,
    body: {
      role: 'Executive Assistant',
      message: tooLongMessage,
    },
  });
  assert.equal(oversizedRespond.res.status, 400);

  const tooLongTaskDescription = 'y'.repeat(2001);
  const oversizedOrchestrate = await api(`/api/workspaces/${workspaceId}/ai/orchestrate`, {
    method: 'POST',
    token,
    body: {
      taskDescription: tooLongTaskDescription,
      agents: ['executive-assistant'],
    },
  });
  assert.equal(oversizedOrchestrate.res.status, 400);
});

test('media CRUD and task selected-media patch work end to end', async () => {
  const ownerToken = await registerUser('media-owner@example.com', 'Media Owner');
  const workspaceId = await firstWorkspaceId(ownerToken);

  const ownerAgents = await api(`/api/workspaces/${workspaceId}/agents`, { token: ownerToken });
  assert.equal(ownerAgents.res.status, 200, `agents fetch failed: ${JSON.stringify(ownerAgents.payload)}`);
  assert.ok(Array.isArray(ownerAgents.payload) && ownerAgents.payload.length > 0, 'expected seeded agents');
  const assigneeId = ownerAgents.payload[0].id;

  const createTask = await api(`/api/workspaces/${workspaceId}/tasks`, {
    method: 'POST',
    token: ownerToken,
    body: {
      title: 'Attach media to this task',
      description: 'Task for media linkage validation',
      assigneeId,
      dueDate: '2026-03-14T09:00:00.000Z',
      repeat: '',
    },
  });
  assert.equal(createTask.res.status, 200, `task create failed: ${JSON.stringify(createTask.payload)}`);
  const taskId = createTask.payload.id;

  const createMedia = await api(`/api/workspaces/${workspaceId}/media`, {
    method: 'POST',
    token: ownerToken,
    body: {
      name: 'Hero creative',
      type: 'image',
      category: 'uploads',
      thumbnail: 'https://cdn.example.com/media/hero.png',
      size: '120 KB',
    },
  });
  assert.equal(createMedia.res.status, 200, `media create failed: ${JSON.stringify(createMedia.payload)}`);
  assert.equal(typeof createMedia.payload.id, 'number');
  const mediaId = createMedia.payload.id;

  const listMedia = await api(`/api/workspaces/${workspaceId}/media`, { token: ownerToken });
  assert.equal(listMedia.res.status, 200);
  assert.ok(Array.isArray(listMedia.payload));
  assert.ok(listMedia.payload.some((asset) => asset.id === mediaId));

  const setSelectedMedia = await api(`/api/workspaces/${workspaceId}/tasks/${encodeURIComponent(taskId)}/selected-media`, {
    method: 'PATCH',
    token: ownerToken,
    body: { selectedMediaAssetId: mediaId },
  });
  assert.equal(setSelectedMedia.res.status, 200, `selected media patch failed: ${JSON.stringify(setSelectedMedia.payload)}`);
  assert.deepEqual(setSelectedMedia.payload, { success: true, selectedMediaAssetId: mediaId });

  const tasksAfterSet = await api(`/api/workspaces/${workspaceId}/tasks`, { token: ownerToken });
  assert.equal(tasksAfterSet.res.status, 200);
  const updatedTask = tasksAfterSet.payload.find((task) => task.id === taskId);
  assert.ok(updatedTask, 'expected created task to exist');
  assert.equal(updatedTask.selectedMediaAssetId, mediaId);

  const deleteMedia = await api(`/api/workspaces/${workspaceId}/media/${mediaId}`, {
    method: 'DELETE',
    token: ownerToken,
  });
  assert.equal(deleteMedia.res.status, 200, `media delete failed: ${JSON.stringify(deleteMedia.payload)}`);

  const tasksAfterDelete = await api(`/api/workspaces/${workspaceId}/tasks`, { token: ownerToken });
  assert.equal(tasksAfterDelete.res.status, 200);
  const taskAfterDelete = tasksAfterDelete.payload.find((task) => task.id === taskId);
  assert.ok(taskAfterDelete, 'expected task to still exist after media delete');
  assert.equal(taskAfterDelete.selectedMediaAssetId, null);
});

test('automation settings enforce validation and RBAC', async () => {
  const ownerToken = await registerUser('automation-owner@example.com', 'Automation Owner');
  const workspaceId = await firstWorkspaceId(ownerToken);

  const defaultSettings = await api(`/api/workspaces/${workspaceId}/automation-settings`, { token: ownerToken });
  assert.equal(defaultSettings.res.status, 200);
  assert.deepEqual(defaultSettings.payload, {
    linkedinMode: 'off',
    bufferMode: 'off',
    teamsMode: 'off',
    notionMode: 'off',
    bufferProfileId: null,
    notionParentPageId: null,
    requireArtifactImage: false,
  });

  const invalidSettings = await api(`/api/workspaces/${workspaceId}/automation-settings`, {
    method: 'PUT',
    token: ownerToken,
    body: {
      linkedinMode: 'queue',
      bufferMode: 'queue',
    },
  });
  assert.equal(invalidSettings.res.status, 400);

  const validSettings = await api(`/api/workspaces/${workspaceId}/automation-settings`, {
    method: 'PUT',
    token: ownerToken,
    body: {
      linkedinMode: 'publish',
      bufferMode: 'queue',
      teamsMode: 'send',
      notionMode: 'create',
      bufferProfileId: 'profile-42',
      notionParentPageId: 'parent-page-42',
      requireArtifactImage: true,
    },
  });
  assert.equal(validSettings.res.status, 200, `automation update failed: ${JSON.stringify(validSettings.payload)}`);
  assert.deepEqual(validSettings.payload, {
    linkedinMode: 'publish',
    bufferMode: 'queue',
    teamsMode: 'send',
    notionMode: 'create',
    bufferProfileId: 'profile-42',
    notionParentPageId: 'parent-page-42',
    requireArtifactImage: true,
  });

  const memberToken = await registerUser('automation-member@example.com', 'Automation Member');
  const memberUser = await me(memberToken);

  const addMember = await api(`/api/workspaces/${workspaceId}/members`, {
    method: 'POST',
    token: ownerToken,
    body: {
      email: memberUser.email,
      role: 'member',
    },
  });
  assert.equal(addMember.res.status, 200, `add member failed: ${JSON.stringify(addMember.payload)}`);

  const memberRead = await api(`/api/workspaces/${workspaceId}/automation-settings`, { token: memberToken });
  assert.equal(memberRead.res.status, 200);
  assert.equal(memberRead.payload.linkedinMode, 'publish');

  const memberWrite = await api(`/api/workspaces/${workspaceId}/automation-settings`, {
    method: 'PUT',
    token: memberToken,
    body: {
      linkedinMode: 'off',
      bufferMode: 'off',
      teamsMode: 'off',
      notionMode: 'off',
      bufferProfileId: null,
      notionParentPageId: null,
      requireArtifactImage: false,
    },
  });
  assert.equal(memberWrite.res.status, 403);
});

test('task automation logs endpoint is accessible to workspace members', async () => {
  const ownerToken = await registerUser('automation-logs-owner@example.com', 'Automation Logs Owner');
  const workspaceId = await firstWorkspaceId(ownerToken);

  const ownerAgents = await api(`/api/workspaces/${workspaceId}/agents`, { token: ownerToken });
  assert.equal(ownerAgents.res.status, 200, `agents fetch failed: ${JSON.stringify(ownerAgents.payload)}`);
  assert.ok(Array.isArray(ownerAgents.payload) && ownerAgents.payload.length > 0, 'expected seeded agents');
  const assigneeId = ownerAgents.payload[0].id;

  const createTask = await api(`/api/workspaces/${workspaceId}/tasks`, {
    method: 'POST',
    token: ownerToken,
    body: {
      title: 'Automation logs visibility task',
      description: 'Validate logs endpoint accessibility',
      assigneeId,
      dueDate: '2026-03-14T09:00:00.000Z',
      repeat: '',
    },
  });
  assert.equal(createTask.res.status, 200, `task create failed: ${JSON.stringify(createTask.payload)}`);
  const taskId = createTask.payload.id;

  const ownerRead = await api(`/api/workspaces/${workspaceId}/tasks/${encodeURIComponent(taskId)}/automation-logs`, {
    token: ownerToken,
  });
  assert.equal(ownerRead.res.status, 200);
  assert.ok(Array.isArray(ownerRead.payload));

  const memberToken = await registerUser('automation-logs-member@example.com', 'Automation Logs Member');
  const memberUser = await me(memberToken);

  const addMember = await api(`/api/workspaces/${workspaceId}/members`, {
    method: 'POST',
    token: ownerToken,
    body: {
      email: memberUser.email,
      role: 'member',
    },
  });
  assert.equal(addMember.res.status, 200, `add member failed: ${JSON.stringify(addMember.payload)}`);

  const memberRead = await api(`/api/workspaces/${workspaceId}/tasks/${encodeURIComponent(taskId)}/automation-logs`, {
    token: memberToken,
  });
  assert.equal(memberRead.res.status, 200);
  assert.ok(Array.isArray(memberRead.payload));
});

test('task automation retry endpoint enforces role and task artifact requirements', async () => {
  const ownerToken = await registerUser('automation-retry-owner@example.com', 'Automation Retry Owner');
  const workspaceId = await firstWorkspaceId(ownerToken);

  const ownerAgents = await api(`/api/workspaces/${workspaceId}/agents`, { token: ownerToken });
  assert.equal(ownerAgents.res.status, 200, `agents fetch failed: ${JSON.stringify(ownerAgents.payload)}`);
  assert.ok(Array.isArray(ownerAgents.payload) && ownerAgents.payload.length > 0, 'expected seeded agents');
  const assigneeId = ownerAgents.payload[0].id;

  const createTask = await api(`/api/workspaces/${workspaceId}/tasks`, {
    method: 'POST',
    token: ownerToken,
    body: {
      title: 'Automation retry validation task',
      description: 'No artifact should return validation error',
      assigneeId,
      dueDate: '2026-03-14T09:00:00.000Z',
      repeat: '',
    },
  });
  assert.equal(createTask.res.status, 200, `task create failed: ${JSON.stringify(createTask.payload)}`);
  const taskId = createTask.payload.id;

  const ownerRetryNoArtifact = await api(`/api/workspaces/${workspaceId}/tasks/${encodeURIComponent(taskId)}/automation-retry`, {
    method: 'POST',
    token: ownerToken,
  });
  assert.equal(ownerRetryNoArtifact.res.status, 400);
  assert.deepEqual(ownerRetryNoArtifact.payload, { error: 'Task artifact not found' });

  const ownerRetryMissingTask = await api(`/api/workspaces/${workspaceId}/tasks/${encodeURIComponent('missing-task')}/automation-retry`, {
    method: 'POST',
    token: ownerToken,
  });
  assert.equal(ownerRetryMissingTask.res.status, 404);
  assert.deepEqual(ownerRetryMissingTask.payload, { error: 'Task not found' });

  const memberToken = await registerUser('automation-retry-member@example.com', 'Automation Retry Member');
  const memberUser = await me(memberToken);

  const addMember = await api(`/api/workspaces/${workspaceId}/members`, {
    method: 'POST',
    token: ownerToken,
    body: {
      email: memberUser.email,
      role: 'member',
    },
  });
  assert.equal(addMember.res.status, 200, `add member failed: ${JSON.stringify(addMember.payload)}`);

  const memberRetry = await api(`/api/workspaces/${workspaceId}/tasks/${encodeURIComponent(taskId)}/automation-retry`, {
    method: 'POST',
    token: memberToken,
  });
  assert.equal(memberRetry.res.status, 403);
});

test('agent skill capabilities can be updated by owner and blocked for members', async () => {
  const ownerToken = await registerUser('skills-owner@example.com', 'Skills Owner');
  const workspaceId = await firstWorkspaceId(ownerToken);

  const ownerAgents = await api(`/api/workspaces/${workspaceId}/agents`, { token: ownerToken });
  assert.equal(ownerAgents.res.status, 200, `agents fetch failed: ${JSON.stringify(ownerAgents.payload)}`);
  assert.ok(Array.isArray(ownerAgents.payload) && ownerAgents.payload.length > 0, 'expected seeded agents');
  const targetAgentId = ownerAgents.payload[0].id;

  const ownerUpdate = await api(`/api/workspaces/${workspaceId}/agents/${encodeURIComponent(targetAgentId)}`, {
    method: 'PATCH',
    token: ownerToken,
    body: {
      capabilities: ['SEO Strategy', 'Campaign Analytics', 'A/B Testing'],
    },
  });
  assert.equal(ownerUpdate.res.status, 200, `owner capability update failed: ${JSON.stringify(ownerUpdate.payload)}`);

  const ownerAgentsAfter = await api(`/api/workspaces/${workspaceId}/agents`, { token: ownerToken });
  assert.equal(ownerAgentsAfter.res.status, 200);
  const updatedAgent = ownerAgentsAfter.payload.find((agent) => agent.id === targetAgentId);
  assert.ok(updatedAgent, 'expected updated agent to be returned');
  assert.deepEqual(updatedAgent.capabilities, ['SEO Strategy', 'Campaign Analytics', 'A/B Testing']);

  const memberToken = await registerUser('skills-member@example.com', 'Skills Member');
  const memberUser = await me(memberToken);

  const addMember = await api(`/api/workspaces/${workspaceId}/members`, {
    method: 'POST',
    token: ownerToken,
    body: {
      email: memberUser.email,
      role: 'member',
    },
  });
  assert.equal(addMember.res.status, 200, `add member failed: ${JSON.stringify(addMember.payload)}`);

  const memberUpdate = await api(`/api/workspaces/${workspaceId}/agents/${encodeURIComponent(targetAgentId)}`, {
    method: 'PATCH',
    token: memberToken,
    body: {
      capabilities: ['Should Not Persist'],
    },
  });
  assert.equal(memberUpdate.res.status, 403);
});

test('agent personality updates reject near-duplicate profiles within a workspace', async () => {
  const ownerToken = await registerUser('personality-owner@example.com', 'Personality Owner');
  const workspaceId = await firstWorkspaceId(ownerToken);

  const ownerAgents = await api(`/api/workspaces/${workspaceId}/agents`, { token: ownerToken });
  assert.equal(ownerAgents.res.status, 200, `agents fetch failed: ${JSON.stringify(ownerAgents.payload)}`);
  assert.ok(Array.isArray(ownerAgents.payload) && ownerAgents.payload.length > 1, 'expected seeded agents');

  const salesAgent = ownerAgents.payload.find((agent) => agent.role === 'Sales Associate');
  const blogAgent = ownerAgents.payload.find((agent) => agent.role === 'Blog Writer');
  assert.ok(salesAgent, 'expected seeded sales agent');
  assert.ok(blogAgent, 'expected seeded blog agent');

  const duplicateLikeUpdate = await api(`/api/workspaces/${workspaceId}/agents/${encodeURIComponent(blogAgent.id)}`, {
    method: 'PATCH',
    token: ownerToken,
    body: {
      personality: {
        tone: 'direct',
        communicationStyle: 'concise',
        assertiveness: 'high',
        humor: 'light',
        verbosity: 'short',
        signaturePhrase: 'Ready to move this forward with the next best step?',
        doNots: ['Do not bury call-to-action', 'Do not use passive asks'],
      },
    },
  });
  assert.equal(duplicateLikeUpdate.res.status, 409);
  assert.deepEqual(duplicateLikeUpdate.payload, {
    error: 'Personality profile must be meaningfully distinct across agents in this workspace',
  });

  const agentsAfterReject = await api(`/api/workspaces/${workspaceId}/agents`, { token: ownerToken });
  assert.equal(agentsAfterReject.res.status, 200);
  const unchangedBlogAgent = agentsAfterReject.payload.find((agent) => agent.id === blogAgent.id);
  assert.ok(unchangedBlogAgent, 'expected updated agent list to contain blog agent');
  assert.equal(unchangedBlogAgent.personality.tone, blogAgent.personality.tone);
  assert.equal(unchangedBlogAgent.personality.communicationStyle, blogAgent.personality.communicationStyle);
});

test('agent prompt versions endpoint is readable by workspace members', async () => {
  const ownerToken = await registerUser('prompt-versions-owner@example.com', 'Prompt Versions Owner');
  const workspaceId = await firstWorkspaceId(ownerToken);

  const ownerAgents = await api(`/api/workspaces/${workspaceId}/agents`, { token: ownerToken });
  assert.equal(ownerAgents.res.status, 200, `agents fetch failed: ${JSON.stringify(ownerAgents.payload)}`);
  assert.ok(Array.isArray(ownerAgents.payload) && ownerAgents.payload.length > 0, 'expected seeded agents');
  const targetAgentId = ownerAgents.payload[0].id;

  const ownerUpdate = await api(`/api/workspaces/${workspaceId}/agents/${encodeURIComponent(targetAgentId)}`, {
    method: 'PATCH',
    token: ownerToken,
    body: {
      capabilities: ['Prompt History Skill'],
    },
  });
  assert.equal(ownerUpdate.res.status, 200, `owner capability update failed: ${JSON.stringify(ownerUpdate.payload)}`);

  const ownerRead = await api(`/api/workspaces/${workspaceId}/agents/${encodeURIComponent(targetAgentId)}/prompt-versions`, {
    token: ownerToken,
  });
  assert.equal(ownerRead.res.status, 200);
  assert.ok(Array.isArray(ownerRead.payload));
  assert.ok(ownerRead.payload.length >= 1);

  const memberToken = await registerUser('prompt-versions-member@example.com', 'Prompt Versions Member');
  const memberUser = await me(memberToken);

  const addMember = await api(`/api/workspaces/${workspaceId}/members`, {
    method: 'POST',
    token: ownerToken,
    body: {
      email: memberUser.email,
      role: 'member',
    },
  });
  assert.equal(addMember.res.status, 200, `add member failed: ${JSON.stringify(addMember.payload)}`);

  const memberRead = await api(`/api/workspaces/${workspaceId}/agents/${encodeURIComponent(targetAgentId)}/prompt-versions`, {
    token: memberToken,
  });
  assert.equal(memberRead.res.status, 200);
  assert.ok(Array.isArray(memberRead.payload));
});

test('integrations health endpoint is readable by workspace members', async () => {
  const ownerToken = await registerUser('integrations-health-owner@example.com', 'Integrations Health Owner');
  const workspaceId = await firstWorkspaceId(ownerToken);

  const ownerRead = await api(`/api/workspaces/${workspaceId}/integrations/health`, {
    token: ownerToken,
  });
  assert.equal(ownerRead.res.status, 200);
  assert.equal(typeof ownerRead.payload, 'object');
  assert.equal(typeof ownerRead.payload.services, 'object');
  assert.equal(typeof ownerRead.payload.automation, 'object');

  const memberToken = await registerUser('integrations-health-member@example.com', 'Integrations Health Member');
  const memberUser = await me(memberToken);

  const addMember = await api(`/api/workspaces/${workspaceId}/members`, {
    method: 'POST',
    token: ownerToken,
    body: {
      email: memberUser.email,
      role: 'member',
    },
  });
  assert.equal(addMember.res.status, 200, `add member failed: ${JSON.stringify(addMember.payload)}`);

  const memberRead = await api(`/api/workspaces/${workspaceId}/integrations/health`, {
    token: memberToken,
  });
  assert.equal(memberRead.res.status, 200);
  assert.equal(typeof memberRead.payload, 'object');
  assert.equal(typeof memberRead.payload.services, 'object');
});
