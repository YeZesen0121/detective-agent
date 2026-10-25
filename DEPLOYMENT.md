# 队友部署说明

这是完整源码交付快照。源提交、逐文件SHA256和包额外文件见 DELIVERY-MANIFEST.json；包内额外说明未回写冻结源提交。

## 1. 安装和启动

使用 Node.js **24.19.0**、npm **11.17.0（11.x）**，在目标主机安装依赖，不复制其他电脑的 node_modules。

```sh
npm ci
cp .env.example .env
# 按下文填写 .env
npm run build
npm start
```

Windows复制命令为 Copy-Item .env.example .env。服务入口会从项目当前目录加载 .env；需在项目根目录启动。运行 npm start 前，dist 由本机 npm run build 生成。better-sqlite3 包含原生模块，应在部署主机重新安装。

最少必填：APP_ORIGIN（用户实际访问的同源网址）、PORT（例如3000）、DATABASE_PATH（例如.local/detective.db）、TRIAL_ACCESS_CODE 和 DEMO_ACCESS_CODE（各至少12字符、不同的私有码）、SERVICE_ENDS_AT（按新部署填写未来的UTC ISO时间）。本机直接访问可设 APP_ORIGIN=http://127.0.0.1:3000。

源码包不含实际.env、API密钥、体验码、cookie、原运行数据库、私有上传、已生成音频或node_modules。默认从空数据库开始，本机旧报告和旧case链接不会自动出现在新服务器。

## 2. 真实调查与文字伴读

.env.example 默认关闭真实服务。只复制模板可启动基础入口，不代表已具备真实调查能力。要联调需由项目所有者提供有效凭据，并配置：

- TRUTH_RUNTIME_ENABLED=1：调查、已有结果追问、盯梢运行时。
- EXPERIENCE_RUNTIME_ENABLED=1：文字伴读/视觉运行时。
- 普通入口已移除旧有限campaign启动依赖，不需要开启历史LIVE_CAMPAIGN。模板中旧20元/100次注释属于历史，以本包实际入口为准。
- DEEPSEEK_API_KEY：文字模型；搜索选择一种认证。Bearer设 SEARCH_AUTH_KIND=bearer 和 YUANBAO_API_KEY；TC3设 SEARCH_AUTH_KIND=tc3 和 TENCENT_SECRET_ID/TENCENT_SECRET_KEY。不要混用后不明确选择。
- RUNTIME_FUNDING_JSON：仍须符合 global/trial/demo 三组账本初始化结构，每组包含 activeMs、searches、reads、modelCalls、inputTokens、outputTokens、moneyMicros 七个非负整数。普通入口已按最新指令设置 unrestrictedUsage=true；初始化结构与旧文档的历史限额不是一回事。以本包实际配置模块为准，不把占位模板当有效运行配置。

例如账本初始化结构可按以下JSON填写；数值是兼容结构示例，当前普通入口不限用量分支不据此恢复旧上限：

```json
{"global":{"activeMs":3600000,"searches":1000,"reads":1000,"modelCalls":1000,"inputTokens":10000000,"outputTokens":1000000,"moneyMicros":100000000},"trial":{"activeMs":3600000,"searches":1000,"reads":1000,"modelCalls":1000,"inputTokens":10000000,"outputTokens":1000000,"moneyMicros":100000000},"demo":{"activeMs":3600000,"searches":1000,"reads":1000,"modelCalls":1000,"inputTokens":10000000,"outputTokens":1000000,"moneyMicros":100000000}}
```

SERVICE_ENDS_AT 是新体验会话有效期，需为未来。普通入口不启用历史campaign策略；如另行使用保留的有限探针分支，应给其独立正确策略，不重置已有账本。

语音此前真实联调服务未开通。TTS_RUNTIME_ENABLED 默认保持0；文字伴读可单独使用。不要把受控测试提示音或界面按钮存在当成真实云朗读已经通过。

## 3. 公网部署

入口目前监听127.0.0.1，不会直接向公网监听。常规部署在同机用Nginx/Caddy反向代理到127.0.0.1:3000，并把APP_ORIGIN设为最终HTTPS域名。跨容器部署需队友显式调整host/网络连通方式。HTTPS的APP_ORIGIN会启用secure cookie。

Nginx location示例：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 300s;
}
```

SQLite目录与私有assets目录需可写并持久化。一个数据库只启动一个应用进程；不要直接开PM2多worker共享同一SQLite。已有运行库迁移/备份工具见 scripts/ops/runtime-storage.ts，迁移真实数据必须另获所有者授权，不随本公开源码快照自动迁移。

## 4. 部署后核对

检查 /health/ready，使用新配置体验码进入；先用一个小问题核对检索、读取、报告、版本和追问，再生成文字伴读。API开关或schema通过不代表整项调查验收成功。界面里可点“进入侦探伴读”查看Socratopia风格工作区；已有伴读读取不自动生成，生成仍需明确点击。

完整设计和运行边界保留在 README.md、docs/验收追踪矩阵.md 及 docs/runtime/。历史文件各按其记录日期理解，最新快照元信息以本包MANIFEST为准。
