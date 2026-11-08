# 憨包运行组件

本目录保存用户提供的接入包运行组件与原始参数合同。BeefTV 直接调用 CLI，不需要 Python HTTP bridge。

- `doubao.exe` SHA-256：`1e548f69030af8790d20a0fcd42ec2207a3e35b15ecb4c70021f4e24aad72866`。
- 原接入包 `文件校验清单.json` 中全部 49 项已核对；原清单路径对应原包，运行组件在本目录平铺。
- `capabilities.json`、`参数清单.json`、`网页协议参数.json` 保持原文件内容。
- Windows 运行时需要 Edge 或 Chrome。账号、浏览器资料和加密的飞狐配置存放当前工作区的 `hanbao` 子目录，不随程序分发。
- 不支持 macOS/Linux，不自动迁移其他软件中的账号；密钥、短信、浏览器 profile 不得复制进本目录。

调用实现见 `backend/internal/provider/hanbao`；产品说明见 `docs/content/docs/backend/hanbao.mdx`。
