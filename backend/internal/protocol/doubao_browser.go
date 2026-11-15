package protocol

func doubaoBrowserAdapter() Adapter {
	info := metadata("doubao-browser-video", "豆包浏览器视频", "豆包浏览器", CapabilityVideo, "本地浏览器画布", "原任务画布查询", "application/json")
	info.Execution = "host"
	info.Installable = false
	info.Description = "eggfansTV 独立浏览器池；100 个环境、预留 2 个空闲，文字和最多 10 张图片参考。"
	return builtinAdapter{info: info}
}
