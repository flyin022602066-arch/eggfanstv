package app

import (
"infinite-canvas/backend/internal/generation"
"infinite-canvas/backend/internal/protocol"
)

const jiasuVideoTaskTimeout = generation.JiasuVideoTaskTimeout
const jiasuVideoPollInterval = generation.JiasuVideoPollInterval
func jiasuModelSupportsServerFace(name string) bool { return generation.JiasuModelSupportsServerFace(name) }
func applyJiasuReferenceNames(request *protocol.GenerationRequest) { generation.ApplyJiasuReferenceNames(request) }
func validateJiasuVideoInput(input canvasGenerationInput) error { return generation.ValidateJiasuVideoInput(input) }
