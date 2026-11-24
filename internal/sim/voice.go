package sim

import (
	"context"
	"fmt"
	"hash/fnv"
	"slices"
	"strings"
	"sync"

	"talkofthetown/internal/sim/content"
)

// A Voice writes what blobs think and say for events the sim has already decided. It never
// changes a number: who talks, to whom, how strong the claim is and how scores move all come
// from the formulas. The default is StubVoice; internal/provider has a model-backed one.
type Voice interface {
	// Speak writes the lines for one scene. It must not fail: an implementation that can't
	// reach its model returns StubVoice's lines instead. Narrate calls it from many goroutines.
	Speak(ctx context.Context, s Scene) Lines
}

// SceneKind says what happened in a scene.
type SceneKind string

const (
	SceneTalk   SceneKind = "talk"   // Speaker told Hearers[0] in person
	ScenePost   SceneKind = "post"   // Speaker posted; Hearers are the readers
	SceneScroll SceneKind = "scroll" // Hearers[0] scrolled past Speaker's older post
)

// Scene is everything a voice needs to write one event: who was involved, the story, and what
// the sim decided. Numbers are on the 0–100 scale.
type Scene struct {
	Kind    SceneKind
	Round   int // 0-based
	Company string
	Story   Story
	Speaker Persona // who talks or posts; for a scroll, who wrote the post
	Claim   float64 // the claim strength passed on
	Source  Source  // talk/post: what the speaker last heard; scroll: the post being read
	Hearers []Hearer
}

// Story is the announcement this scene is about.
type Story struct {
	Feature   string // what is being announced, in a few words
	Headline  string
	Text      string
	Claimed   float64 // what the company claimed
	Delivered float64 // what it will ship
	Shipped   bool    // the feature has shipped by this round
}

// Persona is a blob as a voice sees it, with its scores at the start of the round.
type Persona struct {
	ID         int
	Name       string
	Age        int
	Shape      Shape
	Traits     []Trait
	Perception float64
	Interest   float64
}

// Hearer is a blob who heard the scene, and what the sim decided it did to them.
type Hearer struct {
	Persona
	DP, DI float64 // perception and interest change from this hearing
	Before int     // other blobs it had already heard this story from
}

// Source is what a blob heard: the words and who said them.
type Source struct {
	Company bool   // heard straight from the company's announcement
	From    string // who said it: a blob's name, or the company's
	Round   int
	Words   string
}

// Lines is what a voice writes for one scene.
type Lines struct {
	Thought string   // the speaker's thought (empty for a scroll)
	Words   string   // what the speaker says or posts (empty for a scroll)
	Hearers []string // each hearer's thought, same order as Scene.Hearers
}

// Narrate fills in Words, Thought and Replies on every event of l with v.
//
// Each retelling repeats the words its teller last heard, so an event waits for the event it
// repeats (the telephone game). Everything else runs at once: events start as soon as their one
// dependency is written, and chains restart with each story, so a run is only as slow as its
// longest chain of retellings, not its number of rounds.
func Narrate(ctx context.Context, l *RunLog, v Voice) error {
	stories, err := storiesOf(l)
	if err != nil {
		return err
	}
	tasks := plan(l, stories)
	var wg sync.WaitGroup
	for _, t := range tasks {
		wg.Go(func() {
			defer close(t.done)
			if t.dep != nil {
				<-t.dep.done
				t.scene.Source.Words = l.Rounds[t.dep.round].Events[t.dep.event].Words
			}
			apply(&l.Rounds[t.round].Events[t.event], t.scene, v.Speak(ctx, t.scene))
		})
	}
	wg.Wait()
	return nil
}

// storiesOf is each chosen moment's story, with the option text from the content.
func storiesOf(l *RunLog) ([]Story, error) {
	a, err := content.LoadAnnouncements()
	if err != nil {
		return nil, err
	}
	stories := make([]Story, len(l.Moments))
	for k, m := range l.Moments {
		stories[k] = Story{Headline: m.Headline, Claimed: float64(m.Claimed), Delivered: float64(m.Delivered)}
		for _, cm := range a.Moments {
			if cm.ID != m.ID {
				continue
			}
			stories[k].Feature = cm.Feature
			for _, o := range cm.Options {
				if o.ID == m.OptionID {
					stories[k].Text = o.Text
				}
			}
		}
	}
	return stories, nil
}

