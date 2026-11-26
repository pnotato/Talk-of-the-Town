package provider

import (
	"fmt"
	"strings"

	"talkofthetown/internal/sim"
)

// promptVersion is part of every cache key. Bump it when the system prompt, the tools or the
// scene text change, so old answers aren't reused for new prompts.
const promptVersion = "voice-2"

// systemPrompt is the same for every call, byte for byte, so it is cached once and read by
// every blob for the rest of the run. Keep anything that varies (names, rounds, the company)
// out of it: that goes in the scene message.
const systemPrompt = `You write the inner thoughts and spoken words of the residents of a small simulated town. The residents are called blobs. This is an educational game about how hype and misinformation spread: the player runs communications for a fictional tech company, and the town passes the company's announcements around by word of mouth and social media. Bold claims spread fast but backfire when the product doesn't live up to what people heard.

Everything is fictional and simulated. The town is in Canada; use Canadian spelling.

## Your job

The simulation has already decided what happens in each scene: who talks to whom or posts, how strongly they make the claim, and how each listener's opinion of the company and interest in it change. You put those decisions into words. You never decide anything yourself, and you never contradict the numbers:

- If a listener's opinion goes up, their thought leans positive or convinced. If it goes down, it leans doubtful, annoyed or let down. If it barely moves, they are unmoved.
- If their interest goes up a lot, they are curious or excited. If it barely moves, they don't much care.
- The claim strength says how big the teller makes the news sound. Make the words match it: a small tweak sounds modest; a total game-changer sounds breathless.
- If the teller makes it sound bigger than the company did, their words exaggerate. If smaller, they play it down.

Show the reasoning. A thought is the blob's private reason in one short sentence: why they believe or doubt it, or why they pass it on. That is the point of the game: the player should see why people think what they think.

## The telephone game

Each teller heard the story from someone. Retell what they heard in their own words. Keep the gist, but let it drift the way the claim strength says. People paraphrase, mix things up, drop details and add their own spin. Never copy the company's press release word for word; only someone who read the announcement themselves would sound like it.

## Scales (0 to 100)

- Claim strength: under 30 a small tweak; 30 to 50 a modest update; 50 to 65 a solid upgrade; 65 to 80 a big deal; 80 and up a total game-changer.
- Opinion of the company: under 20 very negative; 20 to 38 negative; 38 to 62 neutral; 62 to 80 positive; 80 and up very positive.
- Interest: under 15 bored; 15 to 50 mildly curious; 50 to 70 interested; 70 and up very keen.

Never say a number or a score out loud. People don't talk in scores.

## Who the blobs are

Each blob has a name, an age, a shape and a few traits.

Shape is their culture, and it sets who they trust most:
- square: trusts other squares, wary of other shapes.
- circle: trusts everyone about the same.
- triangle: trusts people close to their own age.
- star: follows star leaders.
- tear: trusts people from their own neighbourhood.
- capsule: trusts family above everyone.

Traits:
- skeptic: hard to convince; wants proof. gullible: believes what they hear, especially from people they trust.
- quiet: says little. chatty: loves passing news on.
- unconvincing: people tend not to believe them. charismatic: persuasive, sure of themselves.
- family-oriented: thinks about what it means for their family. recluse: stays home, lives online. leader: others look to them.

Voice by age: under 13, simple words and short sentences; 13 to 17, casual, like a teenager texting; 18 to 64, plain everyday speech; 65 and up, a little more formal and careful.

Don't assume anyone's gender: use names, or they and them.

## Lengths

- thought: one short sentence, at most 15 words, first person, in the blob's head.
- words (said in person): at most 30 words, spoken to the listener.
- words (a social media post): at most 40 words. A hashtag or one emoji is fine. No links and no @handles.
- reader or listener thoughts: one short sentence each, at most 15 words.

## Rules

- Only the fictional company named in the scene. Never mention real companies, products, brands, apps, websites or real people.
- Family-friendly: no swearing, slurs, insults about real groups, or harassment.
- Stay in character. No narration, no stage directions, no quotation marks around the words.
- If the story has shipped, people react to what actually shipped compared with what they heard.

Call the tool the scene asks for, once, with every field filled in.

## Examples

A talk. The teller is a gullible 16-year-old; the claim is a total game-changer, bigger than the company's own big deal; the listener's opinion goes up a little and interest a lot.
talk {"thought": "Everyone at school needs to know about this.", "words": "Okay so the new homework helper basically does your whole assignment for you. Like, all of it. It's unreal.", "listener_thought": "Wait, really? I need that before exams."}

A post. The poster is a skeptical adult; the claim is a modest update; one reader's opinion drops, the other's barely moves.
post {"thought": "Someone should cut through the hype.", "words": "Read the actual announcement. It's a small update to the calendar app, not a revolution. Calm down, everyone.", "reader_thoughts": ["Ugh, so it's just more marketing.", "Fair enough, I wasn't excited anyway."]}

A scroll. The reader is a 70-year-old family-oriented capsule; their opinion goes up a little.
scroll {"reader_thought": "That might help my grandson with his schooling, I suppose."}
`

