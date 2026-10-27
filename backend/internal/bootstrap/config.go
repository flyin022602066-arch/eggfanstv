package bootstrap

import (
	"path/filepath"
	"time"

	"github.com/gin-gonic/gin"
)

type Profile string

const (
	ProfileServer  Profile = "server"
	ProfileDesktop Profile = "desktop"
)

type Config struct {
	Profile                 Profile
	DataDir                 string
	GeneratedVideoOutputDir string
	DatabaseDriver          string
	DatabaseURL             string
	ListenAddr              string
	LaunchToken             string
	AutoMigrate             bool
	ShutdownTimeout         time.Duration
	RouterMiddleware        []gin.HandlerFunc
}

func (c Config) withDefaults() Config {
	if c.Profile == "" {
		c.Profile = ProfileServer
	}
	if c.DatabaseDriver == "" {
		c.DatabaseDriver = "sqlite"
	}
	if c.ListenAddr == "" {
		if c.Profile == ProfileDesktop {
			c.ListenAddr = "127.0.0.1:0"
		} else {
			c.ListenAddr = ":8080"
		}
	}
	if c.ShutdownTimeout <= 0 {
		c.ShutdownTimeout = 10 * time.Minute
	}
	if c.GeneratedVideoOutputDir == "" && c.DataDir != "" {
		root := filepath.Clean(c.DataDir)
		if filepath.Base(filepath.Dir(root)) == ".local" {
			root = filepath.Dir(filepath.Dir(root))
		}
		c.GeneratedVideoOutputDir = filepath.Join(root, "output", "videos")
	}
	return c
}
