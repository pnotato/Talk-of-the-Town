package sim

import (
	"context"
	"fmt"
	"reflect"
	"strings"
	"sync"
	"testing"
)

// fullRun plays seed 1 with the first option of every moment.
func fullRun(t *testing.T) RunLog {
	t.Helper()
	l, err := Run(1, firstChoices(t), StubBrain{})
	if err != nil {
		t.Fatal(err)
	}
	return l
}

func firstChoices(t *testing.T) []string {
	t.Helper()
	l, err := Run(1, nil, StubBrain{})
	if err != nil {
		t.Fatal(err)
	}
	var choices []string
	for l.Next != nil {
		choices = append(choices, l.Next.Options[0].ID)
		if l, err = Run(1, choices, StubBrain{}); err != nil {
			t.Fatal(err)
		}
	}
	return choices
}

type numbers struct {
	From   int
	To     []int
	Post   bool
	Scroll bool
	Claim  float64
	DP, DI []float64
}

func eventNumbers(l RunLog) [][]numbers {
	out := make([][]numbers, len(l.Rounds))
	for r, round := range l.Rounds {
		for _, e := range round.Events {
			out[r] = append(out[r], numbers{e.From, e.To, e.Post, e.Scroll, e.Claim, e.DP, e.DI})
		}
	}
	return out
}

func TestNarrateStubFillsEveryEvent(t *testing.T) {
	l := fullRun(t)
	before := eventNumbers(l)
	if err := Narrate(context.Background(), &l, StubVoice{}); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, eventNumbers(l)) {
		t.Fatal("Narrate changed a number")
	}
	talks, posts, scrolls := 0, 0, 0
	for r, round := range l.Rounds {
		for j, e := range round.Events {
			at := fmt.Sprintf("round %d event %d", r, j)
			if e.Thought == "" || e.Words == "" {
				t.Fatalf("%s: thought %q, words %q", at, e.Thought, e.Words)
			}
			switch {
			case e.Scroll:
				scrolls++
				if len(e.Replies) != 0 {
					t.Errorf("%s: a scroll has replies %q", at, e.Replies)
				}
			default:
				if e.Post {
					posts++
				} else {
					talks++
				}
				if len(e.Replies) != len(e.To) {
					t.Fatalf("%s: %d replies for %d hearers", at, len(e.Replies), len(e.To))
				}
				for _, reply := range e.Replies {
					if reply == "" {
						t.Fatalf("%s: empty reply", at)
					}
				}
			}
		}
	}
	if talks == 0 || posts == 0 || scrolls == 0 {
		t.Fatalf("want every kind of event, got %d talks, %d posts, %d scrolls", talks, posts, scrolls)
	}
}

func TestNarrateStubIsDeterministic(t *testing.T) {
	a, b := fullRun(t), fullRun(t)
	if err := Narrate(context.Background(), &a, StubVoice{}); err != nil {
		t.Fatal(err)
	}
	if err := Narrate(context.Background(), &b, StubVoice{}); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(a, b) {
		t.Fatal("two narrations of the same run differ")
	}
}

// recordingVoice gives every scene unique words and remembers what each scene was told, and
// whether the words it repeats had been written when it was asked.
type recordingVoice struct {
	mu     sync.Mutex
	scenes []Scene
	early  []bool          // per scene: its source words were already written
	words  map[string]bool // every line written so far
}

func (v *recordingVoice) Speak(_ context.Context, s Scene) Lines {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.scenes = append(v.scenes, s)
	v.early = append(v.early, v.words[s.Source.Words])
	w := fmt.Sprintf("words-%d", len(v.scenes))
	v.words[w] = true
	ln := Lines{Thought: "thought", Words: w, Hearers: make([]string, len(s.Hearers))}
	for k := range s.Hearers {
		ln.Hearers[k] = "reply"
	}
	return ln
}

// The telephone game: every retelling is given the exact words its teller last heard, which
// the voice wrote before it was asked, even when that was earlier in the same round.
func TestNarrateChainsWords(t *testing.T) {
	l := fullRun(t)
	v := &recordingVoice{words: map[string]bool{}}
	if err := Narrate(context.Background(), &l, v); err != nil {
		t.Fatal(err)
	}
	company, chained := 0, 0
	for i, s := range v.scenes {
		switch {
		case s.Source.Company:
			company++
			if !strings.Contains(s.Source.Words, s.Story.Headline) {
				t.Fatalf("round %d: company source %q lacks the headline", s.Round, s.Source.Words)
			}
		case !v.early[i]:
			t.Fatalf("round %d %s by %s: source words %q were never written (narrated out of order?)",
				s.Round, s.Kind, s.Speaker.Name, s.Source.Words)
		default:
			chained++
		}
	}
	if company == 0 || chained == 0 {
		t.Fatalf("want both company and blob sources, got %d and %d", company, chained)
	}
}

func TestNarrateScenesMatchTheSim(t *testing.T) {
	l := fullRun(t)
	v := &recordingVoice{words: map[string]bool{}}
	if err := Narrate(context.Background(), &l, v); err != nil {
		t.Fatal(err)
	}
	for _, s := range v.scenes {
		if s.Company != l.Company || s.Story.Headline == "" || s.Story.Text == "" || s.Story.Feature == "" {
			t.Fatalf("scene missing company or story: %+v", s.Story)
		}
		if len(s.Hearers) == 0 {
			t.Fatalf("round %d %s: no hearers", s.Round, s.Kind)
		}
		want := map[SceneKind]int{SceneTalk: 1, ScenePost: PostReaders, SceneScroll: 1}[s.Kind]
		if len(s.Hearers) != want {
			t.Fatalf("round %d %s: %d hearers, want %d", s.Round, s.Kind, len(s.Hearers), want)
		}
		shipped := s.Round%MomentEvery >= ShipAfter
		if s.Story.Shipped != shipped {
			t.Fatalf("round %d: shipped %v, want %v", s.Round, s.Story.Shipped, shipped)
		}
	}
}

func TestClaimWordsCoversTheScale(t *testing.T) {
	seen := map[string]bool{}
	for c := 0.0; c <= 100; c += 5 {
		seen[ClaimWords(c)] = true
	}
	if len(seen) != 5 {
		t.Fatalf("got %d bands, want 5", len(seen))
	}
}
