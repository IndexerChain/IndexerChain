#!/bin/bash

# IndexerChain Signaling Server 部署脚本
# 
# 使用方法：
#   ./deploy.sh
# 
# 或指定环境：
#   ./deploy.sh production

set -e

echo "🚀 IndexerChain Signaling Server 部署脚本"
echo ""

# 检查 wrangler 是否安装
if ! command -v wrangler &> /dev/null; then
    echo "❌ Wrangler CLI 未安装"
    echo "   请运行: npm install -g wrangler"
    exit 1
fi

# 检查是否已登录
echo "📋 检查 Cloudflare 登录状态..."
if ! wrangler whoami &> /dev/null; then
    echo "⚠️  未登录 Cloudflare"
    echo "   正在打开登录页面..."
    wrangler login
fi

echo "✅ 已登录 Cloudflare"
echo ""

# 显示当前配置
echo "📝 当前配置："
echo "   Worker 名称: indexerchain-signaling"
echo "   入口文件: src/index.js"
echo ""

# 确认部署
read -p "是否继续部署？(y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ 部署已取消"
    exit 1
fi

# 部署
echo ""
echo "🚀 开始部署..."
wrangler deploy

echo ""
echo "✅ 部署完成！"
echo ""
echo "📊 下一步："
echo "   1. 查看 Worker URL（上方输出）"
echo "   2. 更新 src/ui/App.tsx 中的 DEFAULT_MAINNET_SIGNALING"
echo "   3. 测试连接"
echo ""
echo "💡 查看日志: wrangler tail"
echo "💡 查看状态: 访问 Cloudflare Dashboard"

