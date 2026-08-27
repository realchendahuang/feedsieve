// ==UserScript==
// @name        Twitter Block With Love
// @namespace   https://www.eolstudy.com
// @homepage    https://github.com/E011011101001/Twitter-Block-With-Love
// @icon        https://raw.githubusercontent.com/E011011101001/Twitter-Block-With-Love/master/imgs/icon.svg
// @version     2025.04.04
// @description Block or mute all the Twitter users who like or repost a specific post(Tweet), with love.
// @description:fr Bloque ou mute tous les utilisateurs de Twitter qui aiment ou repostent un post spécifique (Tweet), avec amour.
// @description:zh-CN 屏蔽或隐藏所有转发或点赞某条推文的推特用户
// @description:zh-TW 封鎖或靜音所有轉推或喜歡某則推文的推特使用者
// @description:ja あるツイートに「いいね」や「リツイート」をしたTwitterユーザー全員をブロックまたはミュートする機能を追加する
// @description:ko 특정 트윗을 좋아하거나 리트윗하는 모든 트위터 사용자 차단 또는 음소거
// @description:de Blockieren Sie alle Twitter-Nutzer, denen ein bestimmter Tweet gefällt oder die ihn retweeten, oder schalten Sie sie stumm - mit Liebe.
// @author      Eol, OverflowCat, yuanLeeMidori, nwxz
// @license     MIT
// @run-at      document-end
// @grant       GM_registerMenuCommand
// @match       https://twitter.com/*
// @match       https://x.com/*
// @match       https://mobile.twitter.com/*
// @match       https://tweetdeck.twitter.com/*
// @exclude     https://twitter.com/account/*
// @require     https://cdn.jsdelivr.net/npm/axios@0.25.0/dist/axios.min.js
// @require     https://cdn.jsdelivr.net/npm/qs@6.10.3/dist/qs.min.js
// @require     https://cdn.jsdelivr.net/npm/jquery@3.5.1/dist/jquery.min.js
// ==/UserScript==

/* global axios $ Qs */

