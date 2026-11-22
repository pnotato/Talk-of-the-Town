package sim

import "math/rand/v2"

// rngStream is the fixed second PCG word. Changing it changes every town
// for every seed, so treat it as part of the RunLog contract.
const rngStream = 0x746f74 // "tot"

// NewRNG maps a player-facing seed to the simulation's random source.
// Every endpoint must build its rng here so the same seed means the same town.
func NewRNG(seed uint64) *rand.Rand {
	return rand.New(rand.NewPCG(seed, rngStream))
}

// MaxSeed is the largest seed JS can hold exactly (2^53 - 1). Handlers must
// reject larger seeds, since RunLog.Seed is a JSON number.
const MaxSeed = 1<<53 - 1
