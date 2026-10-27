// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, messages, topics, users, workspaces } from '../../../schemas';
import { FtsSearchRepo } from '../index';

const isServerDB = process.env.TEST_SERVER_DB === '1';
const db = await getTestDB();
const userId = 'fts-soft-delete-user';
const otherUserId = 'fts-soft-delete-other';
const agentId = 'fts-soft-delete-agent';
const otherAgentId = 'fts-soft-delete-other-agent';
const workspaceId = 'fts-soft-delete-workspace';
const deletedAt = new Date('2026-01-01T00:00:00.000Z');

// PGlite has no pg_search. These assertions must execute the real BM25 score projection.
describe.skipIf(!isServerDB)('pg_search nullable soft-delete predicates', () => {
  beforeEach(async () => {
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(users).where(eq(users.id, otherUserId));
    await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
    await db.insert(workspaces).values({
      id: workspaceId,
      name: 'FTS soft-delete workspace',
      primaryOwnerId: userId,
      slug: workspaceId,
    });
    await db.insert(agents).values([
      { id: agentId, title: 'Terraform agent', userId },
      { id: otherAgentId, title: 'Terraform other agent', userId },
    ]);
    await db.insert(topics).values([
      { agentId, id: 'fts-topic-null', title: 'Terraform null', userId },
      { agentId, id: 'fts-topic-false', isDeleted: false, title: 'Terraform false', userId },
      {
        agentId,
        deletedAt,
        id: 'fts-topic-trashed',
        isDeleted: true,
        title: 'Terraform trashed',
        userId,
      },
      { agentId, id: 'fts-topic-foreign', title: 'Terraform foreign', userId: otherUserId },
      { agentId, id: 'fts-topic-workspace', title: 'Terraform workspace', userId, workspaceId },
      {
        agentId: otherAgentId,
        id: 'fts-topic-other-agent',
        title: 'Terraform other agent',
        userId,
      },
      {
        agentId,
        id: 'fts-topic-visitor',
        senderId: 'share-visitor',
        title: 'Terraform visitor',
        userId,
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(users).where(eq(users.id, otherUserId));
  });

  it('scores live topics while retaining user, workspace, agent and visitor fences', async () => {
    const result = await new FtsSearchRepo(db, userId).search({
      agentId,
      limitPerType: 10,
      query: 'Terraform',
      type: 'topic',
    });

    expect(result.map((row) => row.id).sort()).toEqual(['fts-topic-false', 'fts-topic-null']);
    expect(result.every((row) => row.type === 'topic' && row.relevance > 0)).toBe(true);
  });

  it('scores live messages without returning trashed rows or hidden parent conversations', async () => {
    await db.insert(messages).values([
      { agentId, content: 'Terraform null', id: 'fts-message-null', role: 'user', userId },
      {
        agentId,
        content: 'Terraform false',
        id: 'fts-message-false',
        isDeleted: false,
        role: 'user',
        topicId: 'fts-topic-null',
        userId,
      },
      {
        agentId,
        content: 'Terraform trashed',
        deletedAt,
        id: 'fts-message-trashed',
        isDeleted: true,
        role: 'user',
        userId,
      },
      {
        agentId,
        content: 'Terraform foreign',
        id: 'fts-message-foreign',
        role: 'user',
        userId: otherUserId,
      },
      {
        agentId,
        content: 'Terraform workspace',
        id: 'fts-message-workspace',
        role: 'user',
        userId,
        workspaceId,
      },
      {
        agentId: otherAgentId,
        content: 'Terraform other agent',
        id: 'fts-message-other-agent',
        role: 'user',
        userId,
      },
      {
        agentId,
        content: 'Terraform hidden parent',
        id: 'fts-message-hidden-parent',
        role: 'user',
        topicId: 'fts-topic-trashed',
        userId,
      },
      {
        agentId,
        content: 'Terraform visitor',
        id: 'fts-message-visitor',
        role: 'user',
        topicId: 'fts-topic-visitor',
        userId,
      },
    ]);

    const result = await new FtsSearchRepo(db, userId).search({
      agentId,
      limitPerType: 10,
      query: 'Terraform',
      type: 'message',
    });

    expect(result.map((row) => row.id).sort()).toEqual(['fts-message-false', 'fts-message-null']);
    expect(result.every((row) => row.type === 'message' && row.relevance > 0)).toBe(true);
  });
});
