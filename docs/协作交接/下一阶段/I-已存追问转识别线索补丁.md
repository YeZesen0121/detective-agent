# I：已存追问转识别线索（核心阻断补丁）

P统一协调，I仍唯一写investigation，UI独立。接收686fcde全部历史后，P与I用真实P HTTP＋实际I模块复现F01追问路径不闭环；不是新的产品要求，继续PRD§5.3/§6和核心接收门。

## 固定契约（本文件随P提交给完整SHA）

`PreparationInputSchema`新增可选：`followup:{kind:'saved_followup',turnId:UUID,resultVersionId:UUID,question:string(1..2000)}`。旧调用方省略兼容，contractVersion仍0.1.0。P从followup_run_inputs已保存归属/版本/问题权威构造，原clarificationAnswer不伪造。P将完成应用记录、受限scope patch授权/version、取消恢复与stale门；你不改公共目录。

P当前入口已传真实followup，尚未完成scope patch持久化，真实生产暂不开该路径。P后续只在该turn尚未应用时传此字段；已应用后的resume使用持久previousScope而不重复提取。run.followupQuestion继续保留，不能据是否省略prepare.followup误清追问。

## 已复现

初始音乐/灵魂动画→partial双候选；POST固定版followups“主角是成年男老师，好像弹钢琴”→research_same_scope→新run仍partial。prepare未收到该问题，known/uncertain仍旧；engine又把“成年老师”“好像钢琴”当额外事实目标，candidateChecks只能按旧线索索引核验。原prepare→run回归手动传clarificationAnswer，不能证明此HTTP路径通过。复现脚本在TEMP detective-f01-followup-real-path.mts，全部controlled_fixture。

## I直接实现

1. 把saved_followup作为独立、真实用户输入来源进行有界线索提议＋独立复核，不能伪造成Clarification答案或网页事实。输入引用应明确question/clarification/saved_followup/previousScope；每条新增或修正线索绑定真实原句和确定性。
2. 原object/goal/claimsToCheck/timeScope/region/basicMode/userConfirmed保持；仅处理knownClues/uncertainClues。原线索不能无痕删除：显式纠错可有据降级旧线索、保留追溯；不确定记忆不升级硬事实，不凭模型自己确认。换对象或目标仍走suggest_new_case门。
3. identify补充线索不再把追问原句追加成新的核心事实目标。原身份目标继续逐候选/逐线索跨语言核验，保留另一候选确定冲突后才能有据收敛；解释、比较已有候选0搜索，能按现有材料解释不强补查。
4. 已应用scope后的resume不再做同turn提取；未应用的取消/失败不发布更改，unknown不自动重放。每次模型继续经services/预算/Abort，scope两次上限、原输入/输出上界保留；缺资金不能冒充用户缺线索或返回空肯定。

## 回归与交付

先红→绿：原始F01实际P HTTP＋实际I（仅供应商controlled_fixture）初查→固定版追问→新增known成人/uncertain钢琴→候选核验收敛→旧版字节不变/同budgetWindow；无附加事实目标。追加显式纠错/不确定、范围扩大否决、已应用resume不再提取、未授权patch/stale拒绝（P门可与P并行，未完成准确记录）。不要只手动传clarificationAnswer。

仅写src/server/investigation、tests/investigation及I runtime；0真实调用/0元，不读凭据。相关/typecheck/build/只读复核后交完整SHA及失败边界；P统一接收、平台测试与真实T01/L01/F01＋追问。
