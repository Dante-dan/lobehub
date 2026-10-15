import { DEFAULT_MODEL, DEFAULT_PROVIDER } from '@lobechat/business-const';
import { TOPIC_TITLE_JSON_SCHEMA } from '@lobechat/prompts';
import type { LobeUser, UIChatMessage } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import { toast } from '@lobehub/ui/base-ui';
import { act, renderHook, waitFor } from '@testing-library/react';
import { type Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOADING_FLAT } from '@/const/message';
import { cacheScope, REPLICA_INDEX_KEY, replicaKeys } from '@/libs/replica';
import { mutate } from '@/libs/swr';
import { aiAgentService } from '@/services/aiAgent';
import { aiChatService } from '@/services/aiChat';
import { chatService } from '@/services/chat';
import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';
import { useAgentStore } from '@/store/agent';
import { useAiInfraStore } from '@/store/aiInfra';
import { aiModelSelectors } from '@/store/aiInfra/slices/aiModel/selectors';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import type { TOPIC_VISIBLY_RUNNING_OPERATION_TYPES } from '@/store/chat/slices/operation/types';
import { SETTLEABLE_TOPIC_RUN_OPERATION_TYPES } from '@/store/chat/slices/operation/types';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';
import { useSessionStore } from '@/store/session';
import { useUserStore } from '@/store/user';
import { type ChatTopic } from '@/types/topic';

import { useChatStore } from '../../store';
import { topicListResource } from './projection';

// Revalidation is narrowed to the active identity scope.
const topicListSyncKey = (containerKey: string, scope = cacheScope.get()) =>
  replicaKeys.sync(topicListResource.name, topicListResource.version, scope, containerKey, {
    pageSize: 20,
  });

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => {
  const actual = await importOriginal<{ toast: Record<string, unknown> }>();
  return { ...actual, toast: { ...actual.toast, error: vi.fn() } };
});

// Mock @/libs/swr mutate
vi.mock('@/libs/swr', async () => {
  const actual = await vi.importActual('@/libs/swr');
  return {
    ...actual,
    mutate: vi.fn(),
  };
});

vi.mock('swr', async () => {
  const actual = await vi.importActual('swr');
  return {
    ...(actual as any),
    mutate: vi.fn(),
  };
});

// Mock topicService 和 messageService
vi.mock('@/services/topic', () => ({
  topicService: {
    removeTopics: vi.fn(),
    removeTopicsByAgentId: vi.fn(),
    removeTopicsByGroupId: vi.fn(),
    removeAllTopic: vi.fn(),
    removeTopic: vi.fn(),
    cloneTopic: vi.fn(),
    createTopic: vi.fn(),
    forkTopic: vi.fn(),
    updateTopicFavorite: vi.fn(),
    updateTopicMetadata: vi.fn(),
    updateTopicModel: vi.fn(),
    updateTopicTitle: vi.fn(),
    updateTopic: vi.fn(),
    batchRemoveTopics: vi.fn(),
    getTopicDetail: vi.fn(),
    getTopics: vi.fn(),
    queryTopics: vi.fn(),
    searchTopics: vi.fn(),
  },
}));

vi.mock('@/services/message', () => ({
  messageService: {
    removeMessages: vi.fn(),
    removeMessagesByAssistant: vi.fn(),
    getMessages: vi.fn(),
  },
}));

vi.mock('i18next', () => ({
  t: vi.fn((key, params) => (params.title ? key + '_' + params.title : key)),
}));

beforeEach(() => {
  // Setup initial state and mocks before each test
  vi.clearAllMocks();
  useChatStore.setState(
    {
      activeAgentId: undefined,
      activeGroupId: undefined,
      activeTopicId: undefined,
      agentTopicsViewMap: {},
      queuedMessages: {},
      searchTopics: [],
      topicDataMap: {},
      topicDetailMap: {},
      // ... initial state
    },
    false,
  );
  useAgentStore.setState({ agentDocumentsMap: {} });
  useUserStore.setState({ user: { id: 'user-1' } as LobeUser });
  useSessionStore.setState(
    {
      activeId: 'inbox',
      defaultSessions: [],
      pinnedSessions: [],
      sessions: [],
      isSessionsFirstFetchFinished: false,
    },
    false,
  );
});

afterEach(() => {
  // Cleanup mocks after each test
  vi.restoreAllMocks();
});

