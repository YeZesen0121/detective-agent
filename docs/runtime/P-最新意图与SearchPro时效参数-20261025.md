# P：查最新意图与SearchPro参数核对

2026-10-25 04:2x，基准ab12e18。修改仅P provider-transports与定向测试、本记录；I保持内部latest意图。

当前I的`initialQuery`在latest模式使用`freshness='latest'`。P此前直接传给`SearchPro.Freshness`，属于未核对内部意图与供应商字段的接线错误。重新读取[官方SearchPro参数](https://cloud.tencent.com/document/api/1806/121811)（页面更新2026-10-20），Freshness支持dN/mN/yN、单日及日期区间，没有latest。

修复：仅在P生产适配层把内部latest意图转为不传Freshness；显式d7等合法供应商参数保持。返回warning说明未施加发布时间过滤，当前状态仍须根据正文中的事件、生效时间和证据对应判断。没有静默改成d30：检索发布时间新不等于事实当前有效，旧官方说明仍可能有效；这是PRD时间核验和原调研R04的取舍。

红→绿测试实测原TC3载荷出现`Freshness:latest`；修后TC3和Bearer均不发送该无效值，也不增加d30，d7明确透传，warning保留。连同真实HTTP truth runtime定向18项、typecheck/build通过，149前端模块。真实供应商0次，尚不能据此宣称Freshness相对过滤真实联调已通过。

另已提醒I：真实API发布时间/站点字段为date/site，已有通用normalizer的publishedAt/publisher未必取得这些字段；I latest以读到的原文生效日期及语义复核为准，不把fetchedAt代替发布时间。缺乏可定位时间依据必须partial；本轮未擅自为无时区的原始日期补UTC。
