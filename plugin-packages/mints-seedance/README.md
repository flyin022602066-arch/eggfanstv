# Mints Seedance 自动资产绑定

独立视频渠道 `mints-seedance-video`。Base URL、API Key 和模型 ID 在模型配置中修改。

点击生成后，宿主从本地原始素材取得有效的 Uguu HTTPS 链接，再调用平台资产接口，等状态变成 Active 后用 `asset://` 提交视频。图片、视频、音频保持原生 `content[]` 对象及角色。URI 按用户、渠道、地址、Key 和素材组隔离缓存，原始资源不会被 URI 替换。

文档来源：[素材和视频说明](https://tc1rz6i54l.apifox.cn/9242591m0)、[原生视频协议](https://tc1rz6i54l.apifox.cn/9371486m0)。
