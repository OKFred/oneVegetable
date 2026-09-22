import { toast } from 'vue-sonner';

const noticed = new Set<string>();
/** Session-only de-duplication. Raw differences stay in the explicit diagnostics view. */
export function notifyVideoDifferences(issues: readonly string[], message: string): void {
  if (issues.includes('result/msg_code:not-returned') && !noticed.has('result/msg_code:not-returned')) {
    noticed.add('result/msg_code:not-returned');
    toast.info(message);
  }
}
