#!/bin/bash

# 验证 signal.indexerchain.com 域名配置脚本

echo "🔍 验证 signal.indexerchain.com 域名配置"
echo ""

DOMAIN="signal.indexerchain.com"
WORKER_TARGET="indexerchain-signaling.seven-psong.workers.dev"

# 1. 检查 DNS 解析
echo "1️⃣ 检查 DNS 解析..."
if command -v nslookup &> /dev/null; then
    nslookup $DOMAIN 2>&1 | grep -A 5 "Name:"
elif command -v dig &> /dev/null; then
    dig $DOMAIN +short
else
    echo "   ⚠️  未找到 nslookup 或 dig 命令"
fi
echo ""

# 2. 检查 HTTPS 连接
echo "2️⃣ 检查 HTTPS 连接..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 https://$DOMAIN 2>&1)
if [ "$HTTP_CODE" = "426" ] || [ "$HTTP_CODE" = "101" ] || [ "$HTTP_CODE" = "200" ]; then
    echo "   ✅ HTTPS 连接成功 (HTTP $HTTP_CODE)"
    echo "   💡 426/101 表示 WebSocket 升级请求被正确处理"
else
    echo "   ⚠️  HTTPS 连接返回: HTTP $HTTP_CODE"
    echo "   💡 如果返回 000，可能是 DNS 未配置或未传播"
fi
echo ""

# 3. 检查 SSL 证书
echo "3️⃣ 检查 SSL 证书..."
if command -v openssl &> /dev/null; then
    echo | openssl s_client -connect $DOMAIN:443 -servername $DOMAIN 2>&1 | grep -E "(subject=|issuer=|Verify return code)" | head -3
else
    echo "   ⚠️  未找到 openssl 命令，跳过 SSL 检查"
fi
echo ""

# 4. 测试 WebSocket 连接（简单测试）
echo "4️⃣ 测试 WebSocket 升级请求..."
WS_RESPONSE=$(curl -s -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  --max-time 5 \
  https://$DOMAIN 2>&1 | head -5)

if echo "$WS_RESPONSE" | grep -q "101\|426\|Upgrade"; then
    echo "   ✅ WebSocket 升级请求被正确处理"
    echo "$WS_RESPONSE" | head -3
else
    echo "   ⚠️  WebSocket 测试未通过"
    echo "$WS_RESPONSE"
fi
echo ""

# 5. 检查 Worker 路由
echo "5️⃣ 检查 Worker 路由配置..."
if [ -f "wrangler.toml" ]; then
    if grep -q "signal.indexerchain.com" wrangler.toml; then
        echo "   ✅ wrangler.toml 中已配置路由"
        grep "signal.indexerchain.com" wrangler.toml
    else
        echo "   ⚠️  wrangler.toml 中未找到路由配置"
    fi
else
    echo "   ⚠️  未找到 wrangler.toml"
fi
echo ""

# 总结
echo "📋 配置检查总结："
echo "   - DNS 记录需要在 Cloudflare Dashboard 中配置"
echo "   - CNAME: signal → $WORKER_TARGET"
echo "   - 代理状态: 已代理（橙色云）"
echo ""
echo "💡 如果所有检查都通过，域名配置成功！"
echo "💡 如果失败，请检查 Cloudflare Dashboard 中的 DNS 配置"

