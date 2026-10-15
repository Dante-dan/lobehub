import { t } from 'i18next';

import type { ChatStore } from '@/store/chat';
import { snapshotAgentModel, snapshotAgentReasoning } from '@/store/chat/utils/snapshotAgentModel';
import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { displayMessageSelectors } from '../message/selectors';

const n = setNamespace('t');

export const createTopic = async (
  set: StoreSetter<ChatStore>,
  get: () => ChatStore,
  sessionId?: string,
): Promise<string | undefined> => {
  const { activeAgentId, internal_createTopic } = get();

  // A stale default-view cache may still contain messages owned by an old topic.
  const messages = displayMessageSelectors
    .activeDisplayMessages(get())
    .filter((message) => !message.topicId);

  set({ creatingTopic: true }, false, n('creatingTopic/start'));
  const targetSessionId = sessionId || activeAgentId;
  const modelSnapshot = snapshotAgentModel(targetSessionId);
  const reasoningSnapshot = await snapshotAgentReasoning(targetSessionId, modelSnapshot);
  const topicId = await internal_createTopic({
    ...modelSnapshot,
    ...(reasoningSnapshot ? { metadata: reasoningSnapshot } : {}),
    title: t('defaultTitle', { ns: 'topic' }),
    messages: messages.map((m) => m.id),
    sessionId: targetSessionId,
  });
  set({ creatingTopic: false }, false, n('creatingTopic/end'));

  return topicId;
};

export const saveToTopic = async (
  get: () => ChatStore,
  sessionId?: string,
): Promise<string | undefined> => {
  // if there is no message, stop
  // A stale default-view cache may still contain messages owned by an old topic.
  const messages = displayMessageSelectors
    .activeDisplayMessages(get())
    .filter((message) => !message.topicId);
  if (messages.length === 0) return;

  const { activeAgentId, summaryTopicTitle, internal_createTopic } = get();
  const targetSessionId = sessionId || activeAgentId;

  // 1. create topic and bind these messages
  const modelSnapshot = snapshotAgentModel(targetSessionId);
  const reasoningSnapshot = await snapshotAgentReasoning(targetSessionId, modelSnapshot);
  const topicId = await internal_createTopic({
    ...modelSnapshot,
    ...(reasoningSnapshot ? { metadata: reasoningSnapshot } : {}),
    title: t('defaultTitle', { ns: 'topic' }),
    messages: messages.map((m) => m.id),
    sessionId: targetSessionId,
  });

  // 2. auto summary topic Title — fire-and-forget; the title streams into the
  // row as it generates, no separate loading affordance needed.
  void summaryTopicTitle(topicId, messages).catch((error) => {
    console.error('[saveToTopic] Failed to summarize topic title:', error);
  });

  return topicId;
};