// task is one event to narrate. dep is the task whose words this one repeats, if any.
type task struct {
	round, event int
	scene        Scene // Source.Words is filled in from dep when it is done
	dep          *task
	done         chan struct{}
}

type hearing struct {
	task *task
	from int // speaker id
}

// plan walks the run in order, as the sim played it, and builds every event's scene except the
// words it repeats.
func plan(l *RunLog, stories []Story) []*task {
	heard := make([][]hearing, len(l.Town.Blobs)) // per blob, this story's hearings in order
	var posts []*task                             // this story's posts, in order
	var tasks []*task
	for r, round := range l.Rounds {
		k := r / MomentEvery
		if k >= len(stories) {
			break
		}
		if r%MomentEvery == 0 {
			// A new story: what blobs heard about the last one no longer counts. MODEL.md#run-state
			for b := range heard {
				heard[b] = heard[b][:0]
			}
			posts = posts[:0]
		}
		story := stories[k]
		m := l.Moments[k]
		story.Shipped = m.Shipped && r >= m.ShippedRound

		for j, e := range round.Events {
			t := &task{round: r, event: j, done: make(chan struct{})}
			s := Scene{Round: r, Company: l.Company, Story: story, Claim: e.Claim}
			speaker := e.From
			switch {
			case e.Scroll:
				s.Kind, speaker = SceneScroll, e.To[0]
				t.dep = findPost(l, posts, speaker, e.Claim)
				s.Source = Source{From: l.Town.Blobs[speaker].Name}
				if t.dep != nil {
					s.Source.Round = t.dep.round
				}
			default:
				s.Kind = SceneTalk
				if e.Post {
					s.Kind = ScenePost
				}
				if hs := heard[e.From]; len(hs) > 0 {
					last := hs[len(hs)-1]
					t.dep = last.task
					s.Source = Source{From: l.Town.Blobs[last.from].Name, Round: last.task.round}
				} else {
					// Every hearing but the company's is an event, so no event means the company.
					s.Source = Source{Company: true, From: l.Company, Round: r - r%MomentEvery,
						Words: story.Headline + ". " + story.Text}
				}
			}
			s.Speaker = persona(l, speaker, r)
			hearers := e.To
			if e.Scroll {
				hearers = []int{e.From}
			}
			for i, b := range hearers {
				before := map[int]bool{}
				for _, h := range heard[b] {
					if h.from != speaker {
						before[h.from] = true
					}
				}
				s.Hearers = append(s.Hearers, Hearer{Persona: persona(l, b, r), DP: e.DP[i], DI: e.DI[i], Before: len(before)})
				heard[b] = append(heard[b], hearing{task: t, from: speaker})
			}
			if e.Post {
				posts = append(posts, t)
			}
			t.scene = s
			tasks = append(tasks, t)
		}
	}
	return tasks
}

// findPost is the post a scroll read: author's latest post this story with that claim. A post's
// claim never changes, so the claim picks it out; two posts with the same claim told the same.
func findPost(l *RunLog, posts []*task, author int, claim float64) *task {
	var latest *task
	for _, p := range slices.Backward(posts) {
		e := l.Rounds[p.round].Events[p.event]
		if e.From != author {
			continue
		}
		if e.Claim == claim {
			return p
		}
		if latest == nil {
			latest = p
		}
	}
	return latest
}

// persona is blob b with its scores at the start of round r.
func persona(l *RunLog, b, r int) Persona {
	B := l.Town.Blobs[b]
	p := Persona{ID: b, Name: B.Name, Age: B.Age, Shape: B.Shape, Traits: B.Traits,
		Perception: float64(B.Perception), Interest: float64(B.Interest)}
	if r > 0 {
		p.Perception, p.Interest = l.Rounds[r-1].Perception[b], l.Rounds[r-1].Interest[b]
	}
	return p
}

// apply writes one scene's lines onto its event, falling back to the stub for anything missing.
func apply(e *RunEvent, s Scene, ln Lines) {
	stub := stubLines(s)
	pick := func(got, fallback string) string {
		if got = strings.TrimSpace(got); got != "" {
			return got
		}
		return fallback
	}
	replies := make([]string, len(s.Hearers))
	for i := range replies {
		var got string
		if i < len(ln.Hearers) {
			got = ln.Hearers[i]
		}
		replies[i] = pick(got, stub.Hearers[i])
	}
	if s.Kind == SceneScroll {
		// The reader's thought is From's, and the words are the post it read.
		e.Words, e.Thought, e.Replies = s.Source.Words, replies[0], []string{}
		return
	}
	e.Words, e.Thought, e.Replies = pick(ln.Words, stub.Words), pick(ln.Thought, stub.Thought), replies
}

