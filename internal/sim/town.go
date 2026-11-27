package sim

import (
	_ "embed"
	"math/rand/v2"
	"strings"
)

// Shape is a blob's fictional culture.
type Shape string

const (
	ShapeSquare   Shape = "square"
	ShapeCircle   Shape = "circle"
	ShapeTriangle Shape = "triangle"
	ShapeStar     Shape = "star"
	ShapeTear     Shape = "tear"
	ShapeCapsule  Shape = "capsule"
)

// Trait is a personality or special tag.
type Trait string

const (
	TraitSkeptic        Trait = "skeptic"
	TraitGullible       Trait = "gullible"
	TraitQuiet          Trait = "quiet"
	TraitChatty         Trait = "chatty"
	TraitUnconvincing   Trait = "unconvincing"
	TraitCharismatic    Trait = "charismatic"
	TraitFamilyOriented Trait = "family-oriented"
	TraitRecluse        Trait = "recluse"
	TraitLeader         Trait = "leader"
)

// NoFamily is the FamilyID of a blob (or home) not in a family.
const NoFamily = -1

// MODEL.md#population
const TownSize = 100

// MODEL.md#ages
const (
	ChildCount  = 20
	AdultCount  = 60
	ElderCount  = 20
	ChildMinAge = 0
	AdultMinAge = 18
	ElderMinAge = 65
	ElderMaxAge = 94
)

// MODEL.md#families
const (
	FamilyCount       = 10
	TwoParentFamilies = 7
	ParentMinAgeGap   = 18
	FamilyBlobCount   = 37
)

// familyChildCounts is shuffled and dealt to families. MODEL.md#families
var familyChildCounts = [FamilyCount]int{1, 1, 1, 2, 2, 2, 2, 3, 3, 3}

// Shapes in fixed order; ShapeCounts gives each one's exact count. MODEL.md#shapes
var (
	Shapes      = [...]Shape{ShapeSquare, ShapeCircle, ShapeTriangle, ShapeStar, ShapeTear, ShapeCapsule}
	ShapeCounts = [...]int{17, 17, 17, 17, 16, 16}
)

// MODEL.md#shapes: families 1–6 get one shape each, 7–10 four distinct shapes.
const singleShapeFamilies = 6

// MODEL.md#recluses
const RecluseCount = 5

// Tag-count odds in percent. MODEL.md#tag-count
const (
	OneTagPct   = 25
	TwoTagPct   = 60
	ThreeTagPct = 15
)

// Category is a personality category with a low and high tag.
type Category struct {
	Name   string
	Low    Trait
	High   Trait
	LowPct int // chance of Low when chosen, percent. MODEL.md#tag-choice
}

// Categories in fixed order. MODEL.md#tag-choice
var Categories = [...]Category{
	{"credulity", TraitSkeptic, TraitGullible, 50},
	{"socialness", TraitQuiet, TraitChatty, 80},
	{"persuasiveness", TraitUnconvincing, TraitCharismatic, 50},
}

const persuasiveness = 2 // index into Categories

// MODEL.md#homes
const (
	TwoPersonHomes = 20
	OnePersonHomes = 23
	HomeCount      = FamilyCount + TwoPersonHomes + OnePersonHomes
)

// MODEL.md#neighbourhoods
const NeighbourhoodCount = 5

// MODEL.md#starting-scores
const (
	StartPerception = 50
	StartInterest   = 20
)

// Blob is one townsperson. FamilyID is NoFamily (-1) when not in a family.
type Blob struct {
	ID              int      `json:"id"`
	Name            string   `json:"name"`
	Shape           Shape    `json:"shape"`
	Age             int      `json:"age"`
	Traits          []Trait  `json:"traits"`
	Perception      int      `json:"perception"`
	Interest        int      `json:"interest"`
	Emotions        Emotions `json:"emotions"`
	FamilyID        int      `json:"familyId"`
	HomeID          int      `json:"homeId"`
	NeighbourhoodID int      `json:"neighbourhoodId"`
}

// Family is parents and children sharing a shape and home.
type Family struct {
	ID       int   `json:"id"`
	Parents  []int `json:"parents"`
	Children []int `json:"children"`
	HomeID   int   `json:"homeId"`
}

