package workspace

func preserveChannelDeletions(incoming map[string]any, previous ProviderStateDocument) {
	channels, supplied := incoming["channels"].([]any)
	if !supplied {
		return
	}
	present := map[string]bool{}
	for _, raw := range channels {
		if channel, ok := raw.(map[string]any); ok {
			id, _ := channel["id"].(string)
			present[id] = true
		}
	}
	deleted := append(channelModelIDs(previous.Config["deletedChannelIds"]), channelModelIDs(incoming["deletedChannelIds"])...)
	oldChannels, _ := previous.Config["channels"].([]any)
	for _, raw := range oldChannels {
		channel, ok := raw.(map[string]any)
		if !ok || channel["scope"] == "system" {
			continue
		}
		id, _ := channel["id"].(string)
		if id != "" && !present[id] {
			deleted = append(deleted, id)
		}
	}
	result := []string{}
	for _, id := range deleted {
		if id != "" && !present[id] && !containsString(result, id) {
			result = append(result, id)
		}
	}
	incoming["deletedChannelIds"] = result
}
