import { ModelScore } from "../types/modelScore";

<<<<<<< HEAD
export function pickBestModel(scores: Record<string, ModelScore>): string {
  return Object.entries(scores).sort((a, b) => b[1].total - a[1].total)[0][0];
=======
export function pickBestModel(
  scores: Record<string, ModelScore>
): string {
  return Object.entries(scores)
    .sort((a, b) => b[1].total - a[1].total)[0][0];
>>>>>>> c6972ae (init commit)
}
