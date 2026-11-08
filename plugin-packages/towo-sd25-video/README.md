# Towo SD2.5 Video

该目录是 BeefTV 的 Towo SD2.5 独立视频协议插件。它只负责 Towo 的请求字段映射，不复用佳速、NewAPI 或 Seedance 兼容渠道的请求体。

- 默认地址：`https://towoapi.com`
- 创建：`POST /v1/videos`
- 查询：`GET /v1/videos/{id}`
- 下载：`GET /v1/videos/{id}/content`
- 鉴权：`Authorization: Bearer <API Key>`
- 模型：默认 `seedance-2.5`
- 参考图片最多 30 张，参考视频最多 10 段，参考音频最多 10 段

Towo 的请求使用 `seconds`、`aspect_ratio`、`resolution`、`enable_audio`、`reference_images`、`reference_videos` 和 `reference_audios`。首尾帧使用独立的 `first_frame` / `last_frame` 对象。图片、视频和音频在提交前由宿主准备为公网 URL；完成后优先使用认证的 `/content` 端点下载并保存结果。

完整字段映射见 [docs/interface.md](docs/interface.md)。
