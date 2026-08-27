/**
 * handle -> rest_id 按需解析：UserByScreenName GraphQL（照抄 TBWL，MIT）。
 *
 * 时间线桥（XHR/fetch 拦截）只能缓存「已经出现在当前页响应里」的账号；
 * 缓存 miss 时（如某条推文来自未解析的端点），点拉黑不该让用户等刷新——
 * 用页面自身登录会话当场查一次 rest_id，再走 blocks/create.json。
 *
 * TBWL 原样参考：third_party/tbwl/index.user.js `fetch_followers` 里的
 * UserByScreenName 调用（同 queryId、同 features/fieldToggles 串）。
 */

import { readCsrfToken, X_WEB_BEARER } from './block';

/** TBWL 实测可用的 queryId（对应 web 客户端 UserByScreenName 查询）。 */
const USER_BY_SCREEN_NAME_QUERY_ID = '32pL5BWe9WKeSK1MoPvFQQ';

/** TBWL 对用户类端点使用的 features 串（原样保留，flags 与网页端一致）。 */
const USER_FEATURES = encodeURIComponent(
  '{"hidden_profile_subscriptions_enabled":true,"profile_label_improvements_pcf_label_in_post_enabled":true,"rweb_tipjar_consumption_enabled":true,"responsive_web_graphql_exclude_directive_enabled":true,"verified_phone_label_enabled":false,"subscriptions_verification_info_is_identity_verified_enabled":true,"subscriptions_verification_info_verified_since_enabled":true,"highlights_tweets_tab_ui_enabled":true,"responsive_web_twitter_article_notes_tab_enabled":true,"subscriptions_feature_can_gift_premium":true,"creator_subscriptions_tweet_preview_api_enabled":true,"responsive_web_graphql_skip_user_profile_image_extensions_enabled":false,"responsive_web_graphql_timeline_navigation_enabled":true,"longform_notetweets_inline_media_enabled":false,"longform_notetweets_rich_text_read_enabled":false,"communities_web_enable_tweet_community_results_fetch":false,"tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled":false,"responsive_web_grok_analyze_button_fetch_trends_enabled":false,"tweet_awards_web_tipping_enabled":false,"articles_preview_enabled":false,"responsive_web_jetfuel_frame":false,"responsive_web_enhance_cards_enabled":false,"graphql_is_translatable_rweb_tweet_is_translatable_enabled":false,"creator_subscriptions_quote_tweet_preview_enabled":false,"standardized_nudges_misinfo":false,"view_counts_everywhere_api_enabled":false,"rweb_video_timestamps_enabled":false,"responsive_web_grok_analyze_post_followups_enabled":false,"longform_notetweets_consumption_enabled":false,"freedom_of_speech_not_reach_fetch_enabled":false,"responsive_web_grok_share_attachment_enabled":false,"responsive_web_grok_image_annotation_enabled":false,"c9s_tweet_anatomy_moderator_badge_enabled":false,"responsive_web_grok_analysis_button_from_backend":false,"responsive_web_edit_tweet_api_enabled":false,"premium_content_api_read_enabled":false,"responsive_web_twitter_article_tweet_consumption_enabled":false}',
);

const FIELD_TOGGLES = encodeURIComponent('{"withAuxiliaryUserLabels":false}');

/**
 * 用页面登录会话按 handle 查 rest_id。
 *
 * 必须在 x.com 页面上下文执行（content script）：需要 ct0 与页面会话凭证。
 * 解析失败（网络/未登录/账号不存在）返回 null，绝不 throw——
 * 调用方如实反馈「无ID」，不假装成功。
 */
export async function resolveUserIdByHandle(
  handle: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const csrf = readCsrfToken();
  if (!csrf) {
    return null;
  }
  const variables = encodeURIComponent(
    JSON.stringify({ screen_name: handle, withSafetyModeUserFields: true }),
  );
  const url =
    `https://x.com/i/api/graphql/${USER_BY_SCREEN_NAME_QUERY_ID}/UserByScreenName` +
    `?variables=${variables}&features=${USER_FEATURES}&fieldToggles=${FIELD_TOGGLES}`;

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        Authorization: X_WEB_BEARER,
        'X-Twitter-Auth-Type': 'OAuth2Session',
        'X-Csrf-Token': csrf,
      },
    });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as {
      data?: { user?: { result?: { __typename?: string; rest_id?: string } } };
    };
    const result = body.data?.user?.result;
    if (result?.__typename === 'UserUnavailable' || !result?.rest_id) {
      return null;
    }
    return String(result.rest_id);
  } catch {
    return null;
  }
}
