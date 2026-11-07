/**
 * community-api 的 PostgreSQL 表结构（Drizzle）。改表流程：改这里 → `pnpm db:generate --name <名字>`
 * → 审阅 `drizzle/` 下生成的 SQL → 和代码一起提交。
 *
 * 由 D1（SQLite）迁来，数据表示保持不变，避免改动接口和快照的语义：
 * - 时间戳是 Unix 秒（少数是毫秒，见列注释），用 bigint，按 JS number 读写；
 * - 开关列是 0/1 整数（带 CHECK），不是 boolean；
 * - JSON 存在 text 列里，读写时自己 JSON.parse / stringify。
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/** Unix 时间戳 / 大计数：bigint，按 JS number 读写（不会超过 2^53） */
const ts = (name: string) => bigint(name, { mode: 'number' });
/** 自增主键 */
const serialId = () => bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity();
/** 0/1 开关 */
const flag = (name: string) => integer(name).notNull().default(1);

// ---------------------------------------------------------------------------
// 账号与投票
// ---------------------------------------------------------------------------

export const accounts = pgTable(
  'accounts',
  {
    handle: text('handle').primaryKey(),
    xUserId: text('x_user_id'),
    category: text('category').notNull().default('other'),
    status: text('status').notNull().default('candidate'),
    reportCount: integer('report_count').notNull().default(0),
    rescueCount: integer('rescue_count').notNull().default(0),
    firstReportAt: ts('first_report_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
    /** JSON 数组：历史 handle（改名前的名字） */
    aliases: text('aliases').notNull().default('[]'),
    ownerVotes: integer('owner_votes').notNull().default(0),
    statusV2: text('status_v2').notNull().default('new'),
    /**
     * 是否在当前公开名单里（0/1）：由快照发布写入，和扩展实际下载的名单同一口径（政策 v4：
     * 独立性、佐证上榜、排除已注销账号、维护者条目、白名单让位）。后台概览、热榜、主页洞察、
     * 贡献统计都看它，不再各自按「净票 ≥ 3」算。
     */
    listed: integer('listed').notNull().default(0),
    consensusV2: doublePrecision('consensus_v2'),
  },
  (t) => [
    index('idx_accounts_x_user_id').on(t.xUserId),
    check('ck_accounts_aliases', sql`jsonb_typeof(${t.aliases}::jsonb) = 'array'`),
    check('ck_accounts_listed', sql`${t.listed} in (0, 1)`),
  ],
);

export const accountHealth = pgTable(
  'account_health',
  {
    handle: text('handle').primaryKey(),
    xUserId: text('x_user_id'),
    state: text('state', { enum: ['unknown', 'alive', 'dead'] })
      .notNull()
      .default('unknown'),
    source: text('source', { enum: ['kill-report', 'cron-prober', 'passive-signal'] }).notNull(),
    probeCount: integer('probe_count').notNull().default(0),
    confirmedAliveAt: ts('confirmed_alive_at'),
    terminalCheckedAt: ts('terminal_checked_at'),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    index('idx_account_health_recheck')
      .on(t.updatedAt)
      .where(sql`${t.state} <> 'dead'`),
    check('ck_account_health_state', sql`${t.state} in ('unknown', 'alive', 'dead')`),
    check(
      'ck_account_health_source',
      sql`${t.source} in ('kill-report', 'cron-prober', 'passive-signal')`,
    ),
  ],
);

/** 每个安装对每个账号的当前标签：唯一计票源 */
export const activeLabels = pgTable(
  'active_labels',
  {
    installationId: text('installation_id').notNull(),
    handle: text('handle').notNull(),
    label: text('label', { enum: ['blocked', 'allowed'] }).notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.installationId, t.handle] }),
    index('idx_active_labels_handle_label').on(t.handle, t.label),
    check('ck_active_labels_label', sql`${t.label} in ('blocked', 'allowed')`),
  ],
);

