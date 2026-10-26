import { afterEach, describe, expect, it, vi } from 'vitest';

describe('WebBrowsingManifest', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it('refreshes the current date without reloading the manifest module', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 20, 23, 59, 59));

    const { WebBrowsingManifest } = await import('./manifest');

    expect(WebBrowsingManifest.systemRole).toContain('Current date: 2026-10-20');

    vi.setSystemTime(new Date(2026, 9, 21, 0, 0, 1));

    expect(WebBrowsingManifest.systemRole).toContain('Current date: 2026-10-21');

    vi.setSystemTime(new Date(2026, 9, 25, 12));

    expect(WebBrowsingManifest.systemRole).toContain('Current date: 2026-10-25');
    expect(WebBrowsingManifest.systemRole).not.toContain('Current date: 2026-10-20');
  });
});
