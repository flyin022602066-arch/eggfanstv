package outbound

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func useDesktopProxyFixture(t *testing.T, config *systemProxyConfig) {
	t.Helper()
	for _, name := range []string{"HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "NO_PROXY", "no_proxy"} {
		t.Setenv(name, "")
	}
	previousReader := readSystemProxyConfig
	previousEnabled := desktopSystemProxyEnabled.Load()
	readSystemProxyConfig = func() systemProxyConfig { return *config }
	EnableDesktopSystemProxy()
	t.Cleanup(func() {
		readSystemProxyConfig = previousReader
		desktopSystemProxyEnabled.Store(previousEnabled)
	})
}

func TestDesktopSystemProxyFollowsCurrentSettings(t *testing.T) {
	config := systemProxyConfig{Enabled: true, Server: "127.0.0.1:11074"}
	useDesktopProxyFixture(t, &config)
	request, _ := http.NewRequest(http.MethodPost, "https://video.example.com/v1/videos", nil)
	proxy, err := outboundProxyFromEnvironment(request)
	if err != nil || proxy == nil || proxy.String() != "http://127.0.0.1:11074" {
		t.Fatalf("proxy = %v, error = %v", proxy, err)
	}
	config.Server = "127.0.0.1:11075"
	proxy, err = outboundProxyFromEnvironment(request)
	if err != nil || proxy == nil || proxy.Port() != "11075" {
		t.Fatalf("updated proxy = %v, error = %v", proxy, err)
	}
	config.Enabled = false
	proxy, err = outboundProxyFromEnvironment(request)
	if err != nil || proxy != nil {
		t.Fatalf("disabled proxy = %v, error = %v", proxy, err)
	}
}

func TestDesktopSystemProxyHonorsOverridesAndProtocol(t *testing.T) {
	config := systemProxyConfig{Enabled: true, Server: "http=127.0.0.1:11074;https=127.0.0.1:11075", Bypass: "<local>;*.internal.example;10.*"}
	useDesktopProxyFixture(t, &config)
	t.Setenv("NO_PROXY", "env.example.com")
	for _, test := range []struct {
		url  string
		port string
	}{
		{"https://video.example.com/v1/videos", "11075"},
		{"http://video.example.com/", "11074"},
		{"https://localhost/", ""},
		{"https://127.0.0.1/", ""},
		{"https://printer/", ""},
		{"https://asset.internal.example/", ""},
		{"https://10.1.2.3/", ""},
		{"https://env.example.com/", ""},
	} {
		request, _ := http.NewRequest(http.MethodGet, test.url, nil)
		proxy, err := outboundProxyFromEnvironment(request)
		if err != nil || test.port == "" && proxy != nil || test.port != "" && (proxy == nil || proxy.Port() != test.port) {
			t.Fatalf("%s: proxy = %v, error = %v", test.url, proxy, err)
		}
	}
}

func TestDesktopSystemProxyPreservesExplicitEnvironmentAndServerIsolation(t *testing.T) {
	config := systemProxyConfig{Enabled: true, Server: "127.0.0.1:11074"}
	useDesktopProxyFixture(t, &config)
	request, _ := http.NewRequest(http.MethodGet, "https://video.example.com/", nil)
	t.Setenv("HTTPS_PROXY", "http://127.0.0.1:11076")
	proxy, err := outboundProxyFromEnvironment(request)
	if err != nil || proxy == nil || proxy.Port() != "11076" {
		t.Fatalf("explicit environment proxy = %v, error = %v", proxy, err)
	}
	t.Setenv("NO_PROXY", "video.example.com")
	proxy, err = outboundProxyFromEnvironment(request)
	if err != nil || proxy != nil {
		t.Fatalf("explicit environment bypass = %v, error = %v", proxy, err)
	}
	t.Setenv("HTTPS_PROXY", "")
	t.Setenv("NO_PROXY", "")
	desktopSystemProxyEnabled.Store(false)
	proxy, err = outboundProxyFromEnvironment(request)
	if err != nil || proxy != nil || configuredProxyHost("127.0.0.1") {
		t.Fatalf("server mode unexpectedly uses desktop proxy: %v, %v", proxy, err)
	}
}

func TestDesktopSystemProxyTransportReachesConfiguredLocalProxy(t *testing.T) {
	proxyServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Host != "video.example.com" || request.Method != http.MethodGet {
			t.Errorf("unexpected proxy request: %s %s", request.Method, request.URL)
		}
		_, _ = writer.Write([]byte("proxy reached"))
	}))
	defer proxyServer.Close()
	config := systemProxyConfig{Enabled: true, Server: proxyServer.URL}
	useDesktopProxyFixture(t, &config)
	transport := newOutboundTransport(func(context.Context, string) ([]net.IP, error) {
		return nil, errors.New("direct connection must not be used")
	})
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: time.Second}
	response, err := client.Get("http://video.example.com/health")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil || string(body) != "proxy reached" {
		t.Fatalf("body = %s, error = %v", body, err)
	}
	if configuredProxyHost("127.0.0.2") {
		t.Fatal("unrelated private host was trusted as system proxy")
	}
	if _, err := ValidateOutboundURL("http://127.0.0.2/private"); err == nil {
		t.Fatal("system proxy bypassed destination SSRF validation")
	}
}

func TestDesktopSystemProxyTunnelsSingleVideoSubmission(t *testing.T) {
	var submissions atomic.Int64
	upstream := httptest.NewTLSServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		submissions.Add(1)
		body, _ := io.ReadAll(request.Body)
		if request.Method != http.MethodPost || request.URL.Path != "/v1/videos" || string(body) != `{"model":"sd-2.5-D"}` {
			t.Errorf("unexpected submission: %s %s %s", request.Method, request.URL.Path, body)
		}
		_, _ = writer.Write([]byte(`{"id":"local-task"}`))
	}))
	defer upstream.Close()
	proxyServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodConnect || request.Host != "example.com:443" {
			t.Errorf("unexpected tunnel: %s %s", request.Method, request.Host)
			writer.WriteHeader(http.StatusBadRequest)
			return
		}
		remote, err := net.Dial("tcp", upstream.Listener.Addr().String())
		if err != nil {
			t.Error(err)
			writer.WriteHeader(http.StatusBadGateway)
			return
		}
		defer remote.Close()
		connection, buffered, err := writer.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		defer connection.Close()
		_, _ = buffered.WriteString("HTTP/1.1 200 Connection Established\r\n\r\n")
		_ = buffered.Flush()
		go func() { _, _ = io.Copy(remote, buffered) }()
		_, _ = io.Copy(connection, remote)
	}))
	defer proxyServer.Close()
	config := systemProxyConfig{Enabled: true, Server: proxyServer.URL}
	useDesktopProxyFixture(t, &config)
	transport := newOutboundTransport(func(context.Context, string) ([]net.IP, error) {
		return nil, errors.New("direct connection must not be used")
	})
	defer transport.CloseIdleConnections()
	roots := x509.NewCertPool()
	roots.AddCert(upstream.Certificate())
	transport.TLSClientConfig = &tls.Config{RootCAs: roots}
	client := &http.Client{Transport: transport, Timeout: 2 * time.Second}
	response, err := client.Post("https://example.com/v1/videos", "application/json", strings.NewReader(`{"model":"sd-2.5-D"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil || string(body) != `{"id":"local-task"}` || submissions.Load() != 1 {
		t.Fatalf("response = %s, submissions = %d, error = %v", body, submissions.Load(), err)
	}
}
