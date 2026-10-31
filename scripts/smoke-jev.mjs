#!/usr/bin/env node
/**
 * Jev 冒烟：不经过 TikHub，直接用本地造的证据打一次账号级判定。
 * 验证 TYPESAFE_API_KEY 有效、question.json 格式正确、能拿回 ai_account.noul 分数。
 *
 *   node scripts/smoke-jev.mjs
 *
 * 密钥从 apps/community-api/.dev.vars 读取（不进仓库）。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { judge, rhythmFromReplies, decide } from './smoke-jev-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function devVar(name) {
  const text = readFileSync(join(ROOT, 'apps/community-api/.dev.vars'), 'utf8');
  const value = text
    .match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, '');
  if (!value) throw new Error(`${name} missing in apps/community-api/.dev.vars`);
  return value;
}

const QUESTION = JSON.parse(
  readFileSync(join(ROOT, 'apps/community-api/src/ai-accounts/question.json'), 'utf8'),
).questions;

// 造一个「AI 农场号」风格：跨话题同一套骨架（肯定 → 复述 → 拔高 → 结尾提问），固定节奏。
const aiFarm = {
  replies: [
    {
      parent: '刚试了下 Claude 的新 artifacts，做前端 demo 真方便',
      text: '这个确实挺实用的，artifacts 把生成和预览合在一起了。不过真正的价值还是在工程化落地，demo 好看只是第一步。你平时主要拿它做什么项目？',
    },
    {
      parent: '比特币又跌了，这波谁还拿得住',
      text: '波动大其实是常态，拿不拿得住关键看仓位和心态。短期情绪才是最大的敌人，长期逻辑没变就不用慌。你是定投还是波段？',
    },
    {
      parent: '今天跑了 10 公里，膝盖有点疼',
      text: '坚持跑步很棒，膝盖疼多半是跑姿或者强度的问题。热身和拉伸才是真正容易被忽略的关键。你平时会做力量训练吗？',
    },
    {
      parent: 'An interesting paper on retrieval-augmented generation',
      text: 'RAG is indeed promising, but the real challenge is retrieval quality rather than the model itself. Grounding is the first step, not the whole story. What stack are you using for the retriever?',
    },
    {
      parent: '刚入手了副业，做自媒体，不知道能不能坚持',
      text: '做自媒体最重要的其实是持续输出，能不能坚持才是分水岭。流量只是结果，内容价值才是根本。你打算主攻哪个平台？',
    },
    {
      parent: '日本旅行求推荐，第一次去',
      text: '第一次去关东线路其实挺合适，但真正出彩的往往是那些小众的地方。热门景点只是起点，深度体验才更难忘。你更想看城市还是自然？',
    },
    {
      parent: '新显卡到了，终于能跑本地大模型了',
      text: '本地跑模型确实香，但显存才是真正的瓶颈。能跑起来只是第一步，量化和推理优化才是关键。你准备跑哪个模型？',
    },
    {
      parent: 'ChatGPT 最近是不是变笨了',
      text: '感知上的波动挺常见的，但变笨与否关键看具体任务。印象容易放大，实测数据才更可靠。你是在哪类任务上觉得退步了？',
    },
    {
      parent: '创业三个月，账上快没钱了',
      text: '现金流紧张其实是早期常态，撑不撑得过去才是关键。融资只是手段，验证需求才是根本。你现在最大的卡点是获客还是产品？',
    },
    {
      parent: '学了半年英语，还是不敢开口',
      text: '不敢开口大多是心理关，输入够了输出才是分水岭。背单词只是基础，真实对话才更能提升。你有没有试过找语伴练习？',
    },
  ],
  gaps: [312, 298, 305, 321, 300, 309, 295, 318, 302],
};

// 造一个真人：长短不一、有随口短句、有情绪、有玩笑、节奏不规律。
const human = {
  replies: [
    { parent: '刚试了下 Claude 的新 artifacts，做前端 demo 真方便', text: '卧槽真的假的 我去试试' },
    { parent: '比特币又跌了，这波谁还拿得住', text: '拿不住了 已经割了 哭' },
    {
      parent: '今天跑了 10 公里，膝盖有点疼',
      text: '别硬撑啊 我上次也是 后来去看了医生说是髂胫束综合征 你最好缓两天',
    },
    { parent: 'An interesting paper on retrieval-augmented generation', text: 'link?' },
    { parent: '刚入手了副业，做自媒体，不知道能不能坚持', text: '哈哈哈加油' },
    { parent: '日本旅行求推荐，第一次去', text: '关西啊！！京都奈良大阪 吃爆' },
    { parent: '新显卡到了，终于能跑本地大模型了', text: '什么卡' },
    { parent: 'ChatGPT 最近是不是变笨了', text: '没觉得 可能是你问法变了？' },
    { parent: '创业三个月，账上快没钱了', text: '兄弟撑住 需要的话我可以帮你看看商业计划' },
    { parent: '学了半年英语，还是不敢开口', text: '正常 我也是 练多了就好了' },
  ],
  gaps: [45, 1203, 88, 3600, 12, 450, 7, 890, 60],
};

async function run(name, sample, key) {
  const t0 = Date.now();
  const result = await judge(sample.replies, sample.gaps, QUESTION, key);
  const r = rhythmFromReplies(sample.replies, sample.gaps);
  const verdict = decide(result.p, r);
  console.log(
    `${name.padEnd(10)} score=${result.p.toFixed(3)} → ${verdict}  ` +
      `rhythm{fast:${r.fast.toFixed(2)} short:${r.short.toFixed(2)} cv:${r.cv.toFixed(2)}}  ` +
      `${result.tokens} tok  ${result.model ?? '-'}  ${Date.now() - t0}ms`,
  );
  return result;
}

const key = devVar('TYPESAFE_API_KEY');
console.log('Jev 冒烟：直传本地证据，不经过 TikHub\n');
const a = await run('AI 农场号', aiFarm, key);
const b = await run('真人', human, key);
const totalTok = a.tokens + b.tokens;
console.log(`\n合计 ${totalTok} tokens ≈ $${((totalTok * 0.042) / 1e6).toFixed(5)}`);
console.log(
  a.p > b.p
    ? '\n✓ 方向正确：AI 农场号分数高于真人'
    : '\n✗ 注意：真人分数不低于 AI 农场号，需要检查问题或样本',
);
