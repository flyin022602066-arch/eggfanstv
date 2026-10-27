//go:build !windows

package app

import "os/exec"

func hideTranscriptionWindow(command *exec.Cmd) {}
