import type { Scope } from '../../shared/contracts.js';

export function explicitAliases(text:string):string[] {
  return [...text.matchAll(/[（(](?:简称|又称|也叫|alias)\s*[:：]?\s*([^）)]+)[）)]/gi)].flatMap(match=>match[1]!.split(/[、,，]/)).map(s=>s.trim()).filter(Boolean).slice(0,20);
}
export function entityText(text:string):string {
  const quoted=text.match(/《([^》]+)》|「([^」]+)」/);if(quoted)return quoted[1]??quoted[2]!;
  const unaliased=text.replace(/[（(](?:简称|又称|也叫|alias)[^）)]*[）)]/gi,'').replace(/^(?:请问|请|帮我|我想|核对|查一下|查询|关于|了解)+\s*/g,'').trim();
  const entity=unaliased.split(/的(?:报名|费用|截止|日期|学历|年龄|条件|价格|状态)|是否|是不是|能否|[，,；;?？]/)[0]!.trim();
  return entity.length>=2?entity:unaliased;
}
export function atomicGoals(scope:Pick<Scope,'claimsToCheck'|'goal'|'objectText'>):string[] {
  const entity = entityText(scope.objectText);
  const split = (goal: string) => {
    // Remove the known entity before conjunction splitting: 和平科技大赛 is one name.
    const prefix = goal.startsWith(scope.objectText) ? scope.objectText : goal.startsWith(entity) ? entity : '';
    const rest = goal.slice(prefix.length).replace(/^的/, '');
    const parts = rest.split(/以及|并且|同时|和|与|及|\s+and\s+|[，,、；;]/i).map(s => s.trim()).filter(Boolean);
    return parts.length > 1 ? parts.map(part => entity + '的' + part) : [goal];
  };
  const questionGoals = split(scope.goal);
  // An old single-claim checkpoint cannot erase the rest of a compound question.
  const requested = scope.claimsToCheck.length > 1 || scope.claimsToCheck[0]==='确定对象名称' ? scope.claimsToCheck
    : questionGoals.length > 1 ? questionGoals : scope.claimsToCheck.length ? scope.claimsToCheck : [scope.goal];
  return [...new Set(requested.flatMap(split))].slice(0, 80);
}
export const uncoveredGoalMessage=(goal:string,index:number)=>`核心目标未覆盖[${index}]：${goal}`;

/** Only an identity question may be answered by a candidate record alone. */
export function identityGoalIndexes(scope: Pick<Scope,'claimsToCheck'|'goal'|'objectText'>): number[] {
  const entity=entityText(scope.objectText);
  return atomicGoals(scope).flatMap((goal,index)=>{
    const rest=(goal.startsWith(entity)?goal.slice(entity.length).replace(/^的/,''):goal).trim().replace(/[?？。\s]+$/,'');
    const identity=/^(?:(?:确定|识别|辨认|寻找|查找|查询|核对)(?:一下)?)?(?:活动|产品|学校|机构|对象|书籍|书|项目)?(?:的)?(?:名称|名字|身份|对象)(?:是什么|叫什么)?$/.test(rest)
      || /^(?:这|那|它|此)?(?:是)?哪(?:个|种|所|家)(?:活动|产品|学校|机构|对象|书籍|书|项目)$/.test(rest)
      || /^(?:identify (?:the )?|name of (?:the )?|which )(?:event|product|school|organization|book|object)$/i.test(rest);
    return identity?[index]:[];
  });
}
