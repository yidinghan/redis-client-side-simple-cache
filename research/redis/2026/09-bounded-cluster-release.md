# 0.4.0 Cluster 缓存交付与验证

日期：2026-09-28。状态：已删除限容和 LRU；源码及安装产物验证通过，未发布 npm。

## 当前实现与边界

- Redis 读取后才缓存，使用 tracking 失效；没有容量上限、LRU 重排或 TTL，按需缓存不保证内存永久有界。
- 删除强制 `maxEntries` 校验、容量淘汰、命中重排、`deleteOldest` 和容量专属测试；内部类改名 `ClusterCache`，运行时从 116 行减至 102 行。
- 保留反向引用清理、在途读取失效、禁用期间拒绝回填及断线恢复。工厂接口与返回值不变，未增加新策略或替换 provider。
- 原 `src/simple-cache.js` 与 main `43bb01e` 完全一致，保留 `CacheMapClass/KeyMapClass`；新 Cluster 入口仍使用原生 Map，不提供存储注入。
- 原开发分支远端已删除，main 仍为 `43bb01e`；本次从本地 `de52591` 新建 `feat/cluster-cache-no-limits`，保留此前代码和历史。
- Node >=18.19.0、redis 5.12.1 的支持范围不变；本轮不宣称应用内存收益或完整事件吞吐已经验证。

## 本轮验证

使用专用 Redis 7.0.4：standalone 6379，三主 Cluster 16379/16380/16381。

| 测试对象 | Node | 结果 |
|---|---|---|
| 仓库源码完整 suite | 24.14.0 | 36 passed，0 failed，0 skipped |
| 仓库源码完整 suite | 18.19.0 | 36 passed，0 failed，0 skipped |
| 新 tarball 安装后的公开入口完整 suite | 24.14.0 | 36 passed，0 failed，0 skipped |
| 新 tarball 安装后的公开入口完整 suite | 18.19.0 | 36 passed，0 failed，0 skipped |

较历史候选少一项容量淘汰场景；跨节点空/非空 SMEMBERS、独立 writer 失效、重复 key MGET、晚回包、真实 MOVED、关闭重连和 tracking 连接被断开后的恢复仍全部通过。
全新临时 npm 项目安装 tarball 和 redis@5.12.1，测试改为导入两个公开入口后经 `npm test` 执行。`npm ls` 确认 client/provider 共用 @redis/client 5.12.1；安装后的五个文件与工作区逐字节一致。

日志：`/private/tmp/cache-minimal-node24.log`、`/private/tmp/cache-minimal-node18.log`、`/private/tmp/cache-minimal-pack-node24.log`、`/private/tmp/cache-minimal-pack-node18.log`。
产物：`/private/tmp/csc-minimal-fgghv6xx/pack/playding-redis-simple-csc-0.4.0.tgz`。
SHA-512 integrity：`sha512-Mek6NnPyRZgWtD82jnTeMVpT93pBLOsRdiT8Jz+eLEIstfC1M96O3k55IMB4UNzwL07zyO7osdm19MNKxdkOpQ==`。

源码与测试语法检查、`git diff --check` 通过；仓库没有 lint script，未引入新工具。独立 code review 与 rubber duck 均通过；已核对运行时删减、测试日志、安装产物与文档证据，无必须修复项。
版本仍为候选 0.4.0；未发布、未打 tag，不沿用下方历史产物摘要。

## 历史候选记录

以下保留删减前实现与测试事实，不作为当前容量合同或验证结果。

### 变更与边界

从 `main`（43bb01e）创建 `feat/bounded-cluster-cache`，为本包增加有界 Cluster 缓存。
新增 `/cluster` 的 `createCachedCluster`，只管理有界 LRU 条目及反向引用；RESP3、
tracking、命令处理和连接恢复复用 node-redis。原 `src/simple-cache.js` 与 main 完全一致。

0.4.0 的环境支持范围收窄为：Node >=18.19.0，dependency/peer 均为 redis 5.12.1。
根入口 API 不变，不代表所有旧环境可直接升级；未迁移项目继续保留原锁定版本。
新工厂在包内共同创建 provider/client，根入口调用方仍需使用同一份 @redis/client。

本轮只补齐已有功能、打包元数据、中英文文档及真实 Cluster CI。没有增加业务概念、
TTL 策略、第二层缓存、codec、clone 优化或新的重试框架。maxEntries 限制条目数，
不是进程 RSS 上限；本轮验证不包含应用进程的 RSS 收益或业务端到端吞吐。

