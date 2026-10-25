const labels:ReadonlyMap<string,string>=new Map([
 ['objectText','对象描述'],['object','调查对象'],['knownClues','识别线索'],
 ['groundedScope','范围与原文对应'],['goal','调查目的'],['year','年份'],
 ['date','日期'],['timeRange','时间范围'],['location','地点'],
 ['source','来源'],['uncertainClues','待确认线索'],
]);

export function clarificationFieldLabels(fields:readonly string[]):string[]{
 return [...new Set(fields.map(field=>labels.get(field)??'必要信息'))];
}

export function canRecheckOriginalDescription(fields:readonly string[]):boolean{
 return fields.length>0&&fields.every(field=>field==='objectText'||field==='groundedScope');
}