export const consensusEvents = pgTable(
  'consensus_events',
  {
    handle: text('handle').primaryKey(),
    xUserId: text('x_user_id'),
    confirmedAt: ts('confirmed_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [index('idx_consensus_events_confirmed').on(t.confirmedAt)],
);

export const reports = pgTable(
  'reports',
  {
    id: serialId(),
    handle: text('handle').notNull(),
    xUserId: text('x_user_id'),
    reason: text('reason').notNull(),
    evidencePostId: text('evidence_post_id'),
    installationId: text('installation_id').notNull(),
    clientVersion: text('client_version'),
    createdAt: ts('created_at').notNull(),
    contentFingerprint: text('content_fingerprint'),
    /** JSON 数组 */
    linkDomains: text('link_domains'),
    detectionSource: text('detection_source'),
    tweetText: text('tweet_text'),
    displayName: text('display_name'),
    bio: text('bio'),
    ruleId: text('rule_id'),
    /** JSON 数组 */
    signalIds: text('signal_ids'),
  },
  (t) => [
    index('idx_reports_created_at').on(t.createdAt),
    index('idx_reports_fingerprint')
      .on(t.contentFingerprint)
      .where(sql`${t.contentFingerprint} is not null`),
    index('idx_reports_handle').on(t.handle),
    uniqueIndex('idx_reports_installation_handle').on(t.installationId, t.handle),
    index('idx_reports_rule_id')
      .on(t.ruleId)
      .where(sql`${t.ruleId} is not null`),
    check(
      'ck_reports_link_domains',
      sql`${t.linkDomains} is null or jsonb_typeof(${t.linkDomains}::jsonb) = 'array'`,
    ),
    check(
      'ck_reports_signal_ids',
      sql`${t.signalIds} is null or jsonb_typeof(${t.signalIds}::jsonb) = 'array'`,
    ),
  ],
);

export const rescues = pgTable(
  'rescues',
  {
    id: serialId(),
    handle: text('handle').notNull(),
    evidencePostId: text('evidence_post_id'),
    installationId: text('installation_id').notNull(),
    clientVersion: text('client_version'),
    createdAt: ts('created_at').notNull(),
    detectionSource: text('detection_source'),
    ruleId: text('rule_id'),
    detectionReason: text('detection_reason'),
    xUserId: text('x_user_id'),
  },
  (t) => [
    index('idx_rescues_created_at').on(t.createdAt),
    index('idx_rescues_handle').on(t.handle),
    uniqueIndex('idx_rescues_installation_handle').on(t.installationId, t.handle),
    index('idx_rescues_rule_id').on(t.ruleId),
  ],
);

// ---------------------------------------------------------------------------
// 安装与配额
// ---------------------------------------------------------------------------

export const installations = pgTable('installations', {
  /** 加盐哈希后的安装 ID */
  id: text('id').primaryKey(),
  firstSeenAt: ts('first_seen_at').notNull(),
  lastSeenAt: ts('last_seen_at').notNull(),
  reportsDay: text('reports_day').notNull().default(''),
  reportsToday: integer('reports_today').notNull().default(0),
  rescuesDay: text('rescues_day').notNull().default(''),
  rescuesToday: integer('rescues_today').notNull().default(0),
  trust: doublePrecision('trust').notNull().default(1),
  displayName: text('display_name'),
  bio: text('bio'),
  emailHash: text('email_hash'),
  emailVerifiedAt: ts('email_verified_at'),
  title: text('title'),
  retractsDay: text('retracts_day').notNull().default(''),
  retractsToday: integer('retracts_today').notNull().default(0),
  aliasesDay: text('aliases_day').notNull().default(''),
  aliasesToday: integer('aliases_today').notNull().default(0),
  xHandle: text('x_handle'),
});

export const ipUsage = pgTable('ip_usage', {
  ipHash: text('ip_hash').primaryKey(),
  day: text('day').notNull(),
  reportsToday: integer('reports_today').notNull().default(0),
});

export const emailCodes = pgTable(
  'email_codes',
  {
    emailHash: text('email_hash').primaryKey(),
    installerHash: text('installer_hash').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    sendCount: integer('send_count').notNull().default(0),
    createdAt: ts('created_at').notNull(),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [index('idx_email_codes_installer').on(t.installerHash, t.createdAt.desc())],
);

export const emailSendUsage = pgTable('email_send_usage', {
  installerHash: text('installer_hash').primaryKey(),
  windowStart: ts('window_start').notNull(),
  sendCount: integer('send_count').notNull().default(0),
});

// ---------------------------------------------------------------------------
// 白名单申请
// ---------------------------------------------------------------------------

export const applications = pgTable(
  'applications',
  {
    id: serialId(),
    handle: text('handle').notNull(),
    kind: text('kind').notNull(),
    statement: text('statement').notNull(),
    emailHash: text('email_hash').notNull(),
    status: text('status').notNull().default('pending'),
    ipHash: text('ip_hash').notNull(),
    createdAt: ts('created_at').notNull(),
    verifiedAt: ts('verified_at'),
    decidedAt: ts('decided_at'),
    decidedBy: text('decided_by'),
    decisionNote: text('decision_note'),
  },
  (t) => [
    index('idx_applications_email').on(t.emailHash, t.createdAt.desc()),
    index('idx_applications_handle').on(t.handle, t.createdAt.desc()),
    index('idx_applications_status').on(t.status, t.createdAt.desc()),
  ],
);

export const applicationIpUsage = pgTable('application_ip_usage', {
  ipHash: text('ip_hash').primaryKey(),
  day: text('day').notNull(),
  submissionsToday: integer('submissions_today').notNull().default(0),
});

// ---------------------------------------------------------------------------
// 维护者名单与后台
// ---------------------------------------------------------------------------

export const maintainerBlocklist = pgTable(
  'maintainer_blocklist',
  {
    handle: text('handle').primaryKey(),
    xUserId: text('x_user_id'),
    category: text('category').notNull(),
    reason: text('reason').notNull(),
    evidencePostId: text('evidence_post_id'),
    active: flag('active'),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    index('idx_maintainer_blocklist_active').on(t.active, t.handle),
    check('ck_maintainer_blocklist_active', sql`${t.active} in (0, 1)`),
  ],
);

export const maintainerBlocklistAudit = pgTable(
  'maintainer_blocklist_audit',
  {
    id: serialId(),
    action: text('action', { enum: ['add', 'remove', 'update'] }).notNull(),
    handle: text('handle').notNull(),
    category: text('category'),
    reason: text('reason'),
    evidencePostId: text('evidence_post_id'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    index('idx_maintainer_blocklist_audit_handle').on(t.handle, t.createdAt.desc()),
    check('ck_maintainer_blocklist_audit_action', sql`${t.action} in ('add', 'remove', 'update')`),
  ],
);

export const maintainerWhitelist = pgTable(
  'maintainer_whitelist',
  {
    handle: text('handle').primaryKey(),
    xUserId: text('x_user_id'),
    note: text('note').notNull(),
    active: flag('active'),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
    name: text('name'),
    avatarUrl: text('avatar_url'),
  },
  (t) => [
    index('idx_maintainer_whitelist_active').on(t.active, t.handle),
    check('ck_maintainer_whitelist_active', sql`${t.active} in (0, 1)`),
  ],
);

export const maintainerWhitelistAudit = pgTable(
  'maintainer_whitelist_audit',
  {
    id: serialId(),
    action: text('action', { enum: ['add', 'remove', 'update'] }).notNull(),
    handle: text('handle').notNull(),
    note: text('note'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    index('idx_maintainer_whitelist_audit_handle').on(t.handle, t.createdAt.desc()),
    check('ck_maintainer_whitelist_audit_action', sql`${t.action} in ('add', 'remove', 'update')`),
  ],
);

export const adminAccountDrafts = pgTable(
  'admin_account_drafts',
  {
    handle: text('handle').primaryKey(),
    xUserId: text('x_user_id'),
    category: text('category').notNull(),
    note: text('note').notNull(),
    evidencePostId: text('evidence_post_id'),
    active: flag('active'),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    index('idx_admin_account_drafts_active').on(t.active, t.updatedAt.desc(), t.handle),
    check('ck_admin_account_drafts_active', sql`${t.active} in (0, 1)`),
  ],
);

export const adminAuditLog = pgTable(
  'admin_audit_log',
  {
    id: serialId(),
    actorEmail: text('actor_email').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    /** JSON 对象 */
    detail: text('detail').notNull().default('{}'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('idx_admin_audit_created').on(t.createdAt.desc())],
);

export const adminKeywordPacks = pgTable(
  'admin_keyword_packs',
  {
    id: text('id').primaryKey(),
    nameZh: text('name_zh').notNull(),
    nameEn: text('name_en').notNull(),
    descriptionZh: text('description_zh').notNull(),
    descriptionEn: text('description_en').notNull(),
    /** JSON 数组 */
    sourceRefs: text('source_refs').notNull().default('[]'),
    active: flag('active'),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [check('ck_admin_keyword_packs_active', sql`${t.active} in (0, 1)`)],
);

export const adminKeywordRules = pgTable(
  'admin_keyword_rules',
  {
    id: text('id').primaryKey(),
    packId: text('pack_id')
      .notNull()
      .references(() => adminKeywordPacks.id),
    phrase: text('phrase').notNull(),
    /** JSON 数组 */
    terms: text('terms'),
    maxGap: integer('max_gap'),
    active: flag('active'),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    index('idx_admin_keyword_rules_pack').on(t.packId, t.active, t.phrase),
    check('ck_admin_keyword_rules_active', sql`${t.active} in (0, 1)`),
  ],
);

export const adminReleases = pgTable(
  'admin_releases',
  {
    id: serialId(),
    kind: text('kind', { enum: ['accounts', 'keywords'] }).notNull(),
    version: text('version').notNull(),
    actorEmail: text('actor_email').notNull(),
    /** JSON 对象 */
    detail: text('detail').notNull().default('{}'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    index('idx_admin_releases_created').on(t.createdAt.desc(), t.id.desc()),
    check('ck_admin_releases_kind', sql`${t.kind} in ('accounts', 'keywords')`),
  ],
);

// ---------------------------------------------------------------------------
// 关键词贡献
// ---------------------------------------------------------------------------

export const keywordContributions = pgTable(
  'keyword_contributions',
  {
    normPhrase: text('norm_phrase').notNull(),
    installationId: text('installation_id').notNull(),
    displayPhrase: text('display_phrase').notNull(),
    clientVersion: text('client_version'),
    status: text('status').notNull().default('new'),
    createdAt: ts('created_at').notNull(),
    decidedAt: ts('decided_at'),
    decidedBy: text('decided_by'),
  },
  (t) => [
    primaryKey({ columns: [t.normPhrase, t.installationId] }),
    index('idx_keyword_contrib_created').on(t.createdAt.desc()),
  ],
);

export const keywordContribUsage = pgTable('keyword_contrib_usage', {
  submissionKey: text('submission_key').primaryKey(),
  day: text('day').notNull(),
  used: integer('used').notNull().default(0),
});

// ---------------------------------------------------------------------------
// 热帖
// ---------------------------------------------------------------------------

export const hotPosts = pgTable(
  'hot_posts',
  {
    postId: text('post_id').primaryKey(),
    handle: text('handle').notNull(),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    verified: integer('verified'),
    followers: ts('followers'),
    /** 毫秒 */
    createdAt: ts('created_at').notNull(),
    snippet: text('snippet'),
    mediaUrl: text('media_url'),
    lang: text('lang'),
    views: ts('views').notNull().default(0),
    likes: ts('likes'),
    retweets: ts('retweets'),
    replies: ts('replies'),
    quotes: ts('quotes'),
    bookmarks: ts('bookmarks'),
    /** 毫秒 */
    firstSeen: ts('first_seen').notNull(),
    /** 毫秒 */
    lastSeen: ts('last_seen').notNull(),
  },
  (t) => [index('idx_hot_posts_last_seen').on(t.lastSeen)],
);

export const hotObservations = pgTable(
  'hot_observations',
  {
    postId: text('post_id').notNull(),
    bucket: ts('bucket').notNull(),
    reporter: text('reporter').notNull(),
    views: ts('views').notNull(),
    /** 上报者 IP 段（IPv4 /24、IPv6 /48）的加盐哈希前 16 位：上榜要求来自不同网段，防一台机器换会话刷榜。 */
    net: text('net'),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.bucket, t.reporter] }),
    index('idx_hot_observations_bucket').on(t.bucket),
  ],
);

// ---------------------------------------------------------------------------
// 规则命中（众包的「疑似」信号，见 rule-hits.ts）：不是票，不直接上榜
// ---------------------------------------------------------------------------

export const ruleHits = pgTable(
  'rule_hits',
  {
    handle: text('handle').notNull(),
    /** 规则 ID：只收官方规则和内置启发式（个人自定义词不上报） */
    ruleId: text('rule_id').notNull(),
    /** UTC 日期 YYYY-MM-DD：同一会话同一账号同一规则每天只记一次 */
    day: text('day').notNull(),
    /** 每日轮换的随机会话 ID 的加盐哈希（不是安装 ID） */
    reporter: text('reporter').notNull(),
    /** 上报者 IP 网段 + 日期的加盐哈希前 16 位（判独立性用） */
    net: text('net'),
    source: text('source').notNull(),
    category: text('category'),
    /** 正文 SimHash 指纹（跨用户聚类同模板账号） */
    fingerprint: text('fingerprint'),
    xUserId: text('x_user_id'),
    postId: text('post_id'),
    /** Unix 秒 */
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.handle, t.ruleId, t.day, t.reporter] }),
    index('idx_rule_hits_rule_day').on(t.ruleId, t.day),
    index('idx_rule_hits_day').on(t.day),
    index('idx_rule_hits_fingerprint')
      .on(t.fingerprint)
      .where(sql`${t.fingerprint} is not null`),
  ],
);

// ---------------------------------------------------------------------------
// 主页洞察（众包的博主帖子库，见 profiles.ts）
// ---------------------------------------------------------------------------

export const profileAccounts = pgTable(
  'profile_accounts',
  {
    handle: text('handle').primaryKey(),
    /** 帖子表里用这个 4 字节的号代替 handle 文本 */
    id: integer('id').notNull().generatedByDefaultAsIdentity(),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    verified: integer('verified'),
    followers: ts('followers'),
    followingCount: ts('following_count'),
    tweets: ts('tweets'),
    /** 毫秒：注册时间 */
    joinedAt: ts('joined_at'),
    /** 毫秒 */
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    check('ck_profile_accounts_verified', sql`${t.verified} is null or ${t.verified} in (0, 1)`),
    unique('uq_profile_accounts_id').on(t.id),
  ],
);

/**
 * 主页帖子库的帖子：按行数精打细算（帖子会很多，三个节点各存一份，见 docs/07 §3.7）。
 * - post_id 存 bigint（不是文本）；发帖时间不存，从 snowflake ID 算；
 * - 作者存 profile_accounts.id（4 字节），不在每行重复 handle；
 * - 类型、媒体类型、置顶压进一个 smallint（flags，编码见 profiles.ts）；
 * - 图片地址只存 pbs.twimg.com/ 后面的部分；
 * - 除浏览以外的计数用 integer；
 * - 只给 creator_id 建索引（不含 updated_at）：数字更新不改任何索引列，能走 HOT 更新，
 *   不产生索引膨胀；表的 fillfactor 85 给 HOT 留页内空间（迁移 SQL 里设置）。
 */
export const profilePosts = pgTable(
  'profile_posts',
  {
    postId: bigint('post_id', { mode: 'bigint' }).primaryKey(),
    creatorId: integer('creator_id')
      .notNull()
      .references(() => profileAccounts.id, { onDelete: 'cascade' }),
    flags: smallint('flags').notNull().default(0),
    lang: text('lang'),
    snippet: text('snippet'),
    /** pbs.twimg.com/ 后面的路径 */
    media: text('media'),
    views: ts('views'),
    likes: integer('likes'),
    retweets: integer('retweets'),
    replies: integer('replies'),
    quotes: integer('quotes'),
    bookmarks: integer('bookmarks'),
    /** 毫秒：内容最后一次变化（增量拉取的游标） */
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [index('idx_profile_posts_creator').on(t.creatorId)],
);

// ---------------------------------------------------------------------------
// 训练样本
// ---------------------------------------------------------------------------

export const trainingSamples = pgTable(
  'training_samples',
  {
    id: serialId(),
    installationId: text('installation_id').notNull(),
    eventId: text('event_id').notNull(),
    handle: text('handle').notNull(),
    action: text('action').notNull(),
    observedAt: ts('observed_at').notNull(),
    receivedAt: ts('received_at').notNull(),
    contentHash: text('content_hash').notNull(),
    /** JSON 对象 */
    payload: text('payload').notNull(),
  },
  (t) => [
    unique('uq_training_samples_event').on(t.installationId, t.eventId),
    index('idx_training_samples_content').on(t.contentHash),
    index('idx_training_samples_received').on(t.receivedAt, t.id),
  ],
);

export const trainingSampleReviews = pgTable(
  'training_sample_reviews',
  {
    id: serialId(),
    sampleId: bigint('sample_id', { mode: 'number' })
      .notNull()
      .references(() => trainingSamples.id),
    verdict: text('verdict', { enum: ['spam', 'normal', 'uncertain'] }).notNull(),
    family: text('family').notNull(),
    /** JSON 数组 */
    tags: text('tags').notNull(),
    note: text('note').notNull(),
    reviewer: text('reviewer').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    index('idx_training_reviews_sample').on(t.sampleId, t.id.desc()),
    check(
      'ck_training_sample_reviews_verdict',
      sql`${t.verdict} in ('spam', 'normal', 'uncertain')`,
    ),
  ],
);

export const trainingSampleUsage = pgTable(
  'training_sample_usage',
  {
    identity: text('identity').notNull(),
    day: text('day').notNull(),
    count: integer('count').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.identity, t.day] }),
    index('idx_training_sample_usage_day').on(t.day),
  ],
);

