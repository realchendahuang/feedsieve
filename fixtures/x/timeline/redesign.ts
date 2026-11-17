/**
 * 2026-11-16，已登录 Chrome 的新版 X 首页 article（用户现场提供）。
 * 保留真实节点层级和定位属性；正文、昵称、handle、ID 和计数替换为合成值，
 * 去掉 SVG/media 及无关样式类。原样本没有 data-testid，也没有 time[datetime]。
 * 引用帖等变体由测试明确构造，不冒充现场采集。
 */
export const REDESIGN_TWEET_HTML = `
<article class="flex flex-col gap-1">
  <div class="flex gap-2">
    <div class="relative flex w-10 shrink-0 flex-col items-center self-stretch">
      <div class="relative z-10"><a class="x-link" href="/sample_user"><div class="x-avatar"></div></a></div>
    </div>
    <div class="flex min-w-0 flex-1 flex-col gap-3">
      <div class="flex flex-col gap-0.5">
        <div class="@container/post-actions flex items-start justify-between gap-2">
          <div class="x-middot-group max-w-full text-body font-normal text-secondary min-w-0">
            <div class="flex items-center gap-1 min-w-0">
              <span class="max-w-full min-w-0 flex shrink-0 items-center gap-1">
                <a class="x-link" href="/sample_user"><div class="font-bold">Sample Author</div></a>
                <div><span aria-label="认证账号" role="button"></span></div>
              </span>
              <span><a class="x-link" href="/sample_user"><span>@sample_user</span></a></span>
            </div>
            <span><a class="x-link" href="/sample_user/status/1800000000000000001">1小时</a></span>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <span><button data-slot="xds-button" aria-label="解释这个帖子"><span class="x-button-slot"></span></button></span>
            <button data-slot="xds-menu-trigger" aria-label="更多"><span class="x-button-slot"></span></button>
          </div>
        </div>
        <div class="max-w-full text-body font-normal text-primary whitespace-pre-wrap wrap-anywhere"><span>Sample post body.</span></div>
      </div>
      <div class="flex flex-col gap-3 empty:hidden">
        <div><div><div><div data-slot="xds-context-menu-trigger">
          <a class="x-link" aria-label="图像" data-engagement-action="media" href="/sample_user/status/1800000000000000001/photo/1"></a>
        </div></div></div></div>
      </div>
      <div aria-label="3 点赞、1 书签、440 次观看" class="flex items-center justify-between" role="group">
        <div data-engagement-action="reply"><a class="x-engagement-button" aria-label="0 条回复。回复" href="/compose/post?in_reply_to=1800000000000000001"><span class="x-engagement-pill"></span></a></div>
        <div data-engagement-action="retweet"><button data-slot="xds-menu-trigger" aria-label="0 次转帖。转帖"><span class="x-engagement-pill"></span></button></div>
        <div data-engagement-action="like"><button aria-label="3 次点赞。点赞"><span class="x-engagement-pill"><span><span><span class="x-animated-count-visual">3</span></span></span></span></button></div>
        <div><a class="x-engagement-button" aria-label="查看次数" href="/sample_user/status/1800000000000000001/analytics"><span class="x-engagement-pill"><span><span><span class="x-animated-count-visual">440</span></span></span></span></a></div>
        <div class="flex shrink-0 items-center">
          <div><span data-engagement-action="bookmark"><button aria-label="书签"><span class="x-engagement-pill"></span></button></span></div>
          <button data-engagement-action="share" data-slot="xds-menu-trigger" aria-label="分享"><span class="x-engagement-pill"></span></button>
        </div>
      </div>
    </div>
  </div>
</article>`;
