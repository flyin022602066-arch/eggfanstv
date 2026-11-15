package doubaobrowser

import (
	"os/exec"
	"syscall"
)

func hideWorkerWindow(cmd *exec.Cmd) { cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true} }
