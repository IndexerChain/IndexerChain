# 如何种子 Bootstrap Blocks 到信号服务器

## 方法 1: 从已同步的节点导出（推荐）

如果你有一个已经同步的节点（比如 `https://indexerchain.com/`），可以在浏览器控制台运行以下脚本：

```javascript
// 在已同步的节点上运行（比如 https://indexerchain.com/）
// 导出 height 1-256 的区块
(async function() {
  const storage = window.chainContext?.storage;
  if (!storage) {
    console.error('Chain context not found. Make sure the page is fully loaded.');
    return;
  }
  
  const allBlocks = storage.getAllBlocks();
  const bootstrapBlocks = allBlocks
    .filter(b => b.header.height >= 1 && b.header.height <= 256)
    .sort((a, b) => a.header.height - b.header.height);
  
  console.log(`Found ${bootstrapBlocks.length} blocks (height 1-256)`);
  
  // 导出为 JSON
  const json = JSON.stringify({ blocks: bootstrapBlocks }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bootstrap-blocks-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  
  console.log('Bootstrap blocks exported! Now use the admin endpoint to seed them.');
})();
```

然后使用 curl 导入：

```bash
curl -X POST "https://signal.indexerchain.com/admin/seed-bootstrap-blocks" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SEED0101" \
  --data-binary @bootstrap-blocks-*.json
```

## 方法 2: 自动从网络节点获取（未来实现）

未来可以实现一个功能，让信号服务器自动从网络中的节点请求初始区块。

## 验证

导入后，可以通过以下方式验证：

```bash
curl "https://signal.indexerchain.com/bootstrap-blocks?from=1&to=10"
```

应该返回 JSON 格式的区块数据。

