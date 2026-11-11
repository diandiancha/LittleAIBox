<div align="center">

# Contributing to LittleAIBox

**Thank you for helping improve LittleAIBox!** 🎉

Every bug report, idea, or line of code makes this project better. 🌱

[English](CONTRIBUTING.md) | [中文](docs/CONTRIBUTING.zh-CN.md) | [日本語](docs/CONTRIBUTING.ja.md) | [한국어](docs/CONTRIBUTING.ko.md) | [Español](docs/CONTRIBUTING.es.md)

</div>

---

## 🚀 Quick Start (For New Contributors)

1. **Fork & Clone**

   ```bash
   git clone https://github.com/YOUR_USERNAME/LittleAIBox.git
   cd LittleAIBox
   npm install
   npm run dev
   ```

2. **Make changes** → Test locally (check the port shown in terminal)

3. **Commit changes** → `git commit -m "fix: correct typo in i18n"`

4. **Push & Open a Pull Request**

5. 🎉 Done! I'll review it as soon as possible.

> 💡 *If you're new to GitHub, check [First Contributions](https://github.com/firstcontributions/first-contributions).*

---

## 🧭 Code of Conduct

Be kind, inclusive, and constructive.

Everyone's learning — help others grow with you. ❤️

---

## 💡 Ways You Can Contribute

