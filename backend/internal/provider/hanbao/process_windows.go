package hanbao

import (
	"os/exec"
	"syscall"
)

func hideProcessWindow(command *exec.Cmd) { command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true} }
