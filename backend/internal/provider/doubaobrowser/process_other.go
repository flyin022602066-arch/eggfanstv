//go:build !windows

package doubaobrowser

import "os/exec"

func hideWorkerWindow(cmd *exec.Cmd) {}
