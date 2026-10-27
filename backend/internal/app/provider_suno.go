package app

import (
"context"
"infinite-canvas/backend/internal/generation"
)

var sunoMusicVersions = generation.SunoMusicVersions
type sunoTaskState = generation.SunoTaskState
func isSunoMusicModel(model string) bool { return generation.IsSunoMusicModel(model) }
func sunoMusicBody(input canvasGenerationInput) (map[string]interface{}, error) { return generation.SunoMusicBody(input) }
func sunoJSON(ctx context.Context, config providerConfig, method string, path string, body interface{}, target interface{}) error { return generation.SunoJSON(ctx, config, method, path, body, target) }
func sunoDecodedValue(value interface{}, depth int) (interface{}, error) { return generation.SunoDecodedValue(value, depth) }
func parseSunoState(raw []byte) (sunoTaskState, error) { return generation.ParseSunoState(raw) }
func runSunoAudioTaskWithPolicy(ctx context.Context, input canvasGenerationInput, policy videoPollPolicy) (map[string]interface{}, error) { return generation.RunSunoAudioTaskWithPolicy(ctx, input, policy) }
