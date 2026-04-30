export type TaskType =
  | "small_edit"
  | "implementation"
  | "architecture"
  | "debugging"
  | "refactor"
  | "docs"
  | "testing"
  | "unknown";

export interface TaskProfile {
  taskType: TaskType;
  scope: number; // 1-5
  reasoning: number; // 1-5
  urgency: number; // 1-10
  risk: number; // 1-5
}