// Home is where blobs live. FamilyID is NoFamily for non-family homes.
type Home struct {
	ID              int   `json:"id"`
	NeighbourhoodID int   `json:"neighbourhoodId"`
	FamilyID        int   `json:"familyId"`
	Residents       []int `json:"residents"`
}

// Town is the full generated population.
type Town struct {
	Blobs    []Blob   `json:"blobs"`
	Families []Family `json:"families"`
	Homes    []Home   `json:"homes"`
}

//go:embed names.txt
var namesFile string

var names = strings.Split(strings.TrimSpace(namesFile), "\n")

// NewTown builds a town following MODEL.md#generation-order.
// All randomness comes from rng.
func NewTown(rng *rand.Rand) Town {
	blobs := make([]Blob, TownSize)
	for i := range blobs {
		blobs[i] = Blob{ID: i, FamilyID: NoFamily}
	}
	special := make([]map[Trait]bool, TownSize)
	for i := range special {
		special[i] = map[Trait]bool{}
	}

	// 1. Ages.
	groups := make([]int, 0, TownSize) // 0 child, 1 adult, 2 elder
	for g, n := range []int{ChildCount, AdultCount, ElderCount} {
		for range n {
			groups = append(groups, g)
		}
	}
	rng.Shuffle(len(groups), func(i, j int) { groups[i], groups[j] = groups[j], groups[i] })
	var children, adults []int
	for i, g := range groups {
		switch g {
		case 0:
			blobs[i].Age = uniform(rng, ChildMinAge, AdultMinAge-1)
			children = append(children, i)
		case 1:
			blobs[i].Age = uniform(rng, AdultMinAge, ElderMinAge-1)
			adults = append(adults, i)
		default:
			blobs[i].Age = uniform(rng, ElderMinAge, ElderMaxAge)
		}
	}

	// 2. Families.
	childCounts := familyChildCounts
	rng.Shuffle(FamilyCount, func(i, j int) { childCounts[i], childCounts[j] = childCounts[j], childCounts[i] })
	parentCounts := make([]int, FamilyCount)
	for i := range parentCounts {
		parentCounts[i] = 1
		if i < TwoParentFamilies {
			parentCounts[i] = 2
		}
	}
	rng.Shuffle(FamilyCount, func(i, j int) { parentCounts[i], parentCounts[j] = parentCounts[j], parentCounts[i] })
	shuffleInts(rng, children)
	shuffleInts(rng, adults)
	families := make([]Family, FamilyCount)
	nc, na := 0, 0
	for f := range families {
		fam := Family{ID: f, Children: children[nc : nc+childCounts[f]], Parents: adults[na : na+parentCounts[f]]}
		nc += childCounts[f]
		na += parentCounts[f]
		oldest := 0
		for _, c := range fam.Children {
			oldest = max(oldest, blobs[c].Age)
		}
		for _, p := range fam.Parents {
			for blobs[p].Age-oldest < ParentMinAgeGap {
				blobs[p].Age = uniform(rng, AdultMinAge, ElderMinAge-1)
			}
		}
		for _, m := range members(fam) {
			blobs[m].FamilyID = f
			special[m][TraitFamilyOriented] = true
		}
		families[f] = fam
	}

	// 3. Shapes.
	slots := ShapeCounts
	first := rng.Perm(len(Shapes))
	second := rng.Perm(len(Shapes))
	for f, fam := range families {
		s := first[f%len(Shapes)]
		if f >= singleShapeFamilies {
			s = second[f-singleShapeFamilies]
		}
		for _, m := range members(fam) {
			blobs[m].Shape = Shapes[s]
		}
		slots[s] -= len(members(fam))
	}
	var loose []int
	for i := range blobs {
		if blobs[i].FamilyID == NoFamily {
			loose = append(loose, i)
		}
	}
	shuffleInts(rng, loose)
	k := 0
	for s := range Shapes {
		for range slots[s] {
			blobs[loose[k]].Shape = Shapes[s]
			k++
		}
	}

	// 4. Leaders.
	for _, s := range Shapes {
		var cands []int
		for i, b := range blobs {
			if b.Shape == s && b.Age >= AdultMinAge {
				cands = append(cands, i)
			}
		}
		special[cands[rng.IntN(len(cands))]][TraitLeader] = true
	}

	// 5. Recluses.
	var cands []int
	for i, b := range blobs {
		if b.FamilyID == NoFamily && b.Age >= AdultMinAge && !special[i][TraitLeader] {
			cands = append(cands, i)
		}
	}
	shuffleInts(rng, cands)
	for _, i := range cands[:RecluseCount] {
		special[i][TraitRecluse] = true
	}

	// 6. Traits.
	for i := range blobs {
		n := rollTagCount(rng)
		var chosen []int
		if special[i][TraitLeader] {
			others := []int{0, 1}
			shuffleInts(rng, others)
			chosen = append([]int{persuasiveness}, others[:n-1]...)
		} else {
			chosen = rng.Perm(len(Categories))[:n]
		}
		var tags [len(Categories)]Trait
		for _, c := range chosen {
			cat := Categories[c]
			if c == persuasiveness && special[i][TraitLeader] {
				tags[c] = cat.High
			} else if rng.IntN(100) < cat.LowPct {
				tags[c] = cat.Low
			} else {
				tags[c] = cat.High
			}
		}
		traits := []Trait{}
		for _, t := range tags {
			if t != "" {
				traits = append(traits, t)
			}
		}
		for _, t := range []Trait{TraitFamilyOriented, TraitRecluse, TraitLeader} {
			if special[i][t] {
				traits = append(traits, t)
			}
		}
		blobs[i].Traits = traits
	}

	// 7. Homes and neighbourhoods. Ids: family homes, two-person, one-person.
	homes := make([]Home, 0, HomeCount)
	for f := range families {
		families[f].HomeID = len(homes)
		homes = append(homes, Home{ID: len(homes), FamilyID: f, Residents: members(families[f])})
	}
	var recluses, rest []int
	for _, i := range loose { // remaining 58 are shuffled below, MODEL.md#homes
		if special[i][TraitRecluse] {
			recluses = append(recluses, i)
		} else {
			rest = append(rest, i)
		}
	}
	shuffleInts(rng, rest)
	for h := range TwoPersonHomes {
		homes = append(homes, Home{ID: len(homes), FamilyID: NoFamily, Residents: []int{rest[2*h], rest[2*h+1]}})
	}
	for _, i := range append(recluses, rest[2*TwoPersonHomes:]...) {
		homes = append(homes, Home{ID: len(homes), FamilyID: NoFamily, Residents: []int{i}})
	}
	for k, h := range rng.Perm(HomeCount) {
		homes[h].NeighbourhoodID = k % NeighbourhoodCount
	}
	for _, h := range homes {
		for _, r := range h.Residents {
			blobs[r].HomeID = h.ID
			blobs[r].NeighbourhoodID = h.NeighbourhoodID
		}
	}

	// 8. Starting scores and emotions, then names (MODEL.md#names; not in the order list, so last).
	nameOrder := rng.Perm(len(names))
	for i := range blobs {
		blobs[i].Perception = StartPerception
		blobs[i].Interest = StartInterest
		blobs[i].Emotions = Emotions{Calm: StartCalm}
		blobs[i].Name = names[nameOrder[i]]
	}

	return Town{Blobs: blobs, Families: families, Homes: homes}
}

func members(f Family) []int {
	return append(append([]int{}, f.Parents...), f.Children...)
}

func uniform(rng *rand.Rand, lo, hi int) int { return lo + rng.IntN(hi-lo+1) }

func shuffleInts(rng *rand.Rand, s []int) {
	rng.Shuffle(len(s), func(i, j int) { s[i], s[j] = s[j], s[i] })
}

func rollTagCount(rng *rand.Rand) int {
	r := rng.IntN(OneTagPct + TwoTagPct + ThreeTagPct)
	switch {
	case r < OneTagPct:
		return 1
	case r < OneTagPct+TwoTagPct:
		return 2
	default:
		return 3
	}
}
