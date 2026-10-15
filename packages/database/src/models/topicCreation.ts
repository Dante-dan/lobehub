import type { TimingSink } from '@lobechat/utils';
import { runTimedSinkStage as runTimedStage } from '@lobechat/utils';
import { and, inArray, isNull, type SQL } from 'drizzle-orm';

import { messages, topics, type TopicItem } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload } from '../utils/workspace';
import type { CreateTopicParams } from './topic';

export const createTopicWithMessages = async (
  { db, userId, workspaceId, messageOwnership }: {
    db: LobeChatDatabase;
    userId: string;
    workspaceId?: string | null;
    messageOwnership: SQL | undefined;
  },
  { messages: messageIds, ...params }: CreateTopicParams,
  id: string,
  timing?: TimingSink,
): Promise<TopicItem> => {
    const insertData = buildWorkspacePayload(
      { userId: userId, workspaceId: workspaceId },
      {
        ...params,
        agentId: params.agentId || null,
        groupId: params.groupId || null,
        id,
        sessionId: params.sessionId || null,
      },
    );
    const insertMeta = {
      hasAgentId: !!params.agentId,
      hasGroupId: !!params.groupId,
      hasSessionId: !!params.sessionId,
    };

    if (!messageIds || messageIds.length === 0) {
      const [topic] = await runTimedStage(
        timing,
        'db.topic.create.topics.insert',
        () => db.insert(topics).values(insertData).returning(),
        insertMeta,
      );

      return topic;
    }

    return runTimedStage(
      timing,
      'db.topic.create.transaction',
      () =>
        db.transaction(async (tx) => {
          // Insert new topic
          const [topic] = await runTimedStage(
            timing,
            'db.topic.create.topics.insert',
            () => tx.insert(topics).values(insertData).returning(),
            insertMeta,
          );

          // Update associated messages' topicId
          await runTimedStage(
            timing,
            'db.topic.create.messages.updateTopic',
            () =>
              tx
                .update(messages)
                .set({ topicId: topic.id })
                // Creation adopts unbound messages; moving an existing topic's
                // messages is a separate, explicit operation. Check persisted
                // ownership here because a client's default-view cache can be stale.
                .where(
                  and(
                    messageOwnership,
                    inArray(messages.id, messageIds),
                    isNull(messages.topicId),
                  ),
                ),
            { messageCount: messageIds.length },
          );

          return topic;
        }),
      {
        hasAgentId: !!params.agentId,
        hasGroupId: !!params.groupId,
        hasSessionId: !!params.sessionId,
        messageCount: messageIds?.length ?? 0,
      },
    );
};
