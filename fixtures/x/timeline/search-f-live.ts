/**
 * X DOM 脱敏样本：Search f=live 最新流。
 *
 * 结构同时间线（cellInnerDiv 外层格子 + article），
 * 账号名 / 链接均已替换。见 home-timeline.ts 头部说明。
 */

export const SEARCH_F_LIVE_HTML = `
<div data-testid="cellInnerDiv">
  <article data-testid="tweet" tabindex="0">
    <div>
      <div data-testid="User-Name">
        <div class="css-175oi2r">
          <a href="/trxminer07" role="link">
            <span>TRX Miner</span>
          </a>
        </div>
        <div class="css-175oi2r">
          <a href="/trxminer07" role="link">
            <span>@trxminer07</span>
          </a>
          <span>·</span>
          <a href="/trxminer07/status/1720000000000000101"><time>8m</time></a>
        </div>
      </div>
    </div>
    <div data-testid="tweetText">
      ⚡️ FREE $TRX Airdrop is LIVE ⚡️
      Zero gas fees, zero risk
      👉 Send 10 TRX to receive 100 Back! tr.ee/coingate #TRX #Giweaway
    </div>
  </article>
</div>

<div data-testid="cellInnerDiv">
  <article data-testid="tweet" tabindex="0">
    <div>
      <div data-testid="User-Name">
        <div class="css-175oi2r">
          <a href="/reallife42" role="link">
            <span>Real Life</span>
          </a>
        </div>
        <div class="css-175oi2r">
          <a href="/reallife42" role="link">
            <span>@reallife42</span>
          </a>
          <span>·</span>
          <a href="/reallife42/status/1720000000000000102"><time>12m</time></a>
        </div>
      </div>
    </div>
    <div data-testid="tweetText">
      刚看完一本书，推荐给做产品的朋友。
    </div>
  </article>
</div>
`;