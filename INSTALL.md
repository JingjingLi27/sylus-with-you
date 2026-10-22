# 下载和安装 Sylus with You

下载入口：https://github.com/JingjingLi27/sylus-with-you/releases/latest

在页面的 **Assets** 下载文件，不要把自动生成的 Source code 当作安装包。

## Mac（Apple Silicon：M1 / M2 / M3 / M4 等 M 系列）

1. 下载 `Sylus-with-You-0.3.1-macOS-Apple-Silicon.dmg`。
2. 双击 DMG，将「秦彻陪伴.app」拖到 Applications（应用程序）。
3. 弹出磁盘映像，从「应用程序」打开秦彻陪伴。
4. 当前 Mac 下载包已使用 Developer ID 签名并通过 Apple 公证。首次打开仍可能显示普通的「从互联网下载」确认，确认应用名称后选择打开即可。
5. 若之前下载过未公证版本，请退出旧版，重新下载本页 DMG 并替换应用。如仍提示「已损坏」或「无法验证开发者」，请记录完整提示并提交 Issue，不要关闭系统安全保护。

此包仅含 arm64；不适用于 Intel Mac。2026-10-22 已完成公证票据附加，并通过 macOS Gatekeeper 检查（Notarized Developer ID）。

## Windows（Windows 10/11，Intel / AMD 64 位）

1. 下载 `Sylus-with-You-0.3.1-Windows-x64.zip`。
2. 右键压缩包，选择「全部解压」。不要在压缩包内部直接启动。
3. 打开解压文件夹，双击 `QincheCompanion.exe`。保留旁边全部文件，不要只复制 exe。
4. 本版未进行发布者签名，可能被 SmartScreen 提示未知发布者。只在确认来源并愿意信任的情况下按系统提示决定是否运行；不要关闭系统防护。

Windows 版已完成打包和文件检查，尚未在 Windows 实机验证。

## 怎么玩

- 根据电脑本地时间切换活动；无需联网、账户、Node.js、Claude 或 API Key。
- 点角色互动，拖动角色移动，右键查看作息或调整大小。
- 作息页点击时段可以预览；「回到现在」或关闭设置恢复实时作息。
- Mac 顶部菜单栏「秦彻」、Windows 右下角托盘都可找回隐藏的角色或退出程序。
- 更新前先退出旧版，再替换应用/完整文件夹；个人设置保留。

## 校验与反馈

Release 提供 `SHA256SUMS.txt`。Mac 可运行 `shasum -a 256 文件名`；Windows PowerShell 可运行 `Get-FileHash 文件名 -Algorithm SHA256`，与清单比对。

问题反馈：https://github.com/JingjingLi27/sylus-with-you/issues
请提供系统版本、芯片类型、软件版本和完整报错；不要上传密码、密钥或个人设置文件。
