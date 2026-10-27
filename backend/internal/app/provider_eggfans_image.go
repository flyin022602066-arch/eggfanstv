package app

import "infinite-canvas/backend/internal/generation"

func isEggfansGPTImageConfig(config providerConfig) bool { return generation.IsEggfansGPTImageConfig(config) }
func eggfansImageRequestBody(config providerConfig, path string, body map[string]any) map[string]any { return generation.EggfansImageRequestBody(config, path, body) }
