@echo off
REM IndexerChain Signaling Server 部署脚本 (Windows)
REM 
REM 使用方法：
REM   deploy.bat

echo.
echo 🚀 IndexerChain Signaling Server 部署脚本
echo.

REM 检查 wrangler 是否安装
where wrangler >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Wrangler CLI 未安装
    echo    请运行: npm install -g wrangler
    pause
    exit /b 1
)

REM 检查是否已登录
echo 📋 检查 Cloudflare 登录状态...
wrangler whoami >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ⚠️  未登录 Cloudflare
    echo    正在打开登录页面...
    wrangler login
)

echo ✅ 已登录 Cloudflare
echo.

REM 显示当前配置
echo 📝 当前配置：
echo    Worker 名称: indexerchain-signaling
echo    入口文件: src/index.js
echo.

REM 确认部署
set /p confirm="是否继续部署？(y/n) "
if /i not "%confirm%"=="y" (
    echo ❌ 部署已取消
    pause
    exit /b 1
)

REM 部署
echo.
echo 🚀 开始部署...
wrangler deploy

echo.
echo ✅ 部署完成！
echo.
echo 📊 下一步：
echo    1. 查看 Worker URL（上方输出）
echo    2. 更新 src/ui/App.tsx 中的 DEFAULT_MAINNET_SIGNALING
echo    3. 测试连接
echo.
echo 💡 查看日志: wrangler tail
echo 💡 查看状态: 访问 Cloudflare Dashboard
echo.
pause