- 🐛 **Report Bugs** — via [Issues](https://github.com/diandiancha/LittleAIBox/issues)
- ✨ **Suggest Features** — new ideas or improvements welcome
- 📝 **Improve Documentation** — fix typos, add examples
- 🌍 **Translate UI** — help make LittleAIBox accessible worldwide
- 🔧 **Submit Code** — bug fixes, refactors, new features
- 🏗️ **Help Refactor Code** — work together to improve codebase structure

---

## 🧑‍💻 Development Setup

**Requirements**
- Node.js 20.x at least 20.19, or 22.12+ (matching Vite)
- npm ≥ 9
- Git (latest)
- VS Code (recommended)

**Start locally**

This checkout builds the frontend, not the complete hosted service. For service-backed features, copy `.env.example` to `.env.local` and configure a compatible backend origin with `VITE_API_BASE_URL`. The development build does not automatically use the official production API. Never put secrets in `VITE_*` variables.

```bash
npm install
npm run dev
```

**Build for production**

```bash
npm run build
```

**Mobile testing (optional)**

```bash
npx cap add android
npx cap sync
npx cap open android
```

---

## 🧩 Project Structure

```
LittleAIBox/
├── src/                    # Source code
│   ├── main.js            # Main application logic
│   ├── api-config.js      # API configuration
│   ├── db.js              # IndexedDB wrapper
│   ├── i18n.js            # Internationalization
│   ├── mermaid-renderer.js # Diagram rendering
│   ├── rendering/         # Active Mermaid/Vega renderers and theme settings
│   ├── mathrender/        # Formula preprocessing and rendering
│   ├── keyboard/          # Native/browser drivers and chat adapter
│   ├── file-parsers/      # Document readers and parse lifecycle
│   ├── worker-parsers/    # Parser Workers
│   ├── floating-timeline.js # Floating timeline navigation
│   ├── style.css          # Global styles
│   └── sw-custom.js       # Service Worker
├── public/                 # Static assets
│   ├── locales/           # Seven locale catalogs
│   ├── libs/              # Third-party libraries
│   ├── images/            # Images and icons
│   └── shared/            # Shared browser modules; manifest.json is generated at build time
├── appshow/                # Screenshots by language
├── capacitor.config.json   # Mobile app configuration
├── vite.config.js          # Build configuration
├── package.json            # Dependencies
└── index.html              # Main HTML entry point
```

---

## 🧾 Commit & Code Style (For Intermediate/Advanced Contributors)

### 💬 Conventional Commits

```
<type>(<scope>): <description>
```

**Common types**
- `feat` — new feature
- `fix` — bug fix
- `docs` — documentation
- `style` — code formatting
- `refactor` — non-breaking refactor
- `perf` — performance improvement
- `test` — testing changes

**Examples**

```bash
feat(i18n): add Portuguese translation
fix(file): handle PDF parse errors
docs(readme): update installation instructions
refactor(rag): optimize chunking algorithm
```

### 🧱 Code Standards

- Use **ES6+** features
- Prefer `async/await`
- Use `const` and `let` (avoid `var`)
- Write clear comments with JSDoc when needed
- Keep functions short and focused

### 📝 Example Code

```javascript
// Good
async function handleFileUpload(file) {
  if (!file) return;
  
  const isValid = validateFile(file);
  if (!isValid) {
    showToast('Invalid file format');
    return;
  }
  
  try {
    const content = await parseFile(file);
    await processContent(content);
  } catch (error) {
    console.error('Error processing file:', error);
    showToast('Failed to process file');
  }
}
```

---

## 🔄 Pull Request Process

1. **Sync your fork**
   ```bash
   git fetch upstream
   git merge upstream/main
   ```

2. **Create branch**
   ```bash
   git checkout -b feature/my-feature
   ```

3. **Test changes** — run `npm run build`, then verify affected browser behavior

4. **Push & open PR**

**Core validation and source boundaries**

- Use the bundled Mermaid/KaTeX libraries and complete reported input for rendering fixes. Check normal syntax, code fences, Chinese labels, themes and stream completion.
- For parsers, use sanitized documents and check text, image references, Worker execution and relevant fallback paths.
- For streaming changes, check start/resume buffering, EOF draining and existing image/citation handling; report browser/live-service verification separately.
- For DOM/formula-state changes, check node reuse, Markdown structure changes and horizontal formula scrolling in the browser.
- For Canvas changes, check streamed and historical cards, source edits/copy, code/preview switching, supported preview runtimes and desktop/mobile drawer layout. Keep validation fixtures local and distinguish backend simulation from live-model verification.
- For keyboard changes, state browsers/devices tested. Node tests and desktop resizing do not prove native keyboard behavior.
- Explain actual checks and remaining verification boundaries in the PR; preserve frontend contracts when changing shared modules.
- Keep backend implementations, subscription/payment rules, hosted routing, credentials, signing material and user data out of the repository. Architecture descriptions can still explain the complete project.
- Change active renderers under `src/rendering/`; top-level renderer files are compatibility entrypoints.

**Pull Request Template**

```markdown
## Description
What this change does and why.

## Type
- [ ] Bug fix
- [ ] Feature
- [ ] Documentation
- [ ] Translation

## Testing
How to test these changes:
1. Step one
2. Step two

## Checklist
- [ ] Code follows style guide
- [ ] Tested and working
- [ ] No new warnings
- [ ] Documentation updated
```

---

## 🐛 Reporting Bugs

Before submitting:
1. Search existing [Issues](https://github.com/diandiancha/LittleAIBox/issues)
2. Check browser console for errors
3. Try reproducing on different browsers/devices

**Bug Report Template**

```markdown
**Describe the Bug**
A clear description of what the bug is.

**To Reproduce**
Steps to reproduce:
1. Go to '...'
2. Click on '....'
3. See error

**Expected Behavior**
What you expected to happen.

**Environment**
- OS: [e.g. Windows 11]
- Browser: [e.g. Chrome 120]
- Device: [e.g. Desktop, Mobile]
- Version: [e.g. 2.3.1]
```

---

## 💡 Suggesting Features

Consider before suggesting:
- Does it align with project vision (privacy-first, local processing)?
- Is it feasible as client-side only?
- Would it benefit many users?

**Feature Request Template**

```markdown
**Feature Summary**
Brief description of the proposed feature.

**Problem Statement**
What problem does this solve? Who benefits?

**Proposed Solution**
How would this feature work?

**Alternatives Considered**
What other approaches did you think about?
```

---

## 🌐 Translations

Supported languages:
- 🇨🇳 Chinese Simplified (zh-CN)
- 🇹🇼 Chinese Traditional (zh-TW)
- 🇬🇧 English (en)
- 🇯🇵 Japanese (ja)
- 🇰🇷 Korean (ko)
- 🇪🇸 Spanish (es)
- 🇫🇷 French (fr)

**Add a new language**

```bash
cp public/locales/en.json public/locales/YOUR_LANG.json
```

Edit values, keep keys identical, then add your language code in `src/i18n.js`:

```javascript
const SUPPORTED_LANGUAGES = ['en', 'zh-CN', 'zh-TW', 'es', 'ja', 'ko', 'fr', 'YOUR_LANG'];
```

Test: `npm run dev` → Switch to your language in Settings → Verify all UI elements are translated.

---

## 🆘 Need Help?

- Read [README](README.md)
- Check [Issues](https://github.com/diandiancha/LittleAIBox/issues)
- Ask in [Discussions](https://github.com/diandiancha/LittleAIBox/discussions)
- Open an Issue with label `question`

Be patient — I'm a student with limited time. 🙏

---

## 🎓 Learning Resources

New to open source or web development?

**General**
- [GitHub Flow](https://guides.github.com/introduction/flow/)
- [How to Contribute to Open Source](https://opensource.guide/how-to-contribute/)
- [First Contributions](https://github.com/firstcontributions/first-contributions)

**Technologies Used**
- [Vanilla JavaScript](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
- [Vite](https://vitejs.dev/)
- [Capacitor](https://capacitorjs.com/docs)
- [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- [Service Workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)

**Code Quality & Refactoring**
- [Refactoring.guru](https://refactoring.guru/) — learn refactoring patterns
- [Clean Code](https://github.com/ryanmcdermott/clean-code-javascript) — JavaScript best practices
- [Module Pattern](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules) — ES modules guide

---

## 🙌 Recognition

All contributors are listed on the **Contributors page** and featured in **release notes**.

Thank you for making LittleAIBox better! 🚀

---

**Remember**: As a student developer, I truly appreciate your contributions and patience. Let's build something amazing together! 💪
