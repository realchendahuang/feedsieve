/**
 * X DOM 脱敏样本：用户主页时间线（profile 页）。
 *
 * 结构与 timeline 一致，context 由路径决定（/handle -> profile）。
 * 账号名 / 链接均已替换。见 home-timeline.ts 头部说明。
 */

export const PROFILE_TIMELINE_HTML = `
<div data-testid="cellInnerDiv">
  <article data-testid="tweet" tabindex="0">
    <div>
      <div data-testid="User-Name">
        <div class="css-175oi2r">
          <a href="/pinnedauthor" role="link">
            <span>Pinned Author</span>
          </a>
        </div>
        <div class="css-175oi2r">
          <a href="/pinnedauthor" role="link">
            <span>@pinnedauthor</span>
          </a>
          <span>·</span>
          <a href="/pinnedauthor/status/1720000000000000301"><time>1d</time></a>
        </div>
      </div>
    </div>
    <div data-testid="tweetText">
      置顶：关于我的项目说明与联系方式。
      <a href="https://t.co/bbb222">author-site.example</a>
    </div>
  </article>
</div>

<div data-testid="cellInnerDiv">
  <article data-testid="tweet" tabindex="0">
    <div>
      <div data-testid="User-Name">
        <div class="css-175oi2r">
          <a href="/pinnedauthor" role="link">
            <span>Pinned Author</span>
          </a>
        </div>
        <div class="css-175oi2r">
          <a href="/pinnedauthor" role="link">
            <span>@pinnedauthor</span>
          </a>
          <span>·</span>
          <a href="/pinnedauthor/status/1720000000000000302"><time>2d</time></a>
        </div>
      </div>
    </div>
    <div data-testid="tweetText">
      周末更新了一版设计稿。
    </div>
  </article>
</div>
`;