import type { CommunityEntry, MarkStrength } from '@feedsieve/community-lists';

export const COMMUNITY_RUNTIME_MESSAGE = 'feedsieve:community-runtime';
export const COMMUNITY_LOOKUP_MESSAGE = 'feedsieve:community-lookup';

export interface SlimCommunityPayload {
  version: string;
  handles: string[];
  verified: string[];
  whitelist: string[];
  mutedRules: string[];
  fingerprints: string[];
  domains: string[];
  killSwitch?: {
    destructive_actions_disabled: true;
    reason?: string;
    disabled_since?: string;
  };
}

export interface CommunityRuntimeResponse {
  enabled: boolean;
  strength: MarkStrength;
  autoContribute: boolean;
  community: SlimCommunityPayload | null;
  builtinHandles: string[];
  builtinSameAsCommunity?: boolean;
}

export interface CommunityLookupRequest {
  type: typeof COMMUNITY_LOOKUP_MESSAGE;
  version: string;
  handles: string[];
  fingerprints: string[];
}

export interface CommunityLookupResponse {
  version: string;
  entries: Record<string, CommunityEntry | null>;
  campaigns: Record<string, CommunityEntry | null>;
}
