/**
 * AI 味报告的锐评库。每个档位一池，按账号固定抽一条（同一个号每次看到的都一样，
 * 截图、复测、别人再查都不会变）；不传账号时取每池第一条。
 *
 * 写评语的规矩：只评回复的写法，不评人；不涉及外貌、身份、地域、性别；不说脏话。
 */
import type { Lang } from './flavor';

export type RoastPool =
  'aiMax' | 'aiStrong' | 'aiBit' | 'unsure' | 'humanMostly' | 'humanMax' | 'clockwork' | 'uniform';

export const ROASTS: Record<RoastPool, Record<Lang, readonly string[]>> = {
  aiMax: {
    zh: [
      '车轱辘话满天飞，满嘴顺口溜，换个话题照样套',
      '每条回复都像从同一个模板里抽出来的',
      '先夸后捧再升华，最后一定反问你一句',
      '这不是在聊天，是在批量生产评论',
      '话题天南海北，句式一模一样',
      '赞美、总结、反问，一套打完收工',
      '回复工整得像标准答案，就是不像人说的',
      '不管你发什么，TA 都能“深表认同”',
      '看似走心，实则走流程',
      '一条比一条通顺，一条比一条空',
      '金句密度超标，人味浓度见底',
      '“不是……而是……”的含量已严重超标',
      '永远在升华，从不跑题，也从不说具体的事',
      '评论区复读机，换了皮肤照样复读',
      '读完十条，记不住任何一句具体的话',
      '礼貌、正确、圆满，然后什么都没说',
      '文字很满，内容很空',
      '每条都能原封不动贴到任何一个帖子下面',
      '情绪零波动，观点零风险',
      '句句都是总结陈词，没有一句是闲聊',
      '这个文风，提示词都快写在脸上了',
      '不像在回复你，像在完成今天的 KPI',
      '把“说得很对”写出了一百种排列组合',
      '经验之谈一大堆，具体经历一条没有',
      '人设很完整，细节一个都没有',
      '每条都在“补充一个角度”，补完还是那个角度',
      '回复像说明书，准确但没人想读',
      '整齐到让人怀疑 TA 有没有手',
    ],
    en: [
      'Same talking points on every topic, just swap the nouns',
      'Praise, restate, elevate, end with a question. Every single time',
      'Not chatting, mass-producing comments',
      'Polished, correct, and saying nothing at all',
      'Every reply could be pasted under any post',
      'Zero mood swings, zero risk, zero personality',
      'The prompt is practically visible',
      'Reads like a press release, replies like a press release',
      'Lots of “great point”, no actual points',
      'A full persona with no details',
    ],
  },
  aiStrong: {
    zh: [
      '每条都像同一个模板，先夸一句再升华，最后反问你',
      '措辞在变，套路没变',
      '结构整齐得像开会纪要',
      '偶尔装作随意，句子还是太工整',
      '结尾问号的出现频率有点高',
      '认真得不太正常，一句废话都没有',
      '话术感很重，聊天感很轻',
      '每条都很有道理，每条都差不多',
      '读起来顺，回味起来空',
      '总说“这个思路很好”，从不说哪里好',
      '观点四平八稳，立场从不冒险',
      '换个账号发，也完全看不出区别',
      '句式骨架太眼熟了',
      '夸人有固定配方',
      '爱说“关键在于”，从不说关键是什么',
      '回复像样板间，好看但没人住',
      '有点像真人，又有点像客服',
      '没有错别字，也没有脾气',
      '很会接话，不太会聊天',
      '每条都在总结，没有一条在闲聊',
      '热情是统一配发的',
      '标点比情绪还稳定',
    ],
    en: [
      'Praise, restate, elevate, end with a question',
      'The wording changes, the template doesn’t',
      'Structured like meeting minutes',
      'Very reasonable, very similar, every time',
      'Smooth to read, nothing left after',
      'No typos, no temper',
      'Great at replying, not so great at talking',
      'Enthusiasm issued in standard sizes',
    ],
  },
  aiBit: {
    zh: [
      '说得挺像人，就是工整得不像随手打的',
      '大部分像本人，偶尔冒出几句模板话',
      '有人味，但打了一层蜡',
      '可能是认真的人，也可能用了点工具',
      '平时挺正常，一客套就像换了个人',
      '偶尔出现标准答案式的回复',
      '句子太顺了，顺得有点可疑',
      '能看出性格，也能看出套路',
      '半手工，半自动',
      '像先写了草稿，再让 AI 润了色',
      '多数时候在聊天，少数时候在交作业',
      '语气挺自然，结构有点板',
      '情绪是真的，措辞是修过的',
      '像真人在上班状态下回复',
      '有观点，表达方式有点模板',
      '偶尔说人话，偶尔说官话',
      '底色是人，滤镜是 AI',
      '手打和代写混着来',
    ],
    en: [
      'Sounds human, just a little too polished',
      'Mostly them, with the odd template line',
      'Human, with a coat of wax',
      'Drafted by a person, polished by a model',
      'Natural tone, stiff structure',
      'Half handmade, half automated',
    ],
  },
  unsure: {
    zh: [
      '要么是 AI，要么是特别爱说场面话的真人',
      '模型也挠头了，建议你看看 TA 的回复自己判断',
      '可能只是礼貌过头的真人',
      '一半像客套，一半像套路',
      '场面话很多，证据不太够',
      '像人，又不完全像人',
      '话少又客气，看不太出来',
      '可能只是比较会说话',
      '有嫌疑，但不敢下结论',
      '这个账号的边界有点模糊',
      '社区投票说了算，你来投一票',
      '再观察观察，下次测也许就清楚了',
    ],
    en: [
      'Either a bot or someone who loves stock phrases',
      'Even the model is scratching its head',
      'Maybe just a very polite human',
      'Suspicious, but not enough to call it',
      'Let the community vote decide',
      'Check again later; it may become clearer',
    ],
  },
  humanMostly: {
    zh: [
      '偶尔客套，但看得出是本人在打字',
      '有长有短，有认真有敷衍，很正常',
      '能看出脾气，也能看出口头禅',
      '回复里有具体经历，不是空话',
      '客气是客气，但能听出是本人在说话',
      '偶尔废话，偶尔金句，很真实',
      '像个正常网友：时而认真，时而划水',
      '话题一变，语气也跟着变',
      '回复长短全看心情',
      '会说“哈哈”，也会说“我不同意”',
      '有自己的观点，也敢说出来',
      '回得不整齐，但很真诚',
      '偶尔打错字，人味加分',
      '会接梗，也会跑题',
      '看得出在认真看帖',
      '有温度，有态度',
      '不完美，但很人类',
      '偶尔营业，主要还是本人',
    ],
    en: [
      'Some pleasantries, but clearly typed by a person',
      'Long, short, serious, lazy. Normal',
      'Real opinions, real experiences',
      'Messy but sincere',
      'Typos included, humanity confirmed',
      'Not perfect, very human',
    ],
  },
  humanMax: {
    zh: [
      '长短随心，有情绪有废话，纯手工打字',
      '这种回复，AI 写不出来',
      '纯天然手打，无任何添加',
      '想到哪说到哪，活人本人',
      '情绪起伏比 K 线还大',
      '回复全凭心情，非常真实',
      '敢抬杠、会玩梗、不装',
      '一会儿认真一会儿发癫，标准碳基生物',
      '废话含量充足，人味拉满',
      '每条都带着本人的口音',
      '错别字和表情包都很真诚',
      '这种乱中有序的风格，模型模仿不来',
      '说话不打草稿，也不打官腔',
      '抬杠、玩梗、夸人都很有个人风格',
      '活人认证，盖章',
      '有梗有刺有温度',
      '打字速度跟着情绪走',
      '短到只剩语气词，非常人类',
      '一看就是本人，连标点都很随性',
      '网感十足，模板免疫',
      '认真起来很长，懒起来一个字',
      '可能偶尔嘴硬，但绝对是人',
    ],
    en: [
      'Messy, moody, typed by hand',
      'No model would write replies like these',
      '100% handmade, no additives',
      'Says what comes to mind. Certified human',
      'Mood swings bigger than the market',
      'Template-immune',
      'Sometimes one word, sometimes an essay',
      'Punctuation as chaotic as a real person',
    ],
  },
  clockwork: {
    zh: [
      '回复间隔准得像闹钟，比上班打卡还守时',
      '几乎每隔几分钟准时冒一条，像定了闹钟',
      '发言节奏比地铁时刻表还稳',
      '回复间隔整整齐齐，像排过班',
      '准时准点，风雨无阻',
      '回复像流水线，几分钟出一件',
      '节奏规律得不像在刷手机',
      '不吃饭不喝水，按时回复',
    ],
    en: [
      'Replies arrive like clockwork, more punctual than a time card',
      'Steadier than a train timetable',
      'One reply every few minutes, on the dot',
      'An assembly line of replies',
    ],
  },
  uniform: {
    zh: [
      '每条长度都差不多，像拿尺子量过',
      '字数整齐划一，像按模板填空',
      '长度分毫不差，像有字数要求',
      '每条都是标准长度，不多一句不少一句',
      '篇幅稳定得像在写作业',
      '长度工整得像排过版',
    ],
    en: [
      'Every reply is the same length, as if measured with a ruler',
      'Word counts as tidy as a fill-in-the-blank form',
      'Standard length, every time',
      'Consistent like homework with a word limit',
    ],
  },
};

/** FNV-1a：同一个账号 + 档位永远抽到同一条 */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function pickRoast(pool: RoastPool, lang: Lang, seed?: string): string {
  const lines = ROASTS[pool][lang];
  if (!seed) return lines[0]!;
  return lines[hash(`${seed.toLowerCase()}:${pool}`) % lines.length]!;
}
