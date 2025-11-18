# Cloudflare Pages 部署指南

本指南将帮助您将 IndexerChain 部署到 Cloudflare Pages，并配置自定义域名 `indexerchain.com`。

## 📋 前置要求

1. **Cloudflare 账户**
   - 如果没有，请访问 [cloudflare.com](https://cloudflare.com) 注册
   - 需要添加支付方式（即使使用免费计划）

2. **域名**
   - 确保您拥有 `indexerchain.com` 域名
   - 域名需要在 Cloudflare 上管理 DNS

3. **Git 仓库**
   - 项目需要推送到 GitHub、GitLab 或 Bitbucket

## 🚀 部署步骤

### 方法一：通过 Cloudflare Dashboard（推荐）

#### 1. 准备 Git 仓库

```bash
# 确保代码已提交到 Git
git add .
git commit -m "Prepare for Cloudflare Pages deployment"
git push origin main
```

#### 2. 在 Cloudflare Dashboard 中创建项目

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 选择 **Pages** → **Create a project**
3. 选择 **Connect to Git**
4. 选择您的 Git 提供商（GitHub/GitLab/Bitbucket）
5. 授权 Cloudflare 访问您的仓库
6. 选择 `IndexerChain` 仓库
7. 点击 **Begin setup**

#### 3. 配置构建设置

在构建设置页面，填写以下信息：

- **Project name**: `indexerchain`（或您喜欢的名称）
- **Production branch**: `main`（或您的主分支名称）
- **Build command**: `npm run build`
- **Build output directory**: `dist`
- **Root directory**: `/`（留空或填写 `/`）

#### 4. 环境变量（可选）

如果需要设置环境变量，可以在 **Environment variables** 部分添加：

- `NODE_VERSION`: `20`（确保使用 Node.js 20）

#### 5. 开始部署

点击 **Save and Deploy**，Cloudflare 将：
1. 克隆您的仓库
2. 安装依赖（`npm install`）
3. 运行构建命令（`npm run build`）
4. 部署到 Cloudflare Pages

部署完成后，您会获得一个 `*.pages.dev` 的临时 URL。

### 方法二：通过 Wrangler CLI

#### 1. 安装 Wrangler

```bash
npm install -g wrangler
# 或
npm install --save-dev wrangler
```

#### 2. 登录 Cloudflare

```bash
wrangler login
```

#### 3. 创建 Pages 项目

```bash
# 在项目根目录
wrangler pages project create indexerchain
```

#### 4. 部署

```bash
# 构建项目
npm run build

# 部署到 Cloudflare Pages
wrangler pages deploy dist --project-name=indexerchain
```

## 🌐 配置自定义域名

### 1. 在 Cloudflare 中添加域名

1. 在 Cloudflare Dashboard 中，进入 **Pages** → 选择您的项目
2. 点击 **Custom domains** 标签
3. 点击 **Set up a custom domain**
4. 输入 `indexerchain.com`
5. 点击 **Continue**

### 2. 配置 DNS 记录

Cloudflare 会自动检测您的 DNS 设置。如果域名已在 Cloudflare 管理：

1. 进入 **DNS** → **Records**
2. 确保有以下记录：
   - **Type**: `CNAME`
   - **Name**: `@` 或 `indexerchain.com`
   - **Target**: `indexerchain.pages.dev`（或 Cloudflare 提供的目标）
   - **Proxy status**: Proxied（橙色云朵）

如果域名不在 Cloudflare 管理：

1. 在您的 DNS 提供商处添加 CNAME 记录：
   - **Name**: `@` 或 `indexerchain.com`
   - **Target**: `indexerchain.pages.dev`（或 Cloudflare 提供的目标）

### 3. 等待 DNS 传播

DNS 记录通常需要几分钟到几小时才能生效。您可以使用以下命令检查：

```bash
# 检查 DNS 记录
dig indexerchain.com CNAME

# 或使用 nslookup
nslookup indexerchain.com
```

### 4. SSL/TLS 配置

Cloudflare 会自动为您的域名配置 SSL 证书（通常需要几分钟）。确保：

1. 在 **SSL/TLS** → **Overview** 中，选择 **Full (strict)**
2. 等待 SSL 证书自动生成（通常 5-15 分钟）

## 🔧 高级配置

### 1. 自定义构建命令

如果需要自定义构建，可以在项目根目录创建 `_redirects` 文件（用于 SPA 路由）：

```bash
# 在 dist 目录创建 _redirects 文件
echo "/*    /index.html   200" > dist/_redirects
```

或者使用 `cloudflare-pages.json` 配置文件（已创建）。

### 2. 环境变量

在 Cloudflare Dashboard 中：

1. 进入 **Pages** → 您的项目 → **Settings** → **Environment variables**
2. 添加环境变量：
   - **Variable name**: `NODE_VERSION`
   - **Value**: `20`
   - **Environment**: Production, Preview, Branch deploys

### 3. 构建优化

确保 `vite.config.ts` 已配置好：

```typescript
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false, // 生产环境关闭 sourcemap 以减小体积
  },
});
```

### 4. 缓存策略

Cloudflare Pages 会自动缓存静态资源。如果需要自定义：

1. 在 `cloudflare-pages.json` 中配置 headers
2. 或使用 Cloudflare Dashboard 的 **Rules** 功能

## 📊 监控和日志

### 查看部署日志

1. 在 Cloudflare Dashboard 中，进入 **Pages** → 您的项目
2. 点击 **Deployments** 标签
3. 选择某个部署，查看构建日志

### 查看实时日志

```bash
# 使用 Wrangler CLI
wrangler pages deployment tail
```

## 🔄 持续部署

Cloudflare Pages 支持自动部署：

- **自动部署**：每次推送到主分支时自动部署
- **预览部署**：每次创建 Pull Request 时创建预览部署
- **分支部署**：可以为不同分支创建独立部署

### 配置自动部署

1. 在 **Settings** → **Builds & deployments** 中
2. 确保 **Auto-deploy** 已启用
3. 配置 **Production branch**（通常是 `main`）

## 🐛 故障排除

### 构建失败

1. **检查构建日志**：
   - 在 Cloudflare Dashboard 中查看详细的构建日志
   - 检查是否有依赖安装错误

2. **本地测试构建**：
   ```bash
   npm run build
   ```
   确保本地构建成功

3. **检查 Node.js 版本**：
   - 在环境变量中设置 `NODE_VERSION=20`

### DNS 问题

1. **检查 DNS 记录**：
   ```bash
   dig indexerchain.com CNAME
   ```

2. **等待 DNS 传播**：
   - DNS 更改可能需要几分钟到几小时

3. **清除 DNS 缓存**：
   ```bash
   # macOS/Linux
   sudo dscacheutil -flushcache
   
   # Windows
   ipconfig /flushdns
   ```

### SSL 证书问题

1. **等待证书生成**：
   - Cloudflare 自动生成 SSL 证书通常需要 5-15 分钟

2. **检查 SSL 模式**：
   - 确保 SSL/TLS 模式设置为 **Full (strict)**

### 404 错误（SPA 路由）

确保配置了正确的重定向规则：

1. 在 `dist` 目录创建 `_redirects` 文件
2. 或使用 `cloudflare-pages.json` 中的 redirects 配置

## 📝 部署检查清单

- [ ] 代码已推送到 Git 仓库
- [ ] 本地构建成功（`npm run build`）
- [ ] 在 Cloudflare Pages 创建项目
- [ ] 配置构建命令和输出目录
- [ ] 首次部署成功
- [ ] 配置自定义域名
- [ ] DNS 记录已添加
- [ ] SSL 证书已生成
- [ ] 访问 https://indexerchain.com 正常
- [ ] 自动部署已启用

## 🔗 相关链接

- [Cloudflare Pages 文档](https://developers.cloudflare.com/pages/)
- [Wrangler CLI 文档](https://developers.cloudflare.com/workers/wrangler/)
- [Cloudflare Dashboard](https://dash.cloudflare.com/)

## 💡 提示

1. **免费计划限制**：
   - 每月 500 次构建
   - 无限带宽
   - 全球 CDN

2. **性能优化**：
   - Cloudflare Pages 自动启用 CDN
   - 静态资源自动压缩
   - 自动 HTTP/2 和 HTTP/3

3. **安全性**：
   - 自动 DDoS 防护
   - SSL/TLS 加密
   - WAF（Web Application Firewall）可选

部署完成后，您的 IndexerChain 将在 https://indexerchain.com 上运行！

