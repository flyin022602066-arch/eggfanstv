package app

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptrace"
	"sync"

	"infinite-canvas/backend/internal/generation"
)

type providerTransportError struct {
	Cause            error
	Kind             string
	Capability       string
	Phase            string
	MayHaveSubmitted bool
}

func (err providerTransportError) Error() string {
	return err.failure().UserMessage()
}

func (err providerTransportError) Unwrap() error {
	return err.Cause
}

func (err providerTransportError) TransportKind() string {
	return err.Kind
}

func (err providerTransportError) failure() generation.Failure {
	if errors.Is(err.Cause, context.Canceled) {
		return generation.ClassifyError(err.Cause)
	}
	phase := map[string]string{"dns": "域名解析", "connect": "TCP 连接", "tls": "TLS 握手", "send": "发送请求", "response": "等待响应"}[err.Phase]
	if phase == "" {
		phase = "连接接口"
	}
	failureKind := "失败"
	category := generation.CategoryNetwork
	var timeout net.Error
	if errors.Is(err.Cause, context.DeadlineExceeded) || errors.As(err.Cause, &timeout) && timeout.Timeout() {
		failureKind = "超时"
		category = generation.CategoryTimeout
	}
	if err.Kind == "create" {
		label := "模型"
		if err.Capability == "video" {
			label = "视频"
		} else if err.Capability == "image" {
			label = "图片"
		}
		if !err.MayHaveSubmitted {
			return generation.Failure{Category: generation.CategoryNetwork, Reason: label + "接口连接" + failureKind + "（" + phase + "），请求尚未发送", Action: "请检查渠道地址、网络或代理后重试"}
		}
		return generation.Failure{Category: generation.CategorySubmissionUncertain, Uncertain: true, Reason: label + "提交未确认（" + phase + failureKind + "），尚未取得上游任务 ID", Action: "请先核对渠道后台记录，再决定是否重新提交"}
	}
	return generation.Failure{Category: category, Reason: "上游请求" + failureKind + "（" + phase + "）", Action: "请稍后查询原任务，不要立即重新提交"}
}

type providerRequestTrace struct {
	mutex            sync.Mutex
	kind             string
	capability       string
	phase            string
	mayHaveSubmitted bool
}

func traceProviderRequest(req *http.Request) (*http.Request, *providerRequestTrace) {
	metadata, ok := req.Context().Value(providerAnalyticsKey{}).(providerAnalyticsContext)
	if !ok || metadata.Capability != "video" {
		return req, nil
	}
	trace := &providerRequestTrace{kind: providerRequestKind(req.Method, req.URL.Path), phase: "connect"}
	trace.capability = metadata.Capability
	if metadata.RequestKind != "" {
		trace.kind = metadata.RequestKind
	}
	clientTrace := &httptrace.ClientTrace{
		DNSStart:          func(httptrace.DNSStartInfo) { trace.setPhase("dns", false) },
		ConnectStart:      func(string, string) { trace.setPhase("connect", false) },
		TLSHandshakeStart: func() { trace.setPhase("tls", false) },
		GotConn:           func(httptrace.GotConnInfo) { trace.setPhase("send", true) },
		WroteRequest: func(info httptrace.WroteRequestInfo) {
			if info.Err == nil {
				trace.setPhase("response", true)
			}
		},
	}
	return req.WithContext(httptrace.WithClientTrace(req.Context(), clientTrace)), trace
}

func (trace *providerRequestTrace) setPhase(phase string, mayHaveSubmitted bool) {
	trace.mutex.Lock()
	defer trace.mutex.Unlock()
	trace.phase = phase
	trace.mayHaveSubmitted = trace.mayHaveSubmitted || mayHaveSubmitted
}

func (trace *providerRequestTrace) wrap(err error) error {
	if trace == nil || err == nil || errors.Is(err, context.Canceled) {
		return err
	}
	trace.mutex.Lock()
	defer trace.mutex.Unlock()
	return providerTransportError{Cause: err, Kind: trace.kind, Capability: trace.capability, Phase: trace.phase, MayHaveSubmitted: trace.mayHaveSubmitted}
}
