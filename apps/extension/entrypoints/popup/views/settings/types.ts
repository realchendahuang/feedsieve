/** 二级页发往当前 x.com 标签页的消息（只发给激活的标签页，见 App.sendToXPage）。 */
export type SubpageSendToXPage = (message: {
  type: string;
  handle?: string;
  /** 手动拉黑原因；null = 仅拉黑，不参与社区计票 */
  reason?: unknown;
}) => Promise<unknown>;
