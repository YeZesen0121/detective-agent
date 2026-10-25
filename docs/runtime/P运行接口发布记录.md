# P运行接口发布：给W与其他模块的接入说明

2026-10-24。P代码已合回D:\侦探agent主分支feat/foundation。
代码检查点：1d50513049e58dc59f85776649329cfd1385068e；本地标签p-platform-runtime-v1。
G0标签及I/E/M原任务基准保持1aaf2d197bdeb7f9987338b6ea6aa2fffc489835，不移动。

## 可以交给W的最短指令

    P已发布任务宿主/HTTP接入增量。请阅读docs/runtime/P-平台接续.md和src/shared/runtime-http.ts，
    在你自己的W工作树中对齐TaskPort的HTTP映射，继续非视觉客户端/状态逻辑；
    不更改UI设计，不修改P目录。取消是短响应后GET完整run；partialMaterialSummary为string|null；
    updateNotice为{latestResultVersionId,createdAt}|null；事件为afterSeq分页最多100条。
    默认main尚未注入I模块/价格/实际资金，开始调查会503；受控HTTP测试在tests/platform/run-http.test.ts。
    不要把测试模块或fixture挂到生产页面，不用“所有返回200”掩盖未接入。

本机W可git show此检查点读取已发布schema；若需要把P作为依赖合到W自己的分支，先提交/保护W已有工作，在隔离工作树中合并此检查点并验证；不能在主目录切分支。任何冲突交P统筹，不自行改公共契约。

跨电脑已持有G0历史时，可同时交本说明和以下增量bundle：
D:\侦探agent\.local\dispatch\detective-agent-platform-runtime-v1.bundle
SHA256：0F92055A42A28314CABDFD3E01F0B0573CD22001367A3D7C0A2E7EA48FE3559E。
包的头为refs/heads/codex/platform-lifecycle，1d50513；依赖G0完整SHA，不可单独clone。
在自己的项目目录执行git bundle verify <bundle绝对路径>，
git fetch <bundle绝对路径> refs/heads/codex/platform-lifecycle，
核对FETCH_HEAD完整SHA，再在已保护本地工作的角色分支上合并FETCH_HEAD。
已经在G0上的I/E/M可继续原模块，不需为了本接口强制追随平台HEAD；交回代码后由P组装。

## 发布证据与限制

- 隔离工作树完整108项单测、typecheck、build通过；独立审查发现的唯一Important问题（澄清重新入队门禁）已先复现再修复，完整回归通过。
- 主分支fast-forward后实际再次运行：108项单测、typecheck、build均通过。
- Edge基础浏览器3项通过：React与真实API连接、错误恢复、共享码两浏览器隔离；没有产品页面/手机/真实调查验收。
- git bundle verify通过；在既有G0接收副本实际fetch成功，FETCH_HEAD核对为上述完整SHA。首次测试用了接收副本相对路径而找不到文件，改绝对路径后成功，不影响包内容。
- 发布包不含.env、数据库、音频、私有附件或node_modules。真实供应商调用本轮0次，未重跑价格/账单验证。
- 根目录已有.gitignore与docs/ui在途内容保留，未纳入P提交。P独立工作树保留供接续；未改别的对话分支。

真实调查依赖业务模块返修后通过审查；P3附件/伴读/语音持久化、P4watch事务接口以及部署仍需后续完成。这个检查点是平台接入增量，不是整站成品。
