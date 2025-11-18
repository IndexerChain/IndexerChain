# 🚀 信令服务器快速部署指南

## 当前状态

✅ **Wrangler 已安装** (v4.33.1)  
❌ **需要登录 Cloudflare**

## 立即开始部署（3 步）

### 步骤 1: 登录 Cloudflare

在终端运行：

```bash
wrangler login
```

这会：
1. 打开浏览器
2. 让你登录 Cloudflare 账户（如果没有，可以免费注册：https://dash.cloudflare.com/sign-up）
3. 授权 Wrangler 访问你的账户

**完成后继续下一步。**

---

### 步骤 2: 部署 Worker

```bash
cd workers
wrangler deploy
```

或者使用一键部署脚本：

```bash
# Mac/Linux
cd workers
./deploy.sh

# Windows
cd workers
deploy.bat
```

**部署成功后会显示 Worker URL**，类似：
```
✨  Uploaded indexerchain-signaling (X.XX sec)
Published indexerchain-signaling (X.XX sec)
  https://indexerchain-signaling.your-subdomain.workers.dev
```

**重要**：复制这个 URL，下一步需要用到！

---

### 步骤 3: 更新应用配置

1. **打开文件**：`src/ui/App.tsx`

2. **找到第 67 行**，修改：
```typescript
// 将这行：
const DEFAULT_MAINNET_SIGNALING = "wss://signal.indexerchain.io";

// 改为你的 Worker URL（注意改为 wss://）：
const DEFAULT_MAINNET_SIGNALING = "wss://indexerchain-signaling.your-subdomain.workers.dev";
```

3. **重新构建**：
```bash
npm run build
```

4. **测试连接**：
   - 打开浏览器访问应用
   - 勾选 "Mainnet Mode"
   - 点击 "Connect"
   - 应该显示 "Connected" ✅

---

## 🎉 完成！

现在你的信令服务器已经部署完成，可以支持全球用户连接了！

---

## 需要帮助？

### 如果登录失败

1. 确保有 Cloudflare 账户（免费注册）
2. 确保浏览器允许弹出窗口
3. 手动访问：https://dash.cloudflare.com/

### 如果部署失败

查看错误信息：
- **"Account ID not found"** → 需要在 Cloudflare Dashboard 中启用 Workers（免费）
- **"Authentication required"** → 重新运行 `wrangler login`
- **其他错误** → 查看 `wrangler tail` 日志

### 查看部署状态

```bash
cd workers
wrangler tail  # 查看实时日志
```

### 更新 Worker

修改代码后，直接重新运行 `wrangler deploy` 即可更新。

---

## 📝 下一步

部署完成后，你可以：

1. ✅ **测试连接**：在浏览器中测试 P2P 连接
2. ✅ **配置自定义域名**（可选）：使用自己的域名
3. ✅ **监控使用情况**：在 Cloudflare Dashboard 查看指标

更多信息请查看：
- `workers/README.md` - 完整文档
- `workers/DEPLOY_INSTRUCTIONS.md` - 详细部署说明
- `DEPLOY_SIGNALING.md` - 部署方案对比

