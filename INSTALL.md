# 暖记 · 记账本 — 安装与部署说明

应用是**纯静态 PWA**（网页应用），不用打包、不用 npm install。已自带 `manifest.webmanifest`（可安装）+ `sw.js`（离线缓存）。

## 一、本地预览（开发/自测）
在 `accounting-app` 目录执行：
```
python -m http.server 5174
```
浏览器打开 http://localhost:5174 即可。语音在 localhost 下可用；装到手机需要 https（见下）。

## 二、装到手机

### 安卓（推荐：Chrome 直接「安装」，无需任何文件）
1. 把整个 `accounting-app` 文件夹部署到一个 **https** 网址（见第三节）。
2. 手机 Chrome 打开该网址 → 地址栏点「安装」图标，或菜单「安装应用 / 添加到主屏幕」。
3. 桌面出现「暖记」图标，像原生 app 一样全屏使用、可离线。

### 安卓（生成 APK 安装包，可发给别人装）
需要本机有 **JDK 17 + Android SDK**（或 Android Studio）。命令：
```
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://你的域名/manifest.webmanifest
bubblewrap build        # 按提示生成签名密钥，产物为 .aab / .apks，可侧载安装
```
不想装环境的话，用在线工具 **PWABuilder.com** 或 **pwa2apk.com** 粘贴 manifest 网址，直接下载 APK。

### 苹果 iPhone
1. 用 **Safari** 打开 https 网址。
2. 点底部「分享」→「添加到主屏幕」→ 主屏出现「暖记」图标。
3. ⚠️ iOS Safari **不支持网页语音识别**，记账请用「✏️ 手动记一笔」；安卓上语音正常。

## 三、已发布的线上地址（0 元）
👉 **https://00c7162c74f947ec9e2fb3f741564637.app.workbuddy.link**

已验证可访问，直接把这个链接发到手机浏览器打开即可（不用配服务器、不用注册）。

### 安卓安装（Chrome）
1. 用 **Chrome** 打开上面的链接
2. 点右上角 ⋮ → **「安装应用」**（或「添加到主屏幕」）
3. 桌面出现「暖记」图标，全屏使用、可离线 ✅

### 苹果 iPhone 安装（Safari）
1. 用 **Safari** 打开上面的链接（必须是 Safari，Chrome 不行）
2. 点底部「分享」→ **「添加到主屏幕」**
3. 主屏出现「暖记」图标 ✅
4. ⚠️ iOS Safari 不支持网页语音，记账用「✏️ 手动记一笔」即可（安卓语音正常）

### 想要真正的 .apk 安装包（0 元，可选）
用上面这个链接去 **PWABuilder.com**（微软官方，免费）粘贴网址 → 一路下一步 → 下载 APK，可直接发给别人装。不需要苹果开发者账号、不需要 99 美元。

## 四、部署到 https（自己的网址，短而好记，0 元）

当前第三节的 workbuddy 链接是**临时沙箱地址**：依赖本机会话、网址一长串难记、你也没法改。
想「不依赖本地、网址短、可自定义」，把整个 `accounting-app` 文件夹传到下面任一个**免费静态托管**即可，传上去就永久在线，网址还能随时改。

> 上传包已为你打好：`暧记记账本_上传包.zip`（解压后 `index.html` 就在根目录，拖进去就能用）。

### 方案 A：Netlify（最推荐，拖一下就好，网址能自定义，最短）
1. 打开 https://app.netlify.com/drop （不注册也能拖；注册后方便改名和管理）
2. 把解压后的 `accounting-app` 文件夹**整个拖进虚线框**
3. 几秒后生成网址如 `https://random-123.netlify.app` → 点 **Site settings → Site name** 改成你喜欢的短名，例如 `nuanji`，网址立刻变成 `https://nuanji.netlify.app`（好记！）
4. 手机浏览器打开这个网址 → 安卓 Chrome「安装应用」/ iPhone Safari「添加到主屏幕」
5. （进阶可选）想用自己买的域名（如 `nuanji.com`）：Site settings → Domain management 按提示绑定，仅域名本身收费，托管免费

### 方案 B：GitHub Pages（免费永久，网址 = 你的用户名.github.io）
1. 注册 GitHub（用户名自己取，会出现在网址里）
2. 新建仓库（仓库名随意，如 `nuanji`）
3. 把 `accounting-app` 里的**所有文件**上传到仓库（直接把 zip 解压后拖进 GitHub 网页上传区，或本地 git push）
4. 仓库 → **Settings → Pages → Branch 选 main/master → Save**
5. 等一两分钟，网址为 `https://你的用户名.github.io/仓库名`
6. （进阶）GitHub Pages 免费版也支持绑自己的域名
⚠️ 免费版仓库需设**公开**；你的账目只存在手机本地、不上传，公开仓库只暴露网页代码、不暴露你的账本，安全。

### 方案 C：Vercel
和 Netlify 类似，https://vercel.com 拖文件夹或连 GitHub 仓库，自动给 `xxx.vercel.app` 域名，可改名/绑域名。

### 改完网址后
- 安卓用 PWABuilder.com 粘贴**新网址**的 manifest，可重新生成 APK 发给别人。
- 旧 workbuddy 链接仍可继续用，两个网址是同一套网页，数据各自存在各自手机本地。

## 五、语音说明
- 语音识别走浏览器云端（Web Speech API），需联网；**你的账目只存在手机本地 IndexedDB，绝不上传**。
- 安卓 Chrome 中英文识别稳定；iOS 不支持网页语音，自动回退手动输入。

## 六、功能一览
- 记一笔：🎙️ 语音（中英文、自动提金额+猜类目、确认后存）/ 手动 / 备注 / 拍照小票
- 日历：点日期看当天收支明细与小计
- 统计：日 / 自然周(周一~周日) / 日历月(1–12) / 日历年 四口径；SVG 圆形图按类目占比（支出/收入可切换）
- 预算：每月总预算 + 分类预算，超 80% 橙、超 100% 红（仅 app 内高亮）
- 我的：分类加/删/隐藏、预算设置、导出/导入 .json 备份
- 风格：简约温暖、全圆角卡片、底部 Tab 丝滑切换、笔记本图标