// Tool names: one per scene kind.
const (
	toolTalk   = "talk"
	toolPost   = "post"
	toolScroll = "scroll"
)

// toolSchemas are the three tools, in a fixed order so the cached prefix never changes. The
// thought comes first: the model gives its reason before the words.
var toolSchemas = []struct {
	name, description string
	properties        map[string]any
	required          []string
}{
	{
		toolPost, "Write a social media post and how each reader takes it.",
		map[string]any{
			"thought":         str("The poster's private reason for posting, at most 15 words."),
			"words":           str("The post, at most 40 words."),
			"reader_thoughts": map[string]any{"type": "array", "items": str("One reader's thought, at most 15 words."), "description": "One thought per reader, in the order the readers are listed."},
		},
		[]string{"thought", "words", "reader_thoughts"},
	},
	{
		toolScroll, "Write what a reader thinks of a post they scrolled past.",
		map[string]any{"reader_thought": str("The reader's thought, at most 15 words.")},
		[]string{"reader_thought"},
	},
	{
		toolTalk, "Write one in-person conversation: the teller's thought, what they say, and the listener's thought.",
		map[string]any{
			"thought":          str("The teller's private reason for bringing it up, at most 15 words."),
			"words":            str("What the teller says to the listener, at most 30 words."),
			"listener_thought": str("The listener's thought after hearing it, at most 15 words."),
		},
		[]string{"thought", "words", "listener_thought"},
	},
}

func str(description string) map[string]any {
	return map[string]any{"type": "string", "description": description}
}

func toolFor(k sim.SceneKind) string {
	switch k {
	case sim.ScenePost:
		return toolPost
	case sim.SceneScroll:
		return toolScroll
	}
	return toolTalk
}

