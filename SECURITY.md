# 安全说明

## 报告漏洞

如发现安全漏洞，请通过 GitHub Issues 报告（标题注明 `[Security]`），勿在公开 Issue 中粘贴节点密码、订阅链接等敏感信息。

## 本地数据

- 节点密码保存在本机 `chrome.storage.local`，不会同步到 Google 账号。
- 开启分流后，`data/singbox-config.json` 会写入本机（含密码），该目录已在 `.gitignore` 中排除，**请勿将其提交到 Git**。
- 导出配置时可选择「导出（无密码）」以安全分享。

## 第三方组件

- 本项目内置 [sing-box](https://github.com/SagerNet/sing-box) v1.13.14（`bin/sing-box.exe`），遵循其 [GPLv3 许可证](bin/LICENSE)。AnyTLS 协议需 sing-box **1.12.0+**。