### 本轮验证

隔离 Redis 7.0.4：standalone 6379，三主 Cluster 16379/16380/16381。

| 测试对象 | Node | 结果 |
|---|---|---|
| 仓库源码完整 suite | 24.14.0 | 37 passed，0 failed，0 skipped |
| 仓库源码完整 suite | 18.19.0 | 37 passed，0 failed，0 skipped |
| tarball 安装后的公开入口完整 suite | 24.14.0 | 37 passed，0 failed，0 skipped |
| tarball 安装后的公开入口完整 suite | 18.19.0 | 37 passed，0 failed，0 skipped |

安装验证使用全新临时项目，安装本次 tarball 与 redis 5.12.1；复制仓库现有全部测试，
只将 `../src/simple-cache`、`../src/cluster` 的 require 分别替换为
`@playding/redis-simple-csc`、`@playding/redis-simple-csc/cluster`，通过 npm test 运行。
Node 18.19.0 下也完成 npm ci。npm ls 确认 @redis/client 去重为同一份 5.12.1。

Cluster 场景覆盖跨节点空/非空 SMEMBERS、独立 writer 失效、重复 key MGET、
超过十倍容量后的条目及反向引用清理、热点保留、晚回包不可回填、真实 MOVED、
关闭重连及 CLIENT KILL 后恢复。MOVED 由客户端过期路由触发，不是服务端故障切换测试。

bash -n、git diff --check 通过。仓库没有 lint script 或 ESLint 配置，未引入新 lint 工具。
独立 code review 和 rubber duck 均未发现必须修复的问题；审计同时核对源码及安装产物证据。
GitHub Actions 配置已更新，本轮执行证据来自本地，尚未声称远程 CI 已通过。

### 复现

完整测试会清空 localhost:6379，必须使用专用实例。以下从仓库根目录运行，
CONTAINER_ENGINE 可改为 podman，REDIS_IMAGE 可指定已有镜像。

```sh
export CONTAINER_ENGINE=docker
export REDIS_IMAGE=redis:7-alpine
export REDIS_CLUSTER_URLS=redis://127.0.0.1:16379,redis://127.0.0.1:16380,redis://127.0.0.1:16381
"$CONTAINER_ENGINE" run --detach --rm --name redis-simple-csc-test-standalone \
  --publish 127.0.0.1:6379:6379 "$REDIS_IMAGE" redis-server \
  --appendonly no --save '' --maxmemory-policy noeviction
bash scripts/test-cluster-env.sh up
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm pack --json
bash scripts/test-cluster-env.sh down
"$CONTAINER_ENGINE" rm --force --volumes redis-simple-csc-test-standalone
```

真实安装产物复验按上述导入替换方法，在新空 npm 项目设置与本仓库相同的 test script，
安装新 tarball 和 redis@5.12.1，然后带同一 REDIS_CLUSTER_URLS 执行 npm test。
不要把源码测试通过当作安装产物通过；Cluster 场景不得跳过。

### 发布交接

0.4.0 为候选版本，本轮 registry 查询仍只有至 0.3.0 的已发布版本。
补充入口对照说明后重新打包，与上表已验收产物逐文件比较，仅 README 变化；
运行时代码、package.json 和文件列表一致，因此未重复执行相同代码的完整测试。
当前 tarball 的 SHA-512 integrity：

`sha512-PJruevJsymo6kdkzCFaSZB+T5cegJDfscejHFBiiLbLLjBXbaB4+5+exYKScJRyLqhhhlhV9JN/GUT16HxFVLQ==`

包内容只有 LICENSE、README、package.json、两个 src 入口；测试和环境脚本不进入包。
重新打包后若摘要变化，应以新的安装验证为准，不能沿用此摘要作已验收证明。

发布由包维护者处理。本轮不打发布 tag、不创建 Release、不触发 publish workflow。
现有 npm version hooks 会 git add -A 并 push，因此版本字段直接修改，不调用 npm version。
CI 和发布 job 均启动真实 Cluster，job 级 REDIS_CLUSTER_URLS 也覆盖 prepublishOnly。
手动从工作区发布时同样保留专用 Redis 和该变量，避免跳过 Cluster 测试。

发布后从实际分发 registry 新装正式版本，复核两个公开入口及 dist.integrity，
记录版本、commit/tag、registry 和包摘要，供使用者核对。
