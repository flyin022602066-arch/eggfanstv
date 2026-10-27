package app

import "infinite-canvas/backend/internal/generation"

func isGeminiNanoBananaModel(name string) bool { return generation.IsGeminiNanoBananaModel(name) }
func geminiNanoBananaThinkingConfig(config providerConfig) map[string]string { return generation.GeminiNanoBananaThinkingConfig(config) }
func isEggfansNanoBananaConfig(config providerConfig) bool { return generation.IsEggfansNanoBananaConfig(config) }
