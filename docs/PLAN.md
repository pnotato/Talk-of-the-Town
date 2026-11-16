# Talk of the Town

Talk of the Town is a population simulation game where you control the newsroom for your AI company. Your goal is to get people talking about your product, so what do you report?

The goal of the simulation is to show how public perception of a company can be distorted through misinformation and hype. It's easy to get people talking about your company by making bold claims, but what happens when you can't live up to them?

## The Game

The simulation runs a batch of 100 small LLM agents, each given a persona, an age, and other traits that make them representative of the Canadian population. These are the "blobs".

You control the news media for your company. Every few rounds, you choose how to present your product. Bold claims bring high interest in your company, but may lead to angry customers later if you fail to deliver. True claims could avoid this, but

There's no winning or losing. Aim for high perception and interest by the end.

## The Blobs

More in [Blobs](./BLOBS.md). The blobs are meant to be representative of the population. Like in real life, blobs get information two ways: word of mouth and social media. At each round, a blob is either receiving or sharing information, or idling.

How a round works is in [Game Loop](./GAME%20LOOP.md).
