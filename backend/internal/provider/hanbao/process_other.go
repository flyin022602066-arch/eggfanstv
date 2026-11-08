//go:build !windows

package hanbao

import "os/exec"

func hideProcessWindow(command *exec.Cmd) {}
