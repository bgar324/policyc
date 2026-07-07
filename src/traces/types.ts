import type { ArtifactContext } from "../policy/types.js";

export type Trace = {
  input: string;
  context?: ArtifactContext | null;
  selectedPolicyIds: string[];
  compiledPrompt: string;
  toolsCalled: string[];
  output: string;
};
