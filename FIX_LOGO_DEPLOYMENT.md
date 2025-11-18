# 修复 Logo 在 Cloudflare Pages 中不显示的问题

## 问题原因

Cloudflare Pages 的 SPA 重定向规则可能会拦截静态资源请求，导致 logo 等静态文件无法正常加载。

## 解决方案

### 1. 使用 `_redirects` 文件（推荐）

在 `public/_redirects` 文件中，我们添加了静态资源的排除规则，确保这些文件不会被重定向到 `index.html`：

```
# Static assets - don't redirect
/logo/*    200
/assets/*  200
/*.png     200
...
```

### 2. 更新 Cloudflare Pages 配置

在 `cloudflare-pages.json` 中，我们也添加了相应的重定向规则和 headers 配置。

## 部署步骤

### 方法一：重新构建并部署

1. **确保 `_redirects` 文件在 `public/` 目录**：
   ```bash
   # 文件应该在这里
   public/_redirects
   ```

2. **重新构建**：
   ```bash
   npm run build
   ```

3. **检查 `dist/_redirects` 文件**：
   ```bash
   cat dist/_redirects
   ```
   应该看到静态资源的排除规则。

4. **推送到 Git 并重新部署**：
   ```bash
   git add public/_redirects cloudflare-pages.json
   git commit -m "Fix logo deployment - add static asset redirects"
   git push origin main
   ```

5. **在 Cloudflare Dashboard 中触发重新部署**：
   - 进入 Pages → 您的项目
   - 点击 **Retry deployment** 或等待自动部署

### 方法二：手动验证

1. **检查构建输出**：
   ```bash
   ls -la dist/logo/
   # 应该看到 logo.png
   ```

2. **测试本地预览**：
   ```bash
   npm run preview
   ```
   访问 http://localhost:4173/logo/logo.png 应该能看到 logo。

3. **检查 Cloudflare 部署日志**：
   - 在 Cloudflare Dashboard 中查看部署日志
   - 确认 `_redirects` 文件被正确复制

## 验证修复

部署完成后，访问以下 URL 验证：

1. **Logo 直接访问**：
   - https://indexerchain.com/logo/logo.png
   - 应该直接显示图片，而不是重定向到 index.html

2. **页面中的 Logo**：
   - https://indexerchain.com
   - 页面顶部的 logo 应该正常显示

3. **Favicon**：
   - https://indexerchain.com/logo/logo.png
   - 浏览器标签页应该显示 favicon

## 如果仍然不显示

### 检查清单

- [ ] `public/_redirects` 文件存在且内容正确
- [ ] `dist/_redirects` 文件在构建后存在
- [ ] `dist/logo/logo.png` 文件存在
- [ ] Cloudflare Pages 部署日志显示文件已上传
- [ ] 浏览器控制台没有 404 错误
- [ ] 清除浏览器缓存后重新加载

### 调试步骤

1. **检查网络请求**：
   - 打开浏览器开发者工具（F12）
   - 进入 Network 标签
   - 刷新页面
   - 查找 `/logo/logo.png` 请求
   - 查看状态码和响应

2. **检查 Cloudflare 缓存**：
   - 在 Cloudflare Dashboard 中清除缓存
   - 或使用 `?v=timestamp` 参数绕过缓存

3. **验证文件路径**：
   - 确保代码中使用的是 `/logo/logo.png`（绝对路径）
   - 而不是 `./logo/logo.png` 或 `logo/logo.png`（相对路径）

## 额外优化

### 1. 添加版本号（可选）

如果 logo 更新后需要强制刷新，可以在代码中添加版本号：

```tsx
<img 
  src="/logo/logo.png?v=1.0" 
  alt="IndexerChain Logo" 
/>
```

### 2. 使用 CDN URL（可选）

如果 logo 很大，可以考虑使用 Cloudflare Images 或外部 CDN。

## 相关文件

- `public/_redirects` - Cloudflare Pages 重定向规则
- `cloudflare-pages.json` - Cloudflare Pages 配置文件
- `public/logo/logo.png` - Logo 源文件
- `dist/logo/logo.png` - 构建后的 Logo 文件

修复完成后，logo 应该能在 https://indexerchain.com 正常显示了！

