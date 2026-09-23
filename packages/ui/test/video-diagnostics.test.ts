import { describe, expect, it } from 'vitest';
import issues from '../../../mock/data/video/compatibility-issues.json';
import { visibleVideoIssues } from '../src/lib/video-diagnostics';

describe('video diagnostics visibility', () => {
  it('hides accepted omissions while retaining unexpected diagnostics and the original response', () => {
    expect(visibleVideoIssues(issues.accepted)).toEqual([]);
    expect(visibleVideoIssues(issues.mixed)).toEqual(['items/1:invalid-id']);
    expect(issues.mixed).toEqual(['result/msg_code:not-returned', 'items/1:invalid-id']);
  });
});