// StubVoice writes short template lines from the numbers. Deterministic, no model calls: the
// default voice, and the fallback when a model can't answer.
type StubVoice struct{}

func (StubVoice) Speak(_ context.Context, s Scene) Lines { return stubLines(s) }

// ClaimWords describes a claim strength in plain words, for prompts and templates.
func ClaimWords(c float64) string {
	switch {
	case c < 30:
		return "a small tweak"
	case c < 50:
		return "a modest update"
	case c < 65:
		return "a solid upgrade"
	case c < 80:
		return "a big deal"
	}
	return "a total game-changer"
}

func stubLines(s Scene) Lines {
	seed := fmt.Sprint(s.Round, s.Kind, s.Speaker.ID, s.Claim)
	ln := Lines{Hearers: make([]string, len(s.Hearers))}
	for i, h := range s.Hearers {
		ln.Hearers[i] = choose(seed+fmt.Sprint(h.ID), hearerThoughts(h))
	}
	if s.Kind == SceneScroll {
		return ln
	}
	name, size := s.Story.Headline, ClaimWords(s.Claim)
	var words []string
	switch {
	case s.Story.Shipped && s.Claim > s.Story.Delivered+BrokenThreshold:
		words = []string{fmt.Sprintf("%s finally shipped, and it's nowhere near what people said.", name)}
	case s.Story.Shipped:
		words = []string{fmt.Sprintf("%s shipped. It's about what they promised.", name)}
	case s.Kind == ScenePost:
		words = []string{
			fmt.Sprintf("%s. Honestly %s.", name, size),
			fmt.Sprintf("Just saw this: %s. %s, if true.", name, capital(size)),
			fmt.Sprintf("Everyone's talking about %s. Calling it %s.", name, size),
		}
	default:
		words = []string{
			fmt.Sprintf("Did you hear? %s. Sounds like %s.", name, size),
			fmt.Sprintf("There's a new thing from %s: %s. People say it's %s.", s.Company, s.Story.Feature, size),
			fmt.Sprintf("Apparently it's %s: %s.", size, name),
		}
	}
	ln.Words = choose(seed, words)
	ln.Thought = choose(seed+"t", speakerThoughts(s.Speaker))
	return ln
}

func speakerThoughts(p Persona) []string {
	switch {
	case tagged(p.Traits, TraitSkeptic):
		return []string{"I'm not sure I buy it, but it's worth mentioning.", "Let's see what others make of this."}
	case tagged(p.Traits, TraitGullible):
		return []string{"This is amazing, I have to tell someone!", "If this is true, it changes everything."}
	case tagged(p.Traits, TraitChatty):
		return []string{"Ooh, news to share!", "I can't keep this to myself."}
	case p.Perception >= 65:
		return []string{"I like where this company is going.", "This sounds genuinely useful."}
	case p.Perception <= 35:
		return []string{"Here we go again with their big promises.", "I'll believe it when I see it."}
	}
	return []string{"Might as well pass it on.", "People should know about this."}
}

func hearerThoughts(h Hearer) []string {
	var out []string
	switch {
	case h.DP >= 3:
		out = []string{"That actually sounds great.", "Huh, maybe they're onto something."}
	case h.DP <= -3:
		out = []string{"I don't like the sound of that.", "That seems like a stretch."}
	case h.DI >= 5:
		out = []string{"Now I'm curious.", "I want to know more about this."}
	default:
		out = []string{"Okay, noted.", "Hm. We'll see."}
	}
	if h.Before > 0 {
		out = append(out, "That's not the first time I've heard this.")
	}
	if tagged(h.Traits, TraitSkeptic) {
		out = append(out, "Sounds too good to be true.")
	}
	return out
}

func tagged(ts []Trait, t Trait) bool { return slices.Contains(ts, t) }

func capital(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

// choose picks one option, the same one every time for the same key.
func choose(key string, options []string) string {
	h := fnv.New32a()
	h.Write([]byte(key))
	return options[h.Sum32()%uint32(len(options))]
}
