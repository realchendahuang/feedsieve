-- 0024_report_evidence_facts: 判定材料随票上报（2026-09-12 拍板，推文本就是公开内容）。
-- reports 新增推文原文 / 作者昵称 / 简介原文三列；
-- 只进 reports 表且不进公开快照面；旧客户端缺省 NULL。
ALTER TABLE reports ADD COLUMN tweet_text TEXT;
ALTER TABLE reports ADD COLUMN display_name TEXT;
ALTER TABLE reports ADD COLUMN bio TEXT;
