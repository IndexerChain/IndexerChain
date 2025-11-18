# 🚀 Cloudflare Pages 快速部署指南

## 一键部署步骤

### 1. 准备代码

```bash
# 确保所有更改已提交
git add .
git commit -m "Ready for Cloudflare Pages deployment"
git push origin main
```

### 2. 通过 Cloudflare Dashboard 部署

1. 访问 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 点击 **Pages** → **Create a project**
3. 选择 **Connect to Git**
4. 授权并选择您的仓库
5. 配置构建设置：
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
6. 点击 **Save and Deploy**

### 3. 配置自定义域名

部署完成后：

1. 进入项目 → **Custom domains**
2. 点击 **Set up a custom domain**
3. 输入 `indexerchain.com`
4. 按照提示配置 DNS 记录

### 4. 完成！

等待几分钟后，访问 https://indexerchain.com 即可看到您的应用。

## 📝 重要配置

### 构建配置

- **Node.js 版本**: 20（在环境变量中设置 `NODE_VERSION=20`）
- **构建命令**: `npm run build`
- **输出目录**: `dist`

### DNS 配置

添加 CNAME 记录：
- **Name**: `@` 或 `indexerchain.com`
- **Target**: `indexerchain.pages.dev`（Cloudflare 会提供）

### SSL 证书

Cloudflare 会自动生成 SSL 证书，通常需要 5-15 分钟。

## 🔧 故障排除

如果遇到问题，请查看 [DEPLOY_CLOUDFLARE_PAGES.md](./DEPLOY_CLOUDFLARE_PAGES.md) 获取详细指南。