// ---------------------------------------------------------------------------
// AI 号判定（docs/06 第 3 节）
// ---------------------------------------------------------------------------

export const aiAccountVerdicts = pgTable(
  'ai_account_verdicts',
  {
    /** 小写 handle */
    handle: text('handle').primaryKey(),
    xUserId: text('x_user_id'),
    /** ai / suspect / human / insufficient */
    verdict: text('verdict').notNull(),
    /** Jev ai_account 概率（0–1） */
    score: doublePrecision('score'),
    /** 1 / 0 / NULL（未知） */
    blueVerified: integer('blue_verified'),
    replyCount: integer('reply_count').notNull().default(0),
    /** JSON 数组：参与判定的回复 ID */
    replyIds: text('reply_ids'),
    /** JSON：{ fast, short, cv } */
    rhythm: text('rhythm'),
    model: text('model'),
    questionVersion: integer('question_version').notNull(),
    /** 秒 */
    judgedAt: ts('judged_at').notNull(),
    /** 秒；过期后有人再遇到才重判 */
    expiresAt: ts('expires_at').notNull(),
    /** 提交这份证据的安装（加盐哈希）；服务端自己拉的证据（/check）为 NULL */
    submitter: text('submitter'),
    /**
     * 1 = 可以向所有人展示：第二个独立安装交来重合的证据、两次判定一致，或服务端自己拉的证据。
     * 0 = 只有提交者本人能看到（扩展的证据可以伪造，单人结论不公开）。
     */
    confirmed: integer('confirmed').notNull().default(0),
    /** 秒：维护者复核时间；复核前「是真人」票 ≥ 3 或有申诉时暂停公开展示 */
    reviewedAt: ts('reviewed_at'),
    reviewedBy: text('reviewed_by'),
    /** 公开结果页 / OG 图用：检测时页面上的昵称与头像（头像只认 pbs.twimg.com） */
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
  },
  (t) => [
    check('ck_ai_account_verdicts_confirmed', sql`${t.confirmed} in (0, 1)`),
    index('idx_ai_account_verdicts_verdict').on(t.verdict, t.judgedAt),
    index('idx_ai_account_verdicts_expires').on(t.expiresAt),
  ],
);

