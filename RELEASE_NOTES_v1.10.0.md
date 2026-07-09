## WallPenetrating v1.10.0

AnyTLS 分流代理 Chrome 扩展 — 指定网站走代理，内置 sing-box v1.13.14。

### 新增功能

#### 规则外 404 自动走代理
- 未在代理规则内的站点，直连返回 HTTP 404 时，自动加入临时代理规则并重新加载页面
- 开关：弹窗 / 选项页侧边栏「规则外 404 自动走代理」（默认关闭）
- 每个 URL 仅自动重试一次，冷却 3 秒

#### 临时代理规则
- 会话级规则，关闭浏览器后自动清空
- 选项页 → 网址管理 → 临时代理规则
- 支持转为永久代理规则

#### 界面与配置
- 弹窗、选项页显示扩展版本号
- 选项页可设置项目网址，随完整配置导出/导入

### 依赖更新
- 内置 sing-box 升级至 v1.13.14（支持 AnyTLS，需 1.12.0+）
- 新增 `webRequest` 权限用于 404 检测

### 安装
1. 下载 Source code (zip) 并解压
2. 双击 `一键安装.cmd` 完成 Native Host 注册
3. 在 `chrome://extensions/` 加载已解压的扩展程序

详细说明见 [README](https://github.com/dlsandy/WallPenetrating/blob/main/README.md)。
