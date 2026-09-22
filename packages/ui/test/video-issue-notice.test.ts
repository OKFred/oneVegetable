import { describe, expect, it, vi } from 'vitest';
import { toast } from 'vue-sonner';
import { notifyVideoDifferences } from '../src/lib/video-issue-notice';
vi.mock('vue-sonner', () => ({ toast: { info: vi.fn() } }));
describe('video compatibility notice', () => {
  it('shows a tolerated missing code once per session, without discarding other diagnostics', () => {
    const issues = ['result/msg_code:not-returned', 'items/1:invalid-id'];
    notifyVideoDifferences(issues, 'Compatible difference');
    notifyVideoDifferences(issues, 'Compatible difference');
    expect(toast.info).toHaveBeenCalledExactlyOnceWith('Compatible difference');
    expect(issues).toEqual(['result/msg_code:not-returned', 'items/1:invalid-id']);
  });
});
