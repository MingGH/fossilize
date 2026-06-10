# Fossilize

基于 [OpenTimestamps](https://opentimestamps.org/) 协议的浏览器端文件存证工具。为任意文件生成可独立验证的存在性证明（.ots），证明锚定在 Bitcoin 区块链上。

<img width="1291" height="720" alt="image" src="https://github.com/user-attachments/assets/c248d7a5-f7e9-4e55-8017-5fb01a9f66d3" />


## 特性

- **本地计算** — 文件始终保留在浏览器内，仅将 SHA-256 摘要提交到 OpenTimestamps calendar
- **大文件友好** — 使用 Web Worker 分块计算哈希，不阻塞 UI
- **一键存证** — 自动生成并下载 .ots 证明文件
- **链上验证** — 通过 Blockstream API 查询 Bitcoin 区块，校验 merkle root 与 OP_RETURN
- **升级 pending 证明** — 对尚未上链的 .ots 文件调用 calendar 查询并合并升级

## 技术栈

- React 19 + TypeScript
- Vite
- [@noble/hashes](https://github.com/paulmillr/noble-hashes) — SHA-256 实现
- [javascript-opentimestamps](https://github.com/nicola/javascript-opentimestamps) — OTS 协议解析与序列化

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

## 工作原理

1. 用户在浏览器中选择文件
2. Web Worker 分块计算文件的 SHA-256 摘要
3. 摘要通过 CORS 代理提交到 OpenTimestamps calendar 服务器
4. calendar 返回时间戳证明，工具将其封装为 DetachedTimestampFile 并下载为 `.ots` 文件
5. 验证时，重新计算原文件摘要，解析 `.ots` 中的证明路径，通过 Blockstream API 确认链上记录

## 许可证

[MIT](./LICENSE)
