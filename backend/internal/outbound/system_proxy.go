package outbound

import (
	"errors"
	"net"
	"net/url"
	"path"
	"strings"
	"sync/atomic"
)

type systemProxyConfig struct {
	Enabled bool
	Server  string
	Bypass  string
}

var desktopSystemProxyEnabled atomic.Bool
var readSystemProxyConfig = func() systemProxyConfig { return systemProxyConfig{} }

func EnableDesktopSystemProxy() {
	desktopSystemProxyEnabled.Store(true)
}

func desktopProxyConfig() systemProxyConfig {
	if !desktopSystemProxyEnabled.Load() {
		return systemProxyConfig{}
	}
	return readSystemProxyConfig()
}

func systemProxyURL(server, scheme string) (*url.URL, error) {
	address := strings.TrimSpace(server)
	if strings.Contains(address, "=") {
		address = ""
		for _, entry := range strings.Split(server, ";") {
			protocol, value, found := strings.Cut(entry, "=")
			if found && strings.EqualFold(strings.TrimSpace(protocol), scheme) {
				address = strings.TrimSpace(value)
				break
			}
		}
	}
	if address == "" {
		return nil, nil
	}
	if !strings.Contains(address, "://") {
		address = "http://" + address
	}
	parsed, err := url.Parse(address)
	if err != nil || parsed.Hostname() == "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Path != "" && parsed.Path != "/" {
		return nil, errors.New("Windows 系统代理地址无效，请检查系统代理设置")
	}
	switch parsed.Scheme {
	case "http", "https", "socks5", "socks5h":
		return parsed, nil
	default:
		return nil, errors.New("Windows 系统代理协议不受支持，请检查系统代理设置")
	}
}

func systemProxyBypassed(target *url.URL, bypass string) bool {
	host := normalizeOutboundHost(target.Hostname())
	for _, entry := range strings.Split(strings.ToLower(bypass), ";") {
		pattern := strings.TrimSpace(entry)
		if pattern == "" {
			continue
		}
		if pattern == "<local>" {
			if !strings.Contains(host, ".") && net.ParseIP(host) == nil {
				return true
			}
			continue
		}
		for _, value := range []string{host, strings.ToLower(target.Host)} {
			if matched, _ := path.Match(pattern, value); matched {
				return true
			}
		}
	}
	return false
}
