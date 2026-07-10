# WallPenetrating

Chrome / Edge 浏览器VPN扩展（**v1.10.1**），通过 **AnyTLS** 协议实现智能分流代理。指定网站走代理节点，其余流量直连；也可一键切换全局代理。项目已内置 [sing-box](https://github.com/SagerNet/sing-box) v1.13.14（`bin/sing-box.exe`），开启分流时由 Native Host 自动拉起本地 SOCKS5，无需单独下载或手动维护进程。

**GitHub：** https://github.com/dlsandy/WallPenetrating

**适用场景**：只需让 Google、YouTube 等特定网站（可自由添加）走代理，日常浏览与网银支付保持直连。

---

## 目录

- [系统要求](#系统要求)
- [快速安装](#快速安装)
- [从 GitHub 获取](#从-github-获取)
- [更新日志](#更新日志)
- [使用指南](#使用指南)
- [功能一览](#功能一览)
- [工作原理](#工作原理)
- [节点与订阅](#节点与订阅)
- [网址规则](#网址规则)
- [数据与安全](#数据与安全)
- [项目结构](#项目结构)
- [高级命令](#高级命令)
- [故障排查](#故障排查)
- [开发者说明](#开发者说明)
- [许可](#许可)

---

## 系统要求

| 项目 | 要求 |
|------|------|
| 操作系统 | Windows 10 / 11 |
| 浏览器 | Google Chrome 或 Chromium 系（Edge 等需自行验证 Native Messaging 兼容性） |
| 运行时 | PowerShell 5.1+（Windows 自带） |

> 本项目为**解压加载**的开发者模式扩展，尚未上架 Chrome Web Store。克隆/下载后即可离线完成安装（sing-box 已随仓库提供）。

---

## 快速安装

### 第一步：加载 Chrome 扩展

1. 地址栏打开 `chrome://extensions/`
2. 开启右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择本项目根目录（含 `manifest.json` 的文件夹）

### 第二步：运行安装向导

双击根目录 **`一键安装.cmd`**，向导将依次完成：

1. 检查 `bin/sing-box.exe`（已随项目提供，缺失时才会自动下载）
2. 创建 `data/` 运行时目录
3. 引导你在 Chrome 中加载扩展
4. 注册 **Native Messaging Host**（扩展与 sing-box 的通信桥梁）

按提示从 `chrome://extensions/` 复制 **32 位扩展 ID** 并粘贴即可。

> 安装完成后会自动打开 **`开始使用.html`**，也可随时双击查看。

### 第三步：配置并开始使用

1. 点击工具栏扩展图标 → **节点管理** → **URI 导入**，添加 AnyTLS 节点
2. 点击 **网址规则设置** → 添加需代理的域名（如 `google.com`）
3. 在弹窗右上角打开 **分流开关**，状态显示 `sing-box: 运行中` 即成功

---

## 从 GitHub 获取

```powershell
git clone https://github.com/dlsandy/WallPenetrating.git
cd WallPenetrating
```

克隆后按上方 [快速安装](#快速安装) 操作。`data/`（运行时配置）不在版本库中，首次运行 `一键安装.cmd` 时会自动创建；`bin/` 已包含 sing-box 及依赖，无需额外下载。

---

## 更新日志

### v1.10.0

#### 规则外 404 自动走代理

开启分流后，若某网站**不在代理规则内**、当前为直连访问，且主文档返回 **HTTP 404**，扩展会自动：

1. 将该域名加入**临时代理规则**
2. 刷新 PAC 与 sing-box 配置
3. **重新加载**当前标签页，经节点再次访问

开关位置：弹窗「概览」与选项页侧边栏 **「规则外 404 自动走代理」**（默认关闭）。直连名单内的域名不会触发。

> 每个标签页、每个 URL 仅自动重试一次，冷却间隔 3 秒，避免循环刷新。

#### 临时代理规则

- 存放于浏览器**会话存储**（`chrome.storage.session`），**关闭浏览器后自动清空**
- 在选项页 **网址管理 → 临时代理规则** 查看与管理
- 支持启用/禁用、删除，以及 **「转为代理规则」** 写入永久规则
- 临时代理规则与永久规则合并参与 PAC 分流；永久规则优先（同模式同域名不重复）

#### 界面与配置

- 弹窗、选项页显示当前扩展版本号（`lib/version.js` 与 `manifest.json` 同步）
- 选项页可设置 **项目网址**（默认 GitHub 仓库地址），随「导出全部配置」一并备份
- 完整配置导出/导入包含 `autoRetryOn404`、临时代理规则相关开关与 `projectUrl`

#### 依赖与权限

- 新增 `webRequest`、`host_permissions`（`<all_urls>`），用于检测主文档 404 状态
- 内置 sing-box 升级至 **v1.13.14**，支持 AnyTLS 出站（需 sing-box 1.12.0+）

---

## 使用指南

### 两种代理模式

| 模式 | 开关位置 | 行为 |
|------|----------|------|
| **规则分流**（默认） | 弹窗 / 选项页「启用分流」 | 仅匹配代理规则的域名走 AnyTLS，其余直连 |
| **全局代理** | 弹窗 / 选项页「全局代理」 | 所有网页走默认节点（局域网、直连名单除外） |

两种模式互斥启用：开启全局代理后，规则分流自动让位于全局模式。

### 规则外 404 自动走代理

适用于「事先不知道域名、直连打不开」的场景：

1. 开启 **启用分流** 与 **规则外 404 自动走代理**
2. 访问不在规则内的网站；若直连返回 404，扩展自动加入临时代理规则并重载页面
3. 确认可用后，可在 **临时代理规则** 中 **转为代理规则** 永久保留

### 临时代理规则

| 特性 | 说明 |
|------|------|
| 存储 | 浏览器会话内有效，关闭 Chrome 后清空 |
| 来源 | 404 自动走代理、或后续手动扩展 |
| 管理 | 选项页 → 网址管理 → **临时代理规则** |
| 转正 | 点击「转为代理规则」合并到永久列表 |

### 弹窗快捷操作

- **加入规则 / 移出规则**：将当前标签页域名一键加入或移出代理规则
- **快速切换节点**：下拉选择默认节点（全局模式或规则的默认绑定）
- **测试连接**：检测本地 SOCKS5 与远程 AnyTLS 可达性
- **修复节点配置**：重新生成 sing-box 配置并重启进程

### 右键菜单

在任意网页空白处右键：

- **将当前网站加入 AnyTLS 分流**
- **将当前网站移出 AnyTLS 分流**

### 选项页

点击弹窗 **网址规则设置** 或扩展详情中的 **扩展选项**，进入完整设置界面：

| 标签 | 内容 |
|------|------|
| 网址管理 | 代理规则、直连名单 |
| 节点管理 | 节点增删改、URI 导入、订阅刷新 |
| 运行环境 | sing-box 状态、日志、Native Host 检测、系统代理冲突检测 |
| 使用说明 | 内置详细帮助 |

侧边栏还提供 **导出/导入全部配置**、扩展 ID 复制、分流开关。

---

## 功能一览

| 功能 | 说明 |
|------|------|
| 规则外 404 自动走代理 | 未匹配规则站点直连 404 时，自动加入临时代理规则并重载 |
| 临时代理规则 | 会话级规则，可转正为永久规则，关闭浏览器后清空 |
| 规则分流 | 按域名 / 通配符 / 正则匹配，仅指定网站走代理 |
| 多节点分流 | 每条规则可绑定不同节点，PAC 转发至对应本地 SOCKS 端口 |
| 全局代理 | 所有网页走默认节点（局域网自动排除） |
| 直连名单 | 银行、政务等敏感站强制直连，优先级高于代理规则与全局模式 |
| 内置直连规则 | 预置 gov.cn、各大银行、支付宝等域名，可关闭 |
| 当前页规则 | 弹窗 / 右键菜单快速增删当前网站 |
| 节点订阅 | 支持链接拉取 `anytls://` 节点（纯文本 / Base64 / JSON），可定时自动刷新 |
| 节点管理 | URI 导入、手动编辑、JSON 导入/导出、无密码导出 |
| 网址规则 | JSON 导入/导出，首次安装预置 Google 相关规则 |
| 连通性测试 | 弹窗诊断区一键检测 SOCKS5 与远程节点 |
| 完整备份 | 导出/导入全部配置（含订阅链接与刷新设置） |
| 运行日志 | 选项页查看 / 清除 `data/singbox.log` |
| Native Host 检测 | 诊断注册的扩展 ID 是否与当前不一致 |
| 系统代理检测 | 检测 Windows / Chrome 系统代理是否与扩展冲突 |
| 版本号显示 | 弹窗与选项页展示当前扩展版本 |
| 项目网址 | 选项页可配置并随完整配置导出/导入 |

---

## 工作原理

```
┌─────────────────┐     PAC 脚本      ┌──────────────────┐
│  Chrome 浏览器   │ ────────────────→ │  127.0.0.1:SOCKS  │
│  (扩展设置代理)  │                   │  (sing-box 入站)  │
└─────────────────┘                   └────────┬─────────┘
                                               │ AnyTLS
                                               ▼
                                      ┌──────────────────┐
                                      │  AnyTLS 远程节点   │
                                      └──────────────────┘
```

1. **Chrome 扩展**通过 `chrome.proxy` API 注入 PAC 脚本，按规则决定请求走 `PROXY` 还是 `DIRECT`。
2. 开启分流时，扩展通过 **Native Messaging** 通知本机 Host 脚本启动 **sing-box**。
3. sing-box 在本地监听 SOCKS5 端口（每节点独立端口），将流量以 **AnyTLS** 协议转发至远程服务器。
4. 关闭分流或退出浏览器时，sing-box 进程自动停止。

---

## 节点与订阅

### AnyTLS URI 格式

```
anytls://password@example.com:443/?sni=real.example.com
anytls://password@1.2.3.4:8443/?insecure=1
anytls://password@host:443/#节点名称
```

| 字段 | 说明 |
|------|------|
| `password` | 认证密码（URI 用户名部分） |
| `host:port` | 服务器地址，默认端口 443 |
| `sni` | TLS SNI，也可写 `peer` 或 `host` 参数 |
| `insecure=1` | 跳过证书验证 |
| `#名称` | 节点显示名称（可选） |

### 添加节点的方式

- **URI 导入**：粘贴单条或多条 `anytls://` 链接
- **手动添加**：在节点编辑弹窗填写主机、端口、密码、SNI 等
- **JSON 导入/导出**：批量管理，支持「导出（无密码）」
- **订阅链接**：在节点管理页填写 URL，点击「刷新订阅」

### 订阅格式

订阅内容支持以下形式：

- 每行一条 `anytls://` 链接
- Base64 编码的上述文本
- JSON 数组，或 `{ "nodes": [...] }` 结构

可开启 **定时自动刷新**，后台通过 Native Host 拉取（扩展本身无需额外网络权限）。

### 多节点与端口

- 每个节点占用一个本地 SOCKS 端口（默认从 1080 递增分配）
- 不同代理规则可指定不同节点；未指定则使用 **默认节点**
- 全局代理模式下仅使用默认节点
- **各节点本地端口不可冲突**

---

## 网址规则

### 匹配类型

| 类型 | 示例 | 匹配范围 |
|------|------|----------|
| 域名 | `google.com` | `google.com` 及其所有子域名 |
| 通配符 | `*.google.com` | 按 `*` 模式匹配 host |
| 正则 | `^.*\.google\.(com\|co\.jp)$` | 对 host 做正则匹配（高级） |

### 直连名单

直连名单优先级 **最高**，即使开启全局代理也会强制直连：

- 内置规则：gov.cn、工行/建行/农行等银行域名、支付宝等（可在选项页关闭）
- 自定义规则：手动添加需直连的域名

### 规则管理

- 支持搜索、启用/禁用单条规则
- JSON 文件导入/导出
- 首次安装自动预置 Google、YouTube 等常用规则

---

## 数据与安全

| 数据 | 存储位置 | 是否跨设备同步 |
|------|----------|----------------|
| 节点与密码 | `chrome.storage.local` | 否（仅本机） |
| 当前默认节点 ID | `chrome.storage.local` | 否 |
| 分流开关、规则、直连名单 | `chrome.storage.sync` | 是（Google 账号） |
| 404 自动走代理开关、项目网址 | `chrome.storage.sync` | 是 |
| 临时代理规则 | `chrome.storage.session` | 否（关闭浏览器清空） |
| sing-box 运行时配置 | `data/singbox-config.json` | 否（含密码，已在 `.gitignore` 排除） |
| 运行日志 | `data/singbox.log` | 否 |

**安全建议：**

- 导出配置时可选 **「导出（无密码）」** 再分享
- 切勿将 `data/` 目录或含密码的 JSON 提交到 Git
- 更多说明见 [SECURITY.md](SECURITY.md)

---

## 项目结构

```
WallPenetrating/
├── background/              # Service Worker（代理、Native 通信、订阅刷新）
├── popup/                   # 工具栏弹窗 UI
├── options/                 # 完整设置页
├── lib/                     # 核心逻辑（PAC、路由、存储、订阅解析等）
│   └── version.js           # 扩展版本号（与 manifest.json 同步）
├── native/                  # Native Messaging Host 脚本与注册模板
│   ├── host.ps1 / host.cmd  # sing-box 进程管理
│   └── com.anytls.singbox.json.template
├── scripts/                 # 安装与维护脚本
├── icons/                   # 扩展图标（16 / 48 / 128 px）
├── bin/                     # sing-box 二进制（v1.13.14，含 LICENSE）
│   ├── sing-box.exe
│   ├── libcronet.dll
│   └── sing-box.version
├── data/                    # 运行时目录（git 忽略，本地生成）
├── 一键安装.cmd             # 推荐安装入口
├── install.ps1              # 安装向导
├── 开始使用.html            # 安装后快速入门页
├── manifest.json            # Chrome 扩展清单（当前 v1.10.1）
└── README.md
```

---

## 高级命令

在项目根目录 PowerShell 中执行：

```powershell
# 指定扩展 ID，跳过交互输入
.\install.ps1 -ExtensionId <32位小写字母ID>

# 强制重新下载 sing-box（默认 v1.13.14，一般无需执行）
.\install.ps1 -DownloadSingbox

# 单独下载/升级 sing-box 到指定版本
.\scripts\download-singbox.ps1 -Version 1.13.14

# 重新生成扩展图标
.\scripts\generate-icons.ps1

# 停止 sing-box 进程（自动读取配置端口）
.\scripts\kill-singbox.ps1
```

---

## 故障排查

| 现象 | 可能原因 | 解决方法 |
|------|----------|----------|
| Native Host 未安装 | 未运行安装脚本 | 双击 `一键安装.cmd`，粘贴**当前**扩展 ID |
| 扩展 ID 已变更 | 卸载重装扩展后 ID 改变 | 重新运行 `一键安装.cmd` |
| sing-box 未运行 | 进程异常退出 | 关闭再打开分流开关；查看 `data/singbox.log` |
| 端口被占用 | 本地 SOCKS 端口冲突 | 运行 `scripts\kill-singbox.ps1`，或修改节点本地端口 |
| Google / YouTube 打不开 | Chrome QUIC 绕过代理 | `chrome://flags` → 搜索 `#enable-quic` → 设为 **Disabled** |
| 银行网站异常 | 误走代理 | 确认直连名单已启用，或将域名加入直连规则 |
| 安装向导中文乱码 | 代码页不正确 | 务必通过 `一键安装.cmd` 启动，勿手动改代码页 |
| 订阅刷新失败 | 网络或格式问题 | 检查订阅 URL；确认内容为 `anytls://` 格式 |
| 系统代理冲突 | Windows / Chrome 设置了全局代理 | 选项页「运行环境」查看诊断并关闭冲突代理 |

---

## 开发者说明

### 本地开发

1. 克隆仓库后运行 `一键安装.cmd` 完成 Native Host 注册
2. 在 `chrome://extensions/` 加载本项目目录
3. 修改代码后在扩展管理页点击 **重新加载**

### GitHub 仓库

- 地址：https://github.com/dlsandy/WallPenetrating
- 默认分支：`main`

首次推送示例：

```powershell
git remote add origin https://github.com/dlsandy/WallPenetrating.git
git push -u origin main
```

仓库已配置 `.gitignore`、`.gitattributes`、CI 校验工作流（`.github/workflows/validate.yml`）与 Issue 模板。

### 第三方依赖

- [sing-box](https://github.com/SagerNet/sing-box) v1.13.14 — 已内置在 `bin/`，遵循 [GPLv3](bin/LICENSE)。如需升级版本，运行 `scripts/download-singbox.ps1`。

---

## 许可

MIT — 见 [LICENSE](LICENSE)
