# Eggfans Seedance

提供 `eggfans-seedance-video` 与 `eggfans-volc-video` 两个原生任务协议，默认 Base URL 均为 `https://api.eggfans.com`。创建和轮询分别走 `/api/v3/contents/generations/tasks` 与 `/volc/v1/contents/generations/tasks`。

正文为 `model`、`content[]`、`ratio`、`resolution`、`duration`、`generate_audio`、`watermark`。文本为 `{type:"text",text:...}`，图片/视频/音频保留 `image_url`/`video_url`/`audio_url` 对象及 `role`。私域参考由宿主先上传并等待 Active，插件提交 `asset://AssetId`。首尾帧角色和同类素材顺序保持原样。

私域素材的路由模型固定使用文档支持的 Seedance 2.0，与生成模型分离。创建资产使用 `GroupId`、`URL`、`AssetType`、`Name`，获取 `Result.Id` 后查询审核状态。临时 CDN URL 不作为资产 URI。

任务创建支持裸 `id` 及 `data.task_id`；成功轮询读取 `content.video_url`，轮询继续使用原创建任务 ID。列表和私域管理通过本地 Eggfans API 执行，不在插件中保存 Key 或媒体。
