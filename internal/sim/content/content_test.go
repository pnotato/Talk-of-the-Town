package content

import "testing"

func TestLoadAnnouncementsShape(t *testing.T) {
	a, err := LoadAnnouncements()
	if err != nil {
		t.Fatal(err)
	}
	if a.Label != "SIMULATED" {
		t.Errorf("label = %q, want SIMULATED", a.Label)
	}
	if a.Company.Name == "" || a.Company.Tagline == "" {
		t.Error("company name and tagline required")
	}
	wantRounds := []int{0, 10, 20, 30, 40}
	if len(a.Moments) != len(wantRounds) {
		t.Fatalf("got %d moments, want %d", len(a.Moments), len(wantRounds))
	}
	ids := map[string]bool{}
	for i, m := range a.Moments {
		if m.Round != wantRounds[i] {
			t.Errorf("moment %d round = %d, want %d", i, m.Round, wantRounds[i])
		}
		if ids[m.ID] || m.ID == "" {
			t.Errorf("moment id %q empty or duplicate", m.ID)
		}
		ids[m.ID] = true
		if n := len(m.Options); n < 3 || n > 4 {
			t.Errorf("moment %s has %d options, want 3-4", m.ID, n)
		}
		honest, bold := false, false
		for _, o := range m.Options {
			if ids[o.ID] || o.ID == "" {
				t.Errorf("option id %q empty or duplicate", o.ID)
			}
			ids[o.ID] = true
			if o.Headline == "" || o.Text == "" {
				t.Errorf("option %s missing headline or text", o.ID)
			}
			if o.Claimed < 0 || o.Claimed > 100 || o.Delivered < 0 || o.Delivered > 85 {
				t.Errorf("option %s claimed %d delivered %d out of range", o.ID, o.Claimed, o.Delivered)
			}
			gap := o.Claimed - o.Delivered
			if gap >= -5 && gap <= 5 {
				honest = true
			}
			if gap >= 20 {
				bold = true
			}
		}
		if !honest || !bold {
			t.Errorf("moment %s: honest=%v bold=%v, want both", m.ID, honest, bold)
		}
	}
}
