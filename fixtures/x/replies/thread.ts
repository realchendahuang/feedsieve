/**
 * X DOM 脱敏样本：回复流（thread 页）。
 *
 * 回复的 tweetText 里含站内 @mention 链接（reader 应剔除为 links），
 * 账号名 / 链接均已替换。见 home-timeline.ts 头部说明。
 */

export const THREAD_HTML = `
<div data-testid="cellInnerDiv">
  <article data-testid="tweet" tabindex="0">
    <div>
      <div data-testid="User-Name">
        <div class="css-175oi2r">
          <a href="/threadroot" role="link">
            <span>Thread Root</span>
          </a>
        </div>
        <div class="css-175oi2r">
          <a href="/threadroot" role="link">
            <span>@threadroot</span>
          </a>
          <span>·</span>
          <a href="/threadroot/status/1720000000000000201"><time>3h</time></a>
        </div>
      </div>
    </div>
    <div data-testid="tweetText">
      这条线程的讨论主题：如何在信息流里识别抽奖诈骗。
    </div>
  </article>
</div>

<div data-testid="cellInnerDiv">
  <article data-testid="tweet" tabindex="0">
    <div>
      <div data-testid="User-Name">
        <div class="css-175oi2r">
          <a href="/replyguy2" role="link">
            <span>Reply Guy</span>
          </a>
        </div>
        <div class="css-175oi2r">
          <a href="/replyguy2" role="link">
            <span>@replyguy2</span>
          </a>
          <span>·</span>
          <a href="/replyguy2/status/1720000000000000202"><time>2h</time></a>
        </div>
      </div>
    </div>
    <div data-testid="tweetText">
      回复 <a href="/threadroot">@threadroot</a>：同意，seen 过几回
      <a href="https://t.co/aaa111">scam-example.com</a> 这种域名。
    </div>
  </article>
</div>
`;