/**
 * AI 号的人工投票：每个安装对每个账号保留一张当前票（可改票，UPSERT）。
 * 共识门槛（读时聚合，不冗余存计数）：ai 票 ≥ 3 且 ai 票 > human 票 → 进公共 AI 号名单；
 * human 票追平或反超即撤出。单个用户伪造证据判出的 AI 结论进不了名单，必须多人独立确认。
 */
export const aiAccountVotes = pgTable(
  'ai_account_votes',
  {
    handle: text('handle').notNull(),
    installationId: text('installation_id').notNull(),
    vote: text('vote', { enum: ['ai', 'human'] }).notNull(),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.handle, t.installationId] }),
    index('idx_ai_account_votes_handle').on(t.handle, t.vote),
    check('ck_ai_account_votes_vote', sql`${t.vote} in ('ai', 'human')`),
  ],
);

/**
 * AI 号广场的回复样本：参与判定的公开回复正文摘要，页面展示「它最近回复了什么」。
 * 只给 ai / suspect 存；重判落到 human 时按 handle 全量删除（不给真人留存），insufficient 不写不删。
 * 每 handle 最多保留 20 条（写入后按 created_at 裁剪）。正文 ≤200 码点、原帖 ≤80 码点，业务层截断。
 * source 已知值：judge（扩展直传 / TikHub 判定落库）、backfill（回填脚本）；本地种子另有 seed。
 */
