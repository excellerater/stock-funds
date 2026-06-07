# 自有基金跟踪台

这个项目会把 `https://web1.345569.xyz` 的基金列表和详情数据同步为本地文件，再由我们自己的页面来展示。

## 文件说明

- `sync-remote-data.mjs`
  - 抓取远端列表与详情接口
  - 复用站点前端内置的 Wasm 解密模块
  - 生成 `data/remote-funds.json` 和 `data/remote-funds.js`
- `index.html`
  - 展示我们自己的基金跟踪台
- `app.js`
  - 渲染基金列表、分类影响、持仓明细、指数影响

## 使用

先同步数据：

```bash
node sync-remote-data.mjs
```

启动本地服务：

```bash
node server.mjs
```

然后打开 `http://127.0.0.1:4173`。服务每分钟同步一次，页面也会每分钟读取最新数据；点击“刷新”会立即触发一次远端同步。

## 当前实现

- 同步基金列表
- 同步单基金详情
- 解密远端 `encrypted` 数据
- 本地展示同步时间、基金列表、分类影响、持仓和指数影响
- 保存最近 48 个不同的数据快照
- 当前时段变化后显示上一时段估值
- 每分钟自动更新

## 后续可加

- 纳指100与主动基金的自有分组
- 你的交易记录与收益统计
- 历史同步快照
- 搜索、筛选和排序
# 手机公网访问

运行：

```bash
./start-public.sh
```

终端会显示一个 `https://*.trycloudflare.com` 地址，手机可直接访问。
电脑和终端需要保持运行；重新启动脚本后地址会变化。

## GitHub Pages

项目包含 `.github/workflows/pages.yml`：

- 推送到 `main` 后自动部署
- 每 5 分钟更新一次基金数据
- 页面地址为 `https://用户名.github.io/仓库名/`
- GitHub Pages 的刷新按钮读取最近一次云端快照

首次推送后，需要在仓库的 `Settings > Pages` 中将 Source 设为
`GitHub Actions`。
