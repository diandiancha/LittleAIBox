<div align="center">

# 参与贡献 LittleAIBox

**感谢您帮助改进 LittleAIBox！** 🎉

每一个 Bug 报告、想法或代码行都让这个项目变得更好。🌱

[中文](CONTRIBUTING.zh-CN.md) | [English](../CONTRIBUTING.md) | [日本語](CONTRIBUTING.ja.md) | [한국어](CONTRIBUTING.ko.md) | [Español](CONTRIBUTING.es.md)

</div>

---

## 🚀 快速开始（新贡献者）

1. **Fork 并克隆**

   ```bash
   git clone https://github.com/diandiancha/LittleAIBox.git
   cd LittleAIBox
   npm install
   npm run dev
   ```

2. **进行修改** → 本地测试（查看终端显示的端口）

3. **提交更改** → `git commit -m "fix: 修复 i18n 中的拼写错误"`

4. **推送并打开 Pull Request**

5. 🎉 完成！我会尽快审核。

> 💡 *如果您是 GitHub 新手，请查看 [First Contributions](https://github.com/firstcontributions/first-contributions)。*

---

## 🧭 行为准则

保持友善、包容和建设性。

大家都在学习 — 帮助他人与您一起成长。❤️

---

## 💡 贡献方式

- 🐛 **报告 Bug** — 通过 [Issues](https://github.com/diandiancha/LittleAIBox/issues)
- ✨ **建议功能** — 欢迎新的想法或改进
- 📝 **改进文档** — 修复拼写错误、添加示例
- 🌍 **翻译 UI** — 帮助让 LittleAIBox 在全球可访问
- 🔧 **提交代码** — Bug 修复、重构、新功能
- 🏗️ **协助重构代码** — 一起改进代码库结构

---

## 🧑‍💻 开发环境设置

**要求**
- Node.js 20.x 至少 20.19，或 22.12 及以上（与 Vite 一致）
- npm ≥ 9
- Git（最新版）
- VS Code（推荐）

**本地启动**

本仓库构建前端，不包含完整托管服务。使用服务功能时，手动复制 `.env.example` 为 `.env.local`，通过 `VITE_API_BASE_URL` 配置兼容后端来源地址。本地开发不再默认使用官方生产 API；`VITE_*` 会公开进入浏览器代码，不能放密钥。

```bash
npm install
npm run dev
```

**生产构建**

```bash
npm run build
```

**移动端测试（可选）**

```bash
npx cap add android
npx cap sync
npx cap open android
```

---

## 🧩 项目结构

```
LittleAIBox/
├── src/                    # 源代码
│   ├── main.js            # 主应用逻辑
│   ├── api-config.js      # API 配置
│   ├── db.js              # IndexedDB 封装
│   ├── i18n.js            # 国际化
│   ├── mermaid-renderer.js # 图表渲染
│   ├── rendering/         # 实际使用的 Mermaid/Vega 渲染器与主题配置
│   ├── mathrender/        # 公式预处理与渲染
│   ├── keyboard/          # 原生/浏览器驱动与聊天适配
│   ├── file-parsers/      # 文档读取与解析生命周期
│   ├── worker-parsers/    # 文档解析 Worker
│   ├── floating-timeline.js # 浮动时间轴导航
│   ├── style.css          # 全局样式
│   └── sw-custom.js       # Service Worker
├── public/                 # 静态资源
│   ├── locales/           # 七份语言目录
│   ├── libs/              # 第三方库
│   ├── images/            # 图片和图标
│   └── shared/            # 共享浏览器模块；manifest.json 在构建时生成
├── appshow/                # 按语言分类的截图
├── capacitor.config.json   # 移动应用配置
├── vite.config.js          # 构建配置
├── package.json            # 依赖和脚本
└── index.html              # 主 HTML 入口点
```

---

## 🧾 提交与代码风格（中高级贡献者）

### 💬 约定式提交

```
<type>(<scope>): <description>
```

**常见类型**
- `feat` — 新功能
- `fix` — 修复 Bug
- `docs` — 文档
- `style` — 代码格式
- `refactor` — 非破坏性重构
- `perf` — 性能优化
- `test` — 测试相关

**示例**

```bash
feat(i18n): 添加葡萄牙语翻译
fix(file): 处理 PDF 解析错误
docs(readme): 更新安装说明
refactor(rag): 优化分块算法
```

### 🧱 代码规范

- 使用 **ES6+** 特性
- 优先使用 `async/await`
- 使用 `const` 和 `let`（避免 `var`）
- 需要时使用 JSDoc 编写清晰的注释
- 保持函数简短和专注

### 📝 代码示例

```javascript
// 好的做法
async function handleFileUpload(file) {
  if (!file) return;
  
  const isValid = validateFile(file);
  if (!isValid) {
    showToast('无效的文件格式');
    return;
  }
  
  try {
    const content = await parseFile(file);
    await processContent(content);
  } catch (error) {
    console.error('处理文件时出错:', error);
    showToast('处理文件失败');
  }
}
```

---

## 🔄 Pull Request 流程

1. **同步您的 fork**
   ```bash
   git fetch upstream
   git merge upstream/main
   ```

2. **创建分支**
   ```bash
   git checkout -b feature/我的功能
   ```

3. **测试更改** — 执行 `npm run build`，再验证受影响的浏览器行为

4. **推送并打开 PR**

**核心机制验证与源码边界**

- 图表和公式修复使用仓库自带库及完整复现输入，检查代码围栏、中文、主题与流式完成行为。
- 文档解析使用脱敏样例，检查文字、图片引用、Worker 及相关回退路径。
- 流式修改检查启动/续传缓冲、EOF 队列排空和已有图片/引用处理；浏览器及真实服务验证单独说明。
- DOM/公式状态修改在浏览器检查节点复用、Markdown 结构变化和公式横向滚动。
- Canvas 修改检查流式/历史卡片、源码编辑与复制、源码/预览切换、已支持的预览运行时及桌面/移动抽屉布局。验证文件仅保留本地，后端模拟与真实模型联调分别说明。
- 键盘修改注明已验证的浏览器和设备；Node 测试与桌面缩放不能证明原生键盘正确。
- PR 如实说明实际检查与剩余验证边界，共享模块修改要追踪现有调用者。
- 不提交后端实现、订阅支付规则、托管路由、凭据、签名材料和用户数据；文档仍可以完整介绍项目架构。
- 实际图表实现位于 `src/rendering/`，顶层旧文件仅作为兼容入口。

**Pull Request 模板**

```markdown
## 描述
这次更改做了什么以及为什么。

## 类型
- [ ] Bug 修复
- [ ] 新功能
- [ ] 文档
- [ ] 翻译

## 测试
如何测试这些更改：
1. 步骤一
2. 步骤二

## 检查清单
- [ ] 代码遵循风格指南
- [ ] 已测试并正常工作
- [ ] 无新警告
- [ ] 已更新文档
```

---

## 🐛 报告 Bug

提交前：
1. 搜索现有 [Issues](https://github.com/diandiancha/LittleAIBox/issues)
2. 检查浏览器控制台错误
3. 尝试在不同浏览器/设备上复现

**Bug 报告模板**

```markdown
**描述 Bug**
Bug 的清晰描述。

**复现步骤**
复现步骤：
1. 进入 '...'
2. 点击 '....'
3. 看到错误

**预期行为**
您期望发生的事情。

**环境**
- OS: [例如 Windows 11]
- Browser: [例如 Chrome 120]
- Device: [例如 桌面端、移动端]
- Version: [例如 2.3.1]
```

---

## 💡 建议功能

建议前考虑：
- 是否符合项目愿景（隐私优先、本地处理）？
- 作为纯客户端功能是否可行？
- 是否能让许多用户受益？

**功能请求模板**

```markdown
**功能摘要**
提议功能的简要描述。

**问题说明**
它解决了什么问题？谁受益？

**提议解决方案**
这个功能如何工作？

**考虑的替代方案**
您考虑过哪些其他方法？
```

---

## 🌐 翻译

支持的语言：
- 🇨🇳 简体中文 (zh-CN)
- 🇹🇼 繁体中文 (zh-TW)
- 🇬🇧 英语 (en)
- 🇯🇵 日语 (ja)
- 🇰🇷 韩语 (ko)
- 🇪🇸 西班牙语 (es)
- 🇫🇷 法语 (fr)

**添加新语言**

```bash
cp public/locales/en.json public/locales/您的语言.json
```

编辑值，保持键相同，然后在 `src/i18n.js` 中添加您的语言代码：

```javascript
const SUPPORTED_LANGUAGES = ['en', 'zh-CN', 'zh-TW', 'es', 'ja', 'ko', 'fr', '您的语言'];
```

测试：`npm run dev` → 在设置中切换到您的语言 → 验证所有 UI 元素已翻译。

---

## 🆘 需要帮助？

- 阅读 [README](README.zh-CN.md)
- 查看 [Issues](https://github.com/diandiancha/LittleAIBox/issues)
- 在 [Discussions](https://github.com/diandiancha/LittleAIBox/discussions) 中提问
- 打开带有 `question` 标签的 Issue

请耐心等待 — 我是学生，时间有限。🙏

---

## 🎓 学习资源

开源或 Web 开发新手？

**通用**
- [GitHub Flow](https://guides.github.com/introduction/flow/)
- [如何为开源做贡献](https://opensource.guide/how-to-contribute/)
- [First Contributions](https://github.com/firstcontributions/first-contributions)

**使用的技术**
- [Vanilla JavaScript](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript)
- [Vite](https://vitejs.dev/)
- [Capacitor](https://capacitorjs.com/docs)
- [IndexedDB](https://developer.mozilla.org/zh-CN/docs/Web/API/IndexedDB_API)
- [Service Workers](https://developer.mozilla.org/zh-CN/docs/Web/API/Service_Worker_API)

**代码质量与重构**
- [Refactoring.guru](https://refactoring.guru/) — 重构模式学习
- [Clean Code](https://github.com/ryanmcdermott/clean-code-javascript) — JavaScript 最佳实践
- [模块化](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Guide/Modules) — ES 模块指南

---

## 🙌 致谢

所有贡献者都列在 **Contributors 页面**并在**发布说明**中介绍。

感谢您让 LittleAIBox 变得更好！🚀

---

**记住**：作为学生开发者，我真心感谢您的贡献和耐心。让我们一起构建一些了不起的东西！💪
