package characterkind

import "testing"

func TestGroupClassification(t *testing.T) {
	for _, item := range []struct {
		name       string
		definition map[string]any
		want       bool
	}{
		{"买凉粉的工人与食客群像", nil, true},
		{"围观群众", nil, true},
		{"其余六位师傅", nil, true},
		{"工人群演", nil, true},
		{"食客", map[string]any{"role": "【群体演员】店内多位食客"}, true},
		{"三师傅", map[string]any{"role": "其余六位师傅中的一位，独立出场"}, false},
		{"陈尧", map[string]any{"role": "与工人群像交谈"}, false},
		{"群众演员小王", nil, false},
		{"工人群像", map[string]any{"characterType": "individual"}, false},
		{"食客", map[string]any{"characterType": "group"}, true},
	} {
		if got := IsGroup(item.name, item.definition); got != item.want {
			t.Errorf("%s: got %v, want %v", item.name, got, item.want)
		}
	}
}
