package app

import (
	"os/exec"
	"syscall"
)

func hideTranscriptionWindow(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
