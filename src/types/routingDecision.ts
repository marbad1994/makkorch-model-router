import { ModelKey } from "../router/selectModel";
import { RoutingIntent } from "./router";
import { TaskProfile } from "./task";

export interface RoutingDecision {
  modelKey: ModelKey;
  intent: RoutingIntent;
  task: TaskProfile;
  reason: string;
  fallbackChain: string[];
}
