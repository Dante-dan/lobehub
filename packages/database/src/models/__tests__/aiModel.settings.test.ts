// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users, workspaces } from '../../schemas';
import { AiModelModel } from '../aiModel';

const db = await getTestDB();
const userId = 'batch-model-settings-user';
const workspaceId = 'batch-model-settings-workspace';

beforeEach(async () => {
  await db.insert(users).values({ id: userId });
  await db.insert(workspaces).values({
    id: workspaceId,
    name: 'Batch settings',
    primaryOwnerId: userId,
    slug: workspaceId,
  });
});

afterEach(async () => {
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await db.delete(users).where(eq(users.id, userId));
});

describe.each([undefined, workspaceId])('batch settings in scope %s', (scope) => {
  it('persists explicit settings on existing remote rows without changing other scopes', async () => {
    const model = new AiModelModel(db, userId, scope);
    const other = new AiModelModel(db, userId, scope ? undefined : workspaceId);
    const initial = { extendParams: ['reasoningEffort'] as const };
    await model.create({ id: 'remote-model', providerId: 'openai', source: 'remote' });
    await other.create({ id: 'remote-model', providerId: 'openai', settings: {} });

    await model.batchUpdateAiModels(
      'openai',
      [{ id: 'remote-model', settings: { extendParams: [...initial.extendParams] } }],
      { updateSettings: true },
    );

    expect((await model.findByIdAndProvider('remote-model', 'openai'))?.settings).toEqual(initial);
    expect((await other.findByIdAndProvider('remote-model', 'openai'))?.settings).toEqual({});
  });

  it('preserves settings during provider refresh and when omitted in a mixed edit', async () => {
    const model = new AiModelModel(db, userId, scope);
    const settings = { extendParams: ['reasoningEffort'] as 'reasoningEffort'[] };
    await model.create({ id: 'keep', providerId: 'openai', settings, source: 'remote' });
    await model.create({ id: 'clear', providerId: 'openai', settings, source: 'remote' });

    await model.batchUpdateAiModels('openai', [{ id: 'keep', settings: {} }]);
    expect((await model.findByIdAndProvider('keep', 'openai'))?.settings).toEqual(settings);

    await model.batchUpdateAiModels('openai', [{ id: 'keep' }, { id: 'clear', settings: {} }], {
      updateSettings: true,
    });
    expect((await model.findByIdAndProvider('keep', 'openai'))?.settings).toEqual(settings);
    expect((await model.findByIdAndProvider('clear', 'openai'))?.settings).toEqual({});
  });
});
