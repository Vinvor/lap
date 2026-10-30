import { reactive, readonly } from 'vue';

// One shared operation indicator for the Home title bar. No text while idle.
const internal = reactive({
  kind: '' as '' | 'delete' | 'move',
  completed: 0,
  total: 0,
  token: 0,
});
export const fileOperationProgress = readonly(internal);

export function startFileOperation(kind: 'delete' | 'move', total: number): number {
  const token = ++internal.token;
  internal.kind = kind;
  internal.completed = 0;
  internal.total = Math.max(1, Math.floor(total));
  return token;
}
export function advanceFileOperation(token: number, completed: number): void {
  if (token !== internal.token || !internal.kind) return;
  internal.completed = Math.min(internal.total, Math.max(0, Math.floor(completed)));
}
export function finishFileOperation(token: number): void {
  if (token !== internal.token) return;
  internal.kind = '';
  internal.completed = 0;
  internal.total = 0;
}