(_ => {
  /* Begin of Dependencies */
  /* eslint-disable */

  // https://gist.githubusercontent.com/BrockA/2625891/raw/9c97aa67ff9c5d56be34a55ad6c18a314e5eb548/waitForKeyElements.js
  /*--- waitForKeyElements():  A utility function, for Greasemonkey scripts,
      that detects and handles AJAXed content.

      Usage example:

          waitForKeyElements (
              "div.comments"
              , commentCallbackFunction
          );

          //--- Page-specific function to do what we want when the node is found.
          function commentCallbackFunction (jNode) {
              jNode.text ("This comment changed by waitForKeyElements().");
          }

      IMPORTANT: This function requires your script to have loaded jQuery.
  */
  function waitForKeyElements (
      selectorTxt,    /* Required: The jQuery selector string that
                          specifies the desired element(s).
                      */
      actionFunction, /* Required: The code to run when elements are
                          found. It is passed a jNode to the matched
                          element.
                      */
      bWaitOnce,      /* Optional: If false, will continue to scan for
                          new elements even after the first match is
                          found.
                      */
      iframeSelector  /* Optional: If set, identifies the iframe to
                          search.
                      */
  ) {
      var targetNodes, btargetsFound;

      if (typeof iframeSelector == "undefined")
          targetNodes     = $(selectorTxt);
      else
          targetNodes     = $(iframeSelector).contents ()
                                            .find (selectorTxt);

      if (targetNodes  &&  targetNodes.length > 0) {
          btargetsFound   = true;
          /*--- Found target node(s).  Go through each and act if they
              are new.
          */
          targetNodes.each ( function () {
              var jThis        = $(this);
              var alreadyFound = jThis.data ('alreadyFound')  ||  false;

              if (!alreadyFound) {
                  //--- Call the payload function.
                  var cancelFound     = actionFunction (jThis);
                  if (cancelFound)
                      btargetsFound   = false;
                  else
                      jThis.data ('alreadyFound', true);
              }
          } );
      }
      else {
          btargetsFound   = false;
      }

      //--- Get the timer-control variable for this selector.
      var controlObj      = waitForKeyElements.controlObj  ||  {};
      var controlKey      = selectorTxt.replace (/[^\w]/g, "_");
      var timeControl     = controlObj [controlKey];

      //--- Now set or clear the timer as appropriate.
      if (btargetsFound  &&  bWaitOnce  &&  timeControl) {
          //--- The only condition where we need to clear the timer.
          clearInterval (timeControl);
          delete controlObj [controlKey]
      }
      else {
          //--- Set a timer, if needed.
          if ( ! timeControl) {
              timeControl = setInterval ( function () {
                      waitForKeyElements (    selectorTxt,
                                              actionFunction,
                                              bWaitOnce,
                                              iframeSelector
                                          );
                  },
                  300
              );
              controlObj [controlKey] = timeControl;
          }
      }
      waitForKeyElements.controlObj   = controlObj;
  }
  /* eslint-enable */
  /* End of Dependencies */

  let lang = document.documentElement.lang
  if (lang == 'en-US') {
    lang = 'en' // TweetDeck
  }
  const translations = {
    // Please submit a feedback on Greasyfork.com if your language is not in the list bellow
    en: {
      lang_name: 'English',
      like_title: 'Liked by',
      like_list_identifier: 'Timeline: Liked by',
      retweet_title: 'Retweeted by',
      retweet_list_identifier: 'Timeline: Retweeted by',
      block_btn: 'Block all',
      block_success: 'All users blocked!',
      mute_btn: 'Mute all',
      mute_success: 'All users muted!',
      include_original_tweeter: 'Include the original Tweeter',
      logs: 'Logs',
      list_members: 'List members',
      list_members_identifier: 'Timeline: List members',
      block_retweets_notice: 'TBWL has only blocked users that retweeted without comments.\n Please block users retweeting with comments manually.'
    },
    'en-GB': {
      lang_name: 'British English',
      like_title: 'Liked by',
      like_list_identifier: 'Timeline: Liked by',
      retweet_title: 'Retweeted by',
      retweet_list_identifier: 'Timeline: Retweeted by',
      block_btn: 'Block all',
      block_success: 'All users blocked!',
      mute_btn: 'Mute all',
      mute_success: 'All users muted!',
      include_original_tweeter: 'Include the original Tweeter',
      logs: 'Logs',
      list_members: 'List members',
      list_members_identifier: 'Timeline: List members',
      block_retweets_notice: 'TBWL has only blocked users that retweeted without comments.\n Please block users retweeting with comments manually.'
    },
    zh: {
      lang_name: '简体中文',
      like_title: '喜欢者',
      like_list_identifier: '时间线：喜欢者',
      retweet_title: '转推',
      retweet_list_identifier: '时间线：转推者',
      block_btn: '全部屏蔽',
      mute_btn: '全部隐藏',
      block_success: '列表用户已全部屏蔽！',
      mute_success: '列表用户已全部隐藏！',
      include_original_tweeter: '包括推主',
      logs: '操作记录',
      list_members: '列表成员',
      list_members_identifier: '时间线：列表成员',
      block_retweets_notice: 'Twitter Block with Love 仅屏蔽了不带评论转推的用户。\n请手动屏蔽引用推文的用户。'
    },
    'zh-Hant': {
      lang_name: '正體中文',
      like_title: '已被喜歡',
      like_list_identifier: '時間軸：已被喜歡',
      retweet_title: '轉推',
      retweet_list_identifier: '時間軸：已被轉推',
      block_btn: '全部封鎖',
      mute_btn: '全部靜音',
      block_success: '列表用戶已全部封鎖！',
      mute_success: '列表用戶已全部靜音！',
      include_original_tweeter: '包括推主',
      logs: '活動記錄',
      list_members: '列表成員',
      list_members_identifier: '時間軸：列表成員',
      block_retweets_notice: 'Twitter Block with Love 僅封鎖了不帶評論轉推的使用者。\n請手動封鎖引用推文的使用者。'
    },
    ja: {
      lang_name: '日本語',
      like_list_identifier: 'タイムライン: いいねしたユーザー',
      like_title: 'いいねしたユーザー',
      retweet_list_identifier: 'タイムライン: リツイートしたユーザー',
      retweet_title: 'リツイート',
      block_btn: '全部ブロック',
      mute_btn: '全部ミュート',
      block_success: '全てブロックしました！',
      mute_success: '全てミュートしました！',
      include_original_tweeter: 'スレ主',
      logs: '操作履歴を表示',
      list_members: 'リストに追加されているユーザー',
      list_members_identifier: 'タイムライン: リストに追加されているユーザー',
      block_retweets_notice: 'TBWLは、コメントなしでリツイートしたユーザーのみをブロックしました。\n引用ツイートしたユーザーを手動でブロックしてください。'
    },
    vi: {
      // translation by Ly Hương
      lang_name: 'Tiếng Việt',
      like_list_identifier: 'Dòng thời gian: Được thích bởi',
      like_title: 'Được thích bởi',
      retweet_list_identifier: 'Dòng thời gian: Được Tweet lại bởi',
      retweet_title: 'Được Tweet lại bởi',
      block_btn: 'Chặn tất cả',
      mute_btn: 'Tắt tiếng tất cả',
      block_success: 'Tất cả tài khoản đã bị chặn!',
      mute_success: 'Tất cả tài khoản đã bị tắt tiếng!',
      include_original_tweeter: 'Tweeter gốc',
      logs: 'Lịch sử',
      list_members: 'Thành viên trong danh sách',
      list_members_identifier: 'Dòng thời gian: Thành viên trong danh sách',
      block_retweets_notice: 'TBWL chỉ chặn tài khoản đã retweet không bình luận. Những tài khoản retweet bằng bình luận thì xin hãy chặn bằng tay.'
    },
    ko: {
      // translation by hellojo011
      lang_name: '한국어',
      like_list_identifier: '타임라인: 마음에 들어 함',
      like_title: '마음에 들어 함',
      retweet_list_identifier: '타임라인: 리트윗함',
      retweet_title: '리트윗',
      block_btn: '모두 차단',
      mute_btn: '모두 뮤트',
      block_success: '모두 차단했습니다!',
      mute_success: '모두 뮤트했습니다!',
      include_original_tweeter: '글쓴이',
      logs: '활동',
      list_members: '리스트 멤버',
      list_members_identifier: '타임라인: 리스트 멤버',
      block_retweets_notice: '저희는 리트윗하신 사용자분들을 차단 했으나 트윗 인용하신 사용자분들은 직접 차단하셔야 합니다.'
    },
    de: {
      // translation by Wassermäuserich Lúcio
      lang_name: 'Deutsch',
      like_title: 'Gefällt',
      like_list_identifier: 'Timeline: Gefällt',
      retweet_title: 'Retweetet von',
      retweet_list_identifier: 'Timeline: Retweetet von',
      block_btn: 'Alle blockieren',
      mute_btn: 'Alle stummschalten',
      block_success: 'Alle wurden blockiert!',
      mute_success: 'Alle wurden stummgeschaltet!',
      include_original_tweeter: 'Original-Hochlader einschließen',
      logs: 'Betriebsaufzeichnung',
      list_members: 'Listenmitglieder',
      list_members_identifier: 'Timeline: Listenmitglieder',
      block_retweets_notice: 'TBWL hat nur Benutzer blockiert, die ohne Kommentare retweetet haben.\nBitte blockieren Sie Benutzer, die mit Kommentaren retweetet haben, manuell.',
      enabled: 'Aktiviert!',
      disabled: 'Behindert!',
    },
    fr: {
      lang_name: 'French',
      like_title: 'Aimé par',
      like_list_identifier: 'Fil d\'actualités : Aimé par',
      retweet_title: 'Retweeté par',
      retweet_list_identifier: 'Fil d\'actualités : Retweeté par',
      block_btn: 'Bloquer tous',
      block_success: 'Tous les utilisateurs sont bloqués !',
      mute_btn: 'Masquer tous',
      mute_success: 'Tous les utilisateurs sont masqués !',
      include_original_tweeter: 'Inclure l’auteur original',
      logs: 'Logs',
      list_members: 'Membres de la liste',
      list_members_identifier: 'Fil d\'actualités : Membres de la liste',
      block_retweets_notice: 'TBWL a seulement bloqué les utilisateurs qui ont retweeté sans commenter.\n Vous devez bloquer manuellement les retweets avec commentaire.'
    },
  }
  let i18n = translations[lang]
  // lang is empty in some error pages, so check lang first
  if (lang && !i18n) {
    i18n = translations.en
    if (false) {
      let langnames = []
      Object.values(translations).forEach(language => langnames.push(language.lang_name))
      langnames = langnames.join(', ')
      confirm(
        'Twitter Block With Love userscript does not support your language (language code: "' + lang + '").\n' +
        'Please send feedback at Greasyfork.com or open an issue at Github.com.\n' +
        'Before that, you can edit the userscript yourself or just switch the language of Twitter Web App to any of the following languages: ' +
        langnames + '.\n\nDo you want to open an issue?'
      ) && window.location.replace('https://github.com/E011011101001/Twitter-Block-With-Love/issues/new/')
    }
  }

  function rgba_to_hex (rgba_str, force_remove_alpha) {
    return '#' + rgba_str.replace(/^rgba?\(|\s+|\)$/g, '') // Get's rgba / rgb string values
      .split(',') // splits them at ","
      .filter((_, index) => !force_remove_alpha || index !== 3)
      .map(string => parseFloat(string)) // Converts them to numbers
      .map((number, index) => index === 3 ? Math.round(number * 255) : number) // Converts alpha to 255 number
      .map(number => number.toString(16)) // Converts numbers to hex
      .map(string => string.length === 1 ? '0' + string : string) // Adds 0 when length of one number is 1
      .join('')
      .toUpperCase()
  }

  function hex_to_rgb (hex_str) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})/i.exec(hex_str)
    return result ? `rgb(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)})` : ''
  }

  function invert_hex (hex) {
    return '#' + (Number(`0x1${hex.substring(1)}`) ^ 0xFFFFFF).toString(16).substring(1).toUpperCase()
  }

  function get_theme_color () {
    const FALLBACK_COLOR = 'rgb(128, 128, 128)'
    let bgColor = FALLBACK_COLOR
    // try {
    //   bgColor = getComputedStyle(document.querySelector('h2 > span')).color
    // } catch (e) {
    //   console.info('[TBWL] bgColor not found. Falling back to default.')
    // }
    let buttonTextColor = hex_to_rgb(invert_hex(rgba_to_hex(bgColor)))
    for (const ele of document.querySelectorAll('div[role=\'button\']')) {
      const color = ele?.style?.backgroundColor
      if (color != '') {
        bgColor = color
        const span = ele.querySelector('span')
        buttonTextColor = getComputedStyle(span)?.color || buttonTextColor
      }
    }

    return {
      bgColor,
      buttonTextColor,
      plainTextColor: $('span').css('color'),
      hoverColor: bgColor.replace(/rgb/i, 'rgba').replace(/\)/, ', 0.9)'),
      mousedownColor: bgColor.replace(/rgb/i, 'rgba').replace(/\)/, ', 0.8)')
    }
  }

  function get_cookie (cname) {
    const name = cname + '='
    const ca = document.cookie.split(';')
    for (let i = 0; i < ca.length; ++i) {
      const c = ca[i].trim()
      if (c.indexOf(name) === 0) {
        return c.substring(name.length, c.length)
      }
    }
    return ''
  }

  function get_ancestor (dom, level) {
    for (let i = 0; i < level; ++i) {
      dom = dom.parent()
    }
    return dom
  }

  const ajax = axios.create({
    baseURL: 'https://api.x.com',
    withCredentials: true,
    headers: {
      Authorization: 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
      'X-Twitter-Auth-Type': 'OAuth2Session',
      'X-Twitter-Active-User': 'yes',
      'X-Csrf-Token': get_cookie('ct0')
    }
  })

  function get_tweet_id () {
    // https://twitter.com/any/thing/status/1234567/anything => 1234567/anything => 1234567
    return location.href.split('status/')[1].split('/')[0]
  }

  function get_list_id () {
    // https://twitter.com/any/thing/lists/1234567/anything => 1234567/anything => 1234567
    return location.href.split('lists/')[1].split('/')[0]
  }

  const paramsREQ = `features=%7B%22responsive_web_graphql_exclude_directive_enabled%22%3Atrue%2C%22verified_phone_label_enabled%22%3Afalse%2C%22creator_subscriptions_tweet_preview_api_enabled%22%3Atrue%2C%22responsive_web_graphql_timeline_navigation_enabled%22%3Atrue%2C%22responsive_web_graphql_skip_user_profile_image_extensions_enabled%22%3Afalse%2C%22c9s_tweet_anatomy_moderator_badge_enabled%22%3Atrue%2C%22tweetypie_unmention_optimization_enabled%22%3Atrue%2C%22responsive_web_edit_tweet_api_enabled%22%3Atrue%2C%22graphql_is_translatable_rweb_tweet_is_translatable_enabled%22%3Atrue%2C%22view_counts_everywhere_api_enabled%22%3Atrue%2C%22longform_notetweets_consumption_enabled%22%3Atrue%2C%22responsive_web_twitter_article_tweet_consumption_enabled%22%3Atrue%2C%22tweet_awards_web_tipping_enabled%22%3Afalse%2C%22freedom_of_speech_not_reach_fetch_enabled%22%3Atrue%2C%22standardized_nudges_misinfo%22%3Atrue%2C%22tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled%22%3Atrue%2C%22rweb_video_timestamps_enabled%22%3Atrue%2C%22longform_notetweets_rich_text_read_enabled%22%3Atrue%2C%22longform_notetweets_inline_media_enabled%22%3Atrue%2C%22responsive_web_enhance_cards_enabled%22%3Afalse%7D`

  // fetch current followers
  async function fetch_followers(userName, count) {
    const paramsUserExtReq = `features=%7B%22hidden_profile_subscriptions_enabled%22%3Atrue%2C%22profile_label_improvements_pcf_label_in_post_enabled%22%3Atrue%2C%22rweb_tipjar_consumption_enabled%22%3Atrue%2C%22responsive_web_graphql_exclude_directive_enabled%22%3Atrue%2C%22verified_phone_label_enabled%22%3Afalse%2C%22subscriptions_verification_info_is_identity_verified_enabled%22%3Atrue%2C%22subscriptions_verification_info_verified_since_enabled%22%3Atrue%2C%22highlights_tweets_tab_ui_enabled%22%3Atrue%2C%22responsive_web_twitter_article_notes_tab_enabled%22%3Atrue%2C%22subscriptions_feature_can_gift_premium%22%3Atrue%2C%22creator_subscriptions_tweet_preview_api_enabled%22%3Atrue%2C%22responsive_web_graphql_skip_user_profile_image_extensions_enabled%22%3Afalse%2C%22responsive_web_graphql_timeline_navigation_enabled%22%3Atrue%2C%22longform_notetweets_inline_media_enabled%22%3Afalse%2C%22longform_notetweets_rich_text_read_enabled%22%3Afalse%2C%22communities_web_enable_tweet_community_results_fetch%22%3Afalse%2C%22tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled%22%3Afalse%2C%22responsive_web_grok_analyze_button_fetch_trends_enabled%22%3Afalse%2C%22tweet_awards_web_tipping_enabled%22%3Afalse%2C%22articles_preview_enabled%22%3Afalse%2C%22responsive_web_jetfuel_frame%22%3Afalse%2C%22responsive_web_enhance_cards_enabled%22%3Afalse%2C%22graphql_is_translatable_rweb_tweet_is_translatable_enabled%22%3Afalse%2C%22creator_subscriptions_quote_tweet_preview_enabled%22%3Afalse%2C%22standardized_nudges_misinfo%22%3Afalse%2C%22view_counts_everywhere_api_enabled%22%3Afalse%2C%22rweb_video_timestamps_enabled%22%3Afalse%2C%22responsive_web_grok_analyze_post_followups_enabled%22%3Afalse%2C%22longform_notetweets_consumption_enabled%22%3Afalse%2C%22freedom_of_speech_not_reach_fetch_enabled%22%3Afalse%2C%22responsive_web_grok_share_attachment_enabled%22%3Afalse%2C%22responsive_web_grok_image_annotation_enabled%22%3Afalse%2C%22c9s_tweet_anatomy_moderator_badge_enabled%22%3Afalse%2C%22responsive_web_grok_analysis_button_from_backend%22%3Afalse%2C%22responsive_web_edit_tweet_api_enabled%22%3Afalse%2C%22premium_content_api_read_enabled%22%3Afalse%2C%22responsive_web_twitter_article_tweet_consumption_enabled%22%3Afalse%7D%26fieldToggles%3D%7B%22withAuxiliaryUserLabels%22%3Afalse%7D`
    const userIdResponse = await ajax.get(`https://x.com/i/api/graphql/32pL5BWe9WKeSK1MoPvFQQ/UserByScreenName?variables=%7B%22screen_name%22%3A%22${userName}%22%7D&${paramsUserExtReq}`);
    const userId = userIdResponse.data["data"]["user"]["result"]["rest_id"]
    console.log('user rest id', userId);

    const paramsExtREQ = `features=%7B%22profile_label_improvements_pcf_label_in_post_enabled%22%3Atrue%2C%22rweb_tipjar_consumption_enabled%22%3Atrue%2C%22responsive_web_graphql_exclude_directive_enabled%22%3Atrue%2C%22verified_phone_label_enabled%22%3Afalse%2C%22creator_subscriptions_tweet_preview_api_enabled%22%3Atrue%2C%22responsive_web_graphql_timeline_navigation_enabled%22%3Atrue%2C%22responsive_web_graphql_skip_user_profile_image_extensions_enabled%22%3Afalse%2C%22premium_content_api_read_enabled%22%3Afalse%2C%22communities_web_enable_tweet_community_results_fetch%22%3Atrue%2C%22c9s_tweet_anatomy_moderator_badge_enabled%22%3Atrue%2C%22responsive_web_grok_analyze_button_fetch_trends_enabled%22%3Afalse%2C%22responsive_web_grok_analyze_post_followups_enabled%22%3Atrue%2C%22responsive_web_jetfuel_frame%22%3Afalse%2C%22responsive_web_grok_share_attachment_enabled%22%3Atrue%2C%22articles_preview_enabled%22%3Atrue%2C%22responsive_web_edit_tweet_api_enabled%22%3Atrue%2C%22graphql_is_translatable_rweb_tweet_is_translatable_enabled%22%3Atrue%2C%22view_counts_everywhere_api_enabled%22%3Atrue%2C%22longform_notetweets_consumption_enabled%22%3Atrue%2C%22responsive_web_twitter_article_tweet_consumption_enabled%22%3Atrue%2C%22tweet_awards_web_tipping_enabled%22%3Afalse%2C%22responsive_web_grok_analysis_button_from_backend%22%3Atrue%2C%22creator_subscriptions_quote_tweet_preview_enabled%22%3Afalse%2C%22freedom_of_speech_not_reach_fetch_enabled%22%3Atrue%2C%22standardized_nudges_misinfo%22%3Atrue%2C%22tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled%22%3Atrue%2C%22rweb_video_timestamps_enabled%22%3Atrue%2C%22longform_notetweets_rich_text_read_enabled%22%3Atrue%2C%22longform_notetweets_inline_media_enabled%22%3Atrue%2C%22responsive_web_grok_image_annotation_enabled%22%3Afalse%2C%22responsive_web_enhance_cards_enabled%22%3Afalse%7D%26fieldToggles%3D%7B%22withAuxiliaryUserLabels%22%3Afalse%7D`
    const response = await ajax.get(`https://x.com/i/api/graphql/OGScL-RC4DFMsRGOCjPR6g/Followers?variables=%7B%22userId%22%3A%22${userId}%22%2C%22count%22%3A${count}%2C%22includePromotedContent%22%3Afalse%7D&${paramsExtREQ}`);
    const data = response.data;

    const users = data["data"]["user"]["result"]["timeline"]["timeline"]["instructions"].reduce((acc, instruction) => {
        if (instruction.type === 'TimelineAddEntries') {
            instruction.entries.forEach(entry => {
                if (entry.content && entry.content.entryType === 'TimelineTimelineItem' && entry.content.itemContent && entry.content.itemContent.itemType === 'TimelineUser') {
                    if (entry.content.itemContent.user_results && entry.content.itemContent.user_results.result && typeof entry.content.itemContent.user_results.result.rest_id !== "undefined") {
                        const restId = entry.content.itemContent.user_results.result.rest_id;
                        acc[restId] = true;
                    }
                }
            });
        }
        return acc;
    }, {});

    const followers = Object.keys(users);
    return followers;
  }

  // fetch_likers and fetch_no_comment_reposters need to be merged into one function
  async function fetch_likers (tweetId) {
    const response = await ajax.get(`https://x.com/i/api/graphql/-A3YSkEdbCV0rpHTkYZXCA/Favoriters?variables=%7B%22tweetId%22%3A%22${tweetId}%22%2C%22includePromotedContent%22%3Atrue%7D&${paramsREQ}`);
        const data = response.data;

        const users = data["data"]["favoriters_timeline"]["timeline"]["instructions"].reduce((acc, instruction) => {
        if (instruction.type === 'TimelineAddEntries') {
            instruction.entries.forEach(entry => {
                if (entry.content && entry.content.entryType === 'TimelineTimelineItem' && entry.content.itemContent && entry.content.itemContent.itemType === 'TimelineUser') {
                    if (entry.content.itemContent.user_results && entry.content.itemContent.user_results.result && typeof entry.content.itemContent.user_results.result.rest_id !== "undefined") {
                        const restId = entry.content.itemContent.user_results.result.rest_id;
                        acc[restId] = true;
                    }
                }
            });
        }
        return acc;
    }, {});

        const likers = Object.keys(users);
        return likers;
  }

  async function fetch_no_comment_reposters (tweetId) {
    const response = await ajax.get(`https://x.com/i/api/graphql/s6LwzbPawe8J04NldDYrQQ/Retweeters?variables=%7B%22tweetId%22%3A%22${tweetId}%22%2C%22includePromotedContent%22%3Atrue%7D&${paramsREQ}`);
        const data = response.data;

        const users = data["data"]["retweeters_timeline"]["timeline"]["instructions"].reduce((acc, instruction) => {
        if (instruction.type === 'TimelineAddEntries') {
            instruction.entries.forEach(entry => {
                if (entry.content && entry.content.entryType === 'TimelineTimelineItem' && entry.content.itemContent && entry.content.itemContent.itemType === 'TimelineUser') {
                    if (entry.content.itemContent.user_results && entry.content.itemContent.user_results.result && typeof entry.content.itemContent.user_results.result.rest_id !== "undefined") {
                        const restId = entry.content.itemContent.user_results.result.rest_id;
                        acc[restId] = true;
                    }
                }
            });
        }
            return acc;
        }, {});

      const reposters = Object.keys(users);
      return reposters;
  }



  async function fetch_list_members (listId) {
    const users = (await ajax.get(`/1.1/lists/members.json?list_id=${listId}`)).data.users
    const members = users.map(u => u.id_str)
    return members
  }

  function block_user (id) {
    ajax.post('/1.1/blocks/create.json', Qs.stringify({
      user_id: id
    }), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })
  }

  function mute_user (id) {
    ajax.post('/1.1/mutes/users/create.json', Qs.stringify({
      user_id: id
    }), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })
  }

  async function get_tweeter (tweetId) {
    const screen_name = location.href.split('x.com/')[1].split('/')[0]
    const tweetData = (await ajax.get(`/2/timeline/conversation/${tweetId}.json`)).data
    // Find the tweeter by username
    const users = tweetData.globalObjects.users
    for (const key in users) {
      if (users[key].screen_name === screen_name) {
        return key
      }
    }
    return undefined
  }

  function is_poster_included () {
    return $('#bwl-include-tweeter').prop('checked')
  }

  // block_all_liker and block_no_comment_reposters need to be merged
  async function block_all_likers () {
    const tweetId = get_tweet_id()
    const likers = await fetch_likers(tweetId)
    if (is_poster_included()) {
      const tweeter = await get_tweeter(tweetId)
      if (tweeter) {
        likers.push(tweeter)
      }
    }
    likers.forEach(block_user)
  }

  async function mute_all_likers () {
    const tweetId = get_tweet_id()
    const likers = await fetch_likers(tweetId)
    if (is_poster_included()) {
      const tweeter = await get_tweeter(tweetId)
      if (tweeter) {
        likers.push(tweeter)
      }
    }
    likers.forEach(mute_user)
  }

  async function block_followers () {
    const userName = window.location.href.match(/http.*\/(\w+)\/followers/)[1]
    const followers = await fetch_followers(userName, 10000)

    followers.forEach(block_user)
  }

  async function block_reposters () {
    const tweetId = get_tweet_id()
    const reposters = await fetch_no_comment_reposters(tweetId)
    if (is_poster_included()) {
      const tweeter = await get_tweeter(tweetId)
      if (tweeter) {
        reposters.push(tweeter)
      }
    }
    reposters.forEach(block_user)
  }

  async function mute_reposters () {
    const tweetId = get_tweet_id()
    const reposters = await fetch_no_comment_reposters(tweetId)
    if (is_poster_included()) {
      const tweeter = await get_tweeter(tweetId)
      if (tweeter) {
        reposters.push(tweeter)
      }
    }
    reposters.forEach(mute_user)
  }

  async function block_list_members () {
    const listId = get_list_id()
    const members = await fetch_list_members(listId)
    members.forEach(block_user)
  }

  async function mute_list_members () {
    const listId = get_list_id()
    const members = await fetch_list_members(listId)
    members.forEach(mute_user)
  }

  async function mute () {
    const url = window.location.href
    if (url.endsWith('/likes')) {
      mute_all_likers()
    } else if (url.endsWith('/retweets')) {
      mute_reposters()
    } else {
      console.error('Mute is not implemented on this page.')
    }
  }

  async function block () {
    const url = window.location.href
    if (url.endsWith('/likes')) {
      block_all_likers()
    } else if (url.endsWith('/retweets')) {
      block_reposters()
    } else if (url.endsWith('/followers')) {
      block_followers()
    } else {
      console.error('Block is not implemented on this page.')
    }
  }

  function get_notifier_of (msg) {
    return _ => {
      const banner = $(`
        <div id="bwl-notice" style="right:0px; position:fixed; left:0px; bottom:0px; display:flex; flex-direction:column;">
          <div class="tbwl-notice">
            <span>${msg}</span>
          </div>
        </div>
      `)
      const closeButton = $(`
        <span id="bwl-close-button" style="font-weight:700; margin-left:12px; margin-right:12px; cursor:pointer;">
          Close
        </span>
      `)
      closeButton.click(_ => banner.remove())
      $(banner).children('.tbwl-notice').append(closeButton)

      $('#layers').append(banner)

      // TODO: after the hiding, the tab gets sluggish if revisited
      $('div[data-testid="cellInnerDiv"]:has(div[role="button"])').parent().hide()
      setTimeout(() => banner.remove(), 5000)
    }
  }

  function mount_switch (parentDom, name) {
    const button = $(`
      <div class="container">
        <div class="checkbox">
          <input type="checkbox" id="bwl-include-tweeter" name="" value="">
          <label for="bwl-include-tweeter"><span>${name}</span></label>
        </div>
      </div>
    `)

    parentDom.append(button)
  }

  function mount_button (parentDom, name, executer, success_notifier) {
    const btn_mousedown = 'bwl-btn-mousedown'
    const btn_hover = 'bwl-btn-hover'

    const button = $(`
      <div
        aria-haspopup="true"
        role="button"
        data-focusable="true"
        class="bwl-btn-base"
        style="margin:3px"
      >
        <div class="bwl-btn-inner-wrapper">
          <span>
            <span class="bwl-text-font">${name}</span>
          </span>
        </div>
      </div>
    `).addClass(parentDom.prop('classList')[0])
      .hover(function () {
        $(this).addClass(btn_hover)
      }, function () {
        $(this).removeClass(btn_hover)
        $(this).removeClass(btn_mousedown)
      })
      .on('selectstart', function () {
        return false
      })
      .mousedown(function () {
        $(this).removeClass(btn_hover)
        $(this).addClass(btn_mousedown)
      })
      .mouseup(function () {
        $(this).removeClass(btn_mousedown)
        if ($(this).is(':hover')) {
          $(this).addClass(btn_hover)
        }
      })
      .click(executer)
      .click(success_notifier)

    parentDom.append(button)
  }

  function insert_css () {
    const FALLBACK_FONT_FAMILY = 'TwitterChirp, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, "Noto Sans CJK SC", "Noto Sans CJK TC", "Noto Sans CJK JP", Arial, sans-serif;'
    function get_font_family () {
      for (const ele of document.querySelectorAll('div[role=\'button\']')) {
        const font_family = getComputedStyle(ele).fontFamily
        if (font_family) {
          return font_family + ', ' + FALLBACK_FONT_FAMILY
        }
      }
      return FALLBACK_FONT_FAMILY
    }

    const colors = get_theme_color()

    // switch related
    $('head').append(`<style>
    </style>`)

    // TODO: reduce repeated styles
    $('head').append(`<style>
      #tbwl-panel {
        display:flex; align-items:center; justify-content:center; border-bottom-width:1px;border-bottom-style: solid;
        border-color: rgb(239, 243, 244);
        padding-top: 3px;
        padding-bottom: 3px;
      }
      .tbwl-notice {
        align-self: center;
        display: flex;
        flex-direction: row;
        padding: 12px;
        margin-bottom: 32px;
        border-radius: 4px;
        color:rgb(255, 255, 255);
        background-color: rgb(29, 155, 240);
        font-family: ${FALLBACK_FONT_FAMILY};
        font-size: 15px;
        line-height: 20px;
        overflow-wrap: break-word;
      }
      .bwl-btn-base {
        min-height: 30px;
        padding-left: 1em;
        padding-right: 1em;
        border: 1px solid ${colors.bgColor} !important;
        border-radius: 9999px;
        background-color: ${colors.bgColor};
        display: flex;
        align-items: center
      }
      .bwl-btn-mousedown {
        background-color: ${colors.mousedownColor};
        cursor: pointer;
      }
      .bwl-btn-hover {
        background-color: ${colors.hoverColor};
        cursor: pointer;
      }
      .bwl-btn-inner-wrapper {
        font-weight: bold;
        -webkit-box-align: center;
        align-items: center;
        -webkit-box-flex: 1;
        flex-grow: 1;
        color: ${colors.bgColor};
        display: flex;
      }
      .bwl-text-font {
        font-family: ${get_font_family()};
        color: ${colors.buttonTextColor};
        font-size: 14px;
      }
      .container {
        margin-top: 0px;
        margin-left: 0px;
        margin-right: 5px;
      }
      .checkbox {
        width: 100%;
        margin: 0px auto;
        position: relative;
        display: block;
        color: ${colors.plainTextColor};
      }
      .checkbox input[type="checkbox"] {
        width: auto;
        opacity: 0.00000001;
        position: absolute;
        left: 0;
        margin-left: 0px;
      }
      .checkbox label:before {
        content: '';
        position: absolute;
        left: 0;
        top: -5px;
        margin: 0px;
        width: 22px;
        height: 22px;
        transition: transform 0.2s ease;
        border-radius: 3px;
        border: 2px solid ${colors.bgColor};
      }
      .checkbox label:after {
        content: '';
        display: block;
        width: 10px;
        height: 5px;
        border-bottom: 2px solid ${colors.bgColor};
        border-left: 2px solid ${colors.bgColor};
        -webkit-transform: rotate(-45deg) scale(0);
        transform: rotate(-45deg) scale(0);
        transition: transform ease 0.2s;
        will-change: transform;
        position: absolute;
        top: 3px;
        left: 8px;
      }
      .checkbox input[type="checkbox"]:checked ~ label::before {
        color: ${colors.bgColor};
      }
      .checkbox input[type="checkbox"]:checked ~ label::after {
        -webkit-transform: rotate(-45deg) scale(1);
        transform: rotate(-45deg) scale(1);
      }
      .checkbox label {
        position: relative;
        display: block;
        padding-left: 31px;
        margin-bottom: 0;
        font-weight: normal;
        cursor: pointer;
        vertical-align: sub;
        width:fit-content;
        width:-webkit-fit-content;
        width:-moz-fit-content;
      }
      .checkbox label span {
        position: relative;
        top: 50%;
        -webkit-transform: translateY(-50%);
        transform: translateY(-50%);
      }
      .checkbox input[type="checkbox"]:focus + label::before {
        outline: 0;
      }
    </style>`)
  }

  function compose_panel () {
    const notice_block_success = get_notifier_of('Successfully blocked.')
    const notice_mute_success = get_notifier_of('Successfully muted.')

    const TBWLPanel = $(`<div id="tbwl-panel" style="
    "></div>`)
    mount_switch(TBWLPanel, i18n.include_original_tweeter)
    mount_button(TBWLPanel, i18n.mute_btn, mute, notice_mute_success)
    mount_button(TBWLPanel, i18n.block_btn, block, notice_block_success)
    return TBWLPanel.hide()
  }

  function main () {
    const sleepTime = 700 // ms

    insert_css()
    const TBWLPanel = compose_panel()

    let prevURL = undefined
    setInterval(_ => {
      const currentURL = window.location.href
      if (prevURL !== currentURL) {
        prevURL = currentURL

        // Attention: /retweets may change to /reposts at any time.
        // Good job, Elon.
        // ♪ CEO, entrepreneur, born in 1971, Elon~~ Elon Reeve Musk~~ ♪♪
        if (currentURL.endsWith('/likes') || currentURL.endsWith('/retweets') || currentURL.endsWith('/followers')) {
          if ($('#tbwl-panel').length) {
            TBWLPanel.slideDown('fast')
          } else {
            waitForKeyElements('div[data-testid="primaryColumn"] section, div[data-testid="primaryColumn"] div[data-testid="emptyState"]', ele => {
              TBWLPanel.insertBefore(ele)
              TBWLPanel.slideDown()
            }, true)
          }
        } else {
          TBWLPanel.slideUp('fast')
        }
      }
    }, sleepTime)

    // TODO: merge into the above way
    // need a way to hide the include_original_tweeter option
    waitForKeyElements('h2#modal-header[aria-level="2"][role="heading"]', ele => {
      const ancestor = get_ancestor(ele, 3)
      const currentURL = window.location.href
      if (/\/lists\/[0-9]+\/members$/.test(currentURL)) {
        mount_switch(ancestor, i18n.include_original_tweeter)

        const notice_block_success = get_notifier_of('Successfully blocked.')
        const notice_mute_success = get_notifier_of('Successfully muted.')
        mount_button(ancestor, i18n.mute_btn, mute_list_members, notice_mute_success)
        mount_button(ancestor, i18n.block_btn, block_list_members, notice_block_success)
      }
    })
  }

  main()
})()