// sceneText is the per-call message: everything about this one scene.
func sceneText(s sim.Scene) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Round %d of %d. Company: %s (fictional).\n", s.Round+1, sim.RunRounds, s.Company)
	fmt.Fprintf(&b, "The story: %s. Headline: %q. In the company's own words: %q\n", s.Story.Feature, s.Story.Headline, s.Story.Text)
	fmt.Fprintf(&b, "The company made it sound like %s (claim %.0f).", sim.ClaimWords(s.Story.Claimed), s.Story.Claimed)
	if s.Story.Shipped {
		fmt.Fprintf(&b, " It has shipped, and what shipped is %s (%.0f).\n", sim.ClaimWords(s.Story.Delivered), s.Story.Delivered)
	} else {
		b.WriteString(" It hasn't shipped yet.\n")
	}
	b.WriteString("\n")

	switch s.Kind {
	case sim.SceneScroll:
		r := s.Hearers[0]
		fmt.Fprintf(&b, "Reader: %s\n", personaLine(r.Persona))
		fmt.Fprintf(&b, "%s scrolls past an older post by %s: %q\n", r.Name, s.Speaker.Name, s.Source.Words)
		fmt.Fprintf(&b, "The post makes it sound like %s (claim %.0f).\n", sim.ClaimWords(s.Claim), s.Claim)
		fmt.Fprintf(&b, "Decided by the simulation: %s.\n", effect(r))
		b.WriteString("\nCall the scroll tool.")
		return b.String()
	case sim.ScenePost:
		fmt.Fprintf(&b, "Poster: %s\n", personaLine(s.Speaker))
	default:
		fmt.Fprintf(&b, "Teller: %s\n", personaLine(s.Speaker))
	}
	if s.Source.Company {
		fmt.Fprintf(&b, "%s heard it straight from the company's announcement.\n", s.Speaker.Name)
	} else {
		fmt.Fprintf(&b, "%s last heard about it from %s in round %d: %q\n", s.Speaker.Name, s.Source.From, s.Source.Round+1, s.Source.Words)
	}

	if s.Kind == sim.ScenePost {
		fmt.Fprintf(&b, "\nDecided by the simulation: %s posts about it on social media and makes it sound like %s (claim %.0f). %d people read it:\n",
			s.Speaker.Name, sim.ClaimWords(s.Claim), s.Claim, len(s.Hearers))
		for i, h := range s.Hearers {
			fmt.Fprintf(&b, "%d. %s. %s.\n", i+1, personaLine(h.Persona), effect(h))
		}
		b.WriteString("\nCall the post tool, with one reader thought per reader in this order.")
		return b.String()
	}
	l := s.Hearers[0]
	fmt.Fprintf(&b, "Listener: %s\n", personaLine(l.Persona))
	fmt.Fprintf(&b, "\nDecided by the simulation: %s tells %s in person and makes it sound like %s (claim %.0f). %s.\n",
		s.Speaker.Name, l.Name, sim.ClaimWords(s.Claim), s.Claim, effect(l))
	b.WriteString("\nCall the talk tool.")
	return b.String()
}

// personaLine is one blob in a line: name, age, shape, traits and scores.
func personaLine(p sim.Persona) string {
	traits := "no strong traits"
	if len(p.Traits) > 0 {
		ts := make([]string, len(p.Traits))
		for i, t := range p.Traits {
			ts[i] = string(t)
		}
		traits = strings.Join(ts, ", ")
	}
	return fmt.Sprintf("%s, %d, %s (%s). Opinion of the company: %s (%.0f). Interest: %s (%.0f)",
		p.Name, p.Age, p.Shape, traits, opinionWords(p.Perception), p.Perception, interestWords(p.Interest), p.Interest)
}

// effect says what a hearing did to a hearer, in words and numbers.
func effect(h sim.Hearer) string {
	s := fmt.Sprintf("%s's opinion %s (%.0f to %.0f) and interest %s (%.0f to %.0f)",
		h.Name, change(h.DP), h.Perception, h.Perception+h.DP, change(h.DI), h.Interest, h.Interest+h.DI)
	switch {
	case h.Before == 1:
		s += "; they had already heard it from one other person"
	case h.Before > 1:
		s += fmt.Sprintf("; they had already heard it from %d other people", h.Before)
	}
	return s
}

func change(d float64) string {
	mag := d
	if mag < 0 {
		mag = -mag
	}
	dir := "goes up"
	if d < 0 {
		dir = "goes down"
	}
	switch {
	case mag < 1:
		return "barely moves"
	case mag < 3:
		return dir + " a little"
	case mag < 8:
		return dir + " noticeably"
	}
	return dir + " a lot"
}

func opinionWords(p float64) string {
	switch {
	case p < 20:
		return "very negative"
	case p < 38:
		return "negative"
	case p < 62:
		return "neutral"
	case p < 80:
		return "positive"
	}
	return "very positive"
}

func interestWords(i float64) string {
	switch {
	case i < 15:
		return "bored"
	case i < 50:
		return "mildly curious"
	case i < 70:
		return "interested"
	}
	return "very keen"
}
