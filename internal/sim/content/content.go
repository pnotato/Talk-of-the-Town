// Package content holds the fictional company and its announcements,
// embedded as JSON. Everything here is SIMULATED. Standard library only.
package content

import (
	_ "embed"
	"encoding/json"
)

//go:embed announcements.json
var announcementsJSON []byte

// Announcements is the full content set for one run.
type Announcements struct {
	Label   string   `json:"label"` // always "SIMULATED"; the UI must show it
	Company Company  `json:"company"`
	Moments []Moment `json:"moments"`
}

// Company is the fictional company the player speaks for.
type Company struct {
	Name    string `json:"name"`
	Tagline string `json:"tagline"`
}

// Moment is one announcement point; the player picks one Option.
type Moment struct {
	ID      string   `json:"id"`
	Round   int      `json:"round"`
	Feature string   `json:"feature"`
	Options []Option `json:"options"`
}

// Option is one way to announce a feature. Claimed and Delivered use the
// 0-100 scale in docs/MODEL.md#claim-scale.
type Option struct {
	ID        string `json:"id"`
	Headline  string `json:"headline"`
	Text      string `json:"text"`
	Claimed   int    `json:"claimed"`
	Delivered int    `json:"delivered"`
}

// LoadAnnouncements parses the embedded content.
func LoadAnnouncements() (Announcements, error) {
	var a Announcements
	err := json.Unmarshal(announcementsJSON, &a)
	return a, err
}
