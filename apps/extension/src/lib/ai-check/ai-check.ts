import { createAiCheckCore } from './ai-check-core';
import { createAiCheckRunner } from './ai-check-runner';
import type { AiCheckDeps } from './ai-check-shared';

export function createAiCheck(deps: AiCheckDeps) {
  return createAiCheckCore({
    ...deps,
    loadRunner: () => createAiCheckRunner,
  });
}
