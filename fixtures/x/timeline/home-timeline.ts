/**
 * X DOM 脱敏样本：Home Timeline。
 *
 * 结构按 2026-08 x.com 网页实测（data-testid 锚点 + cellInnerDiv 外层格子），
 * 账号名 / 链接全部替换为脱敏值。供 reader 集成测试锁定 selector 契约；
 * selector 改动必须同步更新本样本（selectors.ts 头注）。
 */

export const HOME_TIMELINE_HTML = `
<div data-testid="cellInnerDiv">
  <article data-testid="tweet" tabindex="0">
    <div>
      <div data-testid="User-Name">
        <div class="css-175oi2r">
          <a href="/normaluser" role="link">
            <span>Normal User</span>
          </a>
        </div>
        <div class="css-175oi2r">
          <a href="/normaluser" role="link">
            <span>@normaluser</span>
          </a>
          <span>·</span>
          <a href="/normaluser/status/1720000000000000001"><time>2h</time></a>
        </div>
      </div>
    </div>
    <div data-testid="tweetText">
      今天天气不错，整理了一下项目清单。
    </div>
    <div aria-label="2 次转帖、5 喜欢、1 书签">
      <div data-testid="like"><span>5</span></div>
    </div>
  </article>
</div>

<div data-testid="cellInnerDiv">
  <article data-testid="tweet" tabindex="0">
    <div>
      <div data-testid="User-Name">
        <div class="css-175oi2r">
          <a href="/spamking88" role="link">
            <span>Spam King</span>
          </a>
        </div>
        <div class="css-175oi2r">
          <a href="/spamking88" role="link">
            <span>@spamking88</span>
          </a>
          <span>·</span>
          <a href="/spamking88/status/1720000000000000002"><time>1h</time></a>
        </div>
      </div>
    </div>
    <div data-testid="tweetText">
      🚀 500 USDT Giveaway – Grab Free $TRX on Tron!
      Follow, repost &amp; comment NOW – claim fast!
      <a href="https://t.co/abc123">giveaway-coin.top</a>
      #Crypto #DeFi #Giweaway
    </div>
  </article>
</div>

<div data-testid="cellInnerDiv">
  <article data-testid="tweet" tabindex="0">
    <div>
      <div data-testid="User-Name">
        <div class="css-175oi2r">
          <a href="/cndon91" role="link">
            <span>陈小姐</span>
          </a>
        </div>
        <div class="css-175oi2r">
          <a href="/cndon91" role="link">
            <span>@cndon91</span>
          </a>
          <span>·</span>
          <a href="/cndon91/status/1720000000000000003"><time>5m</time></a>
        </div>
      </div>
    </div>
    <div data-testid="tweetText">
      应该没人比我玩的更开了吧🍒我福不黑不信你看
      <a href="https://t.co/xyz789">example-link.top</a>
    </div>
  </article>
</div>
`;