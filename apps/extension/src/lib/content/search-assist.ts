import { createSearchAssistDialog } from './search-assist-dialog';
import {
  SEARCH_ASSIST_BACKDROP_CLASS,
  SEARCH_ASSIST_TRIGGER_CLASS,
} from './search-assist-shared';
import {
  createSearchAssistTrigger,
  type SearchAssist,
  type SearchAssistTriggerDeps,
} from './search-assist-trigger';

export { SEARCH_ASSIST_BACKDROP_CLASS, SEARCH_ASSIST_TRIGGER_CLASS, type SearchAssist };

export function createSearchAssist(
  deps: Omit<SearchAssistTriggerDeps, 'loadDialog'>,
): SearchAssist {
  return createSearchAssistTrigger({
    ...deps,
    loadDialog: () => createSearchAssistDialog,
  });
}