describe('topic creation', () => {
  describe('saveToTopic', () => {
    it('should not create a topic if there are no messages', async () => {
      const { result } = renderHook(() => useChatStore());
      act(() => {
        useChatStore.setState({
          messagesMap: {
            [messageMapKey({ agentId: 'session' })]: [],
          },
          activeAgentId: 'session',
        });
      });

      const createTopicSpy = vi.spyOn(topicService, 'createTopic');

      const topicId = await result.current.saveToTopic();

      expect(createTopicSpy).not.toHaveBeenCalled();
      expect(topicId).toBeUndefined();
    });

    it('should create a topic and bind messages to it', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [{ id: 'message1' }, { id: 'message2' }] as UIChatMessage[];
      act(() => {
        useChatStore.setState({
          messagesMap: {
            [messageMapKey({ agentId: 'session-id' })]: messages,
          },
          activeAgentId: 'session-id',
        });
      });

      const createTopicSpy = vi
        .spyOn(topicService, 'createTopic')
        .mockResolvedValue('new-topic-id');

      const topicId = await result.current.saveToTopic();

      expect(createTopicSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-id',
          messages: messages.map((m) => m.id),
        }),
      );
      expect(topicId).toEqual('new-topic-id');
    });

    it.each(['createTopic', 'saveToTopic'] as const)(
      '%s should exclude messages already owned by a topic from a stale default view',
      async (action) => {
        const oldMessage = { id: 'old-message', topicId: 'old-topic' } as UIChatMessage;
        const newMessage = { id: 'new-message', topicId: null } as UIChatMessage;
        const { result } = renderHook(() => useChatStore());
        act(() => {
          useChatStore.setState({
            activeAgentId: 'session-id',
            messagesMap: {
              [messageMapKey({ agentId: 'session-id' })]: [oldMessage, newMessage],
            },
          });
        });
        const createSpy = vi
          .spyOn(result.current, 'internal_createTopic')
          .mockResolvedValue('new-topic');
        const summarySpy = vi
          .spyOn(result.current, 'summaryTopicTitle')
          .mockResolvedValue(undefined);

        await result.current[action]();

        expect(createSpy).toHaveBeenCalledWith(
          expect.objectContaining({ messages: ['new-message'] }),
        );
        if (action === 'saveToTopic') {
          expect(summarySpy).toHaveBeenCalledWith('new-topic', [newMessage]);
        }
      },
    );

    it('should fire the title summary without blocking saveToTopic', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [{ id: 'message1' }, { id: 'message2' }] as UIChatMessage[];
      let resolveSummary!: () => void;
      const summaryPromise = new Promise<void>((resolve) => {
        resolveSummary = resolve;
      });

      act(() => {
        useChatStore.setState({
          activeAgentId: 'session-id',
          messagesMap: {
            [messageMapKey({ agentId: 'session-id' })]: messages,
          },
        });
      });

      vi.spyOn(result.current, 'internal_createTopic').mockResolvedValue('new-topic-id');
      const summarySpy = vi
        .spyOn(result.current, 'summaryTopicTitle')
        .mockReturnValue(summaryPromise);

      await act(async () => {
        // Resolves before the summary settles — the summary is fire-and-forget.
        await result.current.saveToTopic();
      });

      expect(summarySpy).toHaveBeenCalledWith('new-topic-id', messages);

      await act(async () => {
        resolveSummary();
        await summaryPromise;
      });
    });

    it('binds a deferred new topic to the staged project directory', async () => {
      // ROOT CAUSE: "+" on a project group defers the row to the first message.
      // Creating it with only the working-directory path left the topic outside
      // its project — missing from the project list, mis-grouped in the sidebar
      // and skipping the project-directory execution routing. The staged
      // directory must ride along on the create call.
      const { result } = renderHook(() => useChatStore());
      const messages = [{ id: 'message1' }] as UIChatMessage[];
      act(() => {
        useChatStore.setState({
          activeAgentId: 'session-id',
          messagesMap: {
            [messageMapKey({ agentId: 'session-id' })]: messages,
          },
          pendingNewTopicDirectory: {
            agentId: 'session-id',
            projectWorkingDirectoryId: 'binding-1',
          },
        });
      });

      const createTopicSpy = vi
        .spyOn(topicService, 'createTopic')
        .mockResolvedValue('new-topic-id');

      await result.current.saveToTopic();

      expect(createTopicSpy).toHaveBeenCalledWith(
        expect.objectContaining({ projectWorkingDirectoryId: 'binding-1' }),
      );
      // Consumed, so it cannot leak onto a later, unrelated topic.
      expect(useChatStore.getState().pendingNewTopicDirectory).toBeUndefined();
    });

    it('does not apply a staged directory that belongs to another agent', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [{ id: 'message1' }] as UIChatMessage[];
      act(() => {
        useChatStore.setState({
          activeAgentId: 'session-id',
          messagesMap: {
            [messageMapKey({ agentId: 'session-id' })]: messages,
          },
          pendingNewTopicDirectory: {
            agentId: 'another-agent',
            projectWorkingDirectoryId: 'binding-1',
          },
        });
      });

      const createTopicSpy = vi
        .spyOn(topicService, 'createTopic')
        .mockResolvedValue('new-topic-id');

      await result.current.saveToTopic();

      expect(createTopicSpy).toHaveBeenCalledWith(
        expect.not.objectContaining({ projectWorkingDirectoryId: expect.anything() }),
      );
    });
  });
});
