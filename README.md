<p align="center"><img src="assets/icons/schedule-round.png" width="180" alt="Sylus with You 圆形图标"></p>

# Sylus with You · 秦彻陪伴

一只按作息生活的 Q 版秦彻，陪你待在桌面上。非官方粉丝项目，本地离线运行。

**[下载最新版](https://github.com/JingjingLi27/sylus-with-you/releases/latest)** · **[安装说明](INSTALL.md)** · **[反馈问题](https://github.com/JingjingLi27/sylus-with-you/issues)**

| 电脑 | 下载文件 |
|---|---|
| Mac，Apple Silicon M 系列 | `macOS-Apple-Silicon.dmg` |
| Windows 10/11，Intel/AMD 64 位 | `Windows-x64.zip` |

Mac 拖入「应用程序」安装；Windows 完整解压后运行 `QincheCompanion.exe`。无需开发环境、API Key 或联网。Intel Mac 暂无安装包。

**发布状态：** Mac 包已使用 Developer ID 签名、通过 Apple 公证并附加票据，Gatekeeper 检查通过。Windows 仍未做发布者签名，且尚未完成 Windows 实机验收。旧版 Mac 用户请重新下载当前 DMG。

## 陪伴内容

- 九段作息，按电脑当地时间自动切换。
- 点击互动、拖动、置顶、大小调节、隐藏与减少动态效果。
- 睡觉梦到钱和走路的小狸花猫；洗头大部分时间开心，偶尔泡沫入眼。
- 听音乐 30 秒、唱歌 12 秒循环；回家只有文字点击反馈。

| 时间 | 活动 |
|---|---|
| 00:00–02:00 | 午餐 |
| 02:00–04:30 | 自由活动 |
| 04:30–11:00 | 回家 |
| 11:00–17:10 | 睡觉 |
| 17:10–17:20 | 起床 |
| 17:20–20:00 | 早餐 |
| 20:00–21:00 | 听古典乐、唱歌 |
| 21:00–23:00 | 拳击训练 |
| 23:00–00:00 | 冲澡换衣服 |

## 从源码构建

推荐 Node.js 24 和 npm。素材已包含在仓库中，构建不依赖维护者电脑的其它文件夹。

```bash
npm ci
npm run typecheck
npm test
npm run build
npm start
```

- Mac arm64：`npm run package`，然后 `npm run package:dmg`（DMG 需在 macOS 上构建）。
- Windows x64：`npm run package:windows`，输出完整免安装文件夹；可从 macOS 交叉打包。
- 首次依赖安装/打包需要网络下载 Electron。开发时可通过 `QINCHE_USER_DATA` 隔离测试设置、`QINCHE_TEST_NOW` 注入测试时间；正常用户无需设置。

## 验证与边界

194 项共享逻辑测试通过；Mac 桌宠已进行本机交互验证。发布包检查了架构、运行素材完整性和压缩包完整性。Windows 实机启动、透明穿透、高 DPI、多屏、真实休眠恢复和长期资源表现尚待验证。

## 素材与许可

详见 [素材来源与权利说明](ASSETS.md)。角色与官方素材属于各自权利人，AI 辅助定制图片不改变角色权利归属。源码公开可查看，目前未授予额外开源许可（UNLICENSED）。请勿将本项目误认为官方产品。


### Mac 签名与公证（维护者）

`QINCHE_SIGN_IDENTITY` 指定钥匙串中的 Developer ID Application 身份，运行 `node scripts/sign-mac.mjs`。脚本仅签署 Mach-O 代码与应用/框架，不单独签署图片、语言资源或 ASAR。私钥和公证密码不得放入仓库。

通过 `notarytool` 使用本机钥匙串配置提交应用 ZIP，只有状态为 Accepted 后才执行 `xcrun stapler staple` / `validate` 和 `spctl --assess --type execute`。最后设置 `QINCHE_DEVELOPER_ID_SIGNED=1 npm run package:dmg`，保留已有签名与票据；未设置时构建的是仅 ad-hoc 签名的开发包，不能宣称公证通过。
