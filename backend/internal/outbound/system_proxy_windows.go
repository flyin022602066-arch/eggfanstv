package outbound

import "golang.org/x/sys/windows/registry"

func init() {
	readSystemProxyConfig = windowsSystemProxyConfig
}

func windowsSystemProxyConfig() systemProxyConfig {
	key, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Internet Settings`, registry.QUERY_VALUE)
	if err != nil {
		return systemProxyConfig{}
	}
	defer key.Close()
	enabled, _, _ := key.GetIntegerValue("ProxyEnable")
	server, _, _ := key.GetStringValue("ProxyServer")
	bypass, _, _ := key.GetStringValue("ProxyOverride")
	return systemProxyConfig{Enabled: enabled != 0, Server: server, Bypass: bypass}
}
