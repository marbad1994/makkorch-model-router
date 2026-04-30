export interface ModelScore {
  total: number;

  components: {
    quality: number;
    usagePenalty: number;
    failurePenalty: number;
    speedFit: number;
    latencyFit: number;
    taskBonus: number;
    preferenceBonus: number;
  };
}