export const aiAccountSamples = pgTable(
  'ai_account_samples',
  {
    /** 小写 handle */
    handle: text('handle').notNull(),
    /** 该账号自己的回复 ID（snowflake） */
    tweetId: text('tweet_id').notNull(),
    /** 被回复的原帖 ID；扩展直传路径拿不到，TikHub / 回填路径才有 */
    parentId: text('parent_id'),
    /** 回复正文，≤200 码点 */
    text: text('text').notNull(),
    /** 原帖摘要，≤80 码点 */
    parentText: text('parent_text'),
    /** 秒，从 snowflake 算；算不出为 NULL */
    postedAt: ts('posted_at'),
    /** 与上一条回复的间隔（秒） */
    gapSeconds: integer('gap_seconds'),
    source: text('source').notNull(),
    /** 秒 */
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.handle, t.tweetId] }),
    index('idx_ai_account_samples_handle').on(t.handle, t.createdAt.desc()),
  ],
);

// ---------------------------------------------------------------------------
// 快照、杂项（旧 D1 的 seasons 表属于已删除的排位赛，没有迁过来）
// ---------------------------------------------------------------------------

export const snapshots = pgTable(
  'snapshots',
  {
    version: text('version').primaryKey(),
    manifestJson: text('manifest_json').notNull(),
    filesJson: text('files_json').notNull(),
    createdAt: ts('created_at').notNull(),
    signatureJson: text('signature_json'),
  },
  (t) => [
    index('idx_snapshots_created_at').on(t.createdAt),
    // 版本号 YYYY.MM.DD.N：「最新版本」查询按 substr(version, 12)::bigint 排序，依赖这个格式
    check('ck_snapshots_version', sql`${t.version} ~ '^[0-9]{4}[.][0-9]{2}[.][0-9]{2}[.][0-9]+$'`),
  ],
);

/** 键值杂项：快照脏标记、开关状态等 */
export const meta = pgTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
