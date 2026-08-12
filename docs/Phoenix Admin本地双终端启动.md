# Phoenix Admin 本地双终端启动

本页用于已经完成一次干净初始化后的日常开发与插件安装验证。前后端分别占用一个 VS Code 终端，方便直接观察日志；不需要 Dev Hub。

## 1. 端口与目录

| 服务      | 目录                                                                  | 端口 | 日志位置                                                          |
| --------- | --------------------------------------------------------------------- | ---: | ----------------------------------------------------------------- |
| Admin API | `<workspace>/.worktrees/phoenix-admin-clean-validation/node` | 8201 | VS Code 的 `Admin API` 终端                                       |
| Admin Web | `<workspace>/.worktrees/phoenix-admin-clean-validation/vue`  | 9100 | VS Code 的 `Admin Web` 终端；页面请求细节看浏览器 Console/Network |

数据库使用已经初始化好的 `phoenix_admin_clean_validation_20260805`。日常重启必须保持 `PAH_DB_SYNCHRONIZE=false`、`PAH_DB_INITIALIZE=false`，避免重复执行 Cool 初始化。

## 2. 关闭旧进程

首选在原启动终端按 `Ctrl+C`。找不到原终端时，先只读确认监听进程：

```bash
lsof -nP -iTCP:8201 -sTCP:LISTEN
lsof -nP -iTCP:9100 -sTCP:LISTEN
```

确认 PID 与 Phoenix Admin 的 Node/Vite 进程一致后，再逐个温和停止：

```bash
kill -TERM <8201的PID>
kill -TERM <9100的PID>
```

重新运行 `lsof`，两条命令都没有输出后再启动。不要使用 `kill -9`，也不要按模糊名称批量结束所有 Node 进程。

## 3. 启动 Admin API

在 VS Code 新建终端并命名为 `Admin API`：

```bash
cd <workspace>/.worktrees/phoenix-admin-clean-validation/node
PAH_SERVER_PORT=8201 \
PAH_DB_DATABASE=phoenix_admin_clean_validation_20260805 \
PAH_DB_SYNCHRONIZE=false \
PAH_DB_INITIALIZE=false \
pnpm dev
```

验包、manifest 登记、dry-run 和生命周期诊断日志都应出现在这个终端。

## 4. 启动 Admin Web

在 VS Code 再新建终端并命名为 `Admin Web`：

```bash
cd <workspace>/.worktrees/phoenix-admin-clean-validation/vue
PAH_API_TARGET=http://127.0.0.1:8201 \
VITE_PAH_API_TARGET=http://127.0.0.1:8201 \
pnpm exec vite --host 127.0.0.1 --strictPort --port 9100
```

看到 `Local: http://127.0.0.1:9100/` 后打开页面。默认管理员为 `admin / 123456`。

## 5. 重启顺序

1. 两个旧终端分别按 `Ctrl+C`。
2. 确认 8201、9100 已不再监听。
3. 先启动 `Admin API`，等待 TypeScript 显示 `Found 0 errors`。
4. 再启动 `Admin Web`，等待 Vite 显示 ready。
5. 浏览器硬刷新页面。

安装新的 `.phoenix.cool` 包后，如果终端提示模块文件已变化，仍按上述顺序完整重启一次；不要把 HMR 当作跨前后端插件已完整装配的证明。
