/**
 * 福滤娃官方静音词库（候选池）。
 *
 * 只是候选，不会自动生效：用户在「静音 › 词库」里逐条确认后写入 X 原生静音词。
 * 词条刻意选得具体，避免「空投」「兼职」这种大词把正常讨论一起挡掉。
 */
export interface MutePack {
  id: string;
  version: string;
  name: { zh: string; en: string };
  description: { zh: string; en: string };
  words: string[];
}

export const OFFICIAL_PACK_VERSION = '2026.11.1';

export const OFFICIAL_MUTE_PACKS: readonly MutePack[] = [
  {
    id: 'adult_traffic',
    version: OFFICIAL_PACK_VERSION,
    name: { zh: '色情引流', en: 'Adult traffic' },
    description: {
      zh: '同城、上门、福利视频一类引流话术。',
      en: 'Local hookups, home visits and "福利" video bait.',
    },
    words: [
      '同城约',
      '上门服务',
      '福利视频',
      '私密视频',
      '裸聊',
      '楼凤',
      '外围女',
      '资源群',
      '约炮',
      '成人视频',
    ],
  },
  {
    id: 'crypto_scam',
    version: OFFICIAL_PACK_VERSION,
    name: { zh: '币圈骗局', en: 'Crypto scams' },
    description: {
      zh: '免费空投、带单老师、稳赚不赔等常见话术。',
      en: 'Free airdrops, signal sellers and guaranteed-profit bait.',
    },
    words: [
      '空投领取',
      '免费空投',
      'USDT空投',
      '稳赚不赔',
      '带单老师',
      '合约跟单',
      '白名单Mint',
      '钱包地址',
      '质押挖矿',
      '一夜暴富',
    ],
  },
  {
    id: 'ad_traffic',
    version: OFFICIAL_PACK_VERSION,
    name: { zh: '广告引流', en: 'Ad traffic' },
    description: {
      zh: '加微信、扫码领取、代理加盟一类硬广。',
      en: 'Add-me-on-WeChat, scan-to-claim and agency recruitment ads.',
    },
    words: [
      '加微信',
      '加V',
      '扫码领取',
      '免费领取',
      '点击链接',
      '私信我',
      '限时优惠',
      '代理加盟',
      '推广合作',
      '日入过千',
    ],
  },
  {
    id: 'fake_jobs',
    version: OFFICIAL_PACK_VERSION,
    name: { zh: '刷单兼职', en: 'Fake jobs' },
    description: {
      zh: '刷单、点赞赚钱、在家日结一类任务盘。',
      en: 'Brushing, like-for-pay and work-from-home task scams.',
    },
    words: [
      '刷单',
      '兼职日结',
      '在家赚钱',
      '手机赚钱',
      '点赞赚钱',
      '任务佣金',
      '无门槛兼职',
      '招收代理',
      '躺赚',
      '日结工资',
    ],
  },
  {
    id: 'english_spam',
    version: OFFICIAL_PACK_VERSION,
    name: { zh: '英文垃圾流量', en: 'English spam' },
    description: {
      zh: '英文时间线里常见的空投、导流和涨粉话术。',
      en: 'Common English airdrop, traffic and follower-growth spam.',
    },
    words: [
      'crypto giveaway',
      'free airdrop',
      'guaranteed profit',
      'make money online',
      'click the link',
      'link in bio',
      'promo code',
      'join my telegram',
    ],
  },
];
