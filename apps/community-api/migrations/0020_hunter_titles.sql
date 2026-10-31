-- 0020_hunter_titles: 打野称号阶梯 + X handle 档案字段。
--
-- 称号阶梯不落列：累计击杀（口径同周榜击杀、不设时间窗）由服务端聚合派生，
-- 阈值是数据（LEADERBOARD.titles），逻辑是代码，榜单懒重算时顺手算出 tier。
-- x_handle 是自报的社交展示字段（不验证归属），档案页/榜单行渲染 @handle。
-- 周结算称号仍写 installations.title（猎黄人），与阶梯并存展示。

ALTER TABLE installations ADD COLUMN x_handle TEXT;
