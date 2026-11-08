package protocol

func hanbaoAdapter() Adapter {
	info := metadata("hanbao-video", "憨包本地视频", "憨包", CapabilityVideo, "本地 CLI", "本地 CLI 查询", "application/json")
	info.Execution = "host"
	info.Installable = false
	info.Description = "Windows 浏览器账号登录；文生视频和最多 9 张参考图，4～30 秒。"
	return builtinAdapter{info: info}
}
