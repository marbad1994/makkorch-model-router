export interface RoutingIntent {
  profile: "fast" | "balanced" | "deep" | "free-first";

  speedSensitivity: number;

  allowPaid: boolean;

  preferLocal: boolean;
}